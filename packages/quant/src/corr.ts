/**
 * Association between two columns, and between many at once. Spearman is the
 * default anywhere football data is involved: points, prices, and ownership are
 * all skewed, and a Pearson number on skewed columns reports the outliers.
 */
import { at, mean, pairs, rankAverage, standardDeviation, type Series } from './internal.js';
import { normalCdf, normalQuantile, tTwoSided } from './special.js';

export type CorrelationMethod = 'pearson' | 'spearman' | 'kendall';

export interface Correlation {
  method: CorrelationMethod;
  /** The coefficient, or NaN when fewer than three paired observations survive. */
  r: number;
  n: number;
  pValue: number;
  /** Fisher z interval at 95 percent, absent for Kendall where it does not apply. */
  lower: number;
  upper: number;
}

function fisherInterval(r: number, n: number, level = 0.95): { lower: number; upper: number } {
  if (n < 4 || !Number.isFinite(r) || Math.abs(r) >= 1)
    return { lower: Number.NaN, upper: Number.NaN };
  const z = 0.5 * Math.log((1 + r) / (1 - r));
  const se = 1 / Math.sqrt(n - 3);
  const critical = normalQuantile(1 - (1 - level) / 2);
  const lo = z - critical * se;
  const hi = z + critical * se;
  return { lower: Math.tanh(lo), upper: Math.tanh(hi) };
}

export function pearson(x: Series, y: Series): Correlation {
  const { x: xs, y: ys } = pairs(x, y);
  const n = xs.length;
  if (n < 3)
    return {
      method: 'pearson',
      r: Number.NaN,
      n,
      pValue: Number.NaN,
      lower: Number.NaN,
      upper: Number.NaN,
    };

  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = at(xs, i) - mx;
    const dy = at(ys, i) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denominator = Math.sqrt(sxx * syy);
  const r = denominator === 0 ? Number.NaN : sxy / denominator;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return {
    method: 'pearson',
    r,
    n,
    pValue: Number.isFinite(t) ? tTwoSided(t, n - 2) : Number.NaN,
    ...fisherInterval(r, n),
  };
}

/** Pearson on average ranks, which is exactly Spearman's rho including ties. */
export function spearman(x: Series, y: Series): Correlation {
  const { x: xs, y: ys } = pairs(x, y);
  const n = xs.length;
  if (n < 3)
    return {
      method: 'spearman',
      r: Number.NaN,
      n,
      pValue: Number.NaN,
      lower: Number.NaN,
      upper: Number.NaN,
    };
  const result = pearson(rankAverage(xs), rankAverage(ys));
  return { ...result, method: 'spearman' };
}

/**
 * Kendall tau-b, counting concordant and discordant pairs directly. O(n squared),
 * so the caller is expected to sample above a few thousand rows; the Lab does.
 */
export function kendall(x: Series, y: Series): Correlation {
  const { x: xs, y: ys } = pairs(x, y);
  const n = xs.length;
  if (n < 3)
    return {
      method: 'kendall',
      r: Number.NaN,
      n,
      pValue: Number.NaN,
      lower: Number.NaN,
      upper: Number.NaN,
    };

  let concordant = 0;
  let discordant = 0;
  let tiedX = 0;
  let tiedY = 0;
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = at(xs, i) - at(xs, j);
      const dy = at(ys, i) - at(ys, j);
      const product = dx * dy;
      if (product > 0) concordant += 1;
      else if (product < 0) discordant += 1;
      else if (dx === 0 && dy !== 0) tiedX += 1;
      else if (dy === 0 && dx !== 0) tiedY += 1;
    }
  }
  const denominator = Math.sqrt(
    (concordant + discordant + tiedX) * (concordant + discordant + tiedY),
  );
  const tau = denominator === 0 ? Number.NaN : (concordant - discordant) / denominator;

  // Normal approximation to the null, valid from about n = 10.
  const variance = (2 * (2 * n + 5)) / (9 * n * (n - 1));
  const z = tau / Math.sqrt(variance);
  return {
    method: 'kendall',
    r: tau,
    n,
    pValue: Number.isFinite(z) ? 2 * (1 - normalCdf(Math.abs(z))) : Number.NaN,
    lower: Number.NaN,
    upper: Number.NaN,
  };
}

export function correlate(
  x: Series,
  y: Series,
  method: CorrelationMethod = 'pearson',
): Correlation {
  if (method === 'spearman') return spearman(x, y);
  if (method === 'kendall') return kendall(x, y);
  return pearson(x, y);
}

export interface CorrelationMatrix {
  columns: string[];
  /** Row major, columns.length squared, with 1 on the diagonal. */
  values: number[][];
  counts: number[][];
  method: CorrelationMethod;
}

export function correlationMatrix(
  columns: { name: string; values: Series }[],
  method: CorrelationMethod = 'pearson',
): CorrelationMatrix {
  const names = columns.map((column) => column.name);
  const size = columns.length;
  const values: number[][] = Array.from({ length: size }, () =>
    new Array<number>(size).fill(Number.NaN),
  );
  const counts: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));

  for (let i = 0; i < size; i += 1) {
    const rowValues = values[i];
    const rowCounts = counts[i];
    if (rowValues === undefined || rowCounts === undefined) continue;
    rowValues[i] = 1;
    for (let j = i + 1; j < size; j += 1) {
      const a = columns[i];
      const b = columns[j];
      if (a === undefined || b === undefined) continue;
      const result = correlate(a.values, b.values, method);
      rowValues[j] = result.r;
      rowCounts[j] = result.n;
      const mirrorValues = values[j];
      const mirrorCounts = counts[j];
      if (mirrorValues !== undefined) mirrorValues[i] = result.r;
      if (mirrorCounts !== undefined) mirrorCounts[i] = result.n;
    }
  }

  return { columns: names, values, counts, method };
}

export interface AutocorrelationPoint {
  lag: number;
  value: number;
  /** Bartlett's band at 95 percent: outside it, the lag is signal. */
  band: number;
}

/** Autocorrelation of a series, which is how form persistence is measured here. */
export function acf(series: Series, maxLag = 20): AutocorrelationPoint[] {
  const values: number[] = [];
  for (const value of Array.from(series)) {
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    values.push(value);
  }
  const n = values.length;
  if (n < 3) return [];
  const m = mean(values);
  let denominator = 0;
  for (const value of values) denominator += (value - m) ** 2;
  if (denominator === 0) return [];

  const lags = Math.min(maxLag, n - 1);
  const band = 1.96 / Math.sqrt(n);
  const out: AutocorrelationPoint[] = [];
  for (let lag = 0; lag <= lags; lag += 1) {
    let numerator = 0;
    for (let i = lag; i < n; i += 1) {
      numerator += (at(values, i) - m) * (at(values, i - lag) - m);
    }
    out.push({ lag, value: numerator / denominator, band });
  }
  return out;
}

/** Partial autocorrelation by Durbin-Levinson: what a lag adds over the shorter ones. */
export function pacf(series: Series, maxLag = 20): AutocorrelationPoint[] {
  const autocorrelations = acf(series, maxLag);
  if (autocorrelations.length === 0) return [];
  const r = autocorrelations.map((point) => point.value);
  const lags = r.length - 1;
  const band = autocorrelations[0]?.band ?? Number.NaN;

  const phi: number[][] = Array.from({ length: lags + 1 }, () =>
    new Array<number>(lags + 1).fill(0),
  );
  const out: AutocorrelationPoint[] = [{ lag: 0, value: 1, band }];

  for (let k = 1; k <= lags; k += 1) {
    let numerator = at(r, k);
    for (let j = 1; j < k; j += 1) {
      numerator -= (phi[k - 1]?.[j] ?? 0) * at(r, k - j);
    }
    let denominator = 1;
    for (let j = 1; j < k; j += 1) {
      denominator -= (phi[k - 1]?.[j] ?? 0) * at(r, j);
    }
    const value = denominator === 0 ? 0 : numerator / denominator;
    const row = phi[k];
    if (row === undefined) continue;
    row[k] = value;
    for (let j = 1; j < k; j += 1) {
      row[j] = (phi[k - 1]?.[j] ?? 0) - value * (phi[k - 1]?.[k - j] ?? 0);
    }
    out.push({ lag: k, value, band });
  }
  return out;
}

/** Correlation of x with y shifted forward by each lead, the crude lead-lag scan. */
export function crossCorrelation(x: Series, y: Series, maxLead = 10): AutocorrelationPoint[] {
  const out: AutocorrelationPoint[] = [];
  const n = Math.min(x.length, y.length);
  for (let lead = 0; lead <= maxLead; lead += 1) {
    const left: number[] = [];
    const right: number[] = [];
    for (let i = 0; i + lead < n; i += 1) {
      const a = x[i];
      const b = y[i + lead];
      if (a === null || a === undefined || b === null || b === undefined) continue;
      left.push(a);
      right.push(b);
    }
    const result = pearson(left, right);
    out.push({
      lag: lead,
      value: result.r,
      band: left.length > 0 ? 1.96 / Math.sqrt(left.length) : Number.NaN,
    });
  }
  return out;
}

export { standardDeviation };

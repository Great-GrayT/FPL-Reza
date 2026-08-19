/**
 * Descriptive statistics: the first thing anyone does to a column, and the
 * thing a histogram or a box plot is drawn from.
 */
import {
  at,
  clean,
  mean,
  quantileSorted,
  sorted,
  standardDeviation,
  variance,
  type Series,
} from './internal.js';

export interface Description {
  /** Finite observations. */
  count: number;
  /** Values that were null, undefined, or not finite. Never folded into count. */
  missing: number;
  mean: number;
  sd: number;
  variance: number;
  /** Standard error of the mean, sd / sqrt(n). */
  standardError: number;
  min: number;
  p1: number;
  p5: number;
  q1: number;
  median: number;
  q3: number;
  p95: number;
  p99: number;
  max: number;
  iqr: number;
  /** Fisher-Pearson sample skewness, the adjusted g1 that Excel and scipy report. */
  skewness: number;
  /** Excess kurtosis: 0 for a normal, not 3. */
  kurtosis: number;
  sum: number;
}

export function describe(values: Series): Description {
  const finite = clean(values);
  const missing = values.length - finite.length;
  const n = finite.length;
  if (n === 0) {
    const nan = Number.NaN;
    return {
      count: 0,
      missing,
      mean: nan,
      sd: nan,
      variance: nan,
      standardError: nan,
      min: nan,
      p1: nan,
      p5: nan,
      q1: nan,
      median: nan,
      q3: nan,
      p95: nan,
      p99: nan,
      max: nan,
      iqr: nan,
      skewness: nan,
      kurtosis: nan,
      sum: 0,
    };
  }

  const ascending = sorted(finite);
  const m = mean(finite);
  const sd = standardDeviation(finite);
  const q1 = quantileSorted(ascending, 0.25);
  const q3 = quantileSorted(ascending, 0.75);

  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const d = at(finite, i) - m;
    total += at(finite, i);
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;

  const g1 = m2 === 0 ? Number.NaN : m3 / m2 ** 1.5;
  const g2 = m2 === 0 ? Number.NaN : m4 / (m2 * m2) - 3;
  const skewness = n > 2 ? (Math.sqrt(n * (n - 1)) / (n - 2)) * g1 : Number.NaN;
  const kurtosis = n > 3 ? ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6) : Number.NaN;

  return {
    count: n,
    missing,
    mean: m,
    sd,
    variance: variance(finite),
    standardError: sd / Math.sqrt(n),
    min: at(ascending, 0),
    p1: quantileSorted(ascending, 0.01),
    p5: quantileSorted(ascending, 0.05),
    q1,
    median: quantileSorted(ascending, 0.5),
    q3,
    p95: quantileSorted(ascending, 0.95),
    p99: quantileSorted(ascending, 0.99),
    max: at(ascending, n - 1),
    iqr: q3 - q1,
    skewness,
    kurtosis,
    sum: total,
  };
}

export interface Bin {
  from: number;
  to: number;
  count: number;
  /** Share of the sample, so two histograms of different sizes overlay honestly. */
  density: number;
}

export interface HistogramOptions {
  bins?: number;
  from?: number;
  to?: number;
}

/**
 * Freedman-Diaconis by default, which adapts to spread rather than assuming a
 * bin count, and falls back to Sturges when the IQR is zero (a mostly constant
 * column, which is common here: minutes are 0 for most rows of most gameweeks).
 */
export function histogram(values: Series, options: HistogramOptions = {}): Bin[] {
  const finite = clean(values);
  const n = finite.length;
  if (n === 0) return [];
  const ascending = sorted(finite);
  const from = options.from ?? at(ascending, 0);
  const to = options.to ?? at(ascending, n - 1);
  if (!(to > from)) return [{ from, to, count: n, density: 1 }];

  let bins = options.bins;
  if (bins === undefined) {
    const iqr = quantileSorted(ascending, 0.75) - quantileSorted(ascending, 0.25);
    const width = iqr > 0 ? (2 * iqr) / Math.cbrt(n) : 0;
    bins = width > 0 ? Math.ceil((to - from) / width) : Math.ceil(Math.log2(n) + 1);
  }
  bins = Math.max(1, Math.min(500, bins));

  const width = (to - from) / bins;
  const counts = new Int32Array(bins);
  for (let i = 0; i < n; i += 1) {
    const value = at(finite, i);
    if (value < from || value > to) continue;
    const index = Math.min(bins - 1, Math.floor((value - from) / width));
    counts[index] = (counts[index] ?? 0) + 1;
  }

  return Array.from({ length: bins }, (_, i) => ({
    from: from + i * width,
    to: from + (i + 1) * width,
    count: counts[i] ?? 0,
    density: (counts[i] ?? 0) / n,
  }));
}

export interface DensityPoint {
  x: number;
  density: number;
}

/**
 * Gaussian kernel density. Bandwidth defaults to Silverman's rule of thumb,
 * using the smaller of sd and IQR/1.34 so one long tail does not oversmooth
 * the body of the distribution.
 */
export function kde(
  values: Series,
  options: { points?: number; bandwidth?: number } = {},
): DensityPoint[] {
  const finite = clean(values);
  const n = finite.length;
  if (n < 2) return [];
  const ascending = sorted(finite);
  const sd = standardDeviation(finite);
  const iqr = quantileSorted(ascending, 0.75) - quantileSorted(ascending, 0.25);
  const spread = iqr > 0 ? Math.min(sd, iqr / 1.34) : sd;
  const bandwidth = options.bandwidth ?? 0.9 * spread * n ** -0.2;
  if (!(bandwidth > 0)) return [];

  const points = Math.max(16, Math.min(512, options.points ?? 128));
  const min = at(ascending, 0) - 3 * bandwidth;
  const max = at(ascending, n - 1) + 3 * bandwidth;
  const step = (max - min) / (points - 1);
  const scale = 1 / (n * bandwidth * Math.sqrt(2 * Math.PI));

  return Array.from({ length: points }, (_, i) => {
    const x = min + i * step;
    let total = 0;
    for (let j = 0; j < n; j += 1) {
      const z = (x - at(finite, j)) / bandwidth;
      total += Math.exp(-0.5 * z * z);
    }
    return { x, density: total * scale };
  });
}

export interface EcdfPoint {
  x: number;
  p: number;
}

/** Empirical distribution function, one point per distinct value. */
export function ecdf(values: Series): EcdfPoint[] {
  const ascending = sorted(clean(values));
  const n = ascending.length;
  const out: EcdfPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = at(ascending, i);
    if (i + 1 < n && at(ascending, i + 1) === x) continue;
    out.push({ x, p: (i + 1) / n });
  }
  return out;
}

export interface BoxSummary {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Tukey whiskers: the extreme values still within 1.5 IQR of the box. */
  lowerWhisker: number;
  upperWhisker: number;
  outliers: number[];
  count: number;
}

export function boxSummary(values: Series): BoxSummary | null {
  const ascending = sorted(clean(values));
  const n = ascending.length;
  if (n === 0) return null;
  const q1 = quantileSorted(ascending, 0.25);
  const q3 = quantileSorted(ascending, 0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;

  let lowerWhisker = at(ascending, n - 1);
  let upperWhisker = at(ascending, 0);
  const outliers: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const value = at(ascending, i);
    if (value < lowFence || value > highFence) {
      outliers.push(value);
      continue;
    }
    if (value < lowerWhisker) lowerWhisker = value;
    if (value > upperWhisker) upperWhisker = value;
  }

  return {
    min: at(ascending, 0),
    q1,
    median: quantileSorted(ascending, 0.5),
    q3,
    max: at(ascending, n - 1),
    lowerWhisker,
    upperWhisker,
    outliers,
    count: n,
  };
}

/**
 * Quantile-quantile points against a reference distribution's quantile
 * function, defaulting to the standard normal. The straightness of the result
 * is the whole diagnostic.
 */
export function qqPoints(
  values: Series,
  referenceQuantile: (p: number) => number,
): { theoretical: number; sample: number }[] {
  const ascending = sorted(clean(values));
  const n = ascending.length;
  if (n === 0) return [];
  return Array.from({ length: n }, (_, i) => ({
    // The 3/8 plotting position, standard for a normal probability plot.
    theoretical: referenceQuantile((i + 1 - 0.375) / (n + 0.25)),
    sample: at(ascending, i),
  }));
}

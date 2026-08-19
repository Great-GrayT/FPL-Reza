/**
 * Time series over a gameweek ordered column. Everything here preserves length
 * and leaves the leading positions null: a rolling mean over six gameweeks does
 * not exist in gameweek three, and inventing it there is how a backtest ends up
 * trading on information it did not have.
 */
import { at, mean, standardDeviation, variance, type Series } from './internal.js';

export type NullableSeries = (number | null)[];

function toArray(values: Series): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(values.length).fill(null);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    out[i] = value === null || value === undefined || !Number.isFinite(value) ? null : value;
  }
  return out;
}

export function lag(values: Series, periods = 1): NullableSeries {
  const source = toArray(values);
  return source.map((_, i) => (i - periods >= 0 ? (source[i - periods] ?? null) : null));
}

export function lead(values: Series, periods = 1): NullableSeries {
  const source = toArray(values);
  return source.map((_, i) => (i + periods < source.length ? (source[i + periods] ?? null) : null));
}

export function diff(values: Series, periods = 1): NullableSeries {
  const source = toArray(values);
  return source.map((value, i) => {
    const previous = i - periods >= 0 ? (source[i - periods] ?? null) : null;
    return value === null || previous === null ? null : value - previous;
  });
}

export function cumulative(values: Series): NullableSeries {
  const source = toArray(values);
  let total = 0;
  let seen = false;
  return source.map((value) => {
    if (value === null) return seen ? total : null;
    seen = true;
    total += value;
    return total;
  });
}

interface RollingOptions {
  /** Rows required before a value is produced. Defaults to the full window. */
  minPeriods?: number;
}

function rolling(
  values: Series,
  window: number,
  reduce: (slice: number[]) => number,
  options: RollingOptions = {},
): NullableSeries {
  const source = toArray(values);
  const minPeriods = Math.max(1, options.minPeriods ?? window);
  const out: NullableSeries = new Array<number | null>(source.length).fill(null);
  const buffer: number[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const value = source[i] ?? null;
    if (value !== null) buffer.push(value);
    // The window is over rows, not over non null rows, so a blank gameweek
    // ages out of the window at the same rate as a played one.
    const from = Math.max(0, i - window + 1);
    const slice: number[] = [];
    for (let j = from; j <= i; j += 1) {
      const candidate = source[j] ?? null;
      if (candidate !== null) slice.push(candidate);
    }
    out[i] = slice.length >= minPeriods ? reduce(slice) : null;
  }
  return out;
}

export function rollingMean(
  values: Series,
  window: number,
  options: RollingOptions = {},
): NullableSeries {
  return rolling(values, window, (slice) => mean(slice), options);
}

export function rollingSum(
  values: Series,
  window: number,
  options: RollingOptions = {},
): NullableSeries {
  return rolling(
    values,
    window,
    (slice) => slice.reduce((total, value) => total + value, 0),
    options,
  );
}

export function rollingSd(
  values: Series,
  window: number,
  options: RollingOptions = {},
): NullableSeries {
  return rolling(values, window, (slice) => standardDeviation(slice), {
    minPeriods: 2,
    ...options,
  });
}

export function rollingMax(
  values: Series,
  window: number,
  options: RollingOptions = {},
): NullableSeries {
  return rolling(values, window, (slice) => Math.max(...slice), options);
}

export function rollingMin(
  values: Series,
  window: number,
  options: RollingOptions = {},
): NullableSeries {
  return rolling(values, window, (slice) => Math.min(...slice), options);
}

/**
 * Exponentially weighted mean by half life, which is the parameter a reader can
 * actually reason about: a half life of 3 means a gameweek six back counts a
 * quarter of the most recent one.
 */
export function ewma(values: Series, halfLife: number): NullableSeries {
  const source = toArray(values);
  const alpha = 1 - Math.exp(-Math.LN2 / Math.max(halfLife, 1e-9));
  let current: number | null = null;
  return source.map((value) => {
    if (value === null) return current;
    current = current === null ? value : alpha * value + (1 - alpha) * current;
    return current;
  });
}

/** Peak to trough decline of a cumulative series, the drawdown of a run of form. */
export function drawdown(values: Series): {
  series: NullableSeries;
  maxDrawdown: number;
  troughIndex: number;
} {
  const source = toArray(values);
  let peak = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;
  let troughIndex = -1;
  const out: NullableSeries = source.map((value, i) => {
    if (value === null) return null;
    if (value > peak) peak = value;
    const decline = value - peak;
    if (decline < maxDrawdown) {
      maxDrawdown = decline;
      troughIndex = i;
    }
    return decline;
  });
  return { series: out, maxDrawdown, troughIndex };
}

export interface HalfLifeResult {
  /** AR(1) coefficient. Above 1 means the series is not mean reverting at all. */
  phi: number;
  halfLife: number;
  /** Long run level the series reverts towards. */
  level: number;
  n: number;
}

/**
 * Mean reversion half life from an AR(1) fit. This is the number behind "form
 * is noise": fit it to points per gameweek and the half life is short enough
 * that a six week hot streak carries almost nothing into the next one.
 */
export function halfLife(values: Series): HalfLifeResult {
  const source = toArray(values).filter((value): value is number => value !== null);
  const n = source.length;
  if (n < 3) return { phi: Number.NaN, halfLife: Number.NaN, level: Number.NaN, n };

  const x = source.slice(0, -1);
  const y = source.slice(1);
  const mx = mean(x);
  const my = mean(y);
  let covariance = 0;
  let varianceX = 0;
  for (let i = 0; i < x.length; i += 1) {
    const dx = at(x, i) - mx;
    covariance += dx * (at(y, i) - my);
    varianceX += dx * dx;
  }
  const phi = varianceX === 0 ? Number.NaN : covariance / varianceX;
  const intercept = my - phi * mx;
  return {
    phi,
    halfLife: phi > 0 && phi < 1 ? -Math.LN2 / Math.log(phi) : Number.POSITIVE_INFINITY,
    level: phi === 1 ? Number.NaN : intercept / (1 - phi),
    n,
  };
}

export interface SeasonalityPoint {
  position: number;
  mean: number;
  count: number;
  /** Deviation from the overall mean, which is what makes a pattern visible. */
  effect: number;
}

/**
 * Average by position within a repeating period. With period 38 this answers
 * "are early gameweeks higher scoring than late ones", which they are.
 */
export function seasonality(values: Series, period: number): SeasonalityPoint[] {
  const source = toArray(values);
  const totals = new Float64Array(period);
  const counts = new Int32Array(period);
  let overall = 0;
  let overallCount = 0;
  source.forEach((value, i) => {
    if (value === null) return;
    const slot = i % period;
    totals[slot] = (totals[slot] ?? 0) + value;
    counts[slot] = (counts[slot] ?? 0) + 1;
    overall += value;
    overallCount += 1;
  });
  const grand = overallCount === 0 ? Number.NaN : overall / overallCount;
  return Array.from({ length: period }, (_, slot) => {
    const count = counts[slot] ?? 0;
    const value = count === 0 ? Number.NaN : (totals[slot] ?? 0) / count;
    return { position: slot, mean: value, count, effect: value - grand };
  });
}

export interface ChangePoint {
  index: number;
  before: number;
  after: number;
  /** Reduction in within segment variance the split buys. */
  gain: number;
}

/**
 * Binary segmentation on the mean. Applied to the archive it finds the seasons
 * where home advantage actually stepped down, rather than leaving a reader to
 * squint at a line.
 */
export function changePoints(
  values: Series,
  options: { maxPoints?: number; minSegment?: number } = {},
): ChangePoint[] {
  const source = toArray(values).filter((value): value is number => value !== null);
  const maxPoints = options.maxPoints ?? 3;
  const minSegment = Math.max(2, options.minSegment ?? 4);
  const found: ChangePoint[] = [];
  const segments: [number, number][] = [[0, source.length]];

  const cost = (from: number, to: number): number => {
    const slice = source.slice(from, to);
    if (slice.length < 2) return 0;
    return variance(slice) * (slice.length - 1);
  };

  while (found.length < maxPoints) {
    let best: { gain: number; index: number; segment: number } | null = null;
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const bounds = segments[segmentIndex];
      if (bounds === undefined) continue;
      const [from, to] = bounds;
      if (to - from < 2 * minSegment) continue;
      const total = cost(from, to);
      for (let split = from + minSegment; split <= to - minSegment; split += 1) {
        const gain = total - cost(from, split) - cost(split, to);
        if (best === null || gain > best.gain) best = { gain, index: split, segment: segmentIndex };
      }
    }
    if (best === null) break;
    const chosen = best;
    if (!(chosen.gain > 0)) break;
    const segment = segments[chosen.segment];
    if (segment === undefined) break;
    const [from, to] = segment;
    found.push({
      index: chosen.index,
      before: mean(source.slice(from, chosen.index)),
      after: mean(source.slice(chosen.index, to)),
      gain: chosen.gain,
    });
    segments.splice(chosen.segment, 1, [from, chosen.index], [chosen.index, to]);
  }

  return found.sort((a, b) => a.index - b.index);
}

/** Z score against the series' own mean and spread, for a normalised overlay. */
export function standardise(values: Series): NullableSeries {
  const source = toArray(values);
  const finite = source.filter((value): value is number => value !== null);
  const m = mean(finite);
  const sd = standardDeviation(finite);
  if (!(sd > 0)) return source.map(() => null);
  return source.map((value) => (value === null ? null : (value - m) / sd));
}

/**
 * Sharpe-like ratio of a return series: mean over standard deviation. In this
 * context "return" is points per gameweek, so it ranks consistency rather than
 * total, which is what a captaincy choice actually wants.
 */
export function informationRatio(values: Series, benchmark?: Series): number {
  const source = toArray(values);
  const excess: number[] = [];
  source.forEach((value, i) => {
    if (value === null) return;
    const reference = benchmark === undefined ? 0 : benchmark[i];
    const base =
      reference === null || reference === undefined || !Number.isFinite(reference) ? 0 : reference;
    excess.push(value - base);
  });
  const sd = standardDeviation(excess);
  return sd === 0 ? Number.NaN : mean(excess) / sd;
}

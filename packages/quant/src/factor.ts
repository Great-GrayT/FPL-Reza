/**
 * Factor evaluation: the machinery that decides whether a metric predicts
 * anything, rather than whether it looks impressive in a table. A factor is a
 * value per player per gameweek; a forward return is what that player scored
 * afterwards. Everything here compares the two without ever letting the second
 * inform the first.
 */
import { at, mean, quantileSorted, sorted, standardDeviation } from './internal.js';
import { spearman, pearson, type CorrelationMethod } from './corr.js';
import { tTestOneSample } from './hypothesis.js';
import { tTwoSided } from './special.js';

export interface FactorObservation {
  /** The unit being ranked. A player code, a team code, anything stable. */
  id: number;
  /** The period the factor was known in. Ranking happens within a period. */
  period: number;
  factor: number | null;
  /** What happened next. Never an input to the factor. */
  forward: number | null;
}

export interface IcPoint {
  period: number;
  ic: number;
  n: number;
}

export interface IcSummary {
  /** One coefficient per period, which is the series a reader should see. */
  series: IcPoint[];
  mean: number;
  sd: number;
  /** Mean over standard deviation: the information ratio of the signal itself. */
  informationRatio: number;
  /** t statistic of the mean IC against zero, and its p value. */
  t: number;
  pValue: number;
  /** Share of periods where the sign held. */
  hitRate: number;
  periods: number;
  method: CorrelationMethod;
}

function correlationFor(method: CorrelationMethod, x: number[], y: number[]): number {
  return method === 'pearson' ? pearson(x, y).r : spearman(x, y).r;
}

/**
 * Information coefficient: the cross sectional rank correlation between a
 * factor and the return that followed, computed period by period and then
 * summarised. Pooling every period into one correlation instead would let a few
 * high scoring gameweeks stand in for a signal that works every week.
 */
export function informationCoefficient(
  observations: FactorObservation[],
  options: { method?: CorrelationMethod; minPerPeriod?: number } = {},
): IcSummary {
  const method = options.method ?? 'spearman';
  const minPerPeriod = options.minPerPeriod ?? 10;

  const byPeriod = new Map<number, { factor: number[]; forward: number[] }>();
  for (const observation of observations) {
    if (observation.factor === null || observation.forward === null) continue;
    if (!Number.isFinite(observation.factor) || !Number.isFinite(observation.forward)) continue;
    const bucket = byPeriod.get(observation.period) ?? { factor: [], forward: [] };
    bucket.factor.push(observation.factor);
    bucket.forward.push(observation.forward);
    byPeriod.set(observation.period, bucket);
  }

  const series: IcPoint[] = [];
  for (const [period, bucket] of [...byPeriod.entries()].sort((a, b) => a[0] - b[0])) {
    if (bucket.factor.length < minPerPeriod) continue;
    const ic = correlationFor(method, bucket.factor, bucket.forward);
    if (!Number.isFinite(ic)) continue;
    series.push({ period, ic, n: bucket.factor.length });
  }

  const values = series.map((point) => point.ic);
  const m = mean(values);
  const sd = standardDeviation(values);
  const periods = values.length;
  const t = periods > 1 && sd > 0 ? (m * Math.sqrt(periods)) / sd : Number.NaN;
  const positive = values.filter((value) => value > 0).length;

  return {
    series,
    mean: m,
    sd,
    informationRatio: sd === 0 ? Number.NaN : m / sd,
    t,
    pValue: Number.isFinite(t) ? tTwoSided(t, periods - 1) : Number.NaN,
    hitRate: periods === 0 ? Number.NaN : (m >= 0 ? positive : periods - positive) / periods,
    periods,
    method,
  };
}

export interface DecayPoint {
  horizon: number;
  ic: number;
  informationRatio: number;
  periods: number;
}

/**
 * How far ahead a factor still predicts. The caller supplies forward returns at
 * each horizon, because only the caller knows how its panel is laid out.
 */
export function icDecay(
  byHorizon: { horizon: number; observations: FactorObservation[] }[],
  options: { method?: CorrelationMethod } = {},
): DecayPoint[] {
  return byHorizon
    .map(({ horizon, observations }) => {
      const summary = informationCoefficient(observations, options);
      return {
        horizon,
        ic: summary.mean,
        informationRatio: summary.informationRatio,
        periods: summary.periods,
      };
    })
    .sort((a, b) => a.horizon - b.horizon);
}

export interface QuantileBucket {
  bucket: number;
  meanFactor: number;
  meanForward: number;
  sdForward: number;
  count: number;
}

export interface QuantileSpread {
  buckets: QuantileBucket[];
  /** Top bucket minus bottom bucket, the number a long-short reader wants. */
  spread: number;
  t: number;
  pValue: number;
  /** Monotonicity: the rank correlation between bucket index and mean return. */
  monotonicity: number;
  periods: number;
}

/**
 * Sort into buckets within each period, then average the forward return per
 * bucket. Bucketing within a period, not across the pooled sample, is what
 * keeps a rising overall scoring level out of the result.
 */
export function quantileSpread(
  observations: FactorObservation[],
  bucketCount = 5,
  options: { minPerPeriod?: number } = {},
): QuantileSpread {
  const minPerPeriod = options.minPerPeriod ?? bucketCount * 2;
  const buckets = Math.max(2, Math.min(20, bucketCount));

  const factorSums = new Float64Array(buckets);
  const forwardSums = new Float64Array(buckets);
  const forwardSquares = new Float64Array(buckets);
  const counts = new Int32Array(buckets);
  const perPeriodSpread: number[] = [];

  const byPeriod = new Map<number, FactorObservation[]>();
  for (const observation of observations) {
    if (observation.factor === null || observation.forward === null) continue;
    if (!Number.isFinite(observation.factor) || !Number.isFinite(observation.forward)) continue;
    const bucket = byPeriod.get(observation.period) ?? [];
    bucket.push(observation);
    byPeriod.set(observation.period, bucket);
  }

  for (const rows of byPeriod.values()) {
    if (rows.length < minPerPeriod) continue;
    const ordered = [...rows].sort((a, b) => (a.factor ?? 0) - (b.factor ?? 0));
    let topTotal = 0;
    let topCount = 0;
    let bottomTotal = 0;
    let bottomCount = 0;

    ordered.forEach((row, index) => {
      const bucket = Math.min(buckets - 1, Math.floor((index / ordered.length) * buckets));
      const factor = row.factor ?? 0;
      const forward = row.forward ?? 0;
      factorSums[bucket] = (factorSums[bucket] ?? 0) + factor;
      forwardSums[bucket] = (forwardSums[bucket] ?? 0) + forward;
      forwardSquares[bucket] = (forwardSquares[bucket] ?? 0) + forward * forward;
      counts[bucket] = (counts[bucket] ?? 0) + 1;
      if (bucket === buckets - 1) {
        topTotal += forward;
        topCount += 1;
      }
      if (bucket === 0) {
        bottomTotal += forward;
        bottomCount += 1;
      }
    });

    if (topCount > 0 && bottomCount > 0) {
      perPeriodSpread.push(topTotal / topCount - bottomTotal / bottomCount);
    }
  }

  const summary: QuantileBucket[] = Array.from({ length: buckets }, (_, bucket) => {
    const count = counts[bucket] ?? 0;
    const meanForward = count === 0 ? Number.NaN : (forwardSums[bucket] ?? 0) / count;
    const meanSquare = count === 0 ? Number.NaN : (forwardSquares[bucket] ?? 0) / count;
    return {
      bucket,
      meanFactor: count === 0 ? Number.NaN : (factorSums[bucket] ?? 0) / count,
      meanForward,
      sdForward:
        count < 2 ? Number.NaN : Math.sqrt(Math.max(0, meanSquare - meanForward * meanForward)),
      count,
    };
  });

  const test = tTestOneSample(perPeriodSpread, 0);
  const monotonicity = spearman(
    summary.map((bucket) => bucket.bucket),
    summary.map((bucket) => bucket.meanForward),
  ).r;

  return {
    buckets: summary,
    spread: test.estimate,
    t: test.statistic,
    pValue: test.pValue,
    monotonicity,
    periods: perPeriodSpread.length,
  };
}

export interface TurnoverResult {
  /** Share of the top bucket replaced from one period to the next, averaged. */
  turnover: number;
  perPeriod: { period: number; turnover: number; size: number }[];
  /** Periods a member of the top bucket stays there, on average. */
  averageHoldingPeriods: number;
}

/**
 * What a factor costs to hold. A spread that only exists if the top bucket is
 * replaced every week is not a strategy in a game with a four point transfer
 * hit, and this is the number that says so.
 */
export function turnover(observations: FactorObservation[], bucketCount = 5): TurnoverResult {
  const byPeriod = new Map<number, FactorObservation[]>();
  for (const observation of observations) {
    if (observation.factor === null || !Number.isFinite(observation.factor)) continue;
    const bucket = byPeriod.get(observation.period) ?? [];
    bucket.push(observation);
    byPeriod.set(observation.period, bucket);
  }

  const periods = [...byPeriod.keys()].sort((a, b) => a - b);
  const topByPeriod = new Map<number, Set<number>>();
  for (const period of periods) {
    const rows = byPeriod.get(period) ?? [];
    if (rows.length < bucketCount) continue;
    const ordered = [...rows].sort((a, b) => (b.factor ?? 0) - (a.factor ?? 0));
    const size = Math.max(1, Math.floor(ordered.length / bucketCount));
    topByPeriod.set(period, new Set(ordered.slice(0, size).map((row) => row.id)));
  }

  const perPeriod: { period: number; turnover: number; size: number }[] = [];
  for (let i = 1; i < periods.length; i += 1) {
    const current = topByPeriod.get(periods[i] ?? -1);
    const previous = topByPeriod.get(periods[i - 1] ?? -1);
    if (current === undefined || previous === undefined || current.size === 0) continue;
    let kept = 0;
    for (const id of current) if (previous.has(id)) kept += 1;
    perPeriod.push({
      period: periods[i] ?? -1,
      turnover: 1 - kept / current.size,
      size: current.size,
    });
  }

  const average =
    perPeriod.length === 0 ? Number.NaN : mean(perPeriod.map((entry) => entry.turnover));
  return {
    turnover: average,
    perPeriod,
    averageHoldingPeriods: average > 0 ? 1 / average : Number.POSITIVE_INFINITY,
  };
}

/** Cross sectional z score within each period, the standard factor normalisation. */
export function zScoreByPeriod(observations: FactorObservation[]): FactorObservation[] {
  const byPeriod = new Map<number, number[]>();
  for (const observation of observations) {
    if (observation.factor === null || !Number.isFinite(observation.factor)) continue;
    const bucket = byPeriod.get(observation.period) ?? [];
    bucket.push(observation.factor);
    byPeriod.set(observation.period, bucket);
  }
  const stats = new Map<number, { mean: number; sd: number }>();
  for (const [period, values] of byPeriod) {
    stats.set(period, { mean: mean(values), sd: standardDeviation(values) });
  }
  return observations.map((observation) => {
    const stat = stats.get(observation.period);
    if (observation.factor === null || stat === undefined || !(stat.sd > 0)) {
      return { ...observation, factor: null };
    }
    return { ...observation, factor: (observation.factor - stat.mean) / stat.sd };
  });
}

/**
 * Rank normalisation within a period, mapped onto the normal quantiles. Robust
 * to the outliers a raw z score chases: one 24 point haul should not flatten
 * the rest of the cross section.
 */
export function rankNormaliseByPeriod(observations: FactorObservation[]): FactorObservation[] {
  const byPeriod = new Map<number, FactorObservation[]>();
  for (const observation of observations) {
    const bucket = byPeriod.get(observation.period) ?? [];
    bucket.push(observation);
    byPeriod.set(observation.period, bucket);
  }

  const out: FactorObservation[] = [];
  for (const rows of byPeriod.values()) {
    const usable = rows.filter((row) => row.factor !== null && Number.isFinite(row.factor));
    const ordered = [...usable].sort((a, b) => (a.factor ?? 0) - (b.factor ?? 0));
    const n = ordered.length;
    const rankById = new Map<number, number>();
    ordered.forEach((row, index) => {
      rankById.set(row.id, n <= 1 ? 0.5 : (index + 0.5) / n);
    });
    for (const row of rows) {
      const rank = rankById.get(row.id);
      out.push({ ...row, factor: rank ?? null });
    }
  }
  return out;
}

export interface FactorComparison {
  name: string;
  ic: number;
  informationRatio: number;
  spread: number;
  spreadT: number;
  turnover: number;
  monotonicity: number;
  periods: number;
}

/** Every factor scored the same way, so a table can rank them side by side. */
export function compareFactors(
  factors: { name: string; observations: FactorObservation[] }[],
  options: { buckets?: number; method?: CorrelationMethod } = {},
): FactorComparison[] {
  return factors
    .map(({ name, observations }) => {
      const ic = informationCoefficient(observations, options);
      const spread = quantileSpread(observations, options.buckets ?? 5);
      const held = turnover(observations, options.buckets ?? 5);
      return {
        name,
        ic: ic.mean,
        informationRatio: ic.informationRatio,
        spread: spread.spread,
        spreadT: spread.t,
        turnover: held.turnover,
        monotonicity: spread.monotonicity,
        periods: ic.periods,
      };
    })
    .sort((a, b) => Math.abs(b.ic) - Math.abs(a.ic));
}

/** Winsorise at symmetric percentiles: the standard defence against one bad row. */
export function winsorise(values: number[], tail = 0.01): number[] {
  const ascending = sorted(values.filter((value) => Number.isFinite(value)));
  if (ascending.length === 0) return values;
  const low = quantileSorted(ascending, tail);
  const high = quantileSorted(ascending, 1 - tail);
  return values.map((value) => (value < low ? low : value > high ? high : value));
}

export { at };

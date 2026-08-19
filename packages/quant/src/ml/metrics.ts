/**
 * Scoring a model. Regression and classification are kept apart because the
 * mistakes they let you make are different: an R squared on a rare event looks
 * excellent while the model predicts "no" every time, and an accuracy figure on
 * a 4 percent base rate is 96 percent before the model has learned anything.
 */
import { at, mean, sorted } from '../internal.js';

export interface RegressionMetrics {
  n: number;
  rmse: number;
  mae: number;
  /** Coefficient of determination against the mean of the actuals. */
  rSquared: number;
  /** Mean absolute error relative to always predicting the mean. Below 1 is useful. */
  skill: number;
  bias: number;
  /** Spearman correlation of prediction and outcome: the ranking quality alone. */
  rankCorrelation: number;
}

export function regressionMetrics(
  actual: ArrayLike<number>,
  predicted: ArrayLike<number>,
): RegressionMetrics {
  const pairs: { actual: number; predicted: number }[] = [];
  for (let i = 0; i < actual.length; i += 1) {
    const a = actual[i] ?? Number.NaN;
    const p = predicted[i] ?? Number.NaN;
    if (!Number.isFinite(a) || !Number.isFinite(p)) continue;
    pairs.push({ actual: a, predicted: p });
  }
  const n = pairs.length;
  if (n === 0) {
    const nan = Number.NaN;
    return {
      n: 0,
      rmse: nan,
      mae: nan,
      rSquared: nan,
      skill: nan,
      bias: nan,
      rankCorrelation: nan,
    };
  }

  const actualMean = mean(pairs.map((pair) => pair.actual));
  let squared = 0;
  let absolute = 0;
  let bias = 0;
  let totalVariance = 0;
  let baselineAbsolute = 0;
  for (const pair of pairs) {
    const error = pair.predicted - pair.actual;
    squared += error * error;
    absolute += Math.abs(error);
    bias += error;
    totalVariance += (pair.actual - actualMean) ** 2;
    baselineAbsolute += Math.abs(actualMean - pair.actual);
  }

  return {
    n,
    rmse: Math.sqrt(squared / n),
    mae: absolute / n,
    rSquared: totalVariance === 0 ? Number.NaN : 1 - squared / totalVariance,
    skill: baselineAbsolute === 0 ? Number.NaN : absolute / baselineAbsolute,
    bias: bias / n,
    rankCorrelation: rankCorrelation(
      pairs.map((pair) => pair.predicted),
      pairs.map((pair) => pair.actual),
    ),
  };
}

function rankCorrelation(x: number[], y: number[]): number {
  const rank = (values: number[]): number[] => {
    const order = values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value - b.value);
    const ranks = new Array<number>(values.length).fill(0);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && (order[j + 1]?.value ?? 0) === (order[i]?.value ?? 0)) j += 1;
      const shared = (i + j + 2) / 2;
      for (let k = i; k <= j; k += 1) ranks[order[k]?.index ?? 0] = shared;
      i = j + 1;
    }
    return ranks;
  };
  const rx = rank(x);
  const ry = rank(y);
  const mx = mean(rx);
  const my = mean(ry);
  let numerator = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i += 1) {
    const a = (rx[i] ?? 0) - mx;
    const b = (ry[i] ?? 0) - my;
    numerator += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx === 0 || dy === 0 ? Number.NaN : numerator / Math.sqrt(dx * dy);
}

export interface ClassificationMetrics {
  n: number;
  baseRate: number;
  logLoss: number;
  /** Mean squared error of the probability, which is the proper score to rank by. */
  brier: number;
  /** Brier skill against always predicting the base rate. Above 0 beats guessing. */
  brierSkill: number;
  auc: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  threshold: number;
  confusion: {
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
  };
}

export function classificationMetrics(
  actual: ArrayLike<number>,
  probability: ArrayLike<number>,
  threshold = 0.5,
): ClassificationMetrics {
  const pairs: { label: number; p: number }[] = [];
  for (let i = 0; i < actual.length; i += 1) {
    const label = actual[i] ?? Number.NaN;
    const p = probability[i] ?? Number.NaN;
    if (!Number.isFinite(label) || !Number.isFinite(p)) continue;
    pairs.push({ label: label > 0.5 ? 1 : 0, p: Math.min(Math.max(p, 0), 1) });
  }
  const n = pairs.length;
  if (n === 0) {
    const nan = Number.NaN;
    return {
      n: 0,
      baseRate: nan,
      logLoss: nan,
      brier: nan,
      brierSkill: nan,
      auc: nan,
      accuracy: nan,
      precision: nan,
      recall: nan,
      f1: nan,
      threshold,
      confusion: { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 },
    };
  }

  const baseRate = mean(pairs.map((pair) => pair.label));
  let logLoss = 0;
  let brier = 0;
  let baselineBrier = 0;
  const confusion = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };

  for (const pair of pairs) {
    const p = Math.min(Math.max(pair.p, 1e-12), 1 - 1e-12);
    logLoss -= pair.label * Math.log(p) + (1 - pair.label) * Math.log(1 - p);
    brier += (pair.p - pair.label) ** 2;
    baselineBrier += (baseRate - pair.label) ** 2;
    const predicted = pair.p >= threshold ? 1 : 0;
    if (predicted === 1 && pair.label === 1) confusion.truePositive += 1;
    else if (predicted === 1) confusion.falsePositive += 1;
    else if (pair.label === 1) confusion.falseNegative += 1;
    else confusion.trueNegative += 1;
  }

  const precision =
    confusion.truePositive + confusion.falsePositive === 0
      ? Number.NaN
      : confusion.truePositive / (confusion.truePositive + confusion.falsePositive);
  const recall =
    confusion.truePositive + confusion.falseNegative === 0
      ? Number.NaN
      : confusion.truePositive / (confusion.truePositive + confusion.falseNegative);

  return {
    n,
    baseRate,
    logLoss: logLoss / n,
    brier: brier / n,
    brierSkill: baselineBrier === 0 ? Number.NaN : 1 - brier / baselineBrier,
    auc: rocAuc(pairs),
    accuracy: (confusion.truePositive + confusion.trueNegative) / n,
    precision,
    recall,
    f1:
      Number.isFinite(precision) && Number.isFinite(recall) && precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : Number.NaN,
    threshold,
    confusion,
  };
}

/** AUC by the rank sum identity, which is exact and needs no curve integration. */
function rocAuc(pairs: { label: number; p: number }[]): number {
  const positives = pairs.filter((pair) => pair.label === 1).length;
  const negatives = pairs.length - positives;
  if (positives === 0 || negatives === 0) return Number.NaN;

  const order = [...pairs].sort((a, b) => a.p - b.p);
  const ranks = new Array<number>(order.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && (order[j + 1]?.p ?? 0) === (order[i]?.p ?? 0)) j += 1;
    const shared = (i + j + 2) / 2;
    for (let k = i; k <= j; k += 1) ranks[k] = shared;
    i = j + 1;
  }

  let rankSum = 0;
  order.forEach((pair, index) => {
    if (pair.label === 1) rankSum += ranks[index] ?? 0;
  });
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

export interface RocPoint {
  threshold: number;
  truePositiveRate: number;
  falsePositiveRate: number;
}

export function rocCurve(
  actual: ArrayLike<number>,
  probability: ArrayLike<number>,
  points = 50,
): RocPoint[] {
  const out: RocPoint[] = [];
  for (let i = 0; i <= points; i += 1) {
    const threshold = i / points;
    const metrics = classificationMetrics(actual, probability, threshold);
    const positives = metrics.confusion.truePositive + metrics.confusion.falseNegative;
    const negatives = metrics.confusion.trueNegative + metrics.confusion.falsePositive;
    out.push({
      threshold,
      truePositiveRate: positives === 0 ? Number.NaN : metrics.confusion.truePositive / positives,
      falsePositiveRate: negatives === 0 ? Number.NaN : metrics.confusion.falsePositive / negatives,
    });
  }
  return out;
}

export interface CalibrationBin {
  from: number;
  to: number;
  predicted: number;
  observed: number;
  count: number;
}

/**
 * Calibration: of the weeks a model called 30 percent, did roughly 30 percent
 * happen. A model can rank perfectly and still be uncalibrated, and a manager
 * making a captaincy decision needs the probability, not only the order.
 */
export function calibrationCurve(
  actual: ArrayLike<number>,
  probability: ArrayLike<number>,
  bins = 10,
): CalibrationBin[] {
  const buckets: { predicted: number[]; observed: number[] }[] = Array.from(
    { length: bins },
    () => ({
      predicted: [],
      observed: [],
    }),
  );
  for (let i = 0; i < actual.length; i += 1) {
    const label = actual[i] ?? Number.NaN;
    const p = probability[i] ?? Number.NaN;
    if (!Number.isFinite(label) || !Number.isFinite(p)) continue;
    const bucket = Math.min(bins - 1, Math.max(0, Math.floor(p * bins)));
    buckets[bucket]?.predicted.push(p);
    buckets[bucket]?.observed.push(label > 0.5 ? 1 : 0);
  }
  return buckets.map((bucket, index) => ({
    from: index / bins,
    to: (index + 1) / bins,
    predicted: bucket.predicted.length === 0 ? Number.NaN : mean(bucket.predicted),
    observed: bucket.observed.length === 0 ? Number.NaN : mean(bucket.observed),
    count: bucket.observed.length,
  }));
}

/** Lift by decile: what the top tenth of a ranking actually returned. */
export function liftByDecile(
  actual: ArrayLike<number>,
  predicted: ArrayLike<number>,
  deciles = 10,
): { decile: number; meanPredicted: number; meanActual: number; count: number }[] {
  const pairs: { actual: number; predicted: number }[] = [];
  for (let i = 0; i < actual.length; i += 1) {
    const a = actual[i] ?? Number.NaN;
    const p = predicted[i] ?? Number.NaN;
    if (Number.isFinite(a) && Number.isFinite(p)) pairs.push({ actual: a, predicted: p });
  }
  pairs.sort((left, right) => right.predicted - left.predicted);
  const size = Math.ceil(pairs.length / deciles);
  return Array.from({ length: deciles }, (_, index) => {
    const slice = pairs.slice(index * size, (index + 1) * size);
    return {
      decile: index + 1,
      meanPredicted: slice.length === 0 ? Number.NaN : mean(slice.map((pair) => pair.predicted)),
      meanActual: slice.length === 0 ? Number.NaN : mean(slice.map((pair) => pair.actual)),
      count: slice.length,
    };
  });
}

/** Residual quantiles, which is where a model's misses actually live. */
export function residualSummary(
  actual: ArrayLike<number>,
  predicted: ArrayLike<number>,
): {
  quantiles: { p: number; value: number }[];
  worst: { index: number; actual: number; predicted: number; error: number }[];
} {
  const residuals: { index: number; error: number; actual: number; predicted: number }[] = [];
  for (let i = 0; i < actual.length; i += 1) {
    const a = actual[i] ?? Number.NaN;
    const p = predicted[i] ?? Number.NaN;
    if (!Number.isFinite(a) || !Number.isFinite(p)) continue;
    residuals.push({ index: i, error: a - p, actual: a, predicted: p });
  }
  const ascending = sorted(residuals.map((residual) => residual.error));
  const quantileAt = (p: number): number => {
    if (ascending.length === 0) return Number.NaN;
    const position = Math.min(
      ascending.length - 1,
      Math.max(0, Math.round(p * (ascending.length - 1))),
    );
    return at(ascending, position);
  };
  return {
    quantiles: [0.05, 0.25, 0.5, 0.75, 0.95].map((p) => ({ p, value: quantileAt(p) })),
    worst: [...residuals]
      .sort((left, right) => Math.abs(right.error) - Math.abs(left.error))
      .slice(0, 10)
      .map((residual) => ({
        index: residual.index,
        actual: residual.actual,
        predicted: residual.predicted,
        error: residual.error,
      })),
  };
}

/**
 * Every metric for a task as a flat table of numbers, which is what a fold, a
 * permutation, or an importance pass compares on. The confusion matrix is
 * spread into its four counts so the whole record is numeric.
 */
export function scoreTable(
  actual: ArrayLike<number>,
  predicted: ArrayLike<number>,
  task: 'regression' | 'classification',
  threshold = 0.5,
): Record<string, number> {
  if (task === 'regression') {
    const metrics = regressionMetrics(actual, predicted);
    return {
      n: metrics.n,
      rmse: metrics.rmse,
      mae: metrics.mae,
      rSquared: metrics.rSquared,
      skill: metrics.skill,
      bias: metrics.bias,
      rankCorrelation: metrics.rankCorrelation,
    };
  }
  const metrics = classificationMetrics(actual, predicted, threshold);
  return {
    n: metrics.n,
    baseRate: metrics.baseRate,
    logLoss: metrics.logLoss,
    brier: metrics.brier,
    brierSkill: metrics.brierSkill,
    auc: metrics.auc,
    accuracy: metrics.accuracy,
    precision: metrics.precision,
    recall: metrics.recall,
    f1: metrics.f1,
    threshold: metrics.threshold,
    truePositive: metrics.confusion.truePositive,
    falsePositive: metrics.confusion.falsePositive,
    trueNegative: metrics.confusion.trueNegative,
    falseNegative: metrics.confusion.falseNegative,
  };
}

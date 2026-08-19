/**
 * Validation for data with a time axis.
 *
 * A k fold shuffle over a football panel trains on gameweek 30 and tests on
 * gameweek 12, which is not a test at all: the model has seen the future and
 * every score it reports is inflated. Every split here is forward only, and the
 * rows immediately either side of a boundary are purged, because a rolling
 * feature computed over the last six gameweeks spans that boundary.
 */
import { mean, standardDeviation } from '../internal.js';
import { createRng } from '../rng.js';
import { scoreTable } from './metrics.js';
import { selectRows, selectTargets, type Dataset, type Model, type RowIndex } from './types.js';

export interface Split {
  train: RowIndex;
  test: RowIndex;
  /** The period this fold tests on, for labelling. */
  period: number;
  purged: number;
}

export interface WalkForwardOptions {
  /** Periods held back before the first test fold. */
  minimumTrainPeriods?: number;
  /** Test periods per fold. */
  testPeriods?: number;
  /**
   * Periods dropped from the end of the training window. Set it to the longest
   * lookback any feature uses, otherwise a rolling mean leaks across the split.
   */
  embargoPeriods?: number;
  /** Expanding keeps every past period; rolling keeps a fixed window. */
  window?: 'expanding' | 'rolling';
  windowPeriods?: number;
}

/**
 * Forward chaining splits over an ordered period column. Fold n trains on
 * everything before period p (minus the embargo) and tests on p.
 */
export function walkForwardSplits(
  periods: ArrayLike<number>,
  options: WalkForwardOptions = {},
): Split[] {
  const minimumTrain = options.minimumTrainPeriods ?? 5;
  const testPeriods = Math.max(1, options.testPeriods ?? 1);
  const embargo = options.embargoPeriods ?? 0;
  const window = options.window ?? 'expanding';
  const windowPeriods = options.windowPeriods ?? 20;

  const byPeriod = new Map<number, number[]>();
  for (let i = 0; i < periods.length; i += 1) {
    const period = periods[i] ?? Number.NaN;
    if (!Number.isFinite(period)) continue;
    const bucket = byPeriod.get(period) ?? [];
    bucket.push(i);
    byPeriod.set(period, bucket);
  }
  const ordered = [...byPeriod.keys()].sort((a, b) => a - b);

  const splits: Split[] = [];
  for (let start = minimumTrain; start < ordered.length; start += testPeriods) {
    const testWindow = ordered.slice(start, start + testPeriods);
    if (testWindow.length === 0) break;
    const firstTest = testWindow[0] ?? 0;

    const trainPeriods = ordered
      .slice(0, start)
      .filter((period) => period <= firstTest - 1 - embargo);
    const kept =
      window === 'rolling'
        ? trainPeriods.slice(Math.max(0, trainPeriods.length - windowPeriods))
        : trainPeriods;
    if (kept.length === 0) continue;

    const train: number[] = [];
    for (const period of kept) train.push(...(byPeriod.get(period) ?? []));
    const test: number[] = [];
    for (const period of testWindow) test.push(...(byPeriod.get(period) ?? []));

    splits.push({
      train: Int32Array.from(train),
      test: Int32Array.from(test),
      period: firstTest,
      purged: ordered.slice(0, start).length - kept.length,
    });
  }
  return splits;
}

export interface FoldScore {
  period: number;
  trainRows: number;
  testRows: number;
  score: number;
  /** Every metric the task produces, so a caller is not limited to one number. */
  metrics: Record<string, number>;
}

export interface ValidationResult {
  folds: FoldScore[];
  mean: number;
  sd: number;
  /** Standard error of the mean fold score: the honest uncertainty on a backtest. */
  standardError: number;
  task: 'regression' | 'classification';
  metric: string;
}

export type Fitter = (dataset: Dataset, target: Float64Array) => Model;

/**
 * Fit once per fold and score out of sample. The fitter is a function rather
 * than a fitted model, because a validation that reuses one fitted model is
 * measuring nothing.
 */
export function crossValidate(
  dataset: Dataset,
  target: ArrayLike<number>,
  splits: Split[],
  fit: Fitter,
  options: { task?: 'regression' | 'classification'; metric?: string } = {},
): ValidationResult {
  const task = options.task ?? 'regression';
  const metric = options.metric ?? (task === 'regression' ? 'rmse' : 'auc');
  const folds: FoldScore[] = [];

  for (const split of splits) {
    const trainData = selectRows(dataset, split.train);
    const trainTarget = selectTargets(target, split.train);
    const model = fit(trainData, trainTarget);

    const testData = selectRows(dataset, split.test);
    const testTarget = selectTargets(target, split.test);
    const predictions = model.predict(testData);

    const metrics = scoreTable(testTarget, predictions, task);

    folds.push({
      period: split.period,
      trainRows: split.train.length,
      testRows: split.test.length,
      score: metrics[metric] ?? Number.NaN,
      metrics,
    });
  }

  const scores = folds.map((fold) => fold.score).filter((score) => Number.isFinite(score));
  const sd = standardDeviation(scores);
  return {
    folds,
    mean: mean(scores),
    sd,
    standardError: scores.length === 0 ? Number.NaN : sd / Math.sqrt(scores.length),
    task,
    metric,
  };
}

export interface LearningCurvePoint {
  trainRows: number;
  trainScore: number;
  testScore: number;
}

/**
 * Score against training set size. A gap that stays wide as rows are added is
 * variance (the model is memorising); two curves meeting at a poor score is
 * bias (the features do not carry the answer). The shape says which to fix.
 */
export function learningCurve(
  dataset: Dataset,
  target: ArrayLike<number>,
  split: Split,
  fit: Fitter,
  options: { shares?: number[]; task?: 'regression' | 'classification'; metric?: string } = {},
): LearningCurvePoint[] {
  const shares = options.shares ?? [0.1, 0.25, 0.5, 0.75, 1];
  const task = options.task ?? 'regression';
  const metric = options.metric ?? (task === 'regression' ? 'rmse' : 'auc');
  const testData = selectRows(dataset, split.test);
  const testTarget = selectTargets(target, split.test);

  return shares.map((share) => {
    // The tail of the training window is kept, not the head: recency is the
    // part a smaller sample should hold on to.
    const size = Math.max(2, Math.round(split.train.length * share));
    const rows = split.train.slice(split.train.length - size);
    const trainData = selectRows(dataset, rows);
    const trainTarget = selectTargets(target, rows);
    const model = fit(trainData, trainTarget);

    const scoreOf = (actual: Float64Array, predicted: Float64Array): number =>
      scoreTable(actual, predicted, task)[metric] ?? Number.NaN;

    return {
      trainRows: size,
      trainScore: scoreOf(trainTarget, model.predict(trainData)),
      testScore: scoreOf(testTarget, model.predict(testData)),
    };
  });
}

export interface PermutationNull {
  observed: number;
  nullMean: number;
  nullSd: number;
  pValue: number;
  runs: number;
  seed: number;
  verdict: string;
}

/**
 * Shuffle the target and refit. This is the only test that answers "is this
 * model better than nothing", and on a panel this size a gradient boosting run
 * will happily report a positive R squared on pure noise without it.
 */
export function permutationNull(
  dataset: Dataset,
  target: ArrayLike<number>,
  splits: Split[],
  fit: Fitter,
  options: {
    runs?: number;
    seed?: number;
    task?: 'regression' | 'classification';
    metric?: string;
    higherIsBetter?: boolean;
  } = {},
): PermutationNull {
  const runs = options.runs ?? 10;
  const seed = options.seed ?? 1;
  const task = options.task ?? 'regression';
  const metric = options.metric ?? (task === 'regression' ? 'rSquared' : 'auc');
  const higherIsBetter = options.higherIsBetter ?? true;
  const rng = createRng(seed);

  const observed = crossValidate(dataset, target, splits, fit, { task, metric }).mean;
  const draws: number[] = [];
  const shuffled = Float64Array.from(target);

  for (let run = 0; run < runs; run += 1) {
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = rng.int(i + 1);
      const swap = shuffled[i] ?? 0;
      shuffled[i] = shuffled[j] ?? 0;
      shuffled[j] = swap;
    }
    draws.push(crossValidate(dataset, shuffled, splits, fit, { task, metric }).mean);
  }

  const beaten = draws.filter((value) =>
    higherIsBetter ? value >= observed : value <= observed,
  ).length;
  const pValue = (beaten + 1) / (runs + 1);
  return {
    observed,
    nullMean: mean(draws),
    nullSd: standardDeviation(draws),
    pValue,
    runs,
    seed,
    verdict:
      pValue < 0.05
        ? 'the model beats a shuffled target'
        : 'the model is not distinguishable from a shuffled target',
  };
}

import {
  crossValidate,
  datasetFrom,
  fitGbm,
  leakageReport,
  permutationImportance,
  walkForwardSplits,
  type Dataset,
  type Model,
} from '@fpl/quant';
import { FEATURE_NAMES, type FeatureRow } from './features.js';
import { COMPONENTS, targetsFor, type ComponentName, type ComponentSpec } from './targets.js';

/**
 * Fitting, and the checks that decide whether a fit is worth shipping.
 *
 * Every component is validated forward only, on folds thinned evenly across the
 * period axis, and every one is compared against two baselines: a shuffled
 * target, which says whether the model beats chance, and the same model without
 * a named group of features, which says whether that group earned its place.
 * A component that fails the first is not shipped. A feature group that fails
 * the second is reported as not having earned its place, which is the whole
 * point of measuring it rather than assuming it.
 */

export interface TrainOptions {
  seed?: number;
  rounds?: number;
  learningRate?: number;
  maxDepth?: number;
  /** Folds to run. Each is a full refit, so this is the cost knob. */
  folds?: number;
  /** Feature groups to test by removal, by name prefix or exact name. */
  ablations?: Record<string, string[]>;
  /**
   * Components to run the removals on. Every removal is a second full
   * validation, so running them on all nine components triples the cost to
   * answer a question that is only asked of two or three of them.
   */
  ablationComponents?: ComponentName[];
}

export interface FoldScore {
  period: number;
  score: number;
  trainRows: number;
  testRows: number;
}

export interface Ablation {
  /** The group removed. */
  name: string;
  features: string[];
  /** Score without the group, on the same folds. */
  score: number;
  /** Score with it, repeated here so the pair reads on one line. */
  baseline: number;
  /** Positive means the group helped, in the direction the metric prefers. */
  gain: number;
  /** Whether the gain is larger than the spread across folds. */
  earned: boolean;
}

export interface ComponentFit {
  component: ComponentName;
  task: 'regression' | 'classification';
  description: string;
  rows: number;
  metric: string;
  /** Mean out of sample score across folds, and its standard error. */
  score: number;
  standardError: number;
  folds: FoldScore[];
  /** The same model fitted against a shuffled target, on the same folds. */
  nullScore: number;
  beatsNull: boolean;
  importances: { name: string; importance: number }[];
  leakage: { name: string; correlation: number; suspicious: boolean }[];
  ablations: Ablation[];
  seed: number;
  featureNames: string[];
  /** The fitted model, for scoring. Not serialised by this type. */
  model: Model;
}

const REGRESSION_METRIC = 'rSquared';
const CLASSIFICATION_METRIC = 'brierSkill';

/** Both metrics are "higher is better", which keeps every comparison one way up. */
function metricFor(task: 'regression' | 'classification'): string {
  return task === 'regression' ? REGRESSION_METRIC : CLASSIFICATION_METRIC;
}

function datasetOf(
  rows: readonly FeatureRow[],
  indexes: readonly number[],
  keep: number[],
): Dataset {
  return datasetFrom(
    keep.map((featureIndex) => ({
      name: FEATURE_NAMES[featureIndex] ?? `x${String(featureIndex)}`,
      values: Float64Array.from(
        indexes,
        (rowIndex) => rows[rowIndex]?.values[featureIndex] ?? Number.NaN,
      ),
    })),
  );
}

/** Feature indexes surviving a removal, matched by exact name or by prefix. */
function keepIndexes(remove: readonly string[] = []): number[] {
  return FEATURE_NAMES.map((_, index) => index).filter((index) => {
    const name = FEATURE_NAMES[index] ?? '';
    return !remove.some((pattern) => name === pattern || name.startsWith(pattern));
  });
}

export function fitComponent(
  spec: ComponentSpec,
  rows: readonly FeatureRow[],
  options: TrainOptions = {},
): ComponentFit | null {
  const seed = options.seed ?? 1;
  const targets = targetsFor(spec, rows);
  if (targets.rows.length < 500) return null;

  const periods = Int32Array.from(targets.rows, (index) => rows[index]?.period ?? 0);
  const allSplits = walkForwardSplits(periods, {
    minimumTrainPeriods: 12,
    testPeriods: 4,
    embargoPeriods: 1,
    window: 'rolling',
    windowPeriods: 76,
  });
  const maxFolds = options.folds ?? 8;
  const stride = Math.max(1, Math.ceil(allSplits.length / maxFolds));
  const splits = allSplits.filter((_, index) => index % stride === 0);
  if (splits.length === 0) return null;

  const fit = (data: Dataset, values: Float64Array): Model =>
    fitGbm(data, values, {
      loss: spec.task === 'classification' ? 'logistic' : 'squared',
      rounds: options.rounds ?? 60,
      learningRate: options.learningRate ?? 0.08,
      maxDepth: options.maxDepth ?? 4,
      subsample: 0.5,
      seed,
    });

  const metric = metricFor(spec.task);
  const keep = keepIndexes();
  const dataset = datasetOf(rows, targets.rows, keep);
  const validation = crossValidate(dataset, targets.values, splits, fit, {
    task: spec.task,
    metric,
  });

  // The null is the same model on a shuffled target. A component that cannot
  // beat it has found the base rate and nothing else.
  const shuffled = Float64Array.from(targets.values);
  let state = (seed * 2654435761) >>> 0;
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + i) >>> 0;
    const j = state % (i + 1);
    const swap = shuffled[i] ?? 0;
    shuffled[i] = shuffled[j] ?? 0;
    shuffled[j] = swap;
  }
  const nullValidation = crossValidate(dataset, shuffled, splits, fit, { task: spec.task, metric });

  const model = fit(dataset, targets.values);

  const ablations: Ablation[] = [];
  const ablateThis =
    options.ablationComponents === undefined || options.ablationComponents.includes(spec.name);
  for (const [name, features] of Object.entries(ablateThis ? (options.ablations ?? {}) : {})) {
    const without = keepIndexes(features);
    if (without.length === keep.length) continue;
    const reduced = datasetOf(rows, targets.rows, without);
    const scored = crossValidate(reduced, targets.values, splits, fit, { task: spec.task, metric });
    const gain = validation.mean - scored.mean;
    ablations.push({
      name,
      features: FEATURE_NAMES.filter((feature) =>
        features.some((pattern) => feature === pattern || feature.startsWith(pattern)),
      ),
      score: scored.mean,
      baseline: validation.mean,
      gain,
      // One fold's noise can be larger than a real gain, so the bar is that the
      // improvement exceeds the spread of the folds it was measured on.
      earned: gain > validation.standardError,
    });
  }

  return {
    component: spec.name,
    task: spec.task,
    description: spec.description,
    rows: targets.rows.length,
    metric,
    score: validation.mean,
    standardError: validation.standardError,
    folds: validation.folds.map((fold) => ({
      period: fold.period,
      score: fold.score,
      trainRows: fold.trainRows,
      testRows: fold.testRows,
    })),
    nullScore: nullValidation.mean,
    beatsNull: validation.mean > nullValidation.mean + validation.standardError,
    importances: (
      permutationImportance(model, dataset, targets.values, {
        repeats: 2,
        seed,
        task: spec.task,
      }) as { name: string; importance: number }[]
    ).slice(0, 12),
    leakage: leakageReport(dataset, targets.values)
      .slice(0, 5)
      .map((entry) => ({
        name: entry.name,
        correlation: entry.correlation,
        suspicious: entry.suspicious,
      })),
    ablations,
    seed,
    featureNames: keep.map((index) => FEATURE_NAMES[index] ?? ''),
    model,
  };
}

/** Every component, fitted and checked. A component that cannot be fitted is skipped. */
export function fitAll(rows: readonly FeatureRow[], options: TrainOptions = {}): ComponentFit[] {
  const fits: ComponentFit[] = [];
  for (const spec of COMPONENTS) {
    const fit = fitComponent(spec, rows, options);
    if (fit !== null) fits.push(fit);
  }
  return fits;
}

/**
 * The feature groups worth testing by removal.
 *
 * The shot origin group is here because it is the one whose value is genuinely
 * in question: it is an inference from a proxy, and the honest way to find out
 * whether it carries information is to fit the same model without it.
 */
export const DEFAULT_ABLATIONS: Record<string, string[]> = {
  'shot origin': ['shot_volume_per_90', 'implied_shot_quality', 'implied_shot_distance'],
  duels: ['duel_', 'slot_'],
  manager: ['manager_'],
  opposition: ['opponent_', 'strength_gap'],
  'expected goals': ['expectedGoals_', 'expectedAssists_', 'expected_goals_', 'expected_assists_'],
};

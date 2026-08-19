/**
 * Why a model said what it said.
 *
 * A boosted ensemble that ranks well and cannot be interrogated is worth less
 * here than a slightly worse model that can: a manager is going to act on the
 * output, and "the model likes him" is not a reason. All four methods below are
 * model agnostic, so they work on anything with a predict method.
 */
import { mean, standardDeviation } from '../internal.js';
import { createRng } from '../rng.js';
import { scoreTable } from './metrics.js';
import { columnOf, selectRows, type Dataset, type Model } from './types.js';

export interface Importance {
  name: string;
  /** Mean loss increase when this feature is shuffled. */
  importance: number;
  sd: number;
}

/**
 * Permutation importance: break one feature by shuffling it and see how much
 * worse the model gets. Unlike a tree's own gain it is measured out of sample
 * and on the metric the reader cares about, and it does not flatter a feature
 * that was split on often but usefully only once.
 */
export function permutationImportance(
  model: Model,
  dataset: Dataset,
  target: ArrayLike<number>,
  options: {
    repeats?: number;
    seed?: number;
    task?: 'regression' | 'classification';
    metric?: string;
  } = {},
): Importance[] {
  const repeats = options.repeats ?? 5;
  const seed = options.seed ?? 1;
  const task = options.task ?? 'regression';
  const metric = options.metric ?? (task === 'regression' ? 'rmse' : 'logLoss');
  const rng = createRng(seed);

  const scoreOf = (predictions: Float64Array): number =>
    scoreTable(target, predictions, task)[metric] ?? Number.NaN;

  const baseline = scoreOf(model.predict(dataset));

  return dataset.names
    .map((name, j) => {
      const original = Float64Array.from(columnOf(dataset, j));
      const drops: number[] = [];
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        const shuffled = Float64Array.from(original);
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const k = rng.int(i + 1);
          const swap = shuffled[i] ?? 0;
          shuffled[i] = shuffled[k] ?? 0;
          shuffled[k] = swap;
        }
        const values = Float64Array.from(dataset.values);
        values.set(shuffled, j * dataset.rows);
        drops.push(scoreOf(model.predict({ ...dataset, values })) - baseline);
      }
      return { name, importance: mean(drops), sd: standardDeviation(drops) };
    })
    .sort((left, right) => right.importance - left.importance);
}

export interface DependencePoint {
  value: number;
  prediction: number;
  /** Spread across rows at this value, which says whether the average is honest. */
  sd: number;
}

/**
 * Partial dependence: hold one feature at a value for every row, predict, and
 * average. It answers "what does the model do as this rises", and its known
 * weakness is stated rather than hidden: where two features are correlated it
 * evaluates combinations that never occur, so the tails are the least reliable
 * part of the curve.
 */
export function partialDependence(
  model: Model,
  dataset: Dataset,
  feature: string,
  options: { points?: number; sample?: number; seed?: number } = {},
): DependencePoint[] {
  const index = dataset.names.indexOf(feature);
  if (index < 0) return [];
  const points = Math.max(4, Math.min(40, options.points ?? 20));
  const sampleSize = Math.min(dataset.rows, options.sample ?? 2000);
  const rng = createRng(options.seed ?? 1);

  const rows = new Int32Array(sampleSize);
  for (let i = 0; i < sampleSize; i += 1)
    rows[i] = sampleSize === dataset.rows ? i : rng.int(dataset.rows);
  const sample = selectRows(dataset, rows);

  const column = columnOf(dataset, index);
  const finite = Array.from(column).filter((value) => Number.isFinite(value));
  if (finite.length === 0) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (!(max > min)) return [];

  return Array.from({ length: points }, (_, step) => {
    const value = min + ((max - min) * step) / (points - 1);
    const values = Float64Array.from(sample.values);
    values.fill(value, index * sample.rows, (index + 1) * sample.rows);
    const predictions = model.predict({ ...sample, values });
    return { value, prediction: mean(predictions), sd: standardDeviation(predictions) };
  });
}

export interface IceCurve {
  row: number;
  points: { value: number; prediction: number }[];
}

/**
 * Individual conditional expectation: the same sweep, one row at a time. Where
 * the individual curves fan out rather than moving together, the feature
 * interacts with something else and the averaged curve is hiding it.
 */
export function individualExpectation(
  model: Model,
  dataset: Dataset,
  feature: string,
  rows: number[],
  options: { points?: number } = {},
): IceCurve[] {
  const index = dataset.names.indexOf(feature);
  if (index < 0) return [];
  const points = Math.max(4, Math.min(40, options.points ?? 20));
  const column = columnOf(dataset, index);
  const finite = Array.from(column).filter((value) => Number.isFinite(value));
  if (finite.length === 0) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);

  return rows.map((row) => {
    const single = selectRows(dataset, Int32Array.from([row]));
    const curve = Array.from({ length: points }, (_, step) => {
      const value = min + ((max - min) * step) / (points - 1);
      const values = Float64Array.from(single.values);
      values[index] = value;
      return { value, prediction: model.predict({ ...single, values })[0] ?? Number.NaN };
    });
    return { row, points: curve };
  });
}

export interface Attribution {
  name: string;
  /** Contribution to this row's prediction, in the units of the prediction. */
  contribution: number;
}

export interface RowExplanation {
  row: number;
  prediction: number;
  /** The prediction the model makes with no feature information at all. */
  baseline: number;
  attributions: Attribution[];
  /** Draws used. These are sampled Shapley values, not exact ones. */
  samples: number;
  seed: number;
}

/**
 * Shapley values by Monte Carlo over feature permutations.
 *
 * Exact Shapley values need every subset, which is 2^k model calls. This samples
 * permutations instead and averages the marginal contribution of each feature as
 * it is revealed, which converges to the same numbers. It is labelled sampled
 * wherever it is shown, because a reader is entitled to know an attribution has
 * a standard error.
 */
export function shapleyValues(
  model: Model,
  dataset: Dataset,
  row: number,
  options: { samples?: number; seed?: number; background?: number } = {},
): RowExplanation {
  const samples = options.samples ?? 60;
  const seed = options.seed ?? 1;
  const backgroundSize = Math.min(dataset.rows, options.background ?? 100);
  const rng = createRng(seed);
  const k = dataset.columns;

  const backgroundRows = new Int32Array(backgroundSize);
  for (let i = 0; i < backgroundSize; i += 1) backgroundRows[i] = rng.int(dataset.rows);
  const background = selectRows(dataset, backgroundRows);

  const targetRow = new Float64Array(k);
  for (let j = 0; j < k; j += 1)
    targetRow[j] = dataset.values[j * dataset.rows + row] ?? Number.NaN;

  const predictSingle = (values: Float64Array): number => {
    const single: Dataset = { rows: 1, columns: k, values, names: dataset.names };
    return model.predict(single)[0] ?? Number.NaN;
  };

  const baselinePredictions = model.predict(background);
  const baseline = mean(baselinePredictions);
  const totals = new Float64Array(k);

  for (let sample = 0; sample < samples; sample += 1) {
    const order = Array.from({ length: k }, (_, j) => j);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = rng.int(i + 1);
      const swap = order[i] ?? 0;
      order[i] = order[j] ?? 0;
      order[j] = swap;
    }

    const reference = rng.int(backgroundSize);
    const current = new Float64Array(k);
    for (let j = 0; j < k; j += 1)
      current[j] = background.values[j * background.rows + reference] ?? Number.NaN;

    let previous = predictSingle(Float64Array.from(current));
    for (const feature of order) {
      current[feature] = targetRow[feature] ?? Number.NaN;
      const next = predictSingle(Float64Array.from(current));
      totals[feature] = (totals[feature] ?? 0) + (next - previous);
      previous = next;
    }
  }

  const prediction = predictSingle(Float64Array.from(targetRow));
  return {
    row,
    prediction,
    baseline,
    attributions: dataset.names
      .map((name, j) => ({ name, contribution: (totals[j] ?? 0) / samples }))
      .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution)),
    samples,
    seed,
  };
}

export interface Interaction {
  first: string;
  second: string;
  /** How much the joint effect exceeds the sum of the two separate effects. */
  strength: number;
}

/**
 * Pairwise interaction strength, Friedman's H in spirit: compare the two
 * dimensional partial dependence against the sum of the one dimensional ones.
 * Large values are where a linear model would go wrong.
 */
export function interactionStrength(
  model: Model,
  dataset: Dataset,
  pairs: [string, string][],
  options: { points?: number; sample?: number; seed?: number } = {},
): Interaction[] {
  const points = Math.max(3, Math.min(12, options.points ?? 6));
  const sampleSize = Math.min(dataset.rows, options.sample ?? 500);
  const rng = createRng(options.seed ?? 1);
  const rows = new Int32Array(sampleSize);
  for (let i = 0; i < sampleSize; i += 1) rows[i] = rng.int(dataset.rows);
  const sample = selectRows(dataset, rows);

  const gridFor = (name: string): { index: number; values: number[] } | null => {
    const index = dataset.names.indexOf(name);
    if (index < 0) return null;
    const column = Array.from(columnOf(dataset, index)).filter((value) => Number.isFinite(value));
    if (column.length === 0) return null;
    const min = Math.min(...column);
    const max = Math.max(...column);
    if (!(max > min)) return null;
    return {
      index,
      values: Array.from(
        { length: points },
        (_, step) => min + ((max - min) * step) / (points - 1),
      ),
    };
  };

  return pairs
    .map(([first, second]) => {
      const a = gridFor(first);
      const b = gridFor(second);
      if (a === null || b === null) return { first, second, strength: Number.NaN };

      const single = (grid: { index: number; values: number[] }): number[] =>
        grid.values.map((value) => {
          const values = Float64Array.from(sample.values);
          values.fill(value, grid.index * sample.rows, (grid.index + 1) * sample.rows);
          return mean(model.predict({ ...sample, values }));
        });

      const firstEffects = single(a);
      const secondEffects = single(b);
      const overall = mean(model.predict(sample));

      let total = 0;
      let count = 0;
      a.values.forEach((valueA, i) => {
        b.values.forEach((valueB, j) => {
          const values = Float64Array.from(sample.values);
          values.fill(valueA, a.index * sample.rows, (a.index + 1) * sample.rows);
          values.fill(valueB, b.index * sample.rows, (b.index + 1) * sample.rows);
          const joint = mean(model.predict({ ...sample, values }));
          const additive = (firstEffects[i] ?? overall) + (secondEffects[j] ?? overall) - overall;
          total += (joint - additive) ** 2;
          count += 1;
        });
      });

      const spread = standardDeviation(model.predict(sample));
      return {
        first,
        second,
        strength: count === 0 || spread === 0 ? Number.NaN : Math.sqrt(total / count) / spread,
      };
    })
    .sort((left, right) => (right.strength || 0) - (left.strength || 0));
}

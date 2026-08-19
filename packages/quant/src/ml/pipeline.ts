/**
 * Preprocessing, fitted on training rows only.
 *
 * The separation between fit and apply is the whole point of this file. A
 * standardiser fitted on the full panel and applied to a test fold has told the
 * model the mean of the future, and the backtest that follows is wrong by an
 * amount nobody can see.
 */
import { at, mean, quantileSorted, sorted, standardDeviation } from '../internal.js';
import { columnOf, type Dataset } from './types.js';

export type ImputeStrategy = 'mean' | 'median' | 'zero' | 'keep';

export interface Preprocessor {
  /** Column statistics learned from the training rows. */
  centres: Float64Array;
  scales: Float64Array;
  fills: Float64Array;
  names: string[];
  standardise: boolean;
  impute: ImputeStrategy;
  /** Columns dropped for having no variation at all in training. */
  dropped: string[];
  apply(dataset: Dataset): Dataset;
}

export function fitPreprocessor(
  dataset: Dataset,
  options: { standardise?: boolean; impute?: ImputeStrategy; dropConstant?: boolean } = {},
): Preprocessor {
  const standardise = options.standardise ?? true;
  const impute = options.impute ?? 'median';
  const dropConstant = options.dropConstant ?? false;

  const centres = new Float64Array(dataset.columns);
  const scales = new Float64Array(dataset.columns).fill(1);
  const fills = new Float64Array(dataset.columns);
  const dropped: string[] = [];

  for (let j = 0; j < dataset.columns; j += 1) {
    const column = columnOf(dataset, j);
    const finite: number[] = [];
    for (const value of column) {
      if (Number.isFinite(value)) finite.push(value);
    }
    const columnMean = finite.length === 0 ? 0 : mean(finite);
    const columnSd = finite.length < 2 ? 0 : standardDeviation(finite);
    centres[j] = columnMean;
    scales[j] = columnSd > 0 ? columnSd : 1;
    fills[j] =
      impute === 'zero'
        ? 0
        : impute === 'mean'
          ? columnMean
          : impute === 'median'
            ? quantileSorted(sorted(finite), 0.5)
            : Number.NaN;
    if (dropConstant && columnSd === 0) dropped.push(dataset.names[j] ?? `x${j}`);
  }

  const keep = dataset.names
    .map((name, j) => ({ name, j }))
    .filter((entry) => !dropped.includes(entry.name));

  return {
    centres,
    scales,
    fills,
    names: dataset.names,
    standardise,
    impute,
    dropped,
    apply(other: Dataset): Dataset {
      const values = new Float64Array(other.rows * keep.length);
      keep.forEach((entry, target) => {
        // Columns are matched by name, so applying to a frame whose column
        // order differs cannot silently scale the wrong feature.
        const source = other.names.indexOf(entry.name);
        for (let i = 0; i < other.rows; i += 1) {
          let value =
            source < 0 ? Number.NaN : (other.values[source * other.rows + i] ?? Number.NaN);
          if (!Number.isFinite(value) && impute !== 'keep') value = fills[entry.j] ?? 0;
          if (standardise && Number.isFinite(value)) {
            value = (value - (centres[entry.j] ?? 0)) / (scales[entry.j] ?? 1);
          }
          values[target * other.rows + i] = value;
        }
      });
      return {
        rows: other.rows,
        columns: keep.length,
        values,
        names: keep.map((entry) => entry.name),
      };
    },
  };
}

/**
 * One hot encoding of a label column. The last level is kept rather than
 * dropped: trees do not need a reference level, and a caller fitting a linear
 * model can drop one column itself.
 */
export function oneHot(
  labels: (string | null)[],
  name: string,
  levels?: string[],
): { name: string; values: Float64Array }[] {
  const seen =
    levels ?? [...new Set(labels.filter((label): label is string => label !== null))].sort();
  return seen.map((level) => ({
    name: `${name}=${level}`,
    values: Float64Array.from(labels, (label) =>
      label === null ? Number.NaN : label === level ? 1 : 0,
    ),
  }));
}

/** Winsorise each column at its training quantiles, so one bad row cannot dominate. */
export function fitClipper(
  dataset: Dataset,
  tail = 0.01,
): { apply(other: Dataset): Dataset; bounds: { name: string; low: number; high: number }[] } {
  const bounds = dataset.names.map((name, j) => {
    const ascending = sorted(
      Array.from(columnOf(dataset, j)).filter((value) => Number.isFinite(value)),
    );
    return {
      name,
      low: ascending.length === 0 ? Number.NEGATIVE_INFINITY : quantileSorted(ascending, tail),
      high: ascending.length === 0 ? Number.POSITIVE_INFINITY : quantileSorted(ascending, 1 - tail),
    };
  });

  return {
    bounds,
    apply(other: Dataset): Dataset {
      const values = Float64Array.from(other.values);
      other.names.forEach((name, j) => {
        const bound = bounds.find((entry) => entry.name === name);
        if (bound === undefined) return;
        for (let i = 0; i < other.rows; i += 1) {
          const index = j * other.rows + i;
          const value = values[index] ?? Number.NaN;
          if (!Number.isFinite(value)) continue;
          values[index] = Math.min(Math.max(value, bound.low), bound.high);
        }
      });
      return { ...other, values };
    },
  };
}

/** Balance a binary target by weighting, so a 4 percent event is still learnable. */
export function classWeights(target: ArrayLike<number>): { positive: number; negative: number } {
  let positives = 0;
  let total = 0;
  for (const value of Array.from(target)) {
    if (!Number.isFinite(value)) continue;
    total += 1;
    if (value > 0.5) positives += 1;
  }
  const negatives = total - positives;
  if (positives === 0 || negatives === 0) return { positive: 1, negative: 1 };
  return { positive: total / (2 * positives), negative: total / (2 * negatives) };
}

export { at };

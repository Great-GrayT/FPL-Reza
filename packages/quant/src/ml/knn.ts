/**
 * Nearest neighbours over a standardised feature space.
 *
 * It is here for two jobs. As a model it is the baseline a fancier one has to
 * beat, and as a search it answers the question every reader of a player page
 * actually has: who else is like this, and what happened to them next.
 */
import { mean } from '../internal.js';
import { fitPreprocessor, type Preprocessor } from './pipeline.js';
import { rowOf, type Dataset, type Model } from './types.js';

export interface KnnOptions {
  k?: number;
  /** Inverse distance weighting, which stops a distant neighbour voting equally. */
  weighted?: boolean;
  /** Per feature multipliers, for a search that should care more about some. */
  weights?: Record<string, number>;
}

export interface KnnModel extends Model {
  kind: 'knn';
  k: number;
  preprocessor: Preprocessor;
  /** Standardised training rows, kept because this model is its training set. */
  reference: Dataset;
  targets: Float64Array;
  neighboursOf(row: ArrayLike<number>, count?: number): { index: number; distance: number }[];
}

export function fitKnn(
  dataset: Dataset,
  target: ArrayLike<number>,
  options: KnnOptions = {},
): KnnModel {
  const k = Math.max(1, options.k ?? 10);
  const weighted = options.weighted ?? true;
  const preprocessor = fitPreprocessor(dataset, { standardise: true, impute: 'median' });
  const reference = preprocessor.apply(dataset);
  const targets = Float64Array.from(target);

  const scale = new Float64Array(reference.columns).fill(1);
  reference.names.forEach((name, j) => {
    scale[j] = options.weights?.[name] ?? 1;
  });

  const distances = (row: Float64Array): { index: number; distance: number }[] => {
    const out: { index: number; distance: number }[] = [];
    for (let i = 0; i < reference.rows; i += 1) {
      let total = 0;
      let counted = 0;
      for (let j = 0; j < reference.columns; j += 1) {
        const a = reference.values[j * reference.rows + i] ?? Number.NaN;
        const b = row[j] ?? Number.NaN;
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const difference = (a - b) * (scale[j] ?? 1);
        total += difference * difference;
        counted += 1;
      }
      // Distance is scaled by how many features were actually comparable, so a
      // row missing half its measures is not closest to everything by default.
      out.push({
        index: i,
        distance:
          counted === 0
            ? Number.POSITIVE_INFINITY
            : Math.sqrt((total * reference.columns) / counted),
      });
    }
    return out.sort((left, right) => left.distance - right.distance);
  };

  return {
    kind: 'knn',
    k,
    preprocessor,
    reference,
    targets,
    neighboursOf(row, count = k) {
      const standardised = preprocessor.apply({
        rows: 1,
        columns: dataset.columns,
        values: Float64Array.from(row),
        names: dataset.names,
      });
      return distances(Float64Array.from(standardised.values)).slice(0, count);
    },
    predict(other: Dataset): Float64Array {
      const standardised = preprocessor.apply(other);
      const out = new Float64Array(other.rows);
      for (let i = 0; i < standardised.rows; i += 1) {
        const row = rowOf(standardised, i);
        const neighbours = distances(row).slice(0, k);
        if (!weighted) {
          out[i] = mean(neighbours.map((neighbour) => targets[neighbour.index] ?? Number.NaN));
          continue;
        }
        let weightTotal = 0;
        let valueTotal = 0;
        for (const neighbour of neighbours) {
          const value = targets[neighbour.index] ?? Number.NaN;
          if (!Number.isFinite(value)) continue;
          const weight = 1 / (neighbour.distance + 1e-9);
          weightTotal += weight;
          valueTotal += weight * value;
        }
        out[i] = weightTotal === 0 ? Number.NaN : valueTotal / weightTotal;
      }
      return out;
    },
    importances() {
      // Distance based models have no native notion of importance; permutation
      // importance answers the question honestly instead of inventing one.
      return null;
    },
  };
}

export interface Similar {
  index: number;
  distance: number;
  /** Similarity on a 0 to 1 scale, for display. */
  similarity: number;
}

/** The k rows most like a given one, which is the "players like this" search. */
export function similarRows(model: KnnModel, row: ArrayLike<number>, count = 10): Similar[] {
  const neighbours = model
    .neighboursOf(row, count + 1)
    .filter((neighbour) => neighbour.distance > 0);
  const furthest = neighbours[neighbours.length - 1]?.distance ?? 1;
  return neighbours.slice(0, count).map((neighbour) => ({
    index: neighbour.index,
    distance: neighbour.distance,
    similarity: furthest === 0 ? 1 : Math.max(0, 1 - neighbour.distance / (furthest * 1.2)),
  }));
}

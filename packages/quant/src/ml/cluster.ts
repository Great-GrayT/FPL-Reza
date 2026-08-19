/**
 * Unsupervised structure: k means for archetypes, principal components for the
 * shape of the metric space itself.
 *
 * Both answer a question a ranking cannot. "Which players group together" is
 * not "who scores most", and the second principal component of this panel is
 * usually the axis separating a creator from a finisher, which no single column
 * expresses on its own.
 */
import { at, mean, standardDeviation } from '../internal.js';
import { createRng } from '../rng.js';
import { columnOf, rowOf, type Dataset } from './types.js';

export interface Clustering {
  /** Cluster index per row. */
  assignments: Int32Array;
  /** Centre per cluster, in the standardised space the fit ran in. */
  centres: number[][];
  sizes: number[];
  /** Within cluster sum of squares: lower is tighter, and always falls with k. */
  inertia: number;
  /** Mean silhouette: how separated the clusters are, from minus one to one. */
  silhouette: number;
  iterations: number;
  k: number;
  seed: number;
  names: string[];
}

/** k means++ seeding, then Lloyd iterations until the assignments settle. */
export function kmeans(
  dataset: Dataset,
  k: number,
  options: { maxIterations?: number; seed?: number; sampleForSilhouette?: number } = {},
): Clustering {
  const maxIterations = options.maxIterations ?? 50;
  const seed = options.seed ?? 1;
  const rng = createRng(seed);
  const n = dataset.rows;
  const clusters = Math.max(1, Math.min(k, n));

  const rows: Float64Array[] = [];
  for (let i = 0; i < n; i += 1) rows.push(rowOf(dataset, i));

  const distance = (a: Float64Array, b: readonly number[]): number => {
    let total = 0;
    for (let j = 0; j < a.length; j += 1) {
      const left = a[j] ?? Number.NaN;
      const right = b[j] ?? Number.NaN;
      if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
      total += (left - right) ** 2;
    }
    return total;
  };

  // k means++: the first centre is random, each next one is drawn in proportion
  // to its distance from the nearest chosen centre, which avoids the degenerate
  // starts a uniform draw produces on clustered data.
  const centres: number[][] = [];
  const firstRow = rows[rng.int(n)];
  centres.push(Array.from(firstRow ?? new Float64Array(dataset.columns)));
  while (centres.length < clusters) {
    const weights = rows.map((row) => Math.min(...centres.map((centre) => distance(row, centre))));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let draw = rng.next() * total;
    let chosen = 0;
    for (let i = 0; i < weights.length; i += 1) {
      draw -= weights[i] ?? 0;
      if (draw <= 0) {
        chosen = i;
        break;
      }
    }
    centres.push(Array.from(rows[chosen] ?? new Float64Array(dataset.columns)));
  }

  const assignments = new Int32Array(n).fill(-1);
  let iterations = 0;
  for (; iterations < maxIterations; iterations += 1) {
    let moved = 0;
    for (let i = 0; i < n; i += 1) {
      const row = rows[i];
      if (row === undefined) continue;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      centres.forEach((centre, index) => {
        const d = distance(row, centre);
        if (d < bestDistance) {
          bestDistance = d;
          best = index;
        }
      });
      if (assignments[i] !== best) moved += 1;
      assignments[i] = best;
    }

    const sums = centres.map(() => new Float64Array(dataset.columns));
    const counts = new Int32Array(centres.length);
    for (let i = 0; i < n; i += 1) {
      const cluster = assignments[i] ?? 0;
      const row = rows[i];
      const sum = sums[cluster];
      if (row === undefined || sum === undefined) continue;
      for (let j = 0; j < dataset.columns; j += 1) {
        const value = row[j] ?? Number.NaN;
        if (Number.isFinite(value)) sum[j] = (sum[j] ?? 0) + value;
      }
      counts[cluster] = (counts[cluster] ?? 0) + 1;
    }
    centres.forEach((centre, index) => {
      const count = counts[index] ?? 0;
      if (count === 0) return;
      for (let j = 0; j < dataset.columns; j += 1) {
        centre[j] = (sums[index]?.[j] ?? 0) / count;
      }
    });

    if (moved === 0) break;
  }

  let inertia = 0;
  const sizes = new Array<number>(centres.length).fill(0);
  for (let i = 0; i < n; i += 1) {
    const cluster = assignments[i] ?? 0;
    const row = rows[i];
    const centre = centres[cluster];
    if (row === undefined || centre === undefined) continue;
    inertia += distance(row, centre);
    sizes[cluster] = (sizes[cluster] ?? 0) + 1;
  }

  return {
    assignments,
    centres,
    sizes,
    inertia,
    silhouette: silhouetteScore(
      rows,
      assignments,
      centres.length,
      options.sampleForSilhouette ?? 500,
      seed,
    ),
    iterations,
    k: centres.length,
    seed,
    names: dataset.names,
  };
}

/**
 * Silhouette on a sample. The full computation is O(n squared) and the score is
 * a mean, so a bounded sample gives the same answer at a fraction of the cost.
 */
function silhouetteScore(
  rows: Float64Array[],
  assignments: Int32Array,
  clusters: number,
  sampleSize: number,
  seed: number,
): number {
  if (clusters < 2 || rows.length < 3) return Number.NaN;
  const rng = createRng(seed + 1);
  const sample: number[] = [];
  const size = Math.min(sampleSize, rows.length);
  for (let i = 0; i < size; i += 1) sample.push(size === rows.length ? i : rng.int(rows.length));

  const euclidean = (a: Float64Array, b: Float64Array): number => {
    let total = 0;
    for (let j = 0; j < a.length; j += 1) {
      const left = a[j] ?? Number.NaN;
      const right = b[j] ?? Number.NaN;
      if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
      total += (left - right) ** 2;
    }
    return Math.sqrt(total);
  };

  const scores: number[] = [];
  for (const i of sample) {
    const row = rows[i];
    if (row === undefined) continue;
    const own = assignments[i] ?? 0;
    const totals = new Float64Array(clusters);
    const counts = new Int32Array(clusters);
    for (const j of sample) {
      if (j === i) continue;
      const other = rows[j];
      if (other === undefined) continue;
      const cluster = assignments[j] ?? 0;
      totals[cluster] = (totals[cluster] ?? 0) + euclidean(row, other);
      counts[cluster] = (counts[cluster] ?? 0) + 1;
    }
    const inside = (counts[own] ?? 0) === 0 ? Number.NaN : (totals[own] ?? 0) / (counts[own] ?? 1);
    let nearest = Number.POSITIVE_INFINITY;
    for (let cluster = 0; cluster < clusters; cluster += 1) {
      if (cluster === own || (counts[cluster] ?? 0) === 0) continue;
      nearest = Math.min(nearest, (totals[cluster] ?? 0) / (counts[cluster] ?? 1));
    }
    if (!Number.isFinite(inside) || !Number.isFinite(nearest)) continue;
    scores.push((nearest - inside) / Math.max(inside, nearest));
  }
  return scores.length === 0 ? Number.NaN : mean(scores);
}

/** Inertia and silhouette across a range of k, which is how k gets chosen. */
export function clusterSweep(
  dataset: Dataset,
  range: number[],
  options: { seed?: number } = {},
): { k: number; inertia: number; silhouette: number }[] {
  return range.map((k) => {
    const result = kmeans(dataset, k, options);
    return { k, inertia: result.inertia, silhouette: result.silhouette };
  });
}

export interface PrincipalComponents {
  /** Eigenvector per component, in the order the columns were given. */
  loadings: number[][];
  /** Share of total variance each component carries. */
  explained: number[];
  cumulative: number[];
  /** Each row projected onto the components. */
  scores: number[][];
  names: string[];
  centres: Float64Array;
  scales: Float64Array;
}

/**
 * Principal components by Jacobi rotation of the correlation matrix.
 *
 * The correlation matrix rather than the covariance one, because these columns
 * are in wildly different units (minutes, tenths of a million, a share) and a
 * covariance PCA would simply find whichever column has the largest numbers.
 */
export function pca(dataset: Dataset, components = 2): PrincipalComponents {
  const k = dataset.columns;
  const centres = new Float64Array(k);
  const scales = new Float64Array(k).fill(1);
  const standardised: Float64Array[] = [];

  for (let j = 0; j < k; j += 1) {
    const column = Array.from(columnOf(dataset, j)).filter((value) => Number.isFinite(value));
    centres[j] = column.length === 0 ? 0 : mean(column);
    const sd = column.length < 2 ? 0 : standardDeviation(column);
    scales[j] = sd > 0 ? sd : 1;
  }
  for (let i = 0; i < dataset.rows; i += 1) {
    const row = rowOf(dataset, i);
    const scaled = new Float64Array(k);
    for (let j = 0; j < k; j += 1) {
      const value = row[j] ?? Number.NaN;
      scaled[j] = Number.isFinite(value) ? (value - (centres[j] ?? 0)) / (scales[j] ?? 1) : 0;
    }
    standardised.push(scaled);
  }

  const covariance: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (const row of standardised) {
    for (let a = 0; a < k; a += 1) {
      for (let b = 0; b < k; b += 1) {
        const target = covariance[a];
        if (target === undefined) continue;
        target[b] = (target[b] ?? 0) + (row[a] ?? 0) * (row[b] ?? 0);
      }
    }
  }
  const denominator = Math.max(1, dataset.rows - 1);
  for (const row of covariance) {
    for (let b = 0; b < k; b += 1) row[b] = (row[b] ?? 0) / denominator;
  }

  const { values, vectors } = jacobiEigen(covariance, k);
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => right.value - left.value)
    .slice(0, Math.max(1, Math.min(components, k)));

  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  const loadings = order.map((entry) => vectors.map((row) => row[entry.index] ?? 0));
  const explained = order.map((entry) => (total === 0 ? Number.NaN : entry.value / total));

  const scores = standardised.map((row) =>
    loadings.map((loading) => loading.reduce((sum, weight, j) => sum + weight * (row[j] ?? 0), 0)),
  );

  let running = 0;
  const cumulative = explained.map((share) => {
    running += share;
    return running;
  });

  return { loadings, explained, cumulative, scores, names: dataset.names, centres, scales };
}

/** Symmetric eigen decomposition by cyclic Jacobi rotations. */
function jacobiEigen(matrix: number[][], size: number): { values: number[]; vectors: number[][] } {
  const a = matrix.map((row) => [...row]);
  const v: number[][] = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => (i === j ? 1 : 0)),
  );

  for (let sweep = 0; sweep < 100; sweep += 1) {
    let off = 0;
    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) off += (a[p]?.[q] ?? 0) ** 2;
    }
    if (off < 1e-12) break;

    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) {
        const apq = a[p]?.[q] ?? 0;
        if (Math.abs(apq) < 1e-15) continue;
        const app = a[p]?.[p] ?? 0;
        const aqq = a[q]?.[q] ?? 0;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        for (let i = 0; i < size; i += 1) {
          const aip = a[i]?.[p] ?? 0;
          const aiq = a[i]?.[q] ?? 0;
          const rowI = a[i];
          if (rowI === undefined) continue;
          rowI[p] = c * aip - s * aiq;
          rowI[q] = s * aip + c * aiq;
        }
        for (let i = 0; i < size; i += 1) {
          const api = a[p]?.[i] ?? 0;
          const aqi = a[q]?.[i] ?? 0;
          const rowP = a[p];
          const rowQ = a[q];
          if (rowP === undefined || rowQ === undefined) continue;
          rowP[i] = c * api - s * aqi;
          rowQ[i] = s * api + c * aqi;
        }
        for (let i = 0; i < size; i += 1) {
          const vip = v[i]?.[p] ?? 0;
          const viq = v[i]?.[q] ?? 0;
          const rowI = v[i];
          if (rowI === undefined) continue;
          rowI[p] = c * vip - s * viq;
          rowI[q] = s * vip + c * viq;
        }
      }
    }
  }

  return { values: Array.from({ length: size }, (_, i) => at([a[i]?.[i] ?? 0], 0)), vectors: v };
}

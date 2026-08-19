/**
 * A random forest: bagged trees, each seeing a bootstrap sample of the rows and
 * a random subset of the features at every split.
 *
 * It earns its place next to boosting for one reason: the out of bag error is a
 * validation score that costs nothing and cannot leak, because each row is
 * scored only by the trees that never saw it.
 */
import { mean } from '../internal.js';
import { createRng } from '../rng.js';
import { binFeatures, growTree, predictRow, type Tree } from './tree.js';
import type { Dataset, Model } from './types.js';

export interface ForestOptions {
  trees?: number;
  maxDepth?: number;
  minSamplesLeaf?: number;
  /** Share of features considered at each split. The default is the usual sqrt rule. */
  featureShare?: number;
  binCount?: number;
  seed?: number;
  /** Rows drawn per tree, as a share of the training set. */
  sampleShare?: number;
}

export interface ForestModel extends Model {
  kind: 'forest';
  trees: Tree[];
  edges: number[][];
  binCount: number;
  names: string[];
  /** Mean squared error over rows scored only by trees that did not see them. */
  outOfBagError: number;
  outOfBagCoverage: number;
}

export function fitForest(
  dataset: Dataset,
  target: ArrayLike<number>,
  options: ForestOptions = {},
): ForestModel {
  const treeCount = options.trees ?? 100;
  const binCount = options.binCount ?? 64;
  const seed = options.seed ?? 1;
  const sampleShare = Math.min(1, Math.max(0.1, options.sampleShare ?? 1));
  const featureShare =
    options.featureShare ??
    Math.min(1, Math.max(0.1, Math.sqrt(dataset.columns) / Math.max(1, dataset.columns)));
  const rng = createRng(seed);

  const binned = binFeatures(dataset, binCount);
  const n = dataset.rows;

  // The tree builder minimises a gradient, so a leaf holding the mean of its
  // rows is the squared loss gradient taken from a zero prediction.
  const gradient = new Float64Array(n);
  const hessian = new Float64Array(n).fill(1);
  for (let i = 0; i < n; i += 1) gradient[i] = -(target[i] ?? 0);

  const trees: Tree[] = [];
  const oobTotals = new Float64Array(n);
  const oobCounts = new Int32Array(n);
  const rowBuffer = new Float64Array(dataset.columns);

  for (let t = 0; t < treeCount; t += 1) {
    const drawCount = Math.max(1, Math.round(n * sampleShare));
    const sample = new Int32Array(drawCount);
    const inBag = new Uint8Array(n);
    for (let i = 0; i < drawCount; i += 1) {
      const row = rng.int(n);
      sample[i] = row;
      inBag[row] = 1;
    }

    const tree = growTree(binned, gradient, hessian, sample, {
      maxDepth: options.maxDepth ?? 8,
      minSamplesLeaf: options.minSamplesLeaf ?? 5,
      lambda: 0,
      featureShare,
      random: () => rng.next(),
    });
    trees.push(tree);

    for (let i = 0; i < n; i += 1) {
      if (inBag[i] === 1) continue;
      for (let j = 0; j < dataset.columns; j += 1)
        rowBuffer[j] = dataset.values[j * n + i] ?? Number.NaN;
      oobTotals[i] = (oobTotals[i] ?? 0) + predictRow(tree, binned.edges, rowBuffer, binCount);
      oobCounts[i] = (oobCounts[i] ?? 0) + 1;
    }
  }

  let oobError = 0;
  let scored = 0;
  for (let i = 0; i < n; i += 1) {
    const count = oobCounts[i] ?? 0;
    if (count === 0) continue;
    const prediction = (oobTotals[i] ?? 0) / count;
    oobError += (prediction - (target[i] ?? 0)) ** 2;
    scored += 1;
  }

  const totalGain = new Float64Array(dataset.columns);
  for (const tree of trees) {
    for (let j = 0; j < dataset.columns; j += 1) {
      totalGain[j] = (totalGain[j] ?? 0) + (tree.gainByFeature[j] ?? 0);
    }
  }
  const gainSum = totalGain.reduce((total, value) => total + value, 0);

  return {
    kind: 'forest',
    trees,
    edges: binned.edges,
    binCount,
    names: dataset.names,
    outOfBagError: scored === 0 ? Number.NaN : oobError / scored,
    outOfBagCoverage: n === 0 ? 0 : scored / n,
    predict(other: Dataset): Float64Array {
      const out = new Float64Array(other.rows);
      const row = new Float64Array(other.columns);
      for (let i = 0; i < other.rows; i += 1) {
        for (let j = 0; j < other.columns; j += 1)
          row[j] = other.values[j * other.rows + i] ?? Number.NaN;
        let total = 0;
        for (const tree of trees) total += predictRow(tree, binned.edges, row, binCount);
        out[i] = trees.length === 0 ? Number.NaN : total / trees.length;
      }
      return out;
    },
    importances() {
      return dataset.names
        .map((name, j) => ({ name, importance: gainSum === 0 ? 0 : (totalGain[j] ?? 0) / gainSum }))
        .sort((left, right) => right.importance - left.importance);
    },
  };
}

export { mean };

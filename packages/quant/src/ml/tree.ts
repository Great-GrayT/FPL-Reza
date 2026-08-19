/**
 * Decision trees over pre binned features.
 *
 * Binning once into at most 256 buckets turns every split search from a sort
 * into a histogram scan, which is what makes 113,592 rows by twenty features
 * trainable in a browser tab. It is the same trick LightGBM uses, and the cost
 * is that a split lands on a bin edge rather than on an exact value, which at
 * 256 bins is below the noise in any of this data.
 *
 * One builder serves every tree model here. A plain regression tree is this
 * builder with the gradient set to minus the target and the hessian to one,
 * which makes each leaf the mean of its rows; boosting passes real gradients.
 */
import { at, quantileSorted, sorted } from '../internal.js';
import { columnOf, type Dataset, type RowIndex } from './types.js';

export interface BinnedData {
  rows: number;
  columns: number;
  /** Column major bin codes, one byte per value. The last bin holds missing. */
  bins: Uint8Array;
  /** Upper edge of each bin, per column. */
  edges: number[][];
  binCount: number;
  names: string[];
}

/**
 * Quantile bins, so a skewed column (minutes, ownership) gets resolution where
 * its mass is rather than spreading 256 equal width buckets over one long tail.
 * Missing values get their own bin, which lets a tree learn from absence.
 */
export function binFeatures(dataset: Dataset, binCount = 64): BinnedData {
  const bins = new Uint8Array(dataset.rows * dataset.columns);
  const edges: number[][] = [];
  const missingBin = binCount;

  for (let j = 0; j < dataset.columns; j += 1) {
    const column = columnOf(dataset, j);
    const finite: number[] = [];
    for (const value of column) {
      if (Number.isFinite(value)) finite.push(value);
    }
    const ascending = sorted(finite);
    const columnEdges: number[] = [];
    for (let b = 1; b < binCount; b += 1) {
      const edge = quantileSorted(ascending, b / binCount);
      const previous = columnEdges[columnEdges.length - 1];
      // A column with fewer distinct values than bins produces duplicate edges,
      // which would create empty bins the split search then wastes time on.
      if (previous === undefined || edge > previous) columnEdges.push(edge);
    }
    edges.push(columnEdges);

    for (let i = 0; i < column.length; i += 1) {
      const value = column[i] ?? Number.NaN;
      if (!Number.isFinite(value)) {
        bins[j * dataset.rows + i] = missingBin;
        continue;
      }
      let low = 0;
      let high = columnEdges.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (value > (columnEdges[mid] ?? Number.POSITIVE_INFINITY)) low = mid + 1;
        else high = mid;
      }
      bins[j * dataset.rows + i] = low;
    }
  }

  return {
    rows: dataset.rows,
    columns: dataset.columns,
    bins,
    edges,
    binCount,
    names: dataset.names,
  };
}

export interface TreeOptions {
  maxDepth?: number;
  minSamplesLeaf?: number;
  /** L2 penalty on a leaf value, which shrinks leaves fitted on few rows. */
  lambda?: number;
  /** Minimum loss reduction a split has to buy. */
  minGain?: number;
  /** Features considered per split, as a share. Below one this is a random forest. */
  featureShare?: number;
  /** Draw for the feature subsample, required when featureShare is below one. */
  random?: () => number;
}

interface TreeNode {
  /** Feature index, or -1 for a leaf. */
  feature: number;
  /** Rows with a bin code at or below this go left. */
  threshold: number;
  left: number;
  right: number;
  value: number;
  /** Rows that reached this node, for the importance weighting. */
  count: number;
  gain: number;
}

export interface Tree {
  nodes: TreeNode[];
  /** Gain attributed to each feature, summed over the splits that used it. */
  gainByFeature: Float64Array;
}

/**
 * Grow one tree by depth first histogram splitting.
 *
 * `gradient` and `hessian` are the first and second derivatives of the loss at
 * the current prediction. Squared loss gives gradient = prediction - target and
 * hessian = 1; logistic loss gives probability - label and p(1 - p).
 */
export function growTree(
  data: BinnedData,
  gradient: Float64Array,
  hessian: Float64Array,
  rows: RowIndex,
  options: TreeOptions = {},
): Tree {
  const maxDepth = options.maxDepth ?? 6;
  const minSamplesLeaf = options.minSamplesLeaf ?? 20;
  const lambda = options.lambda ?? 1;
  const minGain = options.minGain ?? 1e-6;
  const featureShare = Math.min(1, Math.max(0.05, options.featureShare ?? 1));
  const random = options.random ?? ((): number => 1);
  const binSlots = data.binCount + 1;

  const nodes: TreeNode[] = [];
  const gainByFeature = new Float64Array(data.columns);

  const leafValue = (indices: RowIndex): number => {
    let g = 0;
    let h = 0;
    for (const row of indices) {
      g += gradient[row] ?? 0;
      h += hessian[row] ?? 0;
    }
    return -g / (h + lambda);
  };

  const build = (indices: RowIndex, depth: number): number => {
    const id = nodes.length;
    nodes.push({
      feature: -1,
      threshold: 0,
      left: -1,
      right: -1,
      value: leafValue(indices),
      count: indices.length,
      gain: 0,
    });

    if (depth >= maxDepth || indices.length < 2 * minSamplesLeaf) return id;

    let totalG = 0;
    let totalH = 0;
    for (const row of indices) {
      totalG += gradient[row] ?? 0;
      totalH += hessian[row] ?? 0;
    }
    const parentScore = (totalG * totalG) / (totalH + lambda);

    let best: { feature: number; threshold: number; gain: number } | null = null;
    const gradientHistogram = new Float64Array(binSlots);
    const hessianHistogram = new Float64Array(binSlots);
    const countHistogram = new Int32Array(binSlots);

    for (let j = 0; j < data.columns; j += 1) {
      if (featureShare < 1 && random() > featureShare) continue;
      gradientHistogram.fill(0);
      hessianHistogram.fill(0);
      countHistogram.fill(0);

      const offset = j * data.rows;
      for (const row of indices) {
        const bin = data.bins[offset + row] ?? 0;
        gradientHistogram[bin] = (gradientHistogram[bin] ?? 0) + (gradient[row] ?? 0);
        hessianHistogram[bin] = (hessianHistogram[bin] ?? 0) + (hessian[row] ?? 0);
        countHistogram[bin] = (countHistogram[bin] ?? 0) + 1;
      }

      let leftG = 0;
      let leftH = 0;
      let leftCount = 0;
      for (let bin = 0; bin < binSlots - 1; bin += 1) {
        leftG += gradientHistogram[bin] ?? 0;
        leftH += hessianHistogram[bin] ?? 0;
        leftCount += countHistogram[bin] ?? 0;
        const rightCount = indices.length - leftCount;
        if (leftCount < minSamplesLeaf || rightCount < minSamplesLeaf) continue;
        const rightG = totalG - leftG;
        const rightH = totalH - leftH;
        const gain =
          (leftG * leftG) / (leftH + lambda) + (rightG * rightG) / (rightH + lambda) - parentScore;
        if (gain > minGain && (best === null || gain > best.gain)) {
          best = { feature: j, threshold: bin, gain };
        }
      }
    }

    if (best === null) return id;
    const split: { feature: number; threshold: number; gain: number } = best;

    const leftRows: number[] = [];
    const rightRows: number[] = [];
    const offset = split.feature * data.rows;
    for (const row of indices) {
      const bin = data.bins[offset + row] ?? 0;
      if (bin <= split.threshold) leftRows.push(row);
      else rightRows.push(row);
    }

    const node = nodes[id];
    if (node === undefined) return id;
    node.feature = split.feature;
    node.threshold = split.threshold;
    node.gain = split.gain;
    gainByFeature[split.feature] = (gainByFeature[split.feature] ?? 0) + split.gain;
    node.left = build(Int32Array.from(leftRows), depth + 1);
    node.right = build(Int32Array.from(rightRows), depth + 1);
    return id;
  };

  build(rows, 0);
  return { nodes, gainByFeature };
}

/** Walk one already binned row down a tree. */
export function predictBinned(tree: Tree, data: BinnedData, row: number): number {
  let id = 0;
  for (let step = 0; step < 128; step += 1) {
    const node = tree.nodes[id];
    if (node === undefined) return 0;
    if (node.feature < 0) return node.value;
    const bin = data.bins[node.feature * data.rows + row] ?? 0;
    id = bin <= node.threshold ? node.left : node.right;
    if (id < 0) return node.value;
  }
  return 0;
}

/**
 * Walk a raw row, mapping each value through the same edges the tree was built
 * on. This is the prediction path for data the model has not seen, and it must
 * use the training bins: rebinning new data would move every threshold.
 */
export function predictRow(
  tree: Tree,
  edges: number[][],
  row: ArrayLike<number>,
  binCount: number,
): number {
  let id = 0;
  for (let step = 0; step < 128; step += 1) {
    const node = tree.nodes[id];
    if (node === undefined) return 0;
    if (node.feature < 0) return node.value;
    const value = row[node.feature] ?? Number.NaN;
    const columnEdges = edges[node.feature] ?? [];
    let bin: number;
    if (!Number.isFinite(value)) bin = binCount;
    else {
      let low = 0;
      let high = columnEdges.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (value > (columnEdges[mid] ?? Number.POSITIVE_INFINITY)) low = mid + 1;
        else high = mid;
      }
      bin = low;
    }
    id = bin <= node.threshold ? node.left : node.right;
    if (id < 0) return node.value;
  }
  return 0;
}

/** Depth of a fitted tree, which is what a reader checks before trusting one. */
export function treeDepth(tree: Tree): number {
  const depthOf = (id: number, depth: number): number => {
    const node = tree.nodes[id];
    if (node === undefined || node.feature < 0) return depth;
    return Math.max(depthOf(node.left, depth + 1), depthOf(node.right, depth + 1));
  };
  return depthOf(0, 0);
}

export function leafCount(tree: Tree): number {
  return tree.nodes.filter((node) => node.feature < 0).length;
}

/** Human readable split list, so a tree is inspectable rather than a black box. */
export function describeTree(tree: Tree, names: string[], edges: number[][], limit = 20): string[] {
  const lines: string[] = [];
  const walk = (id: number, depth: number): void => {
    const node = tree.nodes[id];
    if (node === undefined || lines.length >= limit) return;
    const indent = '  '.repeat(depth);
    if (node.feature < 0) {
      lines.push(`${indent}leaf ${node.value.toFixed(3)} (${node.count} rows)`);
      return;
    }
    const edge = edges[node.feature]?.[node.threshold];
    const name = names[node.feature] ?? `x${node.feature}`;
    lines.push(
      `${indent}${name} <= ${edge === undefined ? node.threshold : at([edge], 0).toFixed(3)}`,
    );
    walk(node.left, depth + 1);
    walk(node.right, depth + 1);
  };
  walk(0, 0);
  return lines;
}

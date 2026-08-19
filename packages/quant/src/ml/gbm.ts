/**
 * Histogram gradient boosting: the model that actually wins on tabular data,
 * and the one the Lab reaches for when a linear fit has run out of road.
 *
 * Two losses are supported, and they are the two questions this panel asks:
 * squared error for "how many points", logistic for "will he haul, start, keep
 * a clean sheet".
 */
import { mean } from '../internal.js';
import {
  binFeatures,
  growTree,
  predictBinned,
  predictRow,
  type BinnedData,
  type Tree,
} from './tree.js';
import { allRows, type Dataset, type Model, type RowIndex } from './types.js';
import { createRng } from '../rng.js';

export type Loss = 'squared' | 'logistic';

export interface GbmOptions {
  loss?: Loss;
  rounds?: number;
  learningRate?: number;
  maxDepth?: number;
  minSamplesLeaf?: number;
  lambda?: number;
  /** Row share sampled per round. Below one this is stochastic boosting. */
  subsample?: number;
  featureShare?: number;
  binCount?: number;
  seed?: number;
  /** Rows held out to stop training when the validation loss stops falling. */
  validation?: RowIndex;
  earlyStoppingRounds?: number;
}

export interface GbmModel extends Model {
  kind: 'gbm';
  loss: Loss;
  base: number;
  trees: Tree[];
  learningRate: number;
  edges: number[][];
  binCount: number;
  names: string[];
  /** Training loss per round, and validation loss where a set was given. */
  history: { round: number; train: number; validation: number | null }[];
  bestRound: number;
  /** Raw score before the link function, which is what a Shapley pass needs. */
  score(row: ArrayLike<number>): number;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function lossOf(loss: Loss, prediction: number, target: number): number {
  if (loss === 'squared') return (prediction - target) ** 2;
  const p = Math.min(Math.max(sigmoid(prediction), 1e-12), 1 - 1e-12);
  return -(target * Math.log(p) + (1 - target) * Math.log(1 - p));
}

export function fitGbm(
  dataset: Dataset,
  target: ArrayLike<number>,
  options: GbmOptions = {},
): GbmModel {
  const loss = options.loss ?? 'squared';
  const rounds = options.rounds ?? 100;
  const learningRate = options.learningRate ?? 0.1;
  const binCount = options.binCount ?? 64;
  const seed = options.seed ?? 1;
  const subsample = Math.min(1, Math.max(0.1, options.subsample ?? 1));
  const rng = createRng(seed);

  const binned: BinnedData = binFeatures(dataset, binCount);
  const n = dataset.rows;

  const validation = options.validation;
  const validationSet = new Set<number>(validation === undefined ? [] : Array.from(validation));
  const trainRows: number[] = [];
  for (let i = 0; i < n; i += 1) if (!validationSet.has(i)) trainRows.push(i);
  const trainIndex = Int32Array.from(trainRows);

  // The base is the best constant prediction, so the first tree corrects a
  // sensible starting point rather than correcting zero.
  const trainTargets = trainRows.map((row) => target[row] ?? 0);
  const base =
    loss === 'squared'
      ? mean(trainTargets)
      : Math.log(
          Math.min(Math.max(mean(trainTargets), 1e-6), 1 - 1e-6) /
            (1 - Math.min(Math.max(mean(trainTargets), 1e-6), 1 - 1e-6)),
        );

  const predictions = new Float64Array(n).fill(base);
  const gradient = new Float64Array(n);
  const hessian = new Float64Array(n);
  const trees: Tree[] = [];
  const history: { round: number; train: number; validation: number | null }[] = [];

  let bestValidation = Number.POSITIVE_INFINITY;
  let bestRound = 0;
  let sinceImprovement = 0;
  const patience = options.earlyStoppingRounds ?? 10;

  for (let round = 0; round < rounds; round += 1) {
    for (const row of trainRows) {
      const prediction = predictions[row] ?? base;
      const actual = target[row] ?? 0;
      if (loss === 'squared') {
        gradient[row] = prediction - actual;
        hessian[row] = 1;
      } else {
        const p = sigmoid(prediction);
        gradient[row] = p - actual;
        hessian[row] = Math.max(p * (1 - p), 1e-6);
      }
    }

    let rows: RowIndex = trainIndex;
    if (subsample < 1) {
      const sampled: number[] = [];
      for (const row of trainRows) if (rng.next() < subsample) sampled.push(row);
      rows = Int32Array.from(sampled.length > 0 ? sampled : trainRows);
    }

    const tree = growTree(binned, gradient, hessian, rows, {
      maxDepth: options.maxDepth ?? 4,
      minSamplesLeaf: options.minSamplesLeaf ?? 20,
      lambda: options.lambda ?? 1,
      featureShare: options.featureShare ?? 1,
      random: () => rng.next(),
    });
    trees.push(tree);

    for (let i = 0; i < n; i += 1) {
      predictions[i] = (predictions[i] ?? base) + learningRate * predictBinned(tree, binned, i);
    }

    let trainLoss = 0;
    for (const row of trainRows)
      trainLoss += lossOf(loss, predictions[row] ?? base, target[row] ?? 0);
    trainLoss /= Math.max(1, trainRows.length);

    let validationLoss: number | null = null;
    if (validation !== undefined && validation.length > 0) {
      let total = 0;
      for (const row of validation) {
        total += lossOf(loss, predictions[row] ?? base, target[row] ?? 0);
      }
      validationLoss = total / validation.length;
      if (validationLoss < bestValidation - 1e-9) {
        bestValidation = validationLoss;
        bestRound = round + 1;
        sinceImprovement = 0;
      } else {
        sinceImprovement += 1;
      }
    }

    history.push({ round: round + 1, train: trainLoss, validation: validationLoss });
    // Stopping keeps every tree but records where the validation loss turned,
    // so a caller can inspect the overfitting rather than only avoid it.
    if (validationLoss !== null && sinceImprovement >= patience) break;
  }

  const usedTrees = bestRound > 0 ? trees.slice(0, bestRound) : trees;

  const totalGain = new Float64Array(dataset.columns);
  for (const tree of usedTrees) {
    for (let j = 0; j < dataset.columns; j += 1) {
      totalGain[j] = (totalGain[j] ?? 0) + (tree.gainByFeature[j] ?? 0);
    }
  }
  const gainSum = totalGain.reduce((total, value) => total + value, 0);

  const score = (row: ArrayLike<number>): number => {
    let value = base;
    for (const tree of usedTrees)
      value += learningRate * predictRow(tree, binned.edges, row, binCount);
    return value;
  };

  return {
    kind: 'gbm',
    loss,
    base,
    trees: usedTrees,
    learningRate,
    edges: binned.edges,
    binCount,
    names: dataset.names,
    history,
    bestRound: bestRound > 0 ? bestRound : trees.length,
    score,
    predict(other: Dataset): Float64Array {
      const out = new Float64Array(other.rows);
      const row = new Float64Array(other.columns);
      for (let i = 0; i < other.rows; i += 1) {
        for (let j = 0; j < other.columns; j += 1) {
          row[j] = other.values[j * other.rows + i] ?? Number.NaN;
        }
        const raw = score(row);
        out[i] = loss === 'logistic' ? sigmoid(raw) : raw;
      }
      return out;
    },
    importances() {
      return dataset.names
        .map((name, j) => ({
          name,
          importance: gainSum === 0 ? 0 : (totalGain[j] ?? 0) / gainSum,
        }))
        .sort((left, right) => right.importance - left.importance);
    },
  };
}

/** A single regression tree: boosting with one round and no shrinkage. */
export function fitTree(
  dataset: Dataset,
  target: ArrayLike<number>,
  options: { maxDepth?: number; minSamplesLeaf?: number; binCount?: number } = {},
): GbmModel {
  return fitGbm(dataset, target, {
    loss: 'squared',
    rounds: 1,
    learningRate: 1,
    lambda: 0,
    maxDepth: options.maxDepth ?? 4,
    minSamplesLeaf: options.minSamplesLeaf ?? 5,
    ...(options.binCount === undefined ? {} : { binCount: options.binCount }),
  });
}

export { allRows };

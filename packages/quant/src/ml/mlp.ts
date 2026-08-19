/**
 * A small feedforward network, trained with Adam on minibatches.
 *
 * It is not expected to beat boosting on this data, and saying so is the point:
 * having a non linear model that is not a tree in the same harness is what makes
 * "the trees are winning" a measured claim rather than an assumption.
 */
import { mean } from '../internal.js';
import { createRng } from '../rng.js';
import { fitPreprocessor, type Preprocessor } from './pipeline.js';
import type { Dataset, Model } from './types.js';

export interface MlpOptions {
  hidden?: number[];
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  /** L2 penalty on the weights. */
  weightDecay?: number;
  loss?: 'squared' | 'logistic';
  seed?: number;
  /** Rows held out to report a validation curve. */
  validationShare?: number;
}

interface Layer {
  inputs: number;
  outputs: number;
  weights: Float64Array;
  biases: Float64Array;
  momentWeights: Float64Array;
  velocityWeights: Float64Array;
  momentBiases: Float64Array;
  velocityBiases: Float64Array;
}

export interface MlpModel extends Model {
  kind: 'mlp';
  layers: Layer[];
  preprocessor: Preprocessor;
  loss: 'squared' | 'logistic';
  history: { epoch: number; train: number; validation: number | null }[];
}

function makeLayer(inputs: number, outputs: number, random: () => number): Layer {
  // He initialisation, which is the right scale for a ReLU stack: any smaller
  // and the signal dies through the layers, any larger and it explodes.
  const scale = Math.sqrt(2 / Math.max(1, inputs));
  const weights = new Float64Array(inputs * outputs);
  for (let i = 0; i < weights.length; i += 1) weights[i] = (random() * 2 - 1) * scale;
  return {
    inputs,
    outputs,
    weights,
    biases: new Float64Array(outputs),
    momentWeights: new Float64Array(inputs * outputs),
    velocityWeights: new Float64Array(inputs * outputs),
    momentBiases: new Float64Array(outputs),
    velocityBiases: new Float64Array(outputs),
  };
}

function forward(layers: Layer[], input: Float64Array): Float64Array[] {
  const activations: Float64Array[] = [input];
  layers.forEach((layer, index) => {
    const previous = activations[index] ?? input;
    const out = new Float64Array(layer.outputs);
    for (let o = 0; o < layer.outputs; o += 1) {
      let total = layer.biases[o] ?? 0;
      for (let i = 0; i < layer.inputs; i += 1) {
        total += (previous[i] ?? 0) * (layer.weights[i * layer.outputs + o] ?? 0);
      }
      // ReLU everywhere except the output layer, which stays linear so the
      // logistic link can be applied once, at the loss.
      out[o] = index === layers.length - 1 ? total : Math.max(0, total);
    }
    activations.push(out);
  });
  return activations;
}

export function fitMlp(
  dataset: Dataset,
  target: ArrayLike<number>,
  options: MlpOptions = {},
): MlpModel {
  const hidden = options.hidden ?? [16, 8];
  const epochs = options.epochs ?? 40;
  const batchSize = options.batchSize ?? 64;
  const learningRate = options.learningRate ?? 0.01;
  const decay = options.weightDecay ?? 1e-4;
  const loss = options.loss ?? 'squared';
  const seed = options.seed ?? 1;
  const rng = createRng(seed);

  const preprocessor = fitPreprocessor(dataset, { standardise: true, impute: 'median' });
  const prepared = preprocessor.apply(dataset);

  const layers: Layer[] = [];
  let previous = prepared.columns;
  for (const size of hidden) {
    layers.push(makeLayer(previous, size, () => rng.next()));
    previous = size;
  }
  layers.push(makeLayer(previous, 1, () => rng.next()));

  const rows = Array.from({ length: prepared.rows }, (_, i) => i);
  const validationShare = options.validationShare ?? 0;
  const validationCount = Math.floor(rows.length * validationShare);
  const validationRows = rows.slice(rows.length - validationCount);
  const trainRows = rows.slice(0, rows.length - validationCount);

  const history: { epoch: number; train: number; validation: number | null }[] = [];
  const beta1 = 0.9;
  const beta2 = 0.999;
  let step = 0;

  const rowBuffer = new Float64Array(prepared.columns);
  const readRow = (index: number): Float64Array => {
    for (let j = 0; j < prepared.columns; j += 1) {
      rowBuffer[j] = prepared.values[j * prepared.rows + index] ?? 0;
    }
    return rowBuffer;
  };

  const predictRaw = (index: number): number => {
    const activations = forward(layers, Float64Array.from(readRow(index)));
    return activations[activations.length - 1]?.[0] ?? 0;
  };

  const lossOf = (raw: number, actual: number): number => {
    if (loss === 'squared') return (raw - actual) ** 2;
    const p = Math.min(Math.max(1 / (1 + Math.exp(-raw)), 1e-12), 1 - 1e-12);
    return -(actual * Math.log(p) + (1 - actual) * Math.log(1 - p));
  };

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (let i = trainRows.length - 1; i > 0; i -= 1) {
      const j = rng.int(i + 1);
      const swap = trainRows[i] ?? 0;
      trainRows[i] = trainRows[j] ?? 0;
      trainRows[j] = swap;
    }

    for (let start = 0; start < trainRows.length; start += batchSize) {
      const batch = trainRows.slice(start, start + batchSize);
      const gradientWeights = layers.map((layer) => new Float64Array(layer.weights.length));
      const gradientBiases = layers.map((layer) => new Float64Array(layer.biases.length));

      for (const row of batch) {
        const activations = forward(layers, Float64Array.from(readRow(row)));
        const output = activations[activations.length - 1]?.[0] ?? 0;
        const actual = target[row] ?? 0;
        // Both losses have the same derivative shape at the output: the
        // difference between what came out and what should have.
        const derivative =
          loss === 'squared' ? 2 * (output - actual) : 1 / (1 + Math.exp(-output)) - actual;

        let delta = new Float64Array([derivative]);
        for (let l = layers.length - 1; l >= 0; l -= 1) {
          const layer = layers[l];
          const input = activations[l];
          if (layer === undefined || input === undefined) continue;
          const gw = gradientWeights[l];
          const gb = gradientBiases[l];
          if (gw === undefined || gb === undefined) continue;

          const nextDelta = new Float64Array(layer.inputs);
          for (let o = 0; o < layer.outputs; o += 1) {
            const d = delta[o] ?? 0;
            gb[o] = (gb[o] ?? 0) + d;
            for (let i = 0; i < layer.inputs; i += 1) {
              gw[i * layer.outputs + o] = (gw[i * layer.outputs + o] ?? 0) + d * (input[i] ?? 0);
              nextDelta[i] = (nextDelta[i] ?? 0) + d * (layer.weights[i * layer.outputs + o] ?? 0);
            }
          }
          if (l > 0) {
            for (let i = 0; i < layer.inputs; i += 1) {
              // The ReLU gate: no gradient flows back through a unit that was off.
              if ((input[i] ?? 0) <= 0) nextDelta[i] = 0;
            }
          }
          delta = nextDelta;
        }
      }

      step += 1;
      const scale = 1 / Math.max(1, batch.length);
      layers.forEach((layer, l) => {
        const gw = gradientWeights[l];
        const gb = gradientBiases[l];
        if (gw === undefined || gb === undefined) return;
        for (let i = 0; i < layer.weights.length; i += 1) {
          const gradient = (gw[i] ?? 0) * scale + decay * (layer.weights[i] ?? 0);
          layer.momentWeights[i] = beta1 * (layer.momentWeights[i] ?? 0) + (1 - beta1) * gradient;
          layer.velocityWeights[i] =
            beta2 * (layer.velocityWeights[i] ?? 0) + (1 - beta2) * gradient * gradient;
          const m = (layer.momentWeights[i] ?? 0) / (1 - beta1 ** step);
          const v = (layer.velocityWeights[i] ?? 0) / (1 - beta2 ** step);
          layer.weights[i] = (layer.weights[i] ?? 0) - (learningRate * m) / (Math.sqrt(v) + 1e-8);
        }
        for (let o = 0; o < layer.biases.length; o += 1) {
          const gradient = (gb[o] ?? 0) * scale;
          layer.momentBiases[o] = beta1 * (layer.momentBiases[o] ?? 0) + (1 - beta1) * gradient;
          layer.velocityBiases[o] =
            beta2 * (layer.velocityBiases[o] ?? 0) + (1 - beta2) * gradient * gradient;
          const m = (layer.momentBiases[o] ?? 0) / (1 - beta1 ** step);
          const v = (layer.velocityBiases[o] ?? 0) / (1 - beta2 ** step);
          layer.biases[o] = (layer.biases[o] ?? 0) - (learningRate * m) / (Math.sqrt(v) + 1e-8);
        }
      });
    }

    const trainLoss = mean(trainRows.map((row) => lossOf(predictRaw(row), target[row] ?? 0)));
    const validationLoss =
      validationRows.length === 0
        ? null
        : mean(validationRows.map((row) => lossOf(predictRaw(row), target[row] ?? 0)));
    history.push({ epoch: epoch + 1, train: trainLoss, validation: validationLoss });
  }

  return {
    kind: 'mlp',
    layers,
    preprocessor,
    loss,
    history,
    predict(other: Dataset): Float64Array {
      const applied = preprocessor.apply(other);
      const out = new Float64Array(applied.rows);
      const buffer = new Float64Array(applied.columns);
      for (let i = 0; i < applied.rows; i += 1) {
        for (let j = 0; j < applied.columns; j += 1)
          buffer[j] = applied.values[j * applied.rows + i] ?? 0;
        const activations = forward(layers, Float64Array.from(buffer));
        const raw = activations[activations.length - 1]?.[0] ?? 0;
        out[i] = loss === 'logistic' ? 1 / (1 + Math.exp(-raw)) : raw;
      }
      return out;
    },
    importances() {
      // A network has no native importance worth reporting; permutation
      // importance in explain.ts answers the question properly.
      return null;
    },
  };
}

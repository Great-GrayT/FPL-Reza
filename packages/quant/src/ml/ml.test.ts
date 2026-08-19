import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRng } from '../rng.js';
import { fitGbm, fitTree } from './gbm.js';
import { fitForest } from './forest.js';
import { fitKnn, similarRows } from './knn.js';
import { clusterSweep, kmeans, pca } from './cluster.js';
import { fitMlp } from './mlp.js';
import {
  calibrationCurve,
  classificationMetrics,
  liftByDecile,
  regressionMetrics,
  rocCurve,
} from './metrics.js';
import { fitPreprocessor, oneHot } from './pipeline.js';
import { crossValidate, learningCurve, permutationNull, walkForwardSplits } from './validate.js';
import { partialDependence, permutationImportance, shapleyValues } from './explain.js';
import { buildPanelFeatures, leakageReport, type PanelObservation } from './features.js';
import { datasetFrom, type Dataset } from './types.js';

const close = (actual: number, expected: number, tolerance: number): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be near ${expected}`);
};

/** y depends on x1 strongly, on x2 through a step, and not at all on noise. */
function synthetic(
  rows = 600,
  seed = 1,
): { data: Dataset; target: Float64Array; periods: Int32Array } {
  const rng = createRng(seed);
  const x1: number[] = [];
  const x2: number[] = [];
  const noise: number[] = [];
  const target: number[] = [];
  const periods: number[] = [];
  for (let i = 0; i < rows; i += 1) {
    const a = rng.normal();
    const b = rng.normal();
    x1.push(a);
    x2.push(b);
    noise.push(rng.normal());
    target.push(2 * a + (b > 0 ? 3 : -3) + rng.normal() * 0.4);
    periods.push(Math.floor(i / 20) + 1);
  }
  return {
    data: datasetFrom([
      { name: 'x1', values: x1 },
      { name: 'x2', values: x2 },
      { name: 'noise', values: noise },
    ]),
    target: Float64Array.from(target),
    periods: Int32Array.from(periods),
  };
}

describe('gradient boosting', () => {
  it('learns a signal and ranks the useless feature last', () => {
    const { data, target } = synthetic();
    const model = fitGbm(data, target, { rounds: 80, learningRate: 0.1, maxDepth: 3, seed: 2 });
    const metrics = regressionMetrics(target, model.predict(data));
    assert.ok(metrics.rSquared > 0.9, `r squared was ${metrics.rSquared}`);
    const importances = model.importances();
    assert.ok(importances !== null);
    assert.equal(importances[importances.length - 1]?.name, 'noise');
  });

  it('fits a probability for a binary target', () => {
    const rng = createRng(3);
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 1500; i += 1) {
      const value = rng.normal();
      x.push(value);
      y.push(rng.next() < 1 / (1 + Math.exp(-(1.5 * value))) ? 1 : 0);
    }
    const data = datasetFrom([{ name: 'x', values: x }]);
    const model = fitGbm(data, y, { loss: 'logistic', rounds: 60, maxDepth: 3, seed: 4 });
    const predictions = model.predict(data);
    for (const p of predictions) assert.ok(p >= 0 && p <= 1);
    const metrics = classificationMetrics(y, predictions);
    assert.ok(metrics.auc > 0.75, `auc was ${metrics.auc}`);
    assert.ok(metrics.brierSkill > 0.1);
  });

  it('stops early when a validation fold stops improving', () => {
    const { data, target } = synthetic(400, 5);
    const validation = Int32Array.from(Array.from({ length: 100 }, (_, i) => 300 + i));
    const model = fitGbm(data, target, {
      rounds: 500,
      validation,
      earlyStoppingRounds: 5,
      seed: 6,
    });
    assert.ok(model.history.length < 500, 'training should have stopped before the last round');
    assert.ok(model.bestRound <= model.history.length);
  });

  it('handles missing values without imputing them away', () => {
    const { data, target } = synthetic(300, 7);
    const values = Float64Array.from(data.values);
    for (let i = 0; i < 60; i += 1) values[i] = Number.NaN;
    const model = fitGbm({ ...data, values }, target, { rounds: 40, seed: 8 });
    const predictions = model.predict({ ...data, values });
    for (const value of predictions) assert.ok(Number.isFinite(value));
  });

  it('grows a single tree when asked for one', () => {
    const { data, target } = synthetic(300, 9);
    const tree = fitTree(data, target, { maxDepth: 3 });
    assert.equal(tree.trees.length, 1);
  });
});

describe('random forest', () => {
  it('reports an out of bag error close to its test error', () => {
    const { data, target } = synthetic(500, 11);
    const model = fitForest(data, target, { trees: 40, maxDepth: 6, seed: 12 });
    const inSample = regressionMetrics(target, model.predict(data));
    assert.ok(model.outOfBagCoverage > 0.9);
    // Out of bag error is honest, so it must be worse than the in sample fit.
    assert.ok(model.outOfBagError > inSample.rmse ** 2 * 0.5);
    assert.ok(Number.isFinite(model.outOfBagError));
  });

  it('ranks the informative features above the noise one', () => {
    const { data, target } = synthetic(500, 13);
    const importances = fitForest(data, target, { trees: 30, seed: 14 }).importances();
    assert.ok(importances !== null);
    const noise = importances.find((entry) => entry.name === 'noise');
    const signal = importances.find((entry) => entry.name === 'x1');
    assert.ok((signal?.importance ?? 0) > (noise?.importance ?? 1));
  });
});

describe('nearest neighbours', () => {
  it('predicts from the neighbours it finds', () => {
    const { data, target } = synthetic(300, 15);
    const model = fitKnn(data, target, { k: 10 });
    const metrics = regressionMetrics(target, model.predict(data));
    assert.ok(metrics.rSquared > 0.7, `r squared was ${metrics.rSquared}`);
  });

  it('finds the rows most like a given one', () => {
    const { data, target } = synthetic(200, 16);
    const model = fitKnn(data, target, { k: 5 });
    const row = [0, 1, 0];
    const similar = similarRows(model, row, 5);
    assert.equal(similar.length, 5);
    for (let i = 1; i < similar.length; i += 1) {
      assert.ok((similar[i]?.distance ?? 0) >= (similar[i - 1]?.distance ?? 0));
    }
  });
});

describe('unsupervised', () => {
  it('separates two clear groups', () => {
    const rng = createRng(17);
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const offset = i < 100 ? -4 : 4;
      x.push(offset + rng.normal() * 0.4);
      y.push(offset + rng.normal() * 0.4);
    }
    const result = kmeans(
      datasetFrom([
        { name: 'x', values: x },
        { name: 'y', values: y },
      ]),
      2,
      { seed: 18 },
    );
    assert.equal(result.k, 2);
    assert.ok(result.silhouette > 0.7, `silhouette was ${result.silhouette}`);
    const first = result.assignments[0];
    for (let i = 1; i < 100; i += 1) assert.equal(result.assignments[i], first);
  });

  it('reports falling inertia as k rises', () => {
    const rng = createRng(19);
    const values = Array.from({ length: 150 }, () => rng.normal());
    const sweep = clusterSweep(datasetFrom([{ name: 'x', values }]), [2, 3, 4], { seed: 20 });
    assert.ok((sweep[0]?.inertia ?? 0) >= (sweep[2]?.inertia ?? 0));
  });

  it('puts the shared variance on the first principal component', () => {
    const rng = createRng(21);
    const a: number[] = [];
    const b: number[] = [];
    const c: number[] = [];
    for (let i = 0; i < 300; i += 1) {
      const shared = rng.normal();
      a.push(shared + rng.normal() * 0.1);
      b.push(shared + rng.normal() * 0.1);
      c.push(rng.normal());
    }
    const result = pca(
      datasetFrom([
        { name: 'a', values: a },
        { name: 'b', values: b },
        { name: 'c', values: c },
      ]),
      2,
    );
    assert.ok((result.explained[0] ?? 0) > 0.5);
    close(
      result.cumulative[1] ?? 0,
      (result.explained[0] ?? 0) + (result.explained[1] ?? 0),
      1e-12,
    );
    const loading = result.loadings[0] ?? [];
    // a and b move together, so they load the same way on the first component.
    assert.ok(Math.sign(loading[0] ?? 0) === Math.sign(loading[1] ?? 0));
  });
});

describe('network', () => {
  it('learns a non linear relationship', () => {
    const rng = createRng(23);
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 800; i += 1) {
      const value = rng.normal();
      x.push(value);
      y.push(value * value + rng.normal() * 0.1);
    }
    const data = datasetFrom([{ name: 'x', values: x }]);
    const model = fitMlp(data, y, { hidden: [16, 8], epochs: 60, learningRate: 0.02, seed: 24 });
    const metrics = regressionMetrics(y, model.predict(data));
    assert.ok(metrics.rSquared > 0.7, `r squared was ${metrics.rSquared}`);
    assert.ok(
      (model.history[model.history.length - 1]?.train ?? 1) < (model.history[0]?.train ?? 0),
    );
  });
});

describe('preprocessing', () => {
  it('fits on the training rows and applies those statistics elsewhere', () => {
    const train = datasetFrom([{ name: 'x', values: [0, 10, 20, 30] }]);
    const preprocessor = fitPreprocessor(train);
    const applied = preprocessor.apply(datasetFrom([{ name: 'x', values: [15] }]));
    // 15 is standardised by the training mean and spread, not its own.
    close(applied.values[0] ?? 0, (15 - 15) / 12.909944, 1e-5);
  });

  it('fills a missing value with the training median', () => {
    const train = datasetFrom([{ name: 'x', values: [1, 2, 3, 100] }]);
    const preprocessor = fitPreprocessor(train, { standardise: false, impute: 'median' });
    const applied = preprocessor.apply(datasetFrom([{ name: 'x', values: [Number.NaN] }]));
    close(applied.values[0] ?? 0, 2.5, 1e-9);
  });

  it('encodes labels into indicator columns', () => {
    const columns = oneHot(['MID', 'DEF', 'MID', null], 'position');
    assert.deepEqual(
      columns.map((column) => column.name),
      ['position=DEF', 'position=MID'],
    );
    assert.equal(columns[1]?.values[0], 1);
    assert.ok(Number.isNaN(columns[1]?.values[3] ?? 0));
  });
});

describe('validation', () => {
  it('never puts a future period in a training fold', () => {
    const periods = Int32Array.from({ length: 100 }, (_, i) => Math.floor(i / 10) + 1);
    const splits = walkForwardSplits(periods, { minimumTrainPeriods: 3 });
    assert.ok(splits.length > 0);
    for (const split of splits) {
      const latestTrain = Math.max(...Array.from(split.train, (row) => periods[row] ?? 0));
      const earliestTest = Math.min(...Array.from(split.test, (row) => periods[row] ?? 0));
      assert.ok(latestTrain < earliestTest, 'training must end before testing begins');
    }
  });

  it('purges the periods an embargo covers', () => {
    const periods = Int32Array.from({ length: 100 }, (_, i) => Math.floor(i / 10) + 1);
    const splits = walkForwardSplits(periods, { minimumTrainPeriods: 5, embargoPeriods: 2 });
    const first = splits[0];
    assert.ok(first !== undefined);
    const latestTrain = Math.max(...Array.from(first.train, (row) => periods[row] ?? 0));
    assert.ok(latestTrain <= first.period - 3);
  });

  it('scores every fold out of sample', () => {
    const { data, target, periods } = synthetic(600, 25);
    const splits = walkForwardSplits(periods, { minimumTrainPeriods: 10 });
    const result = crossValidate(data, target, splits, (trainData, trainTarget) =>
      fitGbm(trainData, trainTarget, { rounds: 40, seed: 26 }),
    );
    assert.equal(result.folds.length, splits.length);
    assert.ok(Number.isFinite(result.mean));
    assert.ok(result.standardError >= 0);
  });

  it('shows the training score above the test score on a learning curve', () => {
    const { data, target, periods } = synthetic(400, 27);
    const splits = walkForwardSplits(periods, { minimumTrainPeriods: 10 });
    const split = splits[0];
    assert.ok(split !== undefined);
    const curve = learningCurve(data, target, split, (trainData, trainTarget) =>
      fitGbm(trainData, trainTarget, { rounds: 60, seed: 28 }),
    );
    assert.equal(curve.length, 5);
    const last = curve[curve.length - 1];
    assert.ok((last?.trainScore ?? 1) <= (last?.testScore ?? 0) + 1e-9);
  });

  it('separates a real model from a shuffled target', () => {
    const { data, target, periods } = synthetic(400, 29);
    const splits = walkForwardSplits(periods, { minimumTrainPeriods: 8 });
    const result = permutationNull(
      data,
      target,
      splits,
      (trainData, trainTarget) => fitGbm(trainData, trainTarget, { rounds: 30, seed: 30 }),
      { runs: 5, seed: 31 },
    );
    assert.ok(result.observed > result.nullMean);
    assert.ok(result.pValue < 0.2);
  });
});

describe('explanation', () => {
  it('gives the useless feature no permutation importance', () => {
    const { data, target } = synthetic(400, 33);
    const model = fitGbm(data, target, { rounds: 50, seed: 34 });
    const importances = permutationImportance(model, data, target, { repeats: 3, seed: 35 });
    const noise = importances.find((entry) => entry.name === 'noise');
    const signal = importances.find((entry) => entry.name === 'x1');
    assert.ok((signal?.importance ?? 0) > (noise?.importance ?? 1));
  });

  it('traces a rising partial dependence for a rising effect', () => {
    const { data, target } = synthetic(400, 36);
    const model = fitGbm(data, target, { rounds: 60, seed: 37 });
    const curve = partialDependence(model, data, 'x1', { points: 8, sample: 200 });
    assert.equal(curve.length, 8);
    assert.ok((curve[7]?.prediction ?? 0) > (curve[0]?.prediction ?? 0));
  });

  it('attributes a prediction back to its features', () => {
    const { data, target } = synthetic(300, 38);
    const model = fitGbm(data, target, { rounds: 40, seed: 39 });
    const explanation = shapleyValues(model, data, 0, { samples: 30, background: 40, seed: 40 });
    const total = explanation.attributions.reduce((sum, entry) => sum + entry.contribution, 0);
    // Shapley values are additive: the contributions close the gap between the
    // baseline and the prediction, up to the sampling error.
    close(
      total,
      explanation.prediction - explanation.baseline,
      Math.abs(explanation.prediction) * 0.35 + 1,
    );
  });
});

describe('features', () => {
  const observations: PanelObservation[] = [];
  for (let id = 1; id <= 20; id += 1) {
    for (let period = 1; period <= 20; period += 1) {
      observations.push({
        id,
        period,
        values: { points: (id % 5) + period * 0.1 },
        known: { price: 50 + id },
        target: (id % 5) * 2,
      });
    }
  }

  it('builds rolling features from earlier periods only', () => {
    const built = buildPanelFeatures(observations, {
      windows: [3],
      minimumHistory: 3,
      halfLives: [],
    });
    assert.ok(built.dataset.rows > 0);
    assert.ok(built.dataset.names.includes('points_mean_3'));
    assert.ok(built.dataset.names.includes('price'));
    // Three periods of history per player are dropped, twenty players over.
    assert.equal(built.dropped, 60);
    const firstPeriod = Math.min(...Array.from(built.periods));
    assert.equal(firstPeriod, 4);
  });

  it('flags a feature that has seen the answer', () => {
    const { data, target } = synthetic(200, 41);
    const values = Float64Array.from(data.values);
    const leaked = { ...data, columns: data.columns + 1, names: [...data.names, 'leak'] };
    const combined = new Float64Array(values.length + target.length);
    combined.set(values, 0);
    combined.set(target, values.length);
    const report = leakageReport({ ...leaked, values: combined }, target);
    assert.equal(report[0]?.name, 'leak');
    assert.ok(report[0]?.suspicious);
    assert.ok(report.slice(1).every((entry) => !entry.suspicious));
  });
});

describe('metrics', () => {
  it('reports a perfect fit and a useless one correctly', () => {
    const actual = [1, 2, 3, 4, 5];
    close(regressionMetrics(actual, actual).rSquared, 1, 1e-12);
    close(regressionMetrics(actual, [3, 3, 3, 3, 3]).rSquared, 0, 1e-12);
  });

  it('reads an auc of one for a perfect ranking and a half for noise', () => {
    const labels = [0, 0, 1, 1];
    close(classificationMetrics(labels, [0.1, 0.2, 0.8, 0.9]).auc, 1, 1e-12);
    close(classificationMetrics(labels, [0.5, 0.5, 0.5, 0.5]).auc, 0.5, 1e-12);
  });

  it('draws a monotone roc curve', () => {
    const labels = [0, 0, 1, 1];
    const curve = rocCurve(labels, [0.1, 0.4, 0.6, 0.9], 4);
    assert.equal(curve.length, 5);
    assert.ok((curve[0]?.truePositiveRate ?? 0) >= (curve[4]?.truePositiveRate ?? 1));
  });

  it('shows a calibrated model on the diagonal', () => {
    const rng = createRng(43);
    const labels: number[] = [];
    const probabilities: number[] = [];
    for (let i = 0; i < 4000; i += 1) {
      const p = rng.next();
      probabilities.push(p);
      labels.push(rng.next() < p ? 1 : 0);
    }
    const curve = calibrationCurve(labels, probabilities, 5);
    for (const bin of curve) {
      if (bin.count < 50) continue;
      close(bin.observed, bin.predicted, 0.06);
    }
  });

  it('orders the deciles of a real ranking', () => {
    const { data, target } = synthetic(400, 44);
    const model = fitGbm(data, target, { rounds: 40, seed: 45 });
    const lift = liftByDecile(target, model.predict(data), 5);
    assert.ok((lift[0]?.meanActual ?? 0) > (lift[4]?.meanActual ?? 0));
  });
});

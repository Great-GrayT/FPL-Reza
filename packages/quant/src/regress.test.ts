import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loess, logistic, ols, predictLogistic, predictOls, ridge, vif } from './regress.js';
import { createRng } from './rng.js';

const close = (actual: number, expected: number, tolerance = 1e-6): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be near ${expected}`);
};

describe('ols', () => {
  // The textbook example: x = 1..5, y = 2,4,5,4,5. R reports slope 0.6,
  // intercept 2.2, R squared 0.6, and a slope standard error of 0.2828.
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 5, 4, 5];

  it('recovers the known slope and intercept', () => {
    const model = ols(y, [x], { names: ['x'] });
    assert.ok(model !== null);
    close(model.coefficients[0]?.estimate ?? Number.NaN, 2.2, 1e-9);
    close(model.coefficients[1]?.estimate ?? Number.NaN, 0.6, 1e-9);
    close(model.rSquared, 0.6, 1e-9);
    close(model.adjustedRSquared, 0.4666666667, 1e-8);
    close(model.coefficients[1]?.standardError ?? Number.NaN, 0.28284271, 1e-7);
    close(model.coefficients[1]?.t ?? Number.NaN, 2.12132034, 1e-7);
    close(model.coefficients[1]?.pValue ?? Number.NaN, 0.1240270627, 1e-9);
    assert.equal(model.n, 5);
    assert.equal(model.k, 2);
  });

  it('fits a plane exactly when the data lies on one', () => {
    const a = [1, 2, 3, 4, 5, 6];
    const b = [2, 1, 4, 3, 6, 5];
    const target = a.map((value, i) => 3 + 2 * value - 1.5 * (b[i] ?? 0));
    const model = ols(target, [a, b], { names: ['a', 'b'] });
    assert.ok(model !== null);
    close(model.coefficients[0]?.estimate ?? Number.NaN, 3, 1e-8);
    close(model.coefficients[1]?.estimate ?? Number.NaN, 2, 1e-8);
    close(model.coefficients[2]?.estimate ?? Number.NaN, -1.5, 1e-8);
    close(model.rSquared, 1, 1e-9);
  });

  it('drops rows with a missing predictor rather than imputing them', () => {
    const model = ols([1, 2, null, 4], [[1, 2, 3, 4]], { names: ['x'] });
    assert.ok(model !== null);
    assert.equal(model.n, 3);
  });

  it('predicts from its own coefficients', () => {
    const model = ols(y, [x], { names: ['x'] });
    assert.ok(model !== null);
    close(predictOls(model, [3]), 4, 1e-9);
  });

  it('reports robust standard errors on request', () => {
    const plain = ols(y, [x], { names: ['x'] });
    const robust = ols(y, [x], { names: ['x'], robust: true });
    assert.ok(plain !== null && robust !== null);
    // Same point estimate, different uncertainty: that is the whole point of HC1.
    close(robust.coefficients[1]?.estimate ?? 0, plain.coefficients[1]?.estimate ?? 1, 1e-12);
    assert.notEqual(robust.coefficients[1]?.standardError, plain.coefficients[1]?.standardError);
  });

  it('returns null when there are fewer rows than parameters', () => {
    assert.equal(
      ols(
        [1, 2],
        [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
      ),
      null,
    );
  });
});

describe('ridge', () => {
  it('shrinks coefficients towards zero as lambda grows', () => {
    const rng = createRng(7);
    const x1: number[] = [];
    const x2: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const a = rng.normal();
      // Deliberately collinear, which is where ridge earns its place.
      const b = a * 0.95 + rng.normal() * 0.1;
      x1.push(a);
      x2.push(b);
      y.push(2 * a + 1 * b + rng.normal() * 0.2);
    }
    const light = ridge(y, [x1, x2], { names: ['a', 'b'], lambda: 0.01 });
    const heavy = ridge(y, [x1, x2], { names: ['a', 'b'], lambda: 500 });
    assert.ok(light !== null && heavy !== null);
    const lightSize =
      Math.abs(light.coefficients[0]?.estimate ?? 0) +
      Math.abs(light.coefficients[1]?.estimate ?? 0);
    const heavySize =
      Math.abs(heavy.coefficients[0]?.estimate ?? 0) +
      Math.abs(heavy.coefficients[1]?.estimate ?? 0);
    assert.ok(heavySize < lightSize);
    assert.ok(light.rSquared > 0.9);
  });

  it('chooses a lambda by cross validation when none is given', () => {
    const rng = createRng(11);
    const x = Array.from({ length: 120 }, () => rng.normal());
    const y = x.map((value) => 1.5 * value + rng.normal() * 0.3);
    const model = ridge(y, [x], { names: ['x'] });
    assert.ok(model !== null);
    assert.ok(model.path.length > 1);
    assert.ok(model.lambda > 0);
    close(model.coefficients[0]?.estimate ?? 0, 1.5, 0.2);
  });
});

describe('logistic', () => {
  it('recovers the coefficients that generated the labels', () => {
    const rng = createRng(3);
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 3000; i += 1) {
      const value = rng.normal();
      const p = 1 / (1 + Math.exp(-(-0.5 + 1.5 * value)));
      x.push(value);
      y.push(rng.next() < p ? 1 : 0);
    }
    const model = logistic(y, [x], { names: ['x'] });
    assert.ok(model !== null);
    assert.ok(model.converged);
    close(model.coefficients[0]?.estimate ?? 0, -0.5, 0.15);
    close(model.coefficients[1]?.estimate ?? 0, 1.5, 0.2);
    assert.ok(model.pseudoRSquared > 0.1);
    // A predictor that strong must be significant at this sample size.
    assert.ok((model.coefficients[1]?.pValue ?? 1) < 1e-10);
  });

  it('predicts a probability inside the unit interval', () => {
    const model = logistic([0, 0, 1, 1, 1], [[1, 2, 3, 4, 5]], { names: ['x'] });
    assert.ok(model !== null);
    const p = predictLogistic(model, [3]);
    assert.ok(p > 0 && p < 1);
  });
});

describe('collinearity and smoothing', () => {
  it('flags a variance inflation factor above one for correlated columns', () => {
    const rng = createRng(5);
    const a = Array.from({ length: 100 }, () => rng.normal());
    const b = a.map((value) => value + rng.normal() * 0.05);
    const factors = vif([a, b], ['a', 'b']);
    assert.ok((factors[0]?.vif ?? 0) > 5);
  });

  it('smooths a curve without assuming its shape', () => {
    const x = Array.from({ length: 400 }, (_, i) => i / 40);
    const y = x.map((value) => Math.sin(value));
    const smoothed = loess(x, y, { span: 0.1, points: 60 });
    assert.equal(smoothed.length, 60);
    for (const point of smoothed) {
      assert.ok(Math.abs(point.y - Math.sin(point.x)) < 0.02, `error at x ${point.x}`);
    }
  });

  it('trades bias for smoothness as the span widens', () => {
    const x = Array.from({ length: 400 }, (_, i) => i / 40);
    const y = x.map((value) => Math.sin(value));
    const worst = (span: number): number =>
      loess(x, y, { span, points: 60 }).reduce(
        (largest, point) => Math.max(largest, Math.abs(point.y - Math.sin(point.x))),
        0,
      );
    // A wider neighbourhood flattens curvature, which is the documented trade,
    // not a defect: the test pins the direction so a change of kernel shows up.
    assert.ok(worst(0.05) < worst(0.2));
  });
});

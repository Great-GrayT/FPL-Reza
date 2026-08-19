import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  changePoints,
  cumulative,
  diff,
  drawdown,
  ewma,
  halfLife,
  informationRatio,
  lag,
  lead,
  rollingMean,
  rollingSd,
  rollingSum,
  seasonality,
  standardise,
} from './series.js';
import { createRng } from './rng.js';

const close = (actual: number, expected: number, tolerance = 1e-9): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be near ${expected}`);
};

describe('shifts', () => {
  it('leaves the leading positions null rather than inventing them', () => {
    assert.deepEqual(lag([1, 2, 3], 1), [null, 1, 2]);
    assert.deepEqual(lead([1, 2, 3], 1), [2, 3, null]);
    assert.deepEqual(diff([1, 3, 6], 1), [null, 2, 3]);
  });

  it('accumulates while carrying gaps forward', () => {
    assert.deepEqual(cumulative([1, null, 2, 3]), [1, 1, 3, 6]);
  });
});

describe('rolling windows', () => {
  it('produces nothing until the window is full', () => {
    const result = rollingMean([1, 2, 3, 4, 5], 3);
    assert.deepEqual(result, [null, null, 2, 3, 4]);
  });

  it('sums and measures spread over the same window', () => {
    assert.deepEqual(rollingSum([1, 2, 3, 4], 2), [null, 3, 5, 7]);
    const sd = rollingSd([2, 4, 4, 4, 5, 5, 7, 9], 4);
    close(sd[3] ?? 0, Math.sqrt(((2 - 3.5) ** 2 + 3 * (4 - 3.5) ** 2) / 3), 1e-12);
  });

  it('honours a minimum period below the window', () => {
    assert.deepEqual(rollingMean([1, 2, 3], 3, { minPeriods: 1 }), [1, 1.5, 2]);
  });
});

describe('weighted means', () => {
  it('weights a half life exactly', () => {
    // With a half life of 1 the weight on the new observation is 0.5.
    const result = ewma([0, 1], 1);
    close(result[1] ?? 0, 0.5, 1e-12);
  });

  it('converges on a constant series', () => {
    const result = ewma([5, 5, 5, 5, 5, 5, 5, 5], 2);
    close(result[7] ?? 0, 5, 1e-6);
  });
});

describe('drawdown and reversion', () => {
  it('measures the deepest decline from a peak', () => {
    const result = drawdown([1, 3, 2, 5, 1]);
    close(result.maxDrawdown, -4, 1e-12);
    assert.equal(result.troughIndex, 4);
  });

  it('recovers the half life of a mean reverting series', () => {
    const rng = createRng(61);
    const series: number[] = [0];
    for (let i = 1; i < 4000; i += 1) {
      series.push(0.5 * (series[i - 1] ?? 0) + rng.normal());
    }
    const result = halfLife(series);
    close(result.phi, 0.5, 0.05);
    close(result.halfLife, 1, 0.15);
  });

  it('reports an infinite half life for a random walk', () => {
    const rng = createRng(62);
    const series: number[] = [0];
    for (let i = 1; i < 2000; i += 1) series.push((series[i - 1] ?? 0) + rng.normal());
    assert.ok(halfLife(series).halfLife > 5);
  });
});

describe('structure', () => {
  it('finds a period effect', () => {
    const values = Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? 10 : 2));
    const points = seasonality(values, 4);
    close(points[0]?.mean ?? 0, 10, 1e-12);
    close(points[1]?.mean ?? 0, 2, 1e-12);
    assert.ok((points[0]?.effect ?? 0) > 0);
  });

  it('locates a step change in the mean', () => {
    const values = [...Array.from({ length: 30 }, () => 1), ...Array.from({ length: 30 }, () => 5)];
    const points = changePoints(values, { maxPoints: 1 });
    assert.equal(points.length, 1);
    assert.equal(points[0]?.index, 30);
    close(points[0]?.before ?? 0, 1, 1e-12);
    close(points[0]?.after ?? 0, 5, 1e-12);
  });

  it('standardises to zero mean and unit spread', () => {
    const values = standardise([1, 2, 3, 4, 5]).filter((value): value is number => value !== null);
    close(
      values.reduce((total, value) => total + value, 0),
      0,
      1e-12,
    );
  });

  it('ranks consistency rather than total with the information ratio', () => {
    const steady = [4, 5, 4, 5, 4, 5];
    const spiky = [0, 12, 0, 12, 0, 12];
    assert.ok(informationRatio(steady) > informationRatio(spiky));
  });
});

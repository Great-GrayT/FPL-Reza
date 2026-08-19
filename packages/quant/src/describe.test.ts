import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  boxSummary,
  describe as describeColumn,
  ecdf,
  histogram,
  kde,
  qqPoints,
} from './describe.js';
import { normalQuantile } from './special.js';

const close = (actual: number, expected: number, tolerance = 1e-9): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be near ${expected}`);
};

describe('describe', () => {
  it('summarises a known sample', () => {
    const result = describeColumn([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(result.count, 10);
    assert.equal(result.missing, 0);
    close(result.mean, 5.5);
    // Sample standard deviation, Bessel corrected.
    close(result.sd, Math.sqrt(9.166666666666666), 1e-12);
    // Type 7 quantiles, the R and NumPy default.
    close(result.q1, 3.25);
    close(result.median, 5.5);
    close(result.q3, 7.75);
    close(result.iqr, 4.5);
    close(result.sum, 55);
  });

  it('counts missing values without folding them into the mean', () => {
    const result = describeColumn([2, null, 4, undefined, Number.NaN, 6]);
    assert.equal(result.count, 3);
    assert.equal(result.missing, 3);
    close(result.mean, 4);
  });

  it('reports zero skewness for a symmetric sample', () => {
    const result = describeColumn([-2, -1, 0, 1, 2]);
    close(result.skewness, 0, 1e-12);
  });

  it('bins a histogram over the requested range', () => {
    const bins = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { bins: 5, from: 0, to: 10 });
    assert.equal(bins.length, 5);
    assert.deepEqual(
      bins.map((bin) => bin.count),
      [2, 2, 2, 2, 2],
    );
    close(
      bins.reduce((total, bin) => total + bin.density, 0),
      1,
      1e-12,
    );
  });

  it('integrates a density to about one', () => {
    const sample = Array.from({ length: 400 }, (_, i) => normalQuantile((i + 0.5) / 400));
    const points = kde(sample, { points: 256 });
    const step = (points[1]?.x ?? 0) - (points[0]?.x ?? 0);
    const area = points.reduce((total, point) => total + point.density * step, 0);
    close(area, 1, 0.02);
  });

  it('produces an increasing empirical distribution ending at one', () => {
    const points = ecdf([3, 1, 2, 2]);
    assert.deepEqual(
      points.map((point) => point.x),
      [1, 2, 3],
    );
    close(points[2]?.p ?? 0, 1);
    close(points[1]?.p ?? 0, 0.75);
  });

  it('separates whiskers from outliers by the Tukey fence', () => {
    const summary = boxSummary([1, 2, 3, 4, 5, 100]);
    assert.ok(summary !== null);
    assert.deepEqual(summary.outliers, [100]);
    assert.equal(summary.upperWhisker, 5);
  });

  it('lays a normal sample on a straight qq line', () => {
    const sample = Array.from({ length: 200 }, (_, i) => normalQuantile((i + 0.5) / 200));
    const points = qqPoints(sample, normalQuantile);
    const first = points[10];
    const last = points[189];
    assert.ok(first !== undefined && last !== undefined);
    close(first.sample - first.theoretical, 0, 0.05);
    close(last.sample - last.theoretical, 0, 0.05);
  });
});

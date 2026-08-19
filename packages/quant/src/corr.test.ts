import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acf,
  correlationMatrix,
  crossCorrelation,
  kendall,
  pacf,
  pearson,
  spearman,
} from './corr.js';
import { createRng } from './rng.js';

const close = (actual: number, expected: number, tolerance = 1e-9): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be near ${expected}`);
};

describe('correlation', () => {
  it('reports a perfect linear relationship as one', () => {
    const result = pearson([1, 2, 3, 4], [2, 4, 6, 8]);
    close(result.r, 1, 1e-12);
    assert.equal(result.n, 4);
  });

  it('matches the textbook coefficient', () => {
    // r = 0.7745966692 for this pair, which R prints for cor(x, y).
    const result = pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
    close(result.r, 0.7745966692, 1e-9);
    close(result.pValue, 0.1240270627, 1e-9);
  });

  it('separates a monotone relationship from a linear one', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [1, 4, 9, 16, 25];
    close(spearman(x, y).r, 1, 1e-12);
    assert.ok(pearson(x, y).r < 1);
  });

  it('handles ties in the rank methods', () => {
    const result = spearman([1, 2, 2, 3], [1, 2, 2, 3]);
    close(result.r, 1, 1e-12);
  });

  it('computes Kendall tau against a hand counted example', () => {
    // Three concordant pairs and no discordant ones.
    close(kendall([1, 2, 3], [2, 4, 6]).r, 1, 1e-12);
    close(kendall([1, 2, 3], [6, 4, 2]).r, -1, 1e-12);
  });

  it('drops a pair when either side is missing', () => {
    const result = pearson([1, 2, null, 4, 5], [2, 4, 6, null, 10]);
    assert.equal(result.n, 3);
    close(result.r, 1, 1e-12);
  });

  it('builds a symmetric matrix with ones on the diagonal', () => {
    const matrix = correlationMatrix([
      { name: 'a', values: [1, 2, 3, 4] },
      { name: 'b', values: [2, 4, 6, 8] },
      { name: 'c', values: [4, 3, 2, 1] },
    ]);
    close(matrix.values[0]?.[0] ?? 0, 1);
    close(matrix.values[0]?.[1] ?? 0, 1, 1e-12);
    close(matrix.values[0]?.[2] ?? 0, -1, 1e-12);
    close(matrix.values[2]?.[0] ?? 0, matrix.values[0]?.[2] ?? 1, 1e-12);
  });
});

describe('autocorrelation', () => {
  it('starts at one and decays for an AR(1) series', () => {
    const rng = createRng(41);
    const series: number[] = [0];
    for (let i = 1; i < 2000; i += 1) {
      series.push(0.6 * (series[i - 1] ?? 0) + rng.normal());
    }
    const values = acf(series, 5);
    close(values[0]?.value ?? 0, 1, 1e-12);
    close(values[1]?.value ?? 0, 0.6, 0.06);
    close(values[2]?.value ?? 0, 0.36, 0.08);
  });

  it('cuts off after the first lag in the partial autocorrelation', () => {
    const rng = createRng(42);
    const series: number[] = [0];
    for (let i = 1; i < 3000; i += 1) {
      series.push(0.6 * (series[i - 1] ?? 0) + rng.normal());
    }
    const values = pacf(series, 5);
    close(values[1]?.value ?? 0, 0.6, 0.06);
    // An AR(1) has no partial correlation left at lag two.
    assert.ok(Math.abs(values[2]?.value ?? 1) < 0.08);
  });

  it('finds the lead where one series drives another', () => {
    const rng = createRng(43);
    const driver = Array.from({ length: 500 }, () => rng.normal());
    const follower = driver.map((_, i) => (driver[i - 2] ?? 0) + rng.normal() * 0.1);
    const values = crossCorrelation(driver, follower, 4);
    const best = values.reduce((left, right) =>
      Math.abs(right.value) > Math.abs(left.value) ? right : left,
    );
    assert.equal(best.lag, 2);
  });
});

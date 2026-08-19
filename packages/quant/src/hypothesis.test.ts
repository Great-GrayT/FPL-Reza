import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bootstrapCi,
  falseDiscoveryRate,
  mannWhitney,
  permutationTest,
  proportionTest,
  tTest,
  tTestOneSample,
  tTestPaired,
  wilcoxon,
} from './hypothesis.js';
import { mean } from './internal.js';
import { createRng } from './rng.js';

const close = (actual: number, expected: number, tolerance = 1e-6): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be near ${expected}`);
};

describe('t tests', () => {
  it('matches a hand computed one sample test', () => {
    // mean 5, sample sd 1.49071, n 10, so t = (5 - 4) / (1.49071 / sqrt(10)).
    const sample = [3, 3, 4, 4, 5, 5, 6, 6, 7, 7];
    const result = tTestOneSample(sample, 4);
    close(result.estimate, 1, 1e-12);
    close(result.statistic, 2.1213203436, 1e-9);
    close(result.pValue, 0.062902508, 1e-9);
    assert.equal(result.degreesOfFreedom, 9);
  });

  it('runs Welch by default and pooled on request', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [3, 5, 7, 9, 11];
    const welch = tTest(a, b);
    const pooled = tTest(a, b, { equalVariance: true });
    close(welch.estimate, -4, 1e-12);
    assert.equal(pooled.degreesOfFreedom, 8);
    assert.ok((welch.degreesOfFreedom ?? 0) < 8);
    assert.equal(welch.name, "Welch's t");
  });

  it('reads a one sided alternative in the requested direction', () => {
    const a = [5, 6, 7, 8, 9];
    const b = [1, 2, 3, 4, 5];
    const greater = tTest(a, b, { alternative: 'greater' });
    const less = tTest(a, b, { alternative: 'less' });
    assert.ok(greater.pValue < 0.05);
    assert.ok(less.pValue > 0.95);
  });

  it('tests paired differences rather than group means', () => {
    const before = [10, 12, 14, 16, 18];
    const after = [11, 14, 15, 18, 21];
    const result = tTestPaired(after, before);
    close(result.estimate, 1.8, 1e-12);
    assert.ok(result.pValue < 0.05);
  });
});

describe('rank tests', () => {
  it('finds a shift Mann-Whitney should find', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    const b = [5, 6, 7, 8, 9, 10, 11, 12];
    const result = mannWhitney(a, b);
    assert.ok(result.pValue < 0.05);
    assert.ok(result.estimate < 0);
  });

  it('finds nothing when the two samples are the same', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8];
    assert.ok(mannWhitney(values, values).pValue > 0.9);
  });

  it('signs the ranks of paired differences', () => {
    const before = Array.from({ length: 20 }, (_, i) => i);
    const after = before.map((value) => value + 2);
    const result = wilcoxon(after, before);
    assert.ok(result.pValue < 0.001);
  });
});

describe('proportions', () => {
  it('separates two clearly different rates', () => {
    const result = proportionTest(80, 100, 50, 100);
    close(result.estimate, 0.3, 1e-12);
    assert.ok(result.pValue < 0.001);
  });

  it('finds nothing between two equal rates', () => {
    assert.ok(proportionTest(50, 100, 50, 100).pValue > 0.9);
  });
});

describe('resampling', () => {
  it('brackets the true mean and repeats exactly on the same seed', () => {
    const rng = createRng(51);
    const sample = Array.from({ length: 400 }, () => 5 + rng.normal());
    const first = bootstrapCi(sample, (values) => mean(values), { resamples: 500, seed: 9 });
    const second = bootstrapCi(sample, (values) => mean(values), { resamples: 500, seed: 9 });
    assert.equal(first.lower, second.lower);
    assert.equal(first.upper, second.upper);
    assert.ok(first.lower < 5 && first.upper > 5);
  });

  it('gives a different interval on a different seed but the same estimate', () => {
    const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = bootstrapCi(sample, (values) => mean(values), { resamples: 300, seed: 1 });
    const b = bootstrapCi(sample, (values) => mean(values), { resamples: 300, seed: 2 });
    close(a.estimate, b.estimate, 1e-12);
    assert.notEqual(a.lower, b.lower);
  });

  it('detects a real difference by permutation and clears a fake one', () => {
    const rng = createRng(52);
    const a = Array.from({ length: 120 }, () => rng.normal() + 1);
    const b = Array.from({ length: 120 }, () => rng.normal());
    const real = permutationTest(a, b, undefined, { resamples: 400, seed: 4 });
    assert.ok(real.pValue < 0.01, `p was ${real.pValue}`);

    const c = Array.from({ length: 120 }, () => rng.normal());
    const d = Array.from({ length: 120 }, () => rng.normal());
    assert.ok(permutationTest(c, d, undefined, { resamples: 400, seed: 4 }).pValue > 0.05);
  });

  it('never reports a permutation p value of exactly zero', () => {
    const a = Array.from({ length: 50 }, (_, i) => 100 + i);
    const b = Array.from({ length: 50 }, (_, i) => i);
    const result = permutationTest(a, b, undefined, { resamples: 200, seed: 3 });
    assert.ok(result.pValue > 0);
    close(result.pValue, 1 / 201, 1e-12);
  });
});

describe('multiple testing', () => {
  it('keeps the strong findings and drops the borderline ones', () => {
    // Thresholds are (rank / 5) * 0.05, so 0.039 at rank three already fails.
    const flagged = falseDiscoveryRate([0.001, 0.008, 0.039, 0.041, 0.9], 0.05);
    assert.deepEqual(
      flagged.map((entry) => entry.significant),
      [true, true, false, false, false],
    );
  });

  it('rejects nothing when every p value is large', () => {
    const flagged = falseDiscoveryRate([0.2, 0.4, 0.6, 0.8], 0.05);
    assert.ok(flagged.every((entry) => !entry.significant));
  });
});

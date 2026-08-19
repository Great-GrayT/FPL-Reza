import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  andersonDarling,
  beta,
  binomial,
  chiSquareTest,
  exponential,
  fitNegativeBinomial,
  fitNormal,
  fitPoisson,
  ksTest,
  negativeBinomial,
  normal,
  poisson,
} from './dist.js';
import { createRng } from './rng.js';

const close = (actual: number, expected: number, tolerance = 1e-9): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be near ${expected}`);
};

describe('distributions', () => {
  it('gives the Poisson mass and tail at reference points', () => {
    const law = poisson(3);
    close(law.pdf(0), Math.exp(-3), 1e-12);
    close(law.pdf(2), (Math.exp(-3) * 9) / 2, 1e-12);
    close(law.cdf(2), Math.exp(-3) * (1 + 3 + 4.5), 1e-10);
    close(law.mean, 3);
    close(law.variance, 3);
  });

  it('matches the normal cdf at the two sigma points', () => {
    const law = normal(10, 2);
    close(law.cdf(10), 0.5, 1e-12);
    close(law.cdf(13.92), 0.975002104852, 1e-8);
    close(law.quantile(0.975), 13.919927969, 1e-6);
  });

  it('keeps the negative binomial overdispersed', () => {
    const law = negativeBinomial(4, 0.4);
    close(law.mean, 6, 1e-12);
    close(law.variance, 15, 1e-12);
    // The mass has to sum to one over its support.
    let total = 0;
    for (let k = 0; k <= 200; k += 1) total += law.pdf(k);
    close(total, 1, 1e-8);
  });

  it('agrees between the binomial mass and its cdf', () => {
    const law = binomial(10, 0.3);
    let cumulative = 0;
    for (let k = 0; k <= 4; k += 1) cumulative += law.pdf(k);
    close(law.cdf(4), cumulative, 1e-9);
    close(law.mean, 3, 1e-12);
  });

  it('inverts the exponential and beta cdfs', () => {
    const law = exponential(0.5);
    close(law.cdf(law.quantile(0.3)), 0.3, 1e-8);
    const shape = beta(2, 5);
    close(shape.cdf(shape.quantile(0.8)), 0.8, 1e-6);
    close(shape.mean, 2 / 7, 1e-12);
  });
});

describe('fitting', () => {
  it('recovers a normal it generated', () => {
    const rng = createRng(21);
    const sample = Array.from({ length: 5000 }, () => 4 + 1.5 * rng.normal());
    const fitted = fitNormal(sample);
    close(fitted.parameters['mu'] ?? 0, 4, 0.1);
    close(fitted.parameters['sigma'] ?? 0, 1.5, 0.1);
  });

  it('recovers a Poisson it generated', () => {
    const rng = createRng(22);
    const sample = Array.from({ length: 5000 }, () => rng.poisson(2.6));
    const fitted = fitPoisson(sample);
    close(fitted.parameters['lambda'] ?? 0, 2.6, 0.1);
  });

  it('fits a negative binomial to overdispersed counts', () => {
    const rng = createRng(23);
    const law = negativeBinomial(3, 0.3);
    const sample = Array.from({ length: 4000 }, () => law.sample(rng));
    const fitted = fitNegativeBinomial(sample);
    close(fitted.mean, law.mean, 0.6);
    assert.ok(fitted.variance > fitted.mean);
  });
});

describe('goodness of fit', () => {
  it('does not reject a sample drawn from the reference law', () => {
    const rng = createRng(31);
    const sample = Array.from({ length: 800 }, () => rng.normal());
    const law = normal(0, 1);
    const ks = ksTest(sample, (x) => law.cdf(x));
    const ad = andersonDarling(sample, (x) => law.cdf(x));
    assert.ok(ks.pValue > 0.05, `ks p was ${ks.pValue}`);
    assert.ok(ad.pValue > 0.05, `ad p was ${ad.pValue}`);
  });

  it('rejects a sample from a different law', () => {
    const rng = createRng(32);
    const sample = Array.from({ length: 800 }, () => 3 + rng.normal());
    const ks = ksTest(sample, (x) => normal(0, 1).cdf(x));
    assert.ok(ks.pValue < 0.001);
    assert.match(ks.verdict, /departs/);
  });

  it('accepts Poisson counts and rejects overdispersed ones', () => {
    const rng = createRng(33);
    const poissonSample = Array.from({ length: 2000 }, () => rng.poisson(2.5));
    const fair = chiSquareTest(poissonSample, fitPoisson(poissonSample));
    assert.ok(fair.pValue > 0.01, `p was ${fair.pValue}`);

    const overdispersed = negativeBinomial(2, 0.45);
    const wide = Array.from({ length: 2000 }, () => overdispersed.sample(rng));
    const unfair = chiSquareTest(wide, fitPoisson(wide));
    assert.ok(unfair.pValue < 0.01, `p was ${unfair.pValue}`);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chiSquareP,
  erf,
  fP,
  logGamma,
  normalCdf,
  normalQuantile,
  tQuantile,
  tTwoSided,
} from './special.js';

/** Reference values are the ones scipy and R print for the same call. */
const close = (actual: number, expected: number, tolerance = 1e-6): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

describe('special functions', () => {
  it('computes log gamma against known factorials', () => {
    close(logGamma(1), 0, 1e-10);
    close(logGamma(5), Math.log(24), 1e-10);
    close(logGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-10);
  });

  it('computes the error function at reference points', () => {
    close(erf(0), 0, 1e-12);
    close(erf(1), 0.842700792949715, 1e-9);
    close(erf(-1), -0.842700792949715, 1e-9);
  });

  it('computes the normal cdf and its inverse', () => {
    close(normalCdf(0), 0.5, 1e-12);
    close(normalCdf(1.96), 0.975002104852, 1e-9);
    close(normalQuantile(0.975), 1.95996398454, 1e-8);
    close(normalQuantile(normalCdf(-0.7)), -0.7, 1e-8);
  });

  it('computes student t tails', () => {
    // The 5 percent two sided critical value at 10 degrees of freedom.
    close(tTwoSided(2.228138852, 10), 0.05, 1e-6);
    close(tQuantile(0.975, 10), 2.228138852, 1e-6);
    close(tQuantile(0.975, 1e7), 1.959963984, 1e-4);
  });

  it('computes chi square and F tails', () => {
    close(chiSquareP(3.841458821, 1), 0.05, 1e-6);
    close(chiSquareP(11.070497694, 5), 0.05, 1e-6);
    close(fP(4.964602743, 5, 10), 0.0152144024, 1e-8);
  });
});

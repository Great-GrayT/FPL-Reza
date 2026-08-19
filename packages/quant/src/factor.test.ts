import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareFactors,
  icDecay,
  informationCoefficient,
  quantileSpread,
  rankNormaliseByPeriod,
  turnover,
  winsorise,
  zScoreByPeriod,
  type FactorObservation,
} from './factor.js';
import { createRng } from './rng.js';

const close = (actual: number, expected: number, tolerance = 1e-9): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be near ${expected}`);
};

/** A factor whose correlation with the forward return is exactly what is asked for. */
function build(periods: number, players: number, noise: number, seed = 1): FactorObservation[] {
  const rng = createRng(seed);
  const out: FactorObservation[] = [];
  for (let period = 1; period <= periods; period += 1) {
    for (let id = 1; id <= players; id += 1) {
      const factor = rng.normal();
      out.push({ id, period, factor, forward: factor + noise * rng.normal() });
    }
  }
  return out;
}

describe('information coefficient', () => {
  it('reports one for a perfectly ordering factor', () => {
    const observations = build(10, 40, 0);
    const summary = informationCoefficient(observations);
    close(summary.mean, 1, 1e-9);
    assert.equal(summary.periods, 10);
    close(summary.hitRate, 1, 1e-12);
  });

  it('reports about zero for an unrelated factor', () => {
    const rng = createRng(2);
    const observations: FactorObservation[] = [];
    for (let period = 1; period <= 30; period += 1) {
      for (let id = 1; id <= 60; id += 1) {
        observations.push({ id, period, factor: rng.normal(), forward: rng.normal() });
      }
    }
    const summary = informationCoefficient(observations);
    assert.ok(Math.abs(summary.mean) < 0.05, `mean ic was ${summary.mean}`);
    assert.ok(summary.pValue > 0.05);
  });

  it('finds a weak signal that a single period would miss', () => {
    const summary = informationCoefficient(build(38, 200, 3, 5));
    assert.ok(summary.mean > 0.15 && summary.mean < 0.45, `mean ic was ${summary.mean}`);
    assert.ok(summary.pValue < 1e-6);
    assert.ok(summary.informationRatio > 1);
  });

  it('skips a period with too few names rather than reporting a noisy coefficient', () => {
    const observations = [...build(3, 30, 0.5, 7), { id: 999, period: 99, factor: 1, forward: 1 }];
    assert.equal(informationCoefficient(observations).periods, 3);
  });

  it('ignores rows with a missing factor or a missing return', () => {
    const observations: FactorObservation[] = [
      ...build(2, 20, 0.2, 9),
      { id: 500, period: 1, factor: null, forward: 5 },
      { id: 501, period: 1, factor: 5, forward: null },
    ];
    assert.equal(informationCoefficient(observations).periods, 2);
  });
});

describe('decay', () => {
  it('falls away as the horizon lengthens', () => {
    const points = icDecay([
      { horizon: 1, observations: build(20, 80, 1, 11) },
      { horizon: 3, observations: build(20, 80, 3, 12) },
      { horizon: 6, observations: build(20, 80, 9, 13) },
    ]);
    assert.equal(points.length, 3);
    assert.ok((points[0]?.ic ?? 0) > (points[1]?.ic ?? 0));
    assert.ok((points[1]?.ic ?? 0) > (points[2]?.ic ?? 0));
  });
});

describe('quantile spread', () => {
  it('orders the buckets monotonically for a real factor', () => {
    const spread = quantileSpread(build(30, 100, 2, 17), 5);
    assert.equal(spread.buckets.length, 5);
    assert.ok(spread.spread > 0);
    assert.ok(spread.pValue < 0.001);
    assert.ok(spread.monotonicity > 0.9);
    const first = spread.buckets[0]?.meanForward ?? 0;
    const last = spread.buckets[4]?.meanForward ?? 0;
    assert.ok(last > first);
  });

  it('finds no spread in noise', () => {
    const rng = createRng(19);
    const observations: FactorObservation[] = [];
    for (let period = 1; period <= 30; period += 1) {
      for (let id = 1; id <= 100; id += 1) {
        observations.push({ id, period, factor: rng.normal(), forward: rng.normal() });
      }
    }
    assert.ok(quantileSpread(observations, 5).pValue > 0.05);
  });
});

describe('turnover', () => {
  it('is zero for a factor that never reorders', () => {
    const observations: FactorObservation[] = [];
    for (let period = 1; period <= 10; period += 1) {
      for (let id = 1; id <= 50; id += 1) {
        observations.push({ id, period, factor: id, forward: 1 });
      }
    }
    close(turnover(observations, 5).turnover, 0, 1e-12);
  });

  it('is high for a factor redrawn every period', () => {
    const rng = createRng(23);
    const observations: FactorObservation[] = [];
    for (let period = 1; period <= 20; period += 1) {
      for (let id = 1; id <= 50; id += 1) {
        observations.push({ id, period, factor: rng.normal(), forward: 1 });
      }
    }
    const result = turnover(observations, 5);
    assert.ok(result.turnover > 0.6, `turnover was ${result.turnover}`);
    assert.ok(result.averageHoldingPeriods < 2);
  });
});

describe('normalisation', () => {
  it('centres each period on its own mean', () => {
    const observations: FactorObservation[] = [
      { id: 1, period: 1, factor: 10, forward: 1 },
      { id: 2, period: 1, factor: 20, forward: 1 },
      { id: 1, period: 2, factor: 110, forward: 1 },
      { id: 2, period: 2, factor: 120, forward: 1 },
    ];
    const scored = zScoreByPeriod(observations);
    close(scored[0]?.factor ?? 0, scored[2]?.factor ?? 1, 1e-12);
  });

  it('maps ranks into the unit interval', () => {
    const scored = rankNormaliseByPeriod([
      { id: 1, period: 1, factor: 5, forward: 1 },
      { id: 2, period: 1, factor: 50, forward: 1 },
      { id: 3, period: 1, factor: 500, forward: 1 },
    ]);
    const values = scored.map((row) => row.factor ?? 0).sort((a, b) => a - b);
    close(values[0] ?? 0, 1 / 6, 1e-12);
    close(values[2] ?? 0, 5 / 6, 1e-12);
  });

  it('caps the extremes without dropping the row', () => {
    const values = winsorise([1, 2, 3, 4, 1000], 0.1);
    assert.equal(values.length, 5);
    assert.ok((values[4] ?? 0) < 1000);
  });
});

describe('comparison', () => {
  it('ranks a strong factor above a weak one', () => {
    const table = compareFactors([
      { name: 'weak', observations: build(20, 80, 6, 31) },
      { name: 'strong', observations: build(20, 80, 1, 32) },
    ]);
    assert.equal(table[0]?.name, 'strong');
    assert.ok((table[0]?.ic ?? 0) > (table[1]?.ic ?? 0));
  });
});

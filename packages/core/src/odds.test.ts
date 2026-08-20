import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fitGoalExpectations,
  fixtureOutlook,
  impliedProbability,
  matchOutcomeProbabilities,
  overround,
  poissonPmf,
  removeOverround,
  scorelineProbabilities,
  type OddsQuote,
} from './odds.js';

const quote = (
  market: OddsQuote['market'],
  selection: string,
  decimal: number,
  line: number | null = null,
): OddsQuote => ({
  provider: 'test',
  bookmaker: 'test',
  fixtureId: null,
  homeTeam: null,
  awayTeam: null,
  homeName: null,
  awayName: null,
  kickoff: null,
  market,
  selection,
  decimal,
  line,
  capturedAt: new Date('2026-08-16T00:00:00Z'),
});

const close = (actual: number, expected: number, tolerance = 1e-6): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

describe('implied probability', () => {
  it('inverts decimal odds', () => {
    close(impliedProbability(2), 0.5);
    close(impliedProbability(4), 0.25);
  });

  it('measures the bookmaker margin', () => {
    close(overround([0.5, 0.3, 0.25]), 0.05, 1e-9);
  });

  it('normalises the margin away', () => {
    const fair = removeOverround([0.5, 0.3, 0.25]);
    close(
      fair.reduce((a, b) => a + b, 0),
      1,
      1e-9,
    );
  });
});

describe('matchOutcomeProbabilities', () => {
  it('returns fair probabilities summing to one', () => {
    const result = matchOutcomeProbabilities([
      quote('match_odds', 'home', 1.8),
      quote('match_odds', 'draw', 3.8),
      quote('match_odds', 'away', 4.5),
    ]);
    assert.ok(result !== null);
    close(result.home + result.draw + result.away, 1, 1e-9);
    assert.ok(result.home > result.away);
  });

  it('returns null without a complete market', () => {
    assert.equal(matchOutcomeProbabilities([quote('match_odds', 'home', 1.8)]), null);
  });
});

describe('poisson model', () => {
  it('matches known pmf values', () => {
    close(poissonPmf(0, 1.5), Math.exp(-1.5), 1e-12);
    close(poissonPmf(2, 2), (Math.exp(-2) * 4) / 2, 1e-12);
  });

  it('produces a distribution that sums to one', () => {
    const model = scorelineProbabilities(1.6, 1.2);
    close(model.home + model.draw + model.away, 1, 1e-6);
  });

  it('derives a clean sheet from the opponent scoring nothing', () => {
    const model = scorelineProbabilities(1.6, 1.2);
    close(model.homeCleanSheet, Math.exp(-1.2), 1e-12);
    close(model.awayCleanSheet, Math.exp(-1.6), 1e-12);
  });
});

describe('fitGoalExpectations', () => {
  it('recovers the expectations it was generated from', () => {
    const truth = scorelineProbabilities(1.9, 0.9);
    const fitted = fitGoalExpectations({
      home: truth.home,
      draw: truth.draw,
      away: truth.away,
      over25: truth.over25,
    });
    close(fitted.home, 1.9, 0.06);
    close(fitted.away, 0.9, 0.06);
  });

  it('gives the stronger side the higher expectation', () => {
    const fitted = fitGoalExpectations({ home: 0.7, draw: 0.2, away: 0.1 });
    assert.ok(fitted.home > fitted.away);
  });
});

describe('fixtureOutlook', () => {
  it('combines the 1X2 and over under markets into clean sheet probabilities', () => {
    const outlook = fixtureOutlook([
      quote('match_odds', 'home', 1.6),
      quote('match_odds', 'draw', 4.2),
      quote('match_odds', 'away', 5.5),
      quote('over_under', 'over', 1.9, 2.5),
      quote('over_under', 'under', 1.95, 2.5),
    ]);

    assert.ok(outlook !== null);
    assert.ok(outlook.goals.home > outlook.goals.away);
    assert.ok(outlook.homeCleanSheet > outlook.awayCleanSheet);
    assert.ok(outlook.homeCleanSheet > 0 && outlook.homeCleanSheet < 1);
  });

  it('returns null when the match odds market is absent', () => {
    assert.equal(fixtureOutlook([quote('over_under', 'over', 1.9, 2.5)]), null);
  });
});

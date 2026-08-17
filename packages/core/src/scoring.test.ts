import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appearancePoints,
  cardPoints,
  defensiveContributionPoints,
  scorePlayerGameweek,
  type ScoringInput,
} from './scoring.js';
import { sellingPrice } from './rules.js';

const blank: ScoringInput = {
  minutes: 90,
  goals: 0,
  assists: 0,
  cleanSheet: false,
  goalsConceded: 0,
  saves: 0,
  penaltiesSaved: 0,
  penaltiesMissed: 0,
  yellowCards: 0,
  redCards: 0,
  ownGoals: 0,
  bonus: 0,
};

describe('appearancePoints', () => {
  it('pays nothing for an unused substitute', () => {
    assert.equal(appearancePoints(0), 0);
  });

  it('pays 1 below 60 minutes and 2 at 60', () => {
    assert.equal(appearancePoints(59), 1);
    assert.equal(appearancePoints(60), 2);
  });
});

describe('cardPoints', () => {
  it('deducts 1 per yellow', () => {
    assert.equal(cardPoints(1, 0), -1);
  });

  it('absorbs the yellow into a red rather than stacking them', () => {
    assert.equal(cardPoints(1, 1), -3);
  });
});

describe('defensiveContributionPoints', () => {
  it('uses a lower threshold for defenders', () => {
    assert.equal(defensiveContributionPoints('DEF', 10), 2);
    assert.equal(defensiveContributionPoints('MID', 10), 0);
    assert.equal(defensiveContributionPoints('MID', 12), 2);
  });

  it('does not stack past the threshold', () => {
    assert.equal(defensiveContributionPoints('DEF', 25), 2);
  });

  it('never pays a keeper', () => {
    assert.equal(defensiveContributionPoints('GKP', 40), 0);
  });
});

describe('scorePlayerGameweek', () => {
  it('scores a defender with a goal and a clean sheet', () => {
    const points = scorePlayerGameweek('DEF', { ...blank, goals: 1, cleanSheet: true, bonus: 3 });
    // 2 appearance, 6 goal, 4 clean sheet, 3 bonus
    assert.equal(points.total, 15);
  });

  it('withholds the clean sheet from a short appearance', () => {
    const points = scorePlayerGameweek('DEF', { ...blank, minutes: 45, cleanSheet: true });
    assert.equal(points.cleanSheet, 0);
    assert.equal(points.total, 1);
  });

  it('charges a keeper 1 point per 2 conceded and pays 1 per 3 saves', () => {
    const points = scorePlayerGameweek('GKP', { ...blank, goalsConceded: 3, saves: 7 });
    assert.equal(points.goalsConceded, -1);
    assert.equal(points.saves, 2);
    assert.equal(points.total, 3);
  });

  it('leaves midfield conceded goals alone', () => {
    const points = scorePlayerGameweek('MID', { ...blank, goalsConceded: 4 });
    assert.equal(points.goalsConceded, 0);
  });

  it('adds defensive contribution when the counts are supplied', () => {
    const points = scorePlayerGameweek('MID', { ...blank, defensiveContribution: 12 });
    assert.equal(points.defensiveContribution, 2);
    assert.equal(points.total, 4);
  });

  it('breakdown always sums to the total', () => {
    const points = scorePlayerGameweek('FWD', {
      ...blank,
      goals: 2,
      assists: 1,
      penaltiesMissed: 1,
      yellowCards: 1,
      ownGoals: 1,
      bonus: 2,
    });
    const { total, ...parts } = points;
    assert.equal(
      Object.values(parts).reduce((a, b) => a + b, 0),
      total,
    );
  });
});

describe('sellingPrice', () => {
  it('returns half the rise, rounded down to 0.1m', () => {
    // 7.5m bought, 7.8m now, sells at 7.6m
    assert.equal(sellingPrice(75, 78), 76);
  });

  it('passes a fall on in full', () => {
    assert.equal(sellingPrice(75, 71), 71);
  });

  it('is a no op when the price has not moved', () => {
    assert.equal(sellingPrice(75, 75), 75);
  });
});

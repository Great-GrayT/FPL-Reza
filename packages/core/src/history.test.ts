import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asSeason } from './ids.js';
import {
  careerTotals,
  fromArchiveSeason,
  playerSeasonSchema,
  toArchiveSeason,
  type PlayerSeason,
} from './history.js';

const season = (label: string, totalPoints: number, extras: Partial<PlayerSeason> = {}) =>
  playerSeasonSchema.parse({
    playerCode: 154561,
    season: asSeason(label),
    startPrice: 45,
    endPrice: 50,
    totalPoints,
    minutes: 2000,
    starts: 25,
    goals: 3,
    assists: 2,
    cleanSheets: 8,
    goalsConceded: 30,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    yellowCards: 2,
    redCards: 0,
    saves: 0,
    bonus: 6,
    bps: 400,
    influence: 500.5,
    creativity: 100,
    threat: 200,
    ictIndex: 80.1,
    expectedGoals: null,
    expectedAssists: null,
    expectedGoalsConceded: null,
    defensiveContribution: null,
    ...extras,
  });

describe('careerTotals', () => {
  it('sums the seasons and names the best one', () => {
    const totals = careerTotals([
      season('2023/24', 135),
      season('2022/23', 166),
      season('2021/22', 95),
    ]);

    assert.equal(totals.seasons, 3);
    assert.equal(totals.totalPoints, 396);
    assert.equal(totals.minutes, 6000);
    assert.equal(totals.goals, 9);
    assert.equal(totals.bonus, 18);
    assert.equal(totals.bestSeason, '2022/23');
    assert.equal(totals.bestSeasonPoints, 166);
  });

  it('keeps the earlier season when two tie on points, rather than the last read', () => {
    const totals = careerTotals([season('2023/24', 150), season('2022/23', 150)]);

    assert.equal(totals.bestSeason, '2023/24');
  });

  it('reports zeroes and no best season for a player with no completed seasons', () => {
    const totals = careerTotals([]);

    assert.equal(totals.seasons, 0);
    assert.equal(totals.totalPoints, 0);
    assert.equal(totals.bestSeason, null);
    assert.equal(totals.bestSeasonPoints, null);
  });
});

describe('archive season labels', () => {
  it('converts between the domain and archive spellings', () => {
    assert.equal(toArchiveSeason('2024/25'), '2024-25');
    assert.equal(fromArchiveSeason('2024-25'), '2024/25');
  });
});

describe('playerSeasonSchema', () => {
  it('rejects a season label in the archive spelling, which is a different type', () => {
    assert.throws(() => season('2024-25', 100));
  });

  it('keeps a measure the season did not record as null rather than zero', () => {
    const parsed = season('2021/22', 95);

    assert.equal(parsed.expectedGoals, null);
    assert.equal(parsed.defensiveContribution, null);
  });
});

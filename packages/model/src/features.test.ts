import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HistoricPlayerGameweek, ManagerSpell, Match } from '@fpl/core';
import {
  FEATURE_NAMES,
  buildFeatures,
  impliedShotDistance,
  impliedShotQuality,
} from './features.js';
import type { Panel } from './panel.js';

/**
 * The feature array is read back by position, so these tests are less about
 * arithmetic than about alignment: a block pushed in the wrong order relabels
 * every feature after it, and the model that results looks fine and means
 * nothing. One such bug shipped as "a manager's record predicts conceding".
 */

function gameweek(overrides: Partial<HistoricPlayerGameweek> = {}): HistoricPlayerGameweek {
  return {
    playerCode: 1,
    season: '2024/25',
    gameweek: 1,
    name: 'Test Player',
    position: 'MID',
    team: 'Arsenal',
    opponentTeam: 2,
    wasHome: true,
    kickoff: new Date('2024-08-17T14:00:00Z'),
    minutes: 90,
    totalPoints: 6,
    goals: 1,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 1,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 1,
    bps: 30,
    price: 75,
    selectedBy: 12,
    expectedGoals: 0.4,
    expectedAssists: 0.1,
    expectedGoalsConceded: 1.1,
    influence: 40,
    creativity: 20,
    threat: 45,
    ictIndex: 10,
    expectedPoints: 4.5,
    ...overrides,
  } as HistoricPlayerGameweek;
}

function match(overrides: Partial<Match> = {}): Match {
  return {
    matchId: 1,
    season: '2024/25',
    round: 1,
    kickoff: new Date('2024-08-10T14:00:00Z'),
    homeTeamCode: 3,
    awayTeamCode: 7,
    homeTeamName: 'Arsenal',
    awayTeamName: 'Aston Villa',
    homeScore: 2,
    awayScore: 0,
    halfTimeHomeScore: 1,
    halfTimeAwayScore: 0,
    status: 'completed',
    outcome: 'home',
    attendance: 60000,
    groundId: 1,
    groundName: 'Emirates',
    neutralGround: false,
    refereeId: null,
    refereeName: null,
    ...overrides,
  } as Match;
}

function panelOf(
  rows: HistoricPlayerGameweek[],
  matches: Match[] = [],
  spells: ManagerSpell[] = [],
): Panel {
  return {
    rows,
    teamCodeOf: (_season, teamId) => (teamId === 2 ? 7 : null),
    ownTeamCodeOf: () => 3,
    spells,
    matches,
    detailOf: () => null,
    detailSeasons: new Set(),
  };
}

describe('feature alignment', () => {
  const rows = Array.from({ length: 8 }, (_, index) =>
    gameweek({
      gameweek: index + 1,
      kickoff: new Date(Date.UTC(2024, 7, 17 + index * 7, 14)),
      minutes: 90,
      goals: index % 3 === 0 ? 1 : 0,
    }),
  );
  const matches = Array.from({ length: 8 }, (_, index) =>
    match({
      matchId: (index + 1) as Match['matchId'],
      kickoff: new Date(Date.UTC(2024, 7, 10 + index * 7, 14)),
      homeTeamCode: index % 2 === 0 ? 3 : 7,
      awayTeamCode: index % 2 === 0 ? 7 : 3,
    }),
  );

  const built = buildFeatures(panelOf(rows, matches), { minimumHistory: 3 });

  it('produces one value per declared name', () => {
    assert.ok(built.rows.length > 0);
    for (const row of built.rows) {
      assert.equal(row.values.length, FEATURE_NAMES.length);
    }
  });

  it('puts each value under the name that describes it', () => {
    const row = built.rows[built.rows.length - 1];
    assert.ok(row !== undefined);
    const value = (name: string): number => row.values[FEATURE_NAMES.indexOf(name)] ?? Number.NaN;

    // Sentinels chosen because each has a range nothing else in the array
    // shares, so a shift by even one position breaks at least one of them.
    assert.equal(value('is_home'), 1, 'the venue flag is a flag');
    assert.equal(value('gameweek'), row.gameweek, 'the gameweek is itself');
    assert.equal(value('price'), 75, 'the price is in tenths');
    assert.equal(value('minutes_mean_3'), 90, 'a player who played every minute averages ninety');
    assert.ok(value('appearances') >= 3, 'appearances counts the rows behind this one');
    assert.ok(value('rest_days') > 0, 'rest days is a positive number of days');
  });

  it('never lets a feature read the row it describes', () => {
    // Every row here scored, so a feature equal to this match's own goals would
    // be leakage. The rolling means may only see the rows before it.
    const first = built.rows[0];
    assert.ok(first !== undefined);
    const goalsMean = first.values[FEATURE_NAMES.indexOf('goals_mean_3')] ?? Number.NaN;
    assert.ok(Number.isFinite(goalsMean));
    assert.ok(goalsMean <= 1);
  });

  it('drops rows with less history than asked for', () => {
    assert.equal(built.rows.length + built.dropped, rows.length);
    assert.equal(built.dropped, 3);
  });
});

describe('shot origin transforms', () => {
  it('turns a higher quality into a shorter distance', () => {
    const close = impliedShotDistance(impliedShotQuality(0.05));
    const far = impliedShotDistance(impliedShotQuality(0.01));
    assert.ok(close < far, 'a better chance is a closer one');
  });

  it('stays inside the pitch', () => {
    for (const perThreat of [0.0001, 0.01, 0.05, 0.2, 1]) {
      const distance = impliedShotDistance(impliedShotQuality(perThreat));
      if (!Number.isFinite(distance)) continue;
      assert.ok(distance >= 4 && distance <= 35);
    }
  });

  it('is missing rather than zero where there is nothing to invert', () => {
    assert.ok(Number.isNaN(impliedShotQuality(0)));
    assert.ok(Number.isNaN(impliedShotDistance(Number.NaN)));
  });
});

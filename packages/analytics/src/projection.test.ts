import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fixtureSchema,
  playerGameweekSchema,
  playerSchema,
  asTeamId,
  type Fixture,
  type Player,
  type PlayerGameweek,
} from '@fpl/core';
import {
  AVAILABILITY_WEIGHT,
  DIFFICULTY_STEP,
  differentials,
  fixtureSwings,
  projectPoints,
} from './projection.js';
import { GLOSSARY, GLOSSARY_IDS, glossaryEntry } from './glossary.js';

let nextId = 100;

function player(overrides: Partial<Record<string, unknown>> = {}): Player {
  const id = nextId++;
  return playerSchema.parse({
    id,
    code: 200000 + id,
    firstName: 'Test',
    secondName: `Player ${String(id)}`,
    webName: `P${String(id)}`,
    teamId: 1,
    position: 'MID',
    price: 80,
    startPrice: 80,
    totalPoints: 152,
    minutes: 2500,
    goals: 10,
    assists: 8,
    cleanSheets: 5,
    goalsConceded: 20,
    yellowCards: 3,
    redCards: 0,
    saves: 0,
    bonus: 15,
    bps: 500,
    form: 4,
    pointsPerGame: 4,
    selectedByPercent: 20,
    expectedGoals: 8,
    expectedAssists: 6,
    expectedGoalInvolvements: 14,
    expectedGoalsConceded: 30,
    availability: 'available',
    news: '',
    chanceOfPlayingNextRound: null,
    ...overrides,
  });
}

function gameweek(gw: number, points: number, minutes: number): PlayerGameweek {
  return playerGameweekSchema.parse({
    playerId: 100,
    gameweek: gw,
    fixtureId: gw,
    opponentTeam: 2,
    wasHome: true,
    kickoff: new Date('2026-08-21T18:30:00Z'),
    minutes,
    totalPoints: points,
    goals: 0,
    assists: 0,
    cleanSheet: false,
    goalsConceded: 1,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 0,
    bps: 10,
    expectedGoals: 0.1,
    expectedAssists: 0.1,
    expectedGoalsConceded: 1,
    defensiveContribution: null,
    price: 80,
  });
}

function fixture(id: number, gw: number, home: number, away: number, difficulty: number): Fixture {
  return fixtureSchema.parse({
    id,
    gameweek: gw,
    kickoff: new Date('2026-08-21T18:30:00Z'),
    homeTeam: home,
    awayTeam: away,
    homeDifficulty: difficulty,
    awayDifficulty: difficulty,
    finished: false,
    started: false,
    homeScore: null,
    awayScore: null,
  });
}

describe('projectPoints', () => {
  it('uses last season points per game before this season has any matches', () => {
    const projection = projectPoints(player({ pointsPerGame: 5 }));

    assert.equal(projection.base, 5);
    assert.equal(projection.points, 5);
    assert.match(projection.explain[0] ?? '', /from last season/);
  });

  it('prefers recent form once gameweeks exist', () => {
    const history = [gameweek(1, 8, 90), gameweek(2, 4, 90)];
    const projection = projectPoints(player({ pointsPerGame: 1 }), { history });

    assert.equal(projection.base, 6);
    assert.match(projection.explain[0] ?? '', /last 2 gameweeks/);
  });

  it('lifts an easy fixture run and cuts a hard one by the stated step', () => {
    const easy = [fixture(1, 1, 1, 2, 2)];
    const hard = [fixture(2, 1, 1, 2, 4)];

    const withEasy = projectPoints(player(), { fixtures: easy, fromGameweek: 1, horizon: 1 });
    const withHard = projectPoints(player(), { fixtures: hard, fromGameweek: 1, horizon: 1 });

    // Difficulty 2 is one step easier than neutral, 4 is one step harder.
    assert.equal(withEasy.fixtureMultiplier, 1 + DIFFICULTY_STEP);
    assert.equal(withHard.fixtureMultiplier, 1 - DIFFICULTY_STEP);
  });

  it('reports a blank gameweek rather than folding it into the average', () => {
    const projection = projectPoints(player(), {
      // A fixture for other clubs only: this player's club blanks.
      fixtures: [fixture(1, 1, 5, 6, 3)],
      fromGameweek: 1,
      horizon: 2,
    });

    assert.ok(projection.explain.some((line) => line.includes('blank in gameweek')));
  });

  it('zeroes an injured player and halves a doubtful one', () => {
    const injured = projectPoints(player({ availability: 'injured' }));
    const doubtful = projectPoints(player({ availability: 'doubtful' }));

    assert.equal(injured.points, 0);
    assert.equal(doubtful.minutesMultiplier, AVAILABILITY_WEIGHT.doubtful);
    assert.match(doubtful.explain.join(' '), /doubtful/);
  });

  it('discounts a player who does not start, once there is evidence', () => {
    const starter = projectPoints(player(), { history: [gameweek(1, 6, 90), gameweek(2, 6, 90)] });
    const substitute = projectPoints(player(), {
      history: [gameweek(1, 6, 20), gameweek(2, 6, 20)],
    });

    assert.ok(substitute.minutesMultiplier < starter.minutesMultiplier);
    assert.match(substitute.explain.join(' '), /started 0 percent/);
  });
});

describe('differentials', () => {
  it('ranks a lightly owned player above a heavily owned one on equal projection', () => {
    const rare = player({ selectedByPercent: 1 });
    const popular = player({ selectedByPercent: 50 });

    const rows = differentials([rare, popular], () => 5, { maxOwnership: 60 });

    assert.equal(rows[0]?.player.id, rare.id);
    assert.equal(rows[0]?.edge, 5);
  });

  it('excludes anyone above the ownership ceiling or below the projection floor', () => {
    const owned = player({ selectedByPercent: 40 });
    const weak = player({ selectedByPercent: 1 });

    const rows = differentials([owned, weak], (candidate) => (candidate.id === weak.id ? 0.5 : 9), {
      maxOwnership: 10,
      minProjected: 3,
    });

    assert.deepEqual(rows, []);
  });

  it('never divides by a zero ownership into an infinite edge', () => {
    const unowned = player({ selectedByPercent: 0 });

    const rows = differentials([unowned], () => 4, {});

    assert.ok(Number.isFinite(rows[0]?.edge ?? Infinity));
  });
});

describe('fixtureSwings', () => {
  it('sorts the easiest run first and keeps a club with no fixtures last', () => {
    const fixtures = [fixture(1, 1, 1, 2, 2), fixture(2, 1, 3, 4, 5)];

    const swings = fixtureSwings(fixtures, [1, 2, 3, 9].map(asTeamId), 1, 1);

    assert.equal(swings[0]?.teamId, 1);
    assert.equal(swings[0]?.averageDifficulty, 2);
    // Club 9 has no fixture in the horizon, so it cannot rank as easiest.
    assert.equal(swings[swings.length - 1]?.teamId, 9);
    assert.equal(swings[swings.length - 1]?.averageDifficulty, null);
  });
});

describe('glossary', () => {
  it('defines every metric the interface links to', () => {
    for (const id of [
      'points',
      'form',
      'ppm',
      'price',
      'ownership',
      'projection',
      'edge',
      'fdr',
      'blank',
      'double',
      'bps',
      'bonus',
      'defensive-contribution',
      'xg',
      'xa',
      'budget',
      'selling-price',
    ]) {
      assert.ok(glossaryEntry(id) !== undefined, `${id} has no glossary entry`);
    }
  });

  it('states a source for every entry, and a formula wherever one applies', () => {
    for (const entry of GLOSSARY) {
      assert.ok(entry.source.length > 0, `${entry.id} has no source`);
      assert.ok(entry.short.length > 0, `${entry.id} has no definition`);
    }
  });

  it('has no duplicate ids, since they are page anchors', () => {
    assert.equal(new Set(GLOSSARY_IDS).size, GLOSSARY_IDS.length);
  });
});

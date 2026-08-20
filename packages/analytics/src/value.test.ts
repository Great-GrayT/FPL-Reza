import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Player, PlayerGameweek } from '@fpl/core';
import {
  asFixtureId,
  asGameweekId,
  asPlayerId,
  asTeamId,
  availabilityFromStatus,
  playerCodeSchema,
} from '@fpl/core';
import { formValuePerMillion, pointsPerMillion, priceChange, valueMetrics } from './value.js';

const playerId = asPlayerId(1);
const teamId = asTeamId(1);

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: playerId,
    code: playerCodeSchema.parse(1001),
    firstName: 'Bukayo',
    secondName: 'Saka',
    webName: 'Saka',
    teamId,
    position: 'MID',
    price: 100,
    startPrice: 90,
    totalPoints: 150,
    minutes: 2000,
    goals: 10,
    assists: 8,
    cleanSheets: 5,
    goalsConceded: 20,
    yellowCards: 2,
    redCards: 0,
    saves: 0,
    bonus: 15,
    bps: 500,
    form: 5.5,
    pointsPerGame: 6,
    selectedByPercent: 40,
    expectedGoals: 9,
    expectedAssists: 7,
    expectedGoalInvolvements: 16,
    expectedGoalsConceded: 18,
    availability: availabilityFromStatus('a'),
    chanceOfPlayingNextRound: null,
    news: '',
    ...overrides,
  };
}

function gw({
  gameweek,
  ...rest
}: Partial<Omit<PlayerGameweek, 'gameweek' | 'fixtureId'>> & {
  gameweek: number;
  totalPoints: number;
}): PlayerGameweek {
  return {
    playerId,
    gameweek: asGameweekId(gameweek),
    fixtureId: asFixtureId(gameweek),
    opponentTeam: asTeamId(2),
    wasHome: true,
    kickoff: null,
    minutes: 90,
    influence: null,
    creativity: null,
    threat: null,
    ictIndex: null,
    goals: 0,
    assists: 0,
    cleanSheet: false,
    goalsConceded: 0,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 0,
    bps: 0,
    expectedGoals: 0,
    expectedAssists: 0,
    expectedGoalsConceded: 0,
    defensiveContribution: null,
    price: 100,
    ...rest,
  };
}

describe('pointsPerMillion', () => {
  it('divides total points by price in millions', () => {
    assert.equal(pointsPerMillion(150, 100), 15); // 150 / 10.0m
  });

  it('handles a fractional price cleanly', () => {
    assert.equal(pointsPerMillion(45, 45), 10); // 45 / 4.5m
  });
});

describe('formValuePerMillion', () => {
  it('uses the recent form window average, not season total', () => {
    const gameweeks = [gw({ gameweek: 1, totalPoints: 2 }), gw({ gameweek: 2, totalPoints: 8 })];
    // form pointsPerGame = 5, price 5.0m -> 1
    assert.equal(formValuePerMillion(gameweeks, 2, 50), 1);
  });

  it('returns 0 when there is no history rather than dividing by zero', () => {
    assert.equal(formValuePerMillion([], 4, 80), 0);
  });
});

describe('priceChange', () => {
  it('is positive after a rise', () => {
    assert.equal(priceChange(105, 100), 5);
  });

  it('is negative after a fall', () => {
    assert.equal(priceChange(95, 100), -5);
  });
});

describe('valueMetrics', () => {
  it('combines season value, form value, and price change for one player', () => {
    const gameweeks = [gw({ gameweek: 1, totalPoints: 6 }), gw({ gameweek: 2, totalPoints: 6 })];
    const metrics = valueMetrics(
      player({ price: 100, startPrice: 90, totalPoints: 150 }),
      gameweeks,
      2,
    );
    assert.equal(metrics.pointsPerMillion, 15);
    assert.equal(metrics.formValuePerMillion, 0.6); // pointsPerGame 6 / 10.0m
    assert.equal(metrics.priceChange, 10);
  });
});

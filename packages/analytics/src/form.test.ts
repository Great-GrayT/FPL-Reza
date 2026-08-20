import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PlayerGameweek } from '@fpl/core';
import { asFixtureId, asGameweekId, asPlayerId, asTeamId } from '@fpl/core';
import { rollingForm } from './form.js';

const basePlayer = asPlayerId(1);
const baseOpponent = asTeamId(2);

function gw({
  gameweek,
  ...rest
}: Partial<Omit<PlayerGameweek, 'gameweek' | 'fixtureId'>> & { gameweek: number }): PlayerGameweek {
  return {
    playerId: basePlayer,
    gameweek: asGameweekId(gameweek),
    fixtureId: asFixtureId(gameweek),
    opponentTeam: baseOpponent,
    wasHome: true,
    kickoff: null,
    minutes: 90,
    totalPoints: 2,
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
    influence: null,
    creativity: null,
    threat: null,
    ictIndex: null,
    defensiveContribution: null,
    price: 50,
    ...rest,
  };
}

describe('rollingForm', () => {
  it('averages over the requested window when enough gameweeks exist', () => {
    const gameweeks = [
      gw({ gameweek: 1, totalPoints: 2, minutes: 90 }),
      gw({ gameweek: 2, totalPoints: 6, minutes: 90 }),
      gw({ gameweek: 3, totalPoints: 10, minutes: 90 }),
    ];
    const form = rollingForm(gameweeks, 3);
    assert.equal(form.gameweeksConsidered, 3);
    assert.equal(form.pointsPerGame, 6);
    assert.equal(form.minutesPerGame, 90);
  });

  it('shrinks to fewer gameweeks than the window when that is all that is available', () => {
    const gameweeks = [gw({ gameweek: 1, totalPoints: 4 })];
    const form = rollingForm(gameweeks, 5);
    assert.equal(form.gameweeksConsidered, 1);
    assert.equal(form.pointsPerGame, 4);
  });

  it('only uses the tail when more gameweeks exist than the window', () => {
    const gameweeks = [
      gw({ gameweek: 1, totalPoints: 100 }),
      gw({ gameweek: 2, totalPoints: 2 }),
      gw({ gameweek: 3, totalPoints: 4 }),
    ];
    const form = rollingForm(gameweeks, 2);
    assert.equal(form.gameweeksConsidered, 2);
    assert.equal(form.pointsPerGame, 3);
  });

  it('returns zeroed metrics for an empty history without dividing by zero', () => {
    const form = rollingForm([], 4);
    assert.deepEqual(form, {
      gameweeksConsidered: 0,
      pointsPerGame: 0,
      pointsPer90: 0,
      minutesPerGame: 0,
      expectedGoalInvolvementsPer90: 0,
      starterReliability: 0,
    });
  });

  it('does not divide by zero when every gameweek in the window is an unused sub', () => {
    const gameweeks = [
      gw({ gameweek: 1, minutes: 0, totalPoints: 0 }),
      gw({ gameweek: 2, minutes: 0, totalPoints: 0 }),
    ];
    const form = rollingForm(gameweeks, 2);
    assert.equal(form.pointsPer90, 0);
    assert.equal(form.expectedGoalInvolvementsPer90, 0);
    assert.equal(form.minutesPerGame, 0);
    assert.equal(form.starterReliability, 0);
  });

  it('scores starter reliability as the share of full appearances', () => {
    const gameweeks = [
      gw({ gameweek: 1, minutes: 90 }),
      gw({ gameweek: 2, minutes: 45 }),
      gw({ gameweek: 3, minutes: 60 }),
      gw({ gameweek: 4, minutes: 0 }),
    ];
    const form = rollingForm(gameweeks, 4);
    assert.equal(form.starterReliability, 0.5);
  });

  it('computes expected goal involvements per 90 from expected goals plus expected assists', () => {
    const gameweeks = [
      gw({ gameweek: 1, minutes: 90, expectedGoals: 0.3, expectedAssists: 0.2 }),
      gw({ gameweek: 2, minutes: 90, expectedGoals: 0.5, expectedAssists: 0.0 }),
    ];
    const form = rollingForm(gameweeks, 2);
    // (0.3+0.2+0.5+0.0) total over 180 minutes, scaled to per 90
    assert.ok(Math.abs(form.expectedGoalInvolvementsPer90 - 0.5) < 1e-9);
  });
});

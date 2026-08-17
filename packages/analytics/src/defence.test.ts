import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PlayerGameweek } from '@fpl/core';
import { asFixtureId, asGameweekId, asPlayerId, asTeamId } from '@fpl/core';
import { defensiveContributionSummary } from './defence.js';

const playerId = asPlayerId(1);

function gw({
  gameweek,
  ...rest
}: Partial<Omit<PlayerGameweek, 'gameweek' | 'fixtureId'>> & {
  gameweek: number;
  defensiveContribution: number | null;
}): PlayerGameweek {
  return {
    playerId,
    gameweek: asGameweekId(gameweek),
    fixtureId: asFixtureId(gameweek),
    opponentTeam: asTeamId(2),
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
    price: 50,
    ...rest,
  };
}

describe('defensiveContributionSummary', () => {
  it('uses the 10 action threshold for defenders', () => {
    const gameweeks = [
      gw({ gameweek: 1, defensiveContribution: 10, minutes: 90 }),
      gw({ gameweek: 2, defensiveContribution: 8, minutes: 90 }),
    ];
    const summary = defensiveContributionSummary('DEF', gameweeks);
    assert.equal(summary.eligibleGameweeks, 2);
    assert.equal(summary.thresholdHitRate, 0.5);
    assert.equal(summary.expectedPointsPerGameweek, 1); // 0.5 * 2
  });

  it('uses the 12 action threshold for midfielders and forwards', () => {
    const gameweeks = [
      gw({ gameweek: 1, defensiveContribution: 12, minutes: 90 }),
      gw({ gameweek: 2, defensiveContribution: 10, minutes: 90 }),
    ];
    assert.equal(defensiveContributionSummary('MID', gameweeks).thresholdHitRate, 0.5);
    assert.equal(defensiveContributionSummary('FWD', gameweeks).thresholdHitRate, 0.5);
  });

  it('never qualifies a keeper even at a high action count', () => {
    const gameweeks = [gw({ gameweek: 1, defensiveContribution: 40, minutes: 90 })];
    const summary = defensiveContributionSummary('GKP', gameweeks);
    assert.equal(summary.thresholdHitRate, 0);
    assert.equal(summary.expectedPointsPerGameweek, 0);
  });

  it('excludes null gameweeks from the season predating the rule rather than counting them as misses', () => {
    const gameweeks = [
      gw({ gameweek: 1, defensiveContribution: null, minutes: 90 }),
      gw({ gameweek: 2, defensiveContribution: 10, minutes: 90 }),
    ];
    const summary = defensiveContributionSummary('DEF', gameweeks);
    assert.equal(summary.eligibleGameweeks, 1);
    assert.equal(summary.thresholdHitRate, 1); // the one eligible gameweek hit the threshold
  });

  it('returns zeroed metrics without dividing by zero when every gameweek is null', () => {
    const gameweeks = [gw({ gameweek: 1, defensiveContribution: null })];
    const summary = defensiveContributionSummary('DEF', gameweeks);
    assert.equal(summary.eligibleGameweeks, 0);
    assert.equal(summary.thresholdHitRate, 0);
    assert.equal(summary.per90, 0);
    assert.equal(summary.expectedPointsPerGameweek, 0);
  });

  it('excludes null gameweeks from the per90 minutes base too, not just the count', () => {
    const gameweeks = [
      gw({ gameweek: 1, defensiveContribution: null, minutes: 90 }),
      gw({ gameweek: 2, defensiveContribution: 9, minutes: 90 }),
    ];
    const summary = defensiveContributionSummary('DEF', gameweeks);
    // per90 should be computed over 90 minutes (the eligible gameweek only), not 180
    assert.equal(summary.per90, 9);
  });

  it('handles zero minutes without dividing by zero', () => {
    const gameweeks = [gw({ gameweek: 1, defensiveContribution: 0, minutes: 0 })];
    const summary = defensiveContributionSummary('DEF', gameweeks);
    assert.equal(summary.per90, 0);
  });
});

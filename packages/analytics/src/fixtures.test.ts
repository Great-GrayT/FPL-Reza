import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Fixture, Team } from '@fpl/core';
import { GAMEWEEKS_PER_SEASON, asFixtureId, asGameweekId, asTeamId } from '@fpl/core';
import { fixtureDifficulty, strengthAdjustedFixtureDifficulty } from './fixtures.js';

const arsenal = asTeamId(1);
const chelsea = asTeamId(2);
const villa = asTeamId(3);

function fixture({
  id,
  gameweek,
  ...rest
}: Partial<Omit<Fixture, 'id' | 'gameweek'>> & { id: number; gameweek: number | null }): Fixture {
  return {
    id: asFixtureId(id),
    gameweek: gameweek === null ? null : asGameweekId(gameweek),
    kickoff: null,
    homeTeam: arsenal,
    awayTeam: chelsea,
    homeScore: null,
    awayScore: null,
    finished: false,
    started: false,
    homeDifficulty: 3,
    awayDifficulty: 3,
    ...rest,
  };
}

describe('fixtureDifficulty', () => {
  it('collects one entry per single fixture across the horizon', () => {
    const fixtures = [
      fixture({
        id: 1,
        gameweek: 1,
        homeTeam: arsenal,
        awayTeam: chelsea,
        homeDifficulty: 2,
        awayDifficulty: 4,
      }),
      fixture({
        id: 2,
        gameweek: 2,
        homeTeam: villa,
        awayTeam: arsenal,
        homeDifficulty: 3,
        awayDifficulty: 5,
      }),
    ];
    const summary = fixtureDifficulty(fixtures, arsenal, asGameweekId(1), 2);
    assert.equal(summary.entries.length, 2);
    assert.equal(summary.entries[0]?.difficulty, 2); // home leg, home difficulty
    assert.equal(summary.entries[1]?.difficulty, 5); // away leg, away difficulty
    assert.equal(summary.entries[1]?.isHome, false);
    assert.equal(summary.blankGameweeks.length, 0);
    assert.equal(summary.doubleGameweeks.length, 0);
    assert.equal(summary.averageDifficulty, 3.5);
  });

  it('reports a blank gameweek when the team has no fixture in it', () => {
    const fixtures = [fixture({ id: 1, gameweek: 1, homeTeam: arsenal, awayTeam: chelsea })];
    const summary = fixtureDifficulty(fixtures, arsenal, asGameweekId(1), 3);
    assert.deepEqual(summary.blankGameweeks, [asGameweekId(2), asGameweekId(3)]);
    assert.equal(summary.entries.length, 1);
  });

  it('reports a double gameweek and includes both fixtures in the average', () => {
    const fixtures = [
      fixture({
        id: 1,
        gameweek: 2,
        homeTeam: arsenal,
        awayTeam: chelsea,
        homeDifficulty: 2,
        awayDifficulty: 4,
      }),
      fixture({
        id: 2,
        gameweek: 2,
        homeTeam: villa,
        awayTeam: arsenal,
        homeDifficulty: 1,
        awayDifficulty: 4,
      }),
    ];
    const summary = fixtureDifficulty(fixtures, arsenal, asGameweekId(2), 1);
    assert.deepEqual(summary.doubleGameweeks, [asGameweekId(2)]);
    assert.equal(summary.entries.length, 2);
    assert.equal(summary.averageDifficulty, 3); // (2 + 4) / 2
  });

  it('ignores postponed fixtures with no gameweek assigned', () => {
    const fixtures = [fixture({ id: 1, gameweek: null, homeTeam: arsenal, awayTeam: chelsea })];
    const summary = fixtureDifficulty(fixtures, arsenal, asGameweekId(1), 2);
    assert.equal(summary.entries.length, 0);
    assert.deepEqual(summary.blankGameweeks, [asGameweekId(1), asGameweekId(2)]);
  });

  it('returns null average difficulty when the whole horizon is blank, not 0', () => {
    const summary = fixtureDifficulty([], arsenal, asGameweekId(1), 2);
    assert.equal(summary.averageDifficulty, null);
  });

  it('caps the horizon at the season end rather than inventing gameweeks past it', () => {
    // starting at gameweek 36 with a horizon of 6 would reach 41, well past the season
    const summary = fixtureDifficulty([], arsenal, asGameweekId(36), 6);
    assert.deepEqual(summary.effectiveGameweeks, [
      asGameweekId(36),
      asGameweekId(37),
      asGameweekId(38),
    ]);
    assert.ok(summary.effectiveGameweeks.every((gameweek) => gameweek <= GAMEWEEKS_PER_SEASON));
    // the requested horizon is preserved as-is, only the effective gameweeks are truncated
    assert.equal(summary.horizon, 6);
    // no phantom blanks for gameweeks that do not exist
    assert.deepEqual(summary.blankGameweeks, [
      asGameweekId(36),
      asGameweekId(37),
      asGameweekId(38),
    ]);
    assert.ok(summary.blankGameweeks.every((gameweek) => gameweek <= GAMEWEEKS_PER_SEASON));
  });
});

const arsenalTeam: Team = {
  id: arsenal,
  code: 3,
  name: 'Arsenal',
  shortName: 'ARS',
  strength: 4,
  strengthOverallHome: 1200,
  strengthOverallAway: 1200,
  strengthAttackHome: 1300,
  strengthAttackAway: 1250,
  strengthDefenceHome: 1300,
  strengthDefenceAway: 1200,
};

const chelseaTeam: Team = {
  id: chelsea,
  code: 8,
  name: 'Chelsea',
  shortName: 'CHE',
  strength: 4,
  strengthOverallHome: 1200,
  strengthOverallAway: 1200,
  strengthAttackHome: 1200,
  strengthAttackAway: 1150,
  strengthDefenceHome: 1250,
  strengthDefenceAway: 1150,
};

describe('strengthAdjustedFixtureDifficulty', () => {
  it('uses the home attack split against the opponent away defence split for a home fixture', () => {
    const fixtures = [fixture({ id: 1, gameweek: 1, homeTeam: arsenal, awayTeam: chelsea })];
    const teamsById = new Map([
      [arsenal, arsenalTeam],
      [chelsea, chelseaTeam],
    ]);
    const summary = strengthAdjustedFixtureDifficulty(
      fixtures,
      arsenalTeam,
      teamsById,
      asGameweekId(1),
      1,
    );
    // arsenal home attack 1300 vs chelsea away defence 1150
    assert.equal(summary.entries[0]?.strengthDifferential, 150);
  });

  it('uses the away attack split against the opponent home defence split for an away fixture', () => {
    const fixtures = [fixture({ id: 1, gameweek: 1, homeTeam: chelsea, awayTeam: arsenal })];
    const teamsById = new Map([
      [arsenal, arsenalTeam],
      [chelsea, chelseaTeam],
    ]);
    const summary = strengthAdjustedFixtureDifficulty(
      fixtures,
      arsenalTeam,
      teamsById,
      asGameweekId(1),
      1,
    );
    // arsenal away attack 1250 vs chelsea home defence 1250
    assert.equal(summary.entries[0]?.strengthDifferential, 0);
  });

  it('throws when an opponent is missing from the lookup rather than skipping it silently', () => {
    const fixtures = [fixture({ id: 1, gameweek: 1, homeTeam: arsenal, awayTeam: chelsea })];
    const teamsById = new Map([[arsenal, arsenalTeam]]);
    assert.throws(() =>
      strengthAdjustedFixtureDifficulty(fixtures, arsenalTeam, teamsById, asGameweekId(1), 1),
    );
  });

  it('returns null for an empty horizon, distinct from a genuine 0 (evenly matched)', () => {
    const teamsById = new Map([
      [arsenal, arsenalTeam],
      [chelsea, chelseaTeam],
    ]);
    const summary = strengthAdjustedFixtureDifficulty(
      [],
      arsenalTeam,
      teamsById,
      asGameweekId(1),
      2,
    );
    assert.equal(summary.averageStrengthDifferential, null);
  });
});

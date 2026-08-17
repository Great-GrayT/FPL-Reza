import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '@fpl/core';
import { toFixture, toGameweek, toPlayer, toTeam } from './map.js';
import { rawElementSchema, rawFixtureSchema, rawTeamSchema } from './schemas.js';

/**
 * Shapes here mirror the live bootstrap payload, including the preseason case
 * where FPL publishes no strength ratings at all.
 */
const RAW_TEAM = {
  id: 1,
  code: 3,
  name: 'Arsenal',
  short_name: 'ARS',
  strength: null,
  strength_overall_home: 4,
  strength_overall_away: 5,
  strength_attack_home: 0,
  strength_attack_away: 0,
  strength_defence_home: 0,
  strength_defence_away: 0,
};

const RAW_ELEMENT = {
  id: 1,
  code: 223094,
  first_name: 'Erling',
  second_name: 'Haaland',
  web_name: 'Haaland',
  team: 1,
  element_type: 4,
  now_cost: 155,
  cost_change_start: 5,
  total_points: 0,
  minutes: 0,
  goals_scored: 0,
  assists: 0,
  clean_sheets: 0,
  goals_conceded: 0,
  yellow_cards: 0,
  red_cards: 0,
  saves: 0,
  bonus: 0,
  bps: 0,
  // FPL sends these as strings, which the raw schema coerces at the boundary.
  form: '0.0',
  points_per_game: '0.0',
  selected_by_percent: '43.1',
  expected_goals: '0.00',
  expected_assists: '0.00',
  expected_goal_involvements: '0.00',
  expected_goals_conceded: '0.00',
  status: 'a',
  chance_of_playing_next_round: null,
  news: '',
};

describe('toTeam', () => {
  it('accepts a null strength, which is what FPL sends before a season opens', () => {
    const team = toTeam(rawTeamSchema.parse(RAW_TEAM));
    assert.equal(team.strength, null);
    assert.equal(team.strengthOverallHome, 4);
    assert.equal(team.shortName, 'ARS');
  });
});

describe('toPlayer', () => {
  const player = toPlayer(rawElementSchema.parse(RAW_ELEMENT));

  it('maps element_type to a position', () => {
    assert.equal(player.position, 'FWD');
  });

  it('coerces the numeric strings FPL sends', () => {
    assert.equal(player.selectedByPercent, 43.1);
    assert.equal(player.form, 0);
  });

  it('derives the season opening price from the change since', () => {
    assert.equal(player.price, 155);
    assert.equal(player.startPrice, 150);
  });

  it('rejects an element_type outside the known range', () => {
    assert.throws(
      () => toPlayer(rawElementSchema.parse({ ...RAW_ELEMENT, element_type: 7 })),
      ValidationError,
    );
  });
});

describe('toFixture', () => {
  it('treats a missing started flag as not started', () => {
    const fixture = toFixture(
      rawFixtureSchema.parse({
        id: 1,
        event: 1,
        kickoff_time: '2026-08-21T19:00:00Z',
        team_h: 1,
        team_a: 2,
        team_h_score: null,
        team_a_score: null,
        finished: false,
        started: null,
        team_h_difficulty: 2,
        team_a_difficulty: 4,
      }),
    );
    assert.equal(fixture.started, false);
    assert.equal(fixture.kickoff?.toISOString(), '2026-08-21T19:00:00.000Z');
  });
});

describe('toGameweek', () => {
  it('folds the chip play list into a keyed record', () => {
    const gameweek = toGameweek({
      id: 1,
      name: 'Gameweek 1',
      deadline_time: '2026-08-21T17:30:00Z',
      finished: false,
      is_current: false,
      is_next: true,
      average_entry_score: 0,
      highest_score: null,
      most_captained: null,
      chip_plays: [{ chip_name: 'bboost', num_played: 12 }],
    });
    assert.equal(gameweek.chipPlays['bboost'], 12);
    assert.equal(gameweek.deadline.toISOString(), '2026-08-21T17:30:00.000Z');
  });
});

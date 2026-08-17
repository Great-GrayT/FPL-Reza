import {
  availabilityFromStatus,
  fixtureSchema,
  gameweekSchema,
  playerGameweekSchema,
  playerSchema,
  positionFromElementType,
  teamSchema,
  type Fixture,
  type Gameweek,
  type Player,
  type PlayerGameweek,
  type Team,
} from '@fpl/core';
import type { z } from 'zod';
import type {
  rawElementSchema,
  rawEventSchema,
  rawFixtureSchema,
  rawHistorySchema,
  rawTeamSchema,
} from './schemas.js';

type RawTeam = z.infer<typeof rawTeamSchema>;
type RawEvent = z.infer<typeof rawEventSchema>;
type RawElement = z.infer<typeof rawElementSchema>;
type RawFixture = z.infer<typeof rawFixtureSchema>;
type RawHistory = z.infer<typeof rawHistorySchema>;

/**
 * Mapping runs through the core schemas rather than casting, so every branded
 * ID and every range constraint is enforced at the moment data enters the
 * domain. A malformed upstream row fails here, not three layers later.
 */

export const toTeam = (raw: RawTeam): Team =>
  teamSchema.parse({
    id: raw.id,
    code: raw.code,
    name: raw.name,
    shortName: raw.short_name,
    strength: raw.strength,
    strengthOverallHome: raw.strength_overall_home,
    strengthOverallAway: raw.strength_overall_away,
    strengthAttackHome: raw.strength_attack_home,
    strengthAttackAway: raw.strength_attack_away,
    strengthDefenceHome: raw.strength_defence_home,
    strengthDefenceAway: raw.strength_defence_away,
  });

export const toGameweek = (raw: RawEvent): Gameweek =>
  gameweekSchema.parse({
    id: raw.id,
    name: raw.name,
    deadline: raw.deadline_time,
    finished: raw.finished,
    isCurrent: raw.is_current,
    isNext: raw.is_next,
    averageEntryScore: raw.average_entry_score,
    highestScore: raw.highest_score,
    mostCaptainedId: raw.most_captained,
    chipPlays: Object.fromEntries(raw.chip_plays.map((play) => [play.chip_name, play.num_played])),
  });

export const toPlayer = (raw: RawElement): Player =>
  playerSchema.parse({
    id: raw.id,
    code: raw.code,
    firstName: raw.first_name,
    secondName: raw.second_name,
    webName: raw.web_name,
    teamId: raw.team,
    position: positionFromElementType(raw.element_type),
    price: raw.now_cost,
    startPrice: raw.now_cost - raw.cost_change_start,
    totalPoints: raw.total_points,
    minutes: raw.minutes,
    goals: raw.goals_scored,
    assists: raw.assists,
    cleanSheets: raw.clean_sheets,
    goalsConceded: raw.goals_conceded,
    yellowCards: raw.yellow_cards,
    redCards: raw.red_cards,
    saves: raw.saves,
    bonus: raw.bonus,
    bps: raw.bps,
    form: raw.form,
    pointsPerGame: raw.points_per_game,
    selectedByPercent: raw.selected_by_percent,
    expectedGoals: raw.expected_goals,
    expectedAssists: raw.expected_assists,
    expectedGoalInvolvements: raw.expected_goal_involvements,
    expectedGoalsConceded: raw.expected_goals_conceded,
    availability: availabilityFromStatus(raw.status),
    chanceOfPlayingNextRound: raw.chance_of_playing_next_round,
    news: raw.news,
  });

export const toFixture = (raw: RawFixture): Fixture =>
  fixtureSchema.parse({
    id: raw.id,
    gameweek: raw.event,
    kickoff: raw.kickoff_time,
    homeTeam: raw.team_h,
    awayTeam: raw.team_a,
    homeScore: raw.team_h_score,
    awayScore: raw.team_a_score,
    finished: raw.finished,
    started: raw.started ?? false,
    homeDifficulty: raw.team_h_difficulty,
    awayDifficulty: raw.team_a_difficulty,
  });

export const toPlayerGameweek = (raw: RawHistory): PlayerGameweek =>
  playerGameweekSchema.parse({
    playerId: raw.element,
    gameweek: raw.round,
    fixtureId: raw.fixture,
    opponentTeam: raw.opponent_team,
    wasHome: raw.was_home,
    kickoff: raw.kickoff_time,
    minutes: raw.minutes,
    totalPoints: raw.total_points,
    goals: raw.goals_scored,
    assists: raw.assists,
    cleanSheet: raw.clean_sheets > 0,
    goalsConceded: raw.goals_conceded,
    ownGoals: raw.own_goals,
    penaltiesSaved: raw.penalties_saved,
    penaltiesMissed: raw.penalties_missed,
    yellowCards: raw.yellow_cards,
    redCards: raw.red_cards,
    saves: raw.saves,
    bonus: raw.bonus,
    bps: raw.bps,
    expectedGoals: raw.expected_goals,
    expectedAssists: raw.expected_assists,
    expectedGoalsConceded: raw.expected_goals_conceded,
    defensiveContribution: raw.defensive_contribution ?? null,
    price: raw.value,
  });

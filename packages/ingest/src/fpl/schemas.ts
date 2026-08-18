import { z } from 'zod';

/**
 * Raw FPL API shapes. Unknown keys are stripped rather than rejected: FPL adds
 * fields mid season without warning, and a strict schema would turn that into
 * an outage. Numeric strings are coerced here, once, at the boundary.
 */

const numeric = z.coerce.number();

export const rawChipPlaySchema = z.object({
  chip_name: z.string(),
  num_played: z.number().int().nonnegative(),
});

export const rawEventSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  deadline_time: z.string(),
  finished: z.boolean(),
  is_current: z.boolean(),
  is_next: z.boolean(),
  average_entry_score: z.number().int().nonnegative(),
  highest_score: z.number().int().nonnegative().nullable(),
  most_captained: z.number().int().nullable(),
  chip_plays: z.array(rawChipPlaySchema),
});

export const rawTeamSchema = z.object({
  id: z.number().int(),
  code: z.number().int(),
  name: z.string(),
  short_name: z.string(),
  strength: z.number().int().nullable(),
  strength_overall_home: z.number().int(),
  strength_overall_away: z.number().int(),
  strength_attack_home: z.number().int(),
  strength_attack_away: z.number().int(),
  strength_defence_home: z.number().int(),
  strength_defence_away: z.number().int(),
});

export const rawElementSchema = z.object({
  id: z.number().int(),
  code: z.number().int(),
  first_name: z.string(),
  second_name: z.string(),
  web_name: z.string(),
  team: z.number().int(),
  element_type: z.number().int(),
  now_cost: z.number().int(),
  /** Total price movement since the season opened, in tenths. */
  cost_change_start: z.number().int(),
  total_points: z.number().int(),
  minutes: z.number().int(),
  goals_scored: z.number().int(),
  assists: z.number().int(),
  clean_sheets: z.number().int(),
  goals_conceded: z.number().int(),
  yellow_cards: z.number().int(),
  red_cards: z.number().int(),
  saves: z.number().int(),
  bonus: z.number().int(),
  bps: z.number().int(),
  form: numeric,
  points_per_game: numeric,
  selected_by_percent: numeric,
  expected_goals: numeric,
  expected_assists: numeric,
  expected_goal_involvements: numeric,
  expected_goals_conceded: numeric,
  status: z.string(),
  chance_of_playing_next_round: z.number().int().nullable(),
  news: z.string(),
});

export const bootstrapSchema = z.object({
  events: z.array(rawEventSchema),
  teams: z.array(rawTeamSchema),
  elements: z.array(rawElementSchema),
});

export type Bootstrap = z.infer<typeof bootstrapSchema>;

export const rawFixtureSchema = z.object({
  id: z.number().int(),
  event: z.number().int().nullable(),
  kickoff_time: z.string().nullable(),
  team_h: z.number().int(),
  team_a: z.number().int(),
  team_h_score: z.number().int().nullable(),
  team_a_score: z.number().int().nullable(),
  finished: z.boolean(),
  started: z.boolean().nullable(),
  team_h_difficulty: z.number().int(),
  team_a_difficulty: z.number().int(),
});

export const fixturesSchema = z.array(rawFixtureSchema);

export const rawHistorySchema = z.object({
  element: z.number().int(),
  fixture: z.number().int(),
  opponent_team: z.number().int(),
  was_home: z.boolean(),
  kickoff_time: z.string().nullable(),
  round: z.number().int(),
  minutes: z.number().int(),
  total_points: z.number().int(),
  goals_scored: z.number().int(),
  assists: z.number().int(),
  clean_sheets: z.number().int(),
  goals_conceded: z.number().int(),
  own_goals: z.number().int(),
  penalties_saved: z.number().int(),
  penalties_missed: z.number().int(),
  yellow_cards: z.number().int(),
  red_cards: z.number().int(),
  saves: z.number().int(),
  bonus: z.number().int(),
  bps: z.number().int(),
  expected_goals: numeric,
  expected_assists: numeric,
  expected_goals_conceded: numeric,
  /** Added for the defensive contribution rule. Absent in older seasons. */
  defensive_contribution: z.coerce.number().optional(),
  /** Price at the time of the fixture, in tenths. */
  value: z.number().int(),
});

export const elementSummarySchema = z.object({
  history: z.array(rawHistorySchema),
  /** Completed seasons. Kept unparsed here: the history package owns its shape. */
  history_past: z.array(z.unknown()).default([]),
});

export type RawHistory = z.infer<typeof rawHistorySchema>;

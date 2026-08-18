import { z } from 'zod';
import { playerCodeSchema, seasonSchema } from './ids.js';
import { positionSchema } from './position.js';

/**
 * A player's career, across seasons. Everything here keys on `playerCode`
 * rather than `playerId`: FPL reassigns element ids every summer, and a career
 * that changes identity every August is not a career. Codes are permanent.
 *
 * Two grains live here. `PlayerSeason` is one player's totals for one season,
 * which FPL itself publishes on the element summary endpoint. `HistoricPlayerGameweek`
 * is one player's return in one gameweek of a past season, which FPL does not
 * publish once the season closes and which therefore comes from an archive.
 */

/**
 * A season label as the archives print it, "2024-25" rather than "2024/25".
 * Kept distinct from Season so a hyphenated label cannot be passed where the
 * domain's slashed one is expected.
 */
export const archiveSeasonSchema = z.string().regex(/^\d{4}-\d{2}$/);

export const toArchiveSeason = (season: string): string => season.replace('/', '-');
export const fromArchiveSeason = (label: string): string => label.replace('-', '/');

/**
 * One player's totals for one completed season. Directly what FPL serves in
 * `history_past`, renamed to this codebase's vocabulary.
 *
 * Measures that did not exist in a given season are null rather than 0: the
 * expected goals family starts in 2022/23 and defensive contribution in
 * 2025/26, so a zero would state that a player recorded none, when in fact
 * nobody was recording it.
 */
export const playerSeasonSchema = z.object({
  playerCode: playerCodeSchema,
  season: seasonSchema,
  startPrice: z.number().int().positive(),
  endPrice: z.number().int().positive(),
  totalPoints: z.number().int(),
  minutes: z.number().int().nonnegative(),
  starts: z.number().int().nonnegative().nullable(),
  goals: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  cleanSheets: z.number().int().nonnegative(),
  goalsConceded: z.number().int().nonnegative(),
  ownGoals: z.number().int().nonnegative(),
  penaltiesSaved: z.number().int().nonnegative(),
  penaltiesMissed: z.number().int().nonnegative(),
  yellowCards: z.number().int().nonnegative(),
  redCards: z.number().int().nonnegative(),
  saves: z.number().int().nonnegative(),
  bonus: z.number().int().nonnegative(),
  bps: z.number().int(),
  influence: z.number().nullable(),
  creativity: z.number().nullable(),
  threat: z.number().nullable(),
  ictIndex: z.number().nullable(),
  expectedGoals: z.number().nonnegative().nullable(),
  expectedAssists: z.number().nonnegative().nullable(),
  expectedGoalsConceded: z.number().nonnegative().nullable(),
  defensiveContribution: z.number().nonnegative().nullable(),
});

export type PlayerSeason = z.infer<typeof playerSeasonSchema>;

/**
 * One player's return in one gameweek of a past season. The same grain as
 * PlayerGameweek, but keyed by code and season and carrying the player's name,
 * club, and position as they were at the time, because a player who has since
 * moved club or left the league cannot be joined to today's player list.
 */
export const historicPlayerGameweekSchema = z.object({
  playerCode: playerCodeSchema,
  season: seasonSchema,
  gameweek: z.number().int().min(1).max(47),
  /** The player's name as recorded that season. */
  name: z.string().min(1),
  position: positionSchema.nullable(),
  team: z.string().nullable(),
  opponentTeam: z.number().int().positive().nullable(),
  wasHome: z.boolean().nullable(),
  kickoff: z.coerce.date().nullable(),
  minutes: z.number().int().nonnegative(),
  totalPoints: z.number().int(),
  goals: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  cleanSheets: z.number().int().nonnegative(),
  goalsConceded: z.number().int().nonnegative(),
  ownGoals: z.number().int().nonnegative(),
  penaltiesSaved: z.number().int().nonnegative(),
  penaltiesMissed: z.number().int().nonnegative(),
  yellowCards: z.number().int().nonnegative(),
  redCards: z.number().int().nonnegative(),
  saves: z.number().int().nonnegative(),
  bonus: z.number().int().nonnegative(),
  bps: z.number().int(),
  price: z.number().int().positive().nullable(),
  selectedBy: z.number().int().nonnegative().nullable(),
  expectedGoals: z.number().nonnegative().nullable(),
  expectedAssists: z.number().nonnegative().nullable(),
  expectedGoalsConceded: z.number().nonnegative().nullable(),
  /** FPL's own projection for that gameweek, where the archive recorded one. */
  expectedPoints: z.number().nullable(),
});

export type HistoricPlayerGameweek = z.infer<typeof historicPlayerGameweekSchema>;

/**
 * A career, reduced to what a page needs without reading a season of gameweek
 * rows: one entry per season plus the totals across all of them. Computed at
 * ingest time rather than at build time, because 10 seasons of gameweek rows
 * is a quarter of a million records and no page should touch that to print a
 * career total.
 */
export const careerTotalsSchema = z.object({
  seasons: z.number().int().nonnegative(),
  totalPoints: z.number().int(),
  minutes: z.number().int().nonnegative(),
  goals: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  cleanSheets: z.number().int().nonnegative(),
  bonus: z.number().int().nonnegative(),
  /** Best single season by total points, as a season label. */
  bestSeason: seasonSchema.nullable(),
  bestSeasonPoints: z.number().int().nullable(),
});

export type CareerTotals = z.infer<typeof careerTotalsSchema>;

/** Totals across a player's completed seasons. Empty input yields zeroes. */
export function careerTotals(seasons: readonly PlayerSeason[]): CareerTotals {
  let best: PlayerSeason | undefined;
  const totals = {
    seasons: seasons.length,
    totalPoints: 0,
    minutes: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    bonus: 0,
  };

  for (const season of seasons) {
    totals.totalPoints += season.totalPoints;
    totals.minutes += season.minutes;
    totals.goals += season.goals;
    totals.assists += season.assists;
    totals.cleanSheets += season.cleanSheets;
    totals.bonus += season.bonus;
    if (best === undefined || season.totalPoints > best.totalPoints) best = season;
  }

  return {
    ...totals,
    bestSeason: best?.season ?? null,
    bestSeasonPoints: best?.totalPoints ?? null,
  };
}

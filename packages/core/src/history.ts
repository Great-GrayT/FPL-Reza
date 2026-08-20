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
  /**
   * The ICT family, which the archive carries per gameweek and this schema did
   * not. Threat is the one worth having: it is built from shot volume and shot
   * location, so together with expected goals it separates a player taking many
   * poor shots from one taking a few good ones, which expected goals alone
   * cannot. Creativity is its equivalent for chances made.
   */
  influence: z.number().nonnegative().nullable(),
  creativity: z.number().nonnegative().nullable(),
  threat: z.number().nonnegative().nullable(),
  ictIndex: z.number().nonnegative().nullable(),
  /** FPL's own projection for that gameweek, where the archive recorded one. */
  expectedPoints: z.number().nullable(),
});

export type HistoricPlayerGameweek = z.infer<typeof historicPlayerGameweekSchema>;

/**
 * One club, in one season, as FPL numbered it that year.
 *
 * This row exists to make the archive joinable. A stored gameweek names the
 * opponent by that season's FPL team id, and FPL renumbers those every summer,
 * so without this the opponent in a 2018/19 row cannot be tied to the club that
 * played, nor to its strength, its manager, or its shape. The permanent code is
 * what carries across, and this is the only table that holds both.
 *
 * It also carries FPL's own strength ratings, which are a published opinion
 * about a club at the start of a season rather than a measurement, and are
 * useful precisely because they are available before a ball is kicked.
 */
export const teamSeasonSchema = z.object({
  season: seasonSchema,
  /** FPL's id for the club that season, which is what a gameweek row cites. */
  teamId: z.number().int().positive(),
  /** The permanent club code, which is what everything else joins on. */
  teamCode: z.number().int().positive(),
  name: z.string().min(1),
  shortName: z.string().min(1),
  strength: z.number().int().nullable(),
  strengthOverallHome: z.number().int().nullable(),
  strengthOverallAway: z.number().int().nullable(),
  strengthAttackHome: z.number().int().nullable(),
  strengthAttackAway: z.number().int().nullable(),
  strengthDefenceHome: z.number().int().nullable(),
  strengthDefenceAway: z.number().int().nullable(),
});

export type TeamSeason = z.infer<typeof teamSeasonSchema>;

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

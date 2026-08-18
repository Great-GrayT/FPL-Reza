import { z } from 'zod';
import { playerCodeSchema, seasonSchema } from './ids.js';
import { positionSchema } from './position.js';

/**
 * The official Premier League record of a match, which is a different object
 * from an FPL fixture. FPL carries what a fantasy squad scores; this carries
 * what happened: who refereed it, who started, in what shape, who scored and
 * when, at which ground, in front of how many people.
 *
 * Everything joins on codes rather than ids. A club is a `teamCode` (FPL's
 * `Team.code`, which is Opta's team id) and a person is a `playerCode` (FPL's
 * `Player.code`, which is Opta's person id). Both survive a season rollover,
 * and both are exact: the provider publishes the Opta id beside its own, so
 * nothing here is matched on a name.
 */

/** Two spellings of a match id, because two providers number matches. */
export const matchIdSchema = z.number().int().positive().brand<'MatchId'>();
export type MatchId = z.infer<typeof matchIdSchema>;

export const asMatchId = (value: number): MatchId => matchIdSchema.parse(value);

export const MATCH_STATUSES = ['upcoming', 'live', 'completed', 'postponed', 'abandoned'] as const;
export const matchStatusSchema = z.enum(MATCH_STATUSES);
export type MatchStatus = z.infer<typeof matchStatusSchema>;

export const MATCH_OUTCOMES = ['home', 'away', 'draw'] as const;
export const matchOutcomeSchema = z.enum(MATCH_OUTCOMES);
export type MatchOutcome = z.infer<typeof matchOutcomeSchema>;

/**
 * A person on the officiating team. Referees carry no Opta id and no published
 * photograph, so they are identified by the provider's own person id and shown
 * as a designed initial rather than a broken image.
 */
export const OFFICIAL_ROLES = [
  'referee',
  'assistant',
  'fourth_official',
  'var',
  'assistant_var',
] as const;
export const officialRoleSchema = z.enum(OFFICIAL_ROLES);
export type OfficialRole = z.infer<typeof officialRoleSchema>;

export const matchOfficialSchema = z.object({
  /** The provider's person id. Stable across matches and seasons. */
  officialId: z.number().int().positive(),
  name: z.string().min(1),
  role: officialRoleSchema,
});
export type MatchOfficial = z.infer<typeof matchOfficialSchema>;

/** One name on a teamsheet, started or benched. */
export const lineupPlayerSchema = z.object({
  playerCode: playerCodeSchema.nullable(),
  /** The provider's person id, kept so a match event can be joined to a name. */
  personId: z.number().int().positive(),
  name: z.string().min(1),
  shirt: z.number().int().nullable(),
  captain: z.boolean(),
  /** As the provider words it: "Left Wing Back", not "DEF". */
  positionInfo: z.string().nullable(),
  position: positionSchema.nullable(),
  /** ISO 3166-1 alpha-2 of the national side, where the provider carries one. */
  nationality: z.string().nullable(),
  country: z.string().nullable(),
});
export type LineupPlayer = z.infer<typeof lineupPlayerSchema>;

/**
 * One side's teamsheet. `formationRows` is the shape as the provider publishes
 * it, back to front: [[keeper], [back four], ...], holding person ids. Drawing
 * a teamsheet on a pitch needs the rows, not the label, because "4-2-3-1" does
 * not say who is where.
 */
export const teamSheetSchema = z.object({
  teamCode: z.number().int().positive(),
  formation: z.string().nullable(),
  formationRows: z.array(z.array(z.number().int().positive())),
  lineup: z.array(lineupPlayerSchema),
  substitutes: z.array(lineupPlayerSchema),
});
export type TeamSheet = z.infer<typeof teamSheetSchema>;

export const MATCH_EVENT_TYPES = [
  'goal',
  'own_goal',
  'penalty_goal',
  'penalty_missed',
  'yellow_card',
  'second_yellow',
  'red_card',
  'substitution',
  'other',
] as const;
export const matchEventTypeSchema = z.enum(MATCH_EVENT_TYPES);
export type MatchEventType = z.infer<typeof matchEventTypeSchema>;

export const matchTimelineEventSchema = z.object({
  type: matchEventTypeSchema,
  minute: z.number().int().min(0).max(130).nullable(),
  teamCode: z.number().int().positive().nullable(),
  personId: z.number().int().positive().nullable(),
  playerCode: playerCodeSchema.nullable(),
  name: z.string().nullable(),
  /** The assisting player, or on a substitution the player coming off. */
  relatedPersonId: z.number().int().positive().nullable(),
  relatedPlayerCode: playerCodeSchema.nullable(),
  relatedName: z.string().nullable(),
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
});
export type MatchTimelineEvent = z.infer<typeof matchTimelineEventSchema>;

/**
 * One match, at the grain the official record publishes it. Slim enough that
 * 35 seasons of them fit in a committed lake as Parquet: the teamsheets and
 * the timeline live in the separate detail dataset, which is only pulled for
 * the seasons a page actually draws.
 */
export const matchSchema = z.object({
  matchId: matchIdSchema,
  season: seasonSchema,
  /** The league round. Null for a match the provider has not placed in one. */
  round: z.number().int().min(1).max(47).nullable(),
  kickoff: z.coerce.date().nullable(),
  homeTeamCode: z.number().int().positive(),
  awayTeamCode: z.number().int().positive(),
  homeTeamName: z.string().min(1),
  awayTeamName: z.string().min(1),
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
  halfTimeHomeScore: z.number().int().nonnegative().nullable(),
  halfTimeAwayScore: z.number().int().nonnegative().nullable(),
  status: matchStatusSchema,
  outcome: matchOutcomeSchema.nullable(),
  attendance: z.number().int().positive().nullable(),
  groundId: z.number().int().positive().nullable(),
  groundName: z.string().nullable(),
  neutralGround: z.boolean(),
  /** The referee alone, denormalised, so a card rate needs one dataset. */
  refereeId: z.number().int().positive().nullable(),
  refereeName: z.string().nullable(),
});
export type Match = z.infer<typeof matchSchema>;

/** Teamsheets, officials, and the timeline for one match. */
export const matchDetailSchema = z.object({
  matchId: matchIdSchema,
  season: seasonSchema,
  officials: z.array(matchOfficialSchema),
  sheets: z.array(teamSheetSchema),
  events: z.array(matchTimelineEventSchema),
});
export type MatchDetail = z.infer<typeof matchDetailSchema>;

/** A ground, with the coordinates a weather lookup needs and nothing more. */
export const groundSchema = z.object({
  groundId: z.number().int().positive(),
  name: z.string().min(1),
  city: z.string().nullable(),
  capacity: z.number().int().positive().nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  /** The club that plays here, where the provider attributes one. */
  teamCode: z.number().int().positive().nullable(),
});
export type Ground = z.infer<typeof groundSchema>;

/**
 * Who managed a club, and in which season. The provider publishes this per
 * club per season rather than as a dated spell, so a mid season change shows
 * as two rows for one season, which is the truth it carries.
 */
export const managerSchema = z.object({
  /** The provider's person id. */
  managerId: z.number().int().positive(),
  /**
   * The Opta id behind the published photograph, as the digits of `man51018`.
   * Null where the provider publishes no Opta id, which means no photograph.
   */
  photoCode: z.number().int().positive().nullable(),
  name: z.string().min(1),
  teamCode: z.number().int().positive(),
  season: seasonSchema,
  role: z.string().min(1),
  nationality: z.string().nullable(),
  country: z.string().nullable(),
  birthDate: z.coerce.date().nullable(),
  active: z.boolean(),
});
export type Manager = z.infer<typeof managerSchema>;

/** Conditions at one kickoff, from a keyless forecast and archive service. */
export const matchWeatherSchema = z.object({
  matchId: matchIdSchema,
  season: seasonSchema,
  kickoff: z.coerce.date(),
  groundId: z.number().int().positive(),
  temperatureC: z.number().nullable(),
  apparentTemperatureC: z.number().nullable(),
  precipitationMm: z.number().nonnegative().nullable(),
  windSpeedKmh: z.number().nonnegative().nullable(),
  humidityPercent: z.number().min(0).max(100).nullable(),
  cloudCoverPercent: z.number().min(0).max(100).nullable(),
  /** WMO code, which is what turns into a word and an icon for a reader. */
  weatherCode: z.number().int().nonnegative().nullable(),
});
export type MatchWeather = z.infer<typeof matchWeatherSchema>;

/** WMO weather interpretation codes, condensed to what a match page prints. */
export function describeWeatherCode(code: number | null): string | null {
  if (code === null) return null;
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorm';
}

export interface HeadToHead {
  played: number;
  homeWins: number;
  awayWins: number;
  draws: number;
  homeGoals: number;
  awayGoals: number;
  /** Most recent first, so a page can print the last handful without sorting. */
  matches: Match[];
}

/**
 * The record between two clubs, always read from the first club's point of
 * view rather than from the venue's, since a page is written about a fixture
 * and not about a ground.
 */
export function headToHead(
  matches: readonly Match[],
  teamCode: number,
  opponentCode: number,
): HeadToHead {
  const relevant = matches
    .filter(
      (match) =>
        match.homeScore !== null &&
        match.awayScore !== null &&
        ((match.homeTeamCode === teamCode && match.awayTeamCode === opponentCode) ||
          (match.homeTeamCode === opponentCode && match.awayTeamCode === teamCode)),
    )
    .sort((a, b) => (b.kickoff?.getTime() ?? 0) - (a.kickoff?.getTime() ?? 0));

  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let homeGoals = 0;
  let awayGoals = 0;

  for (const match of relevant) {
    const forTeam = match.homeTeamCode === teamCode ? match.homeScore : match.awayScore;
    const against = match.homeTeamCode === teamCode ? match.awayScore : match.homeScore;
    if (forTeam === null || against === null) continue;
    homeGoals += forTeam;
    awayGoals += against;
    if (forTeam > against) homeWins += 1;
    else if (forTeam < against) awayWins += 1;
    else draws += 1;
  }

  return {
    played: relevant.length,
    homeWins,
    awayWins,
    draws,
    homeGoals,
    awayGoals,
    matches: relevant,
  };
}

export interface RefereeRecord {
  refereeId: number;
  name: string;
  matches: number;
  homeWins: number;
  awayWins: number;
  draws: number;
  goals: number;
  goalsPerMatch: number;
  /** Null until a detail dataset covering these matches has been ingested. */
  yellowsPerMatch: number | null;
  redsPerMatch: number | null;
  penaltiesPerMatch: number | null;
  seasons: string[];
}

/**
 * A referee's record over whatever matches are stored. Cards come from the
 * detail dataset, which covers fewer seasons than the results do, so the card
 * rates are null rather than zero where no detail was ingested: "not measured"
 * and "never booked anyone" are not the same claim.
 */
export function refereeRecord(
  matches: readonly Match[],
  details: ReadonlyMap<number, MatchDetail>,
): RefereeRecord[] {
  const byReferee = new Map<number, Match[]>();
  for (const match of matches) {
    if (match.refereeId === null) continue;
    const existing = byReferee.get(match.refereeId);
    if (existing === undefined) byReferee.set(match.refereeId, [match]);
    else existing.push(match);
  }

  const records: RefereeRecord[] = [];
  for (const [refereeId, refereeMatches] of byReferee) {
    let homeWins = 0;
    let awayWins = 0;
    let draws = 0;
    let goals = 0;
    let yellows = 0;
    let reds = 0;
    let penalties = 0;
    let detailed = 0;
    const seasons = new Set<string>();

    for (const match of refereeMatches) {
      seasons.add(match.season);
      if (match.outcome === 'home') homeWins += 1;
      else if (match.outcome === 'away') awayWins += 1;
      else if (match.outcome === 'draw') draws += 1;
      goals += (match.homeScore ?? 0) + (match.awayScore ?? 0);

      const detail = details.get(match.matchId);
      if (detail === undefined) continue;
      detailed += 1;
      for (const event of detail.events) {
        if (event.type === 'yellow_card') yellows += 1;
        else if (event.type === 'red_card' || event.type === 'second_yellow') reds += 1;
        else if (event.type === 'penalty_goal' || event.type === 'penalty_missed') penalties += 1;
      }
    }

    const played = refereeMatches.length;
    records.push({
      refereeId,
      name: refereeMatches[0]?.refereeName ?? 'Unknown',
      matches: played,
      homeWins,
      awayWins,
      draws,
      goals,
      goalsPerMatch: played === 0 ? 0 : goals / played,
      yellowsPerMatch: detailed === 0 ? null : yellows / detailed,
      redsPerMatch: detailed === 0 ? null : reds / detailed,
      penaltiesPerMatch: detailed === 0 ? null : penalties / detailed,
      seasons: [...seasons].sort((a, b) => b.localeCompare(a)),
    });
  }

  return records.sort((a, b) => b.matches - a.matches);
}

export interface TeamRecord {
  teamCode: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

/** A club's record over whatever matches are passed, home and away together. */
export function teamRecord(matches: readonly Match[], teamCode: number): TeamRecord {
  const record: TeamRecord = {
    teamCode,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
  };

  for (const match of matches) {
    if (match.homeScore === null || match.awayScore === null) continue;
    const home = match.homeTeamCode === teamCode;
    if (!home && match.awayTeamCode !== teamCode) continue;
    const scored = home ? match.homeScore : match.awayScore;
    const conceded = home ? match.awayScore : match.homeScore;
    record.played += 1;
    record.goalsFor += scored;
    record.goalsAgainst += conceded;
    if (scored > conceded) {
      record.won += 1;
      record.points += 3;
    } else if (scored === conceded) {
      record.drawn += 1;
      record.points += 1;
    } else {
      record.lost += 1;
    }
  }

  return record;
}

/** The last `count` results for a club, newest first, as W, D, or L. */
export function recentForm(
  matches: readonly Match[],
  teamCode: number,
  count = 5,
): ('W' | 'D' | 'L')[] {
  return matches
    .filter(
      (match) =>
        match.homeScore !== null &&
        match.awayScore !== null &&
        (match.homeTeamCode === teamCode || match.awayTeamCode === teamCode),
    )
    .sort((a, b) => (b.kickoff?.getTime() ?? 0) - (a.kickoff?.getTime() ?? 0))
    .slice(0, count)
    .map((match) => {
      const home = match.homeTeamCode === teamCode;
      const scored = (home ? match.homeScore : match.awayScore) ?? 0;
      const conceded = (home ? match.awayScore : match.homeScore) ?? 0;
      return scored > conceded ? 'W' : scored === conceded ? 'D' : 'L';
    });
}

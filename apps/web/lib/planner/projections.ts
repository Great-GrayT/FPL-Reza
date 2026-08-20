import { AVAILABILITY_WEIGHT, DIFFICULTY_STEP, FORM_WINDOW, rollingForm } from '@fpl/analytics';
import type { Fixture, Player, PlayerGameweek, Team } from '@fpl/core';
import type { PlannerPlayer } from '@fpl/planner';

/**
 * A projection per gameweek, rather than one number for a horizon.
 *
 * The squad builder only needs to rank players, so one number over three weeks
 * is enough there. A plan does not: a blank gameweek is a zero and a double is
 * two matches, and a planner that averaged them away would never bank a
 * transfer for the double or sell before the blank, which is most of what
 * planning is. So the fixture term is applied per gameweek and summed over the
 * matches that gameweek actually holds.
 */

/** Difficulty at which the fixture term is neutral. FPL's own scale is 1 to 5. */
const NEUTRAL_DIFFICULTY = 3;
const FIXTURE_FLOOR = 0.6;
const FIXTURE_CEILING = 1.4;

/**
 * Spread where a player has too little history to measure his own.
 *
 * FPL returns are lumpy: most gameweeks are two or three points and a few are
 * fifteen. Below four appearances the sample says nothing, so the fallback is
 * proportional to the projection rather than fitted, which is stated here
 * rather than presented as measured.
 */
const SPREAD_FALLBACK_RATIO = 1.1;
const MIN_ROWS_FOR_SPREAD = 4;

export interface ProjectionOptions {
  /** First gameweek of the plan. */
  fromGameweek: number;
  /** How many gameweeks to project. */
  horizon: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** The multiplier one fixture's difficulty puts on a player's base rate. */
export function fixtureMultiplier(difficulty: number): number {
  return clamp(
    1 + (NEUTRAL_DIFFICULTY - difficulty) * DIFFICULTY_STEP,
    FIXTURE_FLOOR,
    FIXTURE_CEILING,
  );
}

/** Every fixture a club plays in a gameweek: none for a blank, two for a double. */
function fixturesByGameweek(
  fixtures: readonly Fixture[],
): Map<number, { teamId: number; difficulty: number; opponent: number; home: boolean }[]> {
  const out = new Map<
    number,
    { teamId: number; difficulty: number; opponent: number; home: boolean }[]
  >();
  for (const fixture of fixtures) {
    if (fixture.gameweek === null || fixture.finished) continue;
    const week = Number(fixture.gameweek);
    const entries = out.get(week) ?? [];
    entries.push({
      teamId: Number(fixture.homeTeam),
      difficulty: fixture.homeDifficulty,
      opponent: Number(fixture.awayTeam),
      home: true,
    });
    entries.push({
      teamId: Number(fixture.awayTeam),
      difficulty: fixture.awayDifficulty,
      opponent: Number(fixture.homeTeam),
      home: false,
    });
    out.set(week, entries);
  }
  return out;
}

/** Standard deviation of a player's own recent returns, or null if too few. */
function measuredSpread(history: readonly PlayerGameweek[]): number | null {
  const points = history.slice(-FORM_WINDOW * 2).map((row) => row.totalPoints);
  if (points.length < MIN_ROWS_FOR_SPREAD) return null;
  const mean = points.reduce((total, value) => total + value, 0) / points.length;
  const variance =
    points.reduce((total, value) => total + (value - mean) ** 2, 0) / (points.length - 1);
  return Math.sqrt(variance);
}

/**
 * The chance a price rises before a gameweek.
 *
 * This is the stated heuristic, not the fitted model: FPL publishes net
 * transfers only for the live gameweek and the lake does not store them, so the
 * two signals available at build time are ownership, which is what the change
 * threshold scales with, and recent scoring, which is what drives the transfers
 * in. The fitted priceChange model is better and needs the transfer columns
 * before it can be run here; until then this is labelled a heuristic wherever
 * it is shown.
 */
function riseProbability(player: Player, form: number): number {
  const owned = clamp(player.selectedByPercent / 25, 0, 1);
  const scoring = clamp((form - 3) / 5, 0, 1);
  return clamp(0.02 + 0.35 * owned * scoring + 0.08 * scoring, 0, 0.6);
}

/**
 * A player as the page ships him, which is not how the planner reads him.
 *
 * The planner wants a spread and a price rise probability per gameweek, and
 * both of those are 38 numbers per player that carry almost no information: a
 * rise probability does not vary by week at all, and a spread varies only with
 * how many matches the club plays, which is one of three values. Shipping them
 * literally is 45,000 numbers of pure repetition in a payload a reader waits
 * for, so the wire carries the scalars and the worker expands them.
 *
 * The projections themselves are not compressible this way and are shipped in
 * full: they are the answer to a different question per player per week.
 */
export interface WirePlayer {
  code: number;
  name: string;
  position: PlannerPlayer['position'];
  teamCode: number;
  price: number;
  projections: number[];
  /** Spread of one match's return. The weekly spread scales with the root of the match count. */
  spread: number;
  /** Probability the price rises, which the projection treats as flat over the horizon. */
  rise: number;
  available: boolean;
  /**
   * The rates the projection is built from, per ninety minutes, over the same
   * form window. They travel so the plan page can show what a squad is made of
   * rather than only what it is worth: a projection a reader cannot take apart
   * is a projection they can only trust or ignore.
   */
  xg90: number;
  xa90: number;
  /** CBIT for a defender, CBIRT for everyone else. Null before the rule existed. */
  cbi90: number;
  bps90: number;
  /** Minutes he is expected to play in a match he is available for. */
  minutes: number;
  /** Owned by, as a percentage: the differential axis. */
  ownership: number;
}

export interface PlannerPool {
  players: WirePlayer[];
  gameweeks: number[];
  /** Per gameweek, how many clubs have no fixture and how many have two. */
  calendar: { gameweek: number; blanks: number[]; doubles: number[] }[];
  /** Matches per club per gameweek, in `gameweeks` order: 0 is a blank, 2 a double. */
  matches: Record<string, number[]>;
}

/** Turn the wire shape back into what the planner reads. */
export function expandPool(pool: PlannerPool): PlannerPlayer[] {
  const weeks = pool.gameweeks.length;
  return pool.players.map((player) => {
    const counts = pool.matches[String(player.teamCode)] ?? [];
    const spreads: number[] = [];
    const riseProbabilities: number[] = [];
    for (let week = 0; week < weeks; week += 1) {
      // Two matches are two independent draws, so the spread grows with the
      // root of the count rather than with the count.
      spreads.push(Math.round(player.spread * Math.sqrt(counts[week] ?? 0) * 100) / 100);
      riseProbabilities.push(player.rise);
    }
    return {
      code: player.code,
      name: player.name,
      position: player.position,
      teamCode: player.teamCode,
      price: player.price,
      projections: player.projections,
      spreads,
      riseProbabilities,
      available: player.available,
    } satisfies PlannerPlayer;
  });
}

/**
 * Build the pool the planner searches over.
 *
 * Every number here is computed once at build time. The browser gets one row
 * per player with one projection per gameweek, which is what makes replanning
 * on a slider instant rather than a request.
 */
export function buildPool(
  players: readonly Player[],
  teams: readonly Team[],
  fixtures: readonly Fixture[],
  historyOf: (playerId: number) => readonly PlayerGameweek[],
  options: ProjectionOptions,
): PlannerPool {
  const byWeek = fixturesByGameweek(fixtures);
  const weeks = Array.from({ length: options.horizon }, (_, index) => options.fromGameweek + index);
  const teamCodeOf = new Map(teams.map((team) => [Number(team.id), team.code]));

  const rows: WirePlayer[] = players.map((player) => {
    const history = historyOf(Number(player.id));
    const form = rollingForm(history, FORM_WINDOW);

    // Base is points per match, from the form window where there is one and
    // last season's rate before a season has matches.
    const base =
      form.gameweeksConsidered > 0
        ? form.pointsPerGame
        : player.pointsPerGame > 0
          ? player.pointsPerGame
          : player.totalPoints / 38;

    const minutesMultiplier =
      AVAILABILITY_WEIGHT[player.availability] *
      (form.gameweeksConsidered > 0 ? Math.max(0.35, form.starterReliability) : 0.8);

    const spread = measuredSpread(history);
    const rise = riseProbability(player, base);

    // The rates behind the projection, over the same window it uses. Summed
    // over minutes rather than over matches, because a substitute's half hour
    // is half an hour of chances and not half a match of them.
    const window = history.slice(-FORM_WINDOW);
    const played = window.reduce((total, row) => total + row.minutes, 0);
    const rate = (read: (row: PlayerGameweek) => number): number =>
      played <= 0
        ? 0
        : Math.round(((window.reduce((total, row) => total + read(row), 0) * 90) / played) * 100) /
          100;

    const projections: number[] = [];
    for (const week of weeks) {
      const matches = (byWeek.get(week) ?? []).filter(
        (entry) => entry.teamId === Number(player.teamId),
      );
      let points = 0;
      for (const match of matches) {
        points += base * fixtureMultiplier(match.difficulty) * minutesMultiplier;
      }
      projections.push(Math.round(points * 100) / 100);
    }

    return {
      code: player.code,
      name: player.webName,
      position: player.position,
      teamCode: teamCodeOf.get(Number(player.teamId)) ?? 0,
      price: player.price,
      projections,
      spread: Math.round((spread ?? base * SPREAD_FALLBACK_RATIO) * 100) / 100,
      rise: Math.round(rise * 100) / 100,
      available: AVAILABILITY_WEIGHT[player.availability] > 0,
      xg90: rate((row) => row.expectedGoals),
      xa90: rate((row) => row.expectedAssists),
      cbi90: rate((row) => row.defensiveContribution ?? 0),
      bps90: rate((row) => row.bps),
      minutes: Math.round(form.minutesPerGame),
      ownership: player.selectedByPercent,
    } satisfies WirePlayer;
  });

  const calendar = weeks.map((week) => {
    const entries = byWeek.get(week) ?? [];
    const counts = new Map<number, number>();
    for (const team of teams) counts.set(Number(team.id), 0);
    for (const entry of entries) counts.set(entry.teamId, (counts.get(entry.teamId) ?? 0) + 1);
    const blanks: number[] = [];
    const doubles: number[] = [];
    for (const [teamId, count] of counts) {
      const code = teamCodeOf.get(teamId);
      if (code === undefined) continue;
      if (count === 0) blanks.push(code);
      if (count > 1) doubles.push(code);
    }
    return { gameweek: week, blanks, doubles };
  });

  const matches: Record<string, number[]> = {};
  for (const team of teams) {
    const code = teamCodeOf.get(Number(team.id));
    if (code === undefined) continue;
    matches[String(code)] = weeks.map(
      (week) => (byWeek.get(week) ?? []).filter((entry) => entry.teamId === Number(team.id)).length,
    );
  }

  return { players: rows, gameweeks: weeks, calendar, matches };
}

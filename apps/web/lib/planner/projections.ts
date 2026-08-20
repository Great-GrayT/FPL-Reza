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

export interface PlannerPool {
  players: PlannerPlayer[];
  gameweeks: number[];
  /** Per gameweek, how many clubs have no fixture and how many have two. */
  calendar: { gameweek: number; blanks: number[]; doubles: number[] }[];
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

  const rows: PlannerPlayer[] = players.map((player) => {
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

    const projections: number[] = [];
    const spreads: number[] = [];
    for (const week of weeks) {
      const matches = (byWeek.get(week) ?? []).filter(
        (entry) => entry.teamId === Number(player.teamId),
      );
      let points = 0;
      for (const match of matches) {
        points += base * fixtureMultiplier(match.difficulty) * minutesMultiplier;
      }
      projections.push(Math.round(points * 100) / 100);
      // Two matches are two independent draws, so the spread grows with the
      // root of the count rather than with the count.
      const perMatch = spread ?? base * SPREAD_FALLBACK_RATIO;
      spreads.push(Math.round(perMatch * Math.sqrt(Math.max(matches.length, 0)) * 100) / 100);
    }

    return {
      code: player.code,
      name: player.webName,
      position: player.position,
      teamCode: teamCodeOf.get(Number(player.teamId)) ?? 0,
      price: player.price,
      projections,
      spreads,
      riseProbabilities: weeks.map(() => rise),
      available: AVAILABILITY_WEIGHT[player.availability] > 0,
    } satisfies PlannerPlayer;
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

  return { players: rows, gameweeks: weeks, calendar };
}

import {
  asGameweekId,
  type Availability,
  type Fixture,
  type GameweekId,
  type Player,
  type PlayerGameweek,
  type Position,
  type TeamId,
} from '@fpl/core';
import { rollingForm } from './form.js';
import { fixtureDifficulty } from './fixtures.js';

/**
 * A points per gameweek projection. It is a transparent heuristic, not a model
 * with a fitted parameter anywhere: every term is named, every weight is a
 * constant here, and the output carries its own explanation so a page can show
 * a manager why a player was ranked where they were.
 *
 * The alternative, an opaque score, would be worse than useless in a squad
 * builder: a manager has to be able to disagree with it.
 */

/** How many recent gameweeks count as form. Six is FPL's own form window. */
export const FORM_WINDOW = 6;

/**
 * Fixture difficulty runs 1 (easiest) to 5 (hardest) and 3 is neutral. A swing
 * of 12 percent per step is deliberately modest: difficulty is a coarse rating,
 * and a bigger multiplier would let it overwhelm a player's own record.
 */
export const DIFFICULTY_STEP = 0.12;

/** What each availability status is worth as a multiplier on expected minutes. */
export const AVAILABILITY_WEIGHT: Readonly<Record<Availability, number>> = {
  available: 1,
  doubtful: 0.5,
  injured: 0,
  suspended: 0,
  unavailable: 0,
  not_in_squad: 0.1,
};

/**
 * Season points per game, used where a player has no recent history at all. The
 * pre season case: FPL has reset nothing yet, so the only evidence is last
 * season's total, which is better than a zero for everybody.
 */
const fallbackPointsPerGame = (player: Player): number =>
  player.pointsPerGame > 0 ? player.pointsPerGame : player.totalPoints / 38;

export interface ProjectionParts {
  /** Points per game from the form window, or the season fallback. */
  base: number;
  /** Multiplier from the fixture difficulty over the horizon. */
  fixtureMultiplier: number;
  /** Multiplier from availability and how reliably the player starts. */
  minutesMultiplier: number;
  /** base times both multipliers, which is the number the builder ranks on. */
  points: number;
  /** Every input in words, for a tooltip that has to justify the ranking. */
  explain: string[];
}

export interface ProjectionInputs {
  /** This season's gameweeks for the player, newest last. Empty pre season. */
  history?: readonly PlayerGameweek[];
  fixtures?: readonly Fixture[];
  fromGameweek?: number;
  /** Gameweeks ahead to weigh fixtures over. One means the next match only. */
  horizon?: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function projectPoints(player: Player, inputs: ProjectionInputs = {}): ProjectionParts {
  const history = inputs.history ?? [];
  const form = rollingForm(history, FORM_WINDOW);
  const explain: string[] = [];

  const base = form.gameweeksConsidered > 0 ? form.pointsPerGame : fallbackPointsPerGame(player);
  explain.push(
    form.gameweeksConsidered > 0
      ? `${base.toFixed(1)} points per game over the last ${String(form.gameweeksConsidered)} gameweeks`
      : `${base.toFixed(1)} points per game, from last season since this one has no matches yet`,
  );

  let fixtureMultiplier = 1;
  if (inputs.fixtures !== undefined && inputs.fromGameweek !== undefined) {
    const horizon = inputs.horizon ?? 1;
    const difficulty = fixtureDifficulty(
      inputs.fixtures,
      player.teamId,
      asGameweekId(inputs.fromGameweek),
      horizon,
    );
    const average = difficulty.averageDifficulty;
    if (average !== null) {
      // 3 is neutral, so an average of 2 lifts and an average of 4 cuts.
      fixtureMultiplier = clamp(1 + (3 - average) * DIFFICULTY_STEP, 0.6, 1.4);
      explain.push(
        `fixture difficulty averages ${average.toFixed(1)} over ${String(horizon)} gameweeks`,
      );
    }
    if (difficulty.blankGameweeks.length > 0) {
      explain.push(`blank in gameweek ${difficulty.blankGameweeks.join(', ')}`);
    }
    if (difficulty.doubleGameweeks.length > 0) {
      explain.push(`double gameweek in ${difficulty.doubleGameweeks.join(', ')}`);
    }
  }

  const availability = AVAILABILITY_WEIGHT[player.availability];
  // Starter reliability only counts once there is evidence for it; pre season
  // every player would otherwise read as a non starter.
  const reliability =
    form.gameweeksConsidered > 0 ? clamp(0.6 + 0.4 * form.starterReliability, 0.6, 1) : 1;
  const minutesMultiplier = availability * reliability;

  if (availability < 1) explain.push(`listed as ${player.availability.replace('_', ' ')}`);
  if (form.gameweeksConsidered > 0 && form.starterReliability < 1) {
    explain.push(
      `started ${String(Math.round(form.starterReliability * 100))} percent of those gameweeks`,
    );
  }

  const points = base * fixtureMultiplier * minutesMultiplier;

  return { base, fixtureMultiplier, minutesMultiplier, points, explain };
}

/** The projection as a plain ranking function, which is what the squad engine takes. */
export const projectionFor =
  (inputsFor: (player: Player) => ProjectionInputs) =>
  (player: Player): number =>
    projectPoints(player, inputsFor(player)).points;

export interface DifferentialRow {
  player: Player;
  ownership: number;
  projected: number;
  /** Projected points per gameweek per percent owned: high means overlooked. */
  edge: number;
}

/**
 * Players the projection likes and the crowd has not found. Ownership is the
 * only competitive dimension in FPL that is not about points: a player everybody
 * owns cannot gain rank, however well they score.
 */
export function differentials(
  players: readonly Player[],
  projection: (player: Player) => number,
  options: { maxOwnership?: number; minProjected?: number; limit?: number } = {},
): DifferentialRow[] {
  const maxOwnership = options.maxOwnership ?? 10;
  const minProjected = options.minProjected ?? 3;

  return players
    .map((player) => {
      const projected = projection(player);
      return {
        player,
        ownership: player.selectedByPercent,
        projected,
        // Floored at a tenth of a percent so a nearly unowned player does not
        // divide by zero into an infinite edge.
        edge: projected / Math.max(player.selectedByPercent, 0.1),
      };
    })
    .filter((row) => row.ownership <= maxOwnership && row.projected >= minProjected)
    .sort((a, b) => b.edge - a.edge)
    .slice(0, options.limit ?? 20);
}

export interface FixtureSwing {
  teamId: TeamId;
  /** Average difficulty over the horizon, 1 easiest to 5 hardest. Null when the club has no fixture in it at all. */
  averageDifficulty: number | null;
  blanks: GameweekId[];
  doubles: GameweekId[];
}

/** Every club's fixture run over a horizon, easiest first: the planning view. */
export function fixtureSwings(
  fixtures: readonly Fixture[],
  teamIds: readonly TeamId[],
  fromGameweek: number,
  horizon: number,
): FixtureSwing[] {
  return (
    teamIds
      .map((teamId) => {
        const difficulty = fixtureDifficulty(fixtures, teamId, asGameweekId(fromGameweek), horizon);
        return {
          teamId,
          averageDifficulty: difficulty.averageDifficulty,
          blanks: difficulty.blankGameweeks,
          doubles: difficulty.doubleGameweeks,
        };
      })
      // A club with no fixture in the horizon has nothing to compare, so it
      // sorts last instead of ranking as the easiest run available.
      .sort((a, b) => (a.averageDifficulty ?? 99) - (b.averageDifficulty ?? 99))
  );
}

/** Positions in the order a teamsheet prints them. */
export const TEAMSHEET_ORDER: readonly Position[] = ['GKP', 'DEF', 'MID', 'FWD'];

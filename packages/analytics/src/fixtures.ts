import type { Fixture, GameweekId, Team, TeamId } from '@fpl/core';
import { GAMEWEEKS_PER_SEASON, difficultyFor, isHome, opponentOf } from '@fpl/core';

export interface FixtureDifficultyEntry {
  gameweek: GameweekId;
  fixtureId: Fixture['id'];
  opponent: TeamId;
  isHome: boolean;
  /** FPL's own 1 to 5 difficulty rating, from this team's perspective. */
  difficulty: number;
}

export interface FixtureDifficultySummary {
  fromGameweek: GameweekId;
  /** Horizon as requested by the caller, not truncated to the season boundary. */
  horizon: number;
  /**
   * Gameweeks actually considered: `horizon` gameweeks from `fromGameweek`, capped
   * at `GAMEWEEKS_PER_SEASON`. Shorter than `horizon` when the requested window
   * runs past the end of the season.
   */
  effectiveGameweeks: GameweekId[];
  entries: FixtureDifficultyEntry[];
  /** Gameweeks in `effectiveGameweeks` with no fixture for this team. Never includes a gameweek past the season. */
  blankGameweeks: GameweekId[];
  /** Gameweeks in `effectiveGameweeks` with more than one fixture for this team. */
  doubleGameweeks: GameweekId[];
  /** Mean difficulty across `entries`. Null when the horizon has no fixtures at all, never 0 or NaN as a stand-in. */
  averageDifficulty: number | null;
}

/**
 * Gameweeks from `fromGameweek` up to `horizon` long, capped at the last
 * gameweek of the season. A horizon that overruns the season end is silently
 * shortened rather than producing gameweek ids that do not exist.
 */
function gameweeksInHorizon(fromGameweek: GameweekId, horizon: number): GameweekId[] {
  const ids: GameweekId[] = [];
  for (let offset = 0; offset < horizon; offset += 1) {
    const candidate = fromGameweek + offset;
    if (candidate > GAMEWEEKS_PER_SEASON) break;
    // fromGameweek is a branded GameweekId; the arithmetic result is re-cast, not re-validated,
    // because the brand only guards construction from raw input, not internal derivation, and
    // the season-end check above already keeps it in range.
    ids.push(candidate as GameweekId);
  }
  return ids;
}

/**
 * Fixture difficulty for `teamId` over `horizon` gameweeks starting at `fromGameweek`.
 * `fixtures` may contain fixtures for any team; only ones involving `teamId` are used.
 * A gameweek with none is a blank, one with two or more is a double: both are reported
 * explicitly rather than silently averaged away.
 */
export function fixtureDifficulty(
  fixtures: readonly Fixture[],
  teamId: TeamId,
  fromGameweek: GameweekId,
  horizon: number,
): FixtureDifficultySummary {
  const horizonGameweeks = gameweeksInHorizon(fromGameweek, horizon);
  const horizonSet = new Set<GameweekId>(horizonGameweeks);

  const teamFixtures = fixtures.filter(
    (fixture) =>
      fixture.gameweek !== null &&
      horizonSet.has(fixture.gameweek) &&
      (fixture.homeTeam === teamId || fixture.awayTeam === teamId),
  );

  // flatMap rather than map, so the nullable gameweek is narrowed by control
  // flow instead of asserted away.
  const entries: FixtureDifficultyEntry[] = teamFixtures.flatMap((fixture) => {
    const gameweek = fixture.gameweek;
    if (gameweek === null) return [];
    return [
      {
        gameweek,
        fixtureId: fixture.id,
        opponent: opponentOf(fixture, teamId),
        isHome: isHome(fixture, teamId),
        difficulty: difficultyFor(fixture, teamId),
      },
    ];
  });

  const countByGameweek = new Map<GameweekId, number>();
  for (const entry of entries) {
    countByGameweek.set(entry.gameweek, (countByGameweek.get(entry.gameweek) ?? 0) + 1);
  }

  const blankGameweeks = horizonGameweeks.filter((gw) => !countByGameweek.has(gw));
  const doubleGameweeks = horizonGameweeks.filter((gw) => (countByGameweek.get(gw) ?? 0) > 1);

  const averageDifficulty =
    entries.length === 0
      ? null
      : entries.reduce((sum, entry) => sum + entry.difficulty, 0) / entries.length;

  return {
    fromGameweek,
    horizon,
    effectiveGameweeks: horizonGameweeks,
    entries,
    blankGameweeks,
    doubleGameweeks,
    averageDifficulty,
  };
}

export interface StrengthAdjustedEntry extends FixtureDifficultyEntry {
  /**
   * This team's attack strength minus the opponent's defence strength, each read
   * from the side of the pitch they are actually on (home split for the home
   * side, away split for the away side). Higher favours the attacking team.
   */
  strengthDifferential: number;
}

export interface StrengthAdjustedSummary {
  fromGameweek: GameweekId;
  horizon: number;
  effectiveGameweeks: GameweekId[];
  entries: StrengthAdjustedEntry[];
  blankGameweeks: GameweekId[];
  doubleGameweeks: GameweekId[];
  /**
   * Mean strength differential across `entries`. Null when the horizon has no
   * fixtures at all: unlike a 1 to 5 difficulty, 0 here is a real, legitimate
   * reading (an evenly matched run), so it cannot double as "no fixtures".
   * Callers must handle null rather than treating it as a value.
   */
  averageStrengthDifferential: number | null;
}

/**
 * Strength-adjusted difficulty: FPL's 1-5 rating compressed to one bucket per
 * matchup, whereas the underlying attack/defence strengths keep the full
 * resolution. `teamsById` must contain `team` and every opponent it faces in
 * the horizon; a missing opponent throws rather than silently skipping it.
 */
export function strengthAdjustedFixtureDifficulty(
  fixtures: readonly Fixture[],
  team: Team,
  teamsById: ReadonlyMap<TeamId, Team>,
  fromGameweek: GameweekId,
  horizon: number,
): StrengthAdjustedSummary {
  const base = fixtureDifficulty(fixtures, team.id, fromGameweek, horizon);

  const entries: StrengthAdjustedEntry[] = base.entries.map((entry) => {
    const opponent = teamsById.get(entry.opponent);
    if (opponent === undefined) {
      throw new Error(`missing team ${entry.opponent} for strength adjusted difficulty`);
    }

    const ourAttack = entry.isHome ? team.strengthAttackHome : team.strengthAttackAway;
    // opponent sits on the opposite side of the pitch from us
    const opponentDefence = entry.isHome
      ? opponent.strengthDefenceAway
      : opponent.strengthDefenceHome;

    return { ...entry, strengthDifferential: ourAttack - opponentDefence };
  });

  const averageStrengthDifferential =
    entries.length === 0
      ? null
      : entries.reduce((sum, entry) => sum + entry.strengthDifferential, 0) / entries.length;

  return {
    fromGameweek: base.fromGameweek,
    horizon: base.horizon,
    effectiveGameweeks: base.effectiveGameweeks,
    entries,
    blankGameweeks: base.blankGameweeks,
    doubleGameweeks: base.doubleGameweeks,
    averageStrengthDifferential,
  };
}

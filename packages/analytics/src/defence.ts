import type { PlayerGameweek, Position } from '@fpl/core';
import { DEFENSIVE_CONTRIBUTION_POINTS, DEFENSIVE_CONTRIBUTION_THRESHOLD, per90 } from '@fpl/core';

export interface DefensiveContributionSummary {
  /** Gameweeks with a non-null reading. Null predates the rule and is excluded, not zeroed. */
  eligibleGameweeks: number;
  per90: number;
  /** Share of eligible gameweeks hitting the positional threshold, 0 to 1. Always 0 for GKP. */
  thresholdHitRate: number;
  /** thresholdHitRate scaled to the points the rule pays out. */
  expectedPointsPerGameweek: number;
}

/**
 * Defensive contribution read for one player across a set of gameweeks.
 * `gameweeks` need not be sorted or windowed; every non-null entry counts.
 */
export function defensiveContributionSummary(
  position: Position,
  gameweeks: readonly PlayerGameweek[],
): DefensiveContributionSummary {
  const threshold = DEFENSIVE_CONTRIBUTION_THRESHOLD[position];

  let eligibleGameweeks = 0;
  let totalActions = 0;
  let totalMinutes = 0;
  let hits = 0;

  for (const gw of gameweeks) {
    if (gw.defensiveContribution === null) continue;
    eligibleGameweeks += 1;
    totalActions += gw.defensiveContribution;
    totalMinutes += gw.minutes;
    if (threshold !== null && gw.defensiveContribution >= threshold) hits += 1;
  }

  const thresholdHitRate = eligibleGameweeks === 0 ? 0 : hits / eligibleGameweeks;

  return {
    eligibleGameweeks,
    per90: per90(totalActions, totalMinutes),
    thresholdHitRate,
    expectedPointsPerGameweek: thresholdHitRate * DEFENSIVE_CONTRIBUTION_POINTS,
  };
}

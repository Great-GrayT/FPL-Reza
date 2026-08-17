import type { PlayerGameweek } from '@fpl/core';
import { per90, FULL_APPEARANCE_MINUTES } from '@fpl/core';

export interface FormWindow {
  /** How many gameweeks were actually available, which can be less than the requested window. */
  gameweeksConsidered: number;
  pointsPerGame: number;
  pointsPer90: number;
  minutesPerGame: number;
  expectedGoalInvolvementsPer90: number;
  /** Share of the considered gameweeks with a full appearance (60+ minutes), 0 to 1. */
  starterReliability: number;
}

/**
 * Rolling form over the last `windowSize` gameweeks. Entries are assumed sorted
 * ascending by gameweek; only the tail is used, so callers do not need to slice
 * first. Fewer than `windowSize` entries just shrinks `gameweeksConsidered`.
 */
export function rollingForm(gameweeks: readonly PlayerGameweek[], windowSize: number): FormWindow {
  const window = gameweeks.slice(-windowSize);
  const gameweeksConsidered = window.length;

  if (gameweeksConsidered === 0) {
    return {
      gameweeksConsidered: 0,
      pointsPerGame: 0,
      pointsPer90: 0,
      minutesPerGame: 0,
      expectedGoalInvolvementsPer90: 0,
      starterReliability: 0,
    };
  }

  let totalPoints = 0;
  let totalMinutes = 0;
  let totalExpectedGoalInvolvements = 0;
  let fullAppearances = 0;

  for (const gw of window) {
    totalPoints += gw.totalPoints;
    totalMinutes += gw.minutes;
    totalExpectedGoalInvolvements += gw.expectedGoals + gw.expectedAssists;
    if (gw.minutes >= FULL_APPEARANCE_MINUTES) fullAppearances += 1;
  }

  return {
    gameweeksConsidered,
    pointsPerGame: totalPoints / gameweeksConsidered,
    pointsPer90: per90(totalPoints, totalMinutes),
    minutesPerGame: totalMinutes / gameweeksConsidered,
    expectedGoalInvolvementsPer90: per90(totalExpectedGoalInvolvements, totalMinutes),
    starterReliability: fullAppearances / gameweeksConsidered,
  };
}

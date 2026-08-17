/**
 * Bonus Points System weights, per the official rules reconciled on
 * 2026-08-16. BPS itself arrives from Opta in the FPL feed, so these values
 * are here to predict bonus before it is awarded, not to recompute it after.
 *
 * The three highest BPS scores in a match take 3, 2 and 1 bonus points. Ties
 * share the higher award and consume the places below them.
 */

export const BONUS_AWARDS = [3, 2, 1] as const;

export const BPS = {
  playedUpTo60Minutes: 3,
  playedOver60Minutes: 6,

  goalFromPenalty: 12,
  goalKeeperOrDefender: 12,
  goalMidfielder: 18,
  goalForward: 24,
  assist: 9,

  cleanSheetKeeperOrDefender: 12,
  save: 2,
  saveFromShotInsideBox: 1,
  saveFromBigChance: 1,
  penaltySave: 7,
  goallineClearance: 9,

  /** Awarded once per completed group of three. */
  perThreeClearancesBlocksInterceptions: 1,
  perThreeRecoveries: 1,

  chanceCreated: 1,
  bigChanceCreated: 3,
  successfulOpenPlayCross: 1,
  successfulTackle: 2,
  successfulDribble: 1,
  matchWinningGoal: 3,
  foulWon: 1,
  shotOnTarget: 2,

  passCompletion70to79: 2,
  passCompletion80to89: 4,
  passCompletion90Plus: 6,

  goalConcededKeeperOrDefender: -4,
  penaltyConceded: -3,
  penaltyMissed: -6,
  yellowCard: -3,
  redCard: -9,
  ownGoal: -6,
  bigChanceMissed: -3,
  errorLeadingToGoal: -3,
  errorLeadingToAttempt: -1,
  foulConceded: -1,
  caughtOffside: -1,
  shotOffTarget: -1,
} as const;

/** Pass completion bonuses need this many attempted passes to apply at all. */
export const BPS_MIN_PASSES_ATTEMPTED = 30;

export function passCompletionBps(attempted: number, completionPercent: number): number {
  if (attempted < BPS_MIN_PASSES_ATTEMPTED) return 0;
  if (completionPercent >= 90) return BPS.passCompletion90Plus;
  if (completionPercent >= 80) return BPS.passCompletion80to89;
  if (completionPercent >= 70) return BPS.passCompletion70to79;
  return 0;
}

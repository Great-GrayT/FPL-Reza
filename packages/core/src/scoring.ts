import type { Position } from './position.js';

/**
 * Match scoring, per the official rules reconciled on 2026-08-16. Every value
 * here is a rule constant, not a tuning parameter: nothing in this file may be
 * changed to fit a model.
 */

/** Minutes at or above this earn the full appearance points and clean sheet eligibility. */
export const FULL_APPEARANCE_MINUTES = 60;
export const APPEARANCE_POINTS_SHORT = 1;
export const APPEARANCE_POINTS_FULL = 2;

export const GOAL_POINTS: Readonly<Record<Position, number>> = {
  GKP: 10,
  DEF: 6,
  MID: 5,
  FWD: 4,
};

export const ASSIST_POINTS = 3;

export const CLEAN_SHEET_POINTS: Readonly<Record<Position, number>> = {
  GKP: 4,
  DEF: 4,
  MID: 1,
  FWD: 0,
};

/** One point per this many saves, keepers only. Remainder is discarded. */
export const SAVES_PER_POINT = 3;

/** Minus one point per this many goals conceded, keepers and defenders only. */
export const GOALS_CONCEDED_PER_PENALTY = 2;

export const PENALTY_SAVE_POINTS = 5;
export const PENALTY_MISS_POINTS = -2;
export const YELLOW_CARD_POINTS = -1;
export const RED_CARD_POINTS = -3;
export const OWN_GOAL_POINTS = -2;

export const MIN_BONUS_POINTS = 0;
export const MAX_BONUS_POINTS = 3;

/**
 * Defensive contribution. Defenders count clearances, blocks, interceptions
 * and tackles. Midfielders and forwards also count recoveries, against a
 * higher threshold. The award does not stack: hitting double the threshold
 * still pays once. Keepers are not eligible.
 */
export const DEFENSIVE_CONTRIBUTION_POINTS = 2;

export const DEFENSIVE_CONTRIBUTION_THRESHOLD: Readonly<Record<Position, number | null>> = {
  GKP: null,
  DEF: 10,
  MID: 12,
  FWD: 12,
};

export interface ScoringInput {
  minutes: number;
  goals: number;
  assists: number;
  /** As reported by FPL. Only pays out alongside a full appearance. */
  cleanSheet: boolean;
  goalsConceded: number;
  saves: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  yellowCards: number;
  redCards: number;
  ownGoals: number;
  /**
   * CBIT for defenders, CBIRT for midfielders and forwards. Absent when the
   * source does not carry the underlying Opta counts.
   */
  defensiveContribution?: number;
  bonus: number;
}

export interface PointsBreakdown {
  appearance: number;
  goals: number;
  assists: number;
  cleanSheet: number;
  saves: number;
  goalsConceded: number;
  penaltySaves: number;
  penaltyMisses: number;
  cards: number;
  ownGoals: number;
  defensiveContribution: number;
  bonus: number;
  total: number;
}

export function appearancePoints(minutes: number): number {
  if (minutes <= 0) return 0;
  return minutes >= FULL_APPEARANCE_MINUTES ? APPEARANCE_POINTS_FULL : APPEARANCE_POINTS_SHORT;
}

export function defensiveContributionPoints(position: Position, actions: number): number {
  const threshold = DEFENSIVE_CONTRIBUTION_THRESHOLD[position];
  if (threshold === null) return 0;
  return actions >= threshold ? DEFENSIVE_CONTRIBUTION_POINTS : 0;
}

/**
 * Cards are resolved together because a red already absorbs any yellow shown
 * in the same match: a sending off costs 3 points in total, not 4.
 */
export function cardPoints(yellowCards: number, redCards: number): number {
  if (redCards > 0) return RED_CARD_POINTS;
  return yellowCards * YELLOW_CARD_POINTS;
}

export function scorePlayerGameweek(position: Position, stats: ScoringInput): PointsBreakdown {
  const played = stats.minutes > 0;
  const fullAppearance = stats.minutes >= FULL_APPEARANCE_MINUTES;

  const cleanSheet = stats.cleanSheet && fullAppearance ? CLEAN_SHEET_POINTS[position] : 0;

  const concededPenalty =
    position === 'GKP' || position === 'DEF'
      ? -Math.floor(stats.goalsConceded / GOALS_CONCEDED_PER_PENALTY)
      : 0;

  const savePoints = position === 'GKP' ? Math.floor(stats.saves / SAVES_PER_POINT) : 0;

  const defensive = played
    ? defensiveContributionPoints(position, stats.defensiveContribution ?? 0)
    : 0;

  const breakdown: Omit<PointsBreakdown, 'total'> = {
    appearance: appearancePoints(stats.minutes),
    goals: stats.goals * GOAL_POINTS[position],
    assists: stats.assists * ASSIST_POINTS,
    cleanSheet,
    saves: savePoints,
    goalsConceded: concededPenalty,
    penaltySaves: stats.penaltiesSaved * PENALTY_SAVE_POINTS,
    penaltyMisses: stats.penaltiesMissed * PENALTY_MISS_POINTS,
    cards: cardPoints(stats.yellowCards, stats.redCards),
    ownGoals: stats.ownGoals * OWN_GOAL_POINTS,
    defensiveContribution: defensive,
    bonus: stats.bonus,
  };

  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return { ...breakdown, total };
}

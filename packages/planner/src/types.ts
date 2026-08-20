import type { Position } from '@fpl/core';

/**
 * What the planner needs to know, and nothing else.
 *
 * It takes projections rather than computing them, so the search can be tested
 * against numbers a test writes by hand, and so a reader can swap the fitted
 * model for their own opinion without touching the optimiser.
 */

export interface PlannerPlayer {
  code: number;
  name: string;
  position: Position;
  /** Permanent club code, which is what the three per club rule counts. */
  teamCode: number;
  /** Price now, in tenths of a million. */
  price: number;
  /**
   * Expected points per gameweek of the horizon, index 0 being the first.
   * A blank gameweek is a zero here rather than a gap, because a blank is a
   * real zero: the player does not play.
   */
  projections: number[];
  /**
   * Spread of those points, per gameweek, where the projection carries one. It
   * is what lets a manager ask for the safe squad rather than the best one.
   */
  spreads?: number[];
  /**
   * Probability the price rises before each gameweek. Over a season this is
   * what decides whether a squad can still afford its own plan.
   */
  riseProbabilities?: number[];
  /** Whether he is expected to be available at all: injury, suspension, sale. */
  available?: boolean;
}

export type Chip = 'wildcard' | 'free_hit' | 'bench_boost' | 'triple_captain';

export interface Squad {
  /** Fifteen player codes. */
  picks: number[];
  /** What each was bought for, so a sale prices correctly. */
  purchasePrices: Map<number, number>;
  /** Money not in the squad, in tenths. */
  bank: number;
  /** Transfers that cost nothing this week. FPL banks at most five. */
  freeTransfers: number;
  chipsUsed: Chip[];
  /**
   * Players sold earlier in this horizon. A plan may not buy one back: it is
   * legal in the game, and the model rates it when fixtures alternate, but it
   * is a plan nobody enters and it is an artefact of assuming a free transfer
   * costs nothing.
   */
  sold?: number[];
}

export interface PlanRules {
  squadSize: number;
  quota: Record<Position, number>;
  maxPerClub: number;
  /** Points deducted per transfer beyond the free allowance. */
  transferCost: number;
  /** Free transfers banked at most. */
  maxFreeTransfers: number;
  captainMultiplier: number;
  tripleCaptainMultiplier: number;
}

export const DEFAULT_RULES: PlanRules = {
  squadSize: 15,
  quota: { GKP: 2, DEF: 5, MID: 5, FWD: 3 },
  maxPerClub: 3,
  transferCost: 4,
  maxFreeTransfers: 5,
  captainMultiplier: 2,
  tripleCaptainMultiplier: 3,
};

/**
 * How long a player is fixed in the squad.
 *
 * Two different questions, and collapsing them into one checkbox would answer
 * the wrong one silently. "I own him today, is he worth keeping?" fixes him at
 * the start and lets the plan sell him; "I am keeping him, what is the best
 * team around him?" fixes him for the whole horizon.
 */
export type LockMode = 'always' | 'start';

/**
 * What a search maximises: points less a stated multiple of the spread, or the
 * best return per unit of risk, which is the tangency portfolio and needs no
 * appetite from the reader at all.
 */
export type Objective = 'mean' | 'sharpe';

export interface Lock {
  code: number;
  mode: LockMode;
}

/**
 * A player the search may not buy.
 *
 * The mirror of a lock, and needed for the same reason: a manager's view is
 * not only "keep him", it is also "not him". Two modes again, because the two
 * questions differ: `start` keeps him out of the opening fifteen and lets the
 * plan buy him later if the case becomes overwhelming, `always` keeps him out
 * for the whole horizon.
 */
export interface Ban {
  code: number;
  mode: LockMode;
}

export interface PlanOptions {
  /** Gameweeks to plan, from the first in the projections. */
  horizon: number;
  /** The gameweek index 0 of the projections refers to. */
  startGameweek: number;
  rules?: Partial<PlanRules>;
  /** States kept per gameweek. The cost knob, and the quality knob. */
  beamWidth?: number;
  /** Transfers considered in one gameweek. Two is a hit; three is rarely right. */
  maxTransfersPerWeek?: number;
  /**
   * How much a point next week is worth against a point this week. Below one it
   * prefers points now, which is what a manager chasing a rank wants and what
   * stops the search hoarding value it never spends.
   */
  discount?: number;
  /**
   * Risk appetite. At 0 the objective is the mean; above 0 it subtracts that
   * many standard deviations, which is the squad a manager protecting a rank
   * wants; below 0 it adds them, which is the squad a manager chasing one wants.
   */
  riskAversion?: number;
  /** Chips the manager still holds and is willing to spend in this horizon. */
  chips?: Chip[];
  /** Candidate transfers considered per week, ranked by projection gain. */
  candidatesPerWeek?: number;
  /**
   * The least a transfer has to gain before it is worth making. A free transfer
   * is not free: taken for a tenth of a point it produces a plan that sells a
   * player one week and buys him back the next.
   */
  minTransferGain?: number;
  /**
   * How many transfers a wildcard or free hit bundle may make. The unlimited
   * chips are searched with a bounded greedy rebuild rather than a full
   * re-optimisation inside every beam state, and this is that bound.
   */
  wildcardDepth?: number;
  /**
   * Players the plan may never sell. A lock is a constraint and never a bonus:
   * a locked player is not scored more highly, he is simply present, so the
   * cost of locking him shows up as a smaller excess over holding rather than
   * hidden inside a rearranged squad.
   */
  locked?: readonly number[];
  /**
   * Players the plan may never buy. A ban is a constraint like a lock, so its
   * cost shows up as a smaller excess over holding rather than hidden.
   */
  banned?: readonly number[];
}

export interface WeekPlan {
  gameweek: number;
  /** Squad after this week's transfers. */
  picks: number[];
  starters: number[];
  bench: number[];
  captain: number | null;
  viceCaptain: number | null;
  transfersIn: number[];
  transfersOut: number[];
  /** Transfers made, and what they cost after the free allowance. */
  transfers: number;
  hit: number;
  chip: Chip | null;
  /** Expected points for the week, after the hit. */
  expectedPoints: number;
  bank: number;
  /** What the fifteen are worth at this week's prices, in tenths. */
  squadValue: number;
  freeTransfers: number;
}

export interface Plan {
  weeks: WeekPlan[];
  /** Expected points over the horizon, after every hit. */
  total: number;
  /** The same squad held all the way through, taking no transfers at all. */
  holdTotal: number;
  /** What the plan is worth over doing nothing, which is the only claim it makes. */
  excess: number;
  transfers: number;
  hits: number;
  chipsPlayed: Chip[];
  /** States explored, so the cost of the answer is visible. */
  explored: number;
  riskAversion: number;
}

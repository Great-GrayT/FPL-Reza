import type { Chip, Plan } from '@fpl/planner';
import type { WirePlayer } from './projections';

/**
 * The contract between the planner's interface and its worker.
 *
 * A beam search over four weeks of transfers is tens of thousands of squad
 * evaluations, and every one of them runs `bestStartingEleven` over every legal
 * formation. That is fast, but it is not sixteen milliseconds fast, so it
 * happens off the main thread and the interface stays responsive while the
 * reader drags the horizon slider.
 */

/**
 * The pool travels with whichever request happens to be first, and is cached in
 * the worker by generation after that. Every request carries the same envelope
 * so no request kind has to be the one that loads it.
 */
export interface PoolEnvelope {
  poolGeneration: number;
  players?: WirePlayer[];
  /** Matches per club per gameweek, which is what expands a scalar spread. */
  matches?: Record<string, number[]>;
  gameweeks?: number[];
}

export interface PlanRequest extends PoolEnvelope {
  kind: 'plan';
  /** Codes of the fifteen the plan starts from. */
  squad: number[];
  purchasePrices?: [number, number][];
  bank: number;
  freeTransfers: number;
  startGameweek: number;
  horizon: number;
  riskAversion: number;
  chips: Chip[];
  maxTransfersPerWeek: number;
  beamWidth: number;
}

export interface AutoRequest extends PoolEnvelope {
  kind: 'auto';
  budget: number;
  /** Gameweeks the opening squad is chosen to be good over. */
  horizon: number;
}

export interface OptimiseRequest extends PoolEnvelope {
  kind: 'optimise';
  budget: number;
  /** Gameweeks the squad is chosen to be best over. */
  horizon: number;
  riskAversion: number;
  /** Codes the search must keep, which is how a reader's own picks survive it. */
  keep: number[];
}

/**
 * Solve a whole strategy: the best fifteen over the horizon, and then the plan
 * that carries it through. One request rather than two, because the plan starts
 * from the squad the optimiser found and a round trip between them would post
 * the pool twice and leave the page holding two answers that might disagree.
 */
export interface StrategyRequest extends PoolEnvelope {
  kind: 'strategy';
  budget: number;
  horizon: number;
  startGameweek: number;
  /** In tenths, the way the code carries it. */
  riskAversion: number;
  freeTransfers: number;
  chips: Chip[];
  keep: number[];
  seed: number;
}

export type Request = PlanRequest | AutoRequest | OptimiseRequest | StrategyRequest;

export interface Reply {
  id: number;
  ok: boolean;
  error?: string;
  elapsed: number;
  plan?: Plan;
  squad?: { picks: number[]; bank: number };
  optimisation?: OptimisedSquad;
  strategy?: SolvedStrategy;
}

/** What the optimiser reports back, flattened for the structured clone. */
export interface OptimisedSquad {
  picks: number[];
  bank: number;
  points: number;
  baseline: number;
  perGameweek: number[];
  evaluated: number;
  improvements: number;
  rounds: number;
  converged: boolean;
  candidates: Record<string, number>;
}

/** A strategy solved end to end: the squad, the plan, and the spread around it. */
export interface SolvedStrategy {
  optimisation: OptimisedSquad;
  plan: Plan;
  /**
   * Standard deviation of the horizon total, added in quadrature across the
   * gameweeks, because two gameweeks are two independent draws. It is what puts
   * a band on the landing point rather than a single line nobody should trust.
   */
  spread: number;
  /** Per gameweek: the spread of that week alone. */
  spreads: number[];
  /** The fingerprint of the pool this was actually solved against. */
  fingerprint: string;
}

export interface Envelope {
  id: number;
  request: Request;
}

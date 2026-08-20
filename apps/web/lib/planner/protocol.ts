import type { Chip, Plan, PlannerPlayer } from '@fpl/planner';

/**
 * The contract between the planner's interface and its worker.
 *
 * A beam search over four weeks of transfers is tens of thousands of squad
 * evaluations, and every one of them runs `bestStartingEleven` over every legal
 * formation. That is fast, but it is not sixteen milliseconds fast, so it
 * happens off the main thread and the interface stays responsive while the
 * reader drags the horizon slider.
 */

export interface PlanRequest {
  kind: 'plan';
  /** The pool, sent once and cached in the worker by generation. */
  poolGeneration: number;
  players?: PlannerPlayer[];
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

export interface AutoRequest {
  kind: 'auto';
  poolGeneration: number;
  players?: PlannerPlayer[];
  budget: number;
  /** Gameweeks the opening squad is chosen to be good over. */
  horizon: number;
}

export interface OptimiseRequest {
  kind: 'optimise';
  poolGeneration: number;
  players?: PlannerPlayer[];
  budget: number;
  /** Gameweeks the squad is chosen to be best over. */
  horizon: number;
  riskAversion: number;
  /** Codes the search must keep, which is how a reader's own picks survive it. */
  keep: number[];
}

export type Request = PlanRequest | AutoRequest | OptimiseRequest;

export interface Reply {
  id: number;
  ok: boolean;
  error?: string;
  elapsed: number;
  plan?: Plan;
  squad?: { picks: number[]; bank: number };
  optimisation?: OptimisedSquad;
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

export interface Envelope {
  id: number;
  request: Request;
}

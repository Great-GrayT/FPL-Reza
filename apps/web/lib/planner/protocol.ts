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

export type Request = PlanRequest | AutoRequest;

export interface Reply {
  id: number;
  ok: boolean;
  error?: string;
  elapsed: number;
  plan?: Plan;
  squad?: { picks: number[]; bank: number };
}

export interface Envelope {
  id: number;
  request: Request;
}

import type { Ban, Chip, Lock, Plan } from '@fpl/planner';
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
  /** In tenths, the way the code carries it. Ignored when the objective is sharpe. */
  riskAversion: number;
  /**
   * `sharpe` asks the search to find the appetite instead of taking one: it
   * solves the tangency portfolio and uses that point's own risk aversion.
   */
  objective?: 'mean' | 'sharpe';
  freeTransfers: number;
  maxTransfersPerWeek?: number;
  chips: Chip[];
  /**
   * Players fixed in the squad, and for how long. Both modes hold a player in
   * the opening fifteen; `always` also stops the plan ever selling him.
   */
  locks: Lock[];
  /** Players the search may not pick: the mirror of a lock. */
  bans: Ban[];
  seed: number;
}

/**
 * Score one line-up on the same axes the frontier is drawn on, so a reader can
 * put their own squad beside the optimiser's and see the trade rather than
 * argue about it.
 *
 * `optimise` is the difference between two questions. Off, the fifteen are held
 * exactly as given for the whole horizon, which answers "what is my team
 * worth". On, they are the squad the plan starts from and it may transfer over
 * the horizon, which answers "what is my team worth if I manage it".
 */
export interface CompareRequest extends PoolEnvelope {
  kind: 'compare';
  squad: number[];
  budget: number;
  horizon: number;
  startGameweek: number;
  riskAversion: number;
  freeTransfers: number;
  maxTransfersPerWeek: number;
  chips: Chip[];
  optimise: boolean;
}

export interface ComparedLineup {
  /** The fifteen actually scored, which differs from the input when optimised. */
  picks: number[];
  /** Sum of the fifteen's projections over the horizon: the frontier's y axis. */
  expected: number;
  /** Portfolio standard deviation of those fifteen: the frontier's x axis. */
  risk: number;
  cost: number;
  /** What the plan makes of it, which is a different number and says so. */
  planTotal: number;
  planSpread: number;
  transfers: number;
  hits: number;
  fingerprint: string;
}

/**
 * The space of strategies, not the curve through the best of them.
 *
 * Nine risk appetites produce nine dots and a line that looks like a law. What
 * a reader needs is the cloud: how thin the frontier actually is, how many
 * squads sit within a point of it, and where their own lands among them. So the
 * anchors are perturbed one swap at a time, the dominated are dropped, and what
 * survives is drawn.
 */
export interface SpaceRequest extends PoolEnvelope {
  kind: 'space';
  budget: number;
  horizon: number;
  maxPerClub?: number;
  /** Codes every strategy must hold, which is what a lock means here. */
  keep: number[];
  /** Codes no strategy may hold. */
  ban: number[];
  /** Chips whose effect is priced into each dot. */
  chips: Chip[];
  limit?: number;
  seed: number;
}

export interface StrategyDot {
  id: number;
  picks: number[];
  /** Sum of the fifteen's projections over the horizon, plus any chip gain. */
  expected: number;
  /** Portfolio standard deviation, including the club correlation term. */
  risk: number;
  cost: number;
  /** Return per unit of risk, measured from the steadiest legal fifteen. */
  sharpe: number;
  chipGain: number;
  chipWeeks: { chip: Chip; gameweek: number; gain: number }[];
}

export interface StrategySpace {
  dots: StrategyDot[];
  /** The steadiest legal fifteen: this page's stand-in for a riskless asset. */
  riskFree: { expected: number; risk: number };
  /** Best return per unit of risk, where the capital market line touches. */
  tangency: { expected: number; risk: number; sharpe: number; picks: number[] } | null;
  /** Squads generated before the dominated ones were dropped. */
  generated: number;
  clubCorrelation: number;
}

export type Request =
  PlanRequest | AutoRequest | OptimiseRequest | StrategyRequest | CompareRequest | SpaceRequest;

export interface Reply {
  id: number;
  ok: boolean;
  error?: string;
  elapsed: number;
  plan?: Plan;
  squad?: { picks: number[]; bank: number };
  optimisation?: OptimisedSquad;
  strategy?: SolvedStrategy;
  compared?: ComparedLineup;
  space?: StrategySpace;
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
  /**
   * Per gameweek, the best moves available at the start of it with nothing in
   * the way: no transfer budget, no hit, no regard for what the plan does next.
   * It is what the plan passed up, printed beside what the plan did, because a
   * reader who disagrees with a plan wants to see the move it declined.
   */
  freeHand: FreeHandWeek[];
  /** Null where the frontier could not be solved under these constraints. */
  portfolio: PortfolioView | null;
  /** The appetite actually used, in tenths, and where it came from. */
  riskUsed: { tenths: number; chosen: boolean; sharpe: number | null };
}

/**
 * The squad as a portfolio, over the horizon the strategy names.
 *
 * A plan reports one number, its expected total, and a band around it. That
 * band is a consequence of the fifteen it holds, and the frontier is what says
 * whether the trade was a good one: how much expected return a squad gives up
 * to reduce its week to week variance, and where this squad sits against the
 * best trade available at its own level of risk.
 */
export interface FrontierPoint {
  expected: number;
  risk: number;
  /** Risk aversion this point was optimal at. */
  lambda: number;
  /** Cost in tenths, so a reader can see what the frontier is spending. */
  cost: number;
}

export interface PortfolioView {
  frontier: FrontierPoint[];
  /** Where the plan's own squad sits: its expected total and its spread. */
  held: { expected: number; risk: number; cost: number };
  /** Per player share of the squad's variance, largest first. */
  contributions: { name: string; club: string; share: number }[];
  /** How correlated two players at one club are assumed to be. */
  clubCorrelation: number;
}

export interface FreeHandWeek {
  gameweek: number;
  swaps: { out: number; in: number; gain: number; cost: number }[];
}

export interface Envelope {
  id: number;
  request: Request;
}

/// <reference lib="webworker" />
/**
 * The planner's engine.
 *
 * The search evaluates tens of thousands of squads and each one solves its own
 * best eleven over every legal formation, so it runs here rather than on the
 * main thread. The pool is sent once and kept by generation, because a hundred
 * megabytes of projections re-posted on every slider drag would cost more than
 * the search does.
 */
import {
  openingSquad,
  optimiseSquad,
  plan,
  poolFingerprint,
  type PlannerPlayer,
  type Squad,
} from '@fpl/planner';
import { expandPool } from './projections';
import type { Envelope, Reply, Request } from './protocol';

let pool: PlannerPlayer[] = [];
let generation = -1;

function cachePool(request: Request): void {
  if (request.players === undefined || request.poolGeneration === generation) return;
  // The wire shape carries a scalar spread and rise per player; the planner
  // wants one of each per gameweek. Expanding here rather than on the page is
  // what keeps 45,000 repeated numbers out of the payload.
  const gameweeks =
    request.gameweeks ?? request.players[0]?.projections.map((_, index) => index) ?? [];
  pool = expandPool({
    players: request.players,
    gameweeks,
    calendar: [],
    matches: request.matches ?? {},
  });
  generation = request.poolGeneration;
}

function squadFrom(request: Extract<Request, { kind: 'plan' }>): Squad {
  const byCode = new Map(pool.map((player) => [player.code, player]));
  const purchase = new Map<number, number>(request.purchasePrices ?? []);
  for (const code of request.squad) {
    if (!purchase.has(code)) purchase.set(code, byCode.get(code)?.price ?? 0);
  }
  return {
    picks: [...request.squad],
    purchasePrices: purchase,
    bank: request.bank,
    freeTransfers: request.freeTransfers,
    chipsUsed: [],
  };
}

/**
 * The spread around a week's eleven.
 *
 * Only the starters score, and the captain scores twice, so the captain's own
 * variance enters twice as well. The eleven are treated as independent draws,
 * which understates the truth (two players at one club share a clean sheet) and
 * says so wherever the band is printed.
 */
function weekSpread(picks: readonly number[], week: number, captain: number | null): number {
  const byCode = new Map(pool.map((player) => [player.code, player]));
  let variance = 0;
  for (const code of picks) {
    const spread = byCode.get(code)?.spreads?.[week] ?? 0;
    const weight = code === captain ? 2 : 1;
    variance += (spread * weight) ** 2;
  }
  return Math.sqrt(variance);
}

function handle(request: Request): Omit<Reply, 'id' | 'elapsed'> {
  cachePool(request);
  if (pool.length === 0) return { ok: false, error: 'the pool has not been loaded' };

  if (request.kind === 'auto') {
    const squad = openingSquad(pool, { budget: request.budget, horizon: request.horizon });
    return { ok: true, squad: { picks: squad.picks, bank: squad.bank } };
  }

  if (request.kind === 'optimise') {
    const found = optimiseSquad(pool, {
      budget: request.budget,
      horizon: request.horizon,
      riskAversion: request.riskAversion,
      keep: request.keep,
    });
    if (found === null) {
      return { ok: false, error: 'no legal squad fits that budget with those players kept' };
    }
    return { ok: true, optimisation: toWire(found) };
  }

  if (request.kind === 'strategy') {
    const riskAversion = request.riskAversion / 10;
    const found = optimiseSquad(pool, {
      budget: request.budget,
      horizon: request.horizon,
      riskAversion,
      keep: request.keep,
      seed: request.seed,
      freeTransfers: request.freeTransfers,
    });
    if (found === null) {
      return { ok: false, error: 'no legal squad fits that budget with those players kept' };
    }

    const solved = plan(pool, found.squad, {
      horizon: request.horizon,
      startGameweek: request.startGameweek,
      riskAversion,
      chips: request.chips,
    });

    const spreads = solved.weeks.map(
      (week, index) => Math.round(weekSpread(week.starters, index, week.captain) * 100) / 100,
    );
    const spread = Math.sqrt(spreads.reduce((total, value) => total + value * value, 0));

    return {
      ok: true,
      strategy: {
        optimisation: toWire(found),
        plan: solved,
        spread: Math.round(spread * 100) / 100,
        spreads,
        fingerprint: poolFingerprint(pool),
      },
    };
  }

  const result = plan(pool, squadFrom(request), {
    horizon: request.horizon,
    startGameweek: request.startGameweek,
    riskAversion: request.riskAversion,
    chips: request.chips,
    maxTransfersPerWeek: request.maxTransfersPerWeek,
    beamWidth: request.beamWidth,
  });
  return { ok: true, plan: result };
}

/** The optimiser's answer, flattened for the structured clone. */
function toWire(
  found: NonNullable<ReturnType<typeof optimiseSquad>>,
): NonNullable<Reply['optimisation']> {
  return {
    picks: found.squad.picks,
    bank: found.squad.bank,
    points: found.points,
    baseline: found.baseline,
    perGameweek: found.perGameweek,
    evaluated: found.evaluated,
    improvements: found.improvements,
    rounds: found.rounds,
    converged: found.converged,
    candidates: found.candidates,
  };
}

self.addEventListener('message', (event: MessageEvent<Envelope>) => {
  const started = performance.now();
  const { id, request } = event.data;
  try {
    const reply = handle(request);
    (self as unknown as Worker).postMessage({
      id,
      elapsed: performance.now() - started,
      ...reply,
    } satisfies Reply);
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      elapsed: performance.now() - started,
      error: error instanceof Error ? error.message : 'the planner failed without a message',
    } satisfies Reply);
  }
});

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
import { openingSquad, plan, type PlannerPlayer, type Squad } from '@fpl/planner';
import type { Envelope, Reply, Request } from './protocol';

let pool: PlannerPlayer[] = [];
let generation = -1;

function cachePool(request: Request): void {
  if (request.players !== undefined && request.poolGeneration !== generation) {
    pool = request.players;
    generation = request.poolGeneration;
  }
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

function handle(request: Request): Omit<Reply, 'id' | 'elapsed'> {
  cachePool(request);
  if (pool.length === 0) return { ok: false, error: 'the pool has not been loaded' };

  if (request.kind === 'auto') {
    const squad = openingSquad(pool, { budget: request.budget, horizon: request.horizon });
    return { ok: true, squad: { picks: squad.picks, bank: squad.bank } };
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

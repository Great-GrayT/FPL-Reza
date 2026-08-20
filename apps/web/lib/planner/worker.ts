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
  bestSwaps,
  openingSquad,
  optimiseSquad,
  plan,
  poolFingerprint,
  type PlannerPlayer,
  type Squad,
} from '@fpl/planner';
import {
  efficientFrontier,
  portfolioVariance,
  riskContributions,
  type Candidate,
} from '@fpl/quant';
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
      // Both modes hold a player in the opening fifteen; the difference is
      // whether the plan may later sell him.
      keep: request.locks.map((lock) => lock.code),
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
      ...(request.maxTransfersPerWeek === undefined
        ? {}
        : { maxTransfersPerWeek: request.maxTransfersPerWeek }),
      locked: request.locks.filter((lock) => lock.mode === 'always').map((lock) => lock.code),
    });

    const spreads = solved.weeks.map(
      (week, index) => Math.round(weekSpread(week.starters, index, week.captain) * 100) / 100,
    );
    const spread = Math.sqrt(spreads.reduce((total, value) => total + value * value, 0));

    // What each week could have done, from the squad it opened with. The
    // squad before a week's moves is the previous week's squad, which is why
    // this walks the plan rather than reading each week's own picks: those are
    // the squad after the move, and asking what else it could have done from
    // there would be answering a different week.
    let held: Squad = found.squad;
    const freeHand = solved.weeks.map((week, index) => {
      const swaps = bestSwaps(pool, held, index, {
        horizon: solved.weeks.length - index,
        riskAversion,
        limit: 3,
      });
      held = {
        ...held,
        picks: week.picks,
        bank: week.bank,
        // Prices are carried at today's, so a purchase price is the price. The
        // plan's own price model moves nothing today, and where it does this
        // understates receipts rather than inventing them.
        purchasePrices: new Map(
          week.picks.map((code) => [
            code,
            held.purchasePrices.get(code) ??
              pool.find((player) => player.code === code)?.price ??
              0,
          ]),
        ),
      };
      return {
        gameweek: week.gameweek,
        swaps: swaps.map((swap) => ({ ...swap, gain: Math.round(swap.gain * 10) / 10 })),
      };
    });

    const portfolio = frontierFor(pool, found.squad.picks, solved.weeks.length, request.budget);

    return {
      ok: true,
      strategy: {
        optimisation: toWire(found),
        plan: solved,
        spread: Math.round(spread * 100) / 100,
        spreads,
        fingerprint: poolFingerprint(pool),
        freeHand,
        portfolio,
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

/** Two players at one club share a clean sheet, so they are not independent. */
const CLUB_CORRELATION = 0.35;

/**
 * The frontier of legal squads over the horizon, and where this one sits on it.
 *
 * The candidates are the same pool the search used, summed over the horizon:
 * expected points, and a standard deviation that grows with the root of the
 * matches rather than with the matches, since two gameweeks are two draws. The
 * frontier is solved by `@fpl/quant`, which knows nothing about football and is
 * the same code the Lab's portfolio panel runs on, so the two cannot disagree.
 */
function frontierFor(
  players: readonly PlannerPlayer[],
  picks: readonly number[],
  weeks: number,
  budget: number,
): NonNullable<Reply['strategy']>['portfolio'] {
  const sumOver = (values: readonly number[] | undefined): number => {
    let total = 0;
    for (let index = 0; index < weeks; index += 1) total += values?.[index] ?? 0;
    return total;
  };

  const candidates: Candidate[] = players.map((player) => ({
    id: player.code,
    name: player.name,
    group: player.position,
    club: String(player.teamCode),
    cost: player.price,
    expected: sumOver(player.projections),
    // Independent weeks add in quadrature, which is the same assumption the
    // band on the total is drawn with, stated in both places.
    risk: Math.sqrt(
      Array.from({ length: weeks }, (_, index) => (player.spreads?.[index] ?? 0) ** 2).reduce(
        (total, value) => total + value,
        0,
      ),
    ),
  }));

  const frontier = efficientFrontier(
    candidates,
    { budget, quota: { GKP: 2, DEF: 5, MID: 5, FWD: 3 }, maxPerClub: 3 },
    { clubCorrelation: CLUB_CORRELATION },
  );

  const held = candidates.filter((candidate) => picks.includes(candidate.id));
  if (held.length === 0) return null;

  const expected = held.reduce((total, player) => total + player.expected, 0);
  const risk = Math.sqrt(portfolioVariance(held, CLUB_CORRELATION));

  return {
    frontier: frontier.map((point) => ({
      expected: Math.round(point.expected * 10) / 10,
      risk: Math.round(point.risk * 100) / 100,
      lambda: point.lambda,
      cost: point.cost,
    })),
    held: {
      expected: Math.round(expected * 10) / 10,
      risk: Math.round(risk * 100) / 100,
      cost: held.reduce((total, player) => total + player.cost, 0),
    },
    contributions: riskContributions(held, CLUB_CORRELATION)
      .slice(0, 6)
      .map((entry) => ({
        name: entry.name,
        club: entry.club,
        share: Math.round(entry.share * 1000) / 1000,
      })),
    clubCorrelation: CLUB_CORRELATION,
  };
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

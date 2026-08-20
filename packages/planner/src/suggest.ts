import type { Position } from '@fpl/core';
import { sellingPrice } from '@fpl/core';
import { isLegal } from './plan.js';
import { DEFAULT_RULES, type PlanRules, type PlannerPlayer, type Squad } from './types.js';

/**
 * The move a week would take if nothing stopped you.
 *
 * A plan is a path: what it does in gameweek 6 depends on the squad it arrived
 * with, the transfers it banked, and whether it is willing to take a hit. That
 * is the right answer to "what should I do", and it is the wrong answer to
 * "what is the best move available here", which is the question a reader asks
 * when they disagree with the plan and want to know what it passed up.
 *
 * So both are computed and both are shown. This one is deliberately
 * unconstrained: no transfer budget, no hit, no banked free transfers, and no
 * regard for what the plan does next. What it does respect is what the game
 * would refuse outright: the money in the bank, the selling price rule, the
 * quota, and three from a club. An impossible suggestion is not a suggestion.
 *
 * The gain is measured over the rest of the horizon rather than over the week
 * alone, because a transfer bought for one gameweek is a transfer you still own
 * in the next five, and ranking on the week would recommend chasing a single
 * fixture every time.
 */

export interface Swap {
  out: number;
  in: number;
  /** Projected points gained over the remaining gameweeks, after the swap. */
  gain: number;
  /** What it costs from the bank, negative where it frees money up. */
  cost: number;
}

export interface SwapOptions {
  /** Gameweeks left, counted from `week` inclusive. */
  horizon: number;
  riskAversion?: number;
  rules?: Partial<PlanRules>;
  /** How many to return, best first. */
  limit?: number;
}

const valueOver = (
  player: PlannerPlayer,
  week: number,
  horizon: number,
  riskAversion: number,
): number => {
  let total = 0;
  for (let index = week; index < week + horizon; index += 1) {
    const points = player.projections[index] ?? 0;
    const spread = player.spreads?.[index] ?? 0;
    total += points - riskAversion * spread;
  }
  return total;
};

/**
 * The best legal single transfers out of a squad in one gameweek, best first.
 *
 * Returns fewer than `limit` where fewer are legal, and an empty list where the
 * squad cannot be improved at all, which is a real answer rather than a
 * failure: a reader told "nothing here beats what you hold" has learned
 * something the plan's silence does not tell them.
 */
export function bestSwaps(
  players: readonly PlannerPlayer[],
  squad: Squad,
  week: number,
  options: SwapOptions,
): Swap[] {
  const rules: PlanRules = { ...DEFAULT_RULES, ...options.rules };
  const riskAversion = options.riskAversion ?? 0;
  const limit = options.limit ?? 3;
  const horizon = Math.max(1, options.horizon);

  const index = new Map(players.map((player) => [player.code, player]));
  const held = new Set(squad.picks);

  const byPosition = new Map<Position, PlannerPlayer[]>();
  for (const player of players) {
    if (held.has(player.code) || player.available === false) continue;
    const list = byPosition.get(player.position) ?? [];
    list.push(player);
    byPosition.set(player.position, list);
  }

  const swaps: Swap[] = [];
  for (const outCode of squad.picks) {
    const outPlayer = index.get(outCode);
    if (outPlayer === undefined) continue;
    const outValue = valueOver(outPlayer, week, horizon, riskAversion);
    // A sale returns the purchase price plus half of any rise, which is the
    // rule that decides what a swap can actually afford.
    const receipts = sellingPrice(
      squad.purchasePrices.get(outCode) ?? outPlayer.price,
      outPlayer.price,
    );
    const purse = squad.bank + receipts;

    for (const candidate of byPosition.get(outPlayer.position) ?? []) {
      if (candidate.price > purse) continue;
      const gain = valueOver(candidate, week, horizon, riskAversion) - outValue;
      if (gain <= 0) continue;

      const picks = squad.picks.map((code) => (code === outCode ? candidate.code : code));
      if (!isLegal(picks, purse - candidate.price, index, rules)) continue;
      swaps.push({ out: outCode, in: candidate.code, gain, cost: candidate.price - receipts });
    }
  }

  swaps.sort((a, b) => b.gain - a.gain);

  // One suggestion per player leaving: five variations on selling the same
  // defender is one idea printed five times, and the reader wants the next
  // idea.
  const seen = new Set<number>();
  const best: Swap[] = [];
  for (const swap of swaps) {
    if (seen.has(swap.out)) continue;
    seen.add(swap.out);
    best.push(swap);
    if (best.length >= limit) break;
  }
  return best;
}

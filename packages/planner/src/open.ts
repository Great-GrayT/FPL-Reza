import { autoPick, type SquadPlayer } from '@fpl/analytics';
import { asPlayerId, asTeamId } from '@fpl/core';
import { DEFAULT_RULES, type PlanRules, type PlannerPlayer, type Squad } from './types.js';

/**
 * The fifteen a plan starts from, where the reader has not brought their own.
 *
 * A plan is only as good as what it starts with, and the obvious opening squad
 * (the best fifteen by projection) is illegal on budget before it has eleven
 * names in it. `autoPick` already solves that: it reserves the four bench slots
 * at the cheapest legal prices and spends the rest by projected points per
 * million, which is what stops an even spend across fifteen slots buying a weak
 * eleven. This wraps it in the planner's own vocabulary, over the horizon's
 * projections rather than a single gameweek's.
 */

export interface OpeningOptions {
  /** Total to spend, in tenths. FPL's own is 1000. */
  budget?: number;
  /** Gameweeks the opening squad should be good over, from index 0. */
  horizon?: number;
  rules?: Partial<PlanRules>;
  freeTransfers?: number;
  /** Codes that must be in the squad, whatever the ranking says. */
  keep?: readonly number[];
}

const toSquadPlayer = (player: PlannerPlayer): SquadPlayer => ({
  id: asPlayerId(player.code),
  teamId: asTeamId(player.teamCode),
  position: player.position,
  price: player.price,
  webName: player.name,
});

/** Mean projection over the horizon, which is what an opening squad is judged on. */
function meanOver(player: PlannerPlayer, horizon: number): number {
  const weeks = player.projections.slice(0, horizon);
  if (weeks.length === 0) return 0;
  return weeks.reduce((total, value) => total + value, 0) / weeks.length;
}

export function openingSquad(
  players: readonly PlannerPlayer[],
  options: OpeningOptions = {},
): Squad {
  const rules: PlanRules = { ...DEFAULT_RULES, ...options.rules };
  const budget = options.budget ?? 1000;
  const horizon = options.horizon ?? 6;

  // An unavailable player is excluded here rather than penalised, because a
  // squad that opens with an injured name has spent money on nothing. One the
  // reader asked to keep stays whatever his news says: it is their squad.
  const keep = new Set(options.keep ?? []);
  const pool = players.filter((player) => player.available !== false || keep.has(player.code));
  const byCode = new Map(pool.map((player) => [player.code, player]));
  const value = new Map(pool.map((player) => [player.code, meanOver(player, horizon)]));

  const picks = autoPick(pool.map(toSquadPlayer), (player) => value.get(Number(player.id)) ?? 0, {
    budget,
    keep: (options.keep ?? []).map((code) => asPlayerId(code)),
  });

  const codes = spendUp(
    picks.map((id) => Number(id)),
    pool,
    byCode,
    value,
    budget,
    rules,
    keep,
  );
  const spent = codes.reduce((total, code) => total + (byCode.get(code)?.price ?? 0), 0);

  return {
    picks: codes,
    purchasePrices: new Map(
      codes.map((code) => [code, byCode.get(code)?.price ?? 0] as [number, number]),
    ),
    bank: budget - spent,
    freeTransfers: Math.min(options.freeTransfers ?? 1, rules.maxFreeTransfers),
    chipsUsed: [],
  };
}

/**
 * Spend what is left over.
 *
 * `autoPick` ranks by projected points per million, which is the right measure
 * for choosing between players and the wrong one for finishing a squad: it
 * stops while money is still in the bank, because a cheaper player always looks
 * better per million. Twenty million idle is a worse squad than any upgrade it
 * could buy, so this walks the picks and takes the best affordable swap it can
 * find, repeatedly, until nothing improves.
 *
 * Each candidate swap is checked against the same legality rules the plan is,
 * so spending the bank can never buy a fourth player from one club.
 */
function spendUp(
  picks: readonly number[],
  pool: readonly PlannerPlayer[],
  byCode: Map<number, PlannerPlayer>,
  value: Map<number, number>,
  budget: number,
  rules: PlanRules,
  keep: ReadonlySet<number>,
): number[] {
  const squad = [...picks];
  const held = new Set(squad);

  const priceOf = (code: number): number => byCode.get(code)?.price ?? 0;
  const valueOf = (code: number): number => value.get(code) ?? 0;
  const spend = (): number => squad.reduce((total, code) => total + priceOf(code), 0);

  const clubCounts = (): Map<number, number> => {
    const counts = new Map<number, number>();
    for (const code of squad) {
      const club = byCode.get(code)?.teamCode ?? 0;
      counts.set(club, (counts.get(club) ?? 0) + 1);
    }
    return counts;
  };

  // At most one pass per squad slot: each swap can only enable so many more,
  // and an unbounded loop over six hundred candidates is not worth the wait.
  for (let round = 0; round < rules.squadSize; round += 1) {
    let best: { out: number; in: number; gain: number } | null = null;
    const bank = budget - spend();
    const counts = clubCounts();

    for (const outCode of squad) {
      if (keep.has(outCode)) continue;
      const outPlayer = byCode.get(outCode);
      if (outPlayer === undefined) continue;
      const affordable = bank + outPlayer.price;

      for (const candidate of pool) {
        if (held.has(candidate.code)) continue;
        if (candidate.position !== outPlayer.position) continue;
        if (candidate.price > affordable) continue;

        const clubAfter =
          (counts.get(candidate.teamCode) ?? 0) -
          (candidate.teamCode === outPlayer.teamCode ? 1 : 0);
        if (clubAfter >= rules.maxPerClub) continue;

        const gain = valueOf(candidate.code) - valueOf(outCode);
        if (gain <= 0) continue;
        if (best === null || gain > best.gain) {
          best = { out: outCode, in: candidate.code, gain };
        }
      }
    }

    if (best === null) break;
    const index = squad.indexOf(best.out);
    squad[index] = best.in;
    held.delete(best.out);
    held.add(best.in);
  }

  return squad;
}

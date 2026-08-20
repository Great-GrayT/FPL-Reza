import { bestStartingEleven, type SquadPlayer } from '@fpl/analytics';
import { asPlayerId, asTeamId, sellingPrice, type PlayerId, type Position } from '@fpl/core';
import {
  DEFAULT_RULES,
  type Chip,
  type Plan,
  type PlanOptions,
  type PlanRules,
  type PlannerPlayer,
  type Squad,
  type WeekPlan,
} from './types.js';

/**
 * The planner.
 *
 * A single gameweek is a selection problem and a season is a sequence of them,
 * which is why this is a search rather than a formula: the best move this week
 * depends on the move it makes possible in three weeks, and a greedy pick
 * cannot bank a transfer for a double gameweek because it never looks that far.
 *
 * Every state the search visits is legal by construction. The budget, the
 * 2/5/5/3 quota, three from a club and fifteen players are checked when a state
 * is built, not filtered afterwards, so an illegal squad is never scored and
 * therefore can never be suggested.
 */

interface State {
  squad: Squad;
  weeks: WeekPlan[];
  /** Points banked so far, after hits, discounted to the first gameweek. */
  score: number;
  /** Undiscounted points, which is what the plan reports. */
  raw: number;
}

const POSITIONS: Position[] = ['GKP', 'DEF', 'MID', 'FWD'];

/**
 * The least a transfer has to gain before the plan will make it.
 *
 * Half a point over the horizon. Below that the search churns: it sells a
 * player in one gameweek and buys him back in the next to chase a tenth of a
 * point of fixture difference, which produces a plan nobody would enter and
 * which in the real game loses money, since a sale returns only half of any
 * rise. Stated, not fitted.
 */
export const DEFAULT_MIN_TRANSFER_GAIN = 0.5;

/** The value the objective puts on a player in one gameweek. */
function valueOf(player: PlannerPlayer, week: number, riskAversion: number): number {
  const mean = player.projections[week] ?? 0;
  if (riskAversion === 0) return mean;
  const spread = player.spreads?.[week] ?? 0;
  return mean - riskAversion * spread;
}

/** The squad shape the analytics package expects, built from a planner player. */
function toSquadPlayer(player: PlannerPlayer): SquadPlayer {
  return {
    id: asPlayerId(player.code),
    teamId: asTeamId(player.teamCode),
    position: player.position,
    price: player.price,
    webName: player.name,
  };
}

function countBy(
  picks: readonly number[],
  index: Map<number, PlannerPlayer>,
): {
  positions: Record<Position, number>;
  clubs: Map<number, number>;
} {
  const positions: Record<Position, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  const clubs = new Map<number, number>();
  for (const code of picks) {
    const player = index.get(code);
    if (player === undefined) continue;
    positions[player.position] += 1;
    clubs.set(player.teamCode, (clubs.get(player.teamCode) ?? 0) + 1);
  }
  return { positions, clubs };
}

/** Whether a squad satisfies every rule the game enforces. */
export function isLegal(
  picks: readonly number[],
  bank: number,
  index: Map<number, PlannerPlayer>,
  rules: PlanRules,
): boolean {
  if (picks.length !== rules.squadSize) return false;
  if (bank < 0) return false;
  if (new Set(picks).size !== picks.length) return false;

  const { positions, clubs } = countBy(picks, index);
  for (const position of POSITIONS) {
    if (positions[position] !== rules.quota[position]) return false;
  }
  for (const count of clubs.values()) {
    if (count > rules.maxPerClub) return false;
  }
  return true;
}

interface WeekValue {
  starters: number[];
  bench: number[];
  captain: number | null;
  viceCaptain: number | null;
  points: number;
}

/**
 * The best eleven from a squad in one gameweek, and what it is worth.
 *
 * The captain is the highest projected starter, doubled, or trebled under the
 * chip. A bench boost pays the whole fifteen, which is the only case where a
 * bench player's projection enters the objective at all.
 */
function valueWeek(
  picks: readonly number[],
  week: number,
  index: Map<number, PlannerPlayer>,
  rules: PlanRules,
  riskAversion: number,
  chip: Chip | null,
): WeekValue {
  const players = picks.flatMap((code) => {
    const player = index.get(code);
    return player === undefined ? [] : [player];
  });
  const squadPlayers = players.map(toSquadPlayer);
  const valueByCode = new Map(
    players.map((player) => [player.code, valueOf(player, week, riskAversion)]),
  );

  const eleven = bestStartingEleven(
    squadPlayers.map((player) => player.id),
    squadPlayers,
    (player: SquadPlayer) => valueByCode.get(Number(player.id)) ?? 0,
  );

  const starters = eleven.starters.map((id) => Number(id));
  const bench = eleven.bench.map((id) => Number(id));
  const captain = eleven.captain === null ? null : Number(eleven.captain);

  let points = starters.reduce((total, code) => total + (valueByCode.get(code) ?? 0), 0);
  if (chip === 'bench_boost') {
    points += bench.reduce((total, code) => total + (valueByCode.get(code) ?? 0), 0);
  }
  if (captain !== null) {
    const multiplier =
      chip === 'triple_captain' ? rules.tripleCaptainMultiplier : rules.captainMultiplier;
    points += (valueByCode.get(captain) ?? 0) * (multiplier - 1);
  }

  return {
    starters,
    bench,
    captain,
    viceCaptain: eleven.viceCaptain === null ? null : Number(eleven.viceCaptain),
    points,
  };
}

interface Move {
  out: number[];
  in: number[];
  chip: Chip | null;
}

/**
 * Candidate moves for one gameweek.
 *
 * The space of two transfers from fifteen players into six hundred candidates
 * is millions of pairs, so it is not enumerated: each held player is paired with
 * the best few replacements of his own position that the squad can afford, and
 * the pairs are formed from the best of those single moves. That is a heuristic,
 * and it is the one place in the planner that is: the alternative is a search
 * nobody can run inside a page load.
 */
function movesFor(
  squad: Squad,
  week: number,
  index: Map<number, PlannerPlayer>,
  byPosition: Map<Position, PlannerPlayer[]>,
  rules: PlanRules,
  options: Required<
    Pick<
      PlanOptions,
      'maxTransfersPerWeek' | 'candidatesPerWeek' | 'riskAversion' | 'minTransferGain'
    >
  >,
  chipsAvailable: readonly Chip[],
): Move[] {
  const moves: Move[] = [{ out: [], in: [], chip: null }];

  // A chip that changes nothing about the squad is its own move: playing it is
  // a decision about this week, not about who is in the team.
  for (const chip of chipsAvailable) {
    if (chip === 'bench_boost' || chip === 'triple_captain') moves.push({ out: [], in: [], chip });
  }

  const singles: { out: number; in: number; gain: number; cost: number }[] = [];
  for (const outCode of squad.picks) {
    const outPlayer = index.get(outCode);
    if (outPlayer === undefined) continue;
    const outValue = valueOf(outPlayer, week, options.riskAversion);
    const receipts = sellingPrice(
      squad.purchasePrices.get(outCode) ?? outPlayer.price,
      outPlayer.price,
    );

    const candidates = (byPosition.get(outPlayer.position) ?? [])
      .filter((candidate) => candidate.available !== false && !squad.picks.includes(candidate.code))
      .filter((candidate) => candidate.price <= squad.bank + receipts)
      .slice(0, options.candidatesPerWeek);

    for (const candidate of candidates) {
      const gain = valueOf(candidate, week, options.riskAversion) - outValue;
      // A gain has to be worth making, not merely positive. A free transfer
      // looks free and is not: taken for a tenth of a point it produces a plan
      // that sells a player in one gameweek and buys him back in the next,
      // which no manager would enter and which costs real money in the game,
      // where a sale returns only half of any rise. The threshold is stated
      // rather than fitted, and it is the reason a plan holds a squad it likes.
      if (gain <= options.minTransferGain) continue;
      singles.push({ out: outCode, in: candidate.code, gain, cost: candidate.price - receipts });
    }
  }

  singles.sort((a, b) => b.gain - a.gain);
  const best = singles.slice(0, options.candidatesPerWeek);
  for (const single of best) moves.push({ out: [single.out], in: [single.in], chip: null });

  if (options.maxTransfersPerWeek >= 2) {
    for (let i = 0; i < Math.min(best.length, 8); i += 1) {
      for (let j = i + 1; j < Math.min(best.length, 8); j += 1) {
        const first = best[i];
        const second = best[j];
        if (first === undefined || second === undefined) continue;
        if (first.out === second.out || first.in === second.in) continue;
        moves.push({ out: [first.out, second.out], in: [first.in, second.in], chip: null });
      }
    }
  }

  return moves;
}

function applyMove(
  squad: Squad,
  move: Move,
  index: Map<number, PlannerPlayer>,
  rules: PlanRules,
): Squad | null {
  if (move.out.length === 0) return squad;

  // A player sold earlier in this horizon cannot be bought back. It is legal in
  // the game and the model rates it: a swap each way can be worth a point a
  // week when the fixtures alternate. It is still a plan nobody enters, and it
  // is an artefact of two assumptions this planner makes, that a free transfer
  // costs nothing and that prices hold. Rather than let those assumptions
  // produce a visibly silly ledger, the search is refused the move and says so.
  const sold = new Set(squad.sold ?? []);
  for (const code of move.in) {
    if (sold.has(code)) return null;
  }

  const picks = squad.picks.filter((code) => !move.out.includes(code));
  let bank = squad.bank;
  const purchasePrices = new Map(squad.purchasePrices);

  for (const code of move.out) {
    const player = index.get(code);
    if (player === undefined) return null;
    bank += sellingPrice(purchasePrices.get(code) ?? player.price, player.price);
    purchasePrices.delete(code);
  }
  for (const code of move.in) {
    const player = index.get(code);
    if (player === undefined) return null;
    bank -= player.price;
    purchasePrices.set(code, player.price);
    picks.push(code);
  }

  if (!isLegal(picks, bank, index, rules)) return null;
  for (const code of move.out) sold.add(code);
  return { ...squad, picks, bank, purchasePrices, sold: [...sold] };
}

/** Prices move between gameweeks, so the squad a plan can afford moves with them. */
function advancePrices(index: Map<number, PlannerPlayer>, week: number): void {
  for (const player of index.values()) {
    const rise = player.riseProbabilities?.[week];
    if (rise === undefined) continue;
    // A price moves by a tenth or not at all, so the expected move is the
    // probability itself. Applying it as a fraction of a tenth is the only way
    // to carry the expectation without inventing prices the game cannot show.
    player.price += rise >= 0.5 ? 1 : 0;
  }
}

/**
 * Plan a horizon.
 *
 * The search is a beam: every state expands into its candidate moves, each
 * resulting state is scored on the week it just played plus everything before
 * it, and only the best few survive into the next week. The beam is what keeps
 * a space that is otherwise astronomical inside a page load, and the discount
 * is what stops it hoarding a transfer it never spends.
 */
export function plan(players: readonly PlannerPlayer[], start: Squad, options: PlanOptions): Plan {
  const rules: PlanRules = { ...DEFAULT_RULES, ...options.rules };
  const beamWidth = options.beamWidth ?? 12;
  const discount = options.discount ?? 0.97;
  const riskAversion = options.riskAversion ?? 0;
  const maxTransfersPerWeek = options.maxTransfersPerWeek ?? 2;
  const candidatesPerWeek = options.candidatesPerWeek ?? 12;
  const minTransferGain = options.minTransferGain ?? DEFAULT_MIN_TRANSFER_GAIN;

  const index = new Map(players.map((player) => [player.code, { ...player }]));
  const byPosition = new Map<Position, PlannerPlayer[]>();
  for (const position of POSITIONS) {
    byPosition.set(
      position,
      players
        .filter((player) => player.position === position)
        .sort((a, b) => (b.projections[0] ?? 0) - (a.projections[0] ?? 0)),
    );
  }

  const opening: State = {
    squad: { ...start, purchasePrices: new Map(start.purchasePrices) },
    weeks: [],
    score: 0,
    raw: 0,
  };
  let beam: State[] = [opening];
  /** The line that never transfers, kept outside the beam so it cannot be pruned. */
  let holding: State = opening;
  let explored = 0;

  /** Play one more gameweek of the holding line: the same fifteen, no moves. */
  const advanceHolding = (state: State, week: number): State => {
    const valued = valueWeek(state.squad.picks, week, index, rules, riskAversion, null);
    return {
      squad: state.squad,
      weeks: [
        ...state.weeks,
        {
          gameweek: options.startGameweek + week,
          picks: [...state.squad.picks],
          starters: valued.starters,
          bench: valued.bench,
          captain: valued.captain,
          viceCaptain: valued.viceCaptain,
          transfersIn: [],
          transfersOut: [],
          transfers: 0,
          hit: 0,
          chip: null,
          expectedPoints: valued.points,
          bank: state.squad.bank,
          squadValue: state.squad.picks.reduce(
            (total, code) => total + (index.get(code)?.price ?? 0),
            0,
          ),
          freeTransfers: Math.min(state.squad.freeTransfers + 1, rules.maxFreeTransfers),
        },
      ],
      score: state.score + valued.points * discount ** week,
      raw: state.raw + valued.points,
    };
  };

  for (let week = 0; week < options.horizon; week += 1) {
    const next: State[] = [];

    for (const state of beam) {
      const chipsAvailable = (options.chips ?? []).filter(
        (chip) => !state.squad.chipsUsed.includes(chip),
      );
      const moves = movesFor(
        state.squad,
        week,
        index,
        byPosition,
        rules,
        { maxTransfersPerWeek, candidatesPerWeek, riskAversion, minTransferGain },
        chipsAvailable,
      );

      for (const move of moves) {
        explored += 1;
        const squad = applyMove(state.squad, move, index, rules);
        if (squad === null) continue;

        const transfers = move.out.length;
        // A wildcard or a free hit makes every transfer free, which is the
        // whole of what they buy.
        const free =
          move.chip === 'wildcard' || move.chip === 'free_hit'
            ? transfers
            : state.squad.freeTransfers;
        const hit = Math.max(0, transfers - free) * rules.transferCost;

        const valued = valueWeek(squad.picks, week, index, rules, riskAversion, move.chip);
        const weekPoints = valued.points - hit;

        const freeTransfers = Math.min(
          rules.maxFreeTransfers,
          move.chip === 'wildcard' || move.chip === 'free_hit'
            ? state.squad.freeTransfers + 1
            : Math.max(0, state.squad.freeTransfers - transfers) + 1,
        );

        next.push({
          squad: {
            ...squad,
            freeTransfers,
            chipsUsed: move.chip === null ? squad.chipsUsed : [...squad.chipsUsed, move.chip],
          },
          weeks: [
            ...state.weeks,
            {
              gameweek: options.startGameweek + week,
              picks: [...squad.picks],
              starters: valued.starters,
              bench: valued.bench,
              captain: valued.captain,
              viceCaptain: valued.viceCaptain,
              transfersIn: [...move.in],
              transfersOut: [...move.out],
              transfers,
              hit,
              chip: move.chip,
              expectedPoints: weekPoints,
              bank: squad.bank,
              // What the fifteen are worth at this week's prices, which is the
              // half of a team's value the bank does not carry. A plan that
              // buys a rising player is worth more than its points say.
              squadValue: squad.picks.reduce(
                (total, code) => total + (index.get(code)?.price ?? 0),
                0,
              ),
              freeTransfers,
            },
          ],
          score: state.score + weekPoints * discount ** week,
          raw: state.raw + weekPoints,
        });
      }
    }

    if (next.length === 0) break;
    next.sort((a, b) => b.score - a.score);
    // Distinct squads only: a beam full of the same fifteen players reached by
    // different orders of the same two transfers explores nothing.
    const seen = new Set<string>();
    beam = [];
    for (const state of next) {
      const key = [...state.squad.picks].sort((a, b) => a - b).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(state);
      if (beam.length >= beamWidth) break;
    }

    // The state that has taken no transfer at all is carried whether or not it
    // is in the top few. Every plan claims to beat holding this fifteen, and a
    // beam that prunes the holding line cannot make that claim: a state that
    // looks worse in gameweek two because it banked a transfer is exactly the
    // state that wins in gameweek six. This is what the claim is made of.
    holding = advanceHolding(holding, week);
    if (!beam.some((state) => state.weeks.every((entry) => entry.transfers === 0))) {
      beam.push(holding);
    }

    advancePrices(index, week);
  }

  // The better of the search and doing nothing. The beam is sorted on the
  // discounted score, and what a plan reports is the undiscounted total, so the
  // comparison that matters is on the total itself.
  const searched = beam[0];
  const best = searched === undefined || holding.raw > searched.raw ? holding : searched;
  const holdTotal = holding.raw;

  return {
    weeks: best.weeks,
    total: best.raw,
    holdTotal,
    excess: best.raw - holdTotal,
    transfers: best.weeks.reduce((total, week) => total + week.transfers, 0),
    hits: best.weeks.reduce((total, week) => total + week.hit, 0),
    chipsPlayed: best.weeks.flatMap((week) => (week.chip === null ? [] : [week.chip])),
    explored,
    riskAversion,
  };
}

export { asPlayerId, type PlayerId };

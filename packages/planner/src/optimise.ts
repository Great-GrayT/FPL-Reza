import { bestElevenValue } from '@fpl/analytics';
import type { Position } from '@fpl/core';
import { openingSquad } from './open.js';
import { DEFAULT_RULES, type PlanRules, type PlannerPlayer, type Squad } from './types.js';

/**
 * The squad as an optimisation.
 *
 * The obvious way to pick fifteen players is to rank them and take the top of
 * each position until the money runs out, which is what `openingSquad` does and
 * what every ranking table implies. It is wrong, and wrong structurally rather
 * than by a little: a squad is not worth the sum of its members. Only eleven of
 * the fifteen score, one of them scores twice, and the four who do not are what
 * pay for the ones who do. The worth of adding a player therefore depends on
 * who else is in the squad, which is exactly the condition under which a greedy
 * pick has no claim on the answer.
 *
 * What it is instead is a multiple choice knapsack with a non separable
 * objective: fifteen slots under a fixed quota, a budget, and three from a
 * club, maximising the best eleven summed over a horizon. Enumerating it is not
 * something a page can offer, since fifteen from six hundred is about ten to
 * the twenty seventh squads and no amount of waiting reaches the end of that.
 * So this searches, and it searches the real objective rather than a proxy for
 * it: every squad it looks at is scored by solving its own best eleven in every
 * gameweek of the horizon, through the same formation search the page uses.
 *
 * The search is an iterated local search. From a starting squad it takes the
 * best single transfer available, then the best pair once no single one
 * improves (a pair is what lets money move between slots: an upgrade nothing
 * can afford alone becomes affordable when a downgrade elsewhere pays for it),
 * and repeats until neither improves. That is a local maximum, so it then kicks
 * the squad, a few random legal changes, and climbs again from there, keeping
 * whichever peak is higher. Every state it visits is legal by construction, and
 * it reports what it explored, so the cost of the answer is visible rather than
 * implied.
 */

export interface OptimiseOptions {
  /** Total to spend, in tenths. FPL's own is 1000. */
  budget?: number;
  /** Gameweeks to be good over, from index 0 of the projections. */
  horizon?: number;
  rules?: Partial<PlanRules>;
  /**
   * Risk appetite, the same parameter the plan takes. At 0 the objective is the
   * mean; above 0 it subtracts that many standard deviations.
   */
  riskAversion?: number;
  /**
   * Codes the search must keep. Both lock modes constrain the opening fifteen
   * identically, because this search only ever chooses an opening fifteen: the
   * modes diverge in `plan`, where an `always` lock is also unsellable.
   */
  keep?: readonly number[];
  /**
   * Kick and re-climb rounds after the first climb. Forty is where the answer
   * stopped moving on the real pool: a hundred and fifty rounds over one and a
   * half million squads found nothing better than forty found.
   */
  rounds?: number;
  /** Squads scored, at most. The knob that bounds the wait. */
  maxEvaluations?: number;
  /** Every random draw goes through this, so a result reproduces exactly. */
  seed?: number;
  /**
   * How deep behind the price and value frontier a candidate can sit and still
   * be considered. One is the frontier alone, which is too tight to satisfy the
   * club limit; four leaves room to route around it.
   */
  layers?: number;
  /** Replacements considered per slot when two slots move at once. */
  pairDepth?: number;
  /** Slots disturbed by one kick. */
  kickSize?: number;
  freeTransfers?: number;
}

export interface SquadOptimisation {
  squad: Squad;
  /** The objective's own value: expected points over the whole horizon. */
  points: number;
  /** What the greedy squad scores, which is the number this had to beat. */
  baseline: number;
  /** Points per gameweek of the horizon, index 0 first. */
  perGameweek: number[];
  /** Squads scored. */
  evaluated: number;
  /** Improving moves taken, across every round. */
  improvements: number;
  /** Rounds run: the first climb, then one per kick. */
  rounds: number;
  /** False when the evaluation budget stopped the search before it settled. */
  converged: boolean;
  /** Candidates left per position after the frontier prune. */
  candidates: Record<Position, number>;
}

const POSITIONS: Position[] = ['GKP', 'DEF', 'MID', 'FWD'];

/** A seeded generator, because a result a reader cannot reproduce is not a result. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Candidates worth considering at all.
 *
 * A player who costs no less than another of his position and projects no more
 * in any gameweek of the horizon can only enter an optimal squad to route around
 * the three per club limit, so the frontier alone is too tight and the whole
 * pool is mostly waste. This keeps a player unless `layers` others already
 * dominate him that way.
 *
 * Dominance is checked per gameweek rather than on the mean, and that is the
 * whole reason the projections are per gameweek. A player who blanks this week
 * and plays twice the next has a mean any steady player beats, and dropping him
 * on it would throw away exactly the squad a horizon is supposed to find.
 */
function prune(
  indexes: readonly number[],
  price: Int32Array,
  value: Float64Array,
  horizon: number,
  layers: number,
): number[] {
  const dominates = (better: number, worse: number): boolean => {
    if ((price[better] ?? 0) > (price[worse] ?? 0)) return false;
    for (let week = 0; week < horizon; week += 1) {
      if ((value[better * horizon + week] ?? 0) < (value[worse * horizon + week] ?? 0))
        return false;
    }
    return true;
  };

  const sorted = [...indexes].sort((a, b) => (price[a] ?? 0) - (price[b] ?? 0));
  const kept: number[] = [];
  for (const index of sorted) {
    let dominators = 0;
    for (const other of kept) {
      if (dominates(other, index)) dominators += 1;
      if (dominators >= layers) break;
    }
    if (dominators < layers) kept.push(index);
  }
  return kept;
}

export function optimiseSquad(
  players: readonly PlannerPlayer[],
  options: OptimiseOptions = {},
): SquadOptimisation | null {
  const rules: PlanRules = { ...DEFAULT_RULES, ...options.rules };
  const budget = options.budget ?? 1000;
  const horizon = Math.max(1, options.horizon ?? 6);
  const riskAversion = options.riskAversion ?? 0;
  const keep = new Set(options.keep ?? []);
  const rounds = Math.max(0, options.rounds ?? 40);
  const maxEvaluations = options.maxEvaluations ?? 250_000;
  const layers = Math.max(1, options.layers ?? 5);
  const pairDepth = Math.max(1, options.pairDepth ?? 8);
  const kickSize = Math.max(1, options.kickSize ?? 4);
  const random = mulberry32(options.seed ?? 1);

  // A player nobody can pick is not a candidate, but one the reader has already
  // picked stays whatever his news says: it is their squad, not the model's.
  const pool = players.filter((player) => player.available !== false || keep.has(player.code));
  if (pool.length < rules.squadSize) return null;

  const indexOfCode = new Map(pool.map((player, index) => [player.code, index]));
  const size = pool.length;
  const price = new Int32Array(size);
  const club = new Int32Array(size);
  const position: Position[] = new Array<Position>(size);
  const value = new Float64Array(size * horizon);
  for (let index = 0; index < size; index += 1) {
    const player = pool[index];
    if (player === undefined) continue;
    price[index] = player.price;
    club[index] = player.teamCode;
    position[index] = player.position;
    for (let week = 0; week < horizon; week += 1) {
      const mean = player.projections[week] ?? 0;
      const spread = player.spreads?.[week] ?? 0;
      value[index * horizon + week] = riskAversion === 0 ? mean : mean - riskAversion * spread;
    }
  }

  /** Mean over the horizon, which is what ranks a player for pruning and for a kick. */
  const meanOf = (index: number): number => {
    let total = 0;
    for (let week = 0; week < horizon; week += 1) total += value[index * horizon + week] ?? 0;
    return total / horizon;
  };

  const byPosition = new Map<Position, number[]>();
  for (const slot of POSITIONS) {
    const members = pool.flatMap((player, index) => (player.position === slot ? [index] : []));
    const kept = prune(members, price, value, horizon, layers);
    // Best first, so the pair search can take a prefix and mean it.
    kept.sort((a, b) => meanOf(b) - meanOf(a));
    byPosition.set(slot, kept);
  }

  const seed = openingSquad(pool, {
    budget,
    horizon,
    rules: options.rules ?? {},
    keep: options.keep ?? [],
  });

  let start = seed.picks.flatMap((code) => {
    const index = indexOfCode.get(code);
    return index === undefined ? [] : [index];
  });

  // The greedy picker holds back a share of the budget for the eleven, so on a
  // budget close to what fifteen players cost at all it stops short of fifteen.
  // The search should not be unable to start over a seed's caution, so the
  // fallback is the cheapest legal squad: worthless, and a legal place to climb
  // from. Only when even that overspends is the problem genuinely infeasible.
  if (start.length !== rules.squadSize) {
    const cheapest = cheapestLegal(pool, indexOfCode, price, club, keep, rules, budget);
    if (cheapest === null) return null;
    start = cheapest;
  }

  const locked = new Set(start.filter((index) => keep.has(pool[index]?.code ?? -1)));

  // Positions never change: every move this search makes replaces a player with
  // one of his own position, so a legal seed keeps the quota legal forever and
  // only the budget and the club limit are worth checking again.
  const shape = start.map((index) => position[index] ?? 'MID');
  const weekValues = new Float64Array(rules.squadSize);
  let evaluated = 0;

  const weekly = (candidate: readonly number[]): number[] => {
    const out: number[] = [];
    for (let week = 0; week < horizon; week += 1) {
      for (let slot = 0; slot < candidate.length; slot += 1) {
        weekValues[slot] = value[(candidate[slot] ?? 0) * horizon + week] ?? 0;
      }
      const eleven = bestElevenValue(shape, weekValues);
      out.push(eleven.points + eleven.captain * (rules.captainMultiplier - 1));
    }
    return out;
  };

  const score = (candidate: readonly number[]): number => {
    evaluated += 1;
    return weekly(candidate).reduce((total, points) => total + points, 0);
  };

  /**
   * The most a swap could possibly be worth, without solving anything.
   *
   * Replacing one player with another changes the best eleven by at most the
   * difference between them: take the new optimal eleven and put the old player
   * back where the new one stood, and you have a legal eleven for the old squad
   * worth the new total less that difference, so the new total cannot exceed the
   * old one by more. The captain can double that difference and nothing else in
   * the squad moves, so twice the sum of the weekly gains is a ceiling.
   *
   * It is a ceiling rather than an estimate, which is what makes skipping on it
   * safe: a candidate whose ceiling is below the best gain already found cannot
   * be the best move, so the search never sees a squad it would have preferred.
   * On the real pool this skips most of the neighbourhood, and skipping is a
   * hundred times cheaper than solving fifteen elevens to learn the same thing.
   */
  const ceiling = (outIndex: number, inIndex: number): number => {
    let gain = 0;
    for (let week = 0; week < horizon; week += 1) {
      const step = (value[inIndex * horizon + week] ?? 0) - (value[outIndex * horizon + week] ?? 0);
      if (step > 0) gain += step;
    }
    return gain * rules.captainMultiplier;
  };

  const spendOf = (candidate: readonly number[]): number =>
    candidate.reduce((total, index) => total + (price[index] ?? 0), 0);

  const clubCounts = (candidate: readonly number[]): Map<number, number> => {
    const counts = new Map<number, number>();
    for (const index of candidate) {
      const code = club[index] ?? 0;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return counts;
  };

  let improvements = 0;
  let exhausted = false;

  /** Climb to a local maximum: best single move, then best pair, until neither improves. */
  const climb = (from: readonly number[]): { squad: number[]; points: number } => {
    const current = [...from];
    let points = score(current);

    for (;;) {
      if (evaluated >= maxEvaluations) {
        exhausted = true;
        break;
      }
      const held = new Set(current);
      const counts = clubCounts(current);
      const bank = budget - spendOf(current);

      let bestGain = 0;
      let bestMove: { slots: number[]; picks: number[] } | null = null;

      for (let slot = 0; slot < current.length; slot += 1) {
        if (locked.has(current[slot] ?? -1)) continue;
        const outIndex = current[slot] ?? 0;
        const affordable = bank + (price[outIndex] ?? 0);
        for (const candidate of byPosition.get(shape[slot] ?? 'MID') ?? []) {
          if (held.has(candidate)) continue;
          if ((price[candidate] ?? 0) > affordable) continue;
          const clubOf = club[candidate] ?? 0;
          const already = (counts.get(clubOf) ?? 0) - (clubOf === (club[outIndex] ?? 0) ? 1 : 0);
          if (already >= rules.maxPerClub) continue;
          if (ceiling(outIndex, candidate) <= bestGain) continue;

          current[slot] = candidate;
          const gain = score(current) - points;
          current[slot] = outIndex;
          if (gain > bestGain) {
            bestGain = gain;
            bestMove = { slots: [slot], picks: [candidate] };
          }
          if (evaluated >= maxEvaluations) break;
        }
        if (evaluated >= maxEvaluations) break;
      }

      // The pair search runs only when no single move improves, because it is
      // two orders of magnitude dearer and mostly rediscovers what the single
      // one already found. What it finds that a single cannot is the swap that
      // pays for itself.
      if (bestMove === null && evaluated < maxEvaluations) {
        for (let first = 0; first < current.length; first += 1) {
          if (locked.has(current[first] ?? -1)) continue;
          for (let second = first + 1; second < current.length; second += 1) {
            if (locked.has(current[second] ?? -1)) continue;
            const outA = current[first] ?? 0;
            const outB = current[second] ?? 0;
            const purse = bank + (price[outA] ?? 0) + (price[outB] ?? 0);
            const listA = (byPosition.get(shape[first] ?? 'MID') ?? []).slice(0, pairDepth);
            const listB = (byPosition.get(shape[second] ?? 'MID') ?? []).slice(0, pairDepth);

            for (const inA of listA) {
              if (held.has(inA)) continue;
              for (const inB of listB) {
                if (inB === inA || held.has(inB)) continue;
                if ((price[inA] ?? 0) + (price[inB] ?? 0) > purse) continue;
                if (ceiling(outA, inA) + ceiling(outB, inB) <= bestGain) continue;
                if (!clubsAllow(counts, [outA, outB], [inA, inB], club, rules.maxPerClub)) continue;

                current[first] = inA;
                current[second] = inB;
                const gain = score(current) - points;
                current[first] = outA;
                current[second] = outB;
                if (gain > bestGain) {
                  bestGain = gain;
                  bestMove = { slots: [first, second], picks: [inA, inB] };
                }
                if (evaluated >= maxEvaluations) break;
              }
              if (evaluated >= maxEvaluations) break;
            }
            if (evaluated >= maxEvaluations) break;
          }
          if (evaluated >= maxEvaluations) break;
        }
      }

      if (bestMove === null) break;
      for (let entry = 0; entry < bestMove.slots.length; entry += 1) {
        const slot = bestMove.slots[entry];
        const pick = bestMove.picks[entry];
        if (slot === undefined || pick === undefined) continue;
        current[slot] = pick;
      }
      points += bestGain;
      improvements += 1;
    }

    return { squad: current, points };
  };

  /** A few random legal changes, which is what lets the next climb find another peak. */
  const kick = (from: readonly number[]): number[] => {
    const current = [...from];
    for (let change = 0; change < kickSize; change += 1) {
      const slot = Math.floor(random() * current.length);
      if (locked.has(current[slot] ?? -1)) continue;
      const held = new Set(current);
      const counts = clubCounts(current);
      const outIndex = current[slot] ?? 0;
      const affordable = budget - spendOf(current) + (price[outIndex] ?? 0);
      const candidates = (byPosition.get(shape[slot] ?? 'MID') ?? []).filter((candidate) => {
        if (held.has(candidate)) return false;
        if ((price[candidate] ?? 0) > affordable) return false;
        const clubOf = club[candidate] ?? 0;
        const already = (counts.get(clubOf) ?? 0) - (clubOf === (club[outIndex] ?? 0) ? 1 : 0);
        return already < rules.maxPerClub;
      });
      if (candidates.length === 0) continue;
      current[slot] = candidates[Math.floor(random() * candidates.length)] ?? outIndex;
    }
    return current;
  };

  const baseline = score(start);
  let best = climb(start);
  let ran = 1;

  for (let round = 0; round < rounds; round += 1) {
    if (evaluated >= maxEvaluations) {
      exhausted = true;
      break;
    }
    const climbed = climb(kick(best.squad));
    ran += 1;
    if (climbed.points > best.points) best = climbed;
  }

  const spent = spendOf(best.squad);
  const codes = best.squad.flatMap((index) => {
    const player = pool[index];
    return player === undefined ? [] : [player.code];
  });

  return {
    squad: {
      picks: codes,
      purchasePrices: new Map(
        best.squad.flatMap((index) => {
          const player = pool[index];
          return player === undefined ? [] : [[player.code, player.price] as [number, number]];
        }),
      ),
      bank: budget - spent,
      freeTransfers: Math.min(options.freeTransfers ?? 1, rules.maxFreeTransfers),
      chipsUsed: [],
    },
    points: round2(best.points),
    baseline: round2(baseline),
    perGameweek: weekly(best.squad).map(round2),
    evaluated,
    improvements,
    rounds: ran,
    converged: !exhausted,
    candidates: {
      GKP: byPosition.get('GKP')?.length ?? 0,
      DEF: byPosition.get('DEF')?.length ?? 0,
      MID: byPosition.get('MID')?.length ?? 0,
      FWD: byPosition.get('FWD')?.length ?? 0,
    },
  };
}

/**
 * The cheapest legal fifteen, which is where the search starts when the greedy
 * squad could not be built at all. Locked players go in first, then the quota is
 * filled cheapest first inside the club limit.
 */
function cheapestLegal(
  pool: readonly PlannerPlayer[],
  indexOfCode: ReadonlyMap<number, number>,
  price: Int32Array,
  club: Int32Array,
  keep: ReadonlySet<number>,
  rules: PlanRules,
  budget: number,
): number[] | null {
  const picks: number[] = [];
  const counts = new Map<number, number>();
  const taken = new Set<number>();

  const add = (index: number): void => {
    picks.push(index);
    taken.add(index);
    const code = club[index] ?? 0;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  };

  for (const code of keep) {
    const index = indexOfCode.get(code);
    if (index !== undefined) add(index);
  }

  for (const slot of POSITIONS) {
    const filled = picks.filter((index) => pool[index]?.position === slot).length;
    const wanted = rules.quota[slot] - filled;
    if (wanted <= 0) continue;
    const candidates = pool
      .flatMap((player, index) => (player.position === slot ? [index] : []))
      .filter((index) => !taken.has(index))
      .sort((a, b) => (price[a] ?? 0) - (price[b] ?? 0));

    let added = 0;
    for (const index of candidates) {
      if (added === wanted) break;
      if ((counts.get(club[index] ?? 0) ?? 0) >= rules.maxPerClub) continue;
      add(index);
      added += 1;
    }
    if (added < wanted) return null;
  }

  const spend = picks.reduce((total, index) => total + (price[index] ?? 0), 0);
  return spend > budget || picks.length !== rules.squadSize ? null : picks;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Whether swapping two out for two in leaves every club inside its limit. */
function clubsAllow(
  counts: ReadonlyMap<number, number>,
  out: readonly number[],
  incoming: readonly number[],
  club: Int32Array,
  maxPerClub: number,
): boolean {
  const after = new Map(counts);
  for (const index of out) {
    const code = club[index] ?? 0;
    after.set(code, (after.get(code) ?? 0) - 1);
  }
  for (const index of incoming) {
    const code = club[index] ?? 0;
    after.set(code, (after.get(code) ?? 0) + 1);
  }
  for (const count of after.values()) {
    if (count > maxPerClub) return false;
  }
  return true;
}

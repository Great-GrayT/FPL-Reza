import { efficientFrontier, portfolioVariance, type Candidate } from '@fpl/quant';
import type { Chip, PlannerPlayer } from '@fpl/planner';
import type { StrategySpace } from './protocol';

/**
 * The space of strategies, rather than the curve through the best of them.
 *
 * Nine risk appetites produce nine dots and a line that reads as a law. What a
 * reader needs is the cloud: how thin the frontier actually is, how many squads
 * sit within a point of the best one, and where their own lands among them. A
 * frontier drawn alone answers "what is optimal"; the cloud answers "how much
 * does being optimal actually buy me", which is the question that changes
 * behaviour.
 *
 * Pure, so it can be measured against the real pool in a probe and tested
 * against a written one, rather than only observed through a worker.
 */

/** Two players at one club share a clean sheet, so they are not independent. */
export const CLUB_CORRELATION = 0.35;

export interface SpaceOptions {
  budget: number;
  horizon: number;
  keep: readonly number[];
  ban: readonly number[];
  chips: readonly Chip[];
  seed: number;
  limit?: number;
  maxPerClub?: number;
  /** Swaps made from each anchor. More is a denser cloud and a slower one. */
  perAnchor?: number;
}

/** The pool as portfolio candidates, summed over the horizon. */
export function candidatesFor(players: readonly PlannerPlayer[], weeks: number): Candidate[] {
  const sumOver = (values: readonly number[] | undefined): number => {
    let total = 0;
    for (let index = 0; index < weeks; index += 1) total += values?.[index] ?? 0;
    return total;
  };

  return players.map((player) => ({
    id: player.code,
    name: player.name,
    group: player.position,
    club: String(player.teamCode),
    cost: player.price,
    expected: sumOver(player.projections),
    // Independent weeks add in quadrature, the same assumption the band on the
    // total is drawn with, stated in both places.
    risk: Math.sqrt(
      Array.from({ length: weeks }, (_, index) => (player.spreads?.[index] ?? 0) ** 2).reduce(
        (total, value) => total + value,
        0,
      ),
    ),
  }));
}

/** A seeded generator, so a cloud is the same cloud on every reload. */
function rng(seed: number): () => number {
  let state = (seed || 1) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * What the two valuation chips add to a squad, and the week each would be
 * played.
 *
 * Exact and cheap: a bench boost is worth the four who would not otherwise have
 * scored in whichever week their total is highest, a triple captain the best
 * starter again in his best week. The unlimited chips are a rebuild rather than
 * a valuation, so they cannot be priced this way; they are searched properly by
 * the plan for the strategy actually selected, and the panel says so.
 */
export function chipValue(
  squad: readonly PlannerPlayer[],
  weeks: number,
  chips: readonly Chip[],
  startGameweek = 0,
): { chipGain: number; chipWeeks: { chip: Chip; gameweek: number; gain: number }[] } {
  const played: { chip: Chip; gameweek: number; gain: number }[] = [];
  let gain = 0;

  const weekly = (read: (values: number[]) => number): { week: number; value: number } => {
    let best = { week: 0, value: 0 };
    for (let week = 0; week < weeks; week += 1) {
      const values = squad.map((player) => player.projections[week] ?? 0).sort((a, b) => b - a);
      const value = read(values);
      if (value > best.value) best = { week, value };
    }
    return best;
  };

  if (chips.includes('bench_boost')) {
    const best = weekly((values) => values.slice(11).reduce((total, value) => total + value, 0));
    if (best.value > 0) {
      gain += best.value;
      played.push({
        chip: 'bench_boost',
        gameweek: startGameweek + best.week,
        gain: Math.round(best.value * 10) / 10,
      });
    }
  }

  if (chips.includes('triple_captain')) {
    const best = weekly((values) => values[0] ?? 0);
    if (best.value > 0) {
      gain += best.value;
      played.push({
        chip: 'triple_captain',
        gameweek: startGameweek + best.week,
        gain: Math.round(best.value * 10) / 10,
      });
    }
  }

  return { chipGain: gain, chipWeeks: played };
}

export function strategySpace(
  players: readonly PlannerPlayer[],
  options: SpaceOptions,
): StrategySpace {
  const weeks = options.horizon;
  const candidates = candidatesFor(players, weeks);
  const byCode = new Map(players.map((player) => [player.code, player]));
  const maxPerClub = options.maxPerClub ?? 3;
  const constraints = {
    budget: options.budget,
    quota: { GKP: 2, DEF: 5, MID: 5, FWD: 3 },
    maxPerClub,
  };

  const keep = new Set(options.keep);
  const barred = new Set(options.ban);
  const allowed = candidates.filter((entry) => !barred.has(entry.id));

  // Anchors at many appetites, and at three budgets, because a squad that does
  // not spend everything is a real strategy: leaving money aside buys a
  // steadier fifteen and the frontier alone never shows one.
  const anchors: Candidate[][] = [];
  const lambdas = [0, 0.005, 0.01, 0.02, 0.04, 0.08, 0.15, 0.3, 0.6, 1.2, 2.4];
  for (const share of [1, 0.96, 0.92]) {
    const frontier = efficientFrontier(
      allowed,
      { ...constraints, budget: Math.round(constraints.budget * share) },
      { lambdas, clubCorrelation: CLUB_CORRELATION },
    );
    for (const point of frontier) anchors.push(point.players);
  }

  const byGroupAll = new Map<string, Candidate[]>();
  for (const entry of allowed) {
    const list = byGroupAll.get(entry.group) ?? [];
    list.push(entry);
    byGroupAll.set(entry.group, list);
  }

  const seen = new Set<string>();
  const squads: Candidate[][] = [];
  const keyOf = (picks: readonly Candidate[]): string =>
    picks
      .map((entry) => entry.id)
      .sort((a, b) => a - b)
      .join(',');

  const consider = (picks: readonly Candidate[]): boolean => {
    if (picks.length !== 15) return false;
    for (const code of keep) if (!picks.some((entry) => entry.id === code)) return false;
    if (picks.some((entry) => barred.has(entry.id))) return false;
    const clubs = new Map<string, number>();
    for (const entry of picks) clubs.set(entry.club, (clubs.get(entry.club) ?? 0) + 1);
    if ([...clubs.values()].some((count) => count > maxPerClub)) return false;
    if (picks.reduce((total, entry) => total + entry.cost, 0) > options.budget) return false;
    const key = keyOf(picks);
    if (seen.has(key)) return false;
    seen.add(key);
    squads.push([...picks]);
    return true;
  };

  /**
   * Force the locked players into an anchor.
   *
   * The frontier solver knows nothing about locks, so every anchor it returns
   * would otherwise be rejected and the cloud would be empty exactly when a
   * reader has expressed a view. Repairing is the right move rather than
   * discarding: the anchor is still the best shape at that appetite, and the
   * question is what it looks like once the reader's own player is in it. The
   * player dropped is the one of his position whose expected points are
   * lowest, since that is the cheapest way to make room.
   */
  const withKeeps = (picks: readonly Candidate[]): Candidate[] | null => {
    let held = [...picks];
    for (const code of keep) {
      if (held.some((entry) => entry.id === code)) continue;
      const wanted = candidates.find((entry) => entry.id === code);
      if (wanted === undefined) return null;
      const sameLine = held
        .filter((entry) => entry.group === wanted.group && !keep.has(entry.id))
        .sort((a, b) => a.expected - b.expected);
      const dropped = sameLine[0];
      if (dropped === undefined) return null;
      held = held.map((entry) => (entry.id === dropped.id ? wanted : entry));
    }

    // Making room can overspend, so the repair pays for itself by downgrading
    // the least productive unlocked players until the squad is affordable.
    let guard = 0;
    while (held.reduce((total, entry) => total + entry.cost, 0) > options.budget && guard < 20) {
      guard += 1;
      const dearest = held
        .filter((entry) => !keep.has(entry.id))
        .sort((a, b) => b.cost / Math.max(0.1, b.expected) - a.cost / Math.max(0.1, a.expected))[0];
      if (dearest === undefined) return null;
      const cheaper = (byGroupAll.get(dearest.group) ?? [])
        .filter(
          (entry) => entry.cost < dearest.cost && !held.some((other) => other.id === entry.id),
        )
        .sort((a, b) => b.expected - a.expected)[0];
      if (cheaper === undefined) return null;
      held = held.map((entry) => (entry.id === dearest.id ? cheaper : entry));
    }
    return held;
  };

  for (const anchor of anchors) {
    const repaired = keep.size === 0 ? anchor : withKeeps(anchor);
    if (repaired !== null) consider(repaired);
  }

  // Around each anchor, swaps drawn at random rather than always the dearest
  // alternative: taking the top few by expected points produces the same
  // handful of names in every squad, which is a cloud of one idea.
  const random = rng(options.seed);
  const perAnchor = options.perAnchor ?? 40;
  const seeds = squads.map((squad) => [...squad]);
  for (const anchor of seeds) {
    for (let attempt = 0; attempt < perAnchor; attempt += 1) {
      // One swap most of the time, two sometimes: two is how a cloud reaches
      // the squads a single transfer cannot.
      const swaps = random() < 0.65 ? 1 : 2;
      let picks = [...anchor];
      let ok = true;
      for (let step = 0; step < swaps; step += 1) {
        const outIndex = Math.floor(random() * picks.length);
        const held = picks[outIndex];
        if (held === undefined || keep.has(held.id)) {
          ok = false;
          break;
        }
        const spent = picks.reduce((total, entry) => total + entry.cost, 0);
        const purse = options.budget - spent + held.cost;
        const pool = (byGroupAll.get(held.group) ?? []).filter(
          (entry) => entry.cost <= purse && !picks.some((other) => other.id === entry.id),
        );
        const chosen = pool[Math.floor(random() * pool.length)];
        if (chosen === undefined) {
          ok = false;
          break;
        }
        picks = picks.map((entry) => (entry.id === held.id ? chosen : entry));
      }
      if (ok) consider(picks);
    }
  }

  const scored = squads.map((picks) => {
    const expected = picks.reduce((total, entry) => total + entry.expected, 0);
    const risk = Math.sqrt(portfolioVariance(picks, CLUB_CORRELATION));
    const cost = picks.reduce((total, entry) => total + entry.cost, 0);
    const chip = chipValue(
      picks
        .map((entry) => byCode.get(entry.id))
        .filter((entry): entry is PlannerPlayer => entry !== undefined),
      weeks,
      options.chips,
    );
    return { picks: picks.map((entry) => entry.id), expected, risk, cost, ...chip };
  });

  // Dominated: another squad returns more and risks less. That is not a choice,
  // it is a mistake, and drawing it invites someone to pick it. They are still
  // counted, because how many were dropped is itself the finding.
  const ordered = [...scored].sort((a, b) => a.risk - b.risk);
  const efficient = new Set<(typeof ordered)[number]>();
  let bestSoFar = Number.NEGATIVE_INFINITY;
  for (const entry of ordered) {
    const total = entry.expected + entry.chipGain;
    if (total <= bestSoFar) continue;
    bestSoFar = total;
    efficient.add(entry);
  }

  // The near frontier is kept too, thinned evenly across the risk axis: the
  // whole point of a cloud is showing how little separates the best squad from
  // the merely good.
  const limit = options.limit ?? 240;
  const rest = ordered.filter((entry) => !efficient.has(entry));
  const stride = Math.max(1, Math.ceil(rest.length / Math.max(1, limit - efficient.size)));
  const thinned = rest.filter((_, index) => index % stride === 0);
  const kept = [...efficient, ...thinned].slice(0, limit);

  /**
   * The risk free squad, and it is not a metaphor.
   *
   * A fifteen of players who will not play returns nothing, with certainty:
   * zero expected points and zero spread, which is exactly cash. It is legal,
   * it is cheap, and the constraints permit it, so the frontier really does
   * have a riskless left end and the Sharpe ratio measured from it is the
   * textbook quantity rather than an analogy.
   *
   * Every *other* worthless squad is dropped, though. A cloud of fifteens that
   * will not play is noise: one of them is a finding, two hundred are a chart
   * nobody can read.
   */
  const steadiest = kept.reduce<(typeof kept)[number] | undefined>(
    (best, entry) => (best === undefined || entry.risk < best.risk ? entry : best),
    undefined,
  );
  const riskFree = { expected: steadiest?.expected ?? 0, risk: steadiest?.risk ?? 0 };
  const playable = kept.filter(
    (entry) => entry === steadiest || entry.expected + entry.chipGain > 0,
  );

  const dots = playable
    .map((entry, id) => ({
      id,
      picks: entry.picks,
      expected: Math.round((entry.expected + entry.chipGain) * 10) / 10,
      risk: Math.round(entry.risk * 100) / 100,
      cost: entry.cost,
      sharpe:
        entry.risk <= 0
          ? 0
          : Math.round(
              ((entry.expected + entry.chipGain - riskFree.expected) / entry.risk) * 1000,
            ) / 1000,
      chipGain: Math.round(entry.chipGain * 10) / 10,
      chipWeeks: entry.chipWeeks,
    }))
    .sort((a, b) => a.risk - b.risk);

  const tangency = dots.reduce<StrategySpace['tangency']>((best, dot) => {
    if (best !== null && dot.sharpe <= best.sharpe) return best;
    return { expected: dot.expected, risk: dot.risk, sharpe: dot.sharpe, picks: dot.picks };
  }, null);

  return {
    dots,
    riskFree: {
      expected: Math.round(riskFree.expected * 10) / 10,
      risk: Math.round(riskFree.risk * 100) / 100,
    },
    tangency,
    generated: squads.length,
    clubCorrelation: CLUB_CORRELATION,
  };
}

/**
 * Strategy backtesting over a stored panel.
 *
 * A rule is a declarative object rather than a callback, for two reasons: it
 * serialises into a URL, so a result is shareable and reproducible, and it
 * cannot reach data the rule was not given, which is the usual way a backtest
 * ends up trading on information that did not exist yet.
 *
 * The engine's contract: at gameweek n it may only see rows from gameweeks
 * before n. The forward return is read afterwards and never fed back.
 */
import { at, mean, standardDeviation } from './internal.js';

export interface PanelRow {
  id: number;
  name: string;
  period: number;
  group: string;
  club: string;
  cost: number;
  /** What this row actually returned in this period. */
  actual: number;
  /** The score the rule ranks on, computed from information available before. */
  score: number;
  /** Whether the row was selectable at all: available, in a squad, not injured. */
  eligible?: boolean;
}

export interface Rule {
  /** How many to hold. */
  squadSize: number;
  /** Changes allowed per period before a cost is charged. */
  freeTransfers: number;
  /** Points deducted per change beyond the free allowance. */
  transferCost: number;
  /** Multiplier on the highest scoring holding, FPL's captaincy. */
  captainMultiplier: number;
  /** Total spend allowed, in the same units as cost. */
  budget?: number;
  maxPerClub?: number;
  /** Required count per group. Absent means the shape is unconstrained. */
  quota?: Record<string, number>;
  /** Minimum score to be considered at all. */
  minimumScore?: number;
}

export interface BacktestPeriod {
  period: number;
  /** Points before any transfer cost. */
  gross: number;
  transfers: number;
  cost: number;
  net: number;
  cumulative: number;
  captain: string | null;
  benchmark: number | null;
  holdings: string[];
}

export interface BacktestResult {
  periods: BacktestPeriod[];
  total: number;
  /** Mean and spread of net points per period. */
  perPeriod: { mean: number; sd: number };
  transfers: number;
  transferCost: number;
  /** Points against the benchmark, where one was supplied. */
  excess: number | null;
  trackingError: number | null;
  informationRatio: number | null;
  /** Share of periods that beat the benchmark. */
  hitRate: number | null;
  bestPeriod: BacktestPeriod | null;
  worstPeriod: BacktestPeriod | null;
  maxDrawdown: number;
  turnover: number;
}

interface Holding {
  id: number;
  name: string;
  group: string;
  club: string;
  cost: number;
}

function shapeOf(holdings: Holding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const holding of holdings) counts.set(holding.group, (counts.get(holding.group) ?? 0) + 1);
  return counts;
}

/**
 * Pick the best legal set from one period's candidates. Greedy by score, with
 * the quota and club rules checked as it goes, then a cheapest first fill so a
 * quota is never left short because the budget ran out on the last slot.
 */
function selectSquad(candidates: PanelRow[], rule: Rule): Holding[] {
  const budget = rule.budget ?? Number.POSITIVE_INFINITY;
  const maxPerClub = rule.maxPerClub ?? Number.POSITIVE_INFINITY;
  const quota = rule.quota;
  const eligible = candidates
    .filter((row) => row.eligible !== false && Number.isFinite(row.score))
    .filter((row) => rule.minimumScore === undefined || row.score >= rule.minimumScore)
    .sort((left, right) => right.score - left.score);

  const chosen: Holding[] = [];
  const perClub = new Map<string, number>();
  let spent = 0;

  const roomFor = (row: PanelRow): boolean => {
    if ((perClub.get(row.club) ?? 0) >= maxPerClub) return false;
    if (spent + row.cost > budget) return false;
    if (quota !== undefined) {
      const shape = shapeOf(chosen);
      const required = quota[row.group] ?? 0;
      if ((shape.get(row.group) ?? 0) >= required) return false;
    }
    return chosen.length < rule.squadSize;
  };

  for (const row of eligible) {
    if (!roomFor(row)) continue;
    chosen.push({ id: row.id, name: row.name, group: row.group, club: row.club, cost: row.cost });
    perClub.set(row.club, (perClub.get(row.club) ?? 0) + 1);
    spent += row.cost;
  }

  // A shape left short by the budget is filled from the cheapest remaining
  // candidates of the missing group, which is what a manager would actually do.
  if (quota !== undefined) {
    for (const [group, required] of Object.entries(quota)) {
      let held = shapeOf(chosen).get(group) ?? 0;
      if (held >= required) continue;
      const pool = eligible
        .filter((row) => row.group === group && !chosen.some((holding) => holding.id === row.id))
        .sort((left, right) => left.cost - right.cost);
      for (const row of pool) {
        if (held >= required) break;
        if ((perClub.get(row.club) ?? 0) >= maxPerClub) continue;
        chosen.push({
          id: row.id,
          name: row.name,
          group: row.group,
          club: row.club,
          cost: row.cost,
        });
        perClub.set(row.club, (perClub.get(row.club) ?? 0) + 1);
        spent += row.cost;
        held += 1;
      }
    }
  }

  return chosen;
}

/**
 * Replay a rule period by period. Transfers are counted against the previous
 * holdings, and the cost is charged in the period the change is made, which is
 * what makes a high turnover factor look as expensive as it really is.
 */
export function backtest(
  rows: PanelRow[],
  rule: Rule,
  options: { benchmarkByPeriod?: Map<number, number>; startPeriod?: number } = {},
): BacktestResult {
  const byPeriod = new Map<number, PanelRow[]>();
  for (const row of rows) {
    const bucket = byPeriod.get(row.period) ?? [];
    bucket.push(row);
    byPeriod.set(row.period, bucket);
  }

  const periods = [...byPeriod.keys()]
    .filter((period) => options.startPeriod === undefined || period >= options.startPeriod)
    .sort((a, b) => a - b);

  const results: BacktestPeriod[] = [];
  let previous: Holding[] = [];
  let cumulative = 0;
  let totalTransfers = 0;
  let totalCost = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const period of periods) {
    const candidates = byPeriod.get(period) ?? [];
    const holdings = selectSquad(candidates, rule);
    const held = new Set(holdings.map((holding) => holding.id));
    const before = new Set(previous.map((holding) => holding.id));

    let changes = 0;
    for (const id of held) if (!before.has(id)) changes += 1;
    // The first period is the initial squad, not a set of transfers.
    const transfers = previous.length === 0 ? 0 : changes;
    const chargeable = Math.max(0, transfers - rule.freeTransfers);
    const cost = chargeable * rule.transferCost;

    const returns = new Map(candidates.map((row) => [row.id, row.actual]));
    let gross = 0;
    let captain: string | null = null;
    let captainReturn = Number.NEGATIVE_INFINITY;
    let captainScore = Number.NEGATIVE_INFINITY;

    const scores = new Map(candidates.map((row) => [row.id, row.score]));
    for (const holding of holdings) {
      const actual = returns.get(holding.id) ?? 0;
      gross += actual;
      // The captain is chosen on the score, which is what was known, never on
      // the return, which is what a hindsight backtest would do.
      const score = scores.get(holding.id) ?? Number.NEGATIVE_INFINITY;
      if (score > captainScore) {
        captainScore = score;
        captain = holding.name;
        captainReturn = actual;
      }
    }
    if (captain !== null && Number.isFinite(captainReturn)) {
      gross += captainReturn * (rule.captainMultiplier - 1);
    }

    const net = gross - cost;
    cumulative += net;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.min(maxDrawdown, cumulative - peak);
    totalTransfers += transfers;
    totalCost += cost;

    results.push({
      period,
      gross,
      transfers,
      cost,
      net,
      cumulative,
      captain,
      benchmark: options.benchmarkByPeriod?.get(period) ?? null,
      holdings: holdings.map((holding) => holding.name),
    });
    previous = holdings;
  }

  const nets = results.map((entry) => entry.net);
  const withBenchmark = results.filter((entry) => entry.benchmark !== null);
  const excesses = withBenchmark.map((entry) => entry.net - (entry.benchmark ?? 0));
  const trackingError = excesses.length > 1 ? standardDeviation(excesses) : null;
  const excess = excesses.length > 0 ? excesses.reduce((total, value) => total + value, 0) : null;

  const changed = results.reduce((total, entry) => total + entry.transfers, 0);
  const turnover =
    results.length <= 1 || rule.squadSize === 0
      ? 0
      : changed / ((results.length - 1) * rule.squadSize);

  return {
    periods: results,
    total: cumulative,
    perPeriod: { mean: mean(nets), sd: standardDeviation(nets) },
    transfers: totalTransfers,
    transferCost: totalCost,
    excess,
    trackingError,
    informationRatio:
      trackingError !== null && trackingError > 0 ? mean(excesses) / trackingError : null,
    hitRate:
      withBenchmark.length === 0
        ? null
        : withBenchmark.filter((entry) => entry.net > (entry.benchmark ?? 0)).length /
          withBenchmark.length,
    bestPeriod: results.reduce<BacktestPeriod | null>(
      (best, entry) => (best === null || entry.net > best.net ? entry : best),
      null,
    ),
    worstPeriod: results.reduce<BacktestPeriod | null>(
      (worst, entry) => (worst === null || entry.net < worst.net ? entry : worst),
      null,
    ),
    maxDrawdown,
    turnover,
  };
}

export interface Comparison {
  name: string;
  total: number;
  perPeriod: number;
  sd: number;
  transfers: number;
  turnover: number;
  informationRatio: number | null;
}

/** Several rules over the same panel, scored the same way, ranked by total. */
export function compareRules(
  rows: PanelRow[],
  rules: { name: string; rule: Rule; rows?: PanelRow[] }[],
  options: { benchmarkByPeriod?: Map<number, number> } = {},
): Comparison[] {
  return rules
    .map((entry) => {
      const result = backtest(entry.rows ?? rows, entry.rule, options);
      return {
        name: entry.name,
        total: result.total,
        perPeriod: result.perPeriod.mean,
        sd: result.perPeriod.sd,
        transfers: result.transfers,
        turnover: result.turnover,
        informationRatio: result.informationRatio,
      };
    })
    .sort((left, right) => right.total - left.total);
}

/**
 * A random selection run many times, which is the only honest yardstick for a
 * rule: a strategy that beats the average manager but not a coin flip over the
 * same universe has found nothing.
 */
export function randomBaseline(
  rows: PanelRow[],
  rule: Rule,
  options: { runs?: number; seed?: number } = {},
): { mean: number; sd: number; p5: number; p95: number; runs: number } {
  const runs = options.runs ?? 50;
  const seed = options.seed ?? 1;
  const totals: number[] = [];

  for (let run = 0; run < runs; run += 1) {
    // Scores are replaced by a deterministic pseudo random shuffle of the same
    // rows, so the universe, the costs, and the constraints all stay identical.
    let state = (seed + run * 7919) >>> 0;
    const shuffled = rows.map((row) => {
      state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + row.id) >>> 0;
      return { ...row, score: state / 4294967296 };
    });
    totals.push(backtest(shuffled, rule).total);
  }

  const ascending = [...totals].sort((a, b) => a - b);
  const quantile = (p: number): number =>
    at(ascending, Math.min(ascending.length - 1, Math.floor(p * ascending.length)));
  return {
    mean: mean(totals),
    sd: standardDeviation(totals),
    p5: quantile(0.05),
    p95: quantile(0.95),
    runs,
  };
}

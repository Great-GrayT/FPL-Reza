/**
 * The squad as a portfolio.
 *
 * Fifteen picks, a fixed budget, a fixed shape, and at most three from any one
 * club is a constrained selection problem, and the frontier of it says
 * something a points ranking cannot: how much expected return a manager gives
 * up to reduce the week to week variance of their team, and where that trade
 * stops being worth it.
 *
 * Nothing here is FPL specific in its mathematics: the constraints are inputs.
 */
import { at, mean } from './internal.js';

export interface Candidate {
  id: number;
  name: string;
  /** Quota group. In FPL: GKP, DEF, MID, FWD. */
  group: string;
  /** Club, or any other "at most n of these" bucket. */
  club: string;
  /** Price in the same units as the budget. FPL uses tenths of a million. */
  cost: number;
  /** Expected return per period. */
  expected: number;
  /** Standard deviation of that return. */
  risk: number;
}

export interface Constraints {
  budget: number;
  /** Required count per group, which must sum to the squad size. */
  quota: Record<string, number>;
  maxPerClub: number;
}

export interface Portfolio {
  players: Candidate[];
  cost: number;
  expected: number;
  /** Portfolio standard deviation, including the club correlation term. */
  risk: number;
  /** Expected return per unit of risk. */
  ratio: number;
  /** Risk aversion this portfolio was optimal at. */
  lambda: number;
}

export interface FrontierOptions {
  /** Risk aversions to sweep. Zero is the pure points squad. */
  lambdas?: number[];
  /**
   * Correlation between two players at the same club. Not a free parameter: a
   * clean sheet is one event shared by an entire defence, so their returns
   * genuinely move together and pretending otherwise understates squad risk.
   */
  clubCorrelation?: number;
  /** Local search passes per lambda. */
  improvementRounds?: number;
}

/** Variance of a squad, with same club pairs correlated and the rest independent. */
export function portfolioVariance(players: Candidate[], clubCorrelation = 0.35): number {
  let total = 0;
  for (let i = 0; i < players.length; i += 1) {
    const a = players[i];
    if (a === undefined) continue;
    total += a.risk * a.risk;
    for (let j = i + 1; j < players.length; j += 1) {
      const b = players[j];
      if (b === undefined) continue;
      const correlation = a.club === b.club ? clubCorrelation : 0;
      total += 2 * correlation * a.risk * b.risk;
    }
  }
  return total;
}

export function portfolioOf(
  players: Candidate[],
  lambda: number,
  clubCorrelation = 0.35,
): Portfolio {
  const cost = players.reduce((total, player) => total + player.cost, 0);
  const expected = players.reduce((total, player) => total + player.expected, 0);
  const risk = Math.sqrt(portfolioVariance(players, clubCorrelation));
  return {
    players,
    cost,
    expected,
    risk,
    ratio: risk === 0 ? Number.NaN : expected / risk,
    lambda,
  };
}

function legal(players: Candidate[], constraints: Constraints): boolean {
  if (players.reduce((total, player) => total + player.cost, 0) > constraints.budget) return false;
  const perClub = new Map<string, number>();
  const perGroup = new Map<string, number>();
  for (const player of players) {
    const club = (perClub.get(player.club) ?? 0) + 1;
    if (club > constraints.maxPerClub) return false;
    perClub.set(player.club, club);
    perGroup.set(player.group, (perGroup.get(player.group) ?? 0) + 1);
  }
  for (const [group, required] of Object.entries(constraints.quota)) {
    if ((perGroup.get(group) ?? 0) !== required) return false;
  }
  return true;
}

/**
 * One point on the frontier: maximise expected return minus lambda times
 * variance, subject to the constraints. Built greedily by marginal utility per
 * unit of cost, then improved by single swaps until nothing improves. The
 * constraint set is small (fifteen from a few hundred), so a full solver would
 * buy accuracy nobody could see; a swap search reaches the same squad.
 */
export function optimisePortfolio(
  candidates: Candidate[],
  constraints: Constraints,
  lambda: number,
  options: { clubCorrelation?: number; improvementRounds?: number } = {},
): Portfolio | null {
  const clubCorrelation = options.clubCorrelation ?? 0.35;
  const rounds = options.improvementRounds ?? 200;
  const squadSize = Object.values(constraints.quota).reduce((total, value) => total + value, 0);

  const utility = (players: Candidate[]): number =>
    players.reduce((total, player) => total + player.expected, 0) -
    lambda * portfolioVariance(players, clubCorrelation);

  // The cheapest legal shape first, so a greedy pass can never paint itself into
  // a squad it cannot afford to complete.
  const byGroup = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const bucket = byGroup.get(candidate.group) ?? [];
    bucket.push(candidate);
    byGroup.set(candidate.group, bucket);
  }

  const chosen: Candidate[] = [];
  const perClub = new Map<string, number>();
  const take = (player: Candidate): void => {
    chosen.push(player);
    perClub.set(player.club, (perClub.get(player.club) ?? 0) + 1);
  };

  for (const [group, required] of Object.entries(constraints.quota)) {
    const pool = [...(byGroup.get(group) ?? [])].sort((a, b) => a.cost - b.cost);
    let taken = 0;
    for (const player of pool) {
      if (taken >= required) break;
      if ((perClub.get(player.club) ?? 0) >= constraints.maxPerClub) continue;
      take(player);
      taken += 1;
    }
    if (taken < required) return null;
  }
  if (chosen.length !== squadSize) return null;

  // Upgrade one slot at a time, always the swap that buys the most utility per
  // unit of the remaining budget, until nothing pays for itself.
  for (let round = 0; round < rounds; round += 1) {
    const spent = chosen.reduce((total, player) => total + player.cost, 0);
    const spare = constraints.budget - spent;
    let best: { out: number; in: Candidate; gain: number } | null = null;
    const baseline = utility(chosen);

    for (let index = 0; index < chosen.length; index += 1) {
      const current = chosen[index];
      if (current === undefined) continue;
      for (const replacement of byGroup.get(current.group) ?? []) {
        if (replacement.id === current.id) continue;
        if (chosen.some((player) => player.id === replacement.id)) continue;
        if (replacement.cost - current.cost > spare) continue;
        const clubCount = perClub.get(replacement.club) ?? 0;
        const sameClub = replacement.club === current.club;
        if (!sameClub && clubCount >= constraints.maxPerClub) continue;

        const trial = [...chosen];
        trial[index] = replacement;
        const gain = utility(trial) - baseline;
        if (gain > 0 && (best === null || gain > best.gain)) {
          best = { out: index, in: replacement, gain };
        }
      }
    }

    if (best === null) break;
    const move = best;
    const removed = chosen[move.out];
    if (removed === undefined) break;
    perClub.set(removed.club, (perClub.get(removed.club) ?? 1) - 1);
    perClub.set(move.in.club, (perClub.get(move.in.club) ?? 0) + 1);
    chosen[move.out] = move.in;
  }

  if (!legal(chosen, constraints)) return null;
  return portfolioOf(chosen, lambda, clubCorrelation);
}

/**
 * The frontier itself: one optimal squad per risk aversion, deduplicated, with
 * dominated points removed so what remains really is a trade rather than a
 * strictly worse squad.
 */
export function efficientFrontier(
  candidates: Candidate[],
  constraints: Constraints,
  options: FrontierOptions = {},
): Portfolio[] {
  const lambdas = options.lambdas ?? [0, 0.01, 0.025, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6];
  const portfolios: Portfolio[] = [];
  for (const lambda of lambdas) {
    const portfolio = optimisePortfolio(candidates, constraints, lambda, options);
    if (portfolio === null) continue;
    portfolios.push(portfolio);
  }

  const seen = new Set<string>();
  const unique = portfolios.filter((portfolio) => {
    const key = portfolio.players
      .map((player) => player.id)
      .sort((a, b) => a - b)
      .join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // A squad with less expected return and more risk than another is not a
  // choice, it is a mistake, so it does not go on the chart.
  return unique
    .filter(
      (portfolio) =>
        !unique.some(
          (other) =>
            other !== portfolio &&
            other.expected >= portfolio.expected &&
            other.risk <= portfolio.risk &&
            (other.expected > portfolio.expected || other.risk < portfolio.risk),
        ),
    )
    .sort((left, right) => left.risk - right.risk);
}

export interface RiskContribution {
  name: string;
  club: string;
  /** Share of squad variance this player is responsible for. */
  share: number;
  /** Marginal contribution: how much variance leaving him out removes. */
  marginal: number;
}

/**
 * Where a squad's variance actually lives. Usually not where a manager thinks:
 * three players from one club carry the correlation term as well as their own
 * risk, so the third pick from a club costs more variance than the first.
 */
export function riskContributions(
  players: Candidate[],
  clubCorrelation = 0.35,
): RiskContribution[] {
  const total = portfolioVariance(players, clubCorrelation);
  return players
    .map((player) => {
      const without = players.filter((other) => other.id !== player.id);
      const marginal = total - portfolioVariance(without, clubCorrelation);
      return {
        name: player.name,
        club: player.club,
        share: total === 0 ? Number.NaN : marginal / total,
        marginal,
      };
    })
    .sort((left, right) => right.marginal - left.marginal);
}

export interface DiversificationReport {
  /** Squad risk divided by the risk of the same players held independently. */
  ratio: number;
  clubs: { club: string; players: number; varianceShare: number }[];
  concentration: number;
}

/** How much the club rule is actually protecting a squad, and where it is not. */
export function diversification(
  players: Candidate[],
  clubCorrelation = 0.35,
): DiversificationReport {
  const correlated = Math.sqrt(portfolioVariance(players, clubCorrelation));
  const independent = Math.sqrt(
    players.reduce((total, player) => total + player.risk * player.risk, 0),
  );

  const byClub = new Map<string, Candidate[]>();
  for (const player of players) {
    const bucket = byClub.get(player.club) ?? [];
    bucket.push(player);
    byClub.set(player.club, bucket);
  }
  const totalVariance = portfolioVariance(players, clubCorrelation);
  const clubs = [...byClub.entries()]
    .map(([club, members]) => ({
      club,
      players: members.length,
      varianceShare:
        totalVariance === 0
          ? Number.NaN
          : portfolioVariance(members, clubCorrelation) / totalVariance,
    }))
    .sort((left, right) => right.varianceShare - left.varianceShare);

  // Herfindahl over club shares: one club holding half the squad's variance
  // reads very differently from ten clubs holding a twentieth each.
  const concentration = clubs.reduce((total, club) => total + club.varianceShare ** 2, 0);
  return { ratio: independent === 0 ? Number.NaN : correlated / independent, clubs, concentration };
}

/**
 * Kelly style sizing translated into this game: what share of a transfer budget
 * a manager should spend chasing an edge, given how uncertain the edge is.
 * Returned as a fraction, and capped at one because the game has no leverage.
 */
export function edgeFraction(expectedEdge: number, edgeVariance: number): number {
  if (!(edgeVariance > 0)) return 0;
  return Math.max(0, Math.min(1, expectedEdge / edgeVariance));
}

/** Mean and spread of a return series, the inputs a candidate needs. */
export function candidateFrom(
  id: number,
  name: string,
  group: string,
  club: string,
  cost: number,
  returns: ArrayLike<number>,
): Candidate {
  const expected = mean(returns);
  let variance = 0;
  for (let i = 0; i < returns.length; i += 1) variance += (at(returns, i) - expected) ** 2;
  const risk = returns.length > 1 ? Math.sqrt(variance / (returns.length - 1)) : 0;
  return { id, name, group, club, cost, expected, risk };
}

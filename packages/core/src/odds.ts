import { z } from 'zod';
import { fixtureIdSchema, teamIdSchema } from './ids.js';

/**
 * Bookmaker odds, and the derivations FPL actually needs from them: how likely
 * a clean sheet is, and how many goals a side is expected to score. Those two
 * quantities scale expected returns far better than fixture difficulty rating,
 * which is a coarse 1 to 5 integer.
 */

export const MARKETS = [
  'match_odds',
  'over_under',
  'both_teams_to_score',
  'asian_handicap',
  'correct_score',
  'anytime_scorer',
  'clean_sheet',
] as const;

export type Market = (typeof MARKETS)[number];
export const marketSchema = z.enum(MARKETS);

export const oddsQuoteSchema = z.object({
  provider: z.string().min(1),
  bookmaker: z.string().min(1),
  /** Null until the quote is matched to a fixture by teams and kickoff. */
  fixtureId: fixtureIdSchema.nullable(),
  homeTeam: teamIdSchema.nullable(),
  awayTeam: teamIdSchema.nullable(),
  /**
   * The provider's own spelling of the two clubs, kept whether or not the ids
   * resolved.
   *
   * An FPL team id exists only for a club in the current league, so a price on
   * a match played by a side since relegated has no id to carry and used to
   * become an orphan row: 15 percent of one season's quotes, 25 percent of an
   * older one. The name is what a past match can still be joined on, and
   * keeping the provider's own is the same discipline the player identity
   * mapping follows, which stores the evidence a join was made on rather than
   * only the result.
   */
  homeName: z.string().nullable().default(null),
  awayName: z.string().nullable().default(null),
  kickoff: z.coerce.date().nullable(),
  market: marketSchema,
  /** "home", "draw", "away", "over", "under", "yes", "no", or a player name. */
  selection: z.string().min(1),
  /** Decimal odds. 2.0 means an even money bet. */
  decimal: z.number().gt(1),
  /** Handicap or total line, where the market has one. */
  line: z.number().nullable(),
  capturedAt: z.coerce.date(),
});

export type OddsQuote = z.infer<typeof oddsQuoteSchema>;

export const impliedProbability = (decimal: number): number => 1 / decimal;

/** Bookmaker margin: implied probabilities across a market sum above 1. */
export const overround = (probabilities: readonly number[]): number =>
  probabilities.reduce((sum, value) => sum + value, 0) - 1;

/**
 * Strips the margin proportionally. Proportional normalisation slightly
 * overstates long shots compared with the Shin or power methods, but it needs
 * no solver and is stable on two and three way markets.
 */
export function removeOverround(probabilities: readonly number[]): number[] {
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return probabilities.map(() => 0);
  return probabilities.map((value) => value / total);
}

export interface MatchOutcomeProbabilities {
  home: number;
  draw: number;
  away: number;
}

/** Fair 1X2 probabilities from a set of quotes for one fixture. */
export function matchOutcomeProbabilities(
  quotes: readonly OddsQuote[],
): MatchOutcomeProbabilities | null {
  const pick = (selection: string): number | undefined =>
    quotes.find((quote) => quote.market === 'match_odds' && quote.selection === selection)?.decimal;

  const home = pick('home');
  const draw = pick('draw');
  const away = pick('away');
  if (home === undefined || draw === undefined || away === undefined) return null;

  const [fairHome, fairDraw, fairAway] = removeOverround([
    impliedProbability(home),
    impliedProbability(draw),
    impliedProbability(away),
  ]);

  return { home: fairHome ?? 0, draw: fairDraw ?? 0, away: fairAway ?? 0 };
}

/**
 * Scorelines are truncated here. At 15 the lost tail is under 1e-9 for the
 * goal expectations seen in practice, which keeps the distribution summing to
 * 1 within floating point tolerance.
 */
const MAX_GOALS = 15;

export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logFactorial = 0;
  for (let i = 2; i <= k; i += 1) logFactorial += Math.log(i);
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial);
}

export interface ScorelineProbabilities {
  home: number;
  draw: number;
  away: number;
  over25: number;
  bothTeamsToScore: number;
  homeCleanSheet: number;
  awayCleanSheet: number;
}

/**
 * Independent Poisson scoreline model. It ignores the mild negative
 * correlation between team scores, which is why the fitted expectations are
 * calibrated against the market rather than trusted on their own.
 */
export function scorelineProbabilities(
  homeGoals: number,
  awayGoals: number,
): ScorelineProbabilities {
  let home = 0;
  let draw = 0;
  let away = 0;
  let over25 = 0;

  const homePmf: number[] = [];
  const awayPmf: number[] = [];
  for (let goals = 0; goals <= MAX_GOALS; goals += 1) {
    homePmf.push(poissonPmf(goals, homeGoals));
    awayPmf.push(poissonPmf(goals, awayGoals));
  }

  for (let h = 0; h <= MAX_GOALS; h += 1) {
    for (let a = 0; a <= MAX_GOALS; a += 1) {
      const probability = (homePmf[h] ?? 0) * (awayPmf[a] ?? 0);
      if (h > a) home += probability;
      else if (h === a) draw += probability;
      else away += probability;
      if (h + a > 2.5) over25 += probability;
    }
  }

  return {
    home,
    draw,
    away,
    over25,
    bothTeamsToScore: (1 - Math.exp(-homeGoals)) * (1 - Math.exp(-awayGoals)),
    // A clean sheet for the home side means the away side fails to score.
    homeCleanSheet: Math.exp(-awayGoals),
    awayCleanSheet: Math.exp(-homeGoals),
  };
}

export interface GoalExpectationTarget {
  home: number;
  draw: number;
  away: number;
  /** Fair probability of three or more goals, when an over under market exists. */
  over25?: number;
}

export interface GoalExpectations {
  home: number;
  away: number;
  /** Sum of squared error against the target probabilities, for diagnostics. */
  error: number;
}

const SEARCH_MIN = 0.05;
const SEARCH_MAX = 4.5;

/**
 * Recovers the goal expectations implied by the market. Coarse grid first,
 * then a fine pass around the best cell: the surface is smooth and unimodal in
 * this range, so a full solver would buy nothing.
 */
export function fitGoalExpectations(target: GoalExpectationTarget): GoalExpectations {
  const score = (home: number, away: number): number => {
    const model = scorelineProbabilities(home, away);
    let error =
      (model.home - target.home) ** 2 +
      (model.draw - target.draw) ** 2 +
      (model.away - target.away) ** 2;
    if (target.over25 !== undefined) error += (model.over25 - target.over25) ** 2;
    return error;
  };

  // Each axis gets its own range: the fine pass brackets the coarse winner
  // per side, since the two expectations are usually far apart.
  const search = (
    homeFrom: number,
    homeTo: number,
    awayFrom: number,
    awayTo: number,
    step: number,
    around?: GoalExpectations,
  ): GoalExpectations => {
    let best: GoalExpectations = around ?? {
      home: 1.4,
      away: 1.2,
      error: Number.POSITIVE_INFINITY,
    };
    for (let home = homeFrom; home <= homeTo; home += step) {
      for (let away = awayFrom; away <= awayTo; away += step) {
        const error = score(home, away);
        if (error < best.error) best = { home, away, error };
      }
    }
    return best;
  };

  const clamp = (value: number): number => Math.min(SEARCH_MAX, Math.max(SEARCH_MIN, value));
  const coarse = search(SEARCH_MIN, SEARCH_MAX, SEARCH_MIN, SEARCH_MAX, 0.05);
  return search(
    clamp(coarse.home - 0.05),
    clamp(coarse.home + 0.05),
    clamp(coarse.away - 0.05),
    clamp(coarse.away + 0.05),
    0.01,
    coarse,
  );
}

export interface FixtureOutlook {
  fixtureId: number | null;
  outcome: MatchOutcomeProbabilities;
  goals: GoalExpectations;
  homeCleanSheet: number;
  awayCleanSheet: number;
}

/**
 * Turns a fixture's quotes into the numbers the rest of the platform consumes.
 * Returns null when the 1X2 market is missing, since everything downstream
 * derives from it.
 */
export function fixtureOutlook(quotes: readonly OddsQuote[]): FixtureOutlook | null {
  const outcome = matchOutcomeProbabilities(quotes);
  if (outcome === null) return null;

  const overQuote = quotes.find(
    (quote) => quote.market === 'over_under' && quote.selection === 'over' && quote.line === 2.5,
  );
  const underQuote = quotes.find(
    (quote) => quote.market === 'over_under' && quote.selection === 'under' && quote.line === 2.5,
  );

  const target: GoalExpectationTarget = { ...outcome };
  if (overQuote !== undefined && underQuote !== undefined) {
    const [fairOver] = removeOverround([
      impliedProbability(overQuote.decimal),
      impliedProbability(underQuote.decimal),
    ]);
    if (fairOver !== undefined) target.over25 = fairOver;
  }

  const goals = fitGoalExpectations(target);
  const model = scorelineProbabilities(goals.home, goals.away);

  return {
    fixtureId: quotes[0]?.fixtureId ?? null,
    outcome,
    goals,
    homeCleanSheet: model.homeCleanSheet,
    awayCleanSheet: model.awayCleanSheet,
  };
}

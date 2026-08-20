import { impliedProbability, overround, removeOverround, type OddsQuote } from '@fpl/core';

/**
 * What the betting market thought, beside what the model thinks.
 *
 * A price is not a probability. A bookmaker's three prices on one match imply
 * more than 100 percent between them, and the excess is the margin they trade
 * on: at the 2025/26 close it runs a little over 4 percent. So every figure
 * here has that margin stripped proportionally before it is shown, and the
 * margin itself is reported rather than quietly removed, because how much a
 * book was charging is part of how seriously to take its number.
 *
 * These are closing prices from football-data.co.uk, which is to say the last
 * price each book showed before kickoff. That is the sharpest number a
 * bookmaker publishes and the one worth comparing a model against. It is also,
 * unavoidably, after the fact: nothing here is a live price and nothing here is
 * a tip.
 */

/** How a quote is matched to a match when no FPL id exists for a relegated club. */
const normalise = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * The provider's own spellings, read off the 2025/26 file rather than guessed.
 *
 * Everything else normalisation handles: Arsenal, Chelsea, Fulham and the rest
 * match on the letters alone, and the prefix rule below covers Brighton against
 * Brighton and Hove Albion. These are the ones where the two names share no
 * usable prefix at all.
 */
const ALIASES: Record<string, string> = {
  manunited: 'manchesterunited',
  mancity: 'manchestercity',
  nottmforest: 'nottinghamforest',
  spurs: 'tottenhamhotspur',
  wolves: 'wolverhamptonwanderers',
  westbrom: 'westbromwichalbion',
  sheffieldweds: 'sheffieldwednesday',
  qpr: 'queensparkrangers',
};

const clubKey = (name: string): string => {
  const key = normalise(name);
  return ALIASES[key] ?? key;
};

/** Two spellings agree when either is a prefix of the other, at four or more. */
function sameClub(one: string, other: string): boolean {
  const a = clubKey(one);
  const b = clubKey(other);
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return a.startsWith(b) || b.startsWith(a);
}

const sameDay = (one: Date, other: Date): boolean =>
  Math.abs(one.getTime() - other.getTime()) < 36 * 60 * 60 * 1000;

export interface MatchOdds {
  bookmaker: string;
  /** Fair probabilities: the margin stripped proportionally. */
  home: number;
  draw: number;
  away: number;
  /** What the book was charging, as a share above 100 percent. */
  margin: number;
  over?: number;
  under?: number;
}

export interface MarketView {
  books: MatchOdds[];
  /** The average of the books, which is what a single number should be read as. */
  consensus: { home: number; draw: number; away: number; over: number | null } | null;
  /** How many books priced it, since one book is an opinion and eight are a market. */
  count: number;
  /** The margin across the books, lowest and highest. */
  marginLow: number;
  marginHigh: number;
}

/**
 * Every quote on one match, turned into fair probabilities per bookmaker.
 *
 * Matched on the two club names and the day, not on an id: an FPL team id
 * exists only for a club currently in the league, so a match played by a side
 * since relegated has no id on either side of the join.
 */
export function marketFor(
  quotes: readonly OddsQuote[],
  match: { homeTeamName: string; awayTeamName: string; kickoff: Date | null },
): MarketView | null {
  const kickoff = match.kickoff;
  if (kickoff === null) return null;

  const mine = quotes.filter(
    (quote) =>
      quote.kickoff !== null &&
      sameDay(quote.kickoff, kickoff) &&
      quote.homeName !== null &&
      quote.awayName !== null &&
      sameClub(quote.homeName, match.homeTeamName) &&
      sameClub(quote.awayName, match.awayTeamName),
  );
  if (mine.length === 0) return null;

  const byBook = new Map<string, OddsQuote[]>();
  for (const quote of mine) {
    const list = byBook.get(quote.bookmaker) ?? [];
    list.push(quote);
    byBook.set(quote.bookmaker, list);
  }

  const books: MatchOdds[] = [];
  for (const [bookmaker, list] of byBook) {
    const pick = (market: string, selection: string): number | undefined =>
      list.find((quote) => quote.market === market && quote.selection === selection)?.decimal;

    const home = pick('match_odds', 'home');
    const draw = pick('match_odds', 'draw');
    const away = pick('match_odds', 'away');
    if (home === undefined || draw === undefined || away === undefined) continue;

    const raw = [home, draw, away].map(impliedProbability);
    const fair = removeOverround(raw);
    const over = pick('over_under', 'over');
    const under = pick('over_under', 'under');
    const totals =
      over === undefined || under === undefined
        ? undefined
        : removeOverround([over, under].map(impliedProbability));

    books.push({
      bookmaker,
      home: fair[0] ?? 0,
      draw: fair[1] ?? 0,
      away: fair[2] ?? 0,
      margin: overround(raw),
      ...(totals === undefined ? {} : { over: totals[0] ?? 0, under: totals[1] ?? 0 }),
    });
  }

  if (books.length === 0) return null;
  // Named books first and alphabetical, so the list does not reorder between
  // two matches for no reason a reader can see.
  books.sort((a, b) => a.bookmaker.localeCompare(b.bookmaker));

  const mean = (pickValue: (book: MatchOdds) => number | undefined): number | null => {
    const values = books.map(pickValue).filter((value): value is number => value !== undefined);
    if (values.length === 0) return null;
    return values.reduce((total, value) => total + value, 0) / values.length;
  };

  const margins = books.map((book) => book.margin);
  return {
    books,
    consensus: {
      home: mean((book) => book.home) ?? 0,
      draw: mean((book) => book.draw) ?? 0,
      away: mean((book) => book.away) ?? 0,
      over: mean((book) => book.over),
    },
    count: books.length,
    marginLow: Math.min(...margins),
    marginHigh: Math.max(...margins),
  };
}

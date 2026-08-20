import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { oddsQuoteSchema, type OddsQuote } from '@fpl/core';
import { marketFor } from './market';

/**
 * The join is by club name and day rather than by id, so most of what can go
 * wrong here is a name. A wrong join would attribute one match's prices to
 * another and nothing on the page would show it, which is why the rule is
 * deliberately narrow and why these tests are mostly about what it refuses.
 */

const KICKOFF = new Date('2025-08-15T19:00:00Z');

function quote(overrides: Partial<OddsQuote> = {}): OddsQuote {
  return oddsQuoteSchema.parse({
    provider: 'football-data',
    bookmaker: 'Bet365',
    fixtureId: null,
    homeTeam: null,
    awayTeam: null,
    homeName: 'Liverpool',
    awayName: 'Bournemouth',
    kickoff: KICKOFF,
    market: 'match_odds',
    selection: 'home',
    decimal: 1.3,
    line: null,
    capturedAt: KICKOFF,
    ...overrides,
  });
}

/** One book's three prices on the match, plus the totals where asked for. */
function book(bookmaker: string, home: number, draw: number, away: number, totals = true) {
  const rows = [
    quote({ bookmaker, selection: 'home', decimal: home }),
    quote({ bookmaker, selection: 'draw', decimal: draw }),
    quote({ bookmaker, selection: 'away', decimal: away }),
  ];
  if (totals) {
    rows.push(
      quote({ bookmaker, market: 'over_under', selection: 'over', decimal: 1.8, line: 2.5 }),
      quote({ bookmaker, market: 'over_under', selection: 'under', decimal: 2.0, line: 2.5 }),
    );
  }
  return rows;
}

const match = { homeTeamName: 'Liverpool', awayTeamName: 'Bournemouth', kickoff: KICKOFF };

describe('marketFor', () => {
  it('strips the margin, so the three probabilities sum to one', () => {
    const view = marketFor(book('Bet365', 1.3, 6, 8.5), match);
    assert.ok(view !== null);
    const one = view.books[0];
    assert.ok(one !== undefined);
    assert.ok(Math.abs(one.home + one.draw + one.away - 1) < 1e-9);
    // 1/1.3 + 1/6 + 1/8.5 is about 1.061, so the book was charging about 6%.
    assert.ok(one.margin > 0.05 && one.margin < 0.07, `margin ${one.margin.toFixed(4)}`);
  });

  it('averages the books rather than taking one of them', () => {
    const view = marketFor(
      [...book('Bet365', 1.3, 6, 8.5), ...book('Pinnacle', 1.28, 6.56, 9.07)],
      match,
    );
    assert.ok(view !== null);
    assert.equal(view.count, 2);
    assert.ok(view.consensus !== null);
    const first = view.books[0];
    const second = view.books[1];
    assert.ok(first !== undefined && second !== undefined);
    assert.ok(Math.abs(view.consensus.home - (first.home + second.home) / 2) < 1e-9);
  });

  it('bridges the provider spellings that normalising alone does not', () => {
    const quotes = book('Bet365', 2.1, 3.4, 3.6).map((row) => ({
      ...row,
      homeName: 'Man United',
      awayName: "Nott'm Forest",
    }));
    const view = marketFor(quotes, {
      homeTeamName: 'Manchester United',
      awayTeamName: 'Nottingham Forest',
      kickoff: KICKOFF,
    });
    assert.ok(view !== null, 'Man United resolves to Manchester United');
  });

  it('refuses a different fixture on the same day', () => {
    const quotes = book('Bet365', 2.1, 3.4, 3.6).map((row) => ({
      ...row,
      homeName: 'Arsenal',
      awayName: 'Chelsea',
    }));
    assert.equal(marketFor(quotes, match), null);
  });

  it('refuses the same fixture a week later', () => {
    const later = book('Bet365', 2.1, 3.4, 3.6).map((row) => ({
      ...row,
      kickoff: new Date('2025-08-22T19:00:00Z'),
    }));
    assert.equal(marketFor(later, match), null);
  });

  it('accepts a kickoff moved within a day, since the provider files the date only', () => {
    const moved = book('Bet365', 2.1, 3.4, 3.6).map((row) => ({
      ...row,
      kickoff: new Date('2025-08-16T14:00:00Z'),
    }));
    assert.ok(marketFor(moved, match) !== null);
  });

  it('skips a book missing one of its three prices rather than mispricing it', () => {
    const partial = book('Bet365', 1.3, 6, 8.5).filter((row) => row.selection !== 'draw');
    assert.equal(marketFor(partial, match), null);
  });

  it('leaves the totals absent where the book did not price them', () => {
    const view = marketFor(book('Bet365', 1.3, 6, 8.5, false), match);
    assert.ok(view !== null);
    assert.equal(view.books[0]?.over, undefined);
    assert.equal(view.consensus?.over, null);
  });

  it('returns nothing where no price is stored at all', () => {
    assert.equal(marketFor([], match), null);
    assert.equal(marketFor(book('Bet365', 1.3, 6, 8.5), { ...match, kickoff: null }), null);
  });
});

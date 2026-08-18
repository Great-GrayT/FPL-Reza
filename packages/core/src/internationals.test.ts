import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { internationalSeasonSchema, internationalTotals } from './internationals.js';

const season = (overrides: Record<string, unknown> = {}) =>
  internationalSeasonSchema.parse({
    playerCode: 154561,
    provider: 'sofascore',
    country: 'England',
    tournament: 'FIFA World Cup',
    tournamentId: 16,
    season: '2022',
    seasonId: 41087,
    appearances: 4,
    minutes: 293,
    goals: 3,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    rating: 7.7,
    ...overrides,
  });

describe('internationalTotals', () => {
  it('sums caps and goals and counts distinct competitions', () => {
    const totals = internationalTotals([
      season(),
      season({ season: '2026', appearances: 6, goals: 1 }),
      season({ tournament: 'UEFA Nations League', tournamentId: 21, appearances: 5, goals: 2 }),
    ]);

    assert.equal(totals.caps, 15);
    assert.equal(totals.goals, 6);
    assert.equal(totals.tournaments, 2);
    assert.equal(totals.country, 'England');
  });

  it('treats an absent measure as nothing to add rather than failing', () => {
    const totals = internationalTotals([season({ appearances: null, goals: null, minutes: null })]);

    assert.equal(totals.caps, 0);
    assert.equal(totals.goals, 0);
    assert.equal(totals.minutes, 0);
  });

  it('reports no country for a player with no records', () => {
    const totals = internationalTotals([]);

    assert.equal(totals.country, null);
    assert.equal(totals.tournaments, 0);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gameweekSchema, isChangeable, planningWindow, type Gameweek } from './gameweek.js';

describe('where the reader stands in the season', () => {
  const week = (id: number, deadline: string, finished = false): Gameweek =>
    gameweekSchema.parse({
      id,
      name: `Gameweek ${String(id)}`,
      deadline,
      finished,
      isCurrent: false,
      isNext: false,
      averageEntryScore: 0,
      highestScore: null,
      mostCaptainedId: null,
      chipPlays: {},
    });

  const season = [
    week(1, '2026-08-14T17:30:00Z', true),
    week(2, '2026-08-21T17:30:00Z'),
    week(3, '2026-08-28T17:30:00Z'),
  ];

  it('opens the plan at the first gameweek that can still be changed', () => {
    // Between the gameweek 2 deadline and its last match: 2 is locked and a
    // plan starts at 3, because nothing about 2 can be entered any more.
    const window = planningWindow(season, new Date('2026-08-22T12:00:00Z'));
    assert.equal(Number(window.locked?.id), 2);
    assert.equal(Number(window.from?.id), 3);
    assert.deepEqual(
      window.played.map((entry) => Number(entry.id)),
      [1],
    );
  });

  it('opens at the gameweek itself while its deadline is still ahead', () => {
    const window = planningWindow(season, new Date('2026-08-20T09:00:00Z'));
    assert.equal(window.locked, null, 'nothing is locked before a deadline');
    assert.equal(Number(window.from?.id), 2);
  });

  it('reads the deadline, not the flag', () => {
    // FPL keeps a gameweek "current" from its deadline until the last match is
    // settled, which is the whole window a plan must not offer a transfer in.
    const flagged = season.map((entry) =>
      Number(entry.id) === 2 ? { ...entry, isCurrent: true } : entry,
    );
    assert.equal(Number(planningWindow(flagged, new Date('2026-08-20T09:00:00Z')).from?.id), 2);
  });

  it('has nowhere to plan once the season is over', () => {
    const over = season.map((entry) => ({ ...entry, finished: true }));
    const window = planningWindow(over, new Date('2026-09-30T00:00:00Z'));
    assert.equal(window.from, null);
    assert.equal(window.locked, null);
    assert.equal(window.played.length, 3);
  });

  it('answers whether one gameweek can still be changed', () => {
    const target = season[1];
    assert.ok(target !== undefined);
    assert.equal(isChangeable(target, new Date('2026-08-20T09:00:00Z')), true);
    assert.equal(isChangeable(target, new Date('2026-08-22T09:00:00Z')), false);
  });
});

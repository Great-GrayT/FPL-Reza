import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Position } from '@fpl/core';
import { selectionRecord, likelyStarters, type SelectionMatch } from './selection';

/**
 * A club's last six league matches, newest first, with a settled eleven of
 * players 1 to 11 and a rotated cup side of 20 to 30.
 */
const settled = (over: Partial<SelectionMatch> = {}): SelectionMatch => ({
  kickoff: new Date('2026-09-12T14:00:00Z'),
  competitionId: 1,
  started: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  benched: [12, 13, 14],
  formation: '4-3-3',
  roles: new Map(),
  names: new Map(),
  ...over,
});

const league = (weeksAgo: number, started: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) =>
  settled({
    kickoff: new Date(Date.UTC(2026, 8, 12 - weeksAgo * 7)),
    started,
  });

describe('the selection record', () => {
  it('counts starts over the window, not the newest match alone', () => {
    const record = selectionRecord([league(0), league(1), league(2)], 1);
    assert.equal(record.matches, 3);
    assert.equal(record.players.get(1)?.starts, 3);
    assert.equal(record.players.get(1)?.startShare, 1);
  });

  it('ignores a cup match when predicting a league eleven', () => {
    // The whole point: one rotated cup side must not rewrite the league team.
    const rotated = settled({
      competitionId: 5,
      kickoff: new Date('2026-09-15T18:45:00Z'),
      started: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    });
    const record = selectionRecord([rotated, league(0), league(1)], 1);
    assert.equal(record.matches, 2, 'only the league matches count');
    assert.equal(record.players.get(20)?.starts ?? 0, 0, 'the cup eleven is not the league eleven');
    assert.equal(record.players.get(1)?.startShare, 1);
  });

  it('weighs a recent start above an old one', () => {
    // Started the two most recent, missed the two before: worth more than the
    // reverse, because a team sheet is a statement about now.
    const recent = selectionRecord([league(0), league(1), league(2, [99]), league(3, [99])], 1);
    const old = selectionRecord([league(0, [99]), league(1, [99]), league(2), league(3)], 1);
    assert.ok(
      (recent.players.get(1)?.weight ?? 0) > (old.players.get(1)?.weight ?? 0),
      'recency has to matter or a dropped player never leaves the eleven',
    );
  });

  it('takes the modal formation rather than the last one', () => {
    const record = selectionRecord(
      [
        settled({ formation: '3-4-3', kickoff: new Date('2026-09-12T14:00:00Z') }),
        settled({ formation: '4-3-3', kickoff: new Date('2026-09-05T14:00:00Z') }),
        settled({ formation: '4-3-3', kickoff: new Date('2026-08-29T14:00:00Z') }),
      ],
      1,
    );
    assert.equal(record.formation, '4-3-3');
  });
});

describe('the likely eleven', () => {
  const available = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 99]);

  it('picks the settled eleven when nothing has changed', () => {
    const record = selectionRecord([league(0), league(1), league(2)], 1);
    const eleven = likelyStarters(record, {
      isAvailable: (code) => available.has(code),
      positionOf: (code) => (code === 1 ? 'GKP' : code <= 5 ? 'DEF' : code <= 9 ? 'MID' : 'FWD'),
      pool: [...available],
    });
    assert.equal(eleven.starters.length, 11);
    assert.deepEqual(
      [...eleven.starters].sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    );
  });

  it('drops a player who is out, and says who replaced him', () => {
    const record = selectionRecord([league(0), league(1), league(2)], 1);
    const eleven = likelyStarters(record, {
      isAvailable: (code) => code !== 9 && available.has(code),
      positionOf: (code) => (code === 1 ? 'GKP' : code <= 5 ? 'DEF' : code <= 9 ? 'MID' : 'FWD'),
      pool: [...available],
    });
    assert.ok(!eleven.starters.includes(9));
    assert.equal(eleven.starters.length, 11);
    assert.ok(eleven.changes.some((change) => change.out === 9));
  });

  it('always names exactly one goalkeeper', () => {
    const record = selectionRecord([league(0), league(1)], 1);
    const eleven = likelyStarters(record, {
      isAvailable: () => true,
      // Two keepers in the recent eleven, which a rotated cup week can produce.
      positionOf: (code) =>
        code === 1 || code === 2 ? 'GKP' : code <= 5 ? 'DEF' : code <= 9 ? 'MID' : 'FWD',
      pool: [...available],
    });
    const keepers = eleven.starters.filter((code) => code === 1 || code === 2);
    assert.equal(keepers.length, 1, 'a team sheet with two keepers is not a team sheet');
  });

  it('falls back to the pool when nothing was ever started', () => {
    const record = selectionRecord([], 1);
    const eleven = likelyStarters(record, {
      isAvailable: () => true,
      positionOf: (code) => (code === 1 ? 'GKP' : code <= 5 ? 'DEF' : code <= 9 ? 'MID' : 'FWD'),
      pool: [...available],
      minutesOf: (code) => 1000 - code,
    });
    assert.equal(eleven.starters.length, 11);
    assert.equal(eleven.confidence, null, 'no record means no measurement, and it says so');
  });

  it('reports how settled the eleven is', () => {
    const settledRecord = selectionRecord([league(0), league(1), league(2), league(3)], 1);
    const rotatedRecord = selectionRecord(
      [
        league(0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
        league(1, [1, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]),
        league(2, [1, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39]),
      ],
      1,
    );
    const options = {
      isAvailable: () => true,
      positionOf: (code: number): Position =>
        code === 1 ? 'GKP' : code <= 5 ? 'DEF' : code <= 9 ? 'MID' : 'FWD',
      pool: Array.from({ length: 40 }, (_, i) => i + 1),
    };
    const settledConfidence = likelyStarters(settledRecord, options).confidence ?? 0;
    const rotatedConfidence = likelyStarters(rotatedRecord, options).confidence ?? 0;
    assert.ok(
      settledConfidence > rotatedConfidence,
      'a club that names the same eleven every week is more predictable, and the number should say so',
    );
  });
});

describe('what the review caught', () => {
  const positionOf = (code: number): Position =>
    code === 1 || code === 2 ? 'GKP' : code <= 7 ? 'DEF' : code <= 13 ? 'MID' : 'FWD';

  it('names a legal shape even with no record at all', () => {
    // A promoted club in gameweek 1: no stored league teamsheets, so every
    // score is zero and the sort is a no-op. Without a quota the eleven was
    // simply the first ten codes in the pool, which can be seven defenders and
    // no forward.
    const eleven = likelyStarters(selectionRecord([], 1), {
      isAvailable: () => true,
      positionOf,
      pool: Array.from({ length: 20 }, (_, index) => index + 1),
    });
    const shape = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const code of eleven.starters) shape[positionOf(code)] += 1;
    assert.equal(shape.GKP, 1);
    assert.ok(shape.DEF >= 3 && shape.DEF <= 5, `defenders: ${String(shape.DEF)}`);
    assert.ok(shape.FWD >= 1, 'an eleven with no forward is not an eleven');
    assert.equal(eleven.starters.length, 11);
  });

  it('replaces a player with someone of his own position', () => {
    // Paired by array index, an injured keeper and an injured striker were
    // reported crossed over: "Backup Keeper for Striker: injured".
    const history = [
      {
        kickoff: new Date('2026-09-12T14:00:00Z'),
        competitionId: 1,
        started: [1, 3, 4, 5, 6, 8, 9, 10, 11, 14, 15],
        benched: [2, 16],
        formation: '4-3-3',
        roles: new Map<number, string>(),
        names: new Map<number, string>(),
      },
    ];
    const eleven = likelyStarters(selectionRecord(history, 1), {
      // The keeper and one forward are both out.
      isAvailable: (code) => code !== 1 && code !== 14,
      positionOf,
      pool: Array.from({ length: 20 }, (_, index) => index + 1),
    });
    for (const change of eleven.changes) {
      if (change.in === null) continue;
      assert.equal(
        positionOf(change.in),
        positionOf(change.out),
        `${String(change.in)} cannot replace ${String(change.out)}`,
      );
    }
    // And a player who is out is always reported, replacement or not.
    assert.ok(eleven.changes.some((change) => change.out === 1));
  });

  it('says nothing about how settled a club is from one match', () => {
    // One match gives no pair to compare, so stability was 0 and the page
    // printed "this club rotates heavily" from an absence of evidence.
    const one = selectionRecord(
      [
        {
          kickoff: new Date('2026-09-12T14:00:00Z'),
          competitionId: 1,
          started: [1, 3, 4, 5, 6, 8, 9, 10, 11, 14, 15],
          benched: [],
          formation: '4-3-3',
          roles: new Map<number, string>(),
          names: new Map<number, string>(),
        },
      ],
      1,
    );
    assert.equal(one.stability, null, 'one match is not a measurement of stability');
    assert.equal(
      likelyStarters(one, {
        isAvailable: () => true,
        positionOf,
        pool: [1, 3, 4, 5, 6, 8, 9, 10, 11, 14, 15],
      }).confidence,
      null,
    );
  });
});

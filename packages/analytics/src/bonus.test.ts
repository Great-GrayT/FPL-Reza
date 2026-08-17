import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asPlayerId } from '@fpl/core';
import { predictBonus } from './bonus.js';

const p = (n: number) => asPlayerId(n);

describe('predictBonus', () => {
  it('awards 3, 2, 1 with no ties', () => {
    const result = predictBonus([
      { playerId: p(1), bps: 40 },
      { playerId: p(2), bps: 30 },
      { playerId: p(3), bps: 20 },
      { playerId: p(4), bps: 10 },
    ]);
    assert.equal(result.find((r) => r.playerId === p(1))?.bonus, 3);
    assert.equal(result.find((r) => r.playerId === p(2))?.bonus, 2);
    assert.equal(result.find((r) => r.playerId === p(3))?.bonus, 1);
    assert.equal(result.find((r) => r.playerId === p(4))?.bonus, 0);
  });

  it('gives every tied player 3 for a tie at first, and skips the 2 entirely', () => {
    const result = predictBonus([
      { playerId: p(1), bps: 40 },
      { playerId: p(2), bps: 40 },
      { playerId: p(3), bps: 30 },
      { playerId: p(4), bps: 10 },
    ]);
    assert.equal(result.find((r) => r.playerId === p(1))?.bonus, 3);
    assert.equal(result.find((r) => r.playerId === p(2))?.bonus, 3);
    assert.equal(result.find((r) => r.playerId === p(3))?.bonus, 1);
    assert.equal(result.find((r) => r.playerId === p(4))?.bonus, 0);
  });

  it('gives both players 2 for a tie at second, and awards no 1', () => {
    const result = predictBonus([
      { playerId: p(1), bps: 40 },
      { playerId: p(2), bps: 30 },
      { playerId: p(3), bps: 30 },
      { playerId: p(4), bps: 10 },
    ]);
    assert.equal(result.find((r) => r.playerId === p(1))?.bonus, 3);
    assert.equal(result.find((r) => r.playerId === p(2))?.bonus, 2);
    assert.equal(result.find((r) => r.playerId === p(3))?.bonus, 2);
    assert.equal(result.find((r) => r.playerId === p(4))?.bonus, 0);
  });

  it('gives every tied player 1 for a tie at third', () => {
    const result = predictBonus([
      { playerId: p(1), bps: 40 },
      { playerId: p(2), bps: 30 },
      { playerId: p(3), bps: 20 },
      { playerId: p(4), bps: 20 },
      { playerId: p(5), bps: 10 },
    ]);
    assert.equal(result.find((r) => r.playerId === p(1))?.bonus, 3);
    assert.equal(result.find((r) => r.playerId === p(2))?.bonus, 2);
    assert.equal(result.find((r) => r.playerId === p(3))?.bonus, 1);
    assert.equal(result.find((r) => r.playerId === p(4))?.bonus, 1);
    assert.equal(result.find((r) => r.playerId === p(5))?.bonus, 0);
  });

  it('handles a three way tie for first: all get 3, nobody else scores', () => {
    const result = predictBonus([
      { playerId: p(1), bps: 40 },
      { playerId: p(2), bps: 40 },
      { playerId: p(3), bps: 40 },
      { playerId: p(4), bps: 20 },
    ]);
    assert.equal(result.find((r) => r.playerId === p(1))?.bonus, 3);
    assert.equal(result.find((r) => r.playerId === p(2))?.bonus, 3);
    assert.equal(result.find((r) => r.playerId === p(3))?.bonus, 3);
    assert.equal(result.find((r) => r.playerId === p(4))?.bonus, 0);
  });

  it('handles everyone tied on the same score: all get 3', () => {
    const result = predictBonus([
      { playerId: p(1), bps: 15 },
      { playerId: p(2), bps: 15 },
    ]);
    assert.equal(result.find((r) => r.playerId === p(1))?.bonus, 3);
    assert.equal(result.find((r) => r.playerId === p(2))?.bonus, 3);
  });

  it('preserves the input order in the output regardless of BPS order', () => {
    const result = predictBonus([
      { playerId: p(3), bps: 10 },
      { playerId: p(1), bps: 40 },
      { playerId: p(2), bps: 20 },
    ]);
    assert.deepEqual(
      result.map((r) => r.playerId),
      [p(3), p(1), p(2)],
    );
  });

  it('returns an empty list for an empty fixture', () => {
    assert.deepEqual(predictBonus([]), []);
  });
});

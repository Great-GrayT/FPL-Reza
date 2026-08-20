import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  StrategyCodeError,
  decodeStrategy,
  encodeStrategy,
  poolFingerprint,
  type Strategy,
} from './code.js';

/**
 * A code is read by people and typed by people, so most of these tests are
 * about what a wrong one does. Refusing a mistyped code loudly is the whole
 * point of the checksum: silently solving a different strategy would be worse
 * than refusing, because nothing on screen would say so.
 */

const strategy: Strategy = {
  version: 1,
  startGameweek: 3,
  horizon: 8,
  budget: 1000,
  riskAversion: 0,
  freeTransfers: 1,
  chips: [],
  keep: [],
  seed: 7,
  fingerprint: 'ABC123',
};

describe('strategy codes', () => {
  it('round trips a plain strategy', () => {
    const code = encodeStrategy(strategy);
    assert.deepEqual(decodeStrategy(code), strategy);
  });

  it('round trips chips, kept players, and a negative risk', () => {
    const full: Strategy = {
      ...strategy,
      riskAversion: -10,
      chips: ['bench_boost', 'triple_captain'],
      keep: [231416, 118748, 4],
      freeTransfers: 5,
      seed: 4294967,
    };
    const decoded = decodeStrategy(encodeStrategy(full));
    assert.equal(decoded.riskAversion, -10);
    assert.deepEqual(decoded.chips, ['bench_boost', 'triple_captain']);
    assert.deepEqual(decoded.keep, [4, 118748, 231416]);
    assert.equal(decoded.freeTransfers, 5);
    assert.equal(decoded.seed, 4294967);
  });

  it('sorts kept players, so the same squad is the same code', () => {
    const one = encodeStrategy({ ...strategy, keep: [9, 3, 7] });
    const other = encodeStrategy({ ...strategy, keep: [7, 9, 3] });
    assert.equal(one, other);
  });

  it('reads back a code typed in lower case with spaces around it', () => {
    const code = encodeStrategy(strategy);
    assert.deepEqual(decodeStrategy(`  ${code.toLowerCase()} `), strategy);
  });

  it('stays legible', () => {
    const code = encodeStrategy(strategy);
    assert.match(code, /^FPL1-G3-H8-B/);
    assert.ok(code.length < 60, `a code a person reads out is short: ${code}`);
  });

  it('refuses a code with a mistyped character', () => {
    const code = encodeStrategy(strategy);
    // Change the horizon from 8 to 9 and leave the checksum alone.
    const wrong = code.replace('-H8-', '-H9-');
    assert.throws(() => decodeStrategy(wrong), StrategyCodeError);
  });

  it('refuses a code with no checksum', () => {
    assert.throws(() => decodeStrategy('FPL1-G3-H8-B1000-R0-T1-S7-LABC123'), StrategyCodeError);
  });

  it('refuses something that is not a code at all', () => {
    assert.throws(() => decodeStrategy(''), StrategyCodeError);
    assert.throws(() => decodeStrategy('hello'), StrategyCodeError);
  });

  it('refuses a version it does not read, and says which', () => {
    const code = encodeStrategy({ ...strategy, version: 9 });
    assert.throws(() => decodeStrategy(code), /version 9/);
  });

  it('names the missing part rather than failing generically', () => {
    // A valid checksum over a body missing the budget.
    const body = 'FPL1-G3-H8-R0-T1-S7-LABC123';
    const code = encodeStrategy(strategy);
    const check = code.slice(code.lastIndexOf('-X'));
    assert.throws(
      () => decodeStrategy(`${body}${check}`),
      // The checksum fails first, which is correct: a body that lost a segment
      // is a corrupted code, not a code with an optional field left out.
      StrategyCodeError,
    );
  });
});

describe('poolFingerprint', () => {
  interface Row {
    code: number;
    price: number;
    projections: number[];
  }
  const first: Row = { code: 1, price: 50, projections: [4.2, 3.1] };
  const second: Row = { code: 2, price: 120, projections: [7.7, 6.9] };
  const pool: Row[] = [first, second];

  it('is stable for the same pool', () => {
    assert.equal(poolFingerprint(pool), poolFingerprint([...pool]));
  });

  it('changes when a price moves', () => {
    assert.notEqual(poolFingerprint(pool), poolFingerprint([first, { ...second, price: 121 }]));
  });

  it('changes when a projection moves', () => {
    assert.notEqual(
      poolFingerprint(pool),
      poolFingerprint([first, { ...second, projections: [7.7, 5.0] }]),
    );
  });

  it('changes when a player leaves the pool', () => {
    assert.notEqual(poolFingerprint(pool), poolFingerprint(pool.slice(0, 1)));
  });

  it('ignores a change too small to be a change', () => {
    const jittered = pool.map((entry) => ({
      ...entry,
      projections: entry.projections.map((value) => value + 0.004),
    }));
    assert.equal(poolFingerprint(pool), poolFingerprint(jittered));
  });
});

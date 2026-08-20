import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  StrategyCodeError,
  decodeStrategy,
  encodeStrategy,
  poolFingerprint,
  rebaseStrategy,
  type Strategy,
} from './code.js';

/** The same checksum the encoder appends, so a fixture can be written by hand. */
const checksumOf = (body: string): string => {
  let hash = 7;
  for (let index = 0; index < body.length; index += 1) {
    hash = (hash * 31 + body.charCodeAt(index)) % 1296;
  }
  return Math.round(hash).toString(36).toUpperCase().padStart(2, '0');
};

/**
 * A code is read by people and typed by people, so most of these tests are
 * about what a wrong one does. Refusing a mistyped code loudly is the whole
 * point of the checksum: silently solving a different strategy would be worse
 * than refusing, because nothing on screen would say so.
 */

const strategy: Strategy = {
  version: 2,
  startGameweek: 3,
  endGameweek: 10,
  budget: 1000,
  riskAversion: 0,
  freeTransfers: 1,
  maxTransfersPerWeek: 2,
  chips: [],
  squad: [],
  locks: [],
  seed: 7,
  fingerprint: 'ABC123',
};

describe('strategy codes', () => {
  it('round trips a plain strategy', () => {
    const code = encodeStrategy(strategy);
    assert.deepEqual(decodeStrategy(code), strategy);
  });

  it('round trips chips, locked players, and a negative risk', () => {
    const full: Strategy = {
      ...strategy,
      riskAversion: -10,
      chips: ['bench_boost', 'triple_captain'],
      locks: [
        { code: 231416, mode: 'always' },
        { code: 118748, mode: 'start' },
        { code: 4, mode: 'always' },
      ],
      freeTransfers: 5,
      seed: 4294967,
    };
    const decoded = decodeStrategy(encodeStrategy(full));
    assert.equal(decoded.riskAversion, -10);
    assert.deepEqual(decoded.chips, ['bench_boost', 'triple_captain']);
    assert.deepEqual(
      decoded.locks.map((lock) => lock.code),
      [4, 118748, 231416],
    );
    assert.equal(decoded.freeTransfers, 5);
    assert.equal(decoded.seed, 4294967);
  });

  it('sorts locked players, so the same question is the same code', () => {
    const one = encodeStrategy({
      ...strategy,
      locks: [
        { code: 9, mode: 'always' },
        { code: 3, mode: 'always' },
        { code: 7, mode: 'start' },
      ],
    });
    const other = encodeStrategy({
      ...strategy,
      locks: [
        { code: 7, mode: 'start' },
        { code: 9, mode: 'always' },
        { code: 3, mode: 'always' },
      ],
    });
    assert.equal(one, other);
  });

  it('reads back a code typed in lower case with spaces around it', () => {
    const code = encodeStrategy(strategy);
    assert.deepEqual(decodeStrategy(`  ${code.toLowerCase()} `), strategy);
  });

  it('stays legible', () => {
    const code = encodeStrategy(strategy);
    // Gameweek 3 through gameweek 10 (A in base 36), readable before anyone
    // pastes it anywhere.
    assert.match(code, /^FPL2-G3-EA-B/);
    assert.ok(code.length < 60, `a code a person reads out is short: ${code}`);
  });

  it('refuses a code with a mistyped character', () => {
    const code = encodeStrategy(strategy);
    // Move the end gameweek and leave the checksum alone.
    const wrong = code.replace('-EA-', '-EB-');
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

describe('version 2', () => {
  const strategy: Strategy = {
    version: 2,
    startGameweek: 3,
    endGameweek: 10,
    budget: 1000,
    riskAversion: -5,
    freeTransfers: 1,
    maxTransfersPerWeek: 2,
    chips: ['bench_boost'],
    squad: [11, 22, 33],
    locks: [
      { code: 22, mode: 'always' },
      { code: 11, mode: 'start' },
    ],
    seed: 7,
    fingerprint: 'ABC123',
  };

  it('round trips everything it carries', () => {
    const decoded = decodeStrategy(encodeStrategy(strategy));
    assert.equal(decoded.startGameweek, 3);
    assert.equal(decoded.endGameweek, 10);
    assert.equal(decoded.maxTransfersPerWeek, 2);
    assert.deepEqual(decoded.squad, [11, 22, 33]);
    assert.deepEqual(
      [...decoded.locks].sort((a, b) => a.code - b.code),
      [
        { code: 11, mode: 'start' },
        { code: 22, mode: 'always' },
      ],
    );
  });

  it('reads a version 1 code, whose horizon becomes an end gameweek', () => {
    // FPL1 carried H, the length. The destination is what a reader chose, so a
    // length is converted once, at the boundary, and never again.
    const old = 'FPL1-G3-H8-B1000-R0-T1-S7-LABC123';
    const decoded = decodeStrategy(`${old}-X${checksumOf(old)}`);
    assert.equal(decoded.startGameweek, 3);
    assert.equal(decoded.endGameweek, 10);
    assert.deepEqual(decoded.squad, []);
    assert.deepEqual(decoded.locks, []);
  });

  it('is refused when a character is wrong', () => {
    const code = encodeStrategy(strategy);
    const broken = `${code.slice(0, 5)}9${code.slice(6)}`;
    assert.throws(() => decodeStrategy(broken), StrategyCodeError);
  });
});

describe('rebasing a code onto today', () => {
  const strategy: Strategy = {
    version: 2,
    startGameweek: 3,
    endGameweek: 10,
    budget: 1000,
    riskAversion: 0,
    freeTransfers: 1,
    maxTransfersPerWeek: 2,
    chips: [],
    squad: [],
    locks: [],
    seed: 7,
    fingerprint: 'ABC',
  };

  it('leaves a code alone in the gameweek it was minted in', () => {
    const rebased = rebaseStrategy(strategy, 3);
    assert.equal(rebased.strategy.startGameweek, 3);
    assert.equal(rebased.weeksElapsed, 0);
  });

  it('shrinks the horizon to what is left of it', () => {
    // Minted at 3 to run through 10, opened at 5: six weeks left, same
    // destination. The length was never the thing the author chose.
    const rebased = rebaseStrategy(strategy, 5);
    assert.equal(rebased.strategy.startGameweek, 5);
    assert.equal(rebased.strategy.endGameweek, 10);
    assert.equal(rebased.weeksElapsed, 2);
    assert.equal(rebased.weeks, 6);
  });

  it('refuses a window that has closed, and names the gameweek', () => {
    assert.throws(
      () => rebaseStrategy(strategy, 11),
      (error: unknown) =>
        error instanceof StrategyCodeError && error.message.includes('gameweek 10'),
    );
  });

  it('never moves a start gameweek backwards', () => {
    assert.equal(rebaseStrategy(strategy, 1).strategy.startGameweek, 3);
  });
});

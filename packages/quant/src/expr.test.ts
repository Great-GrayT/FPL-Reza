import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExpressionError, compute, evaluateMask, parse, referencedColumns } from './expr.js';
import { Frame } from './frame.js';

const frame = Frame.fromRows([
  { player: 'Salah', position: 'MID', gameweek: 1, points: 12, minutes: 90, price: 125 },
  { player: 'Salah', position: 'MID', gameweek: 2, points: 2, minutes: 90, price: 126 },
  { player: 'Salah', position: 'MID', gameweek: 3, points: 9, minutes: 45, price: 126 },
  { player: 'Trent', position: 'DEF', gameweek: 1, points: 6, minutes: 90, price: 70 },
  { player: 'Trent', position: 'DEF', gameweek: 2, points: null, minutes: 0, price: 70 },
  { player: 'Trent', position: 'DEF', gameweek: 3, points: 14, minutes: 90, price: 71 },
]);

const partitions = [
  [0, 1, 2],
  [3, 4, 5],
];

describe('expression parsing', () => {
  it('respects arithmetic precedence and associativity', () => {
    const values = compute('1 + 2 * 3 ^ 2', { frame });
    assert.equal(values[0], 19);
    assert.equal(compute('2 ^ 3 ^ 2', { frame })[0], 512);
    assert.equal(compute('(1 + 2) * 3', { frame })[0], 9);
  });

  it('reads columns by name', () => {
    const values = compute('points * 2', { frame });
    assert.equal(values[0], 24);
    assert.ok(Number.isNaN(values[4] ?? 0));
  });

  it('names the columns a formula reads', () => {
    assert.deepEqual(referencedColumns(parse('points / minutes + price')).sort(), [
      'minutes',
      'points',
      'price',
    ]);
  });

  it('refuses an unknown column and suggests the closest name', () => {
    assert.throws(
      () => compute('pointz + 1', { frame }),
      (error: unknown) =>
        error instanceof ExpressionError && error.message.includes('did you mean "points"'),
    );
  });

  it('refuses an unknown function', () => {
    assert.throws(() => compute('sqrtt(points)', { frame }), ExpressionError);
  });

  it('reports the position of a syntax error', () => {
    try {
      compute('points +', { frame });
      assert.fail('should have thrown');
    } catch (error) {
      assert.ok(error instanceof ExpressionError);
      assert.ok(error.position >= 7);
    }
  });
});

describe('expression evaluation', () => {
  it('compares a string column against a literal', () => {
    const mask = evaluateMask(parse('position == "MID"'), { frame });
    assert.deepEqual(Array.from(mask), [1, 1, 1, 0, 0, 0]);
  });

  it('combines conditions', () => {
    const mask = evaluateMask(parse('minutes >= 60 && points > 5'), { frame });
    assert.deepEqual(Array.from(mask), [1, 0, 0, 1, 0, 1]);
  });

  it('treats division by zero as missing rather than infinite', () => {
    const values = compute('points / minutes', { frame });
    assert.ok(Number.isNaN(values[4] ?? 0));
  });

  it('scales to ninety minutes safely', () => {
    const values = compute('per90(points, minutes)', { frame });
    assert.equal(values[0], 12);
    assert.equal(values[2], 18);
    assert.ok(Number.isNaN(values[4] ?? 0));
  });

  it('evaluates a conditional both ways', () => {
    assert.deepEqual(Array.from(compute('minutes >= 60 ? 1 : 0', { frame })), [1, 1, 0, 1, 0, 1]);
    assert.deepEqual(Array.from(compute('if(minutes >= 60, 1, 0)', { frame })), [1, 1, 0, 1, 0, 1]);
  });

  it('fills a missing value with coalesce', () => {
    assert.equal(compute('coalesce(points, 0)', { frame })[4], 0);
  });

  it('standardises a column to zero mean', () => {
    const values = Array.from(compute('zscore(price)', { frame })).filter((value) =>
      Number.isFinite(value),
    );
    const total = values.reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total) < 1e-9);
  });

  it('ranks within the view', () => {
    const ranks = compute('rank(points)', { frame });
    assert.equal(ranks[5], 5);
    assert.ok(Number.isNaN(ranks[4] ?? 0));
  });

  it('shifts within a partition, never across one', () => {
    const lagged = compute('lag(points, 1)', { frame, partitions });
    assert.ok(Number.isNaN(lagged[0] ?? 0), 'the first row of a partition has nothing behind it');
    assert.equal(lagged[1], 12);
    assert.ok(Number.isNaN(lagged[3] ?? 0), 'the second player must not read the first');
  });

  it('rolls a window within a partition', () => {
    const rolled = compute('rolling_mean(points, 2)', { frame, partitions });
    assert.ok(Number.isNaN(rolled[0] ?? 0));
    assert.equal(rolled[1], 7);
    assert.equal(rolled[2], 5.5);
    assert.ok(Number.isNaN(rolled[3] ?? 0));
  });

  it('accumulates within a partition', () => {
    const total = compute('cumsum(points)', { frame, partitions });
    assert.equal(total[2], 23);
    assert.equal(total[5], 20);
  });

  it('weights by half life', () => {
    const weighted = compute('ewma(points, 1)', { frame, partitions });
    assert.equal(weighted[0], 12);
    assert.equal(weighted[1], 7);
  });
});

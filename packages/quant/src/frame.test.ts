import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Frame, pivot } from './frame.js';

const rows = [
  { player: 'Salah', position: 'MID', gameweek: 1, points: 12, minutes: 90, xg: 0.7 },
  { player: 'Salah', position: 'MID', gameweek: 2, points: 2, minutes: 90, xg: 0.2 },
  { player: 'Haaland', position: 'FWD', gameweek: 1, points: 8, minutes: 88, xg: 1.1 },
  { player: 'Haaland', position: 'FWD', gameweek: 2, points: 15, minutes: 90, xg: 0.9 },
  { player: 'Trent', position: 'DEF', gameweek: 1, points: 6, minutes: 90, xg: null },
  { player: 'Trent', position: 'DEF', gameweek: 2, points: null, minutes: 0, xg: null },
];

describe('frame', () => {
  it('infers columns and keeps nulls null', () => {
    const frame = Frame.fromRows(rows);
    assert.equal(frame.length, 6);
    assert.equal(frame.kindOf('player'), 'string');
    assert.equal(frame.kindOf('points'), 'number');
    const points = frame.values('points');
    assert.ok(Number.isNaN(points[5] ?? 0), 'a null must not become zero');
    assert.equal(frame.summary('points').missing, 1);
    assert.equal(frame.summary('points').count, 5);
  });

  it('filters into a view without copying the data', () => {
    const frame = Frame.fromRows(rows);
    const midfielders = frame.filter((i) => frame.strings('position')[i] === 'MID');
    assert.equal(midfielders.length, 2);
    assert.deepEqual(midfielders.strings('player'), ['Salah', 'Salah']);
    // The parent is untouched by the filter.
    assert.equal(frame.length, 6);
  });

  it('sorts with missing values last in both directions', () => {
    const frame = Frame.fromRows(rows);
    const descending = frame.sortBy('points', 'desc');
    assert.equal(descending.strings('player')[0], 'Haaland');
    assert.equal(descending.strings('player')[5], 'Trent');
    const ascending = frame.sortBy('points', 'asc');
    assert.equal(ascending.strings('player')[5], 'Trent');
  });

  it('aggregates by group', () => {
    const frame = Frame.fromRows(rows);
    const totals = frame
      .groupBy(['player'])
      .agg([
        { column: 'points', aggregation: 'sum', as: 'total' },
        { column: 'points', aggregation: 'mean', as: 'average' },
        { column: 'minutes', aggregation: 'max', as: 'peakMinutes' },
      ])
      .sortBy('total', 'desc');
    assert.equal(totals.length, 3);
    assert.equal(totals.strings('player')[0], 'Haaland');
    assert.equal(totals.values('total')[0], 23);
    assert.equal(totals.values('average')[0], 11.5);
    // Trent's null gameweek is excluded from the mean rather than counted as zero.
    const trent = totals.filter((i) => totals.strings('player')[i] === 'Trent');
    assert.equal(trent.values('average')[0], 6);
    assert.equal(trent.values('count')[0], 2);
  });

  it('adds a derived column in view order', () => {
    const frame = Frame.fromRows(rows);
    const withRate = frame.withColumn(
      'perMinute',
      Array.from(frame.values('points')).map((points, i) => {
        const minutes = frame.values('minutes')[i] ?? 0;
        return minutes > 0 ? points / minutes : Number.NaN;
      }),
    );
    assert.ok(withRate.has('perMinute'));
    assert.equal(withRate.values('perMinute')[0], 12 / 90);
  });

  it('joins on one key', () => {
    const frame = Frame.fromRows(rows);
    const clubs = Frame.fromRows([
      { player: 'Salah', club: 'Liverpool' },
      { player: 'Haaland', club: 'Man City' },
    ]);
    const joined = frame.join(clubs, 'player');
    assert.equal(joined.length, 4);
    assert.ok(joined.has('club'));
    assert.equal(joined.strings('club')[0], 'Liverpool');
  });

  it('crosstabs rows against columns', () => {
    const frame = Frame.fromRows(rows);
    const table = pivot(frame, 'position', 'gameweek', 'points', 'mean');
    assert.deepEqual(table.rows, ['DEF', 'FWD', 'MID']);
    assert.deepEqual(table.columns, ['1', '2']);
    assert.equal(table.values[1]?.[1], 15);
    // A cell with no measured value is NaN, not zero.
    assert.ok(Number.isNaN(table.values[0]?.[1] ?? 0));
  });

  it('lists distinct labels for a filter menu', () => {
    assert.deepEqual(Frame.fromRows(rows).distinct('position'), ['DEF', 'FWD', 'MID']);
  });

  it('materialises only the rows a table shows', () => {
    const frame = Frame.fromRows(rows);
    const page = frame.head(2).toRows();
    assert.equal(page.length, 2);
    assert.equal(page[0]?.['player'], 'Salah');
    assert.equal(page[0]?.['points'], 12);
  });
});

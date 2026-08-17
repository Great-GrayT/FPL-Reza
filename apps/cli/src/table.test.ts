import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderTable } from './table.js';

describe('renderTable', () => {
  it('pads every column to its widest cell, header included', () => {
    const output = renderTable({
      columns: ['name', 'points'],
      rows: [
        ['Salah', '120'],
        ['Haaland', '95'],
      ],
    });

    assert.deepEqual(output.split('\n'), [
      'name     points',
      '-'.repeat(7) + '  ' + '-'.repeat(6),
      'Salah    120',
      'Haaland  95',
    ]);
  });

  it('renders a placeholder line for an empty row set instead of throwing', () => {
    const output = renderTable({ columns: ['a', 'b'], rows: [] });

    assert.deepEqual(output.split('\n'), [
      'a  b',
      '-'.repeat(1) + '  ' + '-'.repeat(1),
      '(no rows)',
    ]);
  });

  it('widens a column past its header when a cell value overflows it', () => {
    const long = 'a-very-long-identifier';
    const output = renderTable({ columns: ['id'], rows: [[long]] });
    const lines = output.split('\n');

    assert.equal(lines[0], 'id');
    assert.equal(lines[1], '-'.repeat(long.length));
    assert.equal(lines[2], long);
  });
});

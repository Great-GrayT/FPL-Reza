import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SQUAD_QUOTA, SQUAD_SIZE, STARTING_XI_SIZE, XI_MAX, XI_MIN } from './rules.js';
import { POSITIONS } from './position.js';

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

describe('squad rules', () => {
  it('quota fills the squad exactly', () => {
    assert.equal(sum(POSITIONS.map((position) => SQUAD_QUOTA[position])), SQUAD_SIZE);
  });

  it('formation bounds can produce a legal XI', () => {
    const minTotal = sum(POSITIONS.map((position) => XI_MIN[position]));
    const maxTotal = sum(POSITIONS.map((position) => XI_MAX[position]));
    assert.ok(minTotal <= STARTING_XI_SIZE, `min ${minTotal} exceeds XI size`);
    assert.ok(maxTotal >= STARTING_XI_SIZE, `max ${maxTotal} below XI size`);
  });

  it('never allows more of a position than the squad holds', () => {
    for (const position of POSITIONS) {
      assert.ok(XI_MAX[position] <= SQUAD_QUOTA[position], `${position} XI max exceeds quota`);
    }
  });
});

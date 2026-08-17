import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { POSITIONS, elementTypeFromPosition, positionFromElementType } from './position.js';
import { ValidationError } from './errors.js';

describe('position', () => {
  it('maps every element_type to a position', () => {
    assert.equal(positionFromElementType(1), 'GKP');
    assert.equal(positionFromElementType(4), 'FWD');
  });

  it('round trips position and element_type', () => {
    for (const position of POSITIONS) {
      assert.equal(positionFromElementType(elementTypeFromPosition(position)), position);
    }
  });

  it('rejects an unknown element_type', () => {
    assert.throws(() => positionFromElementType(9), ValidationError);
  });
});

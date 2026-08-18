import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isInternationalCategory } from './source.js';

describe('isInternationalCategory', () => {
  // The provider files club friendlies (the Emirates Cup, for one) under a
  // category whose name looks international, so the flag is the only signal
  // worth trusting, and even it needs the national team check in the source.
  it('accepts the international flag and nothing else', () => {
    assert.equal(isInternationalCategory('international'), true);
    assert.equal(isInternationalCategory('england'), false);
    assert.equal(isInternationalCategory(undefined), false);
    assert.equal(isInternationalCategory(''), false);
  });
});

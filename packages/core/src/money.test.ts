import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice, fromMillions, toMillions } from './money.js';

describe('money', () => {
  it('converts tenths to millions', () => {
    assert.equal(toMillions(55), 5.5);
  });

  it('round trips through millions without float drift', () => {
    for (let tenths = 38; tenths <= 150; tenths += 1) {
      assert.equal(fromMillions(toMillions(tenths)), tenths);
    }
  });

  it('formats to one decimal place', () => {
    assert.equal(formatPrice(120), '12.0m');
  });
});

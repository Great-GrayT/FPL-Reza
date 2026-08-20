import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advancementOf,
  describeSlot,
  duelLabels,
  duelsFor,
  lateralOf,
  rowsOfLabel,
  slotOf,
  slotsOf,
  type Slot,
} from './duel.js';

/** Rows of ids, the shape a teamsheet arrives in. Ids are positional here. */
const FOUR_THREE_THREE = [[1], [2, 3, 4, 5], [6, 7, 8], [9, 10, 11]];
const FOUR_FOUR_TWO = [[1], [2, 3, 4, 5], [6, 7, 8, 9], [10, 11]];
const FIVE_THREE_TWO = [[1], [2, 3, 4, 5, 6], [7, 8, 9], [10, 11]];

function slotAt(rows: readonly (readonly number[])[], row: number, index: number): Slot {
  const entries = rows[row];
  assert.ok(entries !== undefined);
  return { row, index, rowSize: entries.length, rows: rows.length };
}

describe('slot geometry', () => {
  it('places a lone striker in the middle and a back four across the width', () => {
    assert.equal(lateralOf(slotAt(FOUR_FOUR_TWO, 0, 0)), 0.5);
    assert.equal(lateralOf(slotAt(FOUR_THREE_THREE, 1, 0)), 0.125);
    assert.equal(lateralOf(slotAt(FOUR_THREE_THREE, 1, 3)), 0.875);
  });

  it('measures advancement across the outfield rows, keeper excluded', () => {
    // The defensive line is the floor of the scale, not a third of the way up
    // it: the keeper sits outside so a mirrored attacker lands on a defender.
    assert.equal(advancementOf(slotAt(FOUR_THREE_THREE, 1, 0)), 0);
    assert.equal(advancementOf(slotAt(FOUR_THREE_THREE, 2, 0)), 0.5);
    assert.equal(advancementOf(slotAt(FOUR_THREE_THREE, 3, 0)), 1);
  });

  it('enumerates every slot a formation describes', () => {
    assert.equal(slotsOf(FOUR_THREE_THREE).length, 11);
    assert.equal(slotsOf(FIVE_THREE_TWO).length, 11);
  });

  it('finds a player by the id the row carries', () => {
    const slot = slotOf(FOUR_THREE_THREE, 11);
    assert.deepEqual(slot, { row: 3, index: 2, rowSize: 3, rows: 4 });
    assert.equal(slotOf(FOUR_THREE_THREE, 99), null);
  });

  it('parses a printed formation into rows, keeper first', () => {
    assert.deepEqual(rowsOfLabel('4-3-3'), [1, 4, 3, 3]);
    assert.deepEqual(rowsOfLabel('4-2-3-1'), [1, 4, 2, 3, 1]);
    assert.equal(rowsOfLabel('4-4-3'), null, 'eleven outfield players is not a formation');
    assert.equal(rowsOfLabel('nonsense'), null);
  });
});

describe('duels', () => {
  it('matches a wide attacker to the full back opposite him', () => {
    // Index 0 of the front three, so one side's wide attacker.
    const winger = slotAt(FOUR_THREE_THREE, 3, 0);
    const duels = duelsFor(winger, FOUR_THREE_THREE);
    assert.ok(duels.length > 0);
    const first = duels[0];
    assert.ok(first !== undefined);
    // Mirrored across the pitch: his 0.167 meets their 0.875 full back.
    assert.equal(first.slot.row, 1);
    assert.equal(first.slot.index, 3);
    assert.ok(first.weight > 0.5);
  });

  it('splits a winger between the full back and the midfielder tracking him', () => {
    const winger = slotAt(FOUR_THREE_THREE, 3, 0);
    const againstFlat = duelLabels(winger, FOUR_FOUR_TWO);
    // What the geometry actually claims: the full back opposite him takes most
    // of the duel, a midfielder in the same channel takes a slice, and the near
    // centre back takes the rest, because a winger cutting inside meets him.
    // It does not claim a wider split than a 4-3-3 gives, since both shapes put
    // somebody in that channel.
    const labels = againstFlat.map((entry) => entry.against);
    assert.equal(labels[0], 'right defence');
    assert.ok(labels.includes('right midfield'));
    const defender = againstFlat.find((entry) => entry.against === 'right defence');
    const midfielder = againstFlat.find((entry) => entry.against === 'right midfield');
    assert.ok(defender !== undefined && midfielder !== undefined);
    assert.ok(defender.weight > midfielder.weight);
    assert.ok(
      againstFlat.every((entry) => entry.weight >= 0.03),
      'a duel worth a percent or two is noise, not a matchup',
    );
  });

  it('weights sum to one', () => {
    for (const opponent of [FOUR_THREE_THREE, FOUR_FOUR_TWO, FIVE_THREE_TWO]) {
      for (const slot of slotsOf(FOUR_THREE_THREE)) {
        const duels = duelsFor(slot, opponent);
        if (duels.length === 0) continue;
        const total = duels.reduce((sum, duel) => sum + duel.weight, 0);
        assert.ok(Math.abs(total - 1) < 1e-9);
      }
    }
  });

  it('never matches anybody against the goalkeeper', () => {
    for (const slot of slotsOf(FOUR_THREE_THREE)) {
      assert.ok(duelsFor(slot, FOUR_FOUR_TWO).every((duel) => duel.slot.row > 0));
    }
  });

  it('mirrors: a left sided attacker meets a right sided defender', () => {
    const left = duelLabels(slotAt(FOUR_THREE_THREE, 3, 0), FOUR_THREE_THREE);
    const right = duelLabels(slotAt(FOUR_THREE_THREE, 3, 2), FOUR_THREE_THREE);
    assert.equal(left[0]?.slot, 'left attack');
    assert.equal(left[0]?.against, 'right defence');
    assert.equal(right[0]?.slot, 'right attack');
    assert.equal(right[0]?.against, 'left defence');
  });

  it('puts a centre back against the striker in front of him', () => {
    const centreBack = slotAt(FOUR_THREE_THREE, 1, 1);
    const duels = duelLabels(centreBack, FOUR_FOUR_TWO);
    assert.ok(duels.length > 0);
    assert.ok(
      duels.every((duel) => duel.against.endsWith('attack') || duel.against.endsWith('midfield')),
    );
  });

  it('handles a back five, where the wing back is wider than any winger', () => {
    const wingBack = slotAt(FIVE_THREE_TWO, 1, 0);
    assert.equal(lateralOf(wingBack), 0.1);
    const duels = duelsFor(wingBack, FOUR_THREE_THREE);
    assert.ok(duels.length > 0);
  });

  it('names a slot the way a reader would', () => {
    assert.equal(describeSlot(slotAt(FOUR_THREE_THREE, 0, 0)), 'keeper');
    assert.equal(describeSlot(slotAt(FOUR_THREE_THREE, 1, 0)), 'left defence');
    assert.equal(describeSlot(slotAt(FOUR_THREE_THREE, 2, 1)), 'central midfield');
    assert.equal(describeSlot(slotAt(FOUR_THREE_THREE, 3, 2)), 'right attack');
  });
});

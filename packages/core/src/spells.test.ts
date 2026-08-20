import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  currentManager,
  managerAt,
  managerSpellSchema,
  spellsFor,
  tenureAt,
  type ManagerSpell,
} from './spells.js';

/** Dates arrive as strings here, the way they do from a stored row. */
type SpellInput = Partial<Record<keyof ManagerSpell, unknown>>;

function spell(overrides: SpellInput = {}): ManagerSpell {
  return managerSpellSchema.parse({
    teamCode: 8,
    teamName: 'Chelsea',
    clubEntityId: 'Q9616',
    managerName: 'A Manager',
    managerEntityId: 'Q1',
    nationality: 'Spain',
    from: '2024-07-01',
    to: null,
    precision: 'day',
    ...overrides,
  });
}

describe('manager spells', () => {
  const spells: ManagerSpell[] = [
    spell({ managerName: 'First', managerEntityId: 'Q1', from: '2022-07-01', to: '2024-06-30' }),
    spell({ managerName: 'Second', managerEntityId: 'Q2', from: '2024-07-01', to: '2026-01-01' }),
    spell({
      managerName: 'Caretaker',
      managerEntityId: 'Q3',
      from: '2026-01-06',
      to: '2026-04-22',
    }),
    spell({ managerName: 'Current', managerEntityId: 'Q4', from: '2026-07-01', to: null }),
    spell({
      teamCode: 3,
      managerName: 'Elsewhere',
      managerEntityId: 'Q5',
      from: '2020-01-01',
      to: null,
    }),
  ];

  it('names the manager of a date inside a closed spell', () => {
    assert.equal(managerAt(spells, 8, new Date('2025-03-15'))?.managerName, 'Second');
  });

  it('names the open spell for a date after it began', () => {
    assert.equal(managerAt(spells, 8, new Date('2026-08-20'))?.managerName, 'Current');
  });

  it('returns null in a gap between spells', () => {
    assert.equal(managerAt(spells, 8, new Date('2026-05-10')), null);
  });

  it('never reads another club’s spell', () => {
    assert.equal(managerAt(spells, 3, new Date('2025-03-15'))?.managerName, 'Elsewhere');
    assert.equal(managerAt(spells, 99, new Date('2025-03-15')), null);
  });

  it('prefers the shorter spell where two cover the same day', () => {
    // A caretaker's fortnight inside a permanent appointment: the source dates
    // both, and the caretaker is the one who took the match.
    const overlapping: ManagerSpell[] = [
      spell({
        managerName: 'Permanent',
        managerEntityId: 'Q1',
        from: '2024-07-01',
        to: '2026-06-01',
      }),
      spell({
        managerName: 'Caretaker',
        managerEntityId: 'Q2',
        from: '2025-02-01',
        to: '2025-02-20',
      }),
    ];
    assert.equal(managerAt(overlapping, 8, new Date('2025-02-10'))?.managerName, 'Caretaker');
    assert.equal(managerAt(overlapping, 8, new Date('2025-03-10'))?.managerName, 'Permanent');
  });

  it('reads the current manager off the open spell', () => {
    assert.equal(currentManager(spells, 8)?.managerName, 'Current');
  });

  it('falls back to the latest closed spell when none is open', () => {
    const closed = spells.filter((entry) => entry.to !== null && entry.teamCode === 8);
    assert.equal(currentManager(closed, 8)?.managerName, 'Caretaker');
  });

  it('measures tenure in days and flags a new appointment', () => {
    const fresh = tenureAt(spells, 8, new Date('2026-07-10'));
    assert.ok(fresh !== null);
    assert.equal(Math.round(fresh.days), 9);
    assert.equal(fresh.newlyAppointed, true);

    const settled = tenureAt(spells, 8, new Date('2026-10-01'));
    assert.ok(settled !== null);
    assert.equal(settled.newlyAppointed, false);
  });

  it('lists a club’s spells newest first', () => {
    assert.deepEqual(
      spellsFor(spells, 8).map((entry) => entry.managerName),
      ['Current', 'Caretaker', 'Second', 'First'],
    );
  });

  it('refuses a spell with no club code', () => {
    assert.throws(() => managerSpellSchema.parse({ ...spell(), teamCode: 0 }));
  });
});

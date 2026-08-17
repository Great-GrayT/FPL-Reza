import type { Fixture } from '@fpl/core';

export type FixtureChangeKind = 'added' | 'removed' | 'changed';

export interface FixtureChange {
  fixtureId: number;
  kind: FixtureChangeKind;
  /** Which field moved. Absent for a whole fixture appearing or disappearing. */
  field?: FixtureField;
  before?: string;
  after?: string;
}

export interface FixturesDiff {
  changed: boolean;
  added: number;
  removed: number;
  updated: number;
  changes: readonly FixtureChange[];
}

/**
 * Fields worth reporting. Everything a fixture carries is here except the two
 * team ids: a fixture whose teams changed is a different fixture, and FPL
 * reuses an id only within one pairing.
 */
const FIELDS = [
  'gameweek',
  'kickoff',
  'homeScore',
  'awayScore',
  'finished',
  'started',
  'homeDifficulty',
  'awayDifficulty',
] as const;

type FixtureField = (typeof FIELDS)[number];

/**
 * Compares two fixture lists by fixture id and names what moved. Kickoff time
 * and gameweek reassignment are the reason this exists: a broadcaster moving a
 * match is the single most common change in the dataset, and a caller needs to
 * show which match moved, not merely that something did.
 */
export function diffFixtures(
  before: readonly Fixture[] | undefined,
  after: readonly Fixture[],
): FixturesDiff {
  if (before === undefined) {
    // A first ever fetch is entirely new; listing 380 additions would be noise.
    return {
      changed: true,
      added: after.length,
      removed: 0,
      updated: 0,
      changes: [{ fixtureId: 0, kind: 'added', after: `${String(after.length)} fixtures` }],
    };
  }

  const previous = new Map(before.map((fixture) => [fixture.id as number, fixture]));
  const current = new Map(after.map((fixture) => [fixture.id as number, fixture]));
  const changes: FixtureChange[] = [];
  let added = 0;
  let removed = 0;
  let updated = 0;

  for (const [id, fixture] of current) {
    const existing = previous.get(id);
    if (existing === undefined) {
      added += 1;
      changes.push({ fixtureId: id, kind: 'added', after: describe(fixture) });
      continue;
    }

    let touched = false;
    for (const field of FIELDS) {
      const from = render(existing[field]);
      const to = render(fixture[field]);
      if (from === to) continue;
      touched = true;
      changes.push({ fixtureId: id, kind: 'changed', field, before: from, after: to });
    }
    if (touched) updated += 1;
  }

  for (const [id, fixture] of previous) {
    if (current.has(id)) continue;
    removed += 1;
    changes.push({ fixtureId: id, kind: 'removed', before: describe(fixture) });
  }

  return { changed: changes.length > 0, added, removed, updated, changes };
}

export function summariseFixtureChange(change: FixtureChange): string {
  const subject =
    change.field === undefined
      ? `fixture ${String(change.fixtureId)}`
      : `fixture ${String(change.fixtureId)} ${change.field}`;

  if (change.kind === 'added') return `${subject} added: ${change.after ?? ''}`;
  if (change.kind === 'removed') return `${subject} removed (was ${change.before ?? ''})`;
  return `${subject} changed from ${change.before ?? ''} to ${change.after ?? ''}`;
}

const describe = (fixture: Fixture): string =>
  `${String(fixture.homeTeam)} v ${String(fixture.awayTeam)} in gw ${render(fixture.gameweek)}`;

/** Every diffed field is one of these, so a stringified object is unreachable. */
function render(value: Fixture[FixtureField]): string {
  if (value === null) return 'none';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

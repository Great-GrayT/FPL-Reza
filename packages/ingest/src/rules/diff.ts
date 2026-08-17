import type { RulesDocument } from './schema.js';

export interface RulesChange {
  kind: 'added' | 'removed' | 'changed';
  /** Dotted location, e.g. "deadlines.gw19" or "squad.budgetTenths". */
  path: string;
  before: string | null;
  after: string | null;
}

export interface RulesDiff {
  changed: boolean;
  checksumBefore: string | null;
  checksumAfter: string;
  changes: RulesChange[];
}

/**
 * Compares two scrapes field by field. The checksum alone would say only that
 * something moved; a frontend refresh button needs to say what moved, so every
 * keyed collection is compared by its natural key.
 */
export function diffRules(before: RulesDocument | undefined, after: RulesDocument): RulesDiff {
  if (before === undefined) {
    return {
      changed: true,
      checksumBefore: null,
      checksumAfter: after.checksum,
      changes: [{ kind: 'added', path: 'rules', before: null, after: 'first scrape' }],
    };
  }

  const changes: RulesChange[] = [
    ...diffKeyed(
      'deadlines',
      index(before.deadlines, (entry) => `gw${entry.gameweek}`, describeDeadline),
      index(after.deadlines, (entry) => `gw${entry.gameweek}`, describeDeadline),
    ),
    ...diffKeyed(
      'scoring',
      index(
        before.scoring,
        (row) => row.action,
        (row) => row.raw,
      ),
      index(
        after.scoring,
        (row) => row.action,
        (row) => row.raw,
      ),
    ),
    ...diffKeyed(
      'bps',
      index(
        before.bps,
        (row) => row.action,
        (row) => row.raw,
      ),
      index(
        after.bps,
        (row) => row.action,
        (row) => row.raw,
      ),
    ),
    ...diffKeyed(
      'chips',
      index(
        before.chips,
        (row) => row.name,
        (row) => row.effect,
      ),
      index(
        after.chips,
        (row) => row.name,
        (row) => row.effect,
      ),
    ),
    ...diffKeyed(
      'phases',
      index(
        before.phases,
        (row) => row.name,
        (row) => `${row.from} to ${row.to}`,
      ),
      index(
        after.phases,
        (row) => row.name,
        (row) => `${row.from} to ${row.to}`,
      ),
    ),
    ...diffKeyed(
      'sections',
      index(
        before.sections,
        (row) => row.heading,
        (row) => row.text,
      ),
      index(
        after.sections,
        (row) => row.heading,
        (row) => row.text,
      ),
    ),
    ...diffScalars('squad', before.squad, after.squad),
    ...diffScalars('transfers', before.transfers, after.transfers),
  ];

  return {
    changed: changes.length > 0 || before.checksum !== after.checksum,
    checksumBefore: before.checksum,
    checksumAfter: after.checksum,
    changes,
  };
}

/** One line per change, suitable for rendering straight into a UI. */
export function summariseChange(change: RulesChange): string {
  switch (change.kind) {
    case 'added':
      return `${change.path} added: ${change.after ?? ''}`;
    case 'removed':
      return `${change.path} removed (was ${change.before ?? ''})`;
    default:
      return `${change.path} changed from ${change.before ?? ''} to ${change.after ?? ''}`;
  }
}

const describeDeadline = (entry: { label: string; deadline: Date | null }): string =>
  entry.deadline === null ? entry.label : `${entry.label} (${entry.deadline.toISOString()})`;

function index<T>(
  rows: readonly T[],
  key: (row: T) => string,
  value: (row: T) => string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) map.set(key(row), value(row));
  return map;
}

function diffKeyed(
  prefix: string,
  before: Map<string, string>,
  after: Map<string, string>,
): RulesChange[] {
  const changes: RulesChange[] = [];

  for (const [key, afterValue] of after) {
    const beforeValue = before.get(key);
    if (beforeValue === undefined) {
      changes.push({ kind: 'added', path: `${prefix}.${key}`, before: null, after: afterValue });
    } else if (beforeValue !== afterValue) {
      changes.push({
        kind: 'changed',
        path: `${prefix}.${key}`,
        before: beforeValue,
        after: afterValue,
      });
    }
  }

  for (const [key, beforeValue] of before) {
    if (!after.has(key)) {
      changes.push({ kind: 'removed', path: `${prefix}.${key}`, before: beforeValue, after: null });
    }
  }

  return changes;
}

function diffScalars(
  prefix: string,
  before: Readonly<Record<string, number | null>>,
  after: Readonly<Record<string, number | null>>,
): RulesChange[] {
  const changes: RulesChange[] = [];
  for (const [key, afterValue] of Object.entries(after)) {
    const beforeValue = before[key] ?? null;
    if (beforeValue !== afterValue) {
      changes.push({
        kind: 'changed',
        path: `${prefix}.${key}`,
        before: beforeValue === null ? null : String(beforeValue),
        after: afterValue === null ? null : String(afterValue),
      });
    }
  }
  return changes;
}

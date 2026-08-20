import type { FeatureRow } from './features.js';

/**
 * What each component model is asked to predict.
 *
 * Points are never a target. The scoring table is published, so a model asked
 * to learn it would spend its capacity rediscovering that a midfielder's goal
 * is worth five, and would still get the edges wrong. Instead each component of
 * the table is predicted and the table is applied.
 *
 * The conditional structure matters as much as the list. Goals are modelled as
 * a rate per ninety among players who were on the pitch, not as a count over
 * everybody, because a count over everybody is mostly a model of whether he
 * played, which is already its own component. Multiplying the two back together
 * at projection time is what keeps each one answering one question.
 */

export type ComponentName =
  | 'minutes'
  | 'goalRate'
  | 'assistRate'
  | 'cleanSheet'
  | 'concededRate'
  | 'saveRate'
  | 'bpsRate'
  | 'cardRate'
  | 'priceChange';

export type Task = 'regression' | 'classification';

export interface ComponentSpec {
  name: ComponentName;
  task: Task;
  /** What a reader should understand the number to mean. */
  description: string;
  /** Rows this component is fitted on. */
  eligible: (row: FeatureRow) => boolean;
  /** The value to predict, or null where the row cannot supply one. */
  target: (row: FeatureRow) => number | null;
  /** Classes, for a classification component. */
  classes?: string[];
}

/** Sixty minutes is the threshold every appearance rule in the game turns on. */
const FULL_APPEARANCE = 60;
/** Below this a rate is noise: one goal in four minutes is not 22 per ninety. */
const RATE_MINUTES_FLOOR = 20;

const played = (row: FeatureRow): boolean => row.actual.minutes >= RATE_MINUTES_FLOOR;

const per90 = (total: number, minutes: number): number | null =>
  minutes >= RATE_MINUTES_FLOOR ? (total * 90) / minutes : null;

export const COMPONENTS: ComponentSpec[] = [
  {
    name: 'minutes',
    task: 'classification',
    description:
      'Whether he reaches a full appearance. Availability dominates every other term: a player who does not start cannot score.',
    classes: ['under sixty', 'sixty or more'],
    eligible: () => true,
    target: (row) => (row.actual.minutes >= FULL_APPEARANCE ? 1 : 0),
  },
  {
    name: 'goalRate',
    task: 'regression',
    description: 'Goals per ninety minutes, among players who were on the pitch.',
    eligible: played,
    target: (row) => per90(row.actual.goals, row.actual.minutes),
  },
  {
    name: 'assistRate',
    task: 'regression',
    description: 'Assists per ninety minutes, among players who were on the pitch.',
    eligible: played,
    target: (row) => per90(row.actual.assists, row.actual.minutes),
  },
  {
    name: 'cleanSheet',
    task: 'classification',
    description:
      'Whether the club kept a clean sheet, among players who reached the sixty minutes the rule requires.',
    classes: ['conceded', 'clean sheet'],
    eligible: (row) => row.actual.minutes >= FULL_APPEARANCE,
    target: (row) => (row.actual.cleanSheets > 0 ? 1 : 0),
  },
  {
    name: 'concededRate',
    task: 'regression',
    description:
      'Goals conceded per ninety while on the pitch, which is what the penalty is charged on.',
    eligible: played,
    target: (row) => per90(row.actual.goalsConceded, row.actual.minutes),
  },
  {
    name: 'saveRate',
    task: 'regression',
    description: 'Saves per ninety, goalkeepers only.',
    eligible: (row) => played(row) && row.position === 'GKP',
    target: (row) => per90(row.actual.saves, row.actual.minutes),
  },
  {
    name: 'bpsRate',
    task: 'regression',
    description:
      'Bonus points system score per ninety. Bonus is awarded on this, so it is what a bonus prediction has to start from.',
    eligible: played,
    target: (row) => per90(row.actual.bps, row.actual.minutes),
  },
  {
    name: 'cardRate',
    task: 'classification',
    description:
      'Whether he was booked or sent off, which is a rare event and therefore a calibration problem.',
    classes: ['no card', 'carded'],
    eligible: played,
    target: (row) => (row.actual.yellowCards + row.actual.redCards > 0 ? 1 : 0),
  },
  {
    name: 'priceChange',
    task: 'classification',
    description:
      'Whether the price rises before the next gameweek. The game moves a price by a tenth or not at all, so it is a class rather than an amount.',
    classes: ['holds or falls', 'rises'],
    eligible: () => true,
    // Filled by the builder below, which needs the next row to see the change.
    target: () => null,
  },
];

export interface TargetSet {
  component: ComponentSpec;
  /** Indexes into the feature rows this component is fitted on. */
  rows: number[];
  values: Float64Array;
}

/**
 * The rows and values for one component.
 *
 * A row that cannot supply a target is dropped rather than defaulted, so a
 * component is never fitted against a zero that means "not measured". The price
 * component is the exception in shape rather than in principle: its target is
 * the change to the next gameweek, so it is read from the player's own next row
 * and the last row of each player is dropped for having no next.
 */
export function targetsFor(component: ComponentSpec, rows: readonly FeatureRow[]): TargetSet {
  if (component.name === 'priceChange') return priceTargets(component, rows);

  const indexes: number[] = [];
  const values: number[] = [];
  rows.forEach((row, index) => {
    if (!component.eligible(row)) return;
    const value = component.target(row);
    if (value === null || !Number.isFinite(value)) return;
    indexes.push(index);
    values.push(value);
  });
  return { component, rows: indexes, values: Float64Array.from(values) };
}

function priceTargets(component: ComponentSpec, rows: readonly FeatureRow[]): TargetSet {
  const byPlayer = new Map<number, number[]>();
  rows.forEach((row, index) => {
    const bucket = byPlayer.get(row.playerCode);
    if (bucket === undefined) byPlayer.set(row.playerCode, [index]);
    else bucket.push(index);
  });

  const indexes: number[] = [];
  const values: number[] = [];
  for (const bucket of byPlayer.values()) {
    bucket.sort((a, b) => (rows[a]?.period ?? 0) - (rows[b]?.period ?? 0));
    for (let i = 0; i < bucket.length - 1; i += 1) {
      const here = rows[bucket[i] ?? 0];
      const next = rows[bucket[i + 1] ?? 0];
      if (here === undefined || next === undefined) continue;
      // Only consecutive gameweeks of the same season describe a price move: a
      // gap of ten weeks contains ten moves, not one.
      if (next.season !== here.season || next.gameweek !== here.gameweek + 1) continue;
      const from = here.actual.price;
      const to = next.actual.price;
      if (from === null || to === null) continue;
      indexes.push(bucket[i] ?? 0);
      values.push(to > from ? 1 : 0);
    }
  }
  return { component, rows: indexes, values: Float64Array.from(values) };
}

import { z } from 'zod';
import { fixtureIdSchema, playerIdSchema, teamIdSchema } from './ids.js';

/**
 * Pitch geometry and per match spatial data.
 *
 * Coordinates use the Opta convention: 0 to 100 on both axes, always from the
 * perspective of the team in possession attacking towards x = 100. Providers
 * that ship metres or flip sides at half time must normalise before building
 * these rows, so downstream analytics never needs to know the provider.
 */

export const PITCH_MIN = 0;
export const PITCH_MAX = 100;

export const pointSchema = z.object({
  x: z.number().min(PITCH_MIN).max(PITCH_MAX),
  y: z.number().min(PITCH_MIN).max(PITCH_MAX),
});

export type Point = z.infer<typeof pointSchema>;

/** Thirds along the attacking axis. */
export const THIRDS = ['defensive', 'middle', 'attacking'] as const;
export type Third = (typeof THIRDS)[number];

/** Vertical channels, left to right from the attacking team's view. */
export const CHANNELS = ['left', 'left_half', 'centre', 'right_half', 'right'] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * Phase of play an action belongs to. Transition is split by direction because
 * a player who wins the ball and drives is doing something categorically
 * different from one recovering shape after a turnover.
 */
export const PHASES = [
  'attack',
  'defence',
  'transition_to_attack',
  'transition_to_defence',
  'set_piece_attacking',
  'set_piece_defending',
  'unknown',
] as const;
export type Phase = (typeof PHASES)[number];

export const thirdSchema = z.enum(THIRDS);
export const channelSchema = z.enum(CHANNELS);
export const phaseSchema = z.enum(PHASES);

export const thirdOf = (x: number): Third => {
  if (x < 100 / 3) return 'defensive';
  if (x < 200 / 3) return 'middle';
  return 'attacking';
};

export const channelOf = (y: number): Channel => {
  const index = Math.min(CHANNELS.length - 1, Math.floor((y / PITCH_MAX) * CHANNELS.length));
  return CHANNELS[index] ?? 'centre';
};

/** Zone key in `third:channel` form, e.g. "attacking:left". */
export type ZoneKey = `${Third}:${Channel}`;

export const zoneOf = (point: Point): ZoneKey => `${thirdOf(point.x)}:${channelOf(point.y)}`;

export const ZONE_KEYS: readonly ZoneKey[] = THIRDS.flatMap((third) =>
  CHANNELS.map((channel): ZoneKey => `${third}:${channel}`),
);

/**
 * Heatmap as a dense grid rather than a list of points, so it stores and
 * renders at a fixed cost regardless of how many touches a player had. Counts
 * are row major, `rows * cols` long, row 0 at y = 0.
 */
export const heatmapSchema = z
  .object({
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    counts: z.array(z.number().nonnegative()),
  })
  .refine((grid) => grid.counts.length === grid.cols * grid.rows, {
    message: 'counts length must equal cols multiplied by rows',
  });

export type Heatmap = z.infer<typeof heatmapSchema>;

export const DEFAULT_HEATMAP_COLS = 12;
export const DEFAULT_HEATMAP_ROWS = 8;

export function emptyHeatmap(
  cols: number = DEFAULT_HEATMAP_COLS,
  rows: number = DEFAULT_HEATMAP_ROWS,
): Heatmap {
  return { cols, rows, counts: new Array<number>(cols * rows).fill(0) };
}

/** Adds one point to the cell containing it. Points on the far edge clamp inward. */
export function addToHeatmap(grid: Heatmap, point: Point, weight = 1): Heatmap {
  const col = Math.min(grid.cols - 1, Math.floor((point.x / PITCH_MAX) * grid.cols));
  const row = Math.min(grid.rows - 1, Math.floor((point.y / PITCH_MAX) * grid.rows));
  const index = row * grid.cols + col;
  const counts = [...grid.counts];
  counts[index] = (counts[index] ?? 0) + weight;
  return { ...grid, counts };
}

export function buildHeatmap(
  points: readonly Point[],
  cols: number = DEFAULT_HEATMAP_COLS,
  rows: number = DEFAULT_HEATMAP_ROWS,
): Heatmap {
  const counts = new Array<number>(cols * rows).fill(0);
  for (const point of points) {
    const col = Math.min(cols - 1, Math.floor((point.x / PITCH_MAX) * cols));
    const row = Math.min(rows - 1, Math.floor((point.y / PITCH_MAX) * rows));
    const index = row * cols + col;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return { cols, rows, counts };
}

/** Counts per zone, present only for zones the player actually touched. */
export const zoneCountsSchema = z.record(z.string(), z.number().nonnegative());
export const phaseCountsSchema = z.record(phaseSchema, z.number().nonnegative());

/**
 * One player's spatial profile in one match. Every field beyond the identity
 * block is nullable: an event provider supplies touches and actions but no
 * distance, while a tracking provider supplies distance and speed. Null means
 * "this provider does not carry it", which is distinct from a measured zero.
 */
export const playerMatchSpatialSchema = z.object({
  playerId: playerIdSchema,
  fixtureId: fixtureIdSchema,
  teamId: teamIdSchema,
  provider: z.string().min(1),
  minutes: z.number().int().min(0).max(120),

  averagePosition: pointSchema.nullable(),
  heatmap: heatmapSchema.nullable(),
  touchesByZone: zoneCountsSchema.nullable(),
  touchesByPhase: phaseCountsSchema.nullable(),

  touches: z.number().int().nonnegative().nullable(),
  passesAttempted: z.number().int().nonnegative().nullable(),
  passesCompleted: z.number().int().nonnegative().nullable(),
  progressivePasses: z.number().int().nonnegative().nullable(),
  progressiveCarries: z.number().int().nonnegative().nullable(),
  carryDistanceM: z.number().nonnegative().nullable(),
  shots: z.number().int().nonnegative().nullable(),
  shotsOnTarget: z.number().int().nonnegative().nullable(),
  touchesInBox: z.number().int().nonnegative().nullable(),

  /** Defensive actions, the inputs to the defensive contribution rule. */
  tackles: z.number().int().nonnegative().nullable(),
  interceptions: z.number().int().nonnegative().nullable(),
  clearances: z.number().int().nonnegative().nullable(),
  blocks: z.number().int().nonnegative().nullable(),
  recoveries: z.number().int().nonnegative().nullable(),
  pressures: z.number().int().nonnegative().nullable(),
  aerialsWon: z.number().int().nonnegative().nullable(),
  defensiveActionsByThird: z.record(thirdSchema, z.number().nonnegative()).nullable(),

  /** Tracking only. */
  distanceKm: z.number().nonnegative().nullable(),
  sprints: z.number().int().nonnegative().nullable(),
  topSpeedKmh: z.number().nonnegative().nullable(),
});

export type PlayerMatchSpatial = z.infer<typeof playerMatchSpatialSchema>;

/**
 * A single on ball event. Kept provider neutral: `type` is a free string
 * because taxonomies differ, while `phase` and the coordinates are normalised
 * so cross provider queries still work.
 */
export const matchEventSchema = z.object({
  fixtureId: fixtureIdSchema,
  provider: z.string().min(1),
  /** Provider's own event id, for deduplication across re-ingests. */
  providerEventId: z.string().min(1),
  playerId: playerIdSchema.nullable(),
  teamId: teamIdSchema,
  minute: z.number().int().min(0).max(120),
  second: z.number().int().min(0).max(59).nullable(),
  type: z.string().min(1),
  outcome: z.string().nullable(),
  phase: phaseSchema,
  location: pointSchema.nullable(),
  /** Pass or shot destination. */
  endLocation: pointSchema.nullable(),
  bodyPart: z.string().nullable(),
  expectedGoals: z.number().nonnegative().nullable(),
  expectedAssists: z.number().nonnegative().nullable(),
});

export type MatchEvent = z.infer<typeof matchEventSchema>;

/** Sum of the counts that feed the defensive contribution rule for a position. */
export function defensiveActionCount(
  spatial: Pick<
    PlayerMatchSpatial,
    'clearances' | 'blocks' | 'interceptions' | 'tackles' | 'recoveries'
  >,
  includeRecoveries: boolean,
): number {
  const core =
    (spatial.clearances ?? 0) +
    (spatial.blocks ?? 0) +
    (spatial.interceptions ?? 0) +
    (spatial.tackles ?? 0);
  return includeRecoveries ? core + (spatial.recoveries ?? 0) : core;
}

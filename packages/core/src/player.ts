import { z } from 'zod';
import { playerCodeSchema, playerIdSchema, teamIdSchema } from './ids.js';
import { positionSchema } from './position.js';
import { ValidationError } from './errors.js';

export const AVAILABILITY = [
  'available',
  'doubtful',
  'injured',
  'suspended',
  'unavailable',
  'not_in_squad',
] as const;

export type Availability = (typeof AVAILABILITY)[number];
export const availabilitySchema = z.enum(AVAILABILITY);

/** FPL ships availability as a single letter on `element.status`. */
const BY_STATUS_CODE = new Map<string, Availability>([
  ['a', 'available'],
  ['d', 'doubtful'],
  ['i', 'injured'],
  ['s', 'suspended'],
  ['u', 'unavailable'],
  ['n', 'not_in_squad'],
]);

export function availabilityFromStatus(status: string): Availability {
  const availability = BY_STATUS_CODE.get(status);
  if (availability === undefined) {
    throw new ValidationError(`unknown player status "${status}"`, [
      `expected one of ${[...BY_STATUS_CODE.keys()].join(', ')}`,
    ]);
  }
  return availability;
}

export const playerSchema = z.object({
  id: playerIdSchema,
  code: playerCodeSchema,
  firstName: z.string(),
  secondName: z.string(),
  /** Display name FPL uses in its own UI. */
  webName: z.string().min(1),
  teamId: teamIdSchema,
  position: positionSchema,
  /** Current price in tenths of a million. */
  price: z.number().int().positive(),
  /** Price at the season start, for tracking rises and falls. */
  startPrice: z.number().int().positive(),
  totalPoints: z.number().int(),
  minutes: z.number().int().nonnegative(),
  goals: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  cleanSheets: z.number().int().nonnegative(),
  goalsConceded: z.number().int().nonnegative(),
  yellowCards: z.number().int().nonnegative(),
  redCards: z.number().int().nonnegative(),
  saves: z.number().int().nonnegative(),
  bonus: z.number().int().nonnegative(),
  /** Bonus Points System score, the raw input bonus is derived from. */
  bps: z.number().int(),
  form: z.number(),
  pointsPerGame: z.number(),
  selectedByPercent: z.number(),
  expectedGoals: z.number().nonnegative(),
  expectedAssists: z.number().nonnegative(),
  expectedGoalInvolvements: z.number().nonnegative(),
  expectedGoalsConceded: z.number().nonnegative(),
  availability: availabilitySchema,
  /** Percentage, or null when FPL publishes no estimate. */
  chanceOfPlayingNextRound: z.number().int().min(0).max(100).nullable(),
  news: z.string(),
});

export type Player = z.infer<typeof playerSchema>;

export const playerFullName = (player: Player): string =>
  `${player.firstName} ${player.secondName}`.trim();

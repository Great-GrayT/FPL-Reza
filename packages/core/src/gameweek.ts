import { z } from 'zod';
import { gameweekIdSchema, playerIdSchema } from './ids.js';

export const gameweekSchema = z.object({
  id: gameweekIdSchema,
  name: z.string().min(1),
  deadline: z.coerce.date(),
  finished: z.boolean(),
  isCurrent: z.boolean(),
  isNext: z.boolean(),
  averageEntryScore: z.number().int().nonnegative(),
  highestScore: z.number().int().nonnegative().nullable(),
  mostCaptainedId: playerIdSchema.nullable(),
  /** Chips played this gameweek, keyed by chip name. */
  chipPlays: z.record(z.string(), z.number().int().nonnegative()),
});

export type Gameweek = z.infer<typeof gameweekSchema>;

export const currentGameweek = (gameweeks: readonly Gameweek[]): Gameweek | undefined =>
  gameweeks.find((gameweek) => gameweek.isCurrent);

export const nextGameweek = (gameweeks: readonly Gameweek[]): Gameweek | undefined =>
  gameweeks.find((gameweek) => gameweek.isNext);

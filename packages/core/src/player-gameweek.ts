import { z } from 'zod';
import { fixtureIdSchema, gameweekIdSchema, playerIdSchema, teamIdSchema } from './ids.js';

/**
 * One player's return in one gameweek. This is the grain every form, trend,
 * and per-90 metric is computed from.
 */
export const playerGameweekSchema = z.object({
  playerId: playerIdSchema,
  gameweek: gameweekIdSchema,
  fixtureId: fixtureIdSchema,
  opponentTeam: teamIdSchema,
  wasHome: z.boolean(),
  kickoff: z.coerce.date().nullable(),
  minutes: z.number().int().min(0).max(120),
  totalPoints: z.number().int(),
  goals: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  cleanSheet: z.boolean(),
  goalsConceded: z.number().int().nonnegative(),
  ownGoals: z.number().int().nonnegative(),
  penaltiesSaved: z.number().int().nonnegative(),
  penaltiesMissed: z.number().int().nonnegative(),
  yellowCards: z.number().int().nonnegative(),
  redCards: z.number().int().nonnegative(),
  saves: z.number().int().nonnegative(),
  bonus: z.number().int().nonnegative(),
  bps: z.number().int(),
  expectedGoals: z.number().nonnegative(),
  expectedAssists: z.number().nonnegative(),
  expectedGoalsConceded: z.number().nonnegative(),
  /**
   * CBIT for defenders, CBIRT for midfielders and forwards. Null for seasons
   * before the defensive contribution rule existed.
   */
  defensiveContribution: z.number().nonnegative().nullable(),
  /**
   * The ICT family, as FPL publishes it per gameweek. Null for a row captured
   * before these were read, which is not the same as a player who did nothing:
   * threat and creativity are the two measures a projection leans on hardest,
   * and a zero there would read as "took no shots" rather than "not recorded".
   */
  influence: z.number().nonnegative().nullable().default(null),
  creativity: z.number().nonnegative().nullable().default(null),
  threat: z.number().nonnegative().nullable().default(null),
  ictIndex: z.number().nonnegative().nullable().default(null),
  /** Price at the time of this gameweek, in tenths. */
  price: z.number().int().positive(),
});

export type PlayerGameweek = z.infer<typeof playerGameweekSchema>;

/** Rate per 90 minutes. Returns 0 rather than dividing by zero for unused players. */
export function per90(total: number, minutes: number): number {
  if (minutes <= 0) return 0;
  return (total * 90) / minutes;
}

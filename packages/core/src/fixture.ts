import { z } from 'zod';
import { fixtureIdSchema, gameweekIdSchema, teamIdSchema } from './ids.js';

export const fixtureSchema = z.object({
  id: fixtureIdSchema,
  /** Null while a postponed fixture waits for a rescheduled round. */
  gameweek: gameweekIdSchema.nullable(),
  kickoff: z.coerce.date().nullable(),
  homeTeam: teamIdSchema,
  awayTeam: teamIdSchema,
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
  finished: z.boolean(),
  started: z.boolean(),
  /** FPL's own 1 to 5 difficulty rating, from each side's perspective. */
  homeDifficulty: z.number().int().min(1).max(5),
  awayDifficulty: z.number().int().min(1).max(5),
});

export type Fixture = z.infer<typeof fixtureSchema>;

export const isHome = (fixture: Fixture, teamId: Fixture['homeTeam']): boolean =>
  fixture.homeTeam === teamId;

export function opponentOf(fixture: Fixture, teamId: Fixture['homeTeam']): Fixture['homeTeam'] {
  return isHome(fixture, teamId) ? fixture.awayTeam : fixture.homeTeam;
}

/** Difficulty faced by `teamId` in this fixture. */
export function difficultyFor(fixture: Fixture, teamId: Fixture['homeTeam']): number {
  return isHome(fixture, teamId) ? fixture.homeDifficulty : fixture.awayDifficulty;
}

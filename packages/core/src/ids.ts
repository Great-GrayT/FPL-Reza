import { z } from 'zod';

/**
 * IDs are branded so a TeamId can never be passed where a PlayerId is expected.
 * FPL reuses small integers across every entity, so structural typing alone
 * would let those mistakes compile.
 */

export const playerIdSchema = z.number().int().positive().brand<'PlayerId'>();
export type PlayerId = z.infer<typeof playerIdSchema>;

/** Stable across seasons, unlike `PlayerId`, which is reassigned each season. */
export const playerCodeSchema = z.number().int().positive().brand<'PlayerCode'>();
export type PlayerCode = z.infer<typeof playerCodeSchema>;

export const teamIdSchema = z.number().int().positive().brand<'TeamId'>();
export type TeamId = z.infer<typeof teamIdSchema>;

export const fixtureIdSchema = z.number().int().positive().brand<'FixtureId'>();
export type FixtureId = z.infer<typeof fixtureIdSchema>;

export const gameweekIdSchema = z.number().int().min(1).max(38).brand<'GameweekId'>();
export type GameweekId = z.infer<typeof gameweekIdSchema>;

/** FPL's own season label, e.g. "2025/26". */
export const seasonSchema = z
  .string()
  .regex(/^\d{4}\/\d{2}$/, 'season must look like "2025/26"')
  .brand<'Season'>();
export type Season = z.infer<typeof seasonSchema>;

export const asPlayerId = (value: number): PlayerId => playerIdSchema.parse(value);
export const asTeamId = (value: number): TeamId => teamIdSchema.parse(value);
export const asFixtureId = (value: number): FixtureId => fixtureIdSchema.parse(value);
export const asGameweekId = (value: number): GameweekId => gameweekIdSchema.parse(value);
export const asSeason = (value: string): Season => seasonSchema.parse(value);

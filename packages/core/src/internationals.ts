import { z } from 'zod';
import { playerCodeSchema } from './ids.js';

/**
 * A player's record outside the Premier League: national team tournaments, and
 * the identity mapping that makes them reachable at all.
 *
 * FPL knows nothing about internationals, so this comes from a provider, which
 * means an identity join. That join is stored rather than recomputed, because a
 * mapping is expensive to establish (one search per player) and permanent once
 * established: it keys on `playerCode`, which survives FPL's annual id reshuffle.
 */

export const PROVIDER_NAMES = ['sofascore'] as const;
export const providerNameSchema = z.enum(PROVIDER_NAMES);
export type ProviderName = z.infer<typeof providerNameSchema>;

/**
 * How a domain player was matched to a provider's player, and on what evidence.
 * The confidence is recorded because a name plus club match is not the same
 * claim as a name match alone, and a consumer deserves to know which it has.
 */
export const MATCH_CONFIDENCE = ['name_and_club', 'unique_name'] as const;
export const matchConfidenceSchema = z.enum(MATCH_CONFIDENCE);
export type MatchConfidence = z.infer<typeof matchConfidenceSchema>;

export const playerProviderIdSchema = z.object({
  playerCode: playerCodeSchema,
  provider: providerNameSchema,
  providerPlayerId: z.number().int().positive(),
  /** The provider's spelling of the name, kept so a bad join is auditable. */
  providerName: z.string().min(1),
  /** The provider's club at the time of the match, for the same reason. */
  providerTeam: z.string().nullable(),
  confidence: matchConfidenceSchema,
  matchedAt: z.coerce.date(),
});

export type PlayerProviderId = z.infer<typeof playerProviderIdSchema>;

/**
 * One player's record in one national team competition season. The grain is a
 * tournament season rather than a match, because that is what the provider
 * aggregates and it is what a career page shows: eight caps at a World Cup, not
 * eight rows.
 */
export const internationalSeasonSchema = z.object({
  playerCode: playerCodeSchema,
  provider: providerNameSchema,
  /** National team as the provider records it, for example England. */
  country: z.string().min(1),
  tournament: z.string().min(1),
  tournamentId: z.number().int().positive(),
  /** The provider's season label, which for a World Cup is a single year. */
  season: z.string().min(1),
  seasonId: z.number().int().positive(),
  appearances: z.number().int().nonnegative().nullable(),
  minutes: z.number().int().nonnegative().nullable(),
  goals: z.number().int().nonnegative().nullable(),
  assists: z.number().int().nonnegative().nullable(),
  yellowCards: z.number().int().nonnegative().nullable(),
  redCards: z.number().int().nonnegative().nullable(),
  /** The provider's own match rating, 0 to 10. Null where it publishes none. */
  rating: z.number().nullable(),
});

export type InternationalSeason = z.infer<typeof internationalSeasonSchema>;

export interface InternationalTotals {
  country: string | null;
  tournaments: number;
  caps: number;
  goals: number;
  assists: number;
  minutes: number;
  /** Competitions played, newest first, for a one line summary. */
  competitions: string[];
}

/**
 * A player's international career, summed. Caps are appearances across every
 * national team competition the provider carries, which is not the same as an
 * official cap count: friendlies and any competition the provider does not track
 * are simply absent, so this reads as "at least".
 */
export function internationalTotals(seasons: readonly InternationalSeason[]): InternationalTotals {
  const totals: InternationalTotals = {
    country: seasons[0]?.country ?? null,
    tournaments: 0,
    caps: 0,
    goals: 0,
    assists: 0,
    minutes: 0,
    competitions: [],
  };

  const competitions = new Set<string>();
  for (const season of seasons) {
    totals.caps += season.appearances ?? 0;
    totals.goals += season.goals ?? 0;
    totals.assists += season.assists ?? 0;
    totals.minutes += season.minutes ?? 0;
    competitions.add(season.tournament);
  }

  totals.tournaments = competitions.size;
  totals.competitions = [...competitions];
  return totals;
}

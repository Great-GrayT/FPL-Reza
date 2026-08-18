import {
  internationalSeasonSchema,
  playerProviderIdSchema,
  playerSchema,
  teamSchema,
  type InternationalSeason,
  type Player,
  type PlayerProviderId,
  type Team,
} from '@fpl/core';
import { z } from 'zod';
import type { HttpClient } from '../http.js';
import { DATASETS, type Source, type SourceBatch, type SourceContext } from '../source.js';
import { normaliseName } from '../spatial/sofascore/identity.js';

/**
 * International records, which FPL does not carry at all. Two sources, run in
 * order: one establishes the identity mapping from an FPL player code to a
 * provider player id, the other reads national team competitions for every
 * player already mapped.
 *
 * Splitting them is what makes the work resumable and cheap to repeat. The
 * mapping costs one search per player and is permanent, so it is never redone
 * for a player already in the dataset; the records change only when a tournament
 * is played.
 *
 * Identity is the whole risk here, exactly as with the spatial adapter: a wrong
 * join attributes one player's caps to another and nothing downstream can tell.
 * A candidate is accepted only when the normalised name matches and the provider
 * club is the player's club, or when the name is unique across the results and
 * no club is offered. Anything else is counted and dropped.
 */

const searchResultSchema = z.object({
  results: z
    .array(
      z.object({
        type: z.string(),
        entity: z
          .object({
            id: z.number().int().positive(),
            name: z.string().optional(),
            team: z.object({ name: z.string().optional() }).partial().optional(),
          })
          .passthrough(),
      }),
    )
    .default([]),
});

const seasonsSchema = z.object({
  uniqueTournamentSeasons: z
    .array(
      z.object({
        uniqueTournament: z.object({
          id: z.number().int().positive(),
          name: z.string(),
          category: z
            .object({
              name: z.string().optional(),
              /** "international" for a national team competition. */
              flag: z.string().optional(),
            })
            .partial()
            .optional(),
        }),
        seasons: z
          .array(z.object({ id: z.number().int().positive(), year: z.string() }))
          .default([]),
      }),
    )
    .default([]),
});

const statisticsSchema = z.object({
  statistics: z
    .object({
      appearances: z.number().nullish(),
      minutesPlayed: z.number().nullish(),
      goals: z.number().nullish(),
      assists: z.number().nullish(),
      yellowCards: z.number().nullish(),
      redCards: z.number().nullish(),
      rating: z.number().nullish(),
    })
    .partial()
    .optional(),
  team: z
    .object({
      name: z.string().optional(),
      /** True for a national team, false for a club. The only reliable separator. */
      national: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

/**
 * A national team competition, as the provider labels it. The category flag is
 * the structural signal ("international"), which is why this does not carry a
 * hand maintained list of tournament names that would go stale the moment a
 * competition is renamed.
 */
export const isInternationalCategory = (flag: string | undefined): boolean =>
  flag === 'international';

const count = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.max(0, Math.round(value));

export interface ProviderIdOptions {
  /** Cap the players searched for, so a run can be bounded. */
  limit?: number;
  progressEvery?: number;
}

const DEFAULT_PROGRESS_EVERY = 25;

/**
 * Maps FPL players onto provider player ids, one search per player, skipping any
 * player already mapped. Yields the whole dataset, existing rows included, since
 * a snapshot read takes the newest file whole.
 */
export function providerIdsSource(http: HttpClient, options: ProviderIdOptions = {}): Source {
  return {
    name: 'sofascore-player-ids',
    datasets: [DATASETS.playerProviderIds],
    requires: [DATASETS.players, DATASETS.teams],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      const key = { season: context.season };
      const [players, teams] = await Promise.all([
        context.store.read<Player>({ ...key, dataset: DATASETS.players }, playerSchema),
        context.store.read<Team>({ ...key, dataset: DATASETS.teams }, teamSchema),
      ]);

      const existing = await readExistingIds(context);
      const mapped = new Map(existing.map((row) => [row.playerCode, row]));
      const clubName = new Map(teams.map((team) => [team.id, team.name]));

      const pending = players.filter((player) => !mapped.has(player.code));
      const selected = options.limit === undefined ? pending : pending.slice(0, options.limit);
      const progressEvery = options.progressEvery ?? DEFAULT_PROGRESS_EVERY;

      context.logger.info('resolving provider player ids', {
        source: 'sofascore-player-ids',
        alreadyMapped: mapped.size,
        toResolve: selected.length,
      });

      let resolved = 0;
      let unresolved = 0;

      for (const [index, player] of selected.entries()) {
        const club = clubName.get(player.teamId) ?? '';
        const match = await searchForPlayer(http, player, club);

        if (match === null) {
          unresolved += 1;
          context.logger.debug('provider player unresolved', {
            player: player.webName,
            club,
          });
        } else {
          mapped.set(player.code, match);
          resolved += 1;
        }

        if ((index + 1) % progressEvery === 0) {
          context.logger.info('provider id progress', {
            source: 'sofascore-player-ids',
            done: index + 1,
            total: selected.length,
          });
        }
      }

      context.logger.info('provider ids resolved', {
        source: 'sofascore-player-ids',
        resolved,
        unresolved,
        total: mapped.size,
      });

      yield { dataset: DATASETS.playerProviderIds, rows: [...mapped.values()] };
    },
  };
}

async function readExistingIds(context: SourceContext): Promise<PlayerProviderId[]> {
  try {
    return await context.store.read<PlayerProviderId>(
      { season: context.season, dataset: DATASETS.playerProviderIds },
      playerProviderIdSchema,
    );
  } catch {
    // Never mapped before is the normal first run, not a failure.
    return [];
  }
}

async function searchForPlayer(
  http: HttpClient,
  player: Player,
  club: string,
): Promise<PlayerProviderId | null> {
  const query = encodeURIComponent(`${player.firstName} ${player.secondName}`.trim());
  const payload = await http.getJson(`search/all?q=${query}`);
  const parsed = searchResultSchema.safeParse(payload);
  if (!parsed.success) return null;

  const candidates = parsed.data.results.filter((result) => result.type === 'player');
  const wantedName = normaliseName(`${player.firstName} ${player.secondName}`);
  const wantedWebName = normaliseName(player.webName);
  const wantedClub = normaliseName(club);

  const nameMatches = candidates.filter((candidate) => {
    const name = normaliseName(candidate.entity.name ?? '');
    return name === wantedName || name === wantedWebName;
  });

  // Name and club together: the only join worth making without a second look.
  const withClub = nameMatches.filter(
    (candidate) => normaliseName(candidate.entity.team?.name ?? '') === wantedClub,
  );

  const chosen =
    withClub.length === 1
      ? { candidate: withClub[0], confidence: 'name_and_club' as const }
      : nameMatches.length === 1
        ? { candidate: nameMatches[0], confidence: 'unique_name' as const }
        : null;

  if (chosen?.candidate === undefined) return null;

  return playerProviderIdSchema.parse({
    playerCode: player.code,
    provider: 'sofascore',
    providerPlayerId: chosen.candidate.entity.id,
    providerName: chosen.candidate.entity.name ?? player.webName,
    providerTeam: chosen.candidate.entity.team?.name ?? null,
    confidence: chosen.confidence,
    matchedAt: new Date(),
  });
}

export interface InternationalsOptions {
  /** Cap the players read, so a run can be bounded. */
  limit?: number;
  /** Skip a player already carrying records, for an incremental top up. */
  onlyMissing?: boolean;
  progressEvery?: number;
}

/**
 * National team records for every mapped player: two requests per player plus one
 * per international tournament season they appear in, which is the cost that
 * makes this a bounded backfill rather than scheduled work.
 */
export function internationalsSource(
  http: HttpClient,
  options: InternationalsOptions = {},
): Source {
  return {
    name: 'sofascore-internationals',
    datasets: [DATASETS.internationals],
    requires: [DATASETS.playerProviderIds],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      const ids = await context.store.read<PlayerProviderId>(
        { season: context.season, dataset: DATASETS.playerProviderIds },
        playerProviderIdSchema,
      );

      const existing = await readExistingInternationals(context);
      const haveRecords = new Set(existing.map((row) => row.playerCode));

      const pending =
        options.onlyMissing === true ? ids.filter((row) => !haveRecords.has(row.playerCode)) : ids;
      const selected = options.limit === undefined ? pending : pending.slice(0, options.limit);
      const progressEvery = options.progressEvery ?? DEFAULT_PROGRESS_EVERY;

      context.logger.info('reading international records', {
        source: 'sofascore-internationals',
        players: selected.length,
        mapped: ids.length,
      });

      // Rows for a player being refreshed are replaced wholesale; every other
      // player's existing rows are carried through, since a snapshot is read
      // whole and a partial one would erase the rest.
      const refreshed = new Set(selected.map((row) => row.playerCode));
      const rows: InternationalSeason[] = existing.filter((row) => !refreshed.has(row.playerCode));

      let withCaps = 0;

      for (const [index, mapping] of selected.entries()) {
        const seasons = await internationalSeasonsFor(http, mapping);
        if (seasons.length > 0) withCaps += 1;
        rows.push(...seasons);

        if ((index + 1) % progressEvery === 0) {
          context.logger.info('internationals progress', {
            source: 'sofascore-internationals',
            done: index + 1,
            total: selected.length,
          });
        }
      }

      context.logger.info('international records collected', {
        source: 'sofascore-internationals',
        players: selected.length,
        playersWithCaps: withCaps,
        rows: rows.length,
      });

      yield { dataset: DATASETS.internationals, rows };
    },
  };
}

async function readExistingInternationals(context: SourceContext): Promise<InternationalSeason[]> {
  try {
    return await context.store.read<InternationalSeason>(
      { season: context.season, dataset: DATASETS.internationals },
      internationalSeasonSchema,
    );
  } catch {
    return [];
  }
}

async function internationalSeasonsFor(
  http: HttpClient,
  mapping: PlayerProviderId,
): Promise<InternationalSeason[]> {
  const id = mapping.providerPlayerId;
  const payload = await http.getJson(`player/${String(id)}/statistics/seasons`);
  const parsed = seasonsSchema.safeParse(payload);
  if (!parsed.success) return [];

  const international = parsed.data.uniqueTournamentSeasons.filter((entry) =>
    isInternationalCategory(entry.uniqueTournament.category?.flag),
  );

  const rows: InternationalSeason[] = [];

  for (const entry of international) {
    for (const season of entry.seasons) {
      const statsPayload = await http.getJson(
        `player/${String(id)}/unique-tournament/${String(entry.uniqueTournament.id)}/season/${String(season.id)}/statistics/overall`,
      );
      const stats = statisticsSchema.safeParse(statsPayload);
      if (!stats.success) continue;

      const team = stats.data.team;
      const country = team?.name;
      // Without the national team named, the row cannot say whose cap it is.
      if (country === undefined || country === '') continue;
      // The category flag is not enough on its own: the provider files club
      // friendlies such as the Emirates Cup under an international category, and
      // those rows come back with a club as the team. A cap is a cap for a
      // national team, so that is what is required here.
      if (team?.national !== true) continue;

      const measures = stats.data.statistics ?? {};
      rows.push(
        internationalSeasonSchema.parse({
          playerCode: mapping.playerCode,
          provider: mapping.provider,
          country,
          tournament: entry.uniqueTournament.name,
          tournamentId: entry.uniqueTournament.id,
          season: season.year,
          seasonId: season.id,
          appearances: count(measures.appearances),
          minutes: count(measures.minutesPlayed),
          goals: count(measures.goals),
          assists: count(measures.assists),
          yellowCards: count(measures.yellowCards),
          redCards: count(measures.redCards),
          rating: measures.rating ?? null,
        }),
      );
    }
  }

  return rows;
}

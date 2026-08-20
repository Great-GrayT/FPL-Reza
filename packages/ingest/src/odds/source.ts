import { SourceError, teamSchema, type Season, type Team } from '@fpl/core';
import type { HttpClient } from '../http.js';
import { DATASETS, type Source, type SourceBatch, type SourceContext } from '../source.js';
import { footballDataUrl, parseFootballDataCsv } from './football-data.js';
import { buildTeamResolver } from './team-names.js';

/**
 * A season file exists only once that season is under way. The provider serves
 * a path it does not have through Apache content negotiation, so an unpublished
 * season answers 300 Multiple Choices rather than 404, which is why 300 is here.
 */
const NOT_PUBLISHED = new Set([300, 403, 404, 410]);

/** Null where the season file does not exist yet, rather than a failed source. */
async function fetchSeasonCsv(http: HttpClient, url: string): Promise<string | null> {
  try {
    return await http.getText(url);
  } catch (error) {
    if (
      error instanceof SourceError &&
      error.status !== undefined &&
      NOT_PUBLISHED.has(error.status)
    ) {
      return null;
    }
    throw error;
  }
}

export interface FootballDataSourceOptions {
  /** Competition code in the provider's scheme. E0 is the Premier League. */
  division?: string;
  url?: string;
  /**
   * Seasons to pull, newest first. Defaults to the season being synced.
   *
   * A closing price is a fact about a match that never changes, so past seasons
   * are worth having and worth having once: they are a backfill, not nightly
   * work. Each lands in its own partition, so adding one never rewrites
   * another, and the partition is what tells a reader which season a quote
   * belongs to, since a quote itself carries only two clubs and a kickoff.
   */
  seasons?: readonly Season[];
}

/** `2025/26` becomes `football-data-2025-26`, which is a legal path segment. */
const partitionFor = (season: Season): string =>
  `football-data-${String(season).replace('/', '-')}`;

/**
 * Historical odds from football-data.co.uk. Declared as requiring `teams` so
 * the provider's club names can be resolved to domain ids at ingest time,
 * rather than leaving every downstream consumer to do string matching.
 */
export function footballDataOddsSource(
  http: HttpClient,
  options: FootballDataSourceOptions = {},
): Source {
  return {
    name: 'odds-football-data',
    datasets: [DATASETS.odds],
    requires: [DATASETS.teams],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      const teams = await context.store.read<Team>(
        { season: context.season, dataset: DATASETS.teams },
        teamSchema,
      );

      const resolveTeam = buildTeamResolver(teams);
      const seasons = options.seasons ?? [context.season];

      for (const season of seasons) {
        const url = options.url ?? footballDataUrl(season, options.division ?? 'E0');
        const csv = await fetchSeasonCsv(http, url);
        if (csv === null) {
          context.logger.warn('odds file not published for this season yet', { season, url });
          continue;
        }

        const quotes = parseFootballDataCsv(csv, { resolveTeam });
        const unresolved = quotes.filter((quote) => quote.homeTeam === null).length;
        context.logger.info('odds parsed', {
          season,
          url,
          quotes: quotes.length,
          unresolvedTeamQuotes: unresolved,
        });

        yield {
          dataset: DATASETS.odds,
          partition: partitionFor(season),
          rows: quotes,
        };
      }
    },
  };
}

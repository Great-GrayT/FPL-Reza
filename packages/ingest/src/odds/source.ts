import { SourceError, teamSchema, type Team } from '@fpl/core';
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
}

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

      const url = options.url ?? footballDataUrl(context.season, options.division ?? 'E0');
      const csv = await fetchSeasonCsv(http, url);
      if (csv === null) {
        context.logger.warn('odds file not published for this season yet', { url });
        return;
      }

      const quotes = parseFootballDataCsv(csv, {
        resolveTeam: buildTeamResolver(teams),
      });

      const unresolved = quotes.filter((quote) => quote.homeTeam === null).length;
      context.logger.info('odds parsed', {
        url,
        quotes: quotes.length,
        unresolvedTeamQuotes: unresolved,
      });

      yield {
        dataset: DATASETS.odds,
        partition: 'football-data',
        rows: quotes,
      };
    },
  };
}

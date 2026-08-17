import { teamSchema, type Team } from '@fpl/core';
import type { HttpClient } from '../http.js';
import { DATASETS, type Source, type SourceBatch, type SourceContext } from '../source.js';
import { footballDataUrl, parseFootballDataCsv } from './football-data.js';
import { buildTeamResolver } from './team-names.js';

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
      const csv = await http.getText(url);
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

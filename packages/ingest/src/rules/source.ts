import { DATASETS, type Source, type SourceBatch, type SourceContext } from '../source.js';
import type { HttpClient } from '../http.js';
import { parseRules } from './parse.js';
import { RULES_URL, type RulesDocument } from './schema.js';

export interface RulesSourceOptions {
  url?: string;
}

/**
 * Rules as a sync source, so a scheduled run picks up deadline moves alongside
 * the API datasets. Interactive refreshes should call `refreshRules` instead,
 * which skips the write when nothing changed and returns a diff to display.
 */
export function rulesSource(http: HttpClient, options: RulesSourceOptions = {}): Source {
  const url = options.url ?? RULES_URL;

  return {
    name: 'fpl-rules',
    datasets: [DATASETS.rules],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      const html = await http.getText(url);
      const document: RulesDocument = parseRules(html, {
        seasonStartYear: Number(context.season.slice(0, 4)),
        fetchedAt: context.capturedAt,
        sourceUrl: url,
      });

      context.logger.debug('rules parsed', {
        parsedFrom: document.parsedFrom,
        deadlines: document.deadlines.length,
        scoringRows: document.scoring.length,
      });

      yield {
        dataset: DATASETS.rules,
        rows: [document],
      };
    },
  };
}

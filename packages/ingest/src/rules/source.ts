import { DATASETS, type Source, type SourceBatch, type SourceContext } from '../source.js';
import type { HttpClient } from '../http.js';
import { parseRules } from './parse.js';
import { isUsableRulesDocument } from './refresh.js';
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

      // Same guard as refreshRules: an empty parse is a page that no longer
      // serves the rules to a plain client, not a season without deadlines.
      // Yielding it would store "no deadlines" as though it were measured.
      if (!isUsableRulesDocument(document)) {
        context.logger.warn('rules page yielded nothing parsable, dataset skipped', {
          parsedFrom: document.parsedFrom,
          url,
        });
        return;
      }

      yield {
        dataset: DATASETS.rules,
        rows: [document],
      };
    },
  };
}

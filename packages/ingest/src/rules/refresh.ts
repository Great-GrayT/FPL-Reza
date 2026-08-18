import { NotFoundError, silentLogger, type Logger, type Season } from '@fpl/core';
import type { SnapshotMeta, Store } from '@fpl/store';
import type { HttpClient } from '../http.js';
import { DATASETS } from '../source.js';
import { diffRules, type RulesDiff } from './diff.js';
import { parseRules } from './parse.js';
import { RULES_URL, rulesDocumentSchema, type RulesDocument } from './schema.js';

export interface RefreshRulesDeps {
  http: HttpClient;
  store: Store;
  season: Season;
  logger?: Logger;
  capturedAt?: Date;
  /** Override for tests or for pointing at an archived copy of the page. */
  url?: string;
  /** Scrape and diff but never write. Set where the store is not writable, for
   * example a serverless host with a read only filesystem. */
  dryRun?: boolean;
}

export interface RefreshRulesResult {
  document: RulesDocument;
  diff: RulesDiff;
  /** Null when nothing changed, because an unchanged page is not rewritten. */
  written: SnapshotMeta | null;
  /**
   * False when the page yielded nothing worth storing. A caller shows this
   * rather than reporting a successful refresh of an empty document.
   */
  usable: boolean;
}

/**
 * A scrape that found no deadlines, no scoring rows, and no BPS rows did not
 * find the rules: it found a page that no longer serves them to a plain HTTP
 * client. As of 2026-08-18 that is exactly what fantasy.premierleague.com does,
 * rendering the rules client side with no tables and no embedded payload. An
 * empty document must never reach the store: it would read back as a rules
 * snapshot, and every consumer would treat "no deadlines" as fact.
 */
export const isUsableRulesDocument = (document: RulesDocument): boolean =>
  document.deadlines.length > 0 || document.scoring.length > 0 || document.bps.length > 0;

/**
 * The rules dataset is always JSONL. The document is a single deeply nested
 * row, and the parquet codec flattens nested values to JSON text, which would
 * not survive a schema checked read.
 */
const RULES_FORMAT = 'jsonl' as const;

/** "2026/27" starts in calendar year 2026. */
const seasonStartYear = (season: Season): number => Number(season.slice(0, 4));

/** Latest stored rules document, or undefined if the page was never scraped. */
export async function readLatestRules(
  store: Store,
  season: Season,
): Promise<RulesDocument | undefined> {
  try {
    const rows = await store.read({ season, dataset: DATASETS.rules }, rulesDocumentSchema);
    return rows[0];
  } catch (error) {
    if (error instanceof NotFoundError) return undefined;
    throw error;
  }
}

/**
 * Scrapes the published rules page, compares it with the stored version, and
 * writes a new snapshot only when something actually changed. This is the
 * operation behind a refresh button: the returned diff is what the caller
 * shows the user.
 */
export async function refreshRules(deps: RefreshRulesDeps): Promise<RefreshRulesResult> {
  const logger = deps.logger ?? silentLogger;
  const url = deps.url ?? RULES_URL;
  const capturedAt = deps.capturedAt ?? new Date();

  const html = await deps.http.getText(url);
  const document = parseRules(html, {
    seasonStartYear: seasonStartYear(deps.season),
    fetchedAt: capturedAt,
    sourceUrl: url,
  });

  const previous = await readLatestRules(deps.store, deps.season);
  const diff = diffRules(previous, document);
  const usable = isUsableRulesDocument(document);

  if (!usable) {
    logger.warn('rules page yielded nothing parsable, not written', {
      parsedFrom: document.parsedFrom,
      url,
    });
    return { document, diff, written: null, usable };
  }

  if (deps.dryRun === true) {
    logger.info('rules checked, not written', { changed: diff.changed });
    return { document, diff, written: null, usable };
  }

  if (!diff.changed) {
    logger.info('rules unchanged', { checksum: document.checksum });
    return { document, diff, written: null, usable };
  }

  const written = await deps.store.write(
    { season: deps.season, dataset: DATASETS.rules },
    [document],
    { capturedAt, format: RULES_FORMAT },
  );

  logger.info('rules updated', {
    changes: diff.changes.length,
    parsedFrom: document.parsedFrom,
    deadlines: document.deadlines.length,
  });

  return { document, diff, written, usable };
}

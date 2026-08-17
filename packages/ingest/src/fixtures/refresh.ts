import {
  NotFoundError,
  fixtureSchema,
  silentLogger,
  type Fixture,
  type Logger,
  type Season,
} from '@fpl/core';
import type { Format, SnapshotMeta, Store } from '@fpl/store';
import { FplClient } from '../fpl/client.js';
import { toFixture } from '../fpl/map.js';
import type { HttpClient } from '../http.js';
import { DATASETS } from '../source.js';
import { diffFixtures, type FixturesDiff } from './diff.js';

export interface RefreshFixturesDeps {
  http: HttpClient;
  store: Store;
  season: Season;
  logger?: Logger;
  capturedAt?: Date;
  format?: Format;
  /** Write a snapshot even when nothing moved. Off by default: a fixture list
   * polled every few minutes would otherwise fill the lake with identical
   * snapshots, and history is only useful where it records a change. */
  always?: boolean;
  /** Fetch and diff but never write. Set where the store is not writable, for
   * example a serverless host with a read only filesystem, so a caller still
   * learns what moved instead of getting a filesystem error. */
  dryRun?: boolean;
}

export interface RefreshFixturesResult {
  fixtures: readonly Fixture[];
  diff: FixturesDiff;
  /** Null when nothing changed and `always` was not set. */
  written: SnapshotMeta | null;
}

/** Latest stored fixtures, or undefined if the dataset was never written. */
export async function readLatestFixtures(
  store: Store,
  season: Season,
): Promise<Fixture[] | undefined> {
  try {
    return await store.read<Fixture>({ season, dataset: DATASETS.fixtures }, fixtureSchema);
  } catch (error) {
    if (error instanceof NotFoundError) return undefined;
    throw error;
  }
}

/**
 * Refetches the fixture list, diffs it against the stored one, and writes only
 * when something moved. Fixtures are the most volatile dataset in the lake:
 * kickoff times shift for broadcast, postponed matches lose and regain a
 * gameweek, and scores land live. That makes this the one dataset worth
 * refreshing on its own rather than only inside a full sync.
 */
export async function refreshFixtures(deps: RefreshFixturesDeps): Promise<RefreshFixturesResult> {
  const logger = deps.logger ?? silentLogger;
  const capturedAt = deps.capturedAt ?? new Date();

  const client = new FplClient(deps.http);
  const fixtures = (await client.fixtures()).map(toFixture);

  const previous = await readLatestFixtures(deps.store, deps.season);
  const diff = diffFixtures(previous, fixtures);

  if (deps.dryRun === true) {
    logger.info('fixtures checked, not written', { changed: diff.changed });
    return { fixtures, diff, written: null };
  }

  if (!diff.changed && deps.always !== true) {
    logger.info('fixtures unchanged', { fixtures: fixtures.length });
    return { fixtures, diff, written: null };
  }

  const written = await deps.store.write(
    { season: deps.season, dataset: DATASETS.fixtures },
    fixtures,
    { capturedAt, ...(deps.format === undefined ? {} : { format: deps.format }) },
  );

  logger.info('fixtures updated', {
    added: diff.added,
    removed: diff.removed,
    updated: diff.updated,
  });

  return { fixtures, diff, written };
}

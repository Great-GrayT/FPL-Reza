import { createLogger, type Logger } from '@fpl/core';
import { loadConfig, type Config } from '@fpl/config';
import path from 'node:path';
import { FileStore } from '@fpl/store';
import { HttpClient } from '@fpl/ingest';
import { FileAssetStore, type AssetStore } from '@fpl/assets';

/**
 * Every route reads its dependencies from here rather than importing config or
 * the store directly, so a test can substitute a temp directory store and a
 * stub http client without touching route code.
 */
export interface Deps {
  store: FileStore;
  /** Blob side of the lake: badges, shirts, and player photos. */
  assets: AssetStore;
  config: Config;
  logger: Logger;
  http: HttpClient;
}

/** Assets sit beside the row snapshots, so one mounted volume carries both. */
export const assetRootFor = (dataDir: string): string => path.join(dataDir, 'assets');

/** Builds the real dependencies from the process environment. */
export function createDeps(): Deps {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const store = new FileStore({ root: config.dataDir });
  const http = new HttpClient({
    baseUrl: config.fpl.baseUrl,
    timeoutMs: config.fpl.timeoutMs,
    retries: config.fpl.retries,
    minRequestIntervalMs: config.fpl.minRequestIntervalMs,
    userAgent: config.fpl.userAgent,
    logger,
  });
  const assets = new FileAssetStore({ root: assetRootFor(config.dataDir) });
  return { store, assets, config, logger, http };
}

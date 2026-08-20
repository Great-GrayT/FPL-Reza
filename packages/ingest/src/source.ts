import type { Logger, Season } from '@fpl/core';
import type { Format, Store } from '@fpl/store';

/** Canonical dataset names. One source may write several of them. */
export const DATASETS = {
  teams: 'teams',
  players: 'players',
  gameweeks: 'gameweeks',
  fixtures: 'fixtures',
  playerGameweeks: 'player-gameweeks',
  playerSeasons: 'player-seasons',
  playerGameweeksHistory: 'player-gameweeks-history',
  teamSeasons: 'team-seasons',
  playerProviderIds: 'player-provider-ids',
  internationals: 'internationals',
  rules: 'rules',
  odds: 'odds',
  ownership: 'ownership',
  clubTransfers: 'club-transfers',
  playerMatchSpatial: 'player-match-spatial',
  matchEvents: 'match-events',
  matches: 'matches',
  matchDetails: 'match-details',
  managers: 'managers',
  managerSpells: 'manager-spells',
  grounds: 'grounds',
  groundImages: 'ground-images',
  matchWeather: 'match-weather',
} as const;

export type DatasetName = (typeof DATASETS)[keyof typeof DATASETS];

export interface SourceContext {
  season: Season;
  store: Store;
  logger: Logger;
  /** Capture time stamped on every snapshot in one run, so a run is atomic in time. */
  capturedAt: Date;
}

/** One writable unit: a dataset, optionally split into partitions. */
export interface SourceBatch {
  dataset: string;
  partition?: string;
  rows: readonly Record<string, unknown>[];
  /**
   * Codec this batch needs, overriding the run's default. A deeply nested row
   * (a teamsheet, a rules document) has to be JSONL, because the Parquet codec
   * flattens nested values to JSON text that cannot be read back through the
   * schema. A wide flat row of 13,000 results has to be Parquet, because the
   * lake is committed to git. Neither is a preference the caller should have
   * to know, so the source that produces the row states it.
   */
  format?: Format;
}

/**
 * A source is anything that can produce normalised rows: the public FPL API,
 * a private feed, a scraped PDF, a tracking provider's event export. The sync
 * runner knows nothing beyond this interface, so adding a source never means
 * editing the pipeline.
 */
export interface Source {
  readonly name: string;
  /** Datasets this source writes. Used for reporting and selective syncs. */
  readonly datasets: readonly string[];
  /** Datasets that must already exist in the store before this source runs. */
  readonly requires?: readonly string[];
  run(context: SourceContext): AsyncIterable<SourceBatch>;
}

export class SourceRegistry {
  private readonly sources = new Map<string, Source>();

  register(source: Source): this {
    if (this.sources.has(source.name)) {
      throw new Error(`source "${source.name}" is already registered`);
    }
    this.sources.set(source.name, source);
    return this;
  }

  get(name: string): Source | undefined {
    return this.sources.get(name);
  }

  all(): Source[] {
    return [...this.sources.values()];
  }

  names(): string[] {
    return [...this.sources.keys()];
  }
}

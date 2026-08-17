import type { Season } from '@fpl/core';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Schemas are accepted with an `unknown` input so branded schemas fit: their
 * declared input type is the unbranded shape, which would not match a plain
 * `ZodType<T>`.
 */
export type RowSchema<T> = ZodType<T, ZodTypeDef, unknown>;

export const FORMATS = ['jsonl', 'parquet'] as const;
export type Format = (typeof FORMATS)[number];

/**
 * Addresses a dataset within a season. `partition` splits a dataset that is
 * fetched piecemeal, for example one file per gameweek.
 */
export interface SnapshotKey {
  season: Season;
  dataset: string;
  partition?: string;
}

/** Recorded in the dataset manifest for every write. Snapshots are immutable. */
export interface SnapshotMeta {
  season: Season;
  dataset: string;
  partition: string | null;
  capturedAt: Date;
  rows: number;
  bytes: number;
  format: Format;
  /** Path relative to the store root, so manifests survive a move of the lake. */
  file: string;
}

export interface WriteOptions {
  format?: Format;
  capturedAt?: Date;
}

export interface ReadOptions {
  /** Read a specific snapshot instead of the latest one. */
  capturedAt?: Date;
}

/**
 * Storage port. Ingest and analytics depend on this interface only, so a
 * database backed implementation can replace the file one without changes
 * upstream.
 */
export interface Store {
  write(
    key: SnapshotKey,
    rows: readonly Record<string, unknown>[],
    options?: WriteOptions,
  ): Promise<SnapshotMeta>;

  read<T>(key: SnapshotKey, schema: RowSchema<T>, options?: ReadOptions): Promise<T[]>;

  /** Most recent snapshot for the key, or undefined if never written. */
  latest(key: SnapshotKey): Promise<SnapshotMeta | undefined>;

  /** Every snapshot for the key, oldest first. */
  history(key: SnapshotKey): Promise<SnapshotMeta[]>;

  datasets(season: Season): Promise<string[]>;

  /**
   * Partition names written for a dataset, sorted. Without this a caller has
   * to guess partition names and probe for them, which costs one read per
   * guess and silently misses any partition it did not think of.
   */
  partitions(key: { season: Season; dataset: string }): Promise<string[]>;
}

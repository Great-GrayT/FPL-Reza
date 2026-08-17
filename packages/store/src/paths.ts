import path from 'node:path';
import type { Season } from '@fpl/core';
import type { SnapshotKey } from './types.js';

/** "2026/27" is not a legal path segment on any platform. */
export const seasonSlug = (season: Season): string => season.replace('/', '-');

export const PARTITION_NONE = '_all';

export const partitionSlug = (partition: string | undefined): string =>
  partition === undefined || partition === '' ? PARTITION_NONE : sanitize(partition);

/** Colons are illegal in Windows filenames, so ISO timestamps get flattened. */
export const timestampSlug = (at: Date): string => at.toISOString().replace(/[:.]/g, '-');

export const MANIFEST_FILE = '_manifest.json';

export const datasetDir = (root: string, season: Season, dataset: string): string =>
  path.join(root, seasonSlug(season), sanitize(dataset));

export const manifestPath = (root: string, season: Season, dataset: string): string =>
  path.join(datasetDir(root, season, dataset), MANIFEST_FILE);

export function snapshotRelativePath(
  key: SnapshotKey,
  capturedAt: Date,
  extension: string,
): string {
  return path.posix.join(
    seasonSlug(key.season),
    sanitize(key.dataset),
    partitionSlug(key.partition),
    `${timestampSlug(capturedAt)}.${extension}`,
  );
}

/** Dataset and partition names come from upstream sources, so never trust them as paths. */
function sanitize(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_');
}

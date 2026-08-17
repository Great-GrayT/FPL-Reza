import { silentLogger, type Logger } from '@fpl/core';
import { badgeSvgUrl, badgeUrl, playerPhotoUrl, shirtUrl, type AssetKind } from './urls.js';
import type { AssetFetcher, AssetStore } from './types.js';

/** Only the identity field an asset URL is built from, so a partial row works. */
export interface AssetSubject {
  code: number;
}

export interface AssetSyncDeps {
  fetcher: AssetFetcher;
  store: AssetStore;
  teams: readonly AssetSubject[];
  players: readonly AssetSubject[];
  logger?: Logger;
  /** Refetch assets the manifest already holds. Off by default: a rerun should
   * cost nothing, and these files change only when a player or badge changes. */
  force?: boolean;
  kinds?: readonly AssetKind[];
  /** Log a progress line every N attempted assets. */
  progressEvery?: number;
}

export interface AssetSyncReport {
  attempted: number;
  downloaded: number;
  skipped: number;
  /** Upstream has no such file. Expected for players without a published photo. */
  missing: number;
  bytes: number;
  durationMs: number;
  missingKeys: readonly string[];
}

const DEFAULT_KINDS: readonly AssetKind[] = [
  'team-badge-svg',
  'team-badge',
  'team-shirt',
  'player-photo',
];

interface Job {
  kind: AssetKind;
  key: string;
  /** Tried in order. The first that exists wins, so a smaller published size
   * still yields an asset rather than a gap. */
  candidates: readonly string[];
  accept: string;
}

/**
 * The CDN sometimes answers 200 with a near empty file where a photo was
 * pulled but the object was not removed. Anything this small is not an image,
 * so it falls through to the next candidate size instead of being stored as
 * a valid asset that renders as a broken box.
 */
const MIN_IMAGE_BYTES = 512;

export async function syncAssets(deps: AssetSyncDeps): Promise<AssetSyncReport> {
  const logger = deps.logger ?? silentLogger;
  const kinds = new Set(deps.kinds ?? DEFAULT_KINDS);
  const progressEvery = deps.progressEvery ?? 50;
  const startedAt = Date.now();

  const jobs = buildJobs(deps.teams, deps.players, kinds);
  const missingKeys: string[] = [];
  let downloaded = 0;
  let skipped = 0;
  let missing = 0;
  let bytes = 0;

  for (const [index, job] of jobs.entries()) {
    if (deps.force !== true && (await deps.store.get(job.kind, job.key)) !== undefined) {
      skipped += 1;
      continue;
    }

    const found = await firstAvailable(deps.fetcher, job);
    if (found === null) {
      missing += 1;
      missingKeys.push(`${job.kind}/${job.key}`);
    } else {
      const record = await deps.store.put(job.kind, job.key, found);
      downloaded += 1;
      bytes += record.bytes;
    }

    if (progressEvery > 0 && (index + 1) % progressEvery === 0) {
      logger.info('asset progress', { done: index + 1, of: jobs.length, downloaded, missing });
    }
  }

  return {
    attempted: jobs.length,
    downloaded,
    skipped,
    missing,
    bytes,
    durationMs: Date.now() - startedAt,
    missingKeys,
  };
}

function buildJobs(
  teams: readonly AssetSubject[],
  players: readonly AssetSubject[],
  kinds: ReadonlySet<AssetKind>,
): Job[] {
  const jobs: Job[] = [];

  for (const team of teams) {
    const key = String(team.code);
    if (kinds.has('team-badge-svg')) {
      jobs.push({
        kind: 'team-badge-svg',
        key,
        candidates: [badgeSvgUrl(team.code)],
        accept: 'image/svg+xml,image/*',
      });
    }
    if (kinds.has('team-badge')) {
      jobs.push({
        kind: 'team-badge',
        key,
        candidates: [badgeUrl(team.code, 100), badgeUrl(team.code, 50)],
        accept: 'image/png,image/*',
      });
    }
    if (kinds.has('team-shirt')) {
      jobs.push({
        kind: 'team-shirt',
        key,
        candidates: [shirtUrl(team.code)],
        accept: 'image/png,image/*',
      });
      jobs.push({
        kind: 'team-shirt',
        key: `${key}_gk`,
        candidates: [shirtUrl(team.code, { keeper: true })],
        accept: 'image/png,image/*',
      });
    }
  }

  if (kinds.has('player-photo')) {
    for (const player of players) {
      jobs.push({
        kind: 'player-photo',
        key: String(player.code),
        candidates: [
          playerPhotoUrl(player.code, '250x250'),
          playerPhotoUrl(player.code, '110x140'),
        ],
        accept: 'image/png,image/*',
      });
    }
  }

  return jobs;
}

async function firstAvailable(
  fetcher: AssetFetcher,
  job: Job,
): Promise<{ bytes: Uint8Array; contentType: string | null; sourceUrl: string } | null> {
  for (const url of job.candidates) {
    const response = await fetcher.tryGetBytes(url, job.accept);
    if (response === null || response.bytes.byteLength < MIN_IMAGE_BYTES) continue;
    return { ...response, sourceUrl: url };
  }
  return null;
}

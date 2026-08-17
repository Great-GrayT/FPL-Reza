import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Season } from '@fpl/core';
import { NotFoundError, ValidationError } from '@fpl/core';
import { codecFor } from './codecs/index.js';
import { byCapturedAt, emptyManifest, parseManifest, type Manifest } from './manifest.js';
import { datasetDir, manifestPath, seasonSlug, snapshotRelativePath } from './paths.js';
import type {
  Format,
  ReadOptions,
  RowSchema,
  SnapshotKey,
  SnapshotMeta,
  Store,
  WriteOptions,
} from './types.js';

export interface FileStoreOptions {
  /** Root of the data lake. Created on first write. */
  root: string;
  defaultFormat?: Format;
  now?: () => Date;
}

/** How many schema failures to report before giving up on a read. */
const MAX_REPORTED_ISSUES = 10;

/**
 * Snapshot oriented flat file store. Every write lands a new immutable file
 * and appends to the dataset manifest, so a bad sync never destroys the last
 * good data and history stays queryable.
 *
 * Single writer per dataset is assumed. Concurrent syncs of the same dataset
 * would race on the manifest.
 */
export class FileStore implements Store {
  readonly root: string;
  private readonly defaultFormat: Format;
  private readonly now: () => Date;

  constructor(options: FileStoreOptions) {
    this.root = options.root;
    this.defaultFormat = options.defaultFormat ?? 'jsonl';
    this.now = options.now ?? ((): Date => new Date());
  }

  async write(
    key: SnapshotKey,
    rows: readonly Record<string, unknown>[],
    options: WriteOptions = {},
  ): Promise<SnapshotMeta> {
    const format = options.format ?? this.defaultFormat;
    const capturedAt = options.capturedAt ?? this.now();
    const codec = codecFor(format);
    const bytes = await codec.encode(rows);

    const relative = snapshotRelativePath(key, capturedAt, codec.extension);
    const absolute = path.join(this.root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });

    // Write then rename so a crash mid write cannot leave a half file that
    // the manifest already points at.
    const temporary = `${absolute}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, absolute);

    const meta: SnapshotMeta = {
      season: key.season,
      dataset: key.dataset,
      partition: key.partition ?? null,
      capturedAt,
      rows: rows.length,
      bytes: bytes.byteLength,
      format,
      file: relative,
    };

    await this.appendToManifest(key.season, key.dataset, meta);
    return meta;
  }

  async read<T>(key: SnapshotKey, schema: RowSchema<T>, options: ReadOptions = {}): Promise<T[]> {
    const meta = await this.resolve(key, options.capturedAt);
    if (meta === undefined) {
      throw new NotFoundError(`snapshot ${describe(key)}`);
    }

    const bytes = await readFile(path.join(this.root, meta.file));
    const codec = codecFor(meta.format);
    const raw = await codec.decode(new Uint8Array(bytes));

    const parsed: T[] = [];
    const issues: string[] = [];
    for (const [index, row] of raw.entries()) {
      const result = schema.safeParse(row);
      if (result.success) {
        parsed.push(result.data);
      } else if (issues.length < MAX_REPORTED_ISSUES) {
        issues.push(
          `row ${index}: ${result.error.issues
            .map((issue) => `${issue.path.join('.')} ${issue.message}`)
            .join('; ')}`,
        );
      }
    }

    if (issues.length > 0) {
      throw new ValidationError(`snapshot ${describe(key)} failed validation`, issues);
    }
    return parsed;
  }

  async latest(key: SnapshotKey): Promise<SnapshotMeta | undefined> {
    return this.resolve(key, undefined);
  }

  async history(key: SnapshotKey): Promise<SnapshotMeta[]> {
    const manifest = await this.readManifest(key.season, key.dataset);
    const partition = key.partition ?? null;
    return manifest.snapshots
      .filter((snapshot) => snapshot.partition === partition)
      .sort(byCapturedAt);
  }

  async datasets(season: Season): Promise<string[]> {
    const dir = path.join(this.root, seasonSlug(season));
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async partitions(key: { season: Season; dataset: string }): Promise<string[]> {
    const manifest = await this.readManifest(key.season, key.dataset);
    const names = new Set<string>();
    for (const snapshot of manifest.snapshots) {
      if (snapshot.partition !== null) names.add(snapshot.partition);
    }
    return [...names].sort();
  }

  private async resolve(
    key: SnapshotKey,
    capturedAt: Date | undefined,
  ): Promise<SnapshotMeta | undefined> {
    const snapshots = await this.history(key);
    if (capturedAt === undefined) return snapshots.at(-1);
    const wanted = capturedAt.getTime();
    return snapshots.find((snapshot) => snapshot.capturedAt.getTime() === wanted);
  }

  private async readManifest(season: Season, dataset: string): Promise<Manifest> {
    try {
      const text = await readFile(manifestPath(this.root, season, dataset), 'utf8');
      return parseManifest(text);
    } catch (error) {
      if (isMissing(error)) return emptyManifest();
      throw error;
    }
  }

  private async appendToManifest(
    season: Season,
    dataset: string,
    meta: SnapshotMeta,
  ): Promise<void> {
    const manifest = await this.readManifest(season, dataset);
    manifest.snapshots.push(meta);
    manifest.snapshots.sort(byCapturedAt);

    const target = manifestPath(this.root, season, dataset);
    await mkdir(datasetDir(this.root, season, dataset), { recursive: true });
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
  }
}

const describe = (key: SnapshotKey): string =>
  `${key.season}/${key.dataset}${key.partition === undefined ? '' : `/${key.partition}`}`;

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

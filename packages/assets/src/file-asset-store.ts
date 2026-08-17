import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ValidationError } from '@fpl/core';
import type { AssetKind } from './urls.js';
import { assetRecordSchema, type AssetBody, type AssetRecord, type AssetStore } from './types.js';

/**
 * The manifest is append only, one record per line, last write winning per
 * key. A rewrite-the-whole-file manifest costs O(n squared) writes across a
 * sync of several hundred images, and on Windows the resulting rename churn on
 * one path intermittently fails with EPERM while a scanner holds the file.
 * Appending a line does neither.
 */
const MANIFEST_FILE = '_manifest.jsonl';

/** Extension by content type, so a file keeps the type the CDN actually sent. */
const EXTENSIONS = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/svg+xml', '.svg'],
]);

export interface FileAssetStoreOptions {
  /** Directory the blobs and their manifest live under. */
  root: string;
}

export class FileAssetStore implements AssetStore {
  readonly root: string;
  /** Loaded once and kept current in memory: a manifest reread per asset would
   * dominate the cost of a sync that writes hundreds of small files. */
  private entries: Map<string, AssetRecord> | undefined;

  constructor(options: FileAssetStoreOptions) {
    this.root = path.resolve(options.root);
  }

  async put(kind: AssetKind, key: string, body: AssetBody, at = new Date()): Promise<AssetRecord> {
    const entries = await this.load();
    const safeKey = sanitise(key);
    const extension = extensionFor(body.contentType);
    const relative = `${kind}/${safeKey}${extension}`;
    const absolute = path.join(this.root, kind, `${safeKey}${extension}`);

    await mkdir(path.dirname(absolute), { recursive: true });
    const temporary = `${absolute}.tmp`;
    await writeFile(temporary, body.bytes);
    await rename(temporary, absolute);

    const record: AssetRecord = {
      kind,
      key: safeKey,
      file: relative,
      contentType: body.contentType ?? 'application/octet-stream',
      bytes: body.bytes.byteLength,
      sha256: createHash('sha256').update(body.bytes).digest('hex'),
      sourceUrl: body.sourceUrl,
      fetchedAt: at,
    };

    entries.set(indexKey(kind, safeKey), record);
    await this.append(record);
    return record;
  }

  async get(kind: AssetKind, key: string): Promise<AssetRecord | undefined> {
    const entries = await this.load();
    return entries.get(indexKey(kind, sanitise(key)));
  }

  async list(kind?: AssetKind): Promise<AssetRecord[]> {
    const entries = await this.load();
    const all = [...entries.values()];
    const scoped = kind === undefined ? all : all.filter((entry) => entry.kind === kind);
    return scoped.sort((a, b) => a.file.localeCompare(b.file));
  }

  async read(kind: AssetKind, key: string): Promise<Uint8Array | undefined> {
    const record = await this.get(kind, key);
    if (record === undefined) return undefined;
    try {
      return new Uint8Array(await readFile(path.join(this.root, ...record.file.split('/'))));
    } catch {
      // The manifest can outlive its files if the directory was pruned by hand.
      return undefined;
    }
  }

  private async load(): Promise<Map<string, AssetRecord>> {
    if (this.entries !== undefined) return this.entries;

    let raw: string;
    try {
      raw = await readFile(path.join(this.root, MANIFEST_FILE), 'utf8');
    } catch {
      // Never written is the normal first run, not an error.
      this.entries = new Map();
      return this.entries;
    }

    const entries = new Map<string, AssetRecord>();
    const issues: string[] = [];

    for (const [index, line] of raw.split('\n').entries()) {
      if (line.trim() === '') continue;
      const parsed = assetRecordSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        issues.push(`line ${String(index + 1)}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
        continue;
      }
      // Later lines supersede earlier ones for the same asset, which is what
      // makes a forced refetch overwrite rather than duplicate.
      entries.set(indexKey(parsed.data.kind, parsed.data.key), parsed.data);
    }

    if (issues.length > 0) {
      throw new ValidationError(`asset manifest at ${this.root} is not readable`, issues);
    }

    this.entries = entries;
    return this.entries;
  }

  private async append(record: AssetRecord): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await appendFile(path.join(this.root, MANIFEST_FILE), `${JSON.stringify(record)}\n`, 'utf8');
  }
}

const indexKey = (kind: AssetKind, key: string): string => `${kind}/${key}`;

/** Keys reach here as upstream codes, so they are constrained before use in a path. */
const sanitise = (value: string): string => value.replace(/[^A-Za-z0-9._-]/g, '_');

function extensionFor(contentType: string | null): string {
  if (contentType === null) return '.bin';
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return EXTENSIONS.get(base) ?? '.bin';
}

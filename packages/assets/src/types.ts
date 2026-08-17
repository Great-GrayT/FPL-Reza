import { z } from 'zod';
import { ASSET_KINDS, type AssetKind } from './urls.js';

export const assetKindSchema = z.enum(ASSET_KINDS);

export const assetRecordSchema = z.object({
  kind: assetKindSchema,
  /** Identifies the asset within its kind. A stable FPL `code`, as a string. */
  key: z.string().min(1),
  /** Location under the asset root, always with forward slashes. */
  file: z.string().min(1),
  contentType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  /** Content hash, so an unchanged remote file is not rewritten. */
  sha256: z.string().length(64),
  sourceUrl: z.string().url(),
  fetchedAt: z.coerce.date(),
});

export type AssetRecord = z.infer<typeof assetRecordSchema>;

export interface AssetBody {
  bytes: Uint8Array;
  contentType: string | null;
  sourceUrl: string;
}

/**
 * A blob side to the data lake. Kept apart from `@fpl/store` on purpose: that
 * port moves schema validated rows, and an image is neither a row nor
 * validatable, so folding it in would weaken the row contract for no gain.
 */
export interface AssetStore {
  /** Absolute path the served files live under. */
  readonly root: string;
  put(kind: AssetKind, key: string, body: AssetBody, at?: Date): Promise<AssetRecord>;
  get(kind: AssetKind, key: string): Promise<AssetRecord | undefined>;
  list(kind?: AssetKind): Promise<AssetRecord[]>;
  read(kind: AssetKind, key: string): Promise<Uint8Array | undefined>;
}

/**
 * The single network capability the sync needs. `HttpClient` from
 * `@fpl/ingest` satisfies it structurally, so this package depends on no
 * transport and stays trivially testable.
 */
export interface AssetFetcher {
  tryGetBytes(
    url: string,
    accept?: string,
  ): Promise<{ bytes: Uint8Array; contentType: string | null } | null>;
}

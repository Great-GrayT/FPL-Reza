import { z } from 'zod';
import { ValidationError, seasonSchema } from '@fpl/core';
import { FORMATS, type SnapshotMeta } from './types.js';

export const snapshotMetaSchema = z.object({
  season: seasonSchema,
  dataset: z.string().min(1),
  partition: z.string().nullable(),
  capturedAt: z.coerce.date(),
  rows: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  format: z.enum(FORMATS),
  file: z.string().min(1),
});

export const MANIFEST_VERSION = 1;

export const manifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  snapshots: z.array(snapshotMetaSchema),
});

export type Manifest = z.infer<typeof manifestSchema>;

export function parseManifest(text: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new ValidationError('manifest is not valid JSON', [], { cause });
  }

  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(
      'manifest failed validation',
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}

export const emptyManifest = (): Manifest => ({ version: MANIFEST_VERSION, snapshots: [] });

/** Oldest first, so `at(-1)` is always the newest snapshot. */
export const byCapturedAt = (a: SnapshotMeta, b: SnapshotMeta): number =>
  a.capturedAt.getTime() - b.capturedAt.getTime();

import type { Format, SnapshotMeta } from '@fpl/store';
import type { Source, SourceContext } from './source.js';

export interface SyncOptions {
  /** Storage format for every snapshot this run writes. */
  format?: Format;
  /** Keep going after a source fails. Defaults to stopping on the first error. */
  continueOnError?: boolean;
}

export interface SourceRun {
  source: string;
  written: SnapshotMeta[];
  rows: number;
  durationMs: number;
  error?: string;
}

export interface SyncReport {
  runs: SourceRun[];
  rows: number;
  failed: number;
  durationMs: number;
}

/**
 * Runs sources in dependency order and writes every batch they yield. Sources
 * are ordered by the datasets they declare: a source that requires `players`
 * runs only after the source producing `players` has finished writing.
 */
export async function runSync(
  sources: readonly Source[],
  context: SourceContext,
  options: SyncOptions = {},
): Promise<SyncReport> {
  const ordered = orderByDependencies(sources);
  const runs: SourceRun[] = [];
  const startedAt = Date.now();

  for (const source of ordered) {
    const sourceStartedAt = Date.now();
    const logger = context.logger.child({ source: source.name });
    const written: SnapshotMeta[] = [];
    let rows = 0;

    try {
      for await (const batch of source.run({ ...context, logger })) {
        const meta = await context.store.write(
          {
            season: context.season,
            dataset: batch.dataset,
            ...(batch.partition === undefined ? {} : { partition: batch.partition }),
          },
          batch.rows,
          {
            capturedAt: context.capturedAt,
            // The batch wins: a source that names a codec does so because its
            // row shape only survives that one.
            ...(batch.format !== undefined
              ? { format: batch.format }
              : options.format === undefined
                ? {}
                : { format: options.format }),
          },
        );
        written.push(meta);
        rows += meta.rows;
        logger.info('wrote snapshot', {
          dataset: meta.dataset,
          partition: meta.partition ?? '',
          rows: meta.rows,
          bytes: meta.bytes,
        });
      }

      runs.push({
        source: source.name,
        written,
        rows,
        durationMs: Date.now() - sourceStartedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('source failed', { error: message });
      runs.push({
        source: source.name,
        written,
        rows,
        durationMs: Date.now() - sourceStartedAt,
        error: message,
      });
      if (options.continueOnError !== true) break;
    }
  }

  return {
    runs,
    rows: runs.reduce((sum, run) => sum + run.rows, 0),
    failed: runs.filter((run) => run.error !== undefined).length,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Topological sort over declared datasets. A requirement no source in this run
 * produces is assumed to be already in the store, so it never blocks.
 */
export function orderByDependencies(sources: readonly Source[]): Source[] {
  const produced = new Set(sources.flatMap((source) => source.datasets));
  const done = new Set<string>();
  const pending = [...sources];
  const ordered: Source[] = [];

  while (pending.length > 0) {
    const index = pending.findIndex((source) =>
      (source.requires ?? []).every((dataset) => !produced.has(dataset) || done.has(dataset)),
    );

    // A cycle leaves nothing runnable. Emit the rest in declaration order
    // rather than deadlocking; the failure will surface at read time.
    const next = index === -1 ? pending.shift() : pending.splice(index, 1)[0];
    if (next === undefined) break;

    ordered.push(next);
    for (const dataset of next.datasets) done.add(dataset);
  }

  return ordered;
}

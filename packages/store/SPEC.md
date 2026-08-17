---
title: Store spec
type: spec
module: packages/store
updated: 2026-08-16
status: active
---

## Purpose

A snapshot oriented flat file data lake, addressed by season, dataset, and optional partition, written through a codec (JSONL or Parquet) and tracked by a per dataset manifest, exposed behind the Store port (write, read, latest, history, datasets, partitions) so a non file backed implementation could replace it.

## Methods

### FileStore.write(key, rows, options?): Promise<SnapshotMeta>

In: a SnapshotKey (season, dataset, optional partition), the rows to write, and optional format/capturedAt overrides. Out: the SnapshotMeta just recorded. Errors: propagates any filesystem error. Notes: encodes with the chosen codec, writes to a .tmp file, renames it into place, then appends the resulting SnapshotMeta to the dataset's _manifest.json.

### FileStore.read<T>(key, schema, options?): Promise<T[]>

In: a SnapshotKey, a Zod row schema, and an optional capturedAt to pick a specific snapshot instead of the latest. Out: the parsed rows. Errors: throws NotFoundError if no snapshot matches the key (or the requested capturedAt); throws ValidationError if any row fails schema.safeParse, listing up to 10 row level issues. Notes: a single bad row fails the whole read, there is no partial success.

### FileStore.latest(key): Promise<SnapshotMeta | undefined>

In: a SnapshotKey. Out: the newest SnapshotMeta for that key, or undefined if nothing was ever written. Errors: none.

### FileStore.history(key): Promise<SnapshotMeta[]>

In: a SnapshotKey. Out: every SnapshotMeta for that key's partition, oldest first. Errors: none.

### FileStore.datasets(season): Promise<string[]>

In: a Season. Out: the sorted names of every dataset directory that exists for that season. Errors: none, an absent season directory yields an empty array rather than throwing.

### FileStore.partitions(key): Promise<string[]>

In: a season and dataset (no partition field). Out: every distinct partition name ever written for that dataset, sorted. Errors: none, a dataset never written, or written only without a partition, yields an empty array. Notes: exists so a caller does not have to guess partition names and probe for them one at a time, which costs one read per guess and silently misses any partition it did not think to try.

### codecFor(format) / codecForExtension(extension)

In: a Format (jsonl or parquet), or a file extension string. Out: the matching Codec. Errors: throws NotFoundError if no codec matches.

### jsonlCodec.encode(rows) / jsonlCodec.decode(bytes)

In: rows, or raw bytes. Out: newline delimited JSON bytes, or parsed rows. Errors: decode throws ValidationError on a line that is not valid JSON, naming the 1 indexed line number.

### parquetCodec.encode(rows) / parquetCodec.decode(bytes)

In: rows, or raw bytes. Out: a Parquet file's bytes, or parsed rows. Errors: none thrown directly; malformed input is handled by the underlying hyparquet library.

## Logic

Column type inference in parquetCodec picks the narrowest of BOOLEAN, INT32, DOUBLE, or STRING that fits every non null value in a column: all booleans becomes BOOLEAN, all numbers becomes INT32 if every value is a safe integer within the 32 bit signed range and DOUBLE otherwise, anything else becomes STRING. A column with no values at all defaults to STRING. Anything that does not fit its column's inferred type is coerced to STRING as JSON text at encode time.

Dates never reach a codec directly: serializeValue turns every Date into an ISO string before either codec sees it, and every schema reads dates back with z.coerce.date(), so the round trip is lossless and format independent.

An empty dataset write (zero rows) produces a zero byte file for both codecs when there are no columns to describe; parquetCodec.decode returns an empty array immediately for a zero byte file rather than asking hyparquet to parse it.

The manifest is versioned (MANIFEST_VERSION is 1) and schema validated on every read; a dataset that was never written is treated as an empty manifest rather than a missing file error, so FileStore.datasets and FileStore.history never throw for an absent dataset, only FileStore.read does (via NotFoundError, once resolve finds no matching snapshot).

FileStore.partitions is a plain manifest scan: it collects every non null partition value across the dataset's recorded snapshots into a Set, then sorts it, so the result reflects exactly what was written, not a hardcoded naming scheme such as gw1, gw2, and so on. apps/api's player history route uses it directly; apps/cli's equivalent commands predate this method and still probe a fixed gameweek range instead, see the CLI spec.

Path construction sanitises every dataset and partition segment to the character set letters, digits, dot, underscore, and hyphen, since those names can come from an upstream source rather than from trusted code. Season labels have their slash replaced with a hyphen (2026/27 becomes 2026-27) since a literal slash is not a legal single path segment, and capture timestamps have their colons and dots replaced with hyphens since colons are illegal in Windows filenames.

FileStore.read caps how many row level validation issues it reports at 10 (MAX_REPORTED_ISSUES), even if every row in a large snapshot fails.

## Data flow

rows array -> FileStore.write -> codec.encode -> temp file -> atomic rename -> manifest append -> SnapshotMeta returned to the caller.

SnapshotKey plus an optional capturedAt -> FileStore.read resolves the matching SnapshotMeta from the manifest -> reads that file's bytes -> codec.decode -> schema.safeParse per row -> validated rows, or a ValidationError describing every failing row up to the cap.

## Dependencies

Internal: @fpl/core (Season type, NotFoundError, ValidationError).

External: hyparquet, hyparquet-writer, zod, node's fs/promises and path modules.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Store skill](SKILL.md): purpose and constraints in brief.
- [Core spec](../core/SPEC.md): supplies the Season type and the error classes this package throws.
- [Ingest spec](../ingest/SPEC.md): every Source writes through this package's Store port during a sync run.
- [API spec](../../apps/api/SPEC.md): every route reads through a FileStore built in apps/api/src/deps.ts, and the player history route calls partitions directly.
- [CLI spec](../../apps/cli/SPEC.md): every command reads or writes through a FileStore built in apps/cli/src/bin.ts.

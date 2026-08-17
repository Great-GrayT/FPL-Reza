---
title: Store skill
type: skill
module: packages/store
updated: 2026-08-16
status: active
---

## Purpose

Owns the Store port (the write, read, latest, history, datasets, partitions interface) and its one implementation, FileStore: a snapshot oriented flat file data lake, plus the JSONL and Parquet codecs behind it and the per dataset manifest that records every snapshot ever written.

Does not own: what datasets exist or what a row looks like, that is defined by packages/core's entity schemas and packages/ingest's DATASETS names. This package never fetches data and never knows what an FPL player or fixture is; it only moves validated rows to and from disk.

## Skills used in this section

- verify-and-stop: after touching file-store.ts, manifest.ts, or either codec, run the package tests, which round trip both formats, check snapshot isolation by partition, and check the empty dataset case.
- cavecrew-investigator: locate where a path or manifest helper is used before changing its output shape, since paths.ts's output is embedded in every manifest already on disk.

## Constraints

- Snapshots are immutable: FileStore.write always creates a new file (named from a flattened capture timestamp) and appends to the dataset manifest, it never overwrites or edits an existing snapshot.
- Single writer per dataset is assumed. Concurrent syncs of the same dataset race the manifest file; there is no locking.
- Store is a port. FileStore is filesystem backed; a different implementation (for example database backed) can replace it without changing packages/ingest or packages/analytics, as long as it satisfies the same interface.
- Dataset and partition name segments are sanitised before becoming path components, since they can originate from an untrusted upstream source name.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Store spec](SPEC.md): full method and logic detail for everything summarised above.

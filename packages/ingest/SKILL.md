---
title: Ingest skill
type: skill
module: packages/ingest
updated: 2026-08-16
status: active
---

## Purpose

Owns the Source port and SourceRegistry, an HttpClient with retry, backoff, and request throttling, the FplClient wrapper over the public FPL endpoints, the three FPL sources (bootstrap, fixtures, player history) and their raw to domain mapping, and the dependency ordered sync runner (runSync, orderByDependencies).

Also owns the rules page pipeline end to end: the HTML scraper (rules/parse.ts, rules/schema.ts, rules/london-time.ts), a Source that wraps it for a batch sync (rules/source.ts, rulesSource), and a diff aware refresh path (rules/diff.ts, rules/refresh.ts) that only writes a new snapshot when the page actually changed. All three are exported from packages/ingest/src/index.ts and both apps/cli and apps/api call refreshRules directly.

Also owns a small odds ingestion path: an RFC 4180 CSV reader (csv.ts), a football-data.co.uk season CSV parser and its Source (odds/football-data.ts, odds/source.ts), and a provider club name resolver (odds/team-names.ts).

Does not own: config loading (packages/config), snapshot storage mechanics (packages/store), scoring, squad rules, or the spatial/odds/transfer domain schemas (all packages/core).

## Skills used in this section

- cavecrew-investigator: before adding a new Source, locate every existing entry in DATASETS and every SourceRegistry registration so a new dataset name does not collide with one already in use. DATASETS currently reserves four names (ownership, clubTransfers, playerMatchSpatial, matchEvents) that have no Source yet; check there before assuming one exists.
- verify-and-stop: after touching http.ts's retry, backoff, or throttling logic, the rules scraper or differ, or the CSV/odds parsing, run the package tests, all covered by fixture driven node:test suites that assert exact wait times, exact parsed values, and exact diffs.

## Constraints

- Source is a port: a new upstream (a private feed, a scraped PDF, a tracking data provider) implements Source and registers with SourceRegistry; runSync itself must never be edited to special case a new source.
- HttpClient retries only a fixed set of statuses (408, 425, 429, 500, 502, 503, 504) plus network or timeout faults; any other non ok status becomes a terminal SourceError on the first attempt.
- HttpClient enforces a floor on the gap between requests (minRequestIntervalMs); this is deliberate throttling of a client against FPL, not a performance optimisation to remove.
- Raw FPL response schemas (fpl/schemas.ts) strip unknown keys rather than rejecting the payload, since FPL adds fields mid season without notice and a strict schema would turn that into an outage.
- Mapping (fpl/map.ts) always goes through packages/core's Zod schemas, never a raw cast; a malformed upstream row must fail at the mapping boundary, not three layers downstream.
- refreshRules always writes the rules dataset as JSONL, never the caller's default format: the RulesDocument is a single deeply nested row, and the Parquet codec flattens nested values to JSON text, which would not survive a schema checked read back.
- rulesSource (used by a batch sync) writes an unconditional fresh snapshot every run; refreshRules (used by the CLI's rules refresh command and the API's POST /rules/refresh) is the only path that diffs against the stored version first and skips the write when nothing changed. Do not merge the two: a scheduled sync should always capture the current page, an interactive refresh should not create noise snapshots.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Ingest spec](SPEC.md): full method and logic detail for everything summarised above.
- [CLI spec](../../apps/cli/SPEC.md): the sync and rules commands are built directly on this package's sources and refreshRules.
- [API spec](../../apps/api/SPEC.md): the rules routes call this package's refreshRules and readLatestRules directly.

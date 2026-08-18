---
title: CLI spec
type: spec
module: apps/cli
updated: 2026-08-18
status: active
---

## Purpose

A commander program over the ingest pipeline and the data lake.

## Methods

### buildProgram(deps): Command

In: config, store, logger, http, and optional clock and output streams. Out: a
configured command tree. Errors: none at build time. Notes: every command reads
its dependencies from this object, which is what keeps the tests offline.

### sync

Flags: season, sources as a comma separated list, format as jsonl or parquet,
limit capping players fetched, skip-unplayed, continue-on-error, json. Runs the
bootstrap, fixtures, player history, rules, and odds sources in dependency
order and prints a row per source with its datasets, rows, duration, and error.
Errors: an unknown source name fails before anything runs. A failed source sets
a non zero exit code.

### sync, spatial source

In: `--sources spatial-sofascore`, and optionally `--spatial-max-events <n>` and `--spatial-since-gameweek <n>`. Out: the same report row shape as any other source. Errors: as `sync`. Notes: `spatial-sofascore` is the one source excluded from a bare `fpl sync`, because it costs roughly one request per player per match against a client throttled to a 500 ms floor, so a whole season is hours of traffic. It is asked for by name or not at all, and `OPT_IN_SOURCES` in `program.ts` is what holds that rule. It requires teams, players, and fixtures, so run it after a normal sync has landed those.

### fixtures refresh

In: optional `--season`, `--format`, `--always`, `--json`. Out: what moved per fixture id (kickoff, gameweek, scores, difficulty), and whether a snapshot was written. Errors: as any store write. Notes: calls `refreshFixtures`, which writes only when the diff reports a change unless `--always` is set.

### assets sync / assets list

In: optional kinds to sync (see `ASSET_KINDS`), `--force` to refetch what is already stored, and `--json`. Out: per kind counts of downloaded, skipped, and absent objects, or the stored manifest. Errors: propagates a store error; an absent object upstream is reported, not thrown. Notes: the Premier League CDN answers a missing object with 403 rather than 404, and sometimes with a 200 and a placeholder body, so `syncAssets` enforces a minimum image size and falls through to the next candidate size. Blobs are gitignored: the web app hotlinks the CDN instead.

### history seasons / history archive

In: `history seasons` takes optional `--season`, `--limit`, `--json`; `history archive` takes optional `--season`, `--seasons` (comma separated, default every season the archive publishes from 2016/17 to the last completed one), `--format`, `--json`. Out: the same per source report table as `sync`. Errors: as `sync`. Notes: both are backfills for completed seasons, which do not change, so neither belongs on a schedule. `history archive` defaults to Parquet rather than the store default, because one season is about 27,000 rows and Parquet stores it in roughly a twentieth of the JSONL bytes.

### history internationals

In: optional `--season`, `--limit` (bounds the players processed), `--only-missing`, `--json`. Out: the same per source report table as `sync`. Errors: as `sync`; a failed source sets a non zero exit code. Notes: runs the mapping source then the records source against the provider's own HttpClient, since it needs browser headers and a browser TLS cipher order rather than the FPL client. Bounded and resumable: a player already mapped is skipped, so repeated small runs converge.

### rules refresh

Flags: season, json. Scrapes the published rules page, diffs it against the
stored document, writes only when it changed, and prints one line per change.
This is the same operation the API exposes for a frontend update button.

### rules deadlines

Flags: next, json. Prints upcoming gameweek deadlines from the stored rules
document, as instants. Errors: fails clearly when the page was never scraped.

### players

Flags: position, team, max-price in tenths, min-minutes, sort, limit, json.
Prints name, team short name, position, formatted price, points, and form.
Notes: sorting is best first for rank fields and alphabetical for name, since
best name has no meaning.

### datasets

Flags: json. Lists every dataset stored for the season with its latest capture
time, row count, and format. Notes: a partitioned dataset has no unpartitioned
snapshot, so its totals are summed across the partitions the manifest records.

### show player

Args: a player id. Flags: json. Prints one player's detail and their gameweek
history where present.

## Logic

Partitioned datasets are enumerated through Store.partitions rather than by
scanning a fixed gameweek range, so a partition named outside the gw<n>
convention is still found, and a sparse dataset costs one read per partition
that exists instead of 38 speculative reads.

Table rendering is a local column aligned formatter with no dependency. It
handles an empty row set and values wider than their header.

## Data flow

flags plus environment -> loadConfig -> a FileStore and an HttpClient -> the
selected sources -> runSync -> Store writes -> a printed report.

stored rows -> filter and sort in memory -> a table on stdout, or JSON when the
json flag is set.

## Dependencies

Internal: @fpl/core, @fpl/config, @fpl/store, @fpl/ingest, @fpl/analytics.

External: commander, zod.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [CLI skill](SKILL.md): purpose and constraints in brief.
- [Ingest spec](../../packages/ingest/SPEC.md): supplies every source and the refresh path.
- [Store spec](../../packages/store/SPEC.md): supplies the partitions method the commands rely on.
- [Core spec](../../packages/core/SPEC.md): supplies the row schemas and price formatting.

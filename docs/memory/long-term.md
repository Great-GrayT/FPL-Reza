---
title: Long term architecture memory
type: memory-long
module: root
updated: 2026-08-16
status: active
---

## Decisions

### Flat files with a Store port, not a database

`packages/store` defines `Store` as an interface (`write`, `read`, `latest`, `history`, `datasets`) and ships one implementation, `FileStore`, on top of the local filesystem. Ingest and analytics depend on the interface, not on `FileStore` directly, so a database backed implementation can replace it later without touching either package. A flat file lake also makes every snapshot inspectable and diffable without standing up infrastructure, which fits a project still shaped by hand.

### Branded domain IDs

`packages/core/src/ids.ts` brands every ID (`PlayerId`, `TeamId`, `FixtureId`, `GameweekId`, `Season`) with Zod's `.brand()`. FPL reuses small integers across unrelated entities, so a plain `number` would let a `TeamId` be passed where a `PlayerId` is expected and TypeScript would not catch it. Branding forces every raw integer through an `asXxxId` constructor, which both validates and tags it.

### Snapshot immutability

`FileStore.write` never overwrites: it writes a new file per call (name derived from a flattened ISO timestamp) and appends the resulting `SnapshotMeta` to a per dataset `_manifest.json`. This means a bad or partial ingest run cannot destroy the last good data, and analytics can read data as of any prior capture, not only the latest. The write path also writes to a `.tmp` file and renames it into place, so a crash mid write cannot leave a manifest pointing at a half written snapshot.

### `node:test` over vitest

The repo uses the Node built in test runner, invoked through `tsx` (see the `test` script in the root `package.json`), for every package. There is deliberately no vitest and no Vite anywhere in the repo: the platform's own tooling covers what this project needs (assertions, `describe`/`it`, and coverage through `node:test`'s own experimental coverage support), so an extra test framework and its config would be unused weight.

### Integer tenths for money

`packages/core/src/money.ts` stores every price as an integer number of tenths of a million (`Tenths`, so 55 means five point five million). Floats only appear at the moment of display (`formatPrice`, `toMillions`). This keeps budget arithmetic in anything that sums or compares prices exact, with no floating point drift, which `money.test.ts` checks by round tripping every tenths value from 38 to 150 through `toMillions` and back.

### The `Source` port in ingest

`packages/ingest/src/source.ts` defines `Source` (a name, the datasets it writes, optional dataset requirements, and a `run` method yielding batches) plus a `SourceRegistry`. The public FPL API is one `Source` implementation (`bootstrapSource`, `fixturesSource`, `playerHistorySource`), but the interface itself carries no FPL specifics, so a private feed, a scraped PDF report, or a tracking data provider can be added as another `Source` without editing `runSync` or the registry. `runSync` orders sources by their declared `requires`/`datasets`, not by any hardcoded pipeline order, which is what makes that extensibility real rather than aspirational.

## Related

- [Docs index](../INDEX.md): module map this rationale supports.
- [Short term memory](short-term.md): what is built today versus still in flight.
- [Core spec](../../packages/core/SPEC.md): where the branded IDs, money, and rules constants actually live.
- [Store spec](../../packages/store/SPEC.md): where the snapshot and manifest mechanics are implemented.
- [Ingest spec](../../packages/ingest/SPEC.md): where the `Source` port and sync runner are implemented.

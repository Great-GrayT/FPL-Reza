---
title: Short term project memory
type: memory-short
module: root
updated: 2026-08-16
status: active
---

## Status

Built and tested (`node:test` via `tsx`, all passing per the source read on 2026-08-16):

- `packages/core`: domain types, branded IDs, money helpers, squad and transfer rules, match scoring, BPS weights, logger, error hierarchy.
- `packages/config`: `loadConfig` and `seasonForDate`.
- `packages/store`: `FileStore` implementing the `Store` port, JSONL and Parquet codecs, manifest handling.
- `packages/ingest`: `HttpClient`, `FplClient`, the bootstrap, fixtures, and player history sources, `runSync`, and a rules page scraper (`rules/parse.ts`) that is written but not wired up, see below.

## In flight

- `packages/analytics`, `apps/api`, `apps/cli`: under construction by other agents. Not documented in this pass; a follow up message will trigger their `SKILL.md` and `SPEC.md`.
- `apps/web` (Next.js): planned only, gated behind a front end design review step. No code exists yet.

## Blockers and open threads

- The rules page scraper (`packages/ingest/src/rules/parse.ts`, `schema.ts`, `london-time.ts`) is implemented and schema validated but is not exported from `packages/ingest/src/index.ts` and no `Source` wraps it, so it never runs as part of a sync. Whoever wires it in next needs to decide its dataset name and where it fits `orderByDependencies`.
- `packages/ingest`'s `package.json` lists `@fpl/config` as a dependency, but no file under `packages/ingest/src` imports it. The actual config to `HttpClient`/`FileStore` wiring happens wherever `apps/cli` or `apps/api` construct those objects, which is outside this documentation pass.
- `FileStore` assumes a single writer per dataset; concurrent syncs of the same dataset race the manifest file. No locking exists.

## Related

- [Docs index](../INDEX.md): where each module's detail lives.
- [Long term memory](long-term.md): why these choices were made, not just what exists.

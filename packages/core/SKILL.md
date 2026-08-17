---
title: Core skill
type: skill
module: packages/core
updated: 2026-08-16
status: active
---

## Purpose

Owns the domain: branded IDs (`PlayerId`, `TeamId`, `FixtureId`, `GameweekId`, `Season`), the entity schemas (team, player, gameweek, fixture, player gameweek), position and availability mapping, money as integer tenths of a million, squad and transfer rules constants, match scoring, BPS weights, a line oriented logger, and the shared error hierarchy (`FplError`, `ValidationError`, `NotFoundError`, `SourceError`).

Also owns four newer modules: pitch geometry and per match spatial schemas including heatmaps (`spatial.ts`), bookmaker odds and the goal expectation math derived from them (`odds.ts`), club transfer and FPL ownership flow schemas (`transfers.ts`), and a static registry of candidate data providers with their access mode and coverage (`providers.ts`).

Does not own: storage or file I/O (`packages/store`), HTTP fetching or upstream FPL response shapes (`packages/ingest`), configuration loading (`packages/config`). Nothing in this package touches the filesystem or the network.

## Skills used in this section

- cavecrew-investigator: locate a constant, schema, or function here before editing it, rather than re-reading whole files.
- verify-and-stop: after touching `rules.ts`, `scoring.ts`, or `bps.ts`, run the package tests to confirm the reconciled rule values still hold; these files are rule mirrors, not tuning knobs.

## Constraints

- Rule and scoring constants in `rules.ts`, `scoring.ts`, and `bps.ts` were reconciled against the officially published FPL rules on 2026-08-16, including the defensive contribution rule. They must match the published rules, not a model's preference.
- IDs are branded with Zod's `.brand()`. Never cast a raw number to a branded ID type; go through `asPlayerId`, `asTeamId`, `asFixtureId`, `asGameweekId`, or `asSeason`, and note that these throw Zod's own `ZodError` on failure, not this package's `ValidationError`.
- This package performs no I/O. Anything that reads a file, calls fetch, or touches the clock belongs in `store` or `ingest`.
- Every field beyond the identity block in `playerMatchSpatialSchema` and `matchEventSchema` is nullable on purpose: null means the provider does not carry that measure, which is distinct from a measured zero. Never default a missing measure to 0.
- Spatial coordinates follow the Opta convention: 0 to 100 on both axes, always from the perspective of the side attacking towards x = 100. A provider that ships metres or flips sides at half time must be normalised to this convention before its rows reach these schemas.
- `clubTransferSchema` keys on `playerCode`, not `playerId`, because FPL ids are reassigned every season and codes are not.
- `PROVIDERS` in `providers.ts` is hand maintained data, not a live lookup: adding or correcting an entry means editing the array directly, there is nothing to sync it against.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Core spec](SPEC.md): full method and logic detail for everything summarised above.
- [Analytics spec](../analytics/SPEC.md): computes derived metrics over this package's entity types and constants.

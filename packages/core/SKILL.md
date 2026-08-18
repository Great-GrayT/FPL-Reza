---
title: Core skill
type: skill
module: packages/core
updated: 2026-08-18
status: active
---

## Purpose

Owns the domain: branded IDs (`PlayerId`, `TeamId`, `FixtureId`, `GameweekId`, `Season`), the entity schemas (team, player, gameweek, fixture, player gameweek), position and availability mapping, money as integer tenths of a million, squad and transfer rules constants, match scoring, BPS weights, a line oriented logger, and the shared error hierarchy (`FplError`, `ValidationError`, `NotFoundError`, `SourceError`).

Also owns four newer modules: pitch geometry and per match spatial schemas including heatmaps (`spatial.ts`), bookmaker odds and the goal expectation math derived from them (`odds.ts`), club transfer and FPL ownership flow schemas (`transfers.ts`), and a static registry of candidate data providers with their access mode and coverage (`providers.ts`).

Also owns the career layer (`history.ts`): `playerSeasonSchema` (one player, one completed season), `historicPlayerGameweekSchema` (one player, one gameweek of a past season), `careerTotals`, and the two spellings of a season label, since the archives write "2024-25" where the domain writes "2024/25".

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

- Everything in `history.ts` keys on `playerCode`, never `playerId`. FPL reassigns element ids every summer, so a career keyed by id is one season long. `historicPlayerGameweekSchema` also carries the name, club, and position as recorded at the time, because a player who has left the league cannot be joined to today's player list.
- A measure that did not exist in a season is null, not 0. The expected goals family starts in 2022/23 and defensive contribution in 2025/26, and FPL reports 0 for both before then, which would otherwise read as "recorded none".

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Core spec](SPEC.md): full method and logic detail for everything summarised above.
- [Analytics spec](../analytics/SPEC.md): computes derived metrics over this package's entity types and constants.

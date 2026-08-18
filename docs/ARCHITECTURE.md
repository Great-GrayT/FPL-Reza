---
title: How this project works
type: spec
module: root
updated: 2026-08-18
status: active
---

## Purpose

One document that explains the whole platform end to end: what data comes in, how it is modelled, what the algorithms actually compute, which package owns which job, and how a request reaches a rendered page. Read it before touching anything you have not worked on, and read a package's own `SPEC.md` for method level detail.

This file is part of the definition of done. Any change to a data source, a schema, an algorithm, a package boundary, a route, or a page updates this file in the same commit, and bumps `updated` in the frontmatter. The web app renders this exact file at `/how-it-works`, so a stale sentence here is a stale sentence shipped to the reader.

## Methods

### Inputs

Everything is a free public source. No paid feeds, no accounts, no API keys anywhere in the codebase.

| Source                                                                            | Shape  | What it gives                                                                                         | Access                                                                        |
| --------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| FPL public API (`fantasy.premierleague.com/api`)                                  | JSON   | Teams, players, gameweeks, fixtures, per player gameweek history                                      | Open                                                                          |
| FPL rules page (`/en/help/rules`), currently client rendered and yielding nothing | HTML   | Deadlines, scoring table, BPS table, chip effects, scoring phases, squad and transfer limits          | Open, scraped                                                                 |
| football-data.co.uk season CSV                                                    | CSV    | Closing bookmaker odds per match: 1X2 and over/under 2.5                                              | Open                                                                          |
| Sofascore (`api.sofascore.com/api/v1`)                                            | JSON   | Player heatmaps, average positions, per player match statistics, shot coordinates with expected goals | Open, needs a browser user agent, a `Referer`, and a browser TLS cipher order |
| Premier League image CDN (`resources.premierleague.com`)                          | Images | Player photos, club crests                                                                            | Open, answers a missing object with 403                                       |

Sources that were probed and rejected are recorded in [Handoff, continue the build](HANDOFF.md): Understat and FBref are unreachable, FotMob ships pre rendered SVG heatmaps, football-data.org and The Odds API want a key even on their free tier.

### Models

`packages/core` is the only place a domain shape is defined. Every model is a Zod schema plus pure functions over it, never a class, and construction is always `schema.parse(candidate)` so a malformed upstream row fails at the boundary rather than three layers down.

- **Identity.** `PlayerId`, `TeamId`, `FixtureId`, `GameweekId`, `Season` are branded with Zod `.brand()`. A raw number never becomes an id by cast: it goes through `asPlayerId`, `asTeamId`, `asFixtureId`, `asGameweekId`, `asSeason`. `GameweekId` is bounded 1 to 38 at the schema level.
- **Entities.** `Team`, `Player`, `Gameweek`, `Fixture`, `PlayerGameweek`. FPL's `element_type` becomes a `Position` (GKP, DEF, MID, FWD) and its status letter becomes an `Availability` (available, doubtful, injured, suspended, unavailable, not_in_squad).
- **Money.** Prices are integer tenths of a million, never floats, so budget arithmetic is exact. `toMillions`, `fromMillions`, and `formatPrice` convert for display; `sellingPrice` applies FPL's rule that a fall is passed on in full and a rise is only half realised, rounded down.
- **Rules.** `SQUAD_QUOTA` (2/5/5/3, summing to a fixed 15), the starting eleven bounds per position, chip counts and their gameweek 19 split, and the monthly `SCORING_PHASES` table. These are mirrors of the officially published rules, reconciled on 2026-08-16, including the defensive contribution rule. They are not tuning knobs.
- **Spatial.** A pitch normalised 0 to 100 on both axes, always from the perspective of the side attacking towards x 100 (the Opta convention). `THIRDS` and `CHANNELS` name zones, `PHASES` names game phases, and a heatmap is a 12 by 8 grid by default. `PlayerMatchSpatial` and `MatchEvent` hold one match per player and one event (today, one shot) respectively. Every measure past the identity block is nullable on purpose: null means the provider does not carry it, which is not the same as a measured zero.
- **Odds, transfers, providers.** `OddsQuote` is one bookmaker's price for one selection in one market. `clubTransferSchema` keys on `playerCode`, not `playerId`, because FPL reassigns ids every season and codes survive. `PROVIDERS` is a hand maintained registry of candidate feeds with their access mode and coverage.

### Algorithms

Every algorithm below is pure: same input, same output, no I/O.

- **Match scoring** (`core/scoring.ts`). `scorePlayerGameweek` returns a component by component `PointsBreakdown` whose `total` is the sum of its parts. Appearance is 1 point below 60 minutes and 2 at or above. Clean sheet points need both the flag and a full 60 minute appearance. Goals conceded penalties apply to GKP and DEF only, save points to GKP only. A red card resolves alone at minus 3 rather than stacking on the yellow shown in the same incident. Defensive contribution pays a flat 2 points at 10 CBIT actions for a defender or 12 CBIRT actions for a midfielder or forward, and does not stack past the threshold.
- **BPS** (`core/bps.ts`). Named weights are constants a caller looks up. The one computed weight is `passCompletionBps`: nothing below 30 attempted passes, then 2, 4, or 6 points for the 70 to 79, 80 to 89, and 90 plus completion bands.
- **Bonus prediction** (`analytics/bonus.ts`). `predictBonus` sorts a fixture's BPS scores, groups ties, and walks the award slots so a tied group consumes as many slots as it has members: a two way tie for first takes slots one and two, both score 3, and the 2 is skipped. Output preserves input order, not BPS order.
- **Rolling form** (`analytics/form.ts`). `rollingForm` takes the tail of a player's gameweeks and returns points per game, points per 90, minutes per game, expected goal involvements per 90, and starter reliability, the share of considered gameweeks with a full appearance. Every rate goes through `per90`, which returns 0 rather than dividing by zero minutes.
- **Value** (`analytics/value.ts`). Points per million over the season and over a form window, plus price change against the player's starting price, all in tenths.
- **Fixture difficulty** (`analytics/fixtures.ts`). `fixtureDifficulty` walks a horizon of gameweeks from a starting gameweek and reports each fixture's opponent, venue, and difficulty, the average difficulty, and, explicitly, the blank and double gameweeks in that horizon rather than averaging them away. `strengthAdjustedFixtureDifficulty` weights the same horizon by team strength.
- **Defensive contribution** (`analytics/defence.ts`). Summarises CBIT/CBIRT counts against the position's threshold, so a defender's likelihood of hitting the 2 point award is visible rather than inferred.
- **Odds to expectations** (`core/odds.ts`). Bookmaker prices become probabilities, then `removeOverround` normalises them to sum to 1 (the bookmaker's margin is stripped proportionally). `fitGoalExpectations` then recovers the home and away goal expectations implied by those fair probabilities: it scores a candidate pair by building an independent Poisson scoreline grid (`poissonPmf`, `scorelineProbabilities`) and taking the sum of squared error against the market's home, draw, away, and, where an over/under market exists, over 2.5 probabilities. The search is a 0.05 step grid over 0.05 to 4.5 on each axis, then a 0.01 step pass bracketing the winner, because the error surface is smooth and unimodal in that range and a real solver would buy nothing. `fixtureOutlook` wraps that into outcome probabilities, goal expectations, and a clean sheet probability per side, where a clean sheet is `exp(-lambda)` for the opposing expectation.
- **Rules diffing** (`ingest/rules/diff.ts`). Every keyed collection is compared by its own key (deadlines by gameweek, scoring and BPS rows by action, chips by name, phases by name, sections by heading), so the diff names what changed rather than only that something did. A SHA-256 checksum of the scraped text is a cheap first signal, but `changed` also turns true on any keyed difference, so a checksum collision cannot mask a real change.
- **Fixture diffing** (`ingest/fixtures/diff.ts`). Kickoff, gameweek, both scores, both difficulties, and the finished flag, compared per fixture id.
- **Provider identity joins** (`ingest/spatial/sofascore/identity.ts`). This is the highest risk code in the repo, because a wrong join silently attributes one player's match to another and nothing downstream can detect it. Names are normalised by stripping diacritics and every non alphanumeric character. A club name resolves through the shared odds resolver, then a Sofascore alias table, then a prefix rule. A fixture resolves on the resolved team pair plus the closest kickoff within a 4 hour tolerance, or, where no kickoff is close enough, on the pair identifying a single fixture whose gameweek equals the provider round, which is what carries a match the two sides have rescheduled days apart. A player resolves from strong forms scoped to the club, then weak forms (family name, initial plus family name) scoped to the club, then an unambiguous full name across the league, which is the only way to reach a player who has since moved. Any key shared by two candidates is marked ambiguous and resolves to nothing, and every resolver returns undefined rather than a best guess. The source counts and logs what it dropped.
- **Coordinate normalisation** (`ingest/spatial/sofascore/map.ts`). Established empirically from real payloads, since the provider documents nothing. Average positions and heatmaps share a frame whose x already matches the domain (both goalkeepers sit near x 11) but whose y is inverted, so y is flipped. The shot frame is that same frame rotated 180 degrees, so a shot has x flipped and y left alone. Both transforms clamp to the pitch bounds.
- **Parquet type inference** (`store/parquet.ts`). Per column, the narrowest of BOOLEAN, INT32, DOUBLE, or STRING that fits every non null value; anything that does not fit is written as JSON text. Dates never reach a codec: they are serialised to ISO strings first and read back with `z.coerce.date()`, so the round trip is lossless and format independent.

### Packages

```
packages/core       domain schemas, branded ids, money, rules, scoring, BPS, spatial, odds, logger, errors
packages/config     environment driven configuration and season derivation
packages/store      the Store port and FileStore: the snapshot data lake
packages/ingest     HTTP client, FPL sources, rules scraper, odds CSV, Sofascore spatial, sync runner
packages/analytics  form, value, fixture difficulty, defence, bonus prediction
packages/assets     FileAssetStore, append only JSONL manifest, PL CDN url builders, syncAssets
apps/api            Fastify HTTP API over the lake
apps/cli            fpl command line: sync, refresh, inspect
apps/web            Next.js 15 site, built from the committed lake
```

Dependencies point one way: `core` depends on nothing, `store` and `config` depend on `core`, `ingest` depends on `core` and `store`, `analytics` depends on `core`, and the three apps depend on whichever of those they need. Nothing in `core` touches the filesystem, the network, or the clock.

The `Store` and `Source` ports are what keep that shape honest. A new upstream implements `Source` and registers itself; `runSync` is never edited to special case one. A different storage backend implements `Store` and nothing above it changes.

### Storage

The lake is a flat file, snapshot oriented store addressed by season, dataset, and optional partition, written as JSONL or Parquet through a codec.

- A write is always a new file named from a flattened capture timestamp, plus an append to that dataset's `_manifest.json`. Nothing is ever overwritten or edited in place, so every sync is a point in time record.
- A read resolves the newest snapshot from the manifest (or a requested `capturedAt`), decodes it, and parses every row against a Zod schema. One bad row fails the whole read: there is no partial success.
- Partitions are how per gameweek data lands: `player-gameweeks`, `player-match-spatial`, and `match-events` write one partition per gameweek (`gw1`, `gw2`, and so on), each written once per run rather than once per player.
- Dataset and partition names are sanitised into path segments because they can come from an upstream source. A season's slash becomes a hyphen, and capture timestamps lose their colons, since Windows will not accept them in a filename.
- Single writer per dataset is assumed. Two concurrent syncs of the same dataset race the manifest; there is no locking.
- Asset blobs are a separate store with an append only JSONL manifest, last line wins per key, because rewriting a whole manifest per file is quadratic and, on Windows, the rename churn intermittently fails with `EPERM` while a scanner holds the file.

### Ingestion

`runSync` takes a list of sources, orders them so a source only runs once every dataset it requires has been produced (or is not produced by anything in this run, in which case it is assumed already stored), and writes each yielded batch through the store. A source failure is recorded on its run and, unless `continueOnError` is set, stops the rest.

Sources today:

| Source               | Datasets                           | Requires                 | Notes                                                 |
| -------------------- | ---------------------------------- | ------------------------ | ----------------------------------------------------- |
| `fpl-bootstrap`      | teams, gameweeks, players          | none                     | One request, three datasets                           |
| `fpl-fixtures`       | fixtures                           | none                     | One request                                           |
| `fpl-player-history` | player-gameweeks                   | players                  | Roughly one request per player, so the slowest by far |
| `fpl-rules`          | rules                              | none                     | Unconditional fresh snapshot per run                  |
| `odds-football-data` | odds                               | teams                    | One season CSV, club names resolved to team ids       |
| `spatial-sofascore`  | player-match-spatial, match-events | teams, players, fixtures | Opt in only, see below                                |

The rules pipeline currently returns nothing. The published page went client rendered: its HTML has no tables and no embedded payload, so `parseRules` produces an empty document, and both write paths refuse to store it (`isUsableRulesDocument`). The lake therefore has no rules dataset and the API answers 404 for `/rules`. The scraper, the differ, and their tests still stand; what is missing is the JSON endpoint the page now fetches.

Two paths deliberately sit outside `runSync`, because an interactive check should not create a snapshot every time it runs: `refreshRules` and `refreshFixtures` scrape or fetch, diff against the stored snapshot, and write only on a change. Both take a `dryRun` flag for a host whose filesystem is read only. `refreshRules` always writes JSONL regardless of the configured format, because the rules document is one deeply nested row and the Parquet codec would flatten it to JSON text that could not be read back through the schema.

`spatial-sofascore` is opt in from the CLI (`--sources spatial-sofascore`) and excluded from a bare `fpl sync`, because it costs roughly one request per player per match against a client throttled to a 500 ms floor: a full season is hours of traffic. Bound a run with `--spatial-max-events` or `--spatial-since-gameweek`.

The HTTP client retries only 408, 425, 429, 500, 502, 503, and 504 plus network and timeout faults; any other non ok status is a terminal `SourceError` on the first attempt. Backoff doubles from 250 ms, and a numeric `Retry-After` header wins over the computed value. The minimum request interval is deliberate politeness, not a performance knob. Sofascore gets its own client because that provider fingerprints the TLS handshake, so the request needs a browser cipher order as well as browser headers.

### Serving

- **`apps/api`** is Fastify over a `FileStore` built in `deps.ts`: `GET /health`, `/players`, `/players/:id`, `/players/:id/history`, `/fixtures`, `/gameweeks`, `/gameweeks/current`, `/gameweeks/next`, `/rules`, `/rules/deadlines`, `/assets`, `/assets/:kind/:key`, plus `POST /fixtures/refresh` and `POST /rules/refresh`. Asset blobs are served with an immutable cache header and an etag.
- **`apps/cli`** is the `fpl` command: `sync`, `fixtures refresh`, `rules refresh`, `rules deadlines`, `assets sync`, `assets list`, `players`, `datasets`, `show player`. Every command reads or writes through a `FileStore` built in `bin.ts`, and every listing command can print JSON instead of a table.
- **`apps/web`** is Next.js 15 App Router, rendered at build time from the committed lake: `/`, `/players`, `/players/[id]`, `/matches`, `/how-it-works`, plus `/api/health`, `/api/refresh/fixtures`, and `/api/refresh/rules`. All 590 player profiles are prerendered. Player photos are hotlinked from the Premier League CDN through `next/image` rather than committed.

Deployment is one Vercel project whose root directory is `apps/web`, because that is the only `package.json` declaring `next`: pointed at `apps/api` Vercel deploys the Fastify server, and pointed at the repository root it fails with `No Next.js version detected`. Vercel installs the workspace from the repository root and runs that package's build script, which builds every workspace package first. "Include files outside the Root Directory" has to stay on, since the site reads the committed lake in `data/` and reads this file for `/how-it-works`, both outside `apps/web`.

The refresh endpoints are gated by a shared secret in `REFRESH_TOKEN`, read from `x-refresh-token` or a bearer `authorization` header. With the variable unset the gate is open, which is right locally and wrong in production, so every response carries `unprotected: true` while it is open. Freshness is a git problem, not a runtime one. Vercel cannot write, so a refresh endpoint on the deployed site reports a diff and persists nothing (`dryRun`). What actually updates the site is `.github/workflows/refresh-lake.yml`, hourly, running `fpl fixtures refresh` and `fpl rules refresh` and committing whatever changed, and `.github/workflows/sync-lake.yml`, daily at 02:15 UTC after FPL settles overnight price changes, running the full sync with `--skip-unplayed --continue-on-error`. The push is what triggers the redeploy. Both share a `fpl-lake` concurrency group, because the store assumes a single writer per dataset and two runs would race the same manifest.

### Front end

The subject grounding of the design is that FPL time is not continuous. It is 38 discrete slabs, and every decision a manager makes is per gameweek.

- Palette from printed football ephemera, as tokens in `app/globals.css`: `--paper`, `--ink`, `--pitch`, `--flare`, `--bonus`. Flare is rationed to live and current only. A dark variant redefines the same tokens under `prefers-color-scheme`.
- Type: Archivo in expanded heavy caps for display, IBM Plex Sans for body, IBM Plex Mono for every number so columns align on tabular figures.
- The signature element is `components/gameweek-ribbon.tsx`: 38 cells where bar height is points and cell ground is fixture difficulty, and where a cell is also the control that scrubs the page to that gameweek. It is the sparkline, the fixture ticker, and the navigation in one object.
- Motion is one orchestrated moment, the ribbon staggering left to right on load. Reduced motion is respected globally.
- Time series use Recharts. The pitch and heatmap will be hand rolled SVG when they are built, because those are not chart shapes.
- Client components import `@fpl/assets/urls`, never `@fpl/assets`: the barrel pulls `node:fs` into the browser bundle and fails the build.

`/how-it-works` reads this file from disk at build time, parses it with the small markdown renderer in `apps/web/lib/markdown.ts`, and renders it in the site's own type and colour. There is no markdown dependency: the renderer covers exactly the subset this document uses (headings, paragraphs, lists, tables, fenced code, inline code, links, emphasis) and escapes everything before emitting it.

## Logic

Decisions a reader could not infer from the code, and the reasons behind them.

- **The row lake is committed.** `data/2026-27/` is about 392 KB and lives in git, because the host (Vercel) cannot write at runtime and the site is built from those snapshots. `.gitignore` excludes only `data/assets/`, the image blobs, which are 119 MB and hotlinked instead.
- **Snapshots are immutable, and only changes are worth a snapshot.** A full sync always captures. An interactive refresh writes only on a diff, so polling every few minutes does not fill the lake with identical files.
- **Null is not zero.** Across the spatial and event schemas, a missing measure stays null, because "the provider does not carry this" and "this was measured as zero" are different facts and collapsing them silently corrupts any per 90 rate computed later.
- **A missing join is better than a wrong one.** Every provider resolver refuses to guess and the caller counts the misses, because a wrong player id produces plausible, undetectable data.
- **Rules constants mirror the published rules.** They were reconciled against the official page and are checked by tests. They are not a place to encode a preference.
- **Tests are `node:test` plus `tsx`.** There is no vitest and no Vite in this repo, deliberately. TypeScript runs strict, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `NodeNext` (so every relative import ends in `.js`), and `erasableSyntaxOnly` (no enums, no parameter properties, no namespaces).
- **403 can mean absent.** The Premier League CDN answers a missing object with 403 rather than 404, and also returns 200 with a 263 byte body where a photo was pulled but the object was not removed, so `syncAssets` enforces a minimum image size and falls through to the next candidate.

## Data flow

FPL bootstrap JSON -> `FplClient.bootstrap` -> `toTeam`/`toGameweek`/`toPlayer` -> `bootstrapSource` -> `runSync` -> `Store.write` for teams, gameweeks, players.

FPL fixtures JSON -> `FplClient.fixtures` -> `toFixture` -> either `fixturesSource` inside a sync, or `refreshFixtures` -> `diffFixtures` against the stored snapshot -> `Store.write` only on a change.

Stored players -> one `FplClient.playerHistory` call per player -> `toPlayerGameweek` -> grouped by gameweek -> `Store.write` for player-gameweeks, one partition per gameweek.

Rules page HTML -> `parseRules` -> `RulesDocument` -> `rulesSource` (always writes) or `refreshRules` -> `diffRules` -> `Store.write` as JSONL only on a change.

football-data CSV -> `parseCsvObjects` -> `parseFootballDataCsv` with a team resolver built from stored teams -> `OddsQuote` rows -> `Store.write` for odds -> `matchOutcomeProbabilities` and `fitGoalExpectations` turn them into expectations.

Sofascore listing pages -> per event lineups, average positions, shotmap, and one heatmap per player -> `buildFixtureResolver` and `buildPlayerResolver` join to domain ids -> `fromTeamFrame`/`fromShotFrame` normalise coordinates -> `toPlayerMatchSpatial`/`toMatchEvent` -> `Store.write` for player-match-spatial and match-events, one partition per gameweek.

PL CDN images -> `syncAssets` -> `FileAssetStore` blobs plus an append only manifest -> served by `GET /assets/:kind/:key`, or hotlinked directly by the web app.

Stored snapshots -> `apps/web` build time reads (`lib/lake.ts`) -> analytics functions -> prerendered pages; this file -> `lib/markdown.ts` -> `/how-it-works`.

## Dependencies

Internal: the package graph above, `core` at the root of it.

External: zod (every schema), cheerio (the rules scraper), hyparquet and hyparquet-writer (the Parquet codec), commander (the CLI), fastify (the API), next and react and recharts (the web app), tsx (the test runner loader), typescript, eslint with typescript-eslint, prettier.

## Related

- [Docs index](INDEX.md): the module map and the documentation format every file here follows.
- [Handoff, continue the build](HANDOFF.md): current state, decisions already made, and what is left.
- [Root README](../README.md): prerequisites, install, and the build, test, lint, and run commands.
- [Core spec](../packages/core/SPEC.md): the models and pure algorithms summarised above.
- [Store spec](../packages/store/SPEC.md): snapshot, manifest, and codec mechanics.
- [Ingest spec](../packages/ingest/SPEC.md): every source, the refresh paths, and the Sofascore adapter.
- [Analytics spec](../packages/analytics/SPEC.md): the derived metrics in full.
- [API spec](../apps/api/SPEC.md): route by route detail.
- [CLI spec](../apps/cli/SPEC.md): command by command detail.

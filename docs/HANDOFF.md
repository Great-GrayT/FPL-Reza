---
title: Handoff, continue the build
type: memory-short
module: root
updated: 2026-08-18
status: active
---

## Read this first

The build is green again and the first commit exists. What was outstanding at the top of this file is done: the `headersOf` type error is fixed by narrowing each branch, `pnpm verify` passes (format, lint, build, 291 tests), the Sofascore adapter is documented in the ingest `SKILL.md` and `SPEC.md`, `docs/INDEX.md` points at everything, and the spatial source is wired into the CLI as an opt in source. The rest of this file is still accurate as context.

New since: `docs/ARCHITECTURE.md` explains the whole platform end to end and is rendered by the web app at `/how-it-works` through `apps/web/lib/markdown.ts`. It is part of the definition of done, so any change to a source, schema, algorithm, package boundary, route, or page updates it in the same commit.

Still outstanding: push to `origin` (the remote is set to `https://github.com/Great-GrayT/FPL-Reza.git`, the push itself needs a human), the live spatial smoke test with `--spatial-max-events 2` and a recorded player resolution hit rate, a web route that renders heatmaps and shotmaps, Vercel setup, and `SKILL.md`/`SPEC.md` for `packages/assets` and `apps/web`.

## Original blocker, resolved

Kept for the record. The repo did not build; one file had one error, fixed by
narrowing each branch of `headersOf` as described below.

Was: `packages/ingest/src/spatial/sofascore/fetch.ts`

```
packages/ingest/src/spatial/sofascore/fetch.ts(80,3): error TS2322:
Type '{ [x: string]: string | readonly string[]; }' is not assignable to
type 'Record<string, string>'.
```

Line 80 is the last line of `headersOf`, which spreads a `HeadersInit` whose
object form allows `readonly string[]` per name. The two other branches in that
function already narrow correctly. The same line also trips
`@typescript-eslint/no-unsafe-return` at 79:31 (`Object.fromEntries` on an
array of pairs returns `any`). Both are the same shape of problem: the function
promises `Record<string, string>` and the input type is wider. Fix by narrowing
each branch explicitly rather than by widening the return type or by disabling
the rule.

Note `flatten` directly below it already does exactly this narrowing for node's
header bag, so follow that pattern.

Once that compiles:

```sh
pnpm verify
```

which is `format:check`, `lint`, `build`, `test` in sequence. Tests were at
**279 passing, 0 failing** when the build broke, so the test suite is healthy
and the failure is confined to type checking and lint.

## Where the work stopped

An agent was building the Sofascore spatial adapter and was stopped mid final
gate, on the user's instruction to hand off. It had already written and tested
the whole adapter. Its files:

```
packages/ingest/src/spatial/index.ts
packages/ingest/src/spatial/sofascore/{client,fetch,identity,map,schemas,source}.ts
packages/ingest/src/spatial/sofascore/{client,identity,map,source}.test.ts
packages/ingest/src/spatial/sofascore/fixture.test-data.ts
```

It did **not** update `packages/ingest/SKILL.md`, `packages/ingest/SPEC.md`, or
`docs/INDEX.md`, and it never ran the live smoke test it was asked for. Those
three are outstanding. Its `spatial-sofascore` source declares
`datasets: [player-match-spatial, match-events]` and
`requires: [teams, players, fixtures]`.

The most valuable thing it produced is the coordinate normalisation in
`map.ts`, derived empirically from real payloads rather than from documentation
the provider does not publish. Do not "simplify" it without rechecking against
the saved fixtures:

- Average positions and heatmaps share a frame whose x already matches the
  domain (both goalkeepers sit near x 11), but whose y is inverted relative to
  the domain's channels, so y is flipped.
- The shotmap frame is that same frame rotated 180 degrees, so a shot needs x
  flipped and y left alone.

## What is finished and verified

| Piece                                                         | State                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/core`, `config`, `store`, `ingest`, `analytics`     | Green, unchanged this session except as noted                                            |
| `packages/assets` (new)                                       | `FileAssetStore`, append only JSONL manifest, `syncAssets`, PL CDN URL builders. 8 tests |
| `POST /fixtures/refresh` (Fastify) and `fpl fixtures refresh` | Live, idempotent, diffs kickoff, gameweek, scores, difficulty per fixture id             |
| `GET /assets/*` (Fastify)                                     | Serves blobs with immutable cache and etag                                               |
| `apps/web` (new, Next.js 15 App Router)                       | Builds, 596 pages, all 590 player profiles prerendered. Every route smoke tested at 200  |
| Real asset download                                           | 462 files, 125 MB on disk, gitignored                                                    |

`apps/web` routes that exist and returned 200 against the built app:
`/`, `/players`, `/players/[id]`, `/matches`, `/api/health`,
`/api/refresh/fixtures`, `/api/refresh/rules`.

## Decisions the user made, do not revisit

- **Host is Vercel.** Its filesystem is read only at runtime.
- **The row lake is committed** (`data/2026-27/`, about 392 KB). `.gitignore`
  excludes only `data/assets/`. The site is built from those snapshots.
- **Player photos are hotlinked** from `resources.premierleague.com` via
  `next/image` `remotePatterns`. The full set is 119 MB and does not belong in
  git. `packages/assets` still downloads them for offline and self host use.
- **No scheduler in this repo.** The user runs an external cron service that
  calls endpoints. Build endpoints, not workflows.
- **Charts use Recharts** for the time series. The pitch and heatmap are hand
  rolled SVG when they get built, because those are not chart shapes.
- **No paid third party services.** Scraping and free public endpoints only.

Because Vercel cannot write, `refreshFixtures` and `refreshRules` both take a
`dryRun` flag. The web endpoints probe `access(lakeRoot, W_OK)` once and set it,
then report `persisted` and a `storage` string so a scheduler is never left
guessing whether a run stored anything. Run the same endpoint against a
writable store and it persists normally.

The refresh endpoints are gated by a shared secret in `REFRESH_TOKEN`, read
from `x-refresh-token` or a bearer `authorization` header. With the variable
unset the gate is open, which is right for local development and wrong in
production, so every response carries `unprotected: true` when it is open.
**Set `REFRESH_TOKEN` in Vercel before giving the URLs to the cron service.**

## Data sources, probed not assumed

Verdicts came from hitting every endpoint with curl in August 2026.

| Source                       | Key needed                                     | Verdict                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FPL public API               | No                                             | Built                                                                                                                                                       |
| Premier League image CDN     | No                                             | Built                                                                                                                                                       |
| football-data.co.uk odds CSV | No                                             | Built                                                                                                                                                       |
| Sofascore                    | No, needs a browser UA and a sofascore Referer | Adapter written, not yet documented or smoke tested                                                                                                         |
| FotMob                       | No headers at all                              | Not built. One call bundle at `/api/data/matchDetails?matchId=`, but its heatmaps come back as pre rendered SVG, so it loses to Sofascore for movement data |
| Transfermarkt                | No, robots allows it                           | Not built. Market values and transfers, HTML scrape                                                                                                         |
| StatsBomb open data          | No                                             | Not built. Only 2015/16 and 2003/04 for the Premier League, so historical validation only, CC BY-NC-SA                                                      |
| Understat                    | n/a                                            | Dead. `robots.txt` disallows all, every league, match, and player URL 404s, the AJAX endpoint needs a session                                               |
| FBref                        | n/a                                            | Dead. Cloudflare challenge on every path                                                                                                                    |
| football-data.org            | Yes, even free tier                            | Skipped                                                                                                                                                     |
| The Odds API                 | Yes, free tier still needs signup              | Skipped                                                                                                                                                     |
| Club Elo                     | No                                             | Unreachable from this network, connects then times out with zero bytes. Worth one retry elsewhere                                                           |

Sofascore field paths that matter, confirmed against real payloads:
`/event/{id}/player/{playerId}/heatmap` returns `{heatmap:[{x,y}]}` already on a
0 to 100 pitch; `/event/{id}/shotmap` carries `playerCoordinates`,
`goalMouthCoordinates`, `xg`, `xgot`; `/event/{id}/average-positions` carries
`averageX` and `averageY`; `/event/{id}/lineups` carries per player match
stats. Premier League `uniqueTournament` is 17, the 2025/26 season id is 76986.

Saved payloads used as fixtures live in the session scratchpad under
`scratchpad/recon/`. If they are gone, refetch from Crystal Palace 1-2 Arsenal,
24 May 2026: Sofascore event `14023963`, FotMob match `4813747`.

## Remaining work, in order

1. ~~Fix the build.~~ Done: `headersOf` narrows per branch, gate is green.
2. ~~Document the spatial adapter.~~ Done: the ingest `SKILL.md` and `SPEC.md`
   cover the transport, the client, both resolvers, the coordinate frames, and
   the source, and `docs/INDEX.md` lists every module plus
   `docs/ARCHITECTURE.md`.
3. Smoke tested live on 2026-08-18, as far as the calendar allows. The
   transport, client, and season listing all answer: `unique-tournament/17/seasons`
   gave the 2026/27 season id, 96668, now in `SOFASCORE_SEASON_IDS`. The season
   had not kicked off (gameweek 1 opens 2026-08-21, and the lake holds 0 finished
   fixtures), so `events/last/0` answers 404 and there is nothing to ingest yet.
   The fixture join rate was measured instead, against 60 scheduled matches: 29 of
   30 before adding the round fallback, 60 of 60 after. The player resolution hit
   rate still needs measuring once gameweek 1 has been played, with
   `--sources spatial-sofascore --spatial-max-events 2`, reading the
   `unresolvedPlayers` and `unresolvedShotTakers` counts the source logs.

   Original instruction, still standing for the player rate: **smoke test live** with a small bound (`maxEvents: 2`)
   and record the player resolution hit rate. Unresolved players are logged and
   skipped by design, not failed, so a low hit rate is silent and needs to be
   measured deliberately.

4. **First commit.** `git init` is done, branch `main`, **nothing is committed
   yet** and about 188 paths are staged or untracked. Commit only once the gate
   is green. The user creates the GitHub repo and adds the remote.
5. Vercel: the project must build the site, not the API. `vercel.json` at the
   repository root now pins `installCommand`, `buildCommand`
   (`pnpm --filter @fpl/web build`), and `outputDirectory` (`apps/web/.next`),
   so point the project root directory at the repository root and leave the
   framework detection to that file. The first deployment of commit 52bf99f
   built `apps/api` instead, reporting `Using src/app.ts as the root entrypoint`,
   which is what that file prevents. Root directory `apps/web` also works only
   if "include files outside the root directory" is on, because the site reads
   `data/` and `docs/ARCHITECTURE.md`. Still set `REFRESH_TOKEN`, and
   `FPL_SEASON` only to pin a season.

   Superseded note, kept for context: root directory `apps/web`. Its build script is
   `tsc --build ../../tsconfig.json && next build`, which builds the workspace
   packages first. Set `REFRESH_TOKEN`, and `FPL_SEASON` if pinning a season.

6. Spatial source is wired into `registerSync` as an opt in source
   (`--sources spatial-sofascore`, bounded by `--spatial-max-events` and
   `--spatial-since-gameweek`). A web route rendering heatmaps and shotmaps
   still does not exist.
7. **Player photo gaps.** 208 of 590 have no published photo, concentrated in
   the promoted clubs (Coventry 23, Hull 21, Sunderland 20) and summer
   signings. That is genuine upstream absence, not a bug: rerun `fpl assets
sync` later in the season and they fill in. The web fallback is a designed
   initial, not a broken image.
8. **Docker image was never built.** The Dockerfile and compose file exist and
   are for self hosting, not Vercel. The daemon was not running.

## Traps that already cost time

- The Premier League CDN answers a **missing object with 403, not 404**. It is
  object storage without public listing. `ABSENT` in `packages/ingest/src/http.ts`
  includes 403 for exactly this reason, with the tradeoff written down there.
- That CDN also returns **200 with a 263 byte body** where a photo was pulled
  but the object was not removed. `syncAssets` enforces `MIN_IMAGE_BYTES` and
  falls through to the next candidate size.
- Rewriting a whole manifest per write is O(n squared) and, on Windows, the
  rename churn intermittently fails with `EPERM` while a scanner holds the
  file. The asset manifest is append only JSONL, last line wins per key. Do not
  "tidy" it back into a single JSON document.
- Client components must import `@fpl/assets/urls`, never `@fpl/assets`. The
  barrel pulls `FileAssetStore` and therefore `node:fs` into the browser
  bundle, which fails the webpack build with `UnhandledSchemeError`.
- `apps/web/tsconfig.json` sets `noPropertyAccessFromIndexSignature: false`.
  CSS module types are an index signature, so the base config's setting makes
  every `styles.foo` an error. This is scoped to the web app only.
- Branded ids are assignable to `number`, so `as number` on them is a lint
  error, not a safety net. Where a `Map` needs plain number keys, annotate the
  `Map` type instead of casting the values.

## House rules

From `~/.claude/CLAUDE.md` and `~/.claude/rules/`, and they are enforced:

- **No em-dashes or double-dashes in prose**, anywhere: docs, commit messages,
  chat. Use commas, colons, parentheses, or a new sentence. Code, commands, and
  identifiers are exempt. A hook checks `.md`, `.mdx`, `.markdown`, `.txt`,
  `.rst` and strips code fences before checking.
- Comments explain **why**, not what.
- **Never install a plugin, skill, or connector.** Surface it and wait.
- Front end work goes through `/frontend-design:frontend-design` (installed,
  version 1.1.0) and each section is audited with `/impeccable`. Design, then
  review, then build. The design already chosen is recorded below.
- `/caveman:cavecrew` is the standing tooling preference.

Toolchain constraints that will bite an agent that assumes otherwise:

- Tests are the **Node built in runner** (`node:test` plus `tsx`). There is no
  vitest and no vite in this repo, deliberately. Do not add either.
- TypeScript is very strict: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `NodeNext` so every
  relative import ends in `.js`, and `erasableSyntaxOnly` so there are no
  enums, no parameter properties, and no namespaces.
- Never cast a raw number to a branded id. Use `asPlayerId`, `asTeamId`,
  `asFixtureId`, `asGameweekId`, `asSeason`.
- Mapping crosses a boundary through a zod schema `.parse`, never a raw cast.

## The web app design, already reviewed

Do not restyle without reading this. The subject grounding is that FPL time is
not continuous, it is 38 discrete slabs, and every decision a manager makes is
per gameweek.

- Palette from printed football ephemera, in `app/globals.css` as tokens:
  `--paper #EDEFE9`, `--ink #14181C`, `--pitch #2E5E3A`, `--flare #E8214F`,
  `--bonus #F0B429`. Flare is rationed to live and current only. A dark variant
  redefines the same tokens under `prefers-color-scheme`.
- Type: Archivo in expanded heavy caps for display, IBM Plex Sans for body, IBM
  Plex Mono for every number so columns align on tabular figures.
- Signature element: `components/gameweek-ribbon.tsx`, 38 cells where bar height
  is points, cell ground is fixture difficulty, and a cell is also the control
  that scrubs the page to that gameweek. It is the sparkline, the fixture
  ticker, and the navigation in one object.
- Motion: one orchestrated moment, the ribbon staggering left to right on load.
  Reduced motion is respected globally in `globals.css`.

Not yet built in the web app: a match detail page, anything rendering spatial
data (heatmap, shotmap, average positions), and odds.

## Commands

```sh
pnpm verify                      # format check, lint, build, test
pnpm build                       # tsc --build across project references
pnpm test                        # node:test over packages/*/src and apps/*/src

pnpm sync                        # full ingest into data/
node apps/cli/dist/bin.js sync --sources fpl-bootstrap,fpl-fixtures
node apps/cli/dist/bin.js fixtures refresh
node apps/cli/dist/bin.js assets sync          # add --force to refetch
node apps/cli/dist/bin.js assets list

pnpm start                       # Fastify API on 3000
cd apps/web && pnpm dev          # Next.js dev server
cd apps/web && pnpm exec next build && pnpm exec next start -p 3100
```

`FPL_MIN_REQUEST_INTERVAL_MS=60` shortens the throttle for a bulk asset run.
The default 250 ms is deliberate politeness against FPL, not a performance
knob, so leave it alone for API syncs.

## Related

- [Docs index](INDEX.md): module map and the documentation format rule.
- [Root README](../README.md): what the project is and how to build and run it.
- [Short term memory](memory/short-term.md): task state before this session.
- [Long term memory](memory/long-term.md): architecture decisions and rationale.
- [Ingest spec](../packages/ingest/SPEC.md): needs the Sofascore source adding.
- [CLI spec](../apps/cli/SPEC.md): needs the `assets` and `fixtures` commands adding.
- [API spec](../apps/api/SPEC.md): needs the assets routes and fixtures refresh adding.

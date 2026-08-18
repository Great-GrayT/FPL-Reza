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

| Source                                                                            | Shape  | What it gives                                                                                                                                | Access                                                                      |
| --------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| FPL public API (`fantasy.premierleague.com/api`)                                  | JSON   | Teams, players, gameweeks, fixtures, per player gameweek history                                                                             | Open                                                                        |
| FPL rules page (`/en/help/rules`), currently client rendered and yielding nothing | HTML   | Deadlines, scoring table, BPS table, chip effects, scoring phases, squad and transfer limits                                                 | Open, scraped                                                               |
| football-data.co.uk season CSV                                                    | CSV    | Closing bookmaker odds per match: 1X2 and over/under 2.5                                                                                     | Open                                                                        |
| Premier League official API (`footballapi.pulselive.com/football`)                | JSON   | 35 seasons of results, referees and the officiating team, teamsheets with formations, managers, grounds with coordinates                     | Open, needs a `premierleague.com` `Origin` and `Referer`                    |
| Open-Meteo (`api.open-meteo.com`, `archive-api.open-meteo.com`)                   | JSON   | Temperature, rain, wind, humidity, cloud and a conditions code at each kickoff                                                               | Open, keyless                                                               |
| Wikimedia Commons, via Wikidata                                                   | JSON   | A licensed photograph of each ground, with its photographer and its licence                                                                  | Open, needs a descriptive user agent                                        |
| Sofascore (`api.sofascore.com/api/v1`)                                            | JSON   | Player heatmaps, average positions, per player match statistics, shot coordinates with expected goals, and national team competition records | Open in principle; answering 403 "challenge" on every path as of 2026-08-18 |
| Premier League image CDN (`resources.premierleague.com`)                          | Images | Player photos, club crests, manager portraits                                                                                                | Open, answers a missing object with 403                                     |

Every candidate source, including the ones rejected, is recorded with its verdict and the date it was probed in [Source catalogue, probed](SOURCES.md), and as data in `packages/core/src/providers.ts`, where a verdict only changes alongside a fresh probe.

In short, as of 2026-08-18: the Premier League's own open, keyless API is now ingested, and it is the largest single addition the lake has had. Open-Meteo is ingested too, and needed no geocoding at all, since a ground carries its own coordinates. Premier Injuries and Transfermarkt both permit collection and render their tables server side. Understat is reachable but its `robots.txt` disallows everything, so it is excluded on the terms rather than the technology; FBref answers a Cloudflare challenge on every path including `robots.txt`; worldfootball.net answers 403; and ClubElo's API refuses connections from this network while its HTML renders, so the API is worth retrying from a runner before anyone parses the page.

### Models

`packages/core` is the only place a domain shape is defined. Every model is a Zod schema plus pure functions over it, never a class, and construction is always `schema.parse(candidate)` so a malformed upstream row fails at the boundary rather than three layers down.

- **Identity.** `PlayerId`, `TeamId`, `FixtureId`, `GameweekId`, `Season` are branded with Zod `.brand()`. A raw number never becomes an id by cast: it goes through `asPlayerId`, `asTeamId`, `asFixtureId`, `asGameweekId`, `asSeason`. `GameweekId` is bounded 1 to 38 at the schema level.
- **Entities.** `Team`, `Player`, `Gameweek`, `Fixture`, `PlayerGameweek`. FPL's `element_type` becomes a `Position` (GKP, DEF, MID, FWD) and its status letter becomes an `Availability` (available, doubtful, injured, suspended, unavailable, not_in_squad).
- **Money.** Prices are integer tenths of a million, never floats, so budget arithmetic is exact. `toMillions`, `fromMillions`, and `formatPrice` convert for display; `sellingPrice` applies FPL's rule that a fall is passed on in full and a rise is only half realised, rounded down.
- **Rules.** `SQUAD_QUOTA` (2/5/5/3, summing to a fixed 15), the starting eleven bounds per position, chip counts and their gameweek 19 split, and the monthly `SCORING_PHASES` table. These are mirrors of the officially published rules, reconciled on 2026-08-16, including the defensive contribution rule. They are not tuning knobs.
- **Spatial.** A pitch normalised 0 to 100 on both axes, always from the perspective of the side attacking towards x 100 (the Opta convention). `THIRDS` and `CHANNELS` name zones, `PHASES` names game phases, and a heatmap is a 12 by 8 grid by default. `PlayerMatchSpatial` and `MatchEvent` hold one match per player and one event (today, one shot) respectively. Every measure past the identity block is nullable on purpose: null means the provider does not carry it, which is not the same as a measured zero.
- **Odds, transfers, providers.** `OddsQuote` is one bookmaker's price for one selection in one market. `clubTransferSchema` keys on `playerCode`, not `playerId`, because FPL reassigns ids every season and codes survive. `PROVIDERS` is a hand maintained registry of candidate feeds with their access mode and coverage.
- **The official record** (`matches.ts`). A `Match` is one match as the Premier League publishes it: clubs by `teamCode`, score, status, ground, attendance, and the referee denormalised onto the row so a card rate needs one dataset rather than two. A `MatchDetail` carries what only a played match has: the officiating team by role, both teamsheets with the formation as rows of person ids, and a timeline. `Ground` and `Manager` complete it. Everything keys on codes, never on ids, because the two providers number matches differently and codes are what they share.
- **Grounds** (`grounds.ts`). `GroundImage` holds a photograph's URL, its photographer, its licence, and the link back to the file page, in one row. That is deliberate: nearly every one of these files is Creative Commons with an attribution condition, so a row that cannot be attributed cannot be published, and putting the credit in the same schema as the URL is what makes that impossible to forget. It also records which rule matched the ground and by how many metres.

### Identity

Every provider join here is one of three kinds, and the difference decides how much a page built on it can be trusted.

The Premier League's own API is an **exact** join. Asked with `altIds=true` it publishes the Opta id beside its own for every club and every person: a club is `t3`, a person is `p231416`. Those digits are precisely FPL's `Team.code` and `Player.code`, so joining the two providers is a substring rather than a match. Nothing is compared by name, nothing is scored, and a row whose Opta id is absent is dropped rather than guessed at. That is why referees, managers, and teamsheets can be attributed to the right people with no ambiguity budget at all.

Sofascore is an **inexact** join, and everything in `ingest/spatial/sofascore/identity.ts` exists because of it: names normalised, clubs resolved through an alias table, any key shared by two players marked ambiguous and resolved to nothing. That machinery is the price of a provider that publishes no shared id, and it is why that adapter refuses far more rows than the official one does.

A ground is joined **geographically**. A Wikipedia search proposes candidate articles, and a candidate is accepted only if the coordinates on its Wikidata item sit within 1,500 metres of the coordinates the Premier League publishes for that ground. That is what resolves "American Express Stadium" to the article titled "Falmer Stadium", and what stops "Selhurst Park" resolving to the suburb of Selhurst, which a name search ranks above the ground and which sits comfortably inside any usable tolerance. Where a ground has no published coordinates, which is true of the three newest, the weaker fallback is a check that the article is a stadium at all, and the stored row records which of the two rules accepted it.

### History

FPL serves a career in two halves, and keeps only one. `element-summary/{id}` carries `history_past`, one row of totals per completed season, which is enough for a career table and costs nothing extra: the nightly sync already calls that endpoint for its per gameweek rows and used to discard the field. What FPL does not keep is the gameweek grain of a closed season, so that comes from the community archive, which captured it while it was live and publishes one merged file per season from 2016/17 onward.

Both key on `playerCode` rather than `playerId`, because FPL reassigns element ids every summer. The archive files its rows by that season's element id, so every row is rekeyed through the same season's `players_raw.csv` before it is stored, and a row whose code cannot be resolved is counted and dropped rather than matched on name.

Storage follows the grain. player-seasons is small and unpartitioned. player-gameweeks-history is partitioned by season and written as Parquet: one season is about 27,000 rows, which is 25 MB as JSONL and 400 KB as Parquet, so ten seasons is roughly 4 MB in a lake that lives in git. Neither is on a schedule, since a completed season does not change: `backfill-history.yml` runs them on dispatch.

### Internationals

FPL carries nothing outside the Premier League, so a national team record needs a provider and therefore an identity join. That join is stored rather than recomputed: `player-provider-ids` maps a permanent player code onto a Sofascore player id and records the evidence it was matched on, so a bounded run resumes where the last stopped and a suspect join can be audited. `internationals` then holds one row per player per national team competition season.

The provider's category flag reads "international" for club friendlies as well as for national competitions, which on the first real run credited an Arsenal player with Arsenal "caps". The fix is structural rather than a list of tournament names: the team on the statistics payload must carry `national: true`. Youth sides are kept and named as the provider names them, so France U20 is not France, and caps are described as a floor because friendlies and untracked competitions are absent.

### Algorithms

Every algorithm below is pure: same input, same output, no I/O.

- **Match scoring** (`core/scoring.ts`). `scorePlayerGameweek` returns a component by component `PointsBreakdown` whose `total` is the sum of its parts. Appearance is 1 point below 60 minutes and 2 at or above. Clean sheet points need both the flag and a full 60 minute appearance. Goals conceded penalties apply to GKP and DEF only, save points to GKP only. A red card resolves alone at minus 3 rather than stacking on the yellow shown in the same incident. Defensive contribution pays a flat 2 points at 10 CBIT actions for a defender or 12 CBIRT actions for a midfielder or forward, and does not stack past the threshold.
- **BPS** (`core/bps.ts`). Named weights are constants a caller looks up. The one computed weight is `passCompletionBps`: nothing below 30 attempted passes, then 2, 4, or 6 points for the 70 to 79, 80 to 89, and 90 plus completion bands.
- **Bonus prediction** (`analytics/bonus.ts`). `predictBonus` sorts a fixture's BPS scores, groups ties, and walks the award slots so a tied group consumes as many slots as it has members: a two way tie for first takes slots one and two, both score 3, and the 2 is skipped. Output preserves input order, not BPS order.
- **Rolling form** (`analytics/form.ts`). `rollingForm` takes the tail of a player's gameweeks and returns points per game, points per 90, minutes per game, expected goal involvements per 90, and starter reliability, the share of considered gameweeks with a full appearance. Every rate goes through `per90`, which returns 0 rather than dividing by zero minutes.
- **Value** (`analytics/value.ts`). Points per million over the season and over a form window, plus price change against the player's starting price, all in tenths.
- **Fixture difficulty** (`analytics/fixtures.ts`). `fixtureDifficulty` walks a horizon of gameweeks from a starting gameweek and reports each fixture's opponent, venue, and difficulty, the average difficulty, and, explicitly, the blank and double gameweeks in that horizon rather than averaging them away. `strengthAdjustedFixtureDifficulty` weights the same horizon by team strength.
- **Defensive contribution** (`analytics/defence.ts`). Summarises CBIT/CBIRT counts against the position's threshold, so a defender's likelihood of hitting the 2 point award is visible rather than inferred.
- **Squad legality and selection** (`analytics/squad.ts`). `validateSquad` reports every violation at once (budget, the 2/5/5/3 quota, three per club, duplicates) rather than the first, and `canAdd` answers the same question for one candidate so a drop target can refuse at the gesture and say why. `bestStartingEleven` searches every legal formation exhaustively, because the top eleven by projection is frequently illegal, and it puts the spare keeper at the front of the bench where only a keeper can replace one. `autoPick` reserves the four bench slots at the cheapest legal prices before spending the rest by projected points per million, since spending evenly across fifteen slots buys a weak eleven. Every function takes a structural `SquadPlayer`, not the full domain row, so the same code runs on the server and in the browser and the two cannot disagree about legality.
- **Points projection** (`analytics/projection.ts`). A stated heuristic with no fitted parameters: points per game over the last six gameweeks (or last season's, before this one has matches), times a fixture term of 1 plus 0.12 per difficulty step either side of neutral clamped to 0.6 and 1.4, times availability and starter reliability. It returns its own explanation as sentences, which is what the interface prints beside a ranking. `differentials` divides that projection by ownership to find overlooked players, and `fixtureSwings` ranks clubs by their run over a horizon with blanks and doubles named rather than averaged away.
- **Team strength and match forecasts** (`analytics/strength.ts`). `estimateStrength` reads every completed match on record and returns, per club, an attack and a defence as ratios to the division average, plus the division's own goals per team per match and its home advantage. It is stated rather than fitted: no optimiser, and no parameter tuned against an outcome the model is later scored on. Seasons are weighted so one counts about half of the one after it (`HALF_LIFE_SEASONS` is 1.5), and a club with fewer than `SHRINKAGE_MATCHES` (10) matches is blended towards the division average in proportion to how little is known, because a club that has played twice has a record rather than a strength. `forecastMatch` turns two clubs into two goal expectations, splitting home advantage either side of the fixture so the total stays on the league's scale, then reads outcome, clean sheet, both to score, over 2.5, and the likeliest scorelines off the same independent Poisson grid that `fitGoalExpectations` inverts. `explainForecast` returns the model's own account of itself, including the two things it gets wrong: it knows results and not squads, so a club gutted in a transfer window still looks like last season's club, and independence understates draws, because in a real match a side two down attacks.
- **Records over the official archive** (`core/matches.ts`). `headToHead` reads the record between two clubs from the first one's point of view rather than the venue's; `teamRecord` and `recentForm` do the same for a single club. `refereeRecord` counts appointments across every season stored but averages cards only over the seasons whose timelines are stored, returning null rather than zero where nothing was measured, since "not measured" and "never booked anyone" are different claims.
- **Odds to expectations** (`core/odds.ts`). Bookmaker prices become probabilities, then `removeOverround` normalises them to sum to 1 (the bookmaker's margin is stripped proportionally). `fitGoalExpectations` then recovers the home and away goal expectations implied by those fair probabilities: it scores a candidate pair by building an independent Poisson scoreline grid (`poissonPmf`, `scorelineProbabilities`) and taking the sum of squared error against the market's home, draw, away, and, where an over/under market exists, over 2.5 probabilities. The search is a 0.05 step grid over 0.05 to 4.5 on each axis, then a 0.01 step pass bracketing the winner, because the error surface is smooth and unimodal in that range and a real solver would buy nothing. `fixtureOutlook` wraps that into outcome probabilities, goal expectations, and a clean sheet probability per side, where a clean sheet is `exp(-lambda)` for the opposing expectation.
- **Rules diffing** (`ingest/rules/diff.ts`). Every keyed collection is compared by its own key (deadlines by gameweek, scoring and BPS rows by action, chips by name, phases by name, sections by heading), so the diff names what changed rather than only that something did. A SHA-256 checksum of the scraped text is a cheap first signal, but `changed` also turns true on any keyed difference, so a checksum collision cannot mask a real change.
- **Fixture diffing** (`ingest/fixtures/diff.ts`). Kickoff, gameweek, both scores, both difficulties, and the finished flag, compared per fixture id.
- **Provider identity joins** (`ingest/spatial/sofascore/identity.ts`). This is the highest risk code in the repo, because a wrong join silently attributes one player's match to another and nothing downstream can detect it. Names are normalised by stripping diacritics and every non alphanumeric character. A club name resolves through the shared odds resolver, then a Sofascore alias table, then a prefix rule. A fixture resolves on the resolved team pair plus the closest kickoff within a 4 hour tolerance, or, where no kickoff is close enough, on the pair identifying a single fixture whose gameweek equals the provider round, which is what carries a match the two sides have rescheduled days apart. A player resolves from strong forms scoped to the club, then weak forms (family name, initial plus family name) scoped to the club, then an unambiguous full name across the league, which is the only way to reach a player who has since moved. Any key shared by two candidates is marked ambiguous and resolves to nothing, and every resolver returns undefined rather than a best guess. The source counts and logs what it dropped.
- **Coordinate normalisation** (`ingest/spatial/sofascore/map.ts`). Established empirically from real payloads, since the provider documents nothing. Average positions and heatmaps share a frame whose x already matches the domain (both goalkeepers sit near x 11) but whose y is inverted, so y is flipped. The shot frame is that same frame rotated 180 degrees, so a shot has x flipped and y left alone. Both transforms clamp to the pitch bounds.
- **Parquet type inference** (`store/parquet.ts`). Per column, the narrowest of BOOLEAN, INT32, DOUBLE, or STRING that fits every non null value; anything that does not fit is written as JSON text. Dates never reach a codec: they are serialised to ISO strings first and read back with `z.coerce.date()`, so the round trip is lossless and format independent.

### Packages

```
packages/core       domain schemas, branded ids, money, rules, scoring, BPS, spatial, odds, matches and officials, grounds, logger, errors
packages/config     environment driven configuration and season derivation
packages/store      the Store port and FileStore: the snapshot data lake
packages/ingest     HTTP client, FPL sources, the PL official record, weather, ground photographs, rules scraper, odds CSV, Sofascore spatial, sync runner
packages/analytics  form, value, fixture difficulty, defence, bonus prediction, squad rules, projection, team strength and match forecasts, the metric glossary
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
- Partitions are how per gameweek data lands: `player-gameweeks`, `player-match-spatial`, and `match-events` write one partition per gameweek (`gw1`, `gw2`, and so on), each written once per run rather than once per player. A spatial backfill of a completed season partitions as `{season}-gw{n}` instead, because two seasons of gameweek 3 are not the same partition and writing both to `gw3` would silently replace one with the other.
- Season is a partition too, for anything whose grain is a season: `matches` and `match-details` write one partition per season, and `player-gameweeks-history` does the same, so adding a season never rewrites the others.
- A batch may name its own codec, overriding the run's. Some row shapes only survive one: a teamsheet is a nested array that Parquet would flatten to JSON text unreadable through its schema, and 13,546 flat result rows are 432 KB as Parquet against roughly 20 MB as JSONL, in a lake that lives in git. That is not a preference a caller should have to know, so the source producing the row states it.
- Dataset and partition names are sanitised into path segments because they can come from an upstream source. A season's slash becomes a hyphen, and capture timestamps lose their colons, since Windows will not accept them in a filename.
- Single writer per dataset is assumed. Two concurrent syncs of the same dataset race the manifest; there is no locking.
- Asset blobs are a separate store with an append only JSONL manifest, last line wins per key, because rewriting a whole manifest per file is quadratic and, on Windows, the rename churn intermittently fails with `EPERM` while a scanner holds the file.

### Ingestion

`runSync` takes a list of sources, orders them so a source only runs once every dataset it requires has been produced (or is not produced by anything in this run, in which case it is assumed already stored), and writes each yielded batch through the store. A source failure is recorded on its run and, unless `continueOnError` is set, stops the rest.

Sources today:

| Source               | Datasets                                  | Requires                 | Notes                                                 |
| -------------------- | ----------------------------------------- | ------------------------ | ----------------------------------------------------- |
| `fpl-bootstrap`      | teams, gameweeks, players                 | none                     | One request, three datasets                           |
| `fpl-fixtures`       | fixtures                                  | none                     | One request                                           |
| `fpl-player-history` | player-gameweeks                          | players                  | Roughly one request per player, so the slowest by far |
| `fpl-rules`          | rules                                     | none                     | Unconditional fresh snapshot per run                  |
| `odds-football-data` | odds                                      | teams                    | One season CSV, club names resolved to team ids       |
| `spatial-sofascore`  | player-match-spatial, match-events        | teams, players, fixtures | Opt in only, see below                                |
| `pl-official`        | matches, match-details, managers, grounds | none                     | 35 seasons of results, teamsheets for the recent ones |
| `weather-open-meteo` | match-weather                             | matches, grounds         | One request per ground per matchday                   |
| `grounds-wikimedia`  | ground-images                             | grounds                  | One photograph per ground, with its licence           |

The rules pipeline currently returns nothing. The published page went client rendered: its HTML has no tables and no embedded payload, so `parseRules` produces an empty document, and both write paths refuse to store it (`isUsableRulesDocument`). The lake therefore has no rules dataset and the API answers 404 for `/rules`. The scraper, the differ, and their tests still stand; what is missing is the JSON endpoint the page now fetches.

`pl-official` is one source rather than four because all four datasets hang off the same season list, and splitting them would mean resolving that list four times. Its cost is entirely in the detail pass, one request per played match, which is why the season counts are separate options: 35 seasons of results are about 140 listing requests, and two seasons of teamsheets are 760. An unplayed match is skipped there, since it has no teamsheet, no timeline, and no referee appointed yet.

`grounds-wikimedia` and `weather-open-meteo` are both cheap and both bounded by their own nature: one photograph per ground, and one weather request per ground per matchday inside the forecast horizon. The forecast reaches about sixteen days and answers anything further with 400, so the window default stays inside it rather than spending requests to be told no.

Two paths deliberately sit outside `runSync`, because an interactive check should not create a snapshot every time it runs: `refreshRules` and `refreshFixtures` scrape or fetch, diff against the stored snapshot, and write only on a change. Both take a `dryRun` flag for a host whose filesystem is read only. `refreshRules` always writes JSONL regardless of the configured format, because the rules document is one deeply nested row and the Parquet codec would flatten it to JSON text that could not be read back through the schema.

`spatial-sofascore` is opt in from the CLI (`--sources spatial-sofascore`) and excluded from a bare `fpl sync`, because it costs roughly one request per player per match against a client throttled to a 500 ms floor: a full season is hours of traffic. Bound a run with `--spatial-max-events` or `--spatial-since-gameweek`.

The HTTP client retries only 408, 425, 429, 500, 502, 503, and 504 plus network and timeout faults; any other non ok status is a terminal `SourceError` on the first attempt. Backoff doubles from 250 ms, and a numeric `Retry-After` header wins over the computed value. The minimum request interval is deliberate politeness, not a performance knob. Sofascore gets its own client because that provider fingerprints the TLS handshake, so the request needs a browser cipher order as well as browser headers.

### Serving

- **`apps/api`** is Fastify over a `FileStore` built in `deps.ts`: `GET /health`, `/players`, `/players/:id`, `/players/:id/history`, `/fixtures`, `/gameweeks`, `/gameweeks/current`, `/gameweeks/next`, `/rules`, `/rules/deadlines`, `/assets`, `/assets/:kind/:key`, plus `POST /fixtures/refresh` and `POST /rules/refresh`. Asset blobs are served with an immutable cache header and an etag.
- **`apps/cli`** is the `fpl` command: `sync`, `fixtures refresh`, `rules refresh`, `rules deadlines`, `assets sync`, `assets list`, `players`, `datasets`, `show player`. Every command reads or writes through a `FileStore` built in `bin.ts`, and every listing command can print JSON instead of a table.
  The site refuses to build against a lake it cannot see. The four datasets every page needs (teams, players, gameweeks, fixtures) are read through a required reader that throws, naming the resolved lake root, rather than resolving empty. History is read through optional readers, so a clone with no backfill still builds and simply shows no career. This exists because the failure it replaces was silent: a deployment whose root directory excluded the repository root rendered a complete, blank site.

- **`apps/web`** is Next.js 15 App Router, rendered at build time from the committed lake: `/`, `/players`, `/players/[id]`, `/matches`, `/matches/[id]`, `/teams`, `/teams/[code]`, `/managers`, `/managers/[id]`, `/referees`, `/referees/[id]`, `/grounds`, `/stats`, `/builder`, `/scout`, `/glossary`, `/how-it-works`, plus `/api/health`, `/api/refresh/fixtures`, and `/api/refresh/rules`. That is 1,109 prerendered pages: 590 player profiles, 380 match pages, 76 managers, 28 referees, and 20 clubs.

  `/matches/[id]` is the match centre, and it is the page the official record was ingested for. Before kickoff it prints what the model makes of the fixture, the eleven each club is likely to name, the record between the two clubs across every season stored, both managers, the referee once appointed, the conditions, and the ground. After kickoff the same page prints the confirmed teamsheets in the shape they were named in, the timeline, and the result. Nothing on it is a prediction without its reasoning attached: the likely eleven states which match it took its shape from and names every replacement with the reason, and the forecast carries a disclosure that prints the model's sample, its baseline, and its two known errors.

  `/teams/[code]` is a club end to end: staff with their photographs, estimated strength, the next six fixtures, the squad ranked by projection, a record for every season the club has played, and the clubs it has fared worst against. `/managers` and `/referees` are the people the record names, each with their own page. `/grounds` is where the season is played, photographed and credited. `/stats` is the analysis the 35 season archive makes possible: home advantage season by season, goals per match, the strongest attacks and meanest defences, and who books the most, each with the caveat that applies to it.

  `/builder` is the squad builder: the fifteen slots are a teamsheet, the ruled card handed over at kickoff, rather than a green pitch. A name is added by pressing it or dragged onto a slot, which keeps the whole interface reachable from a keyboard and a touch screen, and a slot refuses a drop at the gesture with the reason. `/scout` answers three questions with the same numbers: who is overlooked, whose fixtures turn, and who to captain. `/glossary` prints the dictionary in `analytics/glossary.ts`, and every metric label across the site links into it, because a number whose definition is not one click away is a number nobody should trust.

Deployment is one Vercel project whose root directory is `apps/web`, because that is the only `package.json` declaring `next`: pointed at `apps/api` Vercel deploys the Fastify server, and pointed at the repository root it fails with `No Next.js version detected`. Vercel installs the workspace from the repository root and runs that package's build script, which builds every workspace package first. "Include files outside the Root Directory" has to stay on, since the site reads the committed lake in `data/` and reads this file for `/how-it-works`, both outside `apps/web`.

The refresh endpoints are gated by a shared secret in `REFRESH_TOKEN`, read from `x-refresh-token` or a bearer `authorization` header. With the variable unset the gate is open, which is right locally and wrong in production, so every response carries `unprotected: true` while it is open. Freshness is a git problem, not a runtime one. Vercel cannot write, so a refresh endpoint on the deployed site reports a diff and persists nothing (`dryRun`). What actually updates the site is `.github/workflows/refresh-lake.yml`, hourly, running `fpl fixtures refresh` and `fpl rules refresh` and committing whatever changed, and `.github/workflows/sync-lake.yml`, daily at 02:15 UTC after FPL settles overnight price changes, running the full sync with `--skip-unplayed --continue-on-error`. The push is what triggers the redeploy. Both share a `fpl-lake` concurrency group, because the store assumes a single writer per dataset and two runs would race the same manifest.

### Front end

The subject grounding of the design is that FPL time is not continuous. It is 38 discrete slabs, and every decision a manager makes is per gameweek.

- Palette from printed football ephemera, as tokens in `app/globals.css`: `--paper`, `--ink`, `--pitch`, `--flare`, `--bonus`. Flare is rationed to live and current only. A dark variant redefines the same tokens under `prefers-color-scheme`.
- Type: Archivo in expanded heavy caps for display, IBM Plex Sans for body, IBM Plex Mono for every number so columns align on tabular figures.
- The signature element is `components/gameweek-ribbon.tsx`: 38 cells where bar height is points and cell ground is fixture difficulty, and where a cell is also the control that scrubs the page to that gameweek. It is the sparkline, the fixture ticker, and the navigation in one object. Selecting a cell now narrows the whole player page rather than only the table: the trend chart marks the week rather than filtering to it, since one point is not a trend, and the pitch heatmap narrows to it.
- Every person the site names carries a face, through one `components/person-photo.tsx` used for players, managers, and officials alike. The three differ only in how the CDN keys them (`p` for a player, `man` for a manager, nothing at all for a referee), and a person with no published photograph gets a designed monogram rather than a broken image, which is the normal state for about a third of players before a season opens and for every referee.
- The pitch is hand rolled SVG in `components/pitch.tsx`, drawn at the real 105 by 68 metre ratio so a heat cell is square on the ground rather than square on the screen. `components/player-heatmap.tsx` adds match heatmaps cell by cell and lets the reader pick the season and the gameweek, because a heatmap with no period attached is the most confidently wrong chart a site can publish. `components/team-sheet.tsx` draws a formation from the provider's own positional rows rather than from its label, since "4-2-3-1" says how many are in each band and nothing about who.
- Motion is one orchestrated moment, the ribbon staggering left to right on load. Reduced motion is respected globally.
- Time series use Recharts. The pitch and heatmap will be hand rolled SVG when they are built, because those are not chart shapes.
- Client components import `@fpl/assets/urls`, never `@fpl/assets`: the barrel pulls `node:fs` into the browser bundle and fails the build.

`/how-it-works` reads this file from disk at build time, parses it with the small markdown renderer in `apps/web/lib/markdown.ts`, and renders it in the site's own type and colour. There is no markdown dependency: the renderer covers exactly the subset this document uses (headings, paragraphs, lists, tables, fenced code, inline code, links, emphasis) and escapes everything before emitting it.

## Logic

Decisions a reader could not infer from the code, and the reasons behind them.

- **The row lake is committed.** `data/2026-27/` lives in git, because the host (Vercel) cannot write at runtime and the site is built from those snapshots. `.gitignore` excludes only `data/assets/`, the image blobs, which are 119 MB and hotlinked instead. The official record is what makes the lake's size worth stating: 13,546 results across 35 seasons are 432 KB as Parquet and would be about 20 MB as JSONL, while two seasons of teamsheets and timelines are 9.6 MB and have to be JSONL, because the Parquet codec flattens a nested teamsheet to JSON text that cannot be read back through its schema. That is why a batch names its own codec rather than inheriting one from the run.
- **A photograph without its credit is not published.** Ground photographs are Creative Commons, and the licence condition is attribution. So the credit and the licence live in the same row as the URL, the component that renders one has no prop to suppress them, and a file whose photographer cannot be read is refused at ingest: on 2026-08-18 that left 19 of 20 grounds with a photograph, and the twentieth with a drawn plate.
- **Snapshots are immutable, and only changes are worth a snapshot.** A full sync always captures. An interactive refresh writes only on a diff, so polling every few minutes does not fill the lake with identical files.
- **Null is not zero.** Across the spatial and event schemas, a missing measure stays null, because "the provider does not carry this" and "this was measured as zero" are different facts and collapsing them silently corrupts any per 90 rate computed later.
- **A missing join is better than a wrong one.** Every provider resolver refuses to guess and the caller counts the misses, because a wrong player id produces plausible, undetectable data.
- **Rules constants mirror the published rules.** They were reconciled against the official page and are checked by tests. They are not a place to encode a preference.
- **Tests are `node:test` plus `tsx`.** There is no vitest and no Vite in this repo, deliberately. TypeScript runs strict, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `NodeNext` (so every relative import ends in `.js`), and `erasableSyntaxOnly` (no enums, no parameter properties, no namespaces).
- **A missing season file is not a failure.** football-data.co.uk publishes a season CSV only once that season is under way, and answers a path it does not hold with 300 Multiple Choices, not 404, because of Apache content negotiation. The odds source treats 300, 403, 404, and 410 as absence and yields nothing.
- **A partial sync still commits.** The scheduled workflows let a source fail, commit whatever the other sources wrote, and only then fail the job. One upstream having a bad morning must not discard a completed bootstrap, fixtures, and player history run.
- **403 can mean absent.** The Premier League CDN answers a missing object with 403 rather than 404, and also returns 200 with a 263 byte body where a photo was pulled but the object was not removed, so `syncAssets` enforces a minimum image size and falls through to the next candidate.

## Data flow

FPL bootstrap JSON -> `FplClient.bootstrap` -> `toTeam`/`toGameweek`/`toPlayer` -> `bootstrapSource` -> `runSync` -> `Store.write` for teams, gameweeks, players.

FPL fixtures JSON -> `FplClient.fixtures` -> `toFixture` -> either `fixturesSource` inside a sync, or `refreshFixtures` -> `diffFixtures` against the stored snapshot -> `Store.write` only on a change.

Stored players -> one `FplClient.playerHistory` call per player -> `toPlayerGameweek` -> grouped by gameweek -> `Store.write` for player-gameweeks, one partition per gameweek.

Rules page HTML -> `parseRules` -> `RulesDocument` -> `rulesSource` (always writes) or `refreshRules` -> `diffRules` -> `Store.write` as JSONL only on a change.

football-data CSV -> `parseCsvObjects` -> `parseFootballDataCsv` with a team resolver built from stored teams -> `OddsQuote` rows -> `Store.write` for odds -> `matchOutcomeProbabilities` and `fitGoalExpectations` turn them into expectations.

Sofascore listing pages -> per event lineups, average positions, shotmap, and one heatmap per player -> `buildFixtureResolver` and `buildPlayerResolver` join to domain ids -> `fromTeamFrame`/`fromShotFrame` normalise coordinates -> `toPlayerMatchSpatial`/`toMatchEvent` -> `Store.write` for player-match-spatial and match-events, one partition per gameweek.

PL CDN images -> `syncAssets` -> `FileAssetStore` blobs plus an append only manifest -> served by `GET /assets/:kind/:key`, or hotlinked directly by the web app.

Premier League API season list -> per season fixture pages -> `toMatch` -> the matches dataset, one Parquet partition per season; for the recent seasons, one detail request per played match -> `toMatchDetail` -> teamsheets, officials, and a timeline as JSONL, with the referee lifted back onto the slim row -> the match-details dataset. Team lists give grounds, and per club per season staff give managers.

Stored grounds -> a Wikipedia search per ground -> Wikidata coordinates checked against the ground's own -> Wikidata P18 -> Commons `imageinfo` for the URL, the licence, and the photographer -> the ground-images dataset.

Stored matches plus grounds -> one Open-Meteo request per ground per matchday, forecast or archive by kickoff date -> the hour of each kickoff read out of the block -> the match-weather dataset.

Every stored match -> `estimateStrength` -> `forecastMatch` -> the probabilities on the match page, the matches list, and the home page.

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

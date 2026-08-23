---
title: Ingest skill
type: skill
module: packages/ingest
updated: 2026-08-18
status: active
---

## Purpose

Owns the Source port and SourceRegistry, an HttpClient with retry, backoff, and request throttling, the FplClient wrapper over the public FPL endpoints, the three FPL sources (bootstrap, fixtures, player history) and their raw to domain mapping, and the dependency ordered sync runner (runSync, orderByDependencies).

Also owns the rules page pipeline end to end: the HTML scraper (rules/parse.ts, rules/schema.ts, rules/london-time.ts), a Source that wraps it for a batch sync (rules/source.ts, rulesSource), and a diff aware refresh path (rules/diff.ts, rules/refresh.ts) that only writes a new snapshot when the page actually changed. All three are exported from packages/ingest/src/index.ts and both apps/cli and apps/api call refreshRules directly.

Also owns a small odds ingestion path: an RFC 4180 CSV reader (csv.ts), a football-data.co.uk season CSV parser and its Source (odds/football-data.ts, odds/source.ts), and a provider club name resolver (odds/team-names.ts).

Also owns the fixtures refresh path (fixtures/refresh.ts, fixtures/diff.ts): a refetch that diffs kickoff, gameweek, scores, and difficulty per fixture id against the stored snapshot and writes only when something moved, plus a `dryRun` mode for a read only host. Both apps/cli and apps/api and apps/web call `refreshFixtures` directly.

Also owns the Sofascore spatial adapter (spatial/sofascore/): its own fetch transport with a browser TLS cipher order (fetch.ts), a typed client over the provider endpoints (client.ts, schemas.ts), the provider to domain identity joins (identity.ts), the coordinate frame normalisation and row mapping (map.ts), and the `spatial-sofascore` Source (source.ts) which produces the player-match-spatial and match-events datasets from teams, players, and fixtures.

Also owns the Premier League official record (`pl/`): a typed client over its keyless API (`client.ts`, `schemas.ts`), the raw to domain mapping including the Opta id extraction that makes the join exact (`map.ts`), and the `pl-official` Source (`source.ts`) which produces the matches, match-details, managers, and grounds datasets.

Also owns the congestion calendar (`pl/calendar.ts`): `plCalendarSource` reads every fixture a Premier League club plays across the five competitions the Premier League API publishes (the league, both European competitions, the FA Cup, the League Cup) into the club-fixtures dataset, partitioned by the fixture's own season.

Also owns match conditions (`weather/source.ts`): `weatherSource` reads Open-Meteo for every match inside the forecast horizon, one request per ground per matchday, choosing between the forecast and the archive endpoints by kickoff date.

Also owns ground photographs (`grounds/wikimedia.ts`): `groundImagesSource` resolves a licensed photograph per ground through Wikipedia search, Wikidata coordinates, and the Commons `imageinfo` API, and refuses any file whose credit cannot be read.

Also owns the history backfills (`history/`): `playerSeasonsSource` maps FPL's `history_past` into the player-seasons dataset, and `archiveHistorySource` reads per gameweek rows for completed seasons from the community archive at github.com/vaastav/Fantasy-Premier-League, rekeying each row from that season's element id to the permanent player code.

Also owns the internationals pipeline (`internationals/source.ts`): `providerIdsSource` maps FPL player codes onto Sofascore player ids one search at a time, and `internationalsSource` reads national team competition records for every mapped player.

Does not own: config loading (packages/config), snapshot storage mechanics (packages/store), scoring, squad rules, or the spatial/odds/transfer domain schemas (all packages/core).

## Skills used in this section

- cavecrew-investigator: before adding a new Source, locate every existing entry in DATASETS and every SourceRegistry registration so a new dataset name does not collide with one already in use. DATASETS reserves two names with no Source yet (ownership, clubTransfers); playerMatchSpatial and matchEvents are now produced by the Sofascore spatial source. Check there before assuming a name is free.
- verify-and-stop: after touching the coordinate normalisation in spatial/sofascore/map.ts or either resolver in identity.ts, run the package tests; both are covered by fixture driven suites built from real payloads, and a silent regression there misattributes one player's match to another.
- verify-and-stop: after touching http.ts's retry, backoff, or throttling logic, the rules scraper or differ, or the CSV/odds parsing, run the package tests, all covered by fixture driven node:test suites that assert exact wait times, exact parsed values, and exact diffs.

## Constraints

- Source is a port: a new upstream (a private feed, a scraped PDF, a tracking data provider) implements Source and registers with SourceRegistry; runSync itself must never be edited to special case a new source.
- HttpClient retries only a fixed set of statuses (408, 425, 429, 500, 502, 503, 504) plus network or timeout faults; any other non ok status becomes a terminal SourceError on the first attempt.
- HttpClient enforces a floor on the gap between requests (minRequestIntervalMs); this is deliberate throttling of a client against FPL, not a performance optimisation to remove.
- Raw FPL response schemas (fpl/schemas.ts) strip unknown keys rather than rejecting the payload, since FPL adds fields mid season without notice and a strict schema would turn that into an outage.
- Mapping (fpl/map.ts) always goes through packages/core's Zod schemas, never a raw cast; a malformed upstream row must fail at the mapping boundary, not three layers downstream.
- refreshRules always writes the rules dataset as JSONL, never the caller's default format: the RulesDocument is a single deeply nested row, and the Parquet codec flattens nested values to JSON text, which would not survive a schema checked read back.
- rulesSource (used by a batch sync) writes a fresh snapshot every run, subject only to the usability guard below; refreshRules (used by the CLI's rules refresh command and the API's POST /rules/refresh) is the only path that diffs against the stored version first and skips the write when nothing changed. Do not merge the two: a scheduled sync should always capture the current page, an interactive refresh should not create noise snapshots.

- The Sofascore coordinate frames in spatial/sofascore/map.ts were derived empirically from real payloads, since the provider publishes no documentation. Average positions and heatmaps need y flipped; a shot needs x flipped and y left alone. Do not "simplify" either transform without rechecking it against fixture.test-data.ts.
- Every identity resolver in spatial/sofascore/identity.ts returns undefined rather than a best guess, and the source counts and logs what it could not join. A wrong player id is worse than a missing row, because nothing downstream can detect it. The fixture resolver has exactly one loosening, a round fallback that needs the club pair to identify a single fixture and the provider round to equal that fixture gameweek; keep any future rule that conservative.
- sofascoreFetch exists because the provider fingerprints the TLS handshake, not only the headers: node's built in fetch is answered with 403 on every path. It is a transport only, so retry, backoff, and throttling stay with HttpClient. No key or account is involved.
- The spatial source costs roughly one request per player per match at a 500 ms floor, so it is opt in from the CLI (`--sources spatial-sofascore`) and never part of a bare sync. Bound a run with `maxEvents` or `sinceGameweek`.
- Neither rules path stores an unusable document. `isUsableRulesDocument` requires at least one deadline, scoring row, or BPS row, and both refreshRules and rulesSource skip the write when it fails. As of 2026-08-18 the published page is rendered client side (no tables, no embedded payload, not even the word "Deadline" in the HTML), so every scrape currently fails that check. Storing the empty document would publish "no deadlines" as though it were measured. Fixing the scrape means finding the JSON the page fetches, not loosening this guard.
- footballDataOddsSource treats 300, 403, 404, and 410 on the season CSV as "not published yet" and yields nothing. 300 is there because the provider serves a path it does not hold through Apache content negotiation, which is what a season file answers before that season starts. A scheduled sync must not fail over a file that does not exist.
- Both history sources are backfills, not nightly work: completed seasons do not change. `playerSeasonsSource` deliberately does not piggyback on `playerHistorySource`, even though they call the same endpoint, because the nightly sync skips players with no minutes and a partial snapshot would shadow a complete one (a read takes the newest snapshot whole).
- The archive keys rows by that season's element id, which FPL reassigns every summer. Every row is rekeyed through the same season's `players_raw.csv` before it is stored, and a row whose code cannot be resolved is counted and dropped. Never fall back to matching on name.
- Archive snapshots are written as Parquet, not JSONL. One season is about 27,000 rows: 400 KB as Parquet against 25 MB as JSONL, and the lake lives in git.
- The internationals pipeline is two sources on purpose. The mapping is expensive (one search per player) and permanent, so it is never redone for a player already mapped; the records change only when a tournament is played. Both yield the whole dataset, existing rows included, because a snapshot read takes the newest file whole and a partial write would erase everyone else.
- A provider category flag of "international" is not sufficient evidence of a cap: the provider files club friendlies such as the Emirates Cup under that category, and the first real run duly credited an Arsenal player with Arsenal "caps". The team on the statistics payload must itself carry `national: true`. Youth sides are kept and named as the provider names them, so France U20 is not France.
- `plMatchesSource` never matches on a name. Both joins come from the Opta ids the provider publishes with `altIds=true`, and a row that cannot produce one is dropped and counted. Do not add a name fallback: this source's whole value over the Sofascore one is that it needs no ambiguity budget.
- A batch may now name its own `format`, and `pl-official` uses both: matches must be Parquet, since 13,546 rows are 432 KB there against roughly 20 MB as JSONL in a lake that lives in git; match-details must be JSONL, since a teamsheet is a nested array that Parquet flattens into JSON text unreadable through its schema. Neither is a preference.
- `plMatchesSource` skips an unplayed match in the detail pass. There is no teamsheet, no timeline, and no referee appointed until the week of a match, so a request would buy nothing.
- `groundImagesSource` refuses a photograph whose photographer or licence cannot be read from Commons, and falls through to the next candidate rather than storing it. Attribution is a licence condition, so an unattributable file is not a partial result, it is an unpublishable one.
- The ground join is by coordinates, not by name, and takes the closest qualifying candidate rather than the first. Searching "Selhurst Park" ranks the suburb of Selhurst above the ground and both sit inside any usable tolerance, so first past the post picked a photograph of a residential street. Where a ground has no published coordinates, the fallback checks the article is a stadium and the stored row records that the weaker rule was used.
- `weatherSource` defaults to a 14 day window because the forecast reaches about 16 days and answers anything beyond with 400. Widening it spends a request per ground per matchday to be told no.
- `sofascoreSpatialSource` takes a `backfillSeason`, which resolves fixtures from the official `matches` dataset instead of FPL's live `fixtures`, and partitions as `{season}-gw{n}`. Two seasons of gameweek 3 are not the same partition, and writing both to `gw3` would silently replace one with the other.

- refreshFixtures writes only when the diff reports a change, unless `always` is set. A fixture list polled every few minutes would otherwise fill the lake with identical snapshots.

- `plCalendarSource` partitions by the fixture's own season, never the run's. Europe and the FA Cup publish a season only once it is drawn, so a run in August legitimately returns last season's ties for three of the five competitions, and filing those under this season would be a claim nobody made.
- The calendar is a separate dataset from matches on purpose. `estimateStrength` reads every row of `matches`, and a cup tie against a fourth tier club would rate a side on opposition it never meets in the league. The calendar answers one question, how much football a squad is playing, and nothing else reads it.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Ingest spec](SPEC.md): full method and logic detail for everything summarised above.
- [CLI spec](../../apps/cli/SPEC.md): the sync and rules commands are built directly on this package's sources and refreshRules.
- [API spec](../../apps/api/SPEC.md): the rules routes call this package's refreshRules and readLatestRules directly.

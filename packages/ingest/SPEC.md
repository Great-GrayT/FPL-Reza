---
title: Ingest spec
type: spec
module: packages/ingest
updated: 2026-08-18
status: active
---

## Purpose

Fetches Fantasy Premier League data over HTTP, maps it onto packages/core's domain schemas, and writes it through packages/store's Store port, via a set of independent Source implementations run in dependency order by a single sync runner. Also scrapes the published rules page (with a diff aware refresh path) and parses football-data.co.uk odds CSVs, both wired into the sync pipeline and both callable directly by a consuming app, refreshes the fixture list on its own with a per fixture diff, and ingests player movement from Sofascore (heatmaps, average positions, per player match statistics, shot coordinates) through its own transport and identity joins.

## Methods

### HttpClient.getJson(pathname): Promise<unknown>

In: a path relative to the client's baseUrl, or an absolute URL. Out: the parsed JSON body. Errors: throws SourceError once retries are exhausted or on a non retryable status. Notes: every call passes through throttle() first.

### HttpClient.getText(pathname): Promise<string>

In: a path or absolute URL. Out: the response body as text. Errors: same as getJson. Notes: used for the rules page, which is HTML rather than JSON, requested with an HTML accept header.

### FplClient.bootstrap(): Promise<Bootstrap>

In: none. Out: teams, gameweeks (events), and players (elements) from bootstrap-static/, each still in FPL's raw shape. Errors: throws ValidationError if the payload does not match bootstrapSchema.

### FplClient.fixtures(): Promise<RawFixture[]>

In: none. Out: every fixture from fixtures/, raw shape. Errors: throws ValidationError on schema mismatch.

### FplClient.playerHistory(playerId): Promise<RawHistory[]>

In: an FPL player id. Out: that player's per gameweek history from element-summary/{id}/. Errors: throws ValidationError on schema mismatch.

### toTeam(raw) / toGameweek(raw) / toPlayer(raw) / toFixture(raw) / toPlayerGameweek(raw)

In: one raw FPL record of the matching kind. Out: the corresponding packages/core entity (Team, Gameweek, Player, Fixture, PlayerGameweek). Errors: each throws whatever the underlying core schema throws on invalid input, since every mapper calls schema.parse, not safeParse. Notes: field renames follow FPL's snake case names to this codebase's camelCase (for example short_name to shortName, now_cost to price); toPlayer also derives startPrice as now_cost minus cost_change_start.

### bootstrapSource(client): Source

In: an FplClient. Out: a Source named fpl-bootstrap that yields three batches (teams, gameweeks, players) from one bootstrap call. Errors: propagates FplClient.bootstrap's errors.

### fixturesSource(client): Source

In: an FplClient. Out: a Source named fpl-fixtures that yields one fixtures batch. Errors: propagates FplClient.fixtures's errors.

### playerHistorySource(client, options?): Source

In: an FplClient and optional skipUnplayed, limit, and progressEvery. Out: a Source named fpl-player-history, requiring the players dataset, that yields one batch per gameweek under the player-gameweeks dataset. Errors: propagates FplClient.playerHistory's errors for whichever player request fails; nothing already yielded is rolled back.

### runSync(sources, context, options?): Promise<SyncReport>

In: the sources to run, a SourceContext (season, store, logger, capturedAt), and optional format and continueOnError. Out: a SyncReport with one SourceRun per source, total rows, failed count, and duration. Errors: does not throw; a source's failure is recorded on its SourceRun.error and, unless continueOnError is true, stops the remaining sources from running.

### orderByDependencies(sources): Source[]

In: a list of Source. Out: the same sources reordered so a source only runs once every dataset it requires has either already been produced by an earlier source in the list or is not produced by any source in the run at all. Errors: none. Notes: a requirement satisfied by nothing in the run is assumed to already be in the store; a genuine cycle cannot be resolved, so the remaining sources are emitted in their original order and any resulting gap surfaces later as a NotFoundError when a source tries to read a dataset that was never written.

### SourceRegistry.register(source) / get(name) / all() / names()

In: a Source, or a source name. Out: the registry itself (register, for chaining), the matching Source or undefined (get), every registered Source (all), or every registered name (names). Errors: register throws a plain Error if the name is already registered.

### parseRules(html, options): RulesDocument

In: the rules page's HTML and a seasonStartYear (plus optional fetchedAt, sourceUrl). Out: a RulesDocument covering deadlines, scoring and BPS point rows, chip effects, scoring phases, squad size and budget, and transfer limits. Errors: throws whatever rulesDocumentSchema.parse throws on a shape mismatch. Notes: called by both rulesSource and refreshRules; not called directly by a consuming app.

### parseDeadlineLabel(label, seasonStartYear) / londonOffsetMs(at) / londonToUtc(year, monthIndex, day, hour, minute)

In: a printed deadline label such as Sat 2 Jan 13:30 plus the season's start year, or an instant, or wall clock London time parts. Out: a UTC Date, or null if the label does not match the expected pattern, or a millisecond offset, or a UTC Date. Errors: none, unparseable input yields null rather than throwing so one bad row cannot fail an entire scrape. Notes: londonToUtc is reused outside the rules scraper by parseFootballDataCsv, to convert day first UK local kickoff times.

### rulesSource(http, options?): Source

In: an HttpClient and an optional url override. Out: a Source named fpl-rules that scrapes the rules page and yields a single rules batch with one row, the RulesDocument. Errors: propagates parseRules's errors. Notes: unlike refreshRules, this yields (and therefore writes) the current page every run; it does not diff against the stored version. The one thing it will not yield is an unusable document, the same guard refreshRules applies.

### refreshRules(deps): Promise<RefreshRulesResult>

In: an HttpClient, a Store, a Season, and optional logger, capturedAt, url. Out: `{ document, diff, written, usable }`, where written is the SnapshotMeta just recorded or null if nothing changed or nothing usable was parsed. Errors: propagates parseRules's and Store.write's errors. Notes: always writes JSONL regardless of the store's default format, since the document is deeply nested and the Parquet codec would flatten it to JSON text that could not be read back through the schema; scrapes first, reads the previous snapshot with readLatestRules, diffs with diffRules, and only calls Store.write when diff.changed is true.

### isUsableRulesDocument(document): boolean

In: a RulesDocument. Out: whether it carries at least one deadline, scoring row, or BPS row. Errors: none. Notes: the guard both rules paths check before writing. A document failing it is a page that no longer serves the rules to a plain HTTP client, not a season without deadlines, and storing it would make every consumer read "no deadlines" as fact.

### readLatestRules(store, season): Promise<RulesDocument | undefined>

In: a Store and a Season. Out: the newest stored RulesDocument for that season, or undefined if the rules dataset was never written. Errors: propagates any Store.read error other than NotFoundError, which it catches and turns into undefined.

### diffRules(before, after): RulesDiff

In: the previous RulesDocument (or undefined for a first ever scrape) and the freshly parsed one. Out: a RulesDiff (`changed`, `checksumBefore`, `checksumAfter`, `changes`). Errors: none. Notes: before undefined always reports changed true with a single synthetic "added" change; otherwise every keyed collection (deadlines by gwN, scoring and bps rows by action, chips by name, phases by name, sections by heading) is compared by that key, plus the squad and transfer scalar blocks, so the result names what changed rather than only that something did.

### summariseChange(change): string

In: one RulesChange. Out: a single human readable line ("X added: Y", "X removed (was Y)", or "X changed from Y to Z"), suitable for rendering straight into a UI or a CLI. Errors: none.

### parseCsv(text): string[][] / parseCsvObjects(text): Record<string, string>[]

In: raw CSV text. Out: rows of cells, or (parseCsvObjects) rows keyed by the header row's column names. Errors: none, malformed input degrades rather than throwing. Notes: a minimal hand rolled RFC 4180 reader: handles quoted fields, embedded commas inside quotes, and doubled quote escaping (`""` inside a quoted field becomes one `"`); parseCsvObjects keeps the first occurrence of a duplicate header name and skips blank header cells.

### footballDataUrl(season, division?) / footballDataSeasonCode(season)

In: a Season (and optional division code, default "E0" for the Premier League). Out: the season CSV's URL on football-data.co.uk, or just the path segment ("2026/27" becomes "2627"). Errors: none.

### parseFootballDataCsv(text, options?): OddsQuote[]

In: one season's raw CSV text, and optional provider name / resolveTeam function. Out: a flat list of OddsQuote rows, one per bookmaker per market per selection (match odds: home/draw/away; over/under 2.5: over/under). Errors: throws whatever oddsQuoteSchema.parse throws on a row that fails validation. Notes: a row missing a usable date or the 1X2 market is skipped, not failed, since an in progress season file has partly filled rows near the end; an odds value of 1.0 or below is treated as absent (empty column or a pulled market); resolveTeam defaults to always returning undefined, leaving homeTeam/awayTeam null.

### buildTeamResolver(teams): (name: string) => TeamId | undefined

In: the season's Team list. Out: a resolver function from a provider's free text club name to a domain TeamId, or undefined if it cannot be matched. Errors: none. Notes: tries a normalised (lowercase, alphanumeric only) match against each team's full and short name first, then a fixed alias table (TEAM_ALIASES) for names normalisation cannot bridge (for example "spurs"), then falls back to treating the provider name as a normalised prefix of a known team's normalised name (with a 4 character floor to avoid short false matches, covering cases like "Wolverhampton" against "Wolverhampton Wanderers").

### footballDataOddsSource(http, options?): Source

In: an HttpClient and optional division / url. Out: a Source named odds-football-data, requiring the teams dataset, that yields one odds batch (partition "football-data") from one season CSV fetch. Errors: propagates parseFootballDataCsv's errors, and any HTTP failure other than an absent season file (300, 403, 404, 410), which is logged as not published yet and yields no batch. Notes: reads the teams dataset from the store to build the team resolver, so it must run after whatever source produces teams; logs a count of quotes whose team could not be resolved, but does not fail the batch over them (they are written with a null team id).

### refreshFixtures(deps): Promise<RefreshFixturesResult>

In: an HttpClient, a Store, a Season, and optional logger, capturedAt, format, always, dryRun. Out: `{ fixtures, diff, written }`, where written is the SnapshotMeta just recorded or null if nothing changed. Errors: propagates FplClient.fixtures and Store.write errors. Notes: refetches the whole fixture list, maps it, reads the stored snapshot with readLatestFixtures, diffs with diffFixtures, and writes only when diff.changed is true unless always is set; dryRun returns the diff without writing at all, which is what a read only host (Vercel) needs so a scheduler still learns what moved.

### readLatestFixtures(store, season): Promise<Fixture[] | undefined>

In: a Store and a Season. Out: the newest stored fixtures for that season, or undefined if the dataset was never written. Errors: propagates any Store.read error other than NotFoundError, which it turns into undefined.

### diffFixtures(before, after): FixturesDiff / summariseFixtureChange(change): string

In: the previous fixture list (or undefined) and the fresh one, or one FixtureChange. Out: a FixturesDiff (changed, added, removed, updated, changes) keyed by fixture id, or a single human readable line. Errors: none. Notes: compares kickoff, gameweek, both scores, both difficulties, and the finished flag per fixture id, so the result names which fixture moved and how.

### sofascoreFetch(input, init): Promise<Response>

In: a URL (or string) and a RequestInit. Out: a Response. Errors: rejects on a socket error or an aborted signal; throws SourceError if handed a Request object rather than a URL. Notes: a `typeof fetch` transport over node:https that sets a browser cipher order, because the provider fingerprints the TLS handshake and answers node own fetch with 403 on every path. Compression is not requested, so no decoding step is needed. Retry, backoff, and throttling stay with HttpClient.

### sofascoreHttp(options?): HttpClient

In: partial HttpClientOptions. Out: an HttpClient pointed at SOFASCORE_BASE_URL (api.sofascore.com/api/v1) carrying the provider Referer and Origin headers, a browser user agent, and a 500 ms request floor, using sofascoreFetch as its transport. Errors: none. Notes: no key or account is involved; those two headers plus the cipher order are the whole of what the provider requires.

### SofascoreClient.events(seasonId, page, tournamentId?) / event / lineups / shotmap / averagePositions / heatmap / tryHeatmap

In: the provider season id and a listing page (page 0 is the most recent), or an event id, or an event id plus a provider player id. Out: one page of finished events, one event, the lineups with per player match statistics, the shot list, the average positions per side, or a player heatmap points. Errors: throws ValidationError (up to 10 issues) if a payload does not match its schema, and whatever HttpClient throws otherwise. Notes: tryHeatmap returns null instead of throwing when the provider answers 403 or 404, since a match without tracking has no heatmap for any of its players and one absent optional resource must not abort a sync run. PREMIER_LEAGUE_UNIQUE_TOURNAMENT is 17.

### buildProviderTeamResolver(teams): (name: string) => TeamId | undefined

In: the season Team list. Out: a resolver from the provider club name to a domain TeamId, or undefined. Errors: none. Notes: layers over the odds path buildTeamResolver rather than replacing it: the shared table handles abbreviating providers, a local alias table handles the registered names Sofascore prints (manchestercity, tottenhamhotspur, and so on), and a final rule treats a known domain name as a prefix of the provider longer one ("Newcastle" against "Newcastle United"), returning undefined when two teams match.

### buildFixtureResolver(fixtures, teams, options?): (event) => FixtureId | undefined

In: the season fixtures and teams, and an optional kickoff toleranceMs (default 4 hours). Out: a resolver from a provider event (home name, away name, kickoff, and the provider round where it publishes one) to a domain FixtureId, or undefined. Errors: none. Notes: matches on the resolved team pair plus the closest kickoff within tolerance; a tie between two candidates yields undefined rather than a guess, which is what stops a cup tie between the same clubs from stealing the league fixture. When no kickoff is close enough, one last rule applies: if the pair identifies exactly one fixture and the provider round equals that fixture gameweek, it is the same match. That covers a reschedule the two sides disagree about by days, which no kickoff tolerance worth allowing would reach.

### buildPlayerResolver(players, teams?): PlayerResolver

In: the season players. Out: a resolver from a provider player name plus a domain TeamId to a PlayerId, or undefined. Errors: none. Notes: names are normalised by stripping diacritics and every non alphanumeric character, then matched from most specific to least: strong forms (full name, web name, second name, first plus either family name) scoped to the club, then weak forms (a family name, an initial plus a family name) also scoped to the club, then an unambiguous full name across the whole league, which is the only way to reach a player who has since moved clubs. Any key shared by two players is marked ambiguous and resolves to undefined.

### fromTeamFrame(point) / fromShotFrame(point)

In: one provider coordinate pair. Out: a domain Point, clamped to the pitch bounds. Errors: none. Notes: fromTeamFrame flips y (average positions and heatmaps share a frame whose x already matches the domain); fromShotFrame flips x and leaves y (the shot frame is that same frame rotated 180 degrees). Both conventions were established from real payloads, not documentation.

### toPlayerMatchSpatial(input) / toMatchEvent(input) / touchesByZone(points) / phaseOfSituation(situation)

In: a resolved player, fixture, and team plus the provider lineup entry, heatmap, and average position, or a resolved shot; or normalised points; or a provider situation token. Out: a PlayerMatchSpatial, a MatchEvent, per zone counts, or a domain Phase. Errors: each mapper throws whatever the core schema throws, since both call schema.parse. Notes: a measure the provider does not carry stays null, never 0; minutes and the event minute are capped at 120; a shot keeps its raw situation token in outcome because the phase mapping flattens several situations into one bucket.

### sofascoreSpatialSource(client, options?): Source

In: a SofascoreClient and optional seasonId, maxEvents, sinceGameweek, maxPages (default 20). Out: a Source named spatial-sofascore, requiring teams, players, and fixtures, that yields one player-match-spatial batch and one match-events batch per gameweek partition (gwN). Errors: propagates the client errors; an unresolved event, player, or shot taker is counted and logged, never thrown. Notes: the provider season id comes from SOFASCORE_SEASON_IDS (2025/26 is 76986, 2026/27 is 96668) unless passed in, and an unknown season logs a warning and yields nothing.

### FplClient.playerSummary(playerId): Promise<ElementSummary>

In: an FPL player id. Out: the whole element summary: `history` (this season by gameweek) and `history_past` (totals per completed season). Errors: throws ValidationError on schema mismatch. Notes: `playerHistory` returns only the first field, and existed first; this is what the past seasons source needs.

### toPlayerSeason(raw): PlayerSeason

In: one raw `history_past` row. Out: a PlayerSeason. Errors: whatever the core schema throws. Notes: FPL prints its ICT family as strings, so those are coerced; a measure the season did not record is set to null rather than kept as FPL's 0 (expected goals from 2022/23, defensive contribution from 2025/26).

### playerSeasonsSource(client, options?): Source

In: an FplClient and optional limit, progressEvery. Out: a Source named fpl-player-seasons, requiring the players dataset, yielding one player-seasons batch. Errors: propagates the client's. Notes: one request per player, the same cost as a full player history pass, which is why it is a backfill rather than part of the nightly sync.

### buildCodeIndex(playersCsv): Map<number, number>

In: a season's `players_raw.csv`. Out: permanent player code by that season's element id. Errors: none, an unparsable row is skipped.

### parseArchiveSeason(season, gameweeksCsv, codeByElement): ArchiveParseResult

In: a season label, that season's `merged_gw.csv`, and the code index. Out: `{ rows, unresolved }`. Errors: whatever the core schema throws on a row that parses but fails validation. Notes: a row whose element is not in the index, or which has no gameweek, is counted in `unresolved` and dropped; the archive's GK label maps to the domain's GKP; expected goals stay null for seasons before 2022/23, when the archive did not carry them.

### archiveHistorySource(http, options): Source

In: an HttpClient and the seasons to pull (plus an optional baseUrl for a mirror). Out: a Source named history-archive yielding one player-gameweeks-history batch per season, partitioned by the hyphenated season label. Errors: propagates the fetch. Notes: two requests per season, the player list and the merged gameweek file.

### providerIdsSource(http, options?): Source

In: a Sofascore HttpClient and optional limit, progressEvery. Out: a Source named sofascore-player-ids, requiring players and teams, yielding the whole player-provider-ids dataset. Errors: propagates the fetch. Notes: one search per unmapped player, and a player already in the dataset is skipped, so a bounded run resumes where the last one stopped. A candidate is accepted when the normalised name matches and the provider club is the player's club, or when the name is unique across the results; anything else is counted and dropped.

### internationalsSource(http, options?): Source

In: a Sofascore HttpClient and optional limit, onlyMissing, progressEvery. Out: a Source named sofascore-internationals, requiring player-provider-ids, yielding the whole internationals dataset. Errors: propagates the fetch. Notes: two requests per player plus one per international tournament season. Rows for a player being refreshed are replaced wholesale and every other player's rows are carried through, since a snapshot is read whole.

### isInternationalCategory(flag): boolean

In: the provider category flag. Out: whether it reads "international". Errors: none. Notes: necessary but not sufficient. The provider files club friendlies under an international category, so the source also requires the team on the statistics payload to carry `national: true`.

## Logic

HttpClient distinguishes a terminal SourceError, already thrown for a non retryable status or the final attempt, from a network or timeout fault: only the latter is retried while attempts remain within the configured retries budget. Backoff without a Retry-After header doubles from a 250ms base per attempt (250, 500, 1000, and so on); a numeric Retry-After header, in seconds, takes precedence over that computed backoff.

throttle() tracks the earliest time the next request may fire (nextAllowedAt); the first call in a fresh client is free, every call after waits out whatever remains of minRequestIntervalMs since the previous one.

playerHistorySource reads the player list from the store (via context.store.read with the players dataset) rather than refetching bootstrap, which is why it declares players as a requirement; it fetches roughly one request per player, gated by HttpClient's minimum interval, so for the full player list this is the slowest source by a wide margin. It groups every player's history rows by gameweek in memory and yields one batch per gameweek, so each gameweek partition is written once by runSync rather than once per player.

runSync's ordering is a simple greedy pass: it repeatedly pulls the first pending source whose every declared requirement is either not produced by anything in this run, or already done; a genuine cycle among sources breaks that invariant, so the loop falls back to declaring the remaining sources in their original order rather than looping forever.

The rules page scraper (parseRules) prefers the page's own rendered HTML tables, matched by their header row against a fixed signature per table kind (deadlines, scoring, bps, chips, phases); if no tables are found at all, it falls back to concatenating every string inside the page's embedded Next.js payload (script#**NEXT_DATA**) and extracting deadlines from that text with a regular expression instead. It always computes a SHA-256 checksum of whichever text it used; diffRules uses that checksum as a cheap first signal, but `changed` still turns true if either the checksum differs or any keyed comparison found a difference, so a checksum collision alone could not mask a real change.

london-time.ts resolves a printed deadline's year by comparing its month against a July rollover cutoff (a January date belongs to the following year, since PL seasons open in August); it derives the Europe/London to UTC offset at a given instant by formatting that instant through Europe/London and re-deriving the implied UTC instant twice, which is what lets it cross the GMT to BST transition correctly without a timezone database dependency. The same helper (londonToUtc) is reused by parseFootballDataCsv for provider kickoff times.

diffRules treats every keyed collection the same way: build a key to value map for the before and after sides, report "added" for a key only in after, "removed" for a key only in before, "changed" for a key whose value differs, and nothing for a key whose value is identical; the squad and transfer blocks (plain scalars, not collections) are compared field by field the same way, coercing each side to a string for the change record.

As of 2026-08-18 fantasy.premierleague.com renders its rules page client side: the HTML carries no tables, no script#**NEXT_DATA**, and not even the string "Deadline", so parseRules returns a document with parsedFrom "none" and nothing in it. Both write paths refuse it (see isUsableRulesDocument), which is why the lake has no rules dataset and the API answers 404 for /rules. Recovering the rules means locating the JSON the page fetches at runtime and adding a source for it; the scraper and its differ are otherwise unchanged and still covered by fixture driven tests.

rulesSource and refreshRules both call parseRules but serve different callers: rulesSource is registered in the CLI's sync command's source list and always writes, since a batch sync is expected to capture a fresh snapshot every run; refreshRules is called directly, not as a Source, by the CLI's rules refresh command and the API's POST /rules/refresh route, and only writes when diffRules reports a change, so an interactive check for updates does not create a snapshot every time it runs.

csv.ts's parser is a single pass character reader (a quoted state flag plus a running field and row buffer) rather than a dependency, since provider CSVs are small and well formed but still need correct quoted field handling for team names that contain commas.

parseFootballDataCsv iterates BOOKMAKER_COLUMNS (a fixed prefix to bookmaker name map covering Bet365, Betway, Interwetten, Pinnacle, William Hill, VC Bet, plus the market best and market average columns) for every row, emitting up to three match_odds quotes (home, draw, away) and two over_under quotes (over, under, at line 2.5) per bookmaker present in that row; a bookmaker missing any one of the three 1X2 columns, or either of the 2.5 columns, is skipped for that market only, not for the whole row.

The history datasets are separate because their grain and their lifetime differ. player-seasons is one row per player per completed season, unpartitioned, rewritten whole when the backfill runs. player-gameweeks-history is partitioned by season, so adding one season does not rewrite the others, and each partition is written once and never again. Both are read by apps/web through optional readers: a lake with no backfill still builds, it just shows no career.

DATASETS reserves six FPL adjacent dataset names, teams, players, gameweeks, fixtures, player-gameweeks, and now rules and odds, both of which have a Source (rulesSource, footballDataOddsSource). It also reserves ownership, club-transfers, player-match-spatial, and match-events, matching the new schemas in packages/core (transfers.ts, spatial.ts), but nothing in this package produces any of those four yet: they are reserved names, not implemented pipelines.

refreshFixtures exists separately from a full sync because fixtures are the most volatile dataset in the lake: kickoff times shift for broadcast, a postponed match loses and later regains a gameweek, and scores land live. Writing only on a change keeps snapshot history meaningful for a list that can be polled every few minutes, and dryRun exists because Vercel filesystem is read only at runtime, where a caller still wants the diff.

The spatial source resolves before it reads: without a provider season id there is nothing to ask for, so it warns and yields nothing rather than reading the store first. It then walks the provider listing pages (about 30 finished events each) until it has enough resolvable events, skipping anything not finished, anything whose fixture cannot be joined, and any fixture with no gameweek, since a fixture without a gameweek has no partition to land in and is left for a later run. Rows are grouped by gameweek in memory before anything is yielded, so each partition is written once, the same shape as playerHistorySource.

Per match the source reads lineups, average positions, and the shotmap once each, then one heatmap per player who actually played, skipping the heatmap calls entirely when the event hasEventPlayerHeatMap flag is false. That per player call is the cost of this source: at a 500 ms floor a full season is hours of traffic, which is why the CLI keeps it opt in. A player who cannot be joined is counted and skipped; an unjoinable shot taker still lands its event row with a null player id, because the shot itself happened and is worth storing.

Identity is the whole risk of this pipeline, so it is deliberately conservative: a key shared by two players at a club is marked ambiguous and resolves to nothing, and a fixture tie resolves to nothing. The one loosening, the round fallback, needs the pair to identify a single fixture and the round to agree with its gameweek, so it cannot turn a right join into a wrong one. Measured against the provider on 2026-08-18, the fixture join rate over 60 scheduled 2026/27 matches is 60 of 60; without the round rule it was 29 of 30, the miss being a match FPL printed for 31 August and the provider for 29 August. The source logs both counts at info level (unresolvedPlayers, unresolvedShotTakers) and warns on events without a fixture, because a low join rate is otherwise silent.

## Data flow

fantasy.premierleague.com/api/bootstrap-static/ JSON -> FplClient.bootstrap -> toTeam/toGameweek/toPlayer -> bootstrapSource batches -> runSync -> Store.write for the teams, gameweeks, and players datasets.

fantasy.premierleague.com/api/fixtures/ JSON -> FplClient.fixtures -> toFixture -> fixturesSource batch -> runSync -> Store.write for the fixtures dataset.

Store.read of the players dataset -> one FplClient.playerHistory call per selected player -> toPlayerGameweek -> rows grouped by gameweek -> playerHistorySource batches -> runSync -> Store.write for the player-gameweeks dataset, one partition per gameweek.

fantasy.premierleague.com/en/help/rules HTML -> parseRules -> RulesDocument -> rulesSource yields one rules batch -> runSync -> Store.write for the rules dataset, overwritten with a fresh snapshot on every sync run.

fantasy.premierleague.com/en/help/rules HTML -> parseRules -> diffRules(previous document, new document) -> refreshRules -> Store.write for the rules dataset (JSONL only) when something changed, else a null written value. Called directly by the CLI's rules refresh command and the API's POST /rules/refresh route, not through runSync.

football-data.co.uk season CSV text -> parseCsv/parseCsvObjects -> parseFootballDataCsv, resolving each row's club names through buildTeamResolver built from the stored teams dataset -> OddsQuote rows -> footballDataOddsSource yields one odds batch (partition "football-data") -> runSync -> Store.write for the odds dataset.

fantasy.premierleague.com/api/fixtures/ JSON -> FplClient.fixtures -> toFixture -> diffFixtures(stored fixtures, fresh fixtures) -> refreshFixtures -> Store.write for the fixtures dataset when something moved, else a null written value. Called directly by the CLI fixtures refresh command, the API POST /fixtures/refresh route, and apps/web refresh endpoint.

Store.read of teams, players, and fixtures -> buildFixtureResolver and buildPlayerResolver -> api.sofascore.com listing pages -> per event lineups, average positions, shotmap, and one heatmap per player -> fromTeamFrame and fromShotFrame -> toPlayerMatchSpatial and toMatchEvent -> rows grouped by gameweek -> sofascoreSpatialSource batches -> runSync -> Store.write for the player-match-spatial and match-events datasets, one partition per gameweek.

FPL players plus teams -> a Sofascore search per unmapped player -> name and club agreement -> providerIdsSource -> Store.write for the player-provider-ids dataset.

player-provider-ids -> per player statistics seasons -> the international categories only -> per tournament season statistics, keeping rows whose team is a national side -> internationalsSource -> Store.write for the internationals dataset.

FPL element-summary JSON -> FplClient.playerSummary -> toPlayerSeason per history_past row -> playerSeasonsSource batch -> Store.write for the player-seasons dataset.

archive players_raw.csv -> buildCodeIndex -> archive merged_gw.csv -> parseArchiveSeason, rekeyed to playerCode -> archiveHistorySource batch per season -> Store.write for the player-gameweeks-history dataset, one Parquet partition per season.

The internationals pipeline splits identity from records because the two have different lifetimes. A player code to provider id mapping is permanent, so it is resolved once and stored with its evidence (the provider name, the club at match time, and whether the match needed a club to disambiguate). Records change only when a tournament is played. Measured on 2026-08-18 over a bounded run of 8 players, 5 mapped and 4 of those carried national team records.

The category flag alone was not enough: the provider files club friendly tournaments (the Emirates Cup, the International Champions Cup) under an international category, and the first run therefore produced rows whose "country" was Arsenal. Requiring `national: true` on the team is what separates a cap from a pre season friendly, and it is a structural check rather than a list of tournament names that would go stale.

## Dependencies

Internal: @fpl/core (errors, logger, the entity schemas, position and availability mapping, oddsQuoteSchema and the TeamId type for the odds path), @fpl/store (the Format and SnapshotMeta types, and the Store interface batches are written through).

External: zod, cheerio, node's crypto module (for the rules page checksum), node's https module (the Sofascore transport, which needs its own cipher list).

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Ingest skill](SKILL.md): purpose and constraints in brief.
- [Core spec](../core/SPEC.md): supplies the entity schemas, branded IDs, position and availability mapping, errors, logger, and the odds/spatial/transfer schemas this package's newer sources build on.
- [Store spec](../store/SPEC.md): every Source's batches are written through this package's Store port during a sync run.
- [CLI spec](../../apps/cli/SPEC.md): the sync and rules commands are built directly on this package's sources and refreshRules.
- [API spec](../../apps/api/SPEC.md): the rules routes call this package's refreshRules and readLatestRules directly.

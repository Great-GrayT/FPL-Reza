---
title: Ingest spec
type: spec
module: packages/ingest
updated: 2026-08-16
status: active
---

## Purpose

Fetches Fantasy Premier League data over HTTP, maps it onto packages/core's domain schemas, and writes it through packages/store's Store port, via a set of independent Source implementations run in dependency order by a single sync runner. Also scrapes the published rules page (with a diff aware refresh path) and parses football-data.co.uk odds CSVs, both wired into the sync pipeline and both callable directly by a consuming app.

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

In: an HttpClient and an optional url override. Out: a Source named fpl-rules that scrapes the rules page and yields a single rules batch with one row, the RulesDocument. Errors: propagates parseRules's errors. Notes: unlike refreshRules, this always yields (and therefore always writes) the current page; it does not diff against the stored version.

### refreshRules(deps): Promise<RefreshRulesResult>

In: an HttpClient, a Store, a Season, and optional logger, capturedAt, url. Out: `{ document, diff, written }`, where written is the SnapshotMeta just recorded or null if nothing changed. Errors: propagates parseRules's and Store.write's errors. Notes: always writes JSONL regardless of the store's default format, since the document is deeply nested and the Parquet codec would flatten it to JSON text that could not be read back through the schema; scrapes first, reads the previous snapshot with readLatestRules, diffs with diffRules, and only calls Store.write when diff.changed is true.

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

In: an HttpClient and optional division / url. Out: a Source named odds-football-data, requiring the teams dataset, that yields one odds batch (partition "football-data") from one season CSV fetch. Errors: propagates parseFootballDataCsv's and the HTTP fetch's errors. Notes: reads the teams dataset from the store to build the team resolver, so it must run after whatever source produces teams; logs a count of quotes whose team could not be resolved, but does not fail the batch over them (they are written with a null team id).

## Logic

HttpClient distinguishes a terminal SourceError, already thrown for a non retryable status or the final attempt, from a network or timeout fault: only the latter is retried while attempts remain within the configured retries budget. Backoff without a Retry-After header doubles from a 250ms base per attempt (250, 500, 1000, and so on); a numeric Retry-After header, in seconds, takes precedence over that computed backoff.

throttle() tracks the earliest time the next request may fire (nextAllowedAt); the first call in a fresh client is free, every call after waits out whatever remains of minRequestIntervalMs since the previous one.

playerHistorySource reads the player list from the store (via context.store.read with the players dataset) rather than refetching bootstrap, which is why it declares players as a requirement; it fetches roughly one request per player, gated by HttpClient's minimum interval, so for the full player list this is the slowest source by a wide margin. It groups every player's history rows by gameweek in memory and yields one batch per gameweek, so each gameweek partition is written once by runSync rather than once per player.

runSync's ordering is a simple greedy pass: it repeatedly pulls the first pending source whose every declared requirement is either not produced by anything in this run, or already done; a genuine cycle among sources breaks that invariant, so the loop falls back to declaring the remaining sources in their original order rather than looping forever.

The rules page scraper (parseRules) prefers the page's own rendered HTML tables, matched by their header row against a fixed signature per table kind (deadlines, scoring, bps, chips, phases); if no tables are found at all, it falls back to concatenating every string inside the page's embedded Next.js payload (script#**NEXT_DATA**) and extracting deadlines from that text with a regular expression instead. It always computes a SHA-256 checksum of whichever text it used; diffRules uses that checksum as a cheap first signal, but `changed` still turns true if either the checksum differs or any keyed comparison found a difference, so a checksum collision alone could not mask a real change.

london-time.ts resolves a printed deadline's year by comparing its month against a July rollover cutoff (a January date belongs to the following year, since PL seasons open in August); it derives the Europe/London to UTC offset at a given instant by formatting that instant through Europe/London and re-deriving the implied UTC instant twice, which is what lets it cross the GMT to BST transition correctly without a timezone database dependency. The same helper (londonToUtc) is reused by parseFootballDataCsv for provider kickoff times.

diffRules treats every keyed collection the same way: build a key to value map for the before and after sides, report "added" for a key only in after, "removed" for a key only in before, "changed" for a key whose value differs, and nothing for a key whose value is identical; the squad and transfer blocks (plain scalars, not collections) are compared field by field the same way, coercing each side to a string for the change record.

rulesSource and refreshRules both call parseRules but serve different callers: rulesSource is registered in the CLI's sync command's source list and always writes, since a batch sync is expected to capture a fresh snapshot every run; refreshRules is called directly, not as a Source, by the CLI's rules refresh command and the API's POST /rules/refresh route, and only writes when diffRules reports a change, so an interactive check for updates does not create a snapshot every time it runs.

csv.ts's parser is a single pass character reader (a quoted state flag plus a running field and row buffer) rather than a dependency, since provider CSVs are small and well formed but still need correct quoted field handling for team names that contain commas.

parseFootballDataCsv iterates BOOKMAKER_COLUMNS (a fixed prefix to bookmaker name map covering Bet365, Betway, Interwetten, Pinnacle, William Hill, VC Bet, plus the market best and market average columns) for every row, emitting up to three match_odds quotes (home, draw, away) and two over_under quotes (over, under, at line 2.5) per bookmaker present in that row; a bookmaker missing any one of the three 1X2 columns, or either of the 2.5 columns, is skipped for that market only, not for the whole row.

DATASETS reserves six FPL adjacent dataset names, teams, players, gameweeks, fixtures, player-gameweeks, and now rules and odds, both of which have a Source (rulesSource, footballDataOddsSource). It also reserves ownership, club-transfers, player-match-spatial, and match-events, matching the new schemas in packages/core (transfers.ts, spatial.ts), but nothing in this package produces any of those four yet: they are reserved names, not implemented pipelines.

## Data flow

fantasy.premierleague.com/api/bootstrap-static/ JSON -> FplClient.bootstrap -> toTeam/toGameweek/toPlayer -> bootstrapSource batches -> runSync -> Store.write for the teams, gameweeks, and players datasets.

fantasy.premierleague.com/api/fixtures/ JSON -> FplClient.fixtures -> toFixture -> fixturesSource batch -> runSync -> Store.write for the fixtures dataset.

Store.read of the players dataset -> one FplClient.playerHistory call per selected player -> toPlayerGameweek -> rows grouped by gameweek -> playerHistorySource batches -> runSync -> Store.write for the player-gameweeks dataset, one partition per gameweek.

fantasy.premierleague.com/en/help/rules HTML -> parseRules -> RulesDocument -> rulesSource yields one rules batch -> runSync -> Store.write for the rules dataset, overwritten with a fresh snapshot on every sync run.

fantasy.premierleague.com/en/help/rules HTML -> parseRules -> diffRules(previous document, new document) -> refreshRules -> Store.write for the rules dataset (JSONL only) when something changed, else a null written value. Called directly by the CLI's rules refresh command and the API's POST /rules/refresh route, not through runSync.

football-data.co.uk season CSV text -> parseCsv/parseCsvObjects -> parseFootballDataCsv, resolving each row's club names through buildTeamResolver built from the stored teams dataset -> OddsQuote rows -> footballDataOddsSource yields one odds batch (partition "football-data") -> runSync -> Store.write for the odds dataset.

## Dependencies

Internal: @fpl/core (errors, logger, the entity schemas, position and availability mapping, oddsQuoteSchema and the TeamId type for the odds path), @fpl/store (the Format and SnapshotMeta types, and the Store interface batches are written through).

External: zod, cheerio, node's crypto module (for the rules page checksum).

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Ingest skill](SKILL.md): purpose and constraints in brief.
- [Core spec](../core/SPEC.md): supplies the entity schemas, branded IDs, position and availability mapping, errors, logger, and the odds/spatial/transfer schemas this package's newer sources build on.
- [Store spec](../store/SPEC.md): every Source's batches are written through this package's Store port during a sync run.
- [CLI spec](../../apps/cli/SPEC.md): the sync and rules commands are built directly on this package's sources and refreshRules.
- [API spec](../../apps/api/SPEC.md): the rules routes call this package's refreshRules and readLatestRules directly.

---
title: Source catalogue, probed
type: spec
module: root
updated: 2026-08-18
status: active
---

## Purpose

Every candidate source, hit directly and recorded with a verdict and a storage design. Written because this repository has twice been handed a source that "works" and found otherwise: a verdict here is a `curl` result on the date shown, not a reputation.

Read this before writing an adapter. The order below is by what the source is worth, not by the order it was suggested.

The one general rule: **`robots.txt` decides, not reachability.** A page that returns 200 while its `robots.txt` says `Disallow: /` is not a source, it is a page we are asked not to collect. That rule already cost this project Understat once and it holds.

## Methods

### Premier League official API (`footballapi.pulselive.com`)

Access: open, keyless, needs an `Origin` and `Referer` of `premierleague.com`. Probed 2026-08-18: 200 on every endpoint below. This is the site's own backing API, the same posture as the FPL API.

What it carries, and this is the find of the sweep: **13,546 fixtures across 35 seasons back to 1992/93**, and per fixture `matchOfficials` (the referee by name, role `MAIN`, plus assistants and VAR), `events` (goals, bookings with `Y`/`R`, substitutions, each with a minute and a person and team id), `teamLists` (a formation label such as `4-2-3-1` **plus its positional rows as arrays of player ids**), full lineups with shirt number, captain flag, `positionInfo` in words ("Right Full Back"), nationality and birth, and nine substitutes. Separately, `teams/{id}/compseasons/{seasonId}/staff` carries `officials` with role `Manager`, name, birth and age.

That single source covers three of the categories the brief called weak or missing: referees, formations, and managers, officially rather than by scraping.

Storage:

| Dataset            | Grain                           | Key                          | Format  | Partition |
| ------------------ | ------------------------------- | ---------------------------- | ------- | --------- |
| `pl-fixtures`      | one match                       | `plFixtureId`                | Parquet | season    |
| `match-officials`  | one official per match          | `plFixtureId` + `role`       | JSONL   | season    |
| `match-lineups`    | one player per match            | `plFixtureId` + `plPlayerId` | Parquet | season    |
| `match-formations` | one side per match              | `plFixtureId` + `teamId`     | JSONL   | season    |
| `match-timeline`   | one event per match             | `plFixtureId` + sequence     | Parquet | season    |
| `team-staff`       | one manager per club per season | `plTeamId` + `seasonId`      | JSONL   | none      |

Identity is the work here, not the fetch. The PL's player and team ids are its own, so every dataset stores the provider id and joins to `playerCode` through a stored mapping, exactly as the internationals pipeline does. Never match on name alone.

### Official FPL API (`fantasy.premierleague.com/api`)

Access: open, keyless. **Built.** Prices, ownership, points, deadlines, per gameweek history, and per season totals. Already the spine of the lake.

### vaastav/Fantasy-Premier-League

Access: open raw files on GitHub. **Built.** Per gameweek rows for every completed season from 2016/17, rekeyed from each season's element id to the permanent player code. Ten seasons, 3.4 MB as Parquet.

### football-data.co.uk

Access: open CSV per season. **Built.** Closing bookmaker odds and results. Answers an unpublished season with 300, which the source treats as absence.

### Open-Meteo

Access: open, keyless, and the historical archive works: `archive-api.open-meteo.com/v1/archive` returned hourly temperature, precipitation and wind for a past date on first request. Probed 2026-08-18.

This is the cleanest new source on the list, because the PL API hands us `ground.name` and `ground.city` per fixture, so a kickoff already has a place and an instant. Nothing else needs resolving.

Storage: `match-weather`, one row per fixture, keyed on `plFixtureId`, JSONL, partitioned by season. Store the hour containing kickoff plus the two either side, so a model can ask about rain that started at half time. Store the resolved latitude, longitude and elevation the provider echoes back, since they differ from the ones requested and that difference is the geocoding error.

Ground coordinates are the one manual input: 20 clubs, hand recorded once, in `core` as data. That is a small honest table, not a geocoding pipeline.

### ClubElo

Access: mixed, and worth stating precisely. `api.clubelo.com` **fails to connect from this machine** (exit 000, both the club and the by-date CSV path), which matches the "connects then times out" note recorded earlier in this repo. `clubelo.com/ENG` returns 200 with 560 KB of server rendered tables. Probed 2026-08-18.

So the API is the right interface and the network here is the problem. **Test the API from GitHub Actions before writing an HTML scraper**: a runner in another network may reach it, and one CSV beats parsing 101 tables. The workflow already exists to try it in.

Storage: `club-elo`, one row per club per rating date, keyed on `teamId` plus `ratingDate`, Parquet, partitioned by season. Elo is a time series and the whole point is its history, so snapshots must not overwrite: the dataset is append only in effect, one row per published change.

### Premier Injuries

Access: open, and `robots.txt` is `Disallow:` with an empty value, which allows everything. One server rendered table, 140 rows, 288 KB. Probed 2026-08-18.

Storage: `injury-status`, one row per player per capture, keyed on `playerCode` plus `capturedAt`, JSONL, partitioned by month. This is a **status** source, not a history one: it says who is injured now. Overwriting it would destroy the only record of what was known before a deadline, which is exactly the question worth asking later ("was this flagged before I picked him"), so every capture is kept.

### Transfermarkt

Access: open, and `robots.txt` allows `*` (it disallows `wget` by name, so send a real user agent and a courteous delay). Per player injury history is server rendered: 2 tables, 21 rows on the page probed. Probed 2026-08-18.

Storage: `injury-history`, one row per injury spell, keyed on `playerCode` plus start date, JSONL, unpartitioned. Fields: description, from, to, days out, matches missed. This is the durable half of the injury picture, where Premier Injuries is the live half.

Manager career history (tenure, win rate per club) is on the same site and the same terms, and lands as `manager-history`, keyed on a manager id plus club plus spell start.

Referee career aggregates are also there, but my URL guess for the referee section returned no table, so **the path needs finding before anyone writes that adapter**. Do not assume it. The PL API already gives the referee per match, which is the harder half of the same question.

### StatsBomb Open Data

Access: open JSON on GitHub. Confirmed 80 competition seasons, of which the Premier League is **exactly two: 2015/16 and 2003/04**. Probed 2026-08-18.

That is not a live input, it is a calibration set: full event data for two seasons, useful to validate a model built on aggregates against something that has every pass and shot. Licence is CC BY-NC-SA, so attribution is required and commercial use is not permitted.

Storage: keep it out of the lake. Read it in a notebook or a one off script when calibrating, and store only the derived coefficients. Committing gigabytes of event JSON to compare two seasons would be the tail wagging the dog.

### WhoScored

Access: 200 after a redirect, and `robots.txt` disallows only `/Accounts/`, `/Predictions/` and `/Users/`, so tournament and match pages are permitted. The landing page carries no formation data, which lives in a `matchCentreData` payload on match pages.

Verdict: **not worth building.** The PL API gives formations officially, per match, with the positional rows, and this site is heavily protected. Revisit only if the official API drops formations.

### Understat

Access: page returns 200, and `robots.txt` is `User-agent: *` with `Disallow: /`. Probed 2026-08-18.

Verdict: **excluded, on the terms rather than the technology.** Their xG model is genuinely useful and it is genuinely asked not to be crawled. FPL has carried its own xG since 2022/23 and Sofascore gives per shot expected goals, so the gap this leaves is a second opinion, not a hole.

### FBref

Access: Cloudflare interactive challenge on every path, `robots.txt` included. Probed 2026-08-18, unchanged from the earlier finding.

Verdict: **unreachable without defeating a bot check**, which is not something to build. The Opta derived aggregates it publishes overlap heavily with what FPL and Sofascore already give.

### worldfootball.net

Access: 403 on the match list with a browser user agent, and again with language and accept headers. Its `robots.txt` carries content signal terms. Probed 2026-08-18.

Verdict: **unreachable, and redundant.** Referee appointments come from the PL API.

### Wikipedia

Access: open, and there is a real API (`api.wikimedia.org`) rather than a page to scrape. Not probed, because nothing here needs it: manager appointment history comes from the PL API for the current season and Transfermarkt for the past.

## Logic

Decisions a reader could not infer, and the reasons.

- **Terms outrank convenience.** Understat is the test case: reachable, useful, and asked not to be crawled, so it is out. Nothing in the lake is worth a source that has said no.
- **Prefer the official API to scraping the official site.** `premierleague.com/fixtures` is client rendered and carries nothing in its markup, while the API behind it serves 35 seasons as JSON. Scraping the page would have produced a fragile adapter for worse data.
- **One source answered three "weak" categories.** Referees, formations, and managers were all listed as thin or unavailable. They are all in the PL API. That is the difference between asking what a category is called and asking what a payload contains.
- **A status source is stored as a time series.** Injury status, prices, and ownership all describe now. Their value is what they said _before_ a deadline, so a capture is never overwritten; the same reasoning already governs snapshots across the lake.
- **Provider ids are stored, never inferred.** The PL API, Sofascore and Transfermarkt each have their own player ids. Every one lands in a mapping dataset keyed on `playerCode`, with the evidence the match was made on, because a wrong identity join is undetectable downstream.
- **A calibration set is not an input.** StatsBomb's two Premier League seasons are read once to check a model, not ingested nightly.
- **Weather needs a place, and we already have one.** The PL API gives a ground and a city per fixture, so weather is a keyed lookup rather than a geocoding problem. Twenty ground coordinates are hand recorded; that is the whole of the manual data.

## Data flow

PL API fixtures per season -> provider id mapping -> `pl-fixtures`, and per fixture detail -> `match-officials`, `match-lineups`, `match-formations`, `match-timeline`.

PL API team staff per season -> `team-staff` (the manager, with tenure derived from consecutive seasons).

`pl-fixtures` ground and kickoff -> hand recorded ground coordinates -> Open-Meteo archive -> `match-weather`, the kickoff hour and its neighbours.

ClubElo (API first, from a runner; HTML tables only if that fails) -> `club-elo`, one row per club per rating date.

Premier Injuries table -> `injury-status`, one capture kept per run. Transfermarkt player injury pages -> `injury-history`, one row per spell.

Transfermarkt manager pages -> `manager-history`, one row per spell at a club.

StatsBomb open data -> read on demand during calibration -> derived coefficients only.

## Dependencies

Internal: `packages/core` for the schemas and the id mappings, `packages/ingest` for the `Source` port and the throttled client, `packages/store` for snapshots and partitions.

External: nothing new. Every source above is JSON, CSV, or HTML that `cheerio` already parses.

## Related

- [How this project works](ARCHITECTURE.md): the platform these sources feed, and the ingestion contract every adapter follows.
- [Ingest spec](../packages/ingest/SPEC.md): the `Source` port, the throttling, and the identity joins any new adapter has to match.
- [Core spec](../packages/core/SPEC.md): where a new schema goes, and the provider id mapping pattern the internationals pipeline established.
- [Docs index](INDEX.md): the module map.

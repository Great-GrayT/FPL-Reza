---
title: Core spec
type: spec
module: packages/core
updated: 2026-08-18
status: active
---

## Purpose

Pure domain layer with no I/O: branded IDs, entity schemas, position and availability mapping, money helpers, squad and transfer rules constants, match scoring, BPS weights, a logger, the error hierarchy every other package raises, pitch geometry and per match spatial schemas, bookmaker odds and goal expectation math, club transfer and ownership flow schemas, and a static data provider registry. Everything here is a Zod schema, a pure function, or a constant.

## Methods

### createLogger(options?): Logger

In: optional level (one of debug, info, warn, error, silent, default info), sink (line writer, defaults to process.stderr), base (fields merged into every line). Out: a Logger with debug/info/warn/error/child. Errors: none. Notes: below the configured level a call is a no-op; child(fields) returns a new logger with fields merged into base, preserving the parent's level and sink. silentLogger is a ready made instance at level silent, the default for library code and tests.

### asPlayerId(value: number): PlayerId

In: a number. Out: a branded PlayerId. Errors: throws Zod's ZodError if not a positive integer. Notes: asTeamId, asFixtureId, asGameweekId (bounded 1 to 38), and asSeason (must match the DDDD slash DD pattern) are the equivalent constructors for the other branded types; all five share this shape.

### positionFromElementType(elementType: number): Position

In: FPL's element_type integer, 1 through 4. Out: GKP, DEF, MID, or FWD. Errors: throws ValidationError for any other integer. Notes: elementTypeFromPosition is the exact inverse.

### availabilityFromStatus(status: string): Availability

In: FPL's single letter status code (a, d, i, s, u, n). Out: one of available, doubtful, injured, suspended, unavailable, not_in_squad. Errors: throws ValidationError for any other letter.

### playerFullName(player: Player): string

In: a Player. Out: firstName and secondName joined and trimmed. Errors: none.

### toMillions(tenths) / fromMillions(millions) / formatPrice(tenths)

In: a price as tenths of a million, or as millions. Out: the converted number, or for formatPrice a string like 12.0m. Errors: none. Notes: fromMillions rounds; the pair round trips exactly for every integer tenths value, which is what keeps budget arithmetic exact.

### sellingPrice(purchasePrice, currentPrice): Tenths

In: purchase and current price, both tenths. Out: the price a squad would receive on sale. Errors: none. Notes: a fall is passed on in full; a rise is only half realised, rounded down to the nearest tenth.

### appearancePoints(minutes: number): number

In: minutes played. Out: 0 for none, 1 below FULL_APPEARANCE_MINUTES (60), 2 at or above it. Errors: none.

### cardPoints(yellowCards, redCards): number

In: yellow and red card counts for one player gameweek. Out: points, negative or zero. Errors: none. Notes: a red card is resolved alone at minus 3; it is not added to a yellow's minus 1, since a red already implies the yellow shown in the same incident.

### defensiveContributionPoints(position, actions): number

In: position and a CBIT or CBIRT action count. Out: 2 points if actions meets the position's threshold (10 for DEF, 12 for MID and FWD), otherwise 0; always 0 for GKP. Errors: none. Notes: does not stack past the threshold.

### scorePlayerGameweek(position, stats): PointsBreakdown

In: a position and a ScoringInput (minutes, goals, assists, clean sheet flag, goals conceded, saves, penalty saves and misses, cards, own goals, optional defensive contribution count, bonus). Out: a PointsBreakdown with one field per scoring component plus total. Errors: none, a schema mismatch is the caller's responsibility upstream. Notes: clean sheet points require both the flag and a full, 60 plus minute, appearance; goals conceded penalty and save points apply only to GKP/DEF and GKP respectively; defensive contribution only pays if minutes is greater than zero; total is the sum of every other field, checked directly by scoring.test.ts.

### passCompletionBps(attempted, completionPercent): number

In: passes attempted and completion percentage. Out: 0 below BPS_MIN_PASSES_ATTEMPTED (30) attempts, otherwise 2, 4, or 6 for the 70 to 79, 80 to 89, or 90 plus completion bands. Errors: none. Notes: this is the only BPS weight in bps.ts implemented as a function; every other named weight (goalFromPenalty, successfulTackle, errorLeadingToGoal, and so on) is a plain constant a caller looks up directly, there is no aggregate compute total BPS function in this package.

### currentGameweek(gameweeks) / nextGameweek(gameweeks)

In: a list of Gameweek. Out: the entry with isCurrent or isNext true, or undefined. Errors: none.

### isHome(fixture, teamId) / opponentOf(fixture, teamId) / difficultyFor(fixture, teamId)

In: a Fixture and a TeamId. Out: whether that team is home, the other team's ID, or the difficulty (1 to 5) that team faces. Errors: none.

### careerTotals(seasons): CareerTotals

In: a list of PlayerSeason. Out: seasons counted, points, minutes, goals, assists, clean sheets and bonus summed, plus the best season by points and that season's points. Errors: none. Notes: an empty list yields zeroes and a null best season; a tie on points keeps the first season read, so a caller that sorts newest first gets the most recent of two equal peaks.

### toArchiveSeason(season) / fromArchiveSeason(label)

In: a season label in either spelling. Out: the other one ("2024/25" to "2024-25" and back). Errors: none. Notes: the archives file seasons with a hyphen and the domain brands them with a slash, and the two must not be interchangeable by accident, which is why `playerSeasonSchema` rejects the hyphenated form.

### internationalTotals(seasons): InternationalTotals

In: a player's international season rows. Out: the country, distinct competitions counted, and caps, goals, assists, and minutes summed, plus the competition names. Errors: none. Notes: an absent measure adds nothing rather than failing, and the caps total is a floor: friendlies and any competition the provider does not track are simply absent.

### headToHead(matches, teamCode, opponentCode): HeadToHead

In: every stored match, and two club codes. Out: the record between them, read from the first club's point of view rather than the venue's, plus the meetings themselves newest first. Errors: none. Notes: a match with no score is not counted, so an unplayed fixture between the two never inflates the record.

### teamRecord(matches, teamCode) / recentForm(matches, teamCode, count?)

In: matches and a club code. Out: played, won, drawn, lost, goals for and against, and points at three for a win; or the last `count` results as W, D, or L, newest first. Errors: none.

### refereeRecord(matches, details): RefereeRecord[]

In: every stored match, and the detail rows keyed by match id. Out: one record per referee, most appointments first: matches, the outcome split, goals per match, and the card and penalty rates. Errors: none. Notes: appointments count every match on record, but card rates average only over the matches whose detail is stored, and are null rather than 0 where none is. The detail dataset covers fewer seasons than the results do, so this distinction is the difference between a rate and a fabrication.

### describeWeatherCode(code): string | null

In: a WMO weather interpretation code. Out: a word a reader recognises. Errors: none. Notes: null in, null out, rather than reporting clear skies for an absent reading.

### distanceMetres(a, b): number

In: two coordinates. Out: the great circle distance in metres, which at these scales is exact enough to decide whether two records describe the same ground. Errors: none. Notes: `GROUND_MATCH_METRES` (1,500) is the tolerance a join may use, generous enough to survive an article's coordinate sitting on a corner of a stadium and tight enough that no two Premier League grounds fall inside it.

### per90(total, minutes): number

In: a raw total and minutes played. Out: the rate scaled to a 90 minute match, or 0 if minutes is 0 or less, avoiding a divide by zero for an unused player. Errors: none.

## Logic

Every entity (Team, Player, Gameweek, Fixture, PlayerGameweek) is a Zod object schema, not a class; construction is always schema.parse(candidate), which is what packages/ingest's mapping layer relies on.

SQUAD_QUOTA (GKP 2, DEF 5, MID 5, FWD 3) sums to exactly SQUAD_SIZE (15): it is a fixed composition, not a range. XI_MIN and XI_MAX bound the starting eleven per position (GKP fixed at 1, DEF 3 to 5, MID 0 to 5, FWD 1 to 3); the domain imposes no midfield minimum.

Chips (bench_boost, free_hit, triple_captain, wildcard) are issued twice per season, split at gameweek 19; only one chip may be active per gameweek, and Free Hit needs a 2 gameweek gap between plays. These are constants only: nothing in core enforces the rule at runtime, that is left to a consumer.

SCORING_PHASES hardcodes the season's monthly gameweek ranges, for example August covers only gameweeks 1 to 2 and May covers 34 to 38; a season with a different fixture calendar would need this table updated by hand.

GAMEWEEKS_PER_SEASON is 38, and GameweekId is bounded 1 to 38 at the schema level, so an out of range gameweek fails validation rather than propagating.

FplError is the base of every intentional error; each subclass fixes its own code string (VALIDATION, NOT_FOUND, SOURCE) and Error.name is set from the constructing subclass via new.target.name.

createLogger writes to stderr by default so stdout stays free for CLI output another tool might pipe; field values are stringified via a format helper that special cases Date (ISO string) and Error (message) before falling back to JSON.stringify.

history.ts holds the two career grains. `PlayerSeason` is one player's totals for one completed season, exactly what FPL publishes on its element summary endpoint. `HistoricPlayerGameweek` is one player's return in one gameweek of a past season, which FPL stops serving once a season closes, so it comes from an archive instead and carries the player's name, club, and position as they were then. Both key on `playerCode`, and `gameweek` is bounded 1 to 47 rather than 38, because a season disrupted into replays and reschedules has run past 38 before.

internationals.ts holds two rows, both keyed on `playerCode`. `PlayerProviderId` is the identity mapping onto a provider, carrying the provider's own spelling of the name, its club at match time, and a confidence of either name_and_club or unique_name, so a suspect join can be audited later rather than trusted blindly. `InternationalSeason` is one player's record in one national team competition season, which is the grain the provider aggregates and the grain a career page prints.

## Data flow

raw FPL element_type integer -> positionFromElementType -> Position, consumed by scoring, rules quotas, and formation checks.

raw FPL status letter -> availabilityFromStatus -> Availability, stored on Player.availability.

per gameweek stat line -> scorePlayerGameweek -> PointsBreakdown, the basis for any point total shown downstream.

price in tenths -> toMillions or formatPrice -> a display value; purchase and current price -> sellingPrice -> the tenths a squad would recoup.

a list of Gameweek -> currentGameweek or nextGameweek -> the single entry consumers key off for this week logic.

FPL history_past rows -> packages/ingest toPlayerSeason -> PlayerSeason -> careerTotals -> the career block on a player page.

## Dependencies

Internal: none, this is the foundation package.

External: zod (schemas, branding, parsing).

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Core skill](SKILL.md): purpose and constraints in brief.
- [Config spec](../config/SPEC.md): consumes LOG_LEVELS, ValidationError, and seasonSchema/asSeason from this package.
- [Store spec](../store/SPEC.md): consumes Season, NotFoundError, and ValidationError from this package.
- [Ingest spec](../ingest/SPEC.md): consumes the entity schemas, position and availability mapping, SourceError, and the logger from this package.

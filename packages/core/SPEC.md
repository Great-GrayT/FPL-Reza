---
title: Core spec
type: spec
module: packages/core
updated: 2026-08-16
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

## Data flow

raw FPL element_type integer -> positionFromElementType -> Position, consumed by scoring, rules quotas, and formation checks.

raw FPL status letter -> availabilityFromStatus -> Availability, stored on Player.availability.

per gameweek stat line -> scorePlayerGameweek -> PointsBreakdown, the basis for any point total shown downstream.

price in tenths -> toMillions or formatPrice -> a display value; purchase and current price -> sellingPrice -> the tenths a squad would recoup.

a list of Gameweek -> currentGameweek or nextGameweek -> the single entry consumers key off for this week logic.

## Dependencies

Internal: none, this is the foundation package.

External: zod (schemas, branding, parsing).

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Core skill](SKILL.md): purpose and constraints in brief.
- [Config spec](../config/SPEC.md): consumes LOG_LEVELS, ValidationError, and seasonSchema/asSeason from this package.
- [Store spec](../store/SPEC.md): consumes Season, NotFoundError, and ValidationError from this package.
- [Ingest spec](../ingest/SPEC.md): consumes the entity schemas, position and availability mapping, SourceError, and the logger from this package.

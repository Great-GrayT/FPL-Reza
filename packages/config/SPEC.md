---
title: Config spec
type: spec
module: packages/config
updated: 2026-08-16
status: active
---

## Purpose

Reads process environment variables (or an injected Env map) into a validated Config, and derives the FPL season label that belongs to a given calendar date.

## Methods

### seasonForDate(date: Date): Season

In: a Date. Out: a branded Season string such as 2026/27. Errors: none, always produces a valid Season. Notes: treats July (month index 6) onward as the start of the new season; the end year is the start year plus 1, taken modulo 100 and zero padded, so a start year of 2099 produces the end label 00.

### loadConfig(env?: Env, now?: Date): Config

In: an environment map (defaults to process.env) and a current Date (defaults to new Date()). Out: a validated Config with season, dataDir, logLevel, and an fpl block (baseUrl, timeoutMs, retries, minRequestIntervalMs, userAgent). Errors: throws ValidationError if any FPL_* numeric variable is not an integer, or if the whole candidate fails the Zod schema (for example a malformed FPL_SEASON). Notes: every field falls back to a default when its environment variable is unset or blank; season falls back to seasonForDate(now) rather than a fixed string.

## Logic

DEFAULTS hardcodes: dataDir data, logLevel info, baseUrl https colon slash slash fantasy.premierleague.com/api, timeoutMs 15000, retries 3, minRequestIntervalMs 250, userAgent fpl-platform/0.0.0 with a placeholder repository URL.

The environment variable names are FPL_SEASON, FPL_DATA_DIR, FPL_LOG_LEVEL, FPL_BASE_URL, FPL_TIMEOUT_MS, FPL_RETRIES, FPL_MIN_REQUEST_INTERVAL_MS, and FPL_USER_AGENT. There is no environment variable for retries beyond an integer check (0 to 10 is enforced by the schema, not by the int() helper).

The int() helper treats an unset or blank string as "use the fallback", but treats any other non integer string (for example FPL_RETRIES=many) as a hard ValidationError, it does not silently fall back.

loadConfig builds the whole candidate object first and validates it once with configSchema.safeParse, rather than validating field by field, so every issue in a bad config is reported together (each issue rendered as path colon message).

## Data flow

process.env or an injected Env map, plus the current Date -> loadConfig -> DEFAULTS merge -> configSchema.safeParse -> Config, consumed wherever an app constructs a FileStore (dataDir) or an HttpClient (the fpl block).

a Date -> seasonForDate -> Season, used as loadConfig's season default when FPL_SEASON is unset.

## Dependencies

Internal: @fpl/core (LOG_LEVELS, ValidationError, seasonSchema, asSeason, the Season type).

External: zod.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Config skill](SKILL.md): purpose and constraints in brief.
- [Core spec](../core/SPEC.md): supplies the Season branding, ValidationError, and log level enum this package validates against.
- [Store spec](../store/SPEC.md): FileStore's root option is shaped to take Config.dataDir, though no source file in this package or in store imports the other directly.
- [Ingest spec](../ingest/SPEC.md): HttpClient's options are shaped to take Config.fpl, though packages/ingest/src does not actually import @fpl/config despite it being listed in ingest's package.json.

---
title: Config skill
type: skill
module: packages/config
updated: 2026-08-16
status: active
---

## Purpose

Owns runtime configuration: reading environment variables into a validated Config object (loadConfig), and deriving the current FPL season label from a calendar date (seasonForDate).

Does not own: what the config values are used for. loadConfig produces a dataDir string and an fpl block shaped for packages/store's FileStore and packages/ingest's HttpClient, but neither of those packages imports this one; the wiring between loadConfig's output and those constructors happens wherever an app assembles them, which today is apps/cli and apps/api, both undocumented in this pass.

## Skills used in this section

- verify-and-stop: after changing an environment variable name or a default in DEFAULTS, run the package tests, since consumers depend on the exact names and defaults documented here, not just on the type.

## Constraints

- Config loading is fail fast by design: loadConfig throws ValidationError on the first invalid or malformed value rather than falling back silently, because a half configured ingest run would write snapshots to the wrong place.
- FPL_SEASON, if set, must match the branded Season pattern (four digits, slash, two digits); otherwise the season defaults to seasonForDate(now).

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Config spec](SPEC.md): full method and logic detail.

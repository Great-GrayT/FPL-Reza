---
title: Docs index
type: index
module: root
updated: 2026-08-18
status: active
---

## Modules

- [How this project works](ARCHITECTURE.md): the whole platform end to end, inputs to rendered page. Start here, and update it in the same commit as any change it describes. The web app renders this file at `/how-it-works`.

- [Core spec](../packages/core/SPEC.md): domain types (team, player, gameweek, fixture, player gameweek), branded IDs, money in tenths, squad and transfer rules, match scoring, BPS weights, logger, error hierarchy. No I/O.
- [Config spec](../packages/config/SPEC.md): environment driven runtime configuration (`loadConfig`) and season from date derivation.
- [Store spec](../packages/store/SPEC.md): snapshot oriented flat file data lake behind a `Store` port, with JSONL and Parquet codecs and a per dataset manifest.
- [Ingest spec](../packages/ingest/SPEC.md): HTTP client with retry and throttling, the FPL bootstrap, fixtures, and player history sources, their raw to domain mapping, and the dependency ordered sync runner.

- [Analytics spec](../packages/analytics/SPEC.md): derived metrics over the domain types: rolling form, value per million, fixture difficulty over a horizon, defensive contribution, bonus prediction.
- [API spec](../apps/api/SPEC.md): the Fastify HTTP API over the lake, including the assets routes and the fixtures and rules refresh endpoints.
- [CLI spec](../apps/cli/SPEC.md): the `fpl` command: sync, fixtures refresh, rules refresh and deadlines, assets sync and list, and the read only inspection commands.

`packages/assets` and `apps/web` have no `SKILL.md` or `SPEC.md` of their own yet. Until they do, [How this project works](ARCHITECTURE.md) is their documentation: it covers the asset store, the web routes, and the design system.

## Format

Every file in this documentation set (`CLAUDE.md`, `SKILL.md`, `SPEC.md`, `INDEX.md`, and the memory files) carries frontmatter in this order: `title`, `type`, `module`, `updated`, `status`. Body text starts at `##`, never at a top level heading: the title lives in the frontmatter. Each file type keeps a fixed section order:

- `CLAUDE.md` (pointer): `## Docs`, then `## Related`.
- `SKILL.md` (skill): `## Purpose`, `## Skills used in this section`, `## Constraints`, `## Related`.
- `SPEC.md` (spec): `## Purpose`, `## Methods`, `## Logic`, `## Data flow`, `## Dependencies`, `## Related`.
- `INDEX.md` (index): `## Modules`, `## Format`, `## Related`.

Links are relative and named after the destination's title, never "here". `CLAUDE.md` files import with `@path` instead of markdown links, since links render inert there. No file is orphaned: everything is reachable from this index.

## Related

- [Root README](../README.md): what the project is, prerequisites, install, and how to build, test, lint, and run it.
- [How this project works](ARCHITECTURE.md): the end to end explanation every other file here hangs off.
- [Handoff, continue the build](HANDOFF.md): current blocker, decisions already made, and the ordered list of what is left.
- [Short term memory](memory/short-term.md): current task state and blockers.
- [Long term memory](memory/long-term.md): architecture decisions and their rationale.

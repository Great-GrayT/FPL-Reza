---
title: Docs index
type: index
module: root
updated: 2026-08-16
status: active
---

## Modules

- [Core spec](../packages/core/SPEC.md): domain types (team, player, gameweek, fixture, player gameweek), branded IDs, money in tenths, squad and transfer rules, match scoring, BPS weights, logger, error hierarchy. No I/O.
- [Config spec](../packages/config/SPEC.md): environment driven runtime configuration (`loadConfig`) and season from date derivation.
- [Store spec](../packages/store/SPEC.md): snapshot oriented flat file data lake behind a `Store` port, with JSONL and Parquet codecs and a per dataset manifest.
- [Ingest spec](../packages/ingest/SPEC.md): HTTP client with retry and throttling, the FPL bootstrap, fixtures, and player history sources, their raw to domain mapping, and the dependency ordered sync runner.

`packages/analytics`, `apps/api`, and `apps/cli` are still being built by other agents and are intentionally undocumented here.

## Format

Every file in this documentation set (`CLAUDE.md`, `SKILL.md`, `SPEC.md`, `INDEX.md`, and the memory files) carries frontmatter in this order: `title`, `type`, `module`, `updated`, `status`. Body text starts at `##`, never at a top level heading: the title lives in the frontmatter. Each file type keeps a fixed section order:

- `CLAUDE.md` (pointer): `## Docs`, then `## Related`.
- `SKILL.md` (skill): `## Purpose`, `## Skills used in this section`, `## Constraints`, `## Related`.
- `SPEC.md` (spec): `## Purpose`, `## Methods`, `## Logic`, `## Data flow`, `## Dependencies`, `## Related`.
- `INDEX.md` (index): `## Modules`, `## Format`, `## Related`.

Links are relative and named after the destination's title, never "here". `CLAUDE.md` files import with `@path` instead of markdown links, since links render inert there. No file is orphaned: everything is reachable from this index.

## Related

- [Root README](../README.md): what the project is, prerequisites, install, and how to build, test, lint, and run it.
- [Handoff, continue the build](HANDOFF.md): current blocker, decisions already made, and the ordered list of what is left.
- [Short term memory](memory/short-term.md): current task state and blockers.
- [Long term memory](memory/long-term.md): architecture decisions and their rationale.

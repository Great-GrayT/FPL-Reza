---
title: Fpl platform pointer
type: pointer
module: root
updated: 2026-08-16
status: active
---

## Docs

Read the docs index first, then the pointer file for whichever package you are about to change: each one leads to that package's own `SKILL.md` and `SPEC.md`.

@docs/INDEX.md
@docs/ARCHITECTURE.md
@README.md
@packages/core/CLAUDE.md
@packages/config/CLAUDE.md
@packages/store/CLAUDE.md
@packages/ingest/CLAUDE.md

`packages/analytics`, `apps/api`, and `apps/cli` have no pointer file yet, but each owns a `SKILL.md` and `SPEC.md`. `packages/assets` and `apps/web` have neither: `docs/ARCHITECTURE.md` documents them.

`docs/ARCHITECTURE.md` explains the platform end to end: inputs, models, algorithms, packages, storage, ingestion, serving, and the front end. It is part of the definition of done. Any change to a data source, a schema, an algorithm, a package boundary, a route, or a page updates that file in the same commit and bumps its `updated` field. The web app renders it at `/how-it-works`, so a stale line there ships to the reader.

## Related

- [How this project works](docs/ARCHITECTURE.md): the end to end explanation, kept current with every change.
- [Docs index](docs/INDEX.md): module map and the documentation format rule.
- [Root README](README.md): what the project is, prerequisites, install, and how to build, test, lint, and run it.

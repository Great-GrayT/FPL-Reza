# FPL

A Fantasy Premier League data platform: ingestion from the public FPL API, a flat file data lake, scoring and rules logic, and (in progress) analytics, an API, and a CLI.

## What this is

`fpl` is a pnpm workspace of TypeScript packages that together pull Fantasy Premier League data, validate and normalise it against a typed domain model, and land it as immutable snapshots in a local data lake. On top of that lake sit an analytics package, an HTTP API, and a CLI, all still under active development.

Today's finished layer is the data foundation: domain types and rules (`packages/core`), configuration (`packages/config`), the snapshot store (`packages/store`), and the FPL ingestion pipeline (`packages/ingest`). See [the docs index](docs/INDEX.md) for the full module map.

## Prerequisites

- Node.js 22.9.0 or later
- pnpm 10 or later

## Install

```sh
pnpm install
```

This is a pnpm workspace (see `pnpm-workspace.yaml`): packages live under `packages/*` and `apps/*`, and internal dependencies resolve through the workspace protocol rather than the registry.

## Workspace layout

```
packages/
  core/       domain types, branded IDs, money, rules, scoring, BPS, logger, errors
  config/     environment driven configuration and season derivation
  store/      Store port and FileStore: the flat file data lake
  ingest/     HTTP client, FPL sources, sync runner
  analytics/  in progress, undocumented here
apps/
  cli/        in progress, undocumented here
  api/        in progress, undocumented here
docs/
  INDEX.md    module map and documentation format
  memory/     short term and long term project memory
```

## Build

```sh
pnpm build
```

Runs TypeScript project references in build mode across every package. Use `pnpm build:watch` for incremental builds, or `pnpm clean` to remove build output.

## Test

```sh
pnpm test
```

Runs the Node built in test runner (`node:test`) over every `*.test.ts` file under `packages/*/src` and `apps/*/src`, loaded through `tsx`. There is no vitest and no Vite in this repo by design. Use `pnpm test:watch` to rerun on change, or `pnpm test:coverage` for coverage via `node:test`'s experimental coverage support.

## Lint and format

```sh
pnpm lint
pnpm format:check
```

ESLint runs with `typescript-eslint`'s strict and stylistic type checked configs plus `eslint-config-prettier`. `pnpm lint:fix` and `pnpm format` apply fixes.

## Run everything

```sh
pnpm verify
```

Runs format checking, lint, build, and test in sequence: the same gate a change should pass before it is considered done.

## Run the CLI

```sh
pnpm fpl
```

Runs the built CLI (`apps/cli`, still in progress) at `apps/cli/dist/bin.js`.

## Where the docs live

- [How this project works](docs/ARCHITECTURE.md): the end to end explanation, from the public sources it reads through the models, the algorithms, and the packages, to a rendered page. The web app serves it at `/how-it-works`. Any change to what it describes updates it in the same commit.

- [Docs index](docs/INDEX.md): the module map and the documentation format every file in `docs/` and every package's `CLAUDE.md`/`SKILL.md`/`SPEC.md` follows.
- [Short term memory](docs/memory/short-term.md): current task state and known blockers.
- [Long term memory](docs/memory/long-term.md): architecture decisions and why they were made.
- Each package under `packages/core`, `packages/config`, `packages/store`, and `packages/ingest` has its own `CLAUDE.md`, `SKILL.md`, and `SPEC.md`.

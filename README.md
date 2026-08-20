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
  quant/      statistics, simulation, and machine learning, with no dependencies
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

Runs the Node built in test runner (`node:test`) over every `*.test.ts` file under `packages/*/src` and `apps/*/src`, loaded through `tsx`, and then `pnpm test:ui`, which renders the web app's client only panels to static markup. Those panels are solved in a Web Worker after hydration, so nothing on the server draws them and a page fetch cannot show them; rendering them in the test runner is what catches an undefined read or a divide by zero in one. It needs a loader hook that stubs CSS module imports and a test only tsconfig that switches JSX to the automatic runtime, both in `scripts/`. There is no vitest and no Vite in this repo by design. Use `pnpm test:watch` to rerun on change, or `pnpm test:coverage` for coverage via `node:test`'s experimental coverage support.

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

## The Lab

`/stats` is a quantitative workspace rather than a page of charts. It loads the stored parquet into the reader's own browser (ten seasons of gameweek history, thirty five seasons of results, and the current season's context, about 5 MB fetched a season at a time) and computes everything locally in a Web Worker: screening, distributions, correlations, three dimensional clouds and response surfaces, factor evaluation, models validated walk forward, strategy backtests against a random baseline, seeded simulation, and a portfolio optimiser over the real squad rules.

The build exports that copy itself:

```sh
pnpm --filter @fpl/web export:lake   # writes apps/web/public/lake/ from data/
```

`pnpm --filter @fpl/web build` runs it first, so a deployment always ships a copy matching the committed lake. The directory is generated and git ignored.

## Deploy the site

One Vercel project, with **Root Directory set to `apps/web`**. That is where `next` is declared, and Vercel refuses to build a Next app it cannot find a `next` dependency for: pointed at `apps/api` it deploys the Fastify server, and pointed at the repository root it fails with `No Next.js version detected`, since the root `package.json` declares neither.

Nothing else needs configuring. Vercel installs the whole pnpm workspace from the repository root, then runs this package's own build script, `tsc --build ../../tsconfig.json && next build`, which builds every workspace package before the site.

Leave "Include files outside the Root Directory in the Build Step" enabled. The site reads two things from outside `apps/web`: the committed snapshots in `data/`, which every page is built from, and `docs/ARCHITECTURE.md`, which `/how-it-works` renders. Both are found by walking up from the working directory, so both need the rest of the repository present at build time.

Set `REFRESH_TOKEN` in the project before handing the refresh URLs to a scheduler: with it unset the refresh endpoints are open, and they say so in every response. Set `FPL_SEASON` only to pin a season; otherwise it is derived from the date.

## Load the official record

The Premier League publishes its own keyless API, and it is where the referees, managers, teamsheets, grounds, and 35 seasons of results come from. These are backfills rather than nightly work:

```sh
pnpm fpl official matches      # results, teamsheets, officials, managers, grounds
pnpm fpl official grounds      # a licensed photograph per ground, with its credit
pnpm fpl official weather      # conditions at every kickoff inside the forecast window
```

`official matches` is the long one: about four requests per season of results and one per played match of teamsheets, so the defaults cover 35 seasons of results and three of detail in a few minutes. Bound it with `--seasons`, `--detail-seasons`, or `--max-detail`. Weather is worth running on the same schedule as the fixture refresh, since a forecast a fortnight out is not the forecast on the day.

## Keep the data fresh

Two scheduled workflows own this, because the deployed host cannot write:

- `.github/workflows/refresh-lake.yml`, hourly: `fpl fixtures refresh`, `fpl rules refresh`, and `fpl official weather`. The first two diff before writing, so a quiet hour costs two requests and no commit.
- `.github/workflows/sync-lake.yml`, daily at 02:15 UTC: the full sync after FPL has settled its overnight price changes, then this season's official record, which is what gives a match played yesterday its referee, its teamsheets, and its timeline.

Ground photographs are not scheduled. A stadium does not change, so `fpl official grounds` is run by hand.

Each commits `data/` and pushes, and the push is what redeploys the site. They share one concurrency group, since the store assumes a single writer per dataset. Both can be run by hand from the Actions tab, and the sync accepts a `sources` input for a partial run.

## Where the docs live

- [How this project works](docs/ARCHITECTURE.md): the end to end explanation, from the public sources it reads through the models, the algorithms, and the packages, to a rendered page. The web app serves it at `/how-it-works`. Any change to what it describes updates it in the same commit.

- [Docs index](docs/INDEX.md): the module map and the documentation format every file in `docs/` and every package's `CLAUDE.md`/`SKILL.md`/`SPEC.md` follows.
- [Short term memory](docs/memory/short-term.md): current task state and known blockers.
- [Long term memory](docs/memory/long-term.md): architecture decisions and why they were made.
- Each package under `packages/core`, `packages/config`, `packages/store`, and `packages/ingest` has its own `CLAUDE.md`, `SKILL.md`, and `SPEC.md`.

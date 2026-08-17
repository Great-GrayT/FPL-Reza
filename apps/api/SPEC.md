---
title: API spec
type: spec
module: apps/api
updated: 2026-08-16
status: active
---

## Purpose

A Fastify service reading the snapshot store and exposing it over HTTP, plus
one write path that refreshes the scraped rules document.

## Methods

### buildServer(deps): FastifyInstance

In: a Deps object (store, config, logger, http). Out: a configured server with
CORS, the error handler, and every route registered. Errors: none at build
time. Notes: taking deps as an argument is what lets tests run the real server
against a temporary directory with no network.

### createDeps(): Deps

In: none. Out: dependencies built from loadConfig, a FileStore rooted at the
configured data directory, a logger at the configured level, and an HttpClient
configured from the fpl block. Errors: propagates ValidationError from config
loading, which is fatal at boot by design.

### GET /health

Out: status, the active season, and whether the lake holds any dataset. Notes:
returns 200 even with an empty lake, since an empty lake is a valid state, not
a fault.

### GET /players

In: optional position, team, maxPrice in tenths, minMinutes, sort, order,
limit, offset. Out: the total and the matching players. Errors: 400 on a query
that fails validation, 404 if the players dataset was never written.

### GET /players/:id and GET /players/:id/history

Out: one player, or that player's gameweek rows in gameweek order. Errors: 404
for an unknown player. Notes: history is assembled from the partitions the
manifest records, via Store.partitions, so a partition named outside the gw<n>
convention is still found. A lake with no player gameweeks yields an empty
history rather than an error.

### GET /fixtures

In: optional gameweek and team. Out: the matching fixtures. Errors: 404 if the
fixtures dataset was never written.

### GET /gameweeks, /gameweeks/current, /gameweeks/next

Out: every gameweek, or the single one flagged current or next. Errors: 404
when no gameweek carries that flag, which happens between seasons.

### GET /rules and GET /rules/deadlines

Out: the latest stored rules document, or its deadlines with an optional next
count restricting them to upcoming ones. Errors: 404 if the page was never
scraped.

### POST /rules/refresh

Out: whether anything changed, the new checksum, the list of changes each with
a readable summary line, and the snapshot written, which is null when nothing
changed. Errors: 502 if the rules page cannot be fetched. Notes: this is the
endpoint behind a frontend update button, which is why the response is shaped
to render directly.

## Logic

The error handler is the only place that maps a domain error to a status, so
adding a route cannot drift from the established contract. The response body is
always shaped as an error object carrying a code, a message, and the issue list
where one exists.

Refresh writes only when the scraped page actually differs from the stored one,
so repeatedly pressing an update button creates no snapshot noise.

## Data flow

HTTP request -> zod query validation -> Store read -> domain rows -> JSON
response, or a domain error -> the error handler -> a status and error body.

POST /rules/refresh -> refreshRules -> fetch, parse, diff against the stored
document -> a conditional Store write -> a change summary in the response.

## Dependencies

Internal: @fpl/core, @fpl/config, @fpl/store, @fpl/ingest, @fpl/analytics.

External: fastify, @fastify/cors, zod.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [API skill](SKILL.md): purpose and constraints in brief.
- [Store spec](../../packages/store/SPEC.md): the port every route reads through.
- [Ingest spec](../../packages/ingest/SPEC.md): supplies the rules refresh path.
- [Core spec](../../packages/core/SPEC.md): supplies the row schemas and error classes.

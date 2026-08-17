---
title: API skill
type: skill
module: apps/api
updated: 2026-08-16
status: active
---

## Purpose

Owns the HTTP surface over the data lake: a Fastify server exposing players,
fixtures, gameweeks, and rules, plus the refresh endpoint a frontend update
button calls.

Does not own: any domain rule, any fetching, any storage mechanic. Every route
reads through the Store port and returns domain rows. Logic that outlives a
request belongs in packages/core or packages/analytics, not here.

## Skills used in this section

- verify-and-stop: after touching a route or the error mapping, run the app
  tests. They drive the real server through inject against a temporary store.
- frontend-design: not used here, but the refresh response shape is consumed by
  a future frontend, so changing it is a breaking change for that work.

## Constraints

- Dependencies are injected through a Deps object. A route must never construct
  a store, a client, or a config of its own, or it becomes untestable offline.
- Errors map in one place: NotFoundError to 404, ValidationError to 400 with
  its issue list, SourceError to 502, anything else to 500. A route should
  throw a domain error rather than shaping a response itself.
- Query parameters are validated with zod at the route boundary, so a bad
  filter returns 400 rather than reaching the store.
- Tests never touch the network. The injected fetch throws by default.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [API spec](SPEC.md): full route and error detail.
- [Ingest spec](../../packages/ingest/SPEC.md): supplies refreshRules and readLatestRules.
- [Store spec](../../packages/store/SPEC.md): every route reads through this port.

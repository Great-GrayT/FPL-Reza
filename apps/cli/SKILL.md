---
title: CLI skill
type: skill
module: apps/cli
updated: 2026-08-16
status: active
---

## Purpose

Owns the operator facing commands: running a sync, refreshing the scraped
rules, and inspecting what the lake holds.

Does not own: any domain rule, fetching, or storage mechanic. Commands
assemble packages and print results.

## Skills used in this section

- verify-and-stop: after changing a command or a flag, run the app tests. They
  drive the real commander program against a seeded temporary store.
- cavecrew-investigator: locate the source name in packages/ingest before
  adding it to the sync list, since a wrong name fails only at run time.

## Constraints

- Dependencies are injected into buildProgram, so tests never touch the network
  or the real data directory.
- Data goes to stdout, progress and errors to stderr, so output stays pipeable.
  Every command takes a json flag for machine readable output.
- The program uses commander's exitOverride, so a parse failure throws instead
  of killing the process, which is what lets tests assert on bad input.
- A sync that reports any failed source sets a non zero exit code, so a
  scheduled run fails loudly rather than appearing to succeed.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [CLI spec](SPEC.md): full command and flag detail.
- [Ingest spec](../../packages/ingest/SPEC.md): supplies the sources and the rules refresh.
- [Store spec](../../packages/store/SPEC.md): every command reads or writes through this port.

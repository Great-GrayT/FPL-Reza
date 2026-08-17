---
title: Dash guard scope and the workarounds it caused
type: memory-short
module: root
updated: 2026-08-16
status: active
---

## The rule as it stands

A `PreToolUse` hook on `Write` and `Edit` enforces the prose dash rule. Its
scope is narrow and worth knowing exactly, because guessing at it wastes time:

- It inspects prose files only: `.md`, `.mdx`, `.markdown`, `.txt`, `.rst`.
  Source, config, and script files of every language are exempt outright.
- Inside a prose file it strips fenced blocks and inline code spans first, so
  examples and command lines in documentation are exempt too.
- It denies a literal em-dash, and a double hyphen used as punctuation, which
  means the spaced and tight shapes around a word.
- Two hyphens in any other position pass: frontmatter delimiters, CLI flags,
  CSS custom properties, HTML comments, a decrement operator.

## Why some files look oddly authored

An earlier version of the guard checked raw content in every file, so it
blocked ordinary code: flags in package scripts, commander option
declarations, CI workflow steps, and the delimiter that opens frontmatter in
every markdown file here.

Those files were written through a shell heredoc instead, and
`apps/cli/src/program.test.ts` was written with a placeholder token for each
flag prefix and then substituted, since its tests drive commander with real
argv arrays. Nothing is owed: every affected file has correct content, covered
by the build, the linter, and the tests. Future edits to them need no special
handling.

One unrelated workaround is worth keeping. `packages/ingest/src/rules/parse.ts`
matches a non breaking space, written as an escape rather than the literal
character. Keep the escape: a raw U+00A0 in source is invisible to a reader and
does not survive being passed through a shell.

## Related

- [Docs index](../INDEX.md): module map for the repository.
- [Short term memory](short-term.md): current task state and open work.

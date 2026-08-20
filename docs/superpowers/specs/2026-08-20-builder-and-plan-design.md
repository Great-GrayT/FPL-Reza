---
title: One decision, one explanation
type: spec
module: apps/web
updated: 2026-08-20
status: active
---

## Purpose

`/builder` and `/planner` both pick a fifteen and both plan a horizon, and they
disagree. This is the design that stops them being two answers to one question:
the builder decides, the planner explains, and a strategy travels between them
as a code.

It also adds the control the split was hiding: fixing players. A manager who
owns Haaland is not asking which fifteen is best, they are asking which fifteen
is best **given Haaland**, and there are two versions of that question.

## Methods

### The lock, and its two modes

```ts
export type LockMode = 'always' | 'start';
export interface Lock {
  code: number;
  mode: LockMode;
}
```

- **`start`**: he must be in the opening fifteen. The plan may sell him later,
  and often should: that is the question "I own him today, is he worth keeping?"
- **`always`**: he must be in the squad in every gameweek of the horizon. The
  plan may never sell him. That is the question "I am keeping him, what is the
  best team around him?"

Both modes constrain the opening squad identically, because the optimiser only
ever chooses an opening fifteen. The modes diverge inside `plan`, where
`always` removes a player from every sale the move generator may propose.

A lock is a constraint, never a bonus: a locked player is not scored more
highly, he is simply present. The search still reports what it beat, so the
cost of a lock is visible as a smaller excess over the baseline rather than
hidden inside a rearranged squad.

### `optimiseSquad(players, options)`

`keep: number[]` becomes `locks: readonly Lock[]`. The seeding, the pruning, and
the neighbourhood all treat a locked code as immovable, exactly as `keep` did.
`cheapestLegal` seeds with the locked players in place, so an infeasible lock
set (four from one club, or fifteen strikers) returns null rather than a squad
that quietly drops one.

### `plan(players, start, options)`

Gains `locked: readonly number[]`, the `always` codes. `movesFor` never
proposes a move whose `out` is locked. Everything else is unchanged, including
the no-buy-back rule and the minimum gain: a lock narrows the search, it does
not alter what a transfer is worth.

### The strategy code, version 2

`FPL2-G3-E10-B1000-R0-T1-M2-S7-Cbt-Q<fifteen>-K<locks>-X<sum>`

- **`E` end gameweek replaces `H` horizon.** A code minted in gameweek 3 to run
  through gameweek 10, pasted in gameweek 5, solves gameweeks 5 to 10. The end
  is the fixed point, because the length is not what the author chose: they
  chose a destination. A version 1 code carrying `H` still decodes, as
  `end = start + horizon - 1`.
- **`Q`** is the fifteen the strategy holds, base 36 player codes. The builder
  mints it because the squad is the thing being explained; the planner reads it.
- **`K`** is the locks, each a mode letter (`A` or `S`) and a code, so a paste
  reproduces the question including its constraints.
- **`M`** is transfers a week, which version 1 had no slot for.

Refusals are all named: a bad checksum, a window that has closed
(`end < current`), and a player in `Q` who is not in today's pool. The last one
refuses rather than planning from fourteen, because a squad of fourteen is
illegal and its first suggested transfer would really be the search filling a
hole while presenting it as an improvement.

### The two pages

**`/builder` decides.** It is the only page that chooses a fifteen. It keeps
the pitch, the selection list, and the search, and gains a lock control on each
player in the squad: unlocked, kept at the start, kept throughout. Its output is
a strategy: the fifteen, the plan that carries them, what it beat, what it cost,
and the code.

**`/planner` explains.** It picks nothing. It reads a code (from `?code=`, or
pasted), re-solves that exact strategy, and renders the analysis: expected
points per gameweek with their band, the running total, the transfer ledger,
the captaincy, the chips, blanks and doubles, team value, and the risk the
appetite bought. With no code it says so and offers the builder, rather than
inventing a squad to explain.

That removes the divergence by construction: there is one search, in one place,
and the planner cannot start from a different fifteen because it never picks
one.

## Logic

- **Why the builder is the decision surface.** It already runs the better
  search. `optimiseSquad` scored 440.4 over eight gameweeks against the greedy
  picker's 424.6 on the real pool, and the planner was starting from the greedy
  squad, which is the number the builder prints as the thing it beat. One page
  was publishing the other's baseline as its answer.
- **Why a code rather than shared state.** The two pages are prerendered and the
  reader may arrive at either. A code is a link, survives a refresh, and can be
  read aloud; shared browser state cannot be sent to anyone.
- **Why locks are two modes rather than a checkbox.** "I own him" and "I am
  keeping him" are different constraints and produce different squads. Collapsing
  them would silently answer the wrong one.
- **Why the planner still runs the search.** It re-solves rather than receiving
  an answer, because prices move: re-solving lets it say the data moved, which
  a serialised answer cannot.

## Data flow

The reader's picks and locks on `/builder` -> one `strategy` request in the
worker -> `optimiseSquad` with the locks -> `plan` with the `always` locks ->
the fifteen, the plan, the baseline, the cost, and the code -> the pitch and the
verdict.

That code -> `/planner?code=` -> `decodeStrategy` -> rebased to the current
gameweek -> the same `strategy` request -> the same answer -> the calendar, the
bands, the ledger, and the series.

## Dependencies

Internal: `@fpl/planner` (the search, the plan, the code), `@fpl/analytics`
(legality and the best eleven), `apps/web/lib/planner` (the pool and the
worker).

## Related

- [Planner spec](../../../packages/planner/SPEC.md): the search this design puts
  behind one surface.
- [How this project works](../../ARCHITECTURE.md): the platform end to end.

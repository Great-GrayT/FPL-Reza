---
title: The plan terminal, chips, and the strategy space
type: spec
module: apps/web
updated: 2026-08-21
status: active
---

## Purpose

Four things, designed together because they are one thing: the chips are
decisions the optimiser currently cannot make, the risk framing is the theory
that says which squad is actually best, the scatter is where that theory
becomes something a reader can interrogate, and the page around it has to be
dense enough to hold all of it.

Written as a portfolio manager would specify it, with the football stated
explicitly wherever the analogy to markets breaks, because it breaks often and
quietly.

## Methods

### Chips are decisions, and three of the four are unmodelled

Today `movesFor` emits a chip move for bench boost and triple captain only.
Wildcard and free hit are named in the type, priced in the cost arithmetic, and
never proposed, so the search cannot play them; and free hit's defining rule,
that the squad reverts the following gameweek, is nowhere in the state at all.
That is the gap to close.

The four, as the game defines them, and as the search must model them:

- **Triple captain**: the captain scores three times instead of twice. A pure
  valuation change in one week, already handled.
- **Bench boost**: all fifteen score. Also a valuation change, already handled.
- **Wildcard**: unlimited transfers in one gameweek with no hit, and the squad
  it produces is kept. Structurally this is "re-solve the squad at this
  gameweek with the remaining horizon", which is `optimiseSquad` at week _w_.
- **Free hit**: unlimited transfers for one gameweek, and the squad reverts at
  the next deadline. Structurally it is "the best eleven money can buy for one
  week", followed by a restoration of the state that preceded it.

The state therefore grows one field, `revertTo`, holding the squad to restore
at the start of the next gameweek. Nothing else in the beam changes: a chip is
already part of a move, so the _timing_ search comes free once the moves exist.
Both unlimited chips are searched with a bounded rebuild rather than a full
optimisation inside every beam state, because a beam of twelve states over
eight gameweeks would otherwise run `optimiseSquad` a hundred times; the bundle
is built greedily from the same candidate generator, up to `wildcardDepth`
transfers, and the limit is stated on the page rather than hidden.

Rules the search must not break, all from the published rules already mirrored
in `@fpl/core`: one chip per gameweek, each chip at most once inside the
horizon, and the two halves of the season (the game issues each chip twice,
split at gameweek 19) treated as separate entitlements.

### Risk, and what "risk free" means here

The frontier answers "of every legal fifteen, which returns most at each level
of variance". It does not answer "which one should I hold", and the difference
is the whole of portfolio theory.

A risk free asset in a market is a return with no variance. There is no such
squad: every fifteen has a spread, because footballers are not treasury bills.
The closest true analogue is the **minimum variance legal squad**, the fifteen
whose week to week spread is the smallest the constraints allow, and that is
what this page uses as its zero. The reader's own framing, the line-up with the
lowest expected points every week, is the _floor_ rather than the risk free
rate: it is the return you cannot fall below, which is a different and also
useful number, so both are printed.

From that point, the **capital market line** is the ray to the tangency
portfolio, the squad maximising `(expected − minimumVariance) / risk`, which is
the Sharpe ratio in this setting. That tangency point is the "global optimum"
the two curves meet at, and it is the honest answer to "which squad should I
hold" for a manager with no other constraint.

Constraints move it, which is the point of drawing it. A locked player is a
constraint, so the tangency portfolio under that lock is a different squad and
usually a worse Sharpe, and the gap between the two is exactly what the lock
costs. That number goes on the page.

What the analogy does not carry, stated because it matters:

- **There is no leverage and no borrowing**: a manager cannot hold half the
  tangency squad and half cash, so points on the capital market line between
  the risk free point and the tangency portfolio are not attainable. The line
  is drawn as a reference, dashed, and labelled as such.
- **Returns are not normal**: a striker's week is closer to a Poisson mixture
  with a fat right tail, so a standard deviation understates the upside and the
  Sharpe ratio flatters the steady player. The page says so.
- **Correlation is structural, not estimated**: two players at one club share a
  clean sheet, so the covariance term is a stated 0.35 rather than a fitted
  number, and it is the single largest modelling assumption on the chart.

### The strategy space, not nine points

Nine lambdas produce nine dots and a curve that looks like a law. The scatter
should instead be the space: a few hundred legal, non-dominated strategies, each
one a squad plus the chip timing that suits it, so a reader can see how thin or
thick the frontier is and where their own squad sits inside the cloud.

Generation, cheap enough to run in a worker:

1. Solve the frontier at many risk aversions (the anchors).
2. Perturb each anchor: swap one, then two players for legal alternatives from
   the pruned candidate set, keeping every result that is legal and affordable.
3. Drop the dominated ones, a squad with less expected return and more risk
   than another, since that is not a choice but a mistake.
4. Keep at most `maxStrategies`, thinned evenly across the risk axis so the
   cloud is not all bunched at one end.

Each surviving strategy carries what a hover has to show: expected points over
the horizon, risk, Sharpe against the minimum variance squad, cost, the plan
total once solved, the chips it would play and when, and its own code. Selecting
one loads the page from that strategy. The strategy the builder handed over
stays pinned in red whatever else is selected, because a reader exploring a
cloud needs the way home.

The chip switches sit on the scatter, one per chip. Turning one on re-solves the
timing for every strategy, which changes the cloud rather than only the
selection: a wildcard is worth more to a squad with a bad run than to a good
one, and that is visible as the cloud shearing rather than shifting.

### What else a plan page owes a reader

Money, which the current page barely shows: team value, the bank, and the cash
flow week by week, with each transfer's cost and the selling price rule applied,
because a plan that spends its bank in gameweek 3 has made a decision nobody
printed.

Rate metrics over the horizon, summed over the squad from each player's own
per ninety rates and his expected minutes: expected goals, expected assists,
expected goal involvements, defensive contribution, and the bonus system score.
These are what the projection is built from, so showing them beside it is how a
reader audits it rather than trusts it.

More relations than levels: projection against price for the fifteen (which
finds the player being carried), ownership against projection (the differential
map), and the fixture run per club in the squad. Each is a scatter with the
squad marked, in the same visual grammar as the frontier.

### The layout

The page is a twelve column grid, and the pitch is currently a 22rem drawing in
a seven column panel, which leaves half a panel of nothing beside it. The pitch
takes five columns, the ledger and the free hand take the rest, and every panel
declares a column span that matches the shape of what it holds rather than a
share of the page.

## Logic

- **Why the chips belong in the search rather than in a control.** "Play your
  wildcard in gameweek 8" is a claim about the whole horizon: it depends on the
  squad you hold, the fixtures ahead, and what the transfers you would otherwise
  make are worth. That is exactly what the beam already evaluates, so the chip
  belongs in the move set and its timing falls out of the search.
- **Why the tangency portfolio and not the highest return.** The highest return
  squad is the one at the far right of the frontier, and holding it is a
  decision about variance that most managers would not make deliberately. The
  tangency portfolio is the best return per unit of risk, which is the squad a
  manager should hold in the absence of a reason to do otherwise, and the page
  should name it rather than leave it implied.
- **Why the cloud rather than the curve.** A curve implies precision the inputs
  do not have. Two hundred dots, most of them close to the frontier, show the
  reader that the difference between the optimum and the merely good is often
  under a point, which is the single most useful thing this page can teach.
- **Why the builder's strategy is pinned.** Exploration without a way back is
  not exploration.

## Data flow

Pool plus locks plus chips -> `optimiseSquad` at many risk aversions -> perturb
and prune -> a few hundred strategies -> per strategy, a chip timing search ->
squad level expected and risk, Sharpe against the minimum variance squad -> the
scatter. Selecting a dot -> its code -> the same `strategy` request the rest of
the page runs on -> the calendar, the ledger, the money, and the rate metrics.

## Dependencies

Internal: `@fpl/planner` (the search, the plan, the chips, the code),
`@fpl/quant` (the frontier and the risk decomposition), `@fpl/core` (the chip
rules and the money arithmetic).

## Related

- [One decision, one explanation](2026-08-20-builder-and-plan-design.md): the
  split this builds on.
- [Planner spec](../../../packages/planner/SPEC.md): the search itself.
- [How this project works](../../ARCHITECTURE.md): the platform end to end.

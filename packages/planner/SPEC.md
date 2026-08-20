---
title: Planner spec
type: spec
module: packages/planner
updated: 2026-08-20
status: active
---

## Purpose

Turns a pool of players with a projection per gameweek into two answers: the best squad to hold over a horizon (`optimise.ts`), and the plan that gets a squad through one (`plan.ts`). Both search rather than rank, both are legal by construction, and both take projections rather than computing them, so the search can be tested against numbers written by hand and a reader can substitute their own opinion of a player without touching the optimiser.

The plan is the fuller of the two: the squad, the eleven, the captain, the transfers, what they cost, and the chip where one earns its place, for every gameweek of a horizon. The optimiser answers the narrower question the builder asks, which fifteen to hold, and answers it over the horizon rather than the week.

## Methods

### isLegal(picks, bank, index, rules): boolean

In: fifteen player codes, the money left in tenths, a code to player index, and the rules. Out: whether the squad satisfies every rule the game enforces. Errors: none. Notes: checks the squad size, an overdrawn bank, duplicates, the 2/5/5/3 quota exactly (not as a range), and the three per club limit. A code the index does not carry is skipped rather than failing, so a pool that lost a player between build and plan degrades instead of throwing.

### valueWeek(picks, week, index, rules, riskAversion, chip): WeekValue

In: a squad, the index into the horizon, the rules, the risk appetite, and the chip in play. Out: the starters, the bench, the captain, the vice captain, and the points the week is worth. Errors: none. Notes: the eleven comes from `bestStartingEleven` in `@fpl/analytics`, so the planner and the site cannot disagree about which eleven is legal. The captain is the highest projected starter, doubled, or trebled under the chip; a bench boost is the only case where a bench player's projection enters the objective.

### movesFor(squad, week, index, byPosition, rules, options, chipsAvailable): Move[]

In: the squad, the gameweek, the pool indexed by position, and the per week limits. Out: the candidate moves, always including the move of doing nothing. Errors: none. Notes: the two transfer space over six hundred candidates is millions of pairs, so it is not enumerated. Each held player is paired with the best few affordable replacements of his own position, and pairs are formed from the best of those singles. This is the one heuristic in the package, and the alternative is a search nobody can run inside a page load.

### applyMove(squad, move, week, index, rules): Squad | null

In: a squad and a move. Out: the squad after it, or null where the result would be illegal or unaffordable. Errors: none. Notes: a sale is priced through `sellingPrice`, which applies FPL's rule that a fall is passed on in full and a rise is only half realised. That is what makes a price forecast matter to a plan rather than only to a table.

### advancePrices(players, week): void

In: the pool and the gameweek. Out: nothing; prices move by the rise probability the projection carried. Errors: none. Notes: a price the plan cannot see makes a later transfer dearer than it looked, which is why this exists at all rather than holding every price flat.

### plan(players, start, options): Plan

In: the pool, the opening squad, and the options (horizon, first gameweek, beam width, transfers a week, discount, risk appetite, chips). Out: a `Plan`: one `WeekPlan` per gameweek, the total after every hit, what holding the same fifteen would have scored, the excess over it, the transfers, the hits, the chips played, and the states explored. Errors: none. Notes: a beam search keeping the best `beamWidth` states per gameweek, deduplicated by sorted picks so two routes to the same squad do not both occupy the beam. A later point is discounted at 0.97, which prefers points now and stops the search hoarding value it never spends. Because doing nothing is always a candidate, the plan can never be worth less than holding.

### holdValue(players, squad, options): number

In: the pool, a squad, and the same options. Out: what that squad is worth held unchanged across the horizon. Errors: none. Notes: this is the benchmark every plan reports itself against, because a plan that cannot beat doing nothing has found nothing.

### optimiseSquad(players, options): SquadOptimisation | null

In: the pool, and a budget, horizon, risk appetite, codes to keep, and the search's own limits (rounds, evaluations, candidate depth, seed). Out: the squad, what it is worth over the horizon, what the greedy squad scored, the value per gameweek, and what the search cost: squads scored, improving moves taken, rounds run, whether it settled, and how many candidates survived the prune. Null where no legal squad fits the budget with those players kept. Errors: none.

Notes: an iterated local search over the real objective. From a starting squad it takes the best single transfer, then the best pair once no single one improves, and repeats until neither does; that is a local maximum, so it kicks the squad and climbs again, keeping the higher peak. Every state is legal by construction and every squad is scored by solving its own best eleven in every gameweek through `bestElevenValue`. Measured on the current lake at the eight gameweek horizon: 592 players, 42,000 squads scored in 470 ms, converging on 440.4 against the greedy squad's 424.6. Forty rounds is where the answer stopped moving: a hundred and fifty rounds over 1.57 million squads found nothing better.

### prune / ceiling / cheapestLegal (internal to optimiseSquad)

In: the pool, or one candidate swap, or the rules and the budget. Out: the candidates worth considering, or the most a swap could be worth, or a legal fifteen to start from. Errors: none.

Notes: three pieces of arithmetic that make the search affordable and honest.

`prune` keeps a player unless `layers` others of his position are both no dearer and no worse **in every gameweek of the horizon**. Dominance is checked per gameweek rather than on the mean, and that is the whole reason the projections are per gameweek: a player who blanks this week and plays twice the next has a mean any steady player beats, and dropping him on it would discard exactly the squad a horizon exists to find. One layer is the frontier alone, which is too tight to satisfy the three per club limit; five leaves room to route around it.

`ceiling` is an upper bound on what a swap can be worth, and it is a bound rather than an estimate, which is what makes skipping on it safe. Take the new squad's optimal eleven and put the old player back where the new one stood: that is a legal eleven for the old squad worth the new total less the difference between the two players, so the new total cannot exceed the old by more than that difference. The captain can double it and nothing else in the squad moves. Skipping every candidate whose ceiling is below the best gain already found cut evaluations from 29,402 to 5,427 with an identical answer.

`cheapestLegal` is the fallback seed. The greedy picker holds back a share of the budget for the eleven, so on a budget close to what fifteen players cost at all it stops short of fifteen, and the search should not be unable to start over a seed's caution. Only when even the cheapest legal squad overspends is the problem genuinely infeasible.

### openingSquad(players, options): Squad

In: the pool and a budget, horizon, rules, and codes to keep. Out: a legal fifteen to plan from. Errors: none. Notes: wraps `autoPick`, which reserves the four bench slots at the cheapest legal prices before spending the rest by projected points per million, then spends what that leaves. An unavailable player is excluded rather than penalised, because a squad that opens with an injured name has spent money on nothing, unless the reader asked to keep him, in which case it is their squad and his news is theirs to read.

### spendUp (internal to openingSquad)

In: the picks `autoPick` produced. Out: the same fifteen with the bank spent. Errors: none. Notes: ranking by points per million is the right measure for choosing between two players and the wrong one for finishing a squad, since a cheaper player always looks better per million and the pass therefore stops with money idle. Measured on the current lake it left 20.0m unspent, so this walks the squad taking the best affordable, legality checked upgrade, at most once per slot.

## Logic

- **Why the squad is a search too, not only the plan.** A squad is not worth the sum of its members: only eleven of the fifteen score, one of them scores twice, and the four who do not are what pay for the ones who do. The worth of adding a player therefore depends on who else is in the squad, which is exactly the condition under which ranking has no claim on the answer. Fifteen from six hundred is a number of squads with thirty digits in it, so it is searched rather than enumerated, and the search reports what it cost.
- **Why the search reports its baseline and its budget.** A squad presented as optimal is unfalsifiable. What `optimiseSquad` claims is narrower and checkable: it beats the greedy squad by this much, it scored this many squads to find it, and either no transfer and no pair of transfers improves it or it stopped at the limit and says so.
- **Why a search rather than a formula.** A gameweek is a selection problem and a season is a sequence of them. The best move this week depends on the move it makes possible in three, and a greedy pick can never bank a transfer for a double gameweek because it never looks that far.
- **Why legality is a constructor and not a filter.** A suggestion that breaks a rule is not a worse plan, it is not a plan: the manager cannot enter it. Checking when a state is built means an illegal squad is never scored, so it can never win.
- **Why risk is a parameter.** The right squad for a manager chasing a rank is not the right squad for one protecting it. At 0 the objective is the mean; above 0 it subtracts standard deviations, below 0 it adds them.
- **Why the plan reports its excess.** The total alone is unfalsifiable. What a plan claims is that it beats holding the same fifteen, and that number is printed beside it.
- **Why the pool is structural.** `PlannerPlayer` carries a code, a position, a club code, a price, and a projection per gameweek, and nothing else. Anything richer would tie the optimiser to one source of projections.

## Data flow

Stored players, teams, fixtures, and per gameweek history -> `buildPool` in `apps/web/lib/planner/projections.ts` -> one projection, one spread, and one rise probability per player per gameweek -> `openingSquad` -> `plan` inside a Web Worker -> a `WeekPlan` per gameweek -> the calendar and the pitch on `/planner`.

The same pool, without the spreads and rise probabilities that page does not read -> `optimiseSquad` in the same worker -> a legal fifteen, its value per gameweek, and what the search cost -> the squad on the pitch and the verdict beneath it on `/builder`.

## Dependencies

Internal: `@fpl/core` (money, positions, the selling price rule, branded ids), `@fpl/analytics` (`bestStartingEleven`, `autoPick`, and the legality engine the site uses).

External: none.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Planner skill](SKILL.md): purpose and constraints in brief.
- [Analytics spec](../analytics/SPEC.md): supplies the eleven search and the legality engine, so a squad is legal by the same code the rest of the site uses.
- [Model spec](../model/SPEC.md): the fitted layer whose projections this package is built to consume.
- [How this project works](../../docs/ARCHITECTURE.md): where the planner sits in the platform end to end.

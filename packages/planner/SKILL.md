---
title: Planner skill
type: skill
module: packages/planner
updated: 2026-08-20
status: active
---

## Purpose

Owns the plan: the beam search over transfer states (`plan.ts`), the legality check every state is built through (`isLegal`), the weekly valuation that solves the best eleven and the captain, the transfer move generator, the price advance, and the opening squad picker (`open.ts`).

Owns the strategy code (`code.ts`): the legible, checksummed encoding of the question a search was asked, the fingerprint of the data it was solved against, and the errors a mistyped code produces.

Owns the free hand suggester (`suggest.ts`): `bestSwaps`, the best legal single transfers out of a squad in one gameweek with no transfer budget, no hit, and no regard for what the plan does next. It answers "what did the plan pass up", which is a different question from "what should I do" and is the one a reader asks when they disagree with a plan.

Owns the squad optimiser too (`optimise.ts`): the iterated local search that answers which fifteen to hold over a horizon, with the frontier prune that decides which players are worth considering, the admissible bound that lets most candidates be skipped without being scored, and the cheapest legal fallback the search starts from when the greedy picker cannot fill a squad.

Does not own: projections. It takes a projection per player per gameweek and never computes one, which is what keeps the optimiser testable against numbers a test writes by hand and lets a reader substitute their own view of a player without touching the search. Projections come from `packages/model` through `apps/web/lib/planner/projections.ts`.

## Skills used in this section

- verify-and-stop: after touching `isLegal`, `applyMove`, or `movesFor`, run the package tests. Most of them are about what the search refuses to do, and a legality regression produces a plan that looks fine and cannot be entered.
- cavecrew-investigator: locate a rule before adding one. The quota, the club limit, and the transfer cost all live in `DEFAULT_RULES`, and a second copy of any of them is how the planner starts disagreeing with the rest of the site.

## Constraints

- **Legality is checked when a state is built, never after it is scored.** An illegal squad must never enter the beam, because a suggestion the manager cannot enter is not a worse plan, it is not a plan.
- **The eleven comes from `@fpl/analytics`.** Never reimplement formation search here. Two implementations are two places to disagree about whether a squad is legal.
- **A sale is priced through `sellingPrice`.** FPL passes on a fall in full and only half a rise. Pricing a sale at the current price overstates every budget in the plan.
- **Doing nothing is always a candidate move.** It is what guarantees a plan can never be worth less than holding, which is the claim every plan prints.
- **The move generator is the only heuristic.** It proposes candidates rather than enumerating the full two transfer space. Keep any future loosening as conservative: a wider generator that suggests an illegal or unaffordable move is caught by `applyMove`, but a narrower one silently hides the right transfer.
- **`openingSquad` must spend the bank.** Points per million is right for ranking and wrong for finishing a squad, and a squad that leaves twenty million idle is worse than any upgrade that money could buy. The upgrade pass is legality checked, so spending can never buy a fourth player from one club.
- **The optimiser's objective is the real one, never a proxy.** Every squad it scores solves its own best eleven in every gameweek of the horizon, through `bestElevenValue` in `@fpl/analytics`, which is the same formation search the page renders and is pinned against it by a test. A cheaper scoring rule that ranked squads by the sum of their fifteen would optimise for a strong bench.
- **The candidate skip must stay a bound, not a guess.** `ceiling` is safe because it can never be below the true gain: the search therefore never misses a move it would have preferred. Replacing it with an estimate turns a proven search into an unproven one, and nothing on screen would show the difference.
- **Dominance is per gameweek, never on the mean.** Pruning on a mean discards the player who blanks this week and plays twice the next, which is exactly the player a horizon exists to find.
- **The search says what it cost and what it beat.** `evaluated`, `improvements`, `rounds`, `converged`, and `baseline` are part of the answer, not diagnostics. A squad presented as optimal with nothing to check it against is a claim the reader cannot argue with.
- **A lock is a constraint, never a bonus.** A fixed player is not scored more highly, he is simply present, and the search still reports what it beat, so the cost of fixing him is visible as a smaller excess rather than hidden. The two modes are two different questions: `start` holds him in the opening fifteen and lets the plan sell him, `always` also removes him from every sale `movesFor` may propose. Never collapse them into one flag.
- **The free hand suggester stays legal.** It ignores the transfer budget and the hit on purpose; it must never ignore the bank, the selling price rule, the quota, or the club limit. An impossible suggestion is not a suggestion.
- **A code carries the question, never the answer.** Encoding the solved squad would produce a code that silently goes stale as prices move. Encoding the inputs plus a fingerprint means a paste re-solves on today's data and can say that the data moved. Never add the picks to the code to make sharing "exact": exact and current cannot both be true.
- **A refused code is better than a wrong one.** `decodeStrategy` checksums before it parses and names what is missing. Loosening that to be forgiving would mean solving a strategy nobody asked for and showing no sign of it.
- **The holding line is not a beam state.** It is carried separately because the claim every plan prints depends on it surviving, and a beam prunes on the discounted score, which is exactly what a banked transfer looks worst on.
- **A free transfer is not free.** The minimum gain and the no-buy-back rule are both stated thresholds, not fitted ones, and both exist because the model prices a transfer at zero while the game does not. Removing either brings the churn back.
- **The test fixture spreads clubs by the global player code, not the position index.** Assigning by position index puts the first of every position at the same club, which makes the first fifteen picks four players from it. That was a real bug in the fixture, and `isLegal` is what caught it.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Planner spec](SPEC.md): full method and logic detail.
- [Analytics spec](../analytics/SPEC.md): the legality engine and eleven search this package builds on.
- [Model spec](../model/SPEC.md): the fitted projections this package consumes.

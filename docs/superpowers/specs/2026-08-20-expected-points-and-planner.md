---
title: Fitted expected points, and a planner that optimises against them
type: spec
module: packages/model, packages/planner, packages/ingest, apps/web
updated: 2026-08-20
status: active
---

## Purpose

Two things, in order, because the second is worthless without the first.

**Expected points becomes a fitted model rather than a stated heuristic.** Today `analytics/projection.ts` multiplies points per game by a fixture term and an availability term. It is honest, it explains itself, and it knows almost nothing: not who the opponent is beyond a difficulty number, not who the player is marked by, not who picks the team, not whether the player has ever done this against this shape before. This work replaces it with component models fitted over the lake, composed back into points through the real scoring rules.

**A planner then optimises a squad against those projections over any horizon**, from one gameweek to a whole season, under every rule the game actually enforces: the budget, the 2/5/5/3 quota, three per club, one free transfer a week with a four point hit beyond it, and the chips. Over a horizon longer than a week that means planning transfers, which means predicting prices, because a squad's budget moves with them.

## Methods

### Data foundations

Three gaps have to be closed before any of this is fittable, and each was measured rather than assumed.

#### Manager spells, from Wikidata

The manager data currently stored is wrong, and the fault is upstream. The Premier League staff endpoint returns every registered official with the role "Manager" and no way to tell which one takes the team: Chelsea's 2026/27 payload carries both Calum McFarlane and Xabi Alonso, each `active`, each with an Opta id, with no start date to separate them. Palace carries Glasner and Sage; Forest carries Pereira and Glasner, who is simultaneously at Palace. Asked for a past season it is worse: Chelsea 2023/24 returns one row, "Matchday Manager Jesús Pérez", who stood in for a single fixture.

So the provider cannot answer either question, and the fixture detail payload carries no manager at all. Wikidata can answer both. The club entity holds dated `head coach` (P286) statements: Chelsea's has sixteen, the open ended one being Q208104, Xabi Alonso. That is fetched through the same entity API the ground photograph source already uses, with no SPARQL endpoint involved.

A new source, `managers-wikidata`, resolves each club to its Wikidata item and stores one row per spell in a `manager-spells` dataset: club code, person, Wikidata id, start, end, and whether the spell is open. The head coach of any match is then the spell covering its kickoff, which is a lookup rather than a guess, and manager history reaches back as far as the archive does.

The Premier League `managers` dataset stays as it is, since it is the source of the photographs and the assistant staff, but it stops being the answer to "who is the manager".

#### Teamsheets, six seasons

Duel features need lineups, and the lake holds two seasons of them. The detail pass is extended to six, which is about 2,280 requests at the client's 250 ms floor, so roughly twenty minutes and about 30 MB of JSONL.

#### Duels, derived from the formation

A teamsheet returns the formation as positional rows, `[[GK], [RB, CB, CB, LB], [CM, CM], [RW, AM, LW], [ST]]`, plus a `matchPosition` per player. That is enough to compute who a player actually faces: a left winger in the third row of a 4-3-3 is opposite the right back in the opponent's second row, and in a 4-4-2 he is opposite the right back and the right midfielder together. The mapping is a pure function from two formations and a slot to a set of opposing slots, stored so a model can read "this winger, against this full back" as a feature rather than rediscovering it.

### packages/model

A new package. It depends on `@fpl/core` (the rules and the scoring), `@fpl/store` (the lake), `@fpl/analytics` (team strength), and `@fpl/quant` (the ML layer). It knows about football, which is why it is not in `quant`.

#### Features

Built strictly from information available before kickoff, in six families:

- **The player's own history**: rolling and exponentially weighted points, minutes, starts, goals, assists, expected goals and assists, shots, bonus, BPS, and their per 90 rates over several windows; the AR(1) half life of his own form; his rate in this fixture's venue.
- **The club**: attack and defence strength from `estimateStrength`, rolling goals for and against, clean sheet rate, the share of the club's expected goals the player carries, and the club's rest days since its last match.
- **The manager**: tenure in days at kickoff, whether the spell opened inside the last five matches (a new manager is the single largest discontinuity in a club's form), the manager's own career rates where the archive covers them, and the club's points per match under this spell against the spell before it.
- **The shape**: the club's most recent formation, its stability over the last six matches, and the player's own slot within it.
- **The opposition**: the opponent's strength, its conceding rate by position band, its formation, and the duel: the opposing slot or slots this player's slot faces, and what those specific opponents have conceded to that slot historically.
- **The conditions**: home or away, rest days, gameweek, congestion (matches in the last fourteen days), the referee's card rate, and the weather at kickoff where the forecast exists.

Every one of them is produced by a named builder with its own test, and the whole design matrix passes `leakageReport` before a model is fitted.

#### Targets, and why they are components

Points are not modelled directly. Eight components are, each with the model that suits its shape:

| Component                     | Model                                                       | Why                                                                                   |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Minutes                       | Gradient boosting, three classes (unused, part, sixty plus) | Availability dominates every other term, and it is a classification, not a regression |
| Goals                         | Gradient boosting on a rate, Poisson scored                 | A count with a long tail                                                              |
| Assists                       | Same                                                        | Same                                                                                  |
| Clean sheet                   | Gradient boosting, logistic                                 | A club level binary the player shares                                                 |
| Goals conceded                | Poisson rate                                                | Feeds the defender and keeper penalty                                                 |
| Saves                         | Poisson rate                                                | Keepers only                                                                          |
| Bonus                         | Gradient boosting on BPS, then the existing `predictBonus`  | BPS is the thing the rules actually award on                                          |
| Cards, defensive contribution | Logistic                                                    | Rare events, calibrated rather than ranked                                            |

They are composed into expected points through `core/scoring.ts`, so the scoring table is never learned from data, it is applied. A projection can therefore be broken into its parts on screen: this many points from playing, this many from the clean sheet he is 38 percent likely to keep.

#### Prices

A ninth model, because a planner over a season needs it. FPL moves a price on net transfers, which is not published, but ownership is: the panel carries `selectedBy` and `price` for every player for every gameweek of ten seasons. The target is the price change over the next gameweek, and the features are the ownership level, its change over one and three gameweeks, recent points, and the distance from the player's starting price. It is a three class problem (fall, hold, rise) rather than a regression, because that is what the game does.

#### Validation

Walk forward by gameweek with a purge and an embargo, exactly as the Lab does, since the panel is the same panel. Every component reports the metric that suits it: log loss and calibration for the binaries, RMSE and a Poisson deviance for the counts, and for the composed projection, the rank correlation against the points actually scored and the mean absolute error against them. A permutation null runs beside each one, because a component that cannot beat a shuffled target should not be shipped.

The gate for shipping a component is stated in advance: it must beat both the shuffled target and the current heuristic on the same folds.

#### Artifacts

`fpl model train` fits every component and writes `data/models/{component}.json`: the trees, the feature names, the training window, the seed, the validation scores, and the date. They are committed, so the site scores instantly at build time and a change to a model is a reviewable diff. `fpl model evaluate` re-scores a stored artifact against the lake without refitting, and `fpl model project` writes the projections for the coming gameweeks.

The Lab reads the same artifacts, so a reader can see the shipped model's own numbers, and refit it interactively with a different feature set to see whether they can do better.

### packages/planner

Beam search over transfer plans, valued by the model.

#### State

A squad (fifteen players with their purchase prices), the bank, the free transfers banked, the chips still unplayed, and the gameweek. Every rule in `core/rules.ts` is enforced on every state: the budget, the 2/5/5/3 quota, at most three from a club, and the fifteen slots. Selling applies `sellingPrice`, so a rise is only half realised, which is what makes a price model matter to the plan rather than only to the table.

#### Objective

Expected points over the horizon, from the model, minus four for every transfer beyond the free one, with the starting eleven and the captain chosen per gameweek by `bestStartingEleven`. Because the projection is a distribution rather than a number, the objective can be the mean or a lower quantile: a manager chasing a rank needs variance and a manager protecting one needs the opposite, so risk appetite is a parameter rather than an assumption.

#### Search

Per gameweek the planner enumerates candidate moves (no transfer, every single transfer worth considering, and the best few doubles), scores each resulting state over the remaining horizon with a discounted rollout, and keeps the best `k` states. The beam bounds a space that is otherwise astronomical, and the discount is what makes it prefer points now without being blind to a wildcard three weeks out.

Chips are states, not afterthoughts: playing a wildcard branches into a full rebuild, a free hit into a one week rebuild that reverts, a bench boost into an objective that counts fifteen players, and a triple captain into a trebled captain. Each is tried at every gameweek in the horizon and kept only where it earns more than holding it.

#### Output

A plan: for each gameweek, the squad, the eleven, the captain, the transfers made and their cost, the chip if any, and the expected points with its interval. Plus what the plan is worth against doing nothing, which is the only number that says whether the search was worth running.

### apps/web

- `/planner`: pick a horizon (this gameweek, a month, to the end of the season), a starting squad, and a risk appetite, and read the plan on a calendar: one column per gameweek, the transfers and chip on the row where they happen, blanks and doubles marked. The calendar is the navigation as well as the output, the way the gameweek ribbon already is on a player page.
- Player pages print the fitted projection broken into its components, with the two or three features that moved it most.
- The Lab gains a panel for the shipped models: their validation scores, their calibration, and their importances, so the model on the site is auditable by the same tools as one fitted in the browser.

## Logic

- **A projection nobody can break apart is a projection nobody should trust.** Components are modelled separately and composed through the published rules, so every number on screen decomposes into minutes, a goal rate, a clean sheet probability, and a bonus expectation.
- **The scoring table is applied, never learned.** A model asked to discover that a midfielder's goal is worth five will spend its capacity on that instead of on football.
- **Manager truth comes from the source that has dates.** Two providers were probed and neither could name a club's head coach; the one with dated spells is used, and the join is stored so a wrong one is auditable.
- **Duels need a formation, so they exist only where teamsheets do.** Six seasons carry them; before that the opposition features fall back to club level. The model records which rows had the duel features and which did not, rather than imputing them.
- **Prices are a three class problem.** The game moves a price by a tenth or not at all, so a regression on a continuous change would fit noise between the steps.
- **The planner optimises against a distribution.** Risk appetite is a parameter because the right squad for a manager chasing a rank is not the right squad for one protecting it.
- **Every state the planner visits is legal.** The rules are checked on construction rather than filtered afterwards, so an illegal squad is never scored and never suggested.
- **A plan is only worth its excess.** Every plan is reported against holding the current squad and taking the free transfer greedily, because a search that cannot beat that has found nothing.

## Data flow

Club list -> Wikidata entity per club -> dated head coach statements -> the manager-spells dataset -> the spell covering a kickoff -> the manager features.

Six seasons of teamsheets -> formation rows plus match positions -> the duel mapping -> the opposition features.

The panel, the official record, the manager spells, and the duels -> the feature builders -> `leakageReport` -> walk forward splits -> one fitted model per component -> `data/models/*.json`.

The artifacts plus the coming fixtures -> the component predictions -> `core/scoring.ts` -> expected points with an interval -> the player pages, the scout, and the planner's objective.

A squad, a horizon, and a risk appetite -> the planner's beam search over transfer and chip states, priced by the price model -> a gameweek by gameweek plan -> the calendar.

## Dependencies

Internal: `@fpl/core` (rules, scoring, squad legality), `@fpl/store` (the lake), `@fpl/analytics` (team strength, bonus prediction, squad selection), `@fpl/quant` (gradient boosting, validation, calibration, explanation).

External: none beyond what the repository already carries.

## Related

- [How this project works](../../ARCHITECTURE.md): updated in the same commit as each stage lands.
- [The Lab, a quantitative sandbox over the lake](2026-08-19-quant-lab-design.md): the engine this work fits models with.
- [Quant spec](../../../packages/quant/SPEC.md): the ML layer underneath.
- [Analytics spec](../../../packages/analytics/SPEC.md): the heuristic projection this replaces, and the squad rules the planner enforces.

---
title: Model spec
type: spec
module: packages/model
updated: 2026-08-20
status: active
---

## Purpose

The fitted expected points layer. It assembles the panel every model trains on, derives the features (including the geometry that names a player's direct opponents from the formation the opposition last played), states the component targets, fits them under walk forward validation with ablations and a shuffled target null, writes the ones that earned it as committed artifacts, and composes those components into points through the published scoring rules.

Nothing here fits points directly. Each component says one thing about a player's next match, and `project.ts` applies the scoring table to those statements, which is what lets a projection be broken apart on screen: two points because he will finish the match, one and a half because of a thirty eight percent clean sheet, each traceable to a model with its own score.

## Methods

### loadPanel(store, sources): Promise<Panel>

In: a store, the season the lake is filed under, the archive seasons to load, and `includeLive` to add the current one. Out: the rows plus the indexes every feature needs: the permanent club code for a season's FPL team id, the club a row belongs to, manager spells, matches, teamsheets by match id, and which seasons carry teamsheets at all. Errors: none; a dataset that was never written reads as empty rather than failing, so a clone with no backfill still builds.

Notes: `includeLive` exists because the archive stops where the current season starts, so a model fitted on closed seasons has nothing to project today's squad from. Live rows are rekeyed from FPL's element id to the permanent player code through the stored player list, the same way the archive backfill does, and a player the list does not carry is dropped rather than matched on name.

### lateralOf(row, index) / advancementOf(rowIndex, rows) / slotsOf(formation) / duelsFor(slot, opposingFormation)

In: a formation as rows of person ids, or a slot. Out: where a player stands across the pitch (0 at the left touchline, 1 at the right), how far up it he plays, the slots a formation produces, or the opposing slots a slot actually contends with and how much of its time goes to each. Errors: none. Notes: the keeper is excluded from advancement, because including him compresses every outfield band towards the halfway line. A duel weight below `DEFAULT_MINIMUM_WEIGHT` is dropped rather than kept as noise. Verified against the case the whole idea rests on: a winger against a 4-3-3 draws the opposing full back at 0.76, the near centre back at 0.15, and the near midfielder at 0.08.

### buildShapeIndex(panel) / buildStrengthIndex(panel)

In: the panel. Out: the last formation a club named before a given kickoff, and each club's attack and defence estimates as of that date. Errors: none. Notes: everything here is lagged to before kickoff on purpose. Reading the teamsheet of the match being predicted made "has a slot" mean "started", which is the minutes target, and the minutes model duly scored 0.885 with formation stability as its leading feature. Lagged it scores 0.522 with rolling minutes leading, which is the honest number.

### buildFeatures(panel, options): { rows, featureNames, dropped }

In: the panel and a minimum history. Out: one row per player gameweek with a `Float64Array` of features, the names in the order they were pushed, and how many rows were dropped for thin history. Errors: throws if the array length and the declared names disagree.

Notes: that guard is not defensive programming, it is a scar. A block pushed in the wrong order relabels every feature after it, and the model that results looks fine and means nothing: one such bug was presented as "a manager's record predicts conceding". The guard plus the sentinel tests in `features.test.ts` are what make a one position shift fail loudly.

### impliedShotQuality(threatPerShot) / impliedShotDistance(quality)

In: FPL's threat measure per shot, then the quality it implies. Out: an expected goals value, and the distance that value corresponds to. Errors: none; NaN in, NaN out, rather than a fabricated location. Notes: the inversion is `-ln(quality) / 0.136`, clamped to 4 and 35 metres. This is the shot origin idea, and as of the run on 2026-08-20 it has not earned its place: ablating it changed the goal rate score by 0.0001, so it is not shipped as a feature and no posterior surface is rendered from it.

### targetsFor(component, rows) / priceTargets(rows)

In: a component and the feature rows. Out: the target vector and the row indexes it applies to. Errors: none. Notes: a component declares its own grain. A clean sheet is a club match event, so eleven identical rows per match were inflating the sample eleven fold and putting the same match on both sides of a fold boundary; club grain components are deduplicated by season, gameweek, and club before fitting. Price change uses consecutive gameweeks within one season only, since a summer reprice is not a price change.

### fitComponent(component, rows, options) / fitAll(rows, options)

In: the rows and the options (folds, rounds, seed, ablations). Out: a fit carrying its score, its standard error, the score against a shuffled target, whether it beat that, the feature importances, the ablation results, and whether a per position segmentation beat the pooled fit. Errors: none. Notes: validation is `walkForwardSplits` from `@fpl/quant`, with a purge and an embargo, because a shuffled fold trains on gameweek 30 and tests on gameweek 12. Segmentation is measured rather than assumed: on the 2026-08-20 run the pooled fit won on every component tested, so the position one hots already carry what a separate model would.

### trainModels(store, options): Promise<TrainReport>

In: the store, the season, the training seasons, and the fit options. Out: the report, and the artifacts written for every component that beat its own shuffled target. Errors: propagates the store's. Notes: a component that cannot beat noise is not written. That is the whole gate, and it is why the lake carries no clean sheet or conceding artifact today: both scored below zero at club grain and were refused.

### projectRow(artifacts, input, options): Projection

In: the artifacts on disk and one feature row. Out: the components, the points broken down by scoring rule, which components were fitted rather than averaged, and the projection's own account of itself. Errors: none. Notes: a component with no artifact falls back to the league average for that measure and says so, so a reader can see how much of a number is a model and how much is an average.

### composePoints(position, components): PointsBreakdown

In: a position and the component predictions. Out: appearance, goals, assists, clean sheet, conceded, saves, bonus, and cards, plus their total. Errors: none. Notes: nothing here is fitted. The scoring table is published, so it is applied rather than learned, and the clean sheet term is multiplied by the probability of being on the pitch for a full sixty because the rule pays it only then.

## Logic

- **Why components rather than one model of points.** Points are a sum of rules over events. Fitting the sum learns the rules badly and hides which part of a projection is wrong; fitting the events and applying the published rules means every number on screen can be traced to a claim with its own validation score.
- **Why the identity joins are exact.** The Premier League's own API publishes the Opta id beside its own, and those digits are FPL's team and player codes. Everything about a manager, a formation, and a duel therefore rests on a substring rather than a name match.
- **Why a manager is a spell rather than a field.** Neither football provider names a club's current head coach, so spells come from Wikidata with their dates, and the shortest covering spell wins so a caretaker is not shadowed by the man he stood in for.
- **Why every fit prints its null.** A score with nothing to compare it against is a number that reads as good. The shuffled target is the floor, and a component that cannot clear it is not written to disk at all.
- **Why the failures are documented here.** Two leakage bugs and one feature misalignment were found in this package by measurement, not by review. Recording what they looked like when they were wrong is what stops the next version of each from being believed.

## Data flow

Stored archive seasons plus the live season -> `loadPanel` -> `buildShapeIndex` and `buildStrengthIndex`, both lagged to before kickoff -> `buildFeatures` -> `targetsFor` per component -> `fitAll` under walk forward validation with a purge and an embargo -> a shuffled target null and an ablation per feature family -> `toArtifact` for every component that beat its null -> `data/models/*.json`.

Artifacts plus a feature row -> `projectRow` -> component predictions -> `composePoints` through the published scoring rules -> a projection with its own explanation.

## Dependencies

Internal: `@fpl/core` (the domain schemas, the scoring constants, manager spells), `@fpl/store` (reading the panel), `@fpl/quant` (the frame, gradient boosting, walk forward validation, permutation importance, and the metric set).

External: zod, through `@fpl/core`.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Model skill](SKILL.md): purpose and constraints in brief.
- [Quant spec](../quant/SPEC.md): the statistics and machine learning this package fits with.
- [Core spec](../core/SPEC.md): the schemas the panel is parsed against, and the scoring rules the components are composed through.
- [Planner spec](../planner/SPEC.md): the consumer of these projections.
- [How this project works](../../docs/ARCHITECTURE.md): where the model sits in the platform end to end.

---
title: Model skill
type: skill
module: packages/model
updated: 2026-08-20
status: active
---

## Purpose

Owns the fitted expected points layer: the panel (`panel.ts`), the duel geometry that names a player's direct opponents from the opposition's last formation (`duel.ts`), the feature builder (`features.ts`), the component targets and their grain (`targets.ts`), training with ablations and a shuffled target null (`train.ts`), the artifact schema and scoring (`artifact.ts`), the composition of components into points through the published rules (`project.ts`), and the training command (`pipeline.ts`).

Does not own: the statistics or the learner, which are `packages/quant`; the domain schemas or the scoring table, which are `packages/core`; and the stated heuristic projection the squad builder ranks on, which is `packages/analytics` and stays there deliberately, so a page always has a number even where no artifact earned its place.

## Skills used in this section

- verify-and-stop: after touching `features.ts`, run the package tests before anything else. The sentinel tests exist because a misaligned feature array produces a model that looks fine and means nothing.
- superpowers:systematic-debugging: a score that jumps is a leakage report until proven otherwise. Both leakage bugs found here looked like good news first.

## Constraints

- **A feature may never read the row it describes.** Everything about a club's shape, strength, and manager is lagged to before kickoff. Reading the teamsheet of the match being predicted made "has a slot" equal "started", which is the minutes target, and the minutes model scored 0.885 on it.
- **The feature array and `FEATURE_NAMES` must agree, and the code checks it at runtime.** A block pushed out of order relabels every feature after it. That shipped once, as "a manager's record predicts conceding".
- **A component declares its own grain.** A clean sheet is a club match event, not a player event. Eleven identical rows per match inflate the sample eleven fold and put the same match on both sides of a fold boundary.
- **Validation is forward only, with a purge and an embargo.** A k fold shuffle over this panel trains on gameweek 30 and tests on gameweek 12. It is not a shortcut to fix later, it is a result that means nothing.
- **A component that cannot beat a shuffled target is not written.** No artifact, no projection from it, and the fallback league average says so on screen. Clean sheet and conceding are both refused today, and that is the system working.
- **Segmentation is measured, not assumed.** Per position fits are compared against the pooled one with their standard errors, and on the current run pooled won every time. Do not hardcode a per position split on the intuition that forwards differ from midfielders; the position one hots already carry it.
- **Nothing here fits points.** The scoring table is published, so it is applied. A model of the sum learns the rules badly and hides which part of a projection is wrong.
- **An unearned feature is not shipped because it is a good idea.** The shot origin inversion is implemented, tested, and currently not used, because ablating it moved the goal rate score by 0.0001.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Model spec](SPEC.md): full method and logic detail.
- [Quant spec](../quant/SPEC.md): the learner, the validation, and the metrics.
- [Core spec](../core/SPEC.md): the schemas and the scoring rules.
- [Planner spec](../planner/SPEC.md): the consumer of these projections.

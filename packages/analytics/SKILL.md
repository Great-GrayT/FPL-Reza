---
title: Analytics skill
type: skill
module: packages/analytics
updated: 2026-08-20
status: active
---

## Purpose

Owns derived measures over stored domain rows: rolling form, fixture difficulty
across a horizon, value per million, bonus prediction from BPS, and defensive
contribution rates.

Also owns the fixture model (`strength.ts`): `estimateStrength` reads every completed match on record into a per club attack and defence, plus the division's baseline and home advantage; `forecastMatch` turns two clubs into goal expectations and every probability read off them; `explainForecast` states the sample, the baseline, and the model's own two known errors.

Also owns squad selection and the numbers a manager is shown: `squad.ts` (legality, best legal eleven, auto pick, transfer suggestions), `projection.ts` (a stated points heuristic, differentials, fixture swings), and `glossary.ts`, the dictionary every metric label on the site links to.

Does not own: fetching (packages/ingest), storage (packages/store), or the rule
constants themselves (packages/core). Every function here is pure, taking
domain rows and returning numbers. Nothing touches the filesystem or network.

## Skills used in this section

- verify-and-stop: after changing a formula, run the package tests. They pin
  exact values, not ranges, so a silent change of meaning fails loudly.
- cavecrew-investigator: locate the rule constant in packages/core before
  copying a threshold into this package. Thresholds belong there, not here.

## Constraints

- The fixture horizon is truncated at GAMEWEEKS_PER_SEASON. A horizon running
  past gameweek 38 must never report gameweeks that do not exist as blanks.
- averageDifficulty and averageStrengthDifferential are `number | null`, and
  null means the horizon held no fixtures. Returning 0 would sort a team with
  no fixtures as having the easiest run, and 0 is a legitimate value for a
  differential, so null is the only safe empty signal.
- Defensive contribution rates exclude gameweeks whose count is null, from both
  the numerator and the minutes base. Null means the season predates the rule,
  which is not the same as a measured zero.
- Bonus prediction follows the official tie rules: a tied group consumes as
  many award slots as it has members, so a two way tie for first awards 3 and 3
  and the next distinct score takes 1.

- `squad.ts` applies the rules in packages/core, it never restates a limit. A UI that reimplements the budget or the club cap will disagree with the engine, so the builder calls this code rather than duplicating it, which is why the functions take a structural `SquadPlayer` and not the full domain row.
- `bestStartingEleven` searches every legal formation rather than taking the top eleven by projection. The top eleven is frequently illegal (five midfielders and no defenders), and a greedy fix would be an approximation where the exact answer costs nothing.
- `bestElevenValue` and `bestStartingEleven` answer the same question and must never disagree. The first exists only because the squad optimiser cannot afford the second's allocations, and the equivalence is a test rather than a convention. Changing the formation rules means changing both in the same edit, and the rules themselves stay in packages/core.
- `projectPoints` has no fitted parameters and returns its own explanation. Every weight is a named constant in that file. Do not replace it with an opaque score: a squad builder whose ranking cannot be argued with is worse than one with no ranking.
- `strength.ts` is stated, not fitted. Every constant in it is named and justified in place (`HALF_LIFE_SEASONS`, `SHRINKAGE_MATCHES`), and none of them is tuned against an outcome the model is later scored on. Replacing it with a fitted model means also replacing `explainForecast`, because a forecast a reader cannot argue with is worse than no forecast.
- A club with fewer than `SHRINKAGE_MATCHES` matches is blended towards the division average and marked `shrunk`, and every surface that prints its numbers says so. A promoted club has no Premier League record, and presenting one match as a strength would be the single easiest way for this model to mislead.

- Every entry in `glossary.ts` states the exact operation, not a paraphrase, plus the source and the caveat where a metric misleads. Adding a metric to the interface means adding its entry, since the UI links labels to ids and a missing id renders the label unlinked.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Analytics spec](SPEC.md): full method and logic detail.
- [Core spec](../core/SPEC.md): supplies the domain rows, thresholds, and per90.

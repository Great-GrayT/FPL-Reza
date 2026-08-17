---
title: Analytics skill
type: skill
module: packages/analytics
updated: 2026-08-16
status: active
---

## Purpose

Owns derived measures over stored domain rows: rolling form, fixture difficulty
across a horizon, value per million, bonus prediction from BPS, and defensive
contribution rates.

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

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Analytics spec](SPEC.md): full method and logic detail.
- [Core spec](../core/SPEC.md): supplies the domain rows, thresholds, and per90.

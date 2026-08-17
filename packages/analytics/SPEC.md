---
title: Analytics spec
type: spec
module: packages/analytics
updated: 2026-08-16
status: active
---

## Purpose

Pure derived measures over domain rows, with no I/O.

## Methods

### rollingForm(gameweeks, windowSize): FormWindow

In: a player's gameweek rows and a window length. Out: points per game, points
per 90, minutes per game, expected goal involvements per 90, and a starter
reliability share (the fraction of the window with a full 60 minute
appearance). Errors: none. Notes: a window longer than the available rows uses
what exists; zero minutes yields 0 rather than a divide by zero, via core's
per90.

### fixtureDifficulty(fixtures, teamId, fromGameweek, horizon): FixtureDifficultySummary

In: fixtures for any teams, the team of interest, a starting gameweek, and a
horizon length. Out: one entry per fixture involving that team inside the
horizon, the blank and double gameweeks, the effective gameweek list, and the
mean difficulty. Errors: none. Notes: the horizon stops at gameweek 38;
averageDifficulty is null when no fixtures fall inside it.

### strengthAdjustedFixtureDifficulty(fixtures, team, teamsById, fromGameweek, horizon): StrengthAdjustedSummary

In: as above plus the team record and a lookup of every opponent. Out: the same
summary with a strength differential per fixture, computed as this team's
attack strength on the side it is playing minus the opponent's defence strength
on theirs. Errors: throws if teamsById lacks an opponent, rather than silently
dropping that fixture. Notes: FPL leaves the attack and defence splits at 0
until a season opens, so preseason this differential is 0 for every fixture and
carries no signal.

### pointsPerMillion(totalPoints, price) / formValuePerMillion(gameweeks, windowSize, price) / priceChange(currentPrice, startPrice) / valueMetrics(player, recentGameweeks, windowSize)

In: totals or rows plus a price in tenths. Out: points per million of price,
the same over the recent window, the movement since the season opened in
tenths, and the three combined. Errors: none. Notes: prices stay integer
tenths throughout, so no float rounding enters budget arithmetic.

### predictBonus(entries): BonusAward[]

In: a fixture's player ids with their BPS. Out: the same entries with predicted
bonus, in the input order. Errors: none. Notes: ranks by BPS descending, then
walks the 3, 2, 1 awards so a tied group consumes one slot per member. Anyone
past the awards receives 0.

### defensiveContributionSummary(position, gameweeks): DefensiveContributionSummary

In: a position and that player's gameweek rows. Out: the per 90 rate of
defensive actions, the share of gameweeks that reached the positional
threshold, and expected defensive contribution points per gameweek. Errors:
none. Notes: gameweeks whose count is null are excluded entirely; keepers never
qualify.

## Logic

Thresholds are read from packages/core, never redeclared here, so the published
rule stays the single source: 10 for defenders, 12 for midfielders and
forwards, non stacking, 2 points.

Blanks and doubles are reported explicitly rather than averaged away, because a
mean alone cannot distinguish a team with one easy fixture from a team with two.

## Data flow

stored player gameweek rows -> rollingForm or defensiveContributionSummary -> per
player rates consumed by the API and CLI.

stored fixtures plus teams -> fixtureDifficulty or its strength adjusted variant
-> a per team outlook over the horizon.

player price in tenths plus points -> valueMetrics -> value per million.

## Dependencies

Internal: @fpl/core (domain rows, thresholds, per90, money helpers), @fpl/store
(types only).

External: zod.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Analytics skill](SKILL.md): purpose and constraints in brief.
- [Core spec](../core/SPEC.md): supplies every row type and rule constant used here.
- [Store spec](../store/SPEC.md): rows reach this package after a Store read.

---
title: Analytics spec
type: spec
module: packages/analytics
updated: 2026-08-18
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

### validateSquad(state, players, teamName?): SquadIssue[]

In: the picks and an optional budget, the player list, and a club namer for the messages. Out: every violation at once, each with a machine readable code (over_budget, squad_incomplete, quota_short, quota_exceeded, club_limit, duplicate, unknown_player) and a sentence a UI can print. Errors: none. Notes: reports all problems together rather than the first, so a builder does not make the user fix fifteen things in fifteen round trips. `isLegalSquad` is the boolean form.

### canAdd(state, candidate, players): { ok: true } | { ok: false, reason }

In: the current picks, one candidate, the player list. Out: whether the candidate can join, and if not, why, quoting the numbers (the price and what is left). Errors: none. Notes: this is what a drop target asks before it accepts, so a refusal happens at the gesture rather than after it.

### squadCost / countByPosition / countByClub

In: the picks and the player list. Out: spent, remaining, and the budget in tenths; counts per position; counts per club. Errors: none. Notes: an id no longer in the player list contributes nothing rather than throwing, because a stored squad outlives a transfer window.

### bestStartingEleven(picks, players, projection): StartingEleven

In: a squad, the player list, and a projection. Out: starters, bench in the order they would come on, the formation, the projected total, and a captain and vice captain. Errors: none. Notes: exhaustive over the legal formations (1 keeper, 3 to 5 defenders, 0 to 5 midfielders, 1 to 3 forwards, summing to 11), because there are only a handful and the exact answer is cheaper than justifying a heuristic. The spare keeper sits at the front of the bench, since only a keeper can replace a keeper. A squad too small to field an eleven yields empty lists rather than throwing.

### autoPick(players, projection, options?): PlayerId[]

In: the pool, a projection, and optional budget, keep, exclude, benchBudgetShare. Out: a complete legal squad. Errors: none. Notes: reserves the four bench slots at the cheapest legal prices first, then spends the rest by projected points per million, then fills any slot the value pass could not afford with the cheapest legal option, because an incomplete squad cannot be entered. Spending evenly across fifteen slots buys a weak eleven and an expensive bench, which is why the reserve exists.

### suggestTransfers(state, players, projection, limit?): TransferSuggestion[]

In: the squad, the pool, a projection, and how many to return. Out: same position swaps that raise the projection, best gain first, each with the points gained and the money freed. Errors: none. Notes: every candidate is checked through `canAdd` against the squad without the outgoing player, so a suggestion can never break the club cap or the budget.

### projectPoints(player, inputs?): ProjectionParts

In: a player, and optionally their gameweeks this season, the fixture list, a starting gameweek, and a horizon. Out: the base rate, the fixture multiplier, the minutes multiplier, the product, and an explanation as a list of sentences. Errors: none. Notes: base is points per game over the last six gameweeks, or last season's points per game before this season has any matches, which is what makes the number non zero in August. The fixture term is 1 plus 0.12 per difficulty step either side of neutral (3), clamped to 0.6 and 1.4. Availability multiplies (injured and suspended are 0, doubtful 0.5), and starter reliability only counts once there is evidence for it. A blank or a double is named in the explanation rather than folded into the average.

### differentials(players, projection, options?): DifferentialRow[]

In: the pool, a projection, and optional maxOwnership, minProjected, limit. Out: players under the ownership ceiling ranked by edge, projected points per percent owned. Errors: none. Notes: ownership is floored at a tenth of a percent so an unowned player does not divide into an infinite edge.

### fixtureSwings(fixtures, teamIds, fromGameweek, horizon): FixtureSwing[]

In: the fixture list, the clubs to rank, a start, and a horizon. Out: each club's average difficulty over the horizon, easiest first, with its blank and double gameweeks. Errors: none. Notes: a club with no fixture in the horizon has a null average and sorts last, rather than ranking as the easiest run available.

### estimateStrength(matches, options?): StrengthModel

In: every match on record, and optional latestSeason, halfLifeSeasons, shrinkageMatches. Out: the division's baseline goals per team per match, its home advantage, and per club an attack and a defence as ratios to that baseline, with the raw counts and a `shrunk` flag. Errors: none; an empty sample yields a sensible baseline rather than NaN. Notes: only completed matches count. Seasons decay by half every `HALF_LIFE_SEASONS` (1.5), so last season outweighs one three years ago; a club under `SHRINKAGE_MATCHES` (10) is blended towards the average in proportion to how little is known.

### forecastMatch(model, homeTeamCode, awayTeamCode): MatchForecast

In: a strength model and two club codes. Out: both goal expectations, the three outcome probabilities, both clean sheet probabilities, both to score, over 2.5, the five likeliest scorelines, and a `provisional` flag. Errors: none; an unknown club is treated as exactly average and marks the forecast provisional. Notes: home advantage is split either side of the fixture (its square root each way) so the total stays on the league's scale rather than inflating with it. Every probability is read off the same independent Poisson grid `fitGoalExpectations` inverts, which is what lets a model forecast and a market price be compared directly.

### explainForecast(model, forecast): string[]

In: the model and one forecast. Out: the sentences a page prints beside the numbers: the sample size, the baseline, both clubs' ratios, a warning where a club is barely known, and the independence assumption. Errors: none.

### GLOSSARY / glossaryEntry(id)

In: an id. Out: the entry, or undefined. Errors: none. Notes: 21 entries, each with a definition, the exact operation where one applies, the source, and a caveat where the metric misleads. Ids are page anchors, so they are stable and unique, which a test enforces.

## Logic

Thresholds are read from packages/core, never redeclared here, so the published
rule stays the single source: 10 for defenders, 12 for midfielders and
forwards, non stacking, 2 points.

The squad engine takes a structural `SquadPlayer` (id, teamId, position, price, webName) rather than the full domain `Player`, so the identical code runs on the server and inside the browser bundle. That is deliberate: a builder that reimplemented the budget or the club cap would eventually disagree with the platform about whether a squad is legal, and the user would be right to trust neither.

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

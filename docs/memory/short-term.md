---
title: Short term project memory
type: memory-short
module: root
updated: 2026-08-20
status: active
---

## Status

Green as of 2026-08-20: `pnpm build`, 700 tests, lint, and format all pass. Everything below is committed on `main` **except** the estimated heatmap (four files under `apps/web/lib`, the player page, the heatmap component, `lake.ts`) and the two fixes recorded under "Fixed on 2026-08-20", which are verified and sitting uncommitted in the working tree after VS Code was killed at 100% CPU mid verify. `apps/web` is not in the root `tsconfig` references, so its only typecheck is `next build` over 1,109 pages: that is what pinned the CPU. `npx tsc --noEmit -p apps/web/tsconfig.json` is the cheap equivalent and is what was run instead.

Complete and shipped:

- The data foundation (`core`, `config`, `store`, `ingest`), the official Premier League record, weather, ground photographs, the history backfills, and the internationals pipeline.
- `packages/quant` and the Lab at `/stats`.
- `packages/model`: the panel, the duel geometry, the features, the component targets, training with ablations and a shuffled target null, and the projection composed through the published scoring rules. Documented in its own `SKILL.md` and `SPEC.md`.
- `packages/planner`: the plan as a beam search over transfer states, legal by construction, with the opening squad picker. Documented the same way. 15 tests.
- `/planner`: the goal control, the calendar rail, the pitch per gameweek, and the transfer ledger. The search runs in a Web Worker: eight gameweeks is about 2,500 states in 280 ms, measured on the real lake.
- Both team building surfaces now put the squad on a printed pitch with club shirts and a paper metric tag; the selection list uses the player photograph instead.
- `/builder` is an optimiser as well as a builder. `optimiseSquad` in `packages/planner` searches for the best legal fifteen over a chosen horizon and reports what it beat and what it cost. Verified in a real browser at 360 and 1440, light and dark, keyboard only: 42,000 squads in under half a second at eight gameweeks, 440.4 against the ranking's 424.6.
- The player page's heatmap panel no longer sits empty. `apps/web/lib/estimated-heatmap.ts` builds a role prior from the newest teamsheet that named the player (his club's last shape where none does), and `apps/web/lib/heatmap-lobes.ts` narrows it with his own last twelve played matches: shooting distance inverted from threat and expected goals, creativity in the half space on his side, defensive contribution behind him. Posterior is `(prior + floor) * (1 + sum of lobes)`, a product rather than a sum, so evidence can raise a region and never invent one. It runs in the browser and follows the gameweek ribbon. 26 tests, and the shot quality constant is pinned against `@fpl/model`'s so the copy cannot fork.

## Fixed on 2026-08-20, after a crash mid verify

- **The head coach was read from the wrong feed.** The Premier League staff endpoint carries no start date and leaves a departed manager listed, so five clubs of twenty held two rows reading "Manager" and the site printed the first: Chelsea showed Calum McFarlane, a caretaker whose spell closed on 1 June, instead of Xabi Alonso. Palace, Forest, Leeds, and Wolves were wrong the same way. `currentManager` in `packages/core/src/spells.ts` had answered this since it was written and the web never called it. `getCurrentManager` in `apps/web/lib/lake.ts` now takes the open spell and matches it to the staff row on a decomposed, alphanumeric only name (which is what joins Jakirovic to Jakirović), falling back to feed order where no spell covers the club. `/teams` had its own copy of the broken pick and now calls the same resolver; `/teams/[code]` drops a "Manager" row that is not the current one and leads with the head coach. All 20 clubs resolve by spell.
- **Three routes printed edge to edge.** `/glossary`, `/scout`, and `/builder` each had a local `.page` setting `padding-block` alone with no `.shell` wrapper, so content ran from the leftmost to the rightmost pixel at every width. All three now wrap in `shell` the way `/how-it-works` does. `/planner` sets its own 78rem measure deliberately and was left alone.

## The heatmap was drawing every player the same way

Found on 2026-08-20 from two user reports ("Saka looks like a midfielder", "Timber shows as a centre back"), and it was not a tuning problem:

- **The slot lookup never once fired.** `formationRows` holds person ids; the code looked players up by player code. Measured over 2025/26: 0 of 8,360 lineup entries matched by code, 8,360 of 8,360 by person id. So `basis` was always `position`, which is four buckets: every midfielder was drawn in the centre circle and every defender on the centre of the back line.
- **The rows run right to left.** Measured over every stored sheet: the 5,031 players the provider labels "Left something" sit at mean slot lateral 0.736, the 4,223 labelled "Right something" at 0.240. The slot is now flipped to agree with the label.
- **The provider publishes a real role vocabulary**, 54 labels over 13 lines and 3 sides, sitting unused in `lineup[].positionInfo`. The prior is now the modal label over a player's last twelve starts, and the page prints it with its count.
- **`packages/model` is unaffected.** Its duel geometry only mirrors relatively (an attacker's lateral against `1 - lateral` in the opponent's rows), so absolute handedness cancels. The teamsheet drawing is side on, where which touchline is at the top is a convention rather than a claim, so it was left alone.
- Measured after: Saka reads Left Winger 12 of 12 (the provider's claim, not a correction of it), Timber sits right sided at defensive depth, Calafiori left back, Saliba centre back, Rice central midfield, Raya on his line.

## In flight

**The one thing left mid step: the fitted models are not wired into the planner.** `/planner` and `/builder` both still project through the stated heuristic in `packages/analytics`, not through `packages/model`. `data/models/` is committed and holds six of the nine components (minutes, assistRate, cleanSheet, saveRate, cardRate, priceChange); goalRate, concededRate, and bpsRate are absent, so a rerun is still wanted before the swap. Note the notes below describe a run in which clean sheet was refused, and the artifact on disk says a later run wrote one: check the gate before trusting either. To rerun:

```sh
node --import tsx apps/cli/src/bin.ts model train --folds 4 --rounds 220 --seed 7
```

It writes `data/models/*.json`, one per component that beat its own shuffled target. It is slow: six seasons, four folds, and every fold is a full refit, so budget tens of minutes rather than minutes. Use `--dry-run` to see the scores without writing, and cut `--rounds` and `--seasons` for a quick pass.

Once `data/models/` exists, the swap is in `apps/web/lib/planner/projections.ts`: replace the base rate and minutes term with `projectRow` from `@fpl/model`, keeping the per gameweek fixture term and the blank and double handling exactly as they are.

## What the last training run found

Measured, not assumed, and worth not rediscovering:

- **Segmentation loses.** Per position fits were compared against the pooled fit with their standard errors, and pooled won on every component tested. The position one hots already carry what a separate model per position would.
- **Clean sheet and conceding are refused.** Both are club match events, so at club grain they score below zero and no artifact is written. That is the gate working, not a bug to fix.
- **Shot origin is not earned.** Ablating the inverted shot location moved the goal rate score by 0.0001. The transform is implemented and tested, and it is deliberately unused; no posterior surface is rendered from it.
- **Price change scores 0.23 Brier skill**, which is the one result that says price forecasting is worth wiring in properly rather than left as the current ownership and form heuristic.

## What the optimiser measured

Worth not rediscovering, all on the real 592 player pool:

- **Forty rounds is the ceiling.** 150 rounds over 1.57 million squads found nothing better than 40 rounds over 42,000. The answer stops moving at 440.4 (eight gameweek horizon).
- **The admissible bound is most of the speed.** Skipping a candidate whose ceiling is below the best gain so far cut evaluations from 29,402 to 5,427, answer identical, 3.85s to 0.44s.
- **The allocation free eleven evaluator is the rest.** Reusing buffers and sorting by insertion in `bestElevenValue` was another 4.6x, and it is pinned against `bestStartingEleven` by a test.
- **Per gameweek dominance keeps roughly twice the candidates** that mean dominance does and costs nothing now the bound is in place.

## The strategy code, and what it is not

`/builder` mints a code per search (`FPL1-G3-H8-B1000-R0-T1-S7-L4C91-XZC`) and runs a pasted one. It carries the question and a fingerprint of the data, never the answer, so a paste re-solves on today's prices and reports drift rather than hiding it.

There is no FPL compatibility to be had, and this was checked rather than assumed: the game publishes no import format, and changing a team is an authenticated POST to `/api/my-team/{id}/` needing the manager's own login. Automating that would mean handling their password, which is out of scope by choice.

## Three planner bugs the forecast exposed

All three were invisible until the plan was drawn week by week:

- **The plan could score below holding**, by a point, because the holding line sat in the beam and got pruned: a state that banks a transfer looks worst on exactly the discounted score the beam sorts on. It is now carried outside the beam and compared at the end, and the invariant is tested at four beam widths.
- **The plan churned.** It sold a forward in gameweek 3 and bought him back in gameweek 4, twice over. Optimal under the model, since a free transfer costs nothing and prices are flat, and unenterable in real life. Fixed with two stated rules: a minimum gain of half a point, and no buying back a player sold earlier in the horizon.
- **The value chart was a flat line** presented as a measurement, because no player's rise probability reaches the half point the price model needs. It now says so in a sentence instead.

## Blockers and open threads

- The rules page is client rendered and yields nothing. Both write paths refuse the empty document (`isUsableRulesDocument`), so the lake has no rules dataset and the API answers 404 for `/rules`. Fixing it means finding the JSON the page fetches, not loosening the guard.
- Price rise probabilities on the planner are a stated heuristic over ownership and recent scoring, because FPL publishes net transfers only for the live gameweek and the lake does not store them. Storing that column is what unblocks the fitted price model.
- Price rises never fire. `riseProbability` tops out around 0.45 and `advancePrices` moves a price only at 0.5, so no plan ever changes a squad's value. Either the threshold or the probability is wrong; storing FPL's net transfer counts is what would settle it.
- Manager coverage was widened to every club in the official record rather than the current twenty, but the coverage figure has not been re measured since that run.
- `FileStore` assumes a single writer per dataset. Concurrent syncs of the same dataset race the manifest; there is no locking.

## Related

- [Docs index](../INDEX.md): where each module's detail lives.
- [How this project works](../ARCHITECTURE.md): the end to end explanation, current as of this date.
- [Model spec](../../packages/model/SPEC.md): the fitted layer and what each failure looked like when it was wrong.
- [Planner spec](../../packages/planner/SPEC.md): the search, and why legality is a constructor rather than a filter.
- [Long term memory](long-term.md): why these choices were made, not just what exists.

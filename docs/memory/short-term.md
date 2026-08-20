---
title: Short term project memory
type: memory-short
module: root
updated: 2026-08-20
status: active
---

## Status

Everything below is committed on `main` and green: `pnpm build`, 635 tests, lint, and format all pass as of 2026-08-20.

Complete and shipped:

- The data foundation (`core`, `config`, `store`, `ingest`), the official Premier League record, weather, ground photographs, the history backfills, and the internationals pipeline.
- `packages/quant` and the Lab at `/stats`.
- `packages/model`: the panel, the duel geometry, the features, the component targets, training with ablations and a shuffled target null, and the projection composed through the published scoring rules. Documented in its own `SKILL.md` and `SPEC.md`.
- `packages/planner`: the plan as a beam search over transfer states, legal by construction, with the opening squad picker. Documented the same way. 15 tests.
- `/planner`: the goal control, the calendar rail, the pitch per gameweek, and the transfer ledger. The search runs in a Web Worker: eight gameweeks is about 2,500 states in 280 ms, measured on the real lake.
- Both team building surfaces now put the squad on a printed pitch with club shirts and a paper metric tag; the selection list uses the player photograph instead.
- `/builder` is an optimiser as well as a builder. `optimiseSquad` in `packages/planner` searches for the best legal fifteen over a chosen horizon and reports what it beat and what it cost. Verified in a real browser at 360 and 1440, light and dark, keyboard only: 42,000 squads in under half a second at eight gameweeks, 440.4 against the ranking's 424.6.

## In flight

**The one thing left mid step: the fitted models are not wired into the planner.** `/planner` and `/builder` both still project through the stated heuristic in `packages/analytics`, not through `packages/model`. The artifacts have to exist on disk first, and the run that writes them was stopped before it finished. To resume:

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

## Blockers and open threads

- The rules page is client rendered and yields nothing. Both write paths refuse the empty document (`isUsableRulesDocument`), so the lake has no rules dataset and the API answers 404 for `/rules`. Fixing it means finding the JSON the page fetches, not loosening the guard.
- Price rise probabilities on the planner are a stated heuristic over ownership and recent scoring, because FPL publishes net transfers only for the live gameweek and the lake does not store them. Storing that column is what unblocks the fitted price model.
- `/builder` searches at a risk aversion of zero and its pool therefore ships without spreads, which saves 288 KB. Adding a risk control there means putting the spreads back in `apps/web/app/builder/page.tsx`.
- Manager coverage was widened to every club in the official record rather than the current twenty, but the coverage figure has not been re measured since that run.
- `FileStore` assumes a single writer per dataset. Concurrent syncs of the same dataset race the manifest; there is no locking.

## Related

- [Docs index](../INDEX.md): where each module's detail lives.
- [How this project works](../ARCHITECTURE.md): the end to end explanation, current as of this date.
- [Model spec](../../packages/model/SPEC.md): the fitted layer and what each failure looked like when it was wrong.
- [Planner spec](../../packages/planner/SPEC.md): the search, and why legality is a constructor rather than a filter.
- [Long term memory](long-term.md): why these choices were made, not just what exists.

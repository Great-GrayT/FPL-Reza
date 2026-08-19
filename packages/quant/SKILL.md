---
title: Quant skill
type: skill
module: packages/quant
updated: 2026-08-19
status: active
---

## Purpose

Owns the statistics, the machine learning, and the columnar data engine the Lab runs on. Pure TypeScript, no I/O, no clock, no network, no dependency: it runs identically in a Node test and in a browser Web Worker, which is the whole reason it exists as a package rather than as code inside `apps/web`.

It owns, in order of how far down the stack they sit:

- **Data**: `frame.ts` (a columnar frame over typed arrays, with views instead of copies) and `expr.ts` (a parsed, interpreted expression language for derived columns and filters).
- **Description**: `internal.ts`, `describe.ts`, `special.ts` (the distribution tails every p value is read from), `dist.ts` (six laws, their fits, and goodness of fit).
- **Inference**: `corr.ts`, `regress.ts` (OLS by Householder QR, ridge, logistic by IRLS, LOESS), `hypothesis.ts` (t, Mann-Whitney, Wilcoxon, proportions, bootstrap, permutation, Benjamini-Hochberg).
- **Time**: `series.ts` (rolling, EWMA, drawdown, AR(1) half life, seasonality, change points).
- **Factors**: `factor.ts` (information coefficient, IC decay, quantile spread, turnover).
- **Decisions**: `montecarlo.ts` (seeded match, season, player, and captaincy simulation), `optimise.ts` (the squad as a portfolio, its frontier, and its risk attribution), `backtest.ts` (declarative rule replay with transfer costs and a random baseline).
- **Learning** (`ml/`): the design matrix builder with a leakage check, preprocessing fitted on training rows only, histogram gradient boosting, a random forest with out of bag error, k nearest neighbours, k means and PCA, a small network, the metric set for both tasks, walk forward validation with purge and embargo, and four model agnostic explanation methods.

Does not own: anything about football. Nothing here knows what a gameweek is. The domain lives in `packages/core`, the football specific metrics in `packages/analytics`, and the wiring between the two and this package in `apps/web/lib/quant`.

## Skills used in this section

- verify-and-stop: after touching anything in `special.ts`, `regress.ts`, `dist.ts`, or `corr.ts`, run the package tests. Every one of those modules is pinned against textbook values that R and scipy print for the same call, and a silent regression there is a wrong number on a published page.
- cavecrew-investigator: locate a statistic before adding one. Several are reachable through more than one path (a t test through `hypothesis.ts`, a t statistic through `regress.ts`), and a second implementation of the same formula is how two pages start disagreeing.

## Constraints

- **No I/O, no clock, no randomness without a seed.** Every simulation, bootstrap, permutation, and model takes a `seed` and draws from `rng.ts`. A p value that changes on refresh cannot be cited, and a shared link has to reproduce exactly what its author saw.
- **A user formula is data, never code.** `expr.ts` tokenises, parses, and interprets. Never reach for `eval` or the `Function` constructor: a formula travels in a URL, so that would let any shared link run anything in the next reader's browser.
- **Null stays null.** A missing value is NaN in a numeric column and the code -1 in a string one, and it is dropped from a statistic rather than replaced with zero. `clean` and `pairs` in `internal.ts` are the only place that decision is made, so it cannot drift per module.
- **Division by zero is missing, not infinity.** An infinite rate poisons every mean, axis, and model downstream of it.
- **A view, not a copy.** `Frame.filter` returns an index into the same buffers. Materialising is `toRows`, and that is for the rows on screen, not for a dataset.
- **Trees train on binned features.** Binning once into at most 256 buckets is what makes this trainable in a browser tab, and prediction on unseen data must use the training edges: rebinning new data moves every threshold.
- **Validation is forward only.** `walkForwardSplits` never puts a later period in a training fold, and the embargo exists because a rolling feature spans the boundary. A k fold shuffle over this panel is not a mistake to be fixed later, it is a result that means nothing.
- **A preprocessor is fitted and applied separately.** Fitting a standardiser on the whole panel and applying it to a test fold has told the model the mean of the future.
- **Sampled is labelled sampled.** `shapleyValues` is Monte Carlo over permutations, not exact, and says so in its type and its documentation.
- **Every method carries its own caveat.** `ksTest` states that fitting the parameters from the same sample makes it conservative; `partialDependence` states that it evaluates combinations that never occur where features are correlated; `simulateMatch` states that independent Poisson understates draws. A number without its caveat is the failure mode this package exists to avoid.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Quant spec](SPEC.md): full method and logic detail for everything summarised above.
- [Analytics spec](../analytics/SPEC.md): the football specific metrics that sit beside this package rather than inside it.
- [Core spec](../core/SPEC.md): the domain schemas the Lab's data is parsed against before it reaches a frame.
- [How this project works](../../docs/ARCHITECTURE.md): where the Lab sits in the platform end to end.

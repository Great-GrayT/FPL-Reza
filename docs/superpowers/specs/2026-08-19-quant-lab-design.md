---
title: The Lab, a quantitative sandbox over the lake
type: spec
module: apps/web, packages/quant
updated: 2026-08-19
status: active
---

## Purpose

Replace `/stats`, today a short narrative page of three charts, with a workspace a quantitative analyst can actually test ideas in: load the stored panel into the browser, compute over it, and see the result as a chart, a table, or a fitted model, with every configuration encoded in the URL so a finding is a link.

The constraint that shapes everything: the site is prerendered from a committed lake and the host cannot write. There is no query server to ask. So the data goes to the reader and the compute happens in their browser.

What the lake actually holds, measured on 2026-08-19:

| Dataset                                         | Rows             | Grain                      | Coverage                                                  |
| ----------------------------------------------- | ---------------- | -------------------------- | --------------------------------------------------------- |
| player-gameweeks-history                        | 253,900          | player x season x gameweek | 2016/17 to 2025/26, ten seasons                           |
| player-seasons                                  | 2,035            | player x season            | totals plus the ICT family                                |
| matches                                         | 13,546           | match                      | 35 seasons, 1992/93 onward                                |
| match-details                                   | 760              | match                      | 2024/25 and 2025/26 only: officials, teamsheets, timeline |
| players, teams, fixtures, gameweeks             | 590, 20, 380, 38 | current season             | prices, difficulty, strength, deadlines                   |
| grounds, ground-images, managers, match-weather | 20, 19, 137, 16  | context                    | joins for venue and staff                                 |

Three coverage holes are stated on screen rather than hidden, because a factor computed across them is a different factor either side of the boundary:

- The expected goals family (`expectedGoals`, `expectedAssists`, `expectedGoalsConceded`) exists only from 2022/23: 113,592 of the 253,900 rows.
- `expectedPoints` exists only from 2020/21.
- 2022/23 is stored with 37 gameweeks, not 38.
- The current season has no played gameweek rows until it starts, so the panel is historic and the live season enters through `players` and `fixtures`.

## Methods

### packages/quant

A new package. Pure TypeScript, no I/O, no clock, no network, tested with `node:test` against textbook known answers. It is the only place a statistical method is defined, and nothing in it knows what a footballer is.

#### frame.ts

A columnar frame over typed arrays. `Frame.from(rows)` infers columns; numeric columns become `Float64Array`, string columns become a dictionary plus an `Int32Array` of codes, booleans become `Uint8Array` with a null mask.

- `filter(predicate | mask)` returns a view sharing the same buffers, never a copy.
- `select(names)`, `withColumn(name, values)`, `derive(name, expression)`.
- `groupBy(keys).agg({ column: 'mean' | 'sum' | 'count' | 'median' | 'p90' })`.
- `join(other, on)` for a hash join on one key.
- `pivot(row, column, value, aggregation)`.
- `bin(column, { count | width | edges })`.
- `toRows()` only at the display boundary, and only for the rows on screen.

Null is preserved through every operation as a mask, never as zero, matching the rule the domain already keeps.

#### expr.ts

A safe expression language for derived columns and filters. Tokeniser, Pratt parser, evaluator over columns. No `eval`, no `Function` constructor: a user typed formula is data, not code.

Supports column identifiers, numeric literals, arithmetic, comparison, boolean operators, a ternary, parentheses, and a function table (`abs log ln exp sqrt min max clamp coalesce if per90 zscore rank pct_rank lag lead rolling_mean rolling_sum`). Window functions take a partition from the frame's grouping. An unknown identifier is a parse error naming the column that would have made it valid.

#### describe.ts

`describe(values)` returns count, nulls, mean, sd, variance, min, p1, p5, q1, median, q3, p95, p99, max, IQR, skewness, excess kurtosis. Plus `histogram`, `kde` (Gaussian kernel, Silverman bandwidth by default), `ecdf`, `quantile` (type 7, matching R and NumPy's default).

#### dist.ts

Normal, Poisson, Negative Binomial, Beta, Binomial, Exponential: `pdf`, `cdf`, `quantile`, `sample(rng)`, and `fit(values)` by maximum likelihood (Newton, or moment matching where a closed form exists). Goodness of fit: `ksTest`, `chiSquareTest`, `andersonDarling`. All p-values computed, none tabulated.

#### corr.ts

`pearson`, `spearman`, `kendall`, each with a confidence interval and a p-value. `correlationMatrix(frame, columns, method)`. `acf(series, lags)`, `pacf(series, lags)` by Durbin-Levinson, with the Bartlett band.

#### regress.ts

`ols(y, X, { names })` solved by Householder QR rather than by inverting the normal matrix: coefficients, standard errors, t statistics, two sided p values, R squared, adjusted R squared, F statistic, AIC, BIC, residuals, fitted values, leverage, Cook's distance, and optional heteroskedasticity consistent (HC1) standard errors.

`ridge(y, X, lambda)` with a k fold cross validated lambda path. `logistic(y, X)` by iteratively reweighted least squares, returning coefficients, standard errors, log likelihood, McFadden pseudo R squared, a confusion matrix at a chosen threshold, and the ROC curve with its AUC. `vif(X)` for collinearity. `predict(model, X)`.

#### test.ts

`tTest` (one sample, two sample, Welch, paired), `mannWhitney`, `wilcoxon`, `bootstrapCi(values, statistic, { resamples, seed })`, `permutationTest(a, b, statistic, { resamples, seed })`, `proportionTest`. Every resampling method takes a seed, because a p value that changes on refresh is not evidence.

#### series.ts

`rollingMean`, `rollingSum`, `rollingSd`, `ewma(halfLife)`, `diff`, `lag`, `cumulative`, `drawdown`, `halfLife(series)` (the AR(1) mean reversion half life), `seasonality(series, period)`, `changePoints(series)` by binary segmentation on the mean.

#### factor.ts

The quant core. Given a factor value per player per gameweek and a forward return (next gameweek points, or points over the next `h` gameweeks):

- `zscore(values, { by })` and `rankNormalise`.
- `informationCoefficient(factor, forward, { method: 'spearman' })` per gameweek, then the IC series, its mean, its standard deviation, and the information ratio.
- `icDecay(factor, forward, horizons)`: how far ahead the factor still predicts.
- `quantileSpread(factor, forward, buckets)`: mean forward return per bucket, and the top minus bottom spread with a t statistic.
- `turnover(factor, buckets)`: what share of the top bucket changes per gameweek, which is what a spread costs to actually hold.

#### montecarlo.ts

A seeded PRNG so every simulation is reproducible and shareable by seed. `simulateMatch(lambdaHome, lambdaAway, draws)`, `simulateSeason(fixtures, strengths, draws)` returning per club position distributions, `simulatePlayerPoints(profile, draws)`, `captaincyEv(candidates, draws)`. Results come back as quantile fans, not point estimates.

#### optimise.ts

The squad as a portfolio. `efficientFrontier(candidates, constraints, points)`: expected points against variance, subject to the real FPL constraints (budget in tenths, the 2/5/5/3 quota, at most three per club, fifteen players). Solved as a sequence of constrained passes over a risk aversion sweep, since the constraint set is integral and small. `riskContribution(squad)` decomposes squad variance by player. `correlationAdjusted(squad, teamCorrelation)` accounts for two players in the same club sharing a clean sheet.

#### backtest.ts

`backtest(panel, rule, options)`. A rule is a declarative object, not a callback: a universe filter, a ranking expression, a squad size, a captain rule, a transfer budget per gameweek, and a hit cost. The engine replays it gameweek by gameweek over any stored season, applying transfer costs and bench rules, and returns an equity curve, per gameweek returns, total points, the benchmark (the season's average entry score, which the gameweeks dataset stores), the tracking error, and the hit rate.

#### ml/

Machine learning over the same panel, in the same worker, with no new dependency and no training server. Tabular data, so the models that actually win on tabular data: trees and their ensembles, with linear and nearest neighbour baselines to beat.

- `ml/pipeline.ts`: imputation, standardisation, and one hot encoding, all fitted on the training split only. A transform fitted on the whole panel and applied to a test fold is the most common way a backtest lies about itself, so the fit and the apply are separate calls by construction.
- `ml/features.ts`: the design matrix builder. Lagged returns, rolling windows, per 90 rates, opponent strength, venue, position, price, ownership, rest days. Every feature is built from information available **before** the gameweek it predicts; a feature that reads its own target is refused by a check, not by a convention.
- `ml/tree.ts`: CART for regression and classification, depth and leaf size bounded, with the split search on pre binned features.
- `ml/forest.ts`: bagged trees with feature subsampling, out of bag error, and impurity importance.
- `ml/gbm.ts`: histogram gradient boosting (features binned once into 256 buckets, so a split search is a histogram scan rather than a sort), squared and logistic loss, learning rate, subsampling, and early stopping on a validation fold. This is the workhorse: 113,592 rows by twenty features trains in seconds in a worker.
- `ml/knn.ts`: k nearest neighbours over a standardised feature space, which doubles as the "players like this one" search the site can use directly.
- `ml/kmeans.ts` and `ml/pca.ts`: unsupervised. Player archetypes by k means with a silhouette score, and a PCA biplot (covariance eigenvectors by Jacobi rotation) that shows which metrics actually move together.
- `ml/mlp.ts`: a small feedforward network (one or two hidden layers, ReLU, Adam, minibatch) so a non linear baseline exists that is not a tree.
- `ml/metrics.ts`: RMSE, MAE, R squared, log loss, Brier score, AUC with the ROC curve, a calibration curve, and a confusion matrix at a chosen threshold.
- `ml/validate.ts`: walk forward validation by gameweek (expanding window, out of sample always in the future), with a purge and an embargo around the split so a rolling feature cannot leak across it. Learning curves, and a permutation null so a model's score can be compared against chance rather than against nothing.
- `ml/explain.ts`: permutation importance, partial dependence, individual conditional expectation, and sampled Shapley values (Monte Carlo over feature permutations, seeded, labelled as sampled rather than exact).

Everything is seeded, and a trained model serialises to JSON, so a model is shareable in the same way a chart is.

### apps/web

#### Data delivery

A build step copies the parquet partitions the Lab needs into `apps/web/public/lake/` and writes a manifest beside them. Nothing is transcoded: the store already writes parquet, hyparquet already parses it, and the files are 260 KB per season.

The browser loads them inside a Web Worker. The worker owns hyparquet, the frames, and every call into `packages/quant`; the main thread never parses a file and never runs a regression. Messages carry typed arrays, transferred rather than copied.

Loading is per season and on demand: opening the Lab pulls the most recent season, and the season selector pulls the rest as they are asked for.

#### Panels

Ten, sharing one selection context so a brush in one filters the others.

1. **Screener**: virtualised table over the panel, derived formula columns, stacked filters, a pivot builder, CSV export.
2. **Distributions**: histogram, KDE, box, violin, QQ, with a fitted distribution overlay and its goodness of fit.
3. **Relationships**: scatter on canvas (the full 253,900 points), a fitted line with a confidence band, correlation heatmap, scatter matrix, residual diagnostics.
4. **Factor lab**: define a factor by formula, see its IC series, IC decay, quantile spread, and turnover.
5. **Time series**: rolling and EWMA over any series, ACF and PACF, mean reversion half life, per gameweek seasonality, price change dynamics.
6. **Match model**: the `estimateStrength` model made adjustable: change half life, shrinkage, home advantage, refit live, read the scoreline grid.
7. **Monte Carlo**: seeded simulation of gameweek points, captaincy, chip timing, season tables, as quantile fans.
8. **Portfolio**: the efficient frontier of legal squads, risk contributions, and the frontier's own squads inspectable.
9. **Model lab**: pick a target (next gameweek points, a haul, a clean sheet, sixty minutes), pick features, pick a model (ridge, logistic, tree, forest, gradient boosting, k nearest neighbours, a small network), validate walk forward, and read the metrics, the learning curve, the importances, the partial dependence, the calibration, and the residuals. The fitted model then scores the current season, which turns the panel into a projection the analyst built rather than one the site handed them. Also holds the unsupervised pair: archetype clusters and the PCA biplot.
10. **Archive**: the 35 season record. Home advantage over time, goals per match, attendance, referees, era comparisons with a significance test rather than an eyeball.

#### State

A codec encodes the active panel and its configuration into a compact query string, so any view is a link. Named views persist in `localStorage` under one key with a version field. Tables export CSV, charts export SVG and PNG. A command palette opens with a keyboard chord.

## Logic

- **Compute goes to the browser because the server cannot.** The site is static and the host's filesystem is read only. A sandbox needs arbitrary queries, and arbitrary queries need either a database or the data itself. The data is 2.6 MB. So it ships.
- **Parquet rather than JSON.** The store already writes it, hyparquet already reads it, and the same file is 260 KB against roughly 2.5 MB of JSON per season. No conversion step means no second source of truth.
- **A worker, not the main thread.** A correlation matrix over 253,900 rows is tens of milliseconds; a bootstrap with 10,000 resamples is seconds. Either one on the main thread drops frames, so neither runs there.
- **Typed arrays, not objects.** 253,900 row objects with 29 fields is roughly 300 MB of heap and a garbage collection pause per operation. The same data as columns is under 30 MB and never moves.
- **Canvas above five thousand marks.** SVG is right for a 38 point ribbon and wrong for a 253,900 point scatter. The threshold is a constant, not a judgement call per chart.
- **A user formula is data, never code.** The expression language is parsed and interpreted. `eval` would be shorter and would also mean any shared link could run anything in a reader's browser.
- **Every random method takes a seed.** A p value or a fan chart that changes on refresh cannot be cited, and a shared link must reproduce exactly what its author saw.
- **Coverage is shown, not smoothed.** A factor using expected goals is computed over four seasons and says so; the same factor over ten seasons would silently mean two different things either side of 2022/23.
- **Nulls stay null.** The frame carries a mask through every operation, so "not recorded" never becomes a measured zero in a mean.
- **The narrative survives.** The current page's three charts are the Archive panel's spine, extended rather than deleted.

## Data flow

Committed parquet partitions -> the export step at build -> `apps/web/public/lake/` plus a manifest -> a fetch per season inside the worker -> hyparquet decode -> a `Frame` in typed arrays -> a `packages/quant` method -> a result message back to the main thread -> a panel renders it.

A panel's configuration -> the URL codec -> the query string -> a shared link -> the same configuration on load -> the same worker call -> the same result, since every random path is seeded.

Current season context (`players`, `teams`, `fixtures`, `gameweeks`) -> the existing server side lake readers -> serialised into the page as props -> the worker joins them onto the historic panel by player code.

## Dependencies

Internal: `@fpl/core` (the domain schemas and the season label spellings), `@fpl/analytics` (`estimateStrength`, the projection, the glossary), `@fpl/store` (the parquet the export step copies).

External: hyparquet, already a workspace dependency, now also used in the browser. Recharts, already present, for small series only. No new runtime dependency.

## Related

- [How this project works](../../ARCHITECTURE.md): updated in the same commit as this work lands.
- [Docs index](../../INDEX.md): the module map this package joins.
- [Analytics spec](../../../packages/analytics/SPEC.md): the football specific metrics the Lab computes over.
- [Core spec](../../../packages/core/SPEC.md): the schemas every stored row is parsed against.

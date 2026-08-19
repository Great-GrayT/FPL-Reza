---
title: Quant spec
type: spec
module: packages/quant
updated: 2026-08-19
status: active
---

## Purpose

The statistics, machine learning, and columnar data engine behind the Lab. Pure functions and data structures over numbers, with no I/O, no clock, no unseeded randomness, and no external dependency, so the same code runs in a `node:test` run and in a browser Web Worker.

## Methods

### Frame.fromRows(rows) / values / strings / filter / sortBy / groupBy / join / withColumn / toRows

In: row objects, or a column name, or a mask. Out: a columnar frame, a `Float64Array` in view order, labels with null preserved, a view sharing the same buffers, a grouped frame, or row objects. Errors: none; an unknown column reads as empty rather than throwing. Notes: a string column is a dictionary plus `Int32Array` codes, and `values()` returns those codes so any column can feed an axis. `filter` and `sortBy` return an index, not a copy; `withColumn` is the only operation that materialises.

### pivot(frame, rowKey, columnKey, valueColumn, aggregation)

In: a frame and three column names. Out: row labels, column labels, and a row major matrix of the aggregate. Errors: none. Notes: a cell with no rows is NaN, never 0.

### parse(source) / evaluate(node, context) / evaluateMask / compute(formula, context) / referencedColumns

In: a formula, and a context carrying the frame and optionally the partitions window functions run within. Out: an abstract syntax tree, a `Float64Array`, a 0/1 mask, or the column names a formula reads. Errors: throws `ExpressionError` carrying the character position, and an unknown column error names the closest existing column by edit distance. Notes: 27 functions, including the window set (`lag`, `lead`, `diff`, `rolling_mean`, `rolling_sum`, `rolling_max`, `ewma`, `cumsum`) which never read across a partition boundary.

### describe(values) / histogram / kde / ecdf / boxSummary / qqPoints

In: a series. Out: eighteen summary statistics, Freedman-Diaconis bins, a Gaussian kernel density at Silverman's bandwidth, the empirical distribution, a Tukey box with its outliers, or quantile-quantile points against any reference. Errors: none; an empty series yields NaN rather than throwing. Notes: quantiles are type 7, matching R and NumPy, and skewness and kurtosis are the adjusted sample versions, with kurtosis reported as excess.

### normal / poisson / negativeBinomial / binomial / exponential / beta

In: parameters. Out: a `Distribution` with `pdf`, `cdf`, `quantile`, `sample(rng)`, its mean, its variance, and its free parameters. Errors: none.

### fitNormal / fitPoisson / fitNegativeBinomial / fitExponential / fitBeta

In: a series. Out: the fitted distribution. Errors: none. Notes: the negative binomial falls back to a Poisson shaped fit when the sample is underdispersed, since the moment estimator is undefined there.

### ksTest / chiSquareTest / andersonDarling / normalityReport

In: a series and a reference cdf or distribution. Out: the statistic, its p value, and a one line verdict. Errors: none. Notes: `chiSquareTest` pools cells whose expectation is below 5 and subtracts a degree of freedom per fitted parameter. Fitting parameters from the same sample makes the KS p value conservative, which the documentation states rather than hiding.

### pearson / spearman / kendall / correlate / correlationMatrix / acf / pacf / crossCorrelation

In: two series, or a list of named series, or one series and a lag count. Out: a coefficient with its n, p value, and Fisher interval; a symmetric matrix with counts; or autocorrelations with the Bartlett band. Errors: none. Notes: every bivariate method drops a pair where either side is missing, never one side alone.

### ols(y, X, options) / predictOls / ridge / logistic / predictLogistic / vif / loess

In: a target, predictors, and options (`names`, `intercept`, `robust`, `confidenceLevel`, `lambda`, `folds`). Out: a fitted model, or null where there are fewer rows than parameters or the design is singular. Errors: none thrown; failure is null. Notes: OLS is solved by Householder QR and reports standard errors, t statistics, p values, R squared, adjusted R squared, F and its p value, AIC, BIC, leverage, Cook's distance, Durbin-Watson, and a Breusch-Pagan p value, with HC1 standard errors on request. Ridge standardises internally and cross validates lambda over a path unless one is given. Logistic is IRLS and reports McFadden's pseudo R squared.

### tTestOneSample / tTest / tTestPaired / mannWhitney / wilcoxon / proportionTest / bootstrapCi / permutationTest / falseDiscoveryRate

In: one or two samples, or counts, or a statistic function. Out: a `TestResult` with the statistic, p value, estimate, interval, and a verdict sentence; or a bootstrap or permutation result carrying its seed and its whole resampled distribution. Errors: none. Notes: `tTest` is Welch by default. A permutation p value uses the plus one correction, so it is never exactly zero.

### rollingMean / rollingSum / rollingSd / rollingMax / rollingMin / ewma / lag / lead / diff / cumulative / drawdown / halfLife / seasonality / changePoints / standardise / informationRatio

In: a series and a window, half life, or period. Out: a series of the same length with the leading positions null, or a summary. Errors: none. Notes: `ewma` takes a half life rather than an alpha, because a half life is the parameter a reader can reason about. `halfLife` fits AR(1) and reports infinity for a series that does not revert.

### informationCoefficient / icDecay / quantileSpread / turnover / zScoreByPeriod / rankNormaliseByPeriod / compareFactors / winsorise

In: factor observations, each an id, a period, a factor value, and the forward return that followed. Out: the IC series with its mean, standard deviation, information ratio, t statistic, p value, and hit rate; the decay across horizons; bucket returns with the top minus bottom spread and its t statistic; or the share of the top bucket replaced per period. Errors: none. Notes: everything is computed within a period and then summarised across periods, never pooled, because pooling lets a few high scoring gameweeks stand in for a signal.

### simulateMatch / simulateSeason / simulatePlayerPoints / captaincyEv / summariseDraws

In: goal expectations, or fixtures and strengths, or a player profile, or candidate profiles. Out: outcome probabilities and quantile fans, position distributions per club, a points distribution with threshold probabilities, or captaincy expectations with a paired win probability. Errors: none. Notes: every function takes a seed and repeats exactly on it. Candidates in `captaincyEv` are compared within the same simulated week.

### portfolioVariance / optimisePortfolio / efficientFrontier / riskContributions / diversification / candidateFrom / edgeFraction

In: candidates carrying a group, a club, a cost, an expected return, and a risk, plus a budget, a quota, and a club limit. Out: an optimal squad per risk aversion, the frontier with dominated points removed, per player variance attribution, or a concentration report. Errors: none; an infeasible constraint set returns null. Notes: two players at the same club are correlated by default, because a clean sheet is one event shared by a defence.

### backtest / compareRules / randomBaseline

In: panel rows carrying an id, a period, a group, a club, a cost, the score known before the period, and the return that followed; plus a declarative rule. Out: an equity curve, per period returns, transfers and their cost, benchmark excess, tracking error, information ratio, hit rate, drawdown, and turnover. Errors: none. Notes: the captain is chosen on the score, never on the return, and the opening squad is not counted as transfers.

### ml: datasetFrom / fitPreprocessor / oneHot / fitClipper / classWeights

In: named columns, or a fitted preprocessor and new data. Out: a column major dataset, or a transformed one. Errors: none. Notes: fit and apply are separate calls by construction, and apply matches columns by name so a reordered frame cannot silently scale the wrong feature.

### ml: binFeatures / growTree / predictRow / fitTree / fitGbm / fitForest / fitKnn / fitMlp

In: a dataset and a target. Out: a `Model` with `predict` and `importances`. Errors: none. Notes: gradient boosting supports squared and logistic loss, early stopping against a validation index, subsampling, and feature subsampling; the forest reports out of bag error and its coverage; k nearest neighbours doubles as the "rows like this one" search; the network is Adam over minibatches with He initialisation.

### ml: kmeans / clusterSweep / pca

In: a dataset and a k, a range of k, or a component count. Out: assignments with centres, inertia, and a sampled silhouette; a sweep for choosing k; or loadings, explained variance, and row scores. Errors: none. Notes: k means++ seeding, and PCA runs on the correlation matrix by Jacobi rotation, because these columns are in wildly different units.

### ml: regressionMetrics / classificationMetrics / scoreTable / rocCurve / calibrationCurve / liftByDecile / residualSummary

In: actuals and predictions. Out: the metric set for the task, a flat numeric table for a fold to compare on, or a curve. Errors: none. Notes: AUC is computed by the rank sum identity, and the classification set leads with Brier skill rather than accuracy, because accuracy on a rare event is 96 percent before a model has learned anything.

### ml: walkForwardSplits / crossValidate / learningCurve / permutationNull

In: a period column, a dataset, a target, and a fitter. Out: forward only splits with a purge count, per fold scores with their standard error, a learning curve, or a comparison against a shuffled target. Errors: none. Notes: the fitter is a function, not a fitted model, because a validation that reuses one fitted model measures nothing.

### ml: permutationImportance / partialDependence / individualExpectation / shapleyValues / interactionStrength

In: any model with a `predict`, plus a dataset. Out: importance with its spread, a dependence curve, per row curves, additive attributions, or pairwise interaction strength. Errors: none. Notes: all five are model agnostic, all take seeds, and the Shapley values are sampled, which their type and documentation both state.

### ml: buildPanelFeatures / leakageReport / forwardTarget

In: panel observations carrying an id, a period, measured values, values known before the period, and a target. Out: a dataset, a target, the period and id per row, and a count of rows dropped for thin history; or a report ranking every feature by its rank correlation with the target. Errors: none. Notes: features are built from an entity's own rows strictly before the period they describe, and `leakageReport` is the second line of defence against a column that has seen the answer.

## Logic

- **Why columnar.** The panel is 253,900 rows by 29 columns. As row objects that is roughly 300 MB of heap and a garbage collection pause per operation; as typed array columns it is under 30 MB and never moves. Every operation in a statistic, a tree, or a chart walks one column at a time, so column major is also the cache friendly layout.
- **Why views.** A stack of five filters costs five index arrays rather than five copies of the data, which is what makes a cross filtered interface feel instant.
- **Why an interpreter.** A formula travels in a URL. Parsing and interpreting it costs a few hundred lines; `eval` would cost the reader's browser.
- **Why seeds everywhere.** A shared finding has to reproduce. A bootstrap interval or a fan chart that moves on refresh is not evidence.
- **Why null is not zero.** "Not recorded" and "measured as zero" are different claims. The expected goals family does not exist before 2022/23, and averaging those seasons as zeroes would report that nobody had a shot.
- **Why binning before splitting.** A split search over sorted values is O(n log n) per feature per node; over a 256 bin histogram it is O(n + bins). That difference is what makes gradient boosting over a hundred thousand rows a few seconds in a worker rather than a minute.
- **Why one tree builder.** A regression tree is boosting with squared loss, one round, and no shrinkage; a forest is the same builder over bootstrap samples with feature subsampling. Three implementations of the same recursion would be three places for the same bug.
- **Why forward only validation.** A shuffled fold trains on gameweek 30 and tests on gameweek 12. The embargo exists because a rolling feature at the boundary contains rows from the other side of it.
- **Why the frontier removes dominated points.** A squad with less expected return and more risk than another is not a choice, it is a mistake, and putting it on a chart invites someone to pick it.
- **Why the caveats are in the code.** Every method that can mislead carries the sentence that stops it: KS is conservative on a fitted reference, partial dependence extrapolates where features are correlated, independent Poisson understates draws, sampled Shapley values have a standard error.

## Data flow

Parquet partitions decoded in a worker -> `Frame.fromRows` -> a stack of `filter` views -> `compute(formula)` for derived columns -> a statistic, a model, or a chart series -> a message back to the main thread.

A frame plus a target -> `buildPanelFeatures` -> `leakageReport` -> `walkForwardSplits` -> `crossValidate(fit)` -> per fold metrics -> `permutationImportance` and `partialDependence` for the fitted model -> the Model lab panel.

Factor values with their forward returns -> `informationCoefficient`, `quantileSpread`, `turnover` -> the Factor lab panel; the same rows as `PanelRow` -> `backtest` -> an equity curve against `randomBaseline`.

Team strengths -> `simulateSeason`, and two goal expectations -> `simulateMatch` -> quantile fans on the Match model and Monte Carlo panels.

Candidates with an expected return and a risk -> `efficientFrontier` -> the Portfolio panel, with `riskContributions` beneath it.

## Dependencies

Internal: none. This package deliberately depends on nothing, including `@fpl/core`, so it can be loaded into a Web Worker without pulling a schema library in behind it.

External: none.

## Related

- [Docs index](../../docs/INDEX.md): module map.
- [Quant skill](SKILL.md): purpose and constraints in brief.
- [Analytics spec](../analytics/SPEC.md): the football specific metrics that sit beside this package.
- [Core spec](../core/SPEC.md): the schemas the Lab's rows are parsed against before they reach a frame.
- [How this project works](../../docs/ARCHITECTURE.md): the Lab in the context of the whole platform.

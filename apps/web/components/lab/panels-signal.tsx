'use client';

/**
 * The three panels that ask whether an idea is worth anything: does this number
 * predict the next gameweek, can a model do better than the number, and would
 * either have made points after transfer costs.
 */
import { useState } from 'react';
import { useQuery } from '@/lib/quant/client';
import { STARTER_COLUMNS } from '@/lib/quant/schema';
import type { LabState } from '@/lib/quant/url-state';
import { BarChart, LineChart, formatNumber } from './charts';
import {
  Button,
  Failure,
  FormulaField,
  Loading,
  NumberField,
  Section,
  Select,
  StatGrid,
  Verdict,
} from './controls';
import type { PanelProps } from './panels-explore';
import styles from './lab.module.css';

interface FactorResult {
  ic: {
    series: { period: number; ic: number; n: number }[];
    mean: number;
    sd: number;
    informationRatio: number;
    t: number;
    pValue: number;
    hitRate: number;
    periods: number;
  };
  spread: {
    buckets: { bucket: number; meanFactor: number; meanForward: number; count: number }[];
    spread: number;
    t: number;
    pValue: number;
    monotonicity: number;
    periods: number;
  };
  turnover: { turnover: number; averageHoldingPeriods: number };
  decay: { horizon: number; ic: number; informationRatio: number }[];
  coverage: number;
}

const FACTOR_PRESETS = [
  { label: 'Six week form', formula: 'rolling_mean(totalPoints, 6)' },
  {
    label: 'Expected involvement per 90',
    formula: 'per90(expectedGoals + expectedAssists, minutes)',
  },
  { label: 'Points per million', formula: 'totalPoints / (price / 10)' },
  { label: 'BPS momentum', formula: 'rolling_mean(bps, 4) - rolling_mean(bps, 12)' },
  { label: 'Minutes security', formula: 'rolling_mean(minutes, 6)' },
  { label: 'Contrarian ownership', formula: '0 - selectedBy' },
];

export function FactorPanel({ state, update, scope, scopeKey }: PanelProps): React.ReactElement {
  const factor = useQuery<FactorResult>(
    {
      kind: 'factor',
      scope,
      formula: state.factor,
      label: state.factor,
      horizon: state.horizon,
      buckets: state.buckets,
    },
    `${scopeKey}|factor|${state.factor}|${state.horizon}|${state.buckets}`,
  );

  // Bound once so the guarded blocks below keep their narrowing: reading
  // factor.data inside a callback loses it and the type stops helping.
  const result = factor.data;
  const strong = (result?.ic.mean ?? 0) > 0.03 && (result?.ic.pValue ?? 1) < 0.05;

  return (
    <>
      <Section
        title="Does this number predict the next gameweek"
        description="Write a formula, and it is ranked within every gameweek and compared against what each player scored afterwards. That rank correlation, gameweek by gameweek, is the information coefficient."
        aside={
          <div className={styles.inlineControls}>
            <NumberField
              label="Horizon"
              value={state.horizon}
              min={1}
              max={10}
              onChange={(value) => {
                update({ horizon: Math.round(value) });
              }}
              hint="Gameweeks ahead"
            />
            <NumberField
              label="Buckets"
              value={state.buckets}
              min={2}
              max={10}
              onChange={(value) => {
                update({ buckets: Math.round(value) });
              }}
            />
          </div>
        }
      >
        <FormulaField
          label="Factor"
          value={state.factor}
          onChange={(value) => {
            update({ factor: value });
          }}
          hint="Window functions run inside one player's season: lag, rolling_mean, ewma, cumsum."
          {...(factor.error === null ? {} : { error: factor.error })}
        />
        <div className={styles.presetRow}>
          {FACTOR_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              onClick={() => {
                update({ factor: preset.formula });
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        {factor.error !== null ? <Failure message={factor.error} /> : null}
        {factor.data === null ? (
          <Loading label="Ranking and scoring…" />
        ) : (
          <>
            <StatGrid
              stats={[
                {
                  label: 'Mean IC',
                  value: formatNumber(factor.data.ic.mean, 4),
                  tone: strong ? 'good' : 'plain',
                },
                {
                  label: 'Information ratio',
                  value: formatNumber(factor.data.ic.informationRatio, 3),
                },
                {
                  label: 'p value',
                  value:
                    factor.data.ic.pValue < 0.001
                      ? 'below 0.001'
                      : formatNumber(factor.data.ic.pValue, 3),
                },
                { label: 'Gameweeks', value: factor.data.ic.periods.toLocaleString('en-GB') },
                { label: 'Sign held', value: `${formatNumber(factor.data.ic.hitRate * 100, 0)}%` },
                { label: 'Observations', value: factor.data.coverage.toLocaleString('en-GB') },
              ]}
            />
            <LineChart
              series={[
                {
                  name: 'IC per gameweek',
                  points: factor.data.ic.series.map((point) => ({ x: point.period, y: point.ic })),
                },
              ]}
              xLabel="period"
              yLabel="rank correlation"
              zero
            />
            <Verdict tone={strong ? 'good' : 'warn'}>
              {strong
                ? `A mean information coefficient of ${formatNumber(factor.data.ic.mean, 4)} across ${factor.data.ic.periods} gameweeks, with the sign holding in ${formatNumber(factor.data.ic.hitRate * 100, 0)} percent of them. In this game an IC around 0.05 is a real edge: it is a rank correlation across a whole cross section, not a hit rate.`
                : `A mean information coefficient of ${formatNumber(factor.data.ic.mean, 4)} is not distinguishable from nothing at this sample. The factor may still be useful as one input among several, but on its own it does not order next week.`}
            </Verdict>
          </>
        )}
      </Section>

      {result === null ? null : (
        <>
          <Section
            title="What each bucket returned"
            description="Players sorted into buckets by the factor within each gameweek, then the points they actually scored afterwards. A monotone staircase is what a real signal looks like."
          >
            <BarChart
              bars={result.spread.buckets.map((bucket) => ({
                label: `Bucket ${bucket.bucket + 1}`,
                value: bucket.meanForward,
                emphasis: bucket.bucket === result.spread.buckets.length - 1,
              }))}
              unit=" pts"
            />
            <StatGrid
              stats={[
                { label: 'Top minus bottom', value: formatNumber(result.spread.spread, 3) },
                { label: 't statistic', value: formatNumber(result.spread.t, 2) },
                {
                  label: 'p value',
                  value:
                    result.spread.pValue < 0.001
                      ? 'below 0.001'
                      : formatNumber(result.spread.pValue, 3),
                },
                { label: 'Monotone', value: formatNumber(result.spread.monotonicity, 2) },
                { label: 'Turnover', value: `${formatNumber(result.turnover.turnover * 100, 0)}%` },
                {
                  label: 'Held for',
                  value: `${formatNumber(result.turnover.averageHoldingPeriods, 1)} weeks`,
                  tone: result.turnover.averageHoldingPeriods < 2 ? 'warn' : 'plain',
                },
              ]}
            />
            <Verdict tone={result.turnover.averageHoldingPeriods < 2 ? 'warn' : 'good'}>
              The top bucket turns over {formatNumber(result.turnover.turnover * 100, 0)} percent
              per gameweek, which is a member held for about{' '}
              {formatNumber(result.turnover.averageHoldingPeriods, 1)} weeks.
              {result.turnover.averageHoldingPeriods < 2
                ? ' At a four point transfer hit, a spread this expensive to hold is not a strategy: it is a table.'
                : ' That is cheap enough to hold within the free transfer a week gives you.'}
            </Verdict>
          </Section>

          <Section
            title="How far ahead it survives"
            description="The same factor scored against returns one, two, three, and six gameweeks out."
          >
            <LineChart
              series={[
                {
                  name: 'Mean IC by horizon',
                  points: result.decay.map((point) => ({ x: point.horizon, y: point.ic })),
                },
              ]}
              xLabel="gameweeks ahead"
              yLabel="mean IC"
              zero
            />
            <Verdict>
              A signal that decays to nothing by the third gameweek is a captaincy signal, not a
              transfer signal: a transfer has to earn its cost over the whole time you hold the
              player.
            </Verdict>
          </Section>
        </>
      )}
    </>
  );
}

interface ModelResult {
  error?: string;
  validation: {
    folds: { period: number; score: number }[];
    mean: number;
    sd: number;
    standardError: number;
    metric: string;
  };
  /** Folds actually run, and how many the period axis could produce. */
  foldCount: number;
  foldsAvailable: number;
  metrics: {
    rmse?: number;
    mae?: number;
    rSquared?: number;
    rankCorrelation?: number;
    auc?: number;
  };
  leakage: { name: string; correlation: number; suspicious: boolean; reason: string }[];
  gainImportances: { name: string; importance: number }[] | null;
  permutation: { name: string; importance: number; sd: number }[];
  dependence: { value: number; prediction: number; sd: number }[];
  calibration: { from: number; to: number; predicted: number; observed: number; count: number }[];
  folds: { period: number; score: number; trainRows: number; testRows: number }[];
}

const FEATURE_PRESETS: Record<string, string[]> = {
  form: [
    'rolling_mean(totalPoints, 6)',
    'rolling_mean(minutes, 6)',
    'lag(totalPoints, 1)',
    'price',
    'selectedBy',
  ],
  underlying: [
    'rolling_mean(expectedGoals, 6)',
    'rolling_mean(expectedAssists, 6)',
    'rolling_mean(bps, 6)',
    'rolling_mean(minutes, 6)',
    'price',
  ],
  everything: [
    'rolling_mean(totalPoints, 6)',
    'rolling_mean(minutes, 6)',
    'rolling_sum(goals, 6)',
    'rolling_sum(assists, 6)',
    'rolling_mean(bps, 6)',
    'lag(totalPoints, 1)',
    'price',
    'selectedBy',
    'gameweek',
  ],
};

export function ModelPanel({ state, update, scope, scopeKey }: PanelProps): React.ReactElement {
  const [features, setFeatures] = useState(state.features.join('\n'));
  const featureList = features
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const model = useQuery<ModelResult>(
    {
      kind: 'model',
      scope,
      target: 'forward1',
      features: featureList,
      algorithm: state.algorithm,
      task: 'regression',
      seed: state.seed,
      explain: featureList[0] ?? '',
    },
    `${scopeKey}|model|${featureList.join('|')}|${state.algorithm}|${state.seed}`,
  );

  const beatsNothing = (model.data?.validation.mean ?? Number.NaN) > 0;

  return (
    <>
      <Section
        title="Fit a model to next gameweek"
        description="Features are formulas, so nothing is hidden inside the model: every input is a line you can read, change, and check. The target is the points scored in the following gameweek."
        aside={
          <div className={styles.inlineControls}>
            <Select
              label="Model"
              value={state.algorithm}
              options={[
                { value: 'gbm', label: 'Gradient boosting' },
                { value: 'forest', label: 'Random forest' },
                { value: 'ridge', label: 'Ridge regression' },
                { value: 'knn', label: 'Nearest neighbours' },
                { value: 'mlp', label: 'Small network' },
              ]}
              onChange={(value) => {
                update({ algorithm: value as LabState['algorithm'] });
              }}
            />
            <NumberField
              label="Seed"
              value={state.seed}
              min={1}
              onChange={(value) => {
                update({ seed: Math.round(value) });
              }}
              hint="Every fit repeats on it"
            />
          </div>
        }
      >
        <div className={styles.field}>
          <label className={styles.textareaLabel} htmlFor="lab-features">
            Features, one formula per line
          </label>
          <textarea
            id="lab-features"
            className={styles.textarea}
            value={features}
            rows={6}
            spellCheck={false}
            onChange={(event) => {
              setFeatures(event.target.value);
            }}
            onBlur={() => {
              update({ features: featureList });
            }}
          />
        </div>
        <div className={styles.presetRow}>
          {Object.entries(FEATURE_PRESETS).map(([name, list]) => (
            <Button
              key={name}
              onClick={() => {
                setFeatures(list.join('\n'));
                update({ features: list });
              }}
            >
              {name}
            </Button>
          ))}
          {STARTER_COLUMNS.length === 0 ? null : null}
        </div>

        {model.error !== null ? <Failure message={model.error} /> : null}
        {model.data === null ? (
          <Loading label="Fitting, fold by fold. Gradient boosting over a hundred thousand rows takes a few seconds…" />
        ) : model.data.error !== undefined ? (
          <Failure message={model.data.error} />
        ) : (
          <>
            <StatGrid
              stats={[
                {
                  label: 'Walk forward R squared',
                  value: formatNumber(model.data.validation.mean, 4),
                  tone: beatsNothing ? 'good' : 'warn',
                },
                {
                  label: 'Standard error',
                  value: formatNumber(model.data.validation.standardError, 4),
                },
                {
                  label: 'Folds',
                  value: `${model.data.foldCount} of ${model.data.foldsAvailable}`,
                },
                {
                  label: 'In sample RMSE',
                  value: formatNumber(model.data.metrics.rmse ?? Number.NaN, 3),
                },
                {
                  label: 'Rank correlation',
                  value: formatNumber(model.data.metrics.rankCorrelation ?? Number.NaN, 3),
                },
              ]}
            />
            <Verdict tone={beatsNothing ? 'good' : 'warn'}>
              Every fold trains only on gameweeks before the one it is tested on, with a one week
              embargo between them so a rolling feature cannot leak across the split.{' '}
              {beatsNothing
                ? 'The out of sample score is positive, which means the model beats predicting the average.'
                : 'The out of sample score is at or below zero, which means the model does not beat predicting the average, whatever the in sample fit says.'}
            </Verdict>

            <LineChart
              series={[
                {
                  name: 'Out of sample score by fold',
                  points: model.data.folds.map((fold) => ({ x: fold.period, y: fold.score })),
                },
              ]}
              xLabel="period tested"
              yLabel={model.data.validation.metric}
              zero
            />
          </>
        )}
      </Section>

      {model.data === null || model.data.error !== undefined ? null : (
        <>
          <Section
            title="What the model is using"
            description="Permutation importance: each feature is shuffled and the model rescored. Unlike a tree's own split counts, it is measured on the metric you care about."
          >
            <BarChart
              bars={model.data.permutation.slice(0, 10).map((entry) => ({
                label: entry.name.length > 26 ? `${entry.name.slice(0, 24)}…` : entry.name,
                value: entry.importance,
              }))}
            />
            {model.data.leakage.some((entry) => entry.suspicious) ? (
              <Verdict tone="warn">
                Leakage check: {model.data.leakage.find((entry) => entry.suspicious)?.name}{' '}
                correlates with the target far above what any honest predictor reaches here. Remove
                it before believing any of these numbers.
              </Verdict>
            ) : (
              <Verdict tone="good">
                Leakage check passed: no feature correlates with the target above the threshold a
                genuine predictor occupies on this panel.
              </Verdict>
            )}
          </Section>

          <Section
            title="What it does with the first feature"
            description="Partial dependence: the feature is held at each value for every row, and the predictions averaged."
          >
            <LineChart
              series={[
                {
                  name: 'Predicted points',
                  points: model.data.dependence.map((point) => ({
                    x: point.value,
                    y: point.prediction,
                  })),
                },
              ]}
              xLabel={state.features[0] ?? 'feature'}
              yLabel="prediction"
            />
            <Verdict>
              Where two features move together, this curve evaluates combinations that never occur,
              so its ends are the least reliable part of it.
            </Verdict>
          </Section>
        </>
      )}
    </>
  );
}

interface BacktestResult {
  total: number;
  perPeriod: { mean: number; sd: number };
  transfers: number;
  transferCost: number;
  maxDrawdown: number;
  turnover: number;
  periods: {
    period: number;
    net: number;
    cumulative: number;
    transfers: number;
    captain: string | null;
  }[];
  baseline: { mean: number; sd: number; runs: number };
  bestPeriod: { period: number; net: number } | null;
  worstPeriod: { period: number; net: number } | null;
}

export function BacktestPanel({ state, update, scope, scopeKey }: PanelProps): React.ReactElement {
  const [squadSize, setSquadSize] = useState(11);
  const [freeTransfers, setFreeTransfers] = useState(1);
  const [transferCost, setTransferCost] = useState(4);

  const backtest = useQuery<BacktestResult>(
    {
      kind: 'backtest',
      scope,
      formula: state.factor,
      squadSize,
      freeTransfers,
      transferCost,
      captainMultiplier: 2,
      seed: state.seed,
    },
    `${scopeKey}|backtest|${state.factor}|${squadSize}|${freeTransfers}|${transferCost}`,
  );

  const edge = (backtest.data?.total ?? 0) - (backtest.data?.baseline.mean ?? 0);
  const spread = backtest.data?.baseline.sd ?? 0;
  const z = spread > 0 ? edge / spread : Number.NaN;

  return (
    <Section
      title="Would it have worked"
      description="The factor replayed gameweek by gameweek: hold the top ranked players, captain the highest ranked of them, pay for every transfer beyond the free one."
      aside={
        <div className={styles.inlineControls}>
          <NumberField
            label="Squad"
            value={squadSize}
            min={1}
            max={15}
            onChange={(value) => {
              setSquadSize(Math.round(value));
            }}
          />
          <NumberField
            label="Free transfers"
            value={freeTransfers}
            min={0}
            max={5}
            onChange={(value) => {
              setFreeTransfers(Math.round(value));
            }}
          />
          <NumberField
            label="Hit"
            value={transferCost}
            min={0}
            max={12}
            onChange={(value) => {
              setTransferCost(Math.round(value));
            }}
          />
        </div>
      }
    >
      <FormulaField
        label="Ranking formula"
        value={state.factor}
        onChange={(value) => {
          update({ factor: value });
        }}
        hint="Use lagged or rolling terms only. A formula reading this gameweek's points would be picking with hindsight."
      />

      {backtest.error !== null ? <Failure message={backtest.error} /> : null}
      {backtest.data === null ? (
        <Loading label="Replaying every gameweek in scope…" />
      ) : (
        <>
          <StatGrid
            stats={[
              {
                label: 'Total points',
                value: formatNumber(backtest.data.total, 0),
                tone: z > 2 ? 'good' : 'plain',
              },
              { label: 'Per gameweek', value: formatNumber(backtest.data.perPeriod.mean, 2) },
              { label: 'Transfers', value: backtest.data.transfers.toLocaleString('en-GB') },
              { label: 'Paid in hits', value: formatNumber(backtest.data.transferCost, 0) },
              { label: 'Worst run', value: formatNumber(backtest.data.maxDrawdown, 0) },
              { label: 'Random baseline', value: formatNumber(backtest.data.baseline.mean, 0) },
            ]}
          />
          <LineChart
            series={[
              {
                name: 'Cumulative points',
                points: backtest.data.periods.map((period) => ({
                  x: period.period,
                  y: period.cumulative,
                })),
              },
            ]}
            xLabel="period"
            yLabel="points"
          />
          <Verdict tone={z > 2 ? 'good' : 'warn'}>
            {Number.isFinite(z)
              ? `The rule scored ${formatNumber(backtest.data.total, 0)} against a random baseline of ${formatNumber(backtest.data.baseline.mean, 0)} over the same universe, ${formatNumber(z, 1)} standard deviations above it across ${backtest.data.baseline.runs} shuffles.`
              : 'The baseline produced no spread, so there is nothing to compare against.'}{' '}
            {z > 2
              ? 'That is an edge over picking at random, which is the only comparison that means anything.'
              : 'Beating the average manager while failing to beat a coin flip over the same universe is not a finding.'}
          </Verdict>
        </>
      )}
    </Section>
  );
}

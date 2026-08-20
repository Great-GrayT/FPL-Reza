'use client';

/**
 * The four panels a session usually starts in: look at the rows, look at one
 * column's shape, look at two columns together, look at one column over time.
 */
import { useMemo, useState } from 'react';
import { useAction, useQuery } from '@/lib/quant/client';
import type { Scope } from '@/lib/quant/protocol';
import { COLUMNS_BY_NAME, LABEL_COLUMNS, NUMERIC_COLUMNS, PANEL_COLUMNS } from '@/lib/quant/schema';
import type { LabState } from '@/lib/quant/url-state';
import { Histogram, LineChart, Matrix, Scatter, formatNumber } from './charts';
import { Button, Failure, Loading, Section, Select, StatGrid, Verdict } from './controls';
import styles from './lab.module.css';

export interface PanelProps {
  state: LabState;
  update: (patch: Partial<LabState>) => void;
  scope: Scope;
  scopeKey: string;
}

const NUMERIC_OPTIONS = NUMERIC_COLUMNS.map((column) => ({
  value: column.name,
  label: column.label,
}));
const LABEL_OPTIONS = LABEL_COLUMNS.map((column) => ({ value: column.name, label: column.label }));

function coverageNote(column: string): string | null {
  const from = COLUMNS_BY_NAME.get(column)?.from;
  return from === undefined
    ? null
    : `${column} is recorded from ${from.replace('-', '/')} onward, so earlier seasons contribute no rows to this.`;
}

type Cell = number | string | boolean | null;

interface TableResult {
  rows: Record<string, Cell>[];
  total: number;
}

/** Columns are chosen at runtime, so a row is read by key rather than by field. */
function cellOf(row: Record<string, Cell>, column: string): Cell {
  return row[column] ?? null;
}

export function ScreenerPanel({ state, update, scope, scopeKey }: PanelProps): React.ReactElement {
  const [offset, setOffset] = useState(0);
  const [pivotOn, setPivotOn] = useState(false);
  const { run } = useAction<{ csv: string; rows: number }>();

  const table = useQuery<TableResult>(
    {
      kind: 'table',
      scope,
      columns: state.columns,
      sort: state.sort,
      direction: 'desc',
      offset,
      limit: 40,
    },
    `${scopeKey}|table|${state.columns.join(',')}|${state.sort}|${offset}`,
  );

  const pivot = useQuery<{ rows: string[]; columns: string[]; values: number[][] }>(
    pivotOn
      ? {
          kind: 'pivot',
          scope,
          rows: 'position',
          columns: 'season',
          value: state.sort,
          aggregation: 'mean',
        }
      : null,
    `${scopeKey}|pivot|${state.sort}|${String(pivotOn)}`,
  );

  const download = (): void => {
    void run({ kind: 'export', scope, columns: state.columns, limit: 20000 }).then((result) => {
      const blob = new Blob([result.csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'fpl-lab-export.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    });
  };

  return (
    <>
      <Section
        title="Rows in scope"
        description="Every row the filter selects, sorted by whichever column you choose. A formula written in the rail becomes a column here."
        aside={
          <div className={styles.inlineControls}>
            <Button onClick={download}>Export CSV</Button>
            <Button
              onClick={() => {
                setPivotOn((current) => !current);
              }}
            >
              {pivotOn ? 'Hide crosstab' : 'Crosstab'}
            </Button>
          </div>
        }
      >
        <div className={styles.pickerRow}>
          <Select
            label="Sort by"
            value={state.sort}
            options={[
              ...NUMERIC_OPTIONS,
              ...state.columns
                .filter((column) => !COLUMNS_BY_NAME.has(column))
                .map((column) => ({ value: column, label: column })),
            ]}
            onChange={(value) => {
              update({ sort: value });
              setOffset(0);
            }}
          />
          <div className={styles.columnPicker}>
            <span className={styles.pickerLabel}>Columns</span>
            <div className={styles.chipRow}>
              {PANEL_COLUMNS.map((column) => {
                const active = state.columns.includes(column.name);
                return (
                  <button
                    key={column.name}
                    type="button"
                    className={styles.columnChip}
                    data-active={active}
                    aria-pressed={active}
                    title={column.note}
                    onClick={() => {
                      update({
                        columns: active
                          ? state.columns.filter((name) => name !== column.name)
                          : [...state.columns, column.name],
                      });
                    }}
                  >
                    {column.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {table.error !== null ? <Failure message={table.error} /> : null}
        {table.loading && table.data === null ? <Loading label="Reading rows…" /> : null}
        {table.data === null ? null : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {state.columns.map((column) => (
                      <th key={column} scope="col">
                        {COLUMNS_BY_NAME.get(column)?.label ?? column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.data.rows.map((row, index) => (
                    <tr
                      key={`${String(cellOf(row, 'name') ?? index)}-${String(cellOf(row, 'period') ?? index)}-${index}`}
                    >
                      {state.columns.map((column) => {
                        const value = cellOf(row, column);
                        const numeric = typeof value === 'number';
                        return (
                          <td key={column} className={numeric ? 'num' : undefined}>
                            {value === null
                              ? 'n/a'
                              : numeric
                                ? formatNumber(value, 2)
                                : String(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.pager}>
              <Button
                onClick={() => {
                  setOffset(Math.max(0, offset - 40));
                }}
                disabled={offset === 0}
              >
                Previous
              </Button>
              <span className="num">
                {offset + 1}–{Math.min(offset + 40, table.data.total)} of{' '}
                {table.data.total.toLocaleString('en-GB')}
              </span>
              <Button
                onClick={() => {
                  setOffset(offset + 40);
                }}
                disabled={offset + 40 >= table.data.total}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </Section>

      {pivotOn ? (
        <Section title="Crosstab" description={`Mean ${state.sort} by position and season.`}>
          {pivot.data === null ? (
            <Loading label="Building the crosstab…" />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Position</th>
                    {pivot.data.columns.map((column) => (
                      <th key={column} scope="col">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pivot.data.rows.map((row, index) => (
                    <tr key={row}>
                      <th scope="row">{row}</th>
                      {(pivot.data?.columns ?? []).map((column, columnIndex) => (
                        <td key={column} className="num">
                          {formatNumber(pivot.data?.values[index]?.[columnIndex] ?? Number.NaN, 2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ) : null}
    </>
  );
}

interface DescribeResult {
  summary: {
    count: number;
    missing: number;
    mean: number;
    sd: number;
    median: number;
    q1: number;
    q3: number;
    min: number;
    max: number;
    skewness: number;
    kurtosis: number;
    p95: number;
  };
  histogram: { from: number; to: number; count: number }[];
  density: { x: number; density: number }[];
  qq: { theoretical: number; sample: number }[];
  normal: { statistic: number; pValue: number; verdict: string };
  poisson: { lambda: number } | null;
}

export function DistributionsPanel({
  state,
  update,
  scope,
  scopeKey,
}: PanelProps): React.ReactElement {
  const describe = useQuery<DescribeResult>(
    { kind: 'describe', scope, column: state.y },
    `${scopeKey}|describe|${state.y}`,
  );

  const note = coverageNote(state.y);

  return (
    <Section
      title="One column, in full"
      description="The shape of a single measure: its summary, its histogram against a fitted normal, and whether that fit is worth anything."
      aside={
        <Select
          label="Column"
          value={state.y}
          options={NUMERIC_OPTIONS}
          onChange={(value) => {
            update({ y: value });
          }}
        />
      }
    >
      {describe.error !== null ? <Failure message={describe.error} /> : null}
      {describe.data === null ? (
        <Loading label="Summarising…" />
      ) : (
        <>
          <StatGrid
            stats={[
              { label: 'Rows', value: describe.data.summary.count.toLocaleString('en-GB') },
              {
                label: 'Missing',
                value: describe.data.summary.missing.toLocaleString('en-GB'),
                tone: describe.data.summary.missing > 0 ? 'warn' : 'plain',
              },
              { label: 'Mean', value: formatNumber(describe.data.summary.mean, 3) },
              { label: 'Median', value: formatNumber(describe.data.summary.median, 3) },
              { label: 'SD', value: formatNumber(describe.data.summary.sd, 3) },
              {
                label: 'IQR',
                value: `${formatNumber(describe.data.summary.q1, 2)} to ${formatNumber(describe.data.summary.q3, 2)}`,
              },
              { label: 'Skew', value: formatNumber(describe.data.summary.skewness, 2) },
              { label: 'Excess kurtosis', value: formatNumber(describe.data.summary.kurtosis, 2) },
            ]}
          />
          <Histogram
            bins={describe.data.histogram}
            density={describe.data.density}
            xLabel={state.y}
          />
          <Verdict tone={describe.data.normal.pValue < 0.05 ? 'warn' : 'good'}>
            Kolmogorov-Smirnov against a fitted normal: D ={' '}
            {formatNumber(describe.data.normal.statistic, 4)}, p ={' '}
            {describe.data.normal.pValue < 0.001
              ? 'below 0.001'
              : formatNumber(describe.data.normal.pValue, 3)}
            . {describe.data.normal.verdict}. Fitting the parameters from this same sample makes
            that p value conservative, so read it as evidence rather than proof.
          </Verdict>
          {describe.data.poisson === null ? null : (
            <Verdict>
              The column is integer valued, so a Poisson was fitted too: lambda ={' '}
              {formatNumber(describe.data.poisson.lambda, 3)}. A variance far above that mean is
              overdispersion, which is what a points column always shows.
            </Verdict>
          )}
          {note === null ? null : <Verdict tone="warn">{note}</Verdict>}
          {describe.data.summary.skewness > 1 ? (
            <Verdict tone="warn">
              Skew above 1 means the mean is being pulled by the right tail. Rank based methods
              (Spearman, Mann-Whitney) answer more honestly here than the ones assuming symmetry.
            </Verdict>
          ) : null}
        </>
      )}
    </Section>
  );
}

interface ScatterResult {
  points: { x: number; y: number; g: string | null }[];
  line: { x: number; y: number }[];
  stride: number;
  correlation: { r: number; n: number; pValue: number };
  model: { slope: number; intercept: number; pValue: number; rSquared: number; n: number } | null;
}

interface MatrixResult {
  columns: string[];
  values: number[][];
  counts: number[][];
}

export function RelationshipsPanel({
  state,
  update,
  scope,
  scopeKey,
}: PanelProps): React.ReactElement {
  const scatter = useQuery<ScatterResult>(
    {
      kind: 'scatter',
      scope,
      x: state.x,
      y: state.y,
      colour: state.colour,
      fit: state.fit,
      sample: 30000,
    },
    `${scopeKey}|scatter|${state.x}|${state.y}|${state.colour}|${state.fit}`,
  );

  const matrixColumns = useMemo(
    () => [
      'totalPoints',
      'minutes',
      'bps',
      'expectedGoals',
      'expectedAssists',
      'price',
      'selectedBy',
    ],
    [],
  );
  const matrix = useQuery<MatrixResult>(
    { kind: 'correlation', scope, columns: matrixColumns, method: state.method },
    `${scopeKey}|matrix|${state.method}`,
  );

  return (
    <>
      <Section
        title="Two columns together"
        description="The cloud first, then a line through it. A line drawn before looking at the cloud is how a relationship that is not linear gets reported as one."
        aside={
          <div className={styles.inlineControls}>
            <Select
              label="X"
              value={state.x}
              options={NUMERIC_OPTIONS}
              onChange={(value) => {
                update({ x: value });
              }}
            />
            <Select
              label="Y"
              value={state.y}
              options={NUMERIC_OPTIONS}
              onChange={(value) => {
                update({ y: value });
              }}
            />
            <Select
              label="Colour"
              value={state.colour}
              options={LABEL_OPTIONS}
              onChange={(value) => {
                update({ colour: value });
              }}
            />
            <Select
              label="Fit"
              value={state.fit}
              options={[
                { value: 'ols', label: 'Straight line' },
                { value: 'loess', label: 'Local (LOESS)' },
                { value: 'none', label: 'None' },
              ]}
              onChange={(value) => {
                update({ fit: value as LabState['fit'] });
              }}
            />
          </div>
        }
      >
        {scatter.error !== null ? <Failure message={scatter.error} /> : null}
        {scatter.data === null ? (
          <Loading label="Drawing points…" />
        ) : (
          <>
            <Scatter
              points={scatter.data.points}
              line={scatter.data.line}
              xLabel={state.x}
              yLabel={state.y}
            />
            <StatGrid
              stats={[
                { label: 'Spearman', value: formatNumber(scatter.data.correlation.r, 3) },
                {
                  label: 'p value',
                  value:
                    scatter.data.correlation.pValue < 0.001
                      ? 'below 0.001'
                      : formatNumber(scatter.data.correlation.pValue, 3),
                },
                { label: 'Pairs', value: scatter.data.correlation.n.toLocaleString('en-GB') },
                {
                  label: 'R squared',
                  value: formatNumber(scatter.data.model?.rSquared ?? Number.NaN, 3),
                },
                { label: 'Slope', value: formatNumber(scatter.data.model?.slope ?? Number.NaN, 4) },
              ]}
            />
            <Verdict tone={Math.abs(scatter.data.correlation.r) > 0.3 ? 'good' : 'plain'}>
              {scatter.data.stride > 1
                ? `Every ${scatter.data.stride}th row is drawn, but the correlation and the fit use all ${scatter.data.correlation.n.toLocaleString('en-GB')} pairs. `
                : ''}
              A rank correlation of {formatNumber(scatter.data.correlation.r, 3)} over{' '}
              {scatter.data.correlation.n.toLocaleString('en-GB')} pairs
              {Math.abs(scatter.data.correlation.r) < 0.1
                ? ' is close to nothing. At this sample size almost any coefficient is significant, which is why the size matters and the p value does not.'
                : ' is worth following up, though significance here is cheap: at this sample size a tiny p value says nothing about whether the relationship is useful.'}
            </Verdict>
          </>
        )}
      </Section>

      <Section
        title="Everything against everything"
        description="A correlation matrix over the standard measures. Spearman by default, because these columns are skewed and Pearson would report the outliers."
        aside={
          <Select
            label="Method"
            value={state.method}
            options={[
              { value: 'spearman', label: 'Spearman (rank)' },
              { value: 'pearson', label: 'Pearson (linear)' },
              { value: 'kendall', label: 'Kendall (sampled)' },
            ]}
            onChange={(value) => {
              update({ method: value as LabState['method'] });
            }}
          />
        }
      >
        {matrix.data === null ? (
          <Loading label="Correlating…" />
        ) : (
          <>
            <Matrix
              columns={matrix.data.columns}
              values={matrix.data.values}
              counts={matrix.data.counts}
            />
            <Verdict>
              Red is positive, blue negative, and the depth of the colour is the size. Kendall is
              measured on the first four thousand rows, since it compares every pair and the full
              panel would be tens of billions of comparisons.
            </Verdict>
          </>
        )}
      </Section>
    </>
  );
}

interface SeriesResult {
  series: {
    name: string;
    points: { x: number | string; value: number; count: number; smoothed: number | null }[];
  }[];
}

interface AcfResult {
  points: { lag: number; value: number; partial: number; band: number }[];
  players: number;
}

export function TimePanel({ state, update, scope, scopeKey }: PanelProps): React.ReactElement {
  const [x, setX] = useState<'gameweek' | 'period' | 'season'>('gameweek');
  const [groupBy, setGroupBy] = useState('position');

  const series = useQuery<SeriesResult>(
    {
      kind: 'series',
      scope,
      x,
      y: state.y,
      aggregation: state.aggregation,
      groupBy,
      smooth: x === 'period' ? 5 : 0,
    },
    `${scopeKey}|series|${x}|${state.y}|${state.aggregation}|${groupBy}`,
  );

  const acf = useQuery<AcfResult>(
    { kind: 'autocorrelation', scope, column: state.y, lags: 10 },
    `${scopeKey}|acf|${state.y}`,
  );

  const chartSeries = useMemo(() => {
    if (series.data === null) return [];
    return series.data.series.slice(0, 4).map((entry) => ({
      name: entry.name,
      points: entry.points.map((point, index) => ({
        x: typeof point.x === 'string' ? index : point.x,
        y: point.value,
      })),
    }));
  }, [series.data]);

  const firstLag = acf.data?.points[1];
  const persists = Math.abs(firstLag?.value ?? 0) > (firstLag?.band ?? 1);

  return (
    <>
      <Section
        title="Over time"
        description="One measure aggregated per gameweek, per continuous period, or per season, split by a label."
        aside={
          <div className={styles.inlineControls}>
            <Select
              label="Axis"
              value={x}
              options={[
                { value: 'gameweek', label: 'Gameweek, 1 to 38' },
                { value: 'period', label: 'Continuous periods' },
                { value: 'season', label: 'Season' },
              ]}
              onChange={(value) => {
                setX(value as 'gameweek' | 'period' | 'season');
              }}
            />
            <Select
              label="Measure"
              value={state.y}
              options={NUMERIC_OPTIONS}
              onChange={(value) => {
                update({ y: value });
              }}
            />
            <Select
              label="Aggregate"
              value={state.aggregation}
              options={[
                { value: 'mean', label: 'Mean' },
                { value: 'median', label: 'Median' },
                { value: 'sum', label: 'Sum' },
                { value: 'p90', label: '90th percentile' },
                { value: 'sd', label: 'Standard deviation' },
                { value: 'count', label: 'Rows' },
              ]}
              onChange={(value) => {
                update({ aggregation: value as LabState['aggregation'] });
              }}
            />
            <Select
              label="Split by"
              value={groupBy}
              options={LABEL_OPTIONS}
              onChange={(value) => {
                setGroupBy(value);
              }}
            />
          </div>
        }
      >
        {series.error !== null ? <Failure message={series.error} /> : null}
        {chartSeries.length === 0 ? (
          <Loading label="Aggregating…" />
        ) : (
          <>
            <LineChart series={chartSeries} xLabel={x} yLabel={`${state.aggregation} ${state.y}`} />
            <Verdict>
              Only the first four groups are drawn, in a fixed colour order, so a series keeps its
              colour when a filter removes its neighbours.
            </Verdict>
          </>
        )}
      </Section>

      <Section
        title="Does it persist"
        description="Autocorrelation of the measure within a player's season, averaged across players. This is the number behind every argument about whether form is real."
      >
        {acf.data === null ? (
          <Loading label="Measuring persistence…" />
        ) : (
          <>
            <LineChart
              series={[
                {
                  name: 'Autocorrelation',
                  points: acf.data.points.map((point) => ({ x: point.lag, y: point.value })),
                },
                {
                  name: 'Partial',
                  points: acf.data.points.map((point) => ({ x: point.lag, y: point.partial })),
                  dashed: true,
                },
              ]}
              xLabel="lag, in gameweeks"
              yLabel="correlation"
              zero
            />
            <Verdict tone={persists ? 'good' : 'warn'}>
              At one gameweek the correlation is {formatNumber(firstLag?.value ?? Number.NaN, 3)},
              against a significance band of plus or minus{' '}
              {formatNumber(firstLag?.band ?? Number.NaN, 3)}, measured over {acf.data.players}{' '}
              player seasons.{' '}
              {persists
                ? 'Last week carries into this one, but watch how fast the line falls before betting on a streak.'
                : 'Last week carries nothing measurable into this one, which is what a run of hot form is worth.'}
            </Verdict>
          </>
        )}
      </Section>
    </>
  );
}

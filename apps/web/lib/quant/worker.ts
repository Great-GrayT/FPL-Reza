/// <reference lib="webworker" />
/**
 * The Lab's engine. Everything expensive happens here: parquet decoding, frame
 * construction, statistics, simulation, and model fitting. The main thread
 * sends a request and renders what comes back, and never touches a row.
 *
 * The rule this file exists to enforce: a correlation matrix over 253,900 rows
 * is tens of milliseconds and a bootstrap with ten thousand resamples is
 * seconds. Either one on the main thread drops frames, so neither runs there.
 */
import { parquetReadObjects } from 'hyparquet';
import {
  Frame,
  acf,
  backtest,
  boxSummary,
  captaincyEv,
  clean,
  compute,
  correlationMatrix,
  describe,
  ecdf,
  efficientFrontier,
  fitGbm,
  fitForest,
  fitKnn,
  fitMlp,
  fitNormal,
  fitPoisson,
  histogram,
  icDecay,
  informationCoefficient,
  kde,
  kmeans,
  ksTest,
  loess,
  logistic,
  mannWhitney,
  normalQuantile,
  ols,
  pacf,
  pca,
  permutationImportance,
  permutationTest,
  pivot,
  predictLogistic,
  predictOls,
  partialDependence,
  qqPoints,
  quantileSpread,
  ridge,
  riskContributions,
  rollingMean,
  simulateMatch,
  simulatePlayerPoints,
  simulateSeason,
  spearman,
  tTest,
  turnover,
  bootstrapCi,
  crossValidate,
  datasetFrom,
  leakageReport,
  mean,
  median,
  regressionMetrics,
  classificationMetrics,
  calibrationCurve,
  walkForwardSplits,
  standardDeviation,
  type Dataset,
  type Model,
  type FactorObservation,
  type PanelRow,
  type Candidate,
} from '@fpl/quant';
import { SEASONS } from './schema';
import { scopeKey, type Envelope, type Reply, type Request, type Scope } from './protocol';

type Row = Record<string, unknown>;

/** The current season rows the export step writes into context.json. */
interface ContextTeam {
  id: number;
  name: string;
  strengthAttackHome: number;
  strengthAttackAway: number;
  strengthDefenceHome: number;
  strengthDefenceAway: number;
}

interface ContextFixture {
  homeTeam: number;
  awayTeam: number;
}

interface ContextData {
  teams: ContextTeam[];
  fixtures: ContextFixture[];
}

/** One row of the official record, as the matches dataset stores it. */
interface MatchRow {
  season: string;
  homeScore: number | null;
  awayScore: number | null;
  attendance: number | null;
}

const seasonRows = new Map<string, Row[]>();
const baseFrames = new Map<string, Frame>();
const scopedFrames = new Map<string, Frame>();
let matchRows: MatchRow[] | null = null;
let contextRows: ContextData | null = null;

const GAMEWEEKS_PER_SEASON = 38;

async function fetchParquet(url: string): Promise<Row[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const buffer = await response.arrayBuffer();
  const rows = await parquetReadObjects({ file: buffer });
  return rows as Row[];
}

async function loadSeason(season: string): Promise<Row[]> {
  const cached = seasonRows.get(season);
  if (cached !== undefined) return cached;
  const rows = await fetchParquet(`/lake/history/${season}.parquet`);
  const index = SEASONS.indexOf(season);
  for (const row of rows as { gameweek?: number; period?: number }[]) {
    // A continuous period index is what lets a rolling window cross a summer
    // and a walk forward split order ten seasons in one axis.
    const gameweek = row.gameweek ?? 0;
    row.period = (index < 0 ? 0 : index) * GAMEWEEKS_PER_SEASON + gameweek;
  }
  seasonRows.set(season, rows);
  return rows;
}

async function loadContext(): Promise<ContextData> {
  if (contextRows !== null) return contextRows;
  const response = await fetch('/lake/context.json');
  if (!response.ok) throw new Error(`context answered ${response.status}`);
  contextRows = (await response.json()) as ContextData;
  return contextRows;
}

async function loadMatches(): Promise<MatchRow[]> {
  if (matchRows !== null) return matchRows;
  const response = await fetch('/lake/manifest.json');
  if (!response.ok) throw new Error(`manifest answered ${response.status}`);
  const manifest = (await response.json()) as { matches: { season: string; file: string }[] };
  const perSeason = await Promise.all(
    manifest.matches.map((entry) => fetchParquet(`/lake/${entry.file}`)),
  );
  matchRows = perSeason.flat() as unknown as MatchRow[];
  return matchRows;
}

async function baseFrame(seasons: string[]): Promise<Frame> {
  const key = [...seasons].sort().join(',');
  const cached = baseFrames.get(key);
  if (cached !== undefined) return cached;
  const perSeason = await Promise.all(seasons.map((season) => loadSeason(season)));
  const frame = Frame.fromRows(perSeason.flat());
  baseFrames.set(key, frame);
  return frame;
}

/**
 * Rows in player order within a season, which every window function and every
 * forward return depends on. Grouping by player alone would let a rolling mean
 * read across a summer, and a forward return read into a season the player
 * spent at another club.
 */
function partitionsOf(frame: Frame): number[][] {
  const codes = frame.values('playerCode');
  const seasons = frame.values('season');
  const periods = frame.values('period');
  const groups = new Map<string, number[]>();
  for (let i = 0; i < frame.length; i += 1) {
    const key = `${codes[i] ?? -1}:${seasons[i] ?? -1}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [i]);
    else bucket.push(i);
  }
  const out: number[][] = [];
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => (periods[a] ?? 0) - (periods[b] ?? 0));
    out.push(bucket);
  }
  return out;
}

async function scopedFrame(scope: Scope): Promise<Frame> {
  const key = scopeKey(scope);
  const cached = scopedFrames.get(key);
  if (cached !== undefined) return cached;

  let frame = await baseFrame(scope.seasons);
  for (const derived of scope.derived ?? []) {
    if (derived.formula.trim() === '' || derived.name.trim() === '') continue;
    const values = compute(derived.formula, { frame, partitions: partitionsOf(frame) });
    frame = frame.withColumn(derived.name, values);
  }

  const minMinutes = scope.minMinutes ?? 0;
  if (minMinutes > 0) {
    const minutes = frame.values('minutes');
    frame = frame.filter((i) => (minutes[i] ?? 0) >= minMinutes);
  }

  const filter = scope.filter?.trim() ?? '';
  if (filter !== '') {
    const mask = compute(filter, { frame, partitions: partitionsOf(frame) });
    const flags = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i += 1) {
      const value = mask[i] ?? Number.NaN;
      flags[i] = Number.isNaN(value) || value === 0 ? 0 : 1;
    }
    frame = frame.filter(flags);
  }

  // Two scopes are enough to keep a panel switch instant without holding every
  // filter a session ever produced.
  if (scopedFrames.size > 6) scopedFrames.clear();
  scopedFrames.set(key, frame);
  return frame;
}

/** Points over the next `horizon` gameweeks of the same season, per player. */
function forwardReturns(frame: Frame, horizon: number, column = 'totalPoints'): Float64Array {
  const values = frame.values(column);
  const out = new Float64Array(frame.length).fill(Number.NaN);
  for (const partition of partitionsOf(frame)) {
    partition.forEach((row, index) => {
      if (index + horizon >= partition.length + 0) {
        // Fewer rows ahead than the horizon needs: the return is unknown, not zero.
      }
      let total = 0;
      let counted = 0;
      for (let step = 1; step <= horizon; step += 1) {
        const ahead = partition[index + step];
        if (ahead === undefined) return;
        const value = values[ahead] ?? Number.NaN;
        if (Number.isNaN(value)) return;
        total += value;
        counted += 1;
      }
      if (counted === horizon) out[row] = total;
    });
  }
  return out;
}

function columnValues(frame: Frame, name: string): Float64Array {
  if (frame.has(name)) return frame.values(name);
  // Anything not stored is treated as a formula, so an axis can be an
  // expression without the interface needing a separate control for it.
  return compute(name, { frame, partitions: partitionsOf(frame) });
}

function finiteCount(values: Float64Array): number {
  let count = 0;
  for (const value of values) if (Number.isFinite(value)) count += 1;
  return count;
}

async function handle(request: Request): Promise<{ result: unknown; rows: number }> {
  switch (request.kind) {
    case 'load': {
      const frame = await baseFrame(request.seasons);
      const seasons = frame.distinct('season');
      const players = new Set(frame.values('playerCode')).size;
      return {
        rows: frame.length,
        result: {
          rows: frame.length,
          seasons,
          players,
          columns: frame.columns,
          gameweeks: new Set(frame.values('gameweek')).size,
        },
      };
    }

    case 'coverage': {
      const frame = await scopedFrame(request.scope);
      const seasons = frame.strings('season');
      const gameweeks = frame.values('gameweek');
      const counts = new Map<string, number>();
      for (let i = 0; i < frame.length; i += 1) {
        const key = `${seasons[i] ?? '?'}:${gameweeks[i] ?? 0}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const cells = [...counts.entries()].map(([key, count]) => {
        const [season, gameweek] = key.split(':');
        return { season: season ?? '', gameweek: Number(gameweek), count };
      });
      const measured = new Map<string, number>();
      for (const column of ['expectedGoals', 'expectedPoints', 'bps']) {
        measured.set(column, finiteCount(frame.values(column)));
      }
      return {
        rows: frame.length,
        result: {
          cells,
          rows: frame.length,
          players: new Set(frame.values('playerCode')).size,
          measured: Object.fromEntries(measured),
        },
      };
    }

    case 'describe': {
      const frame = await scopedFrame(request.scope);
      const values = columnValues(frame, request.column);
      const summary = describe(values);
      const fitted = fitNormal(values);
      const counts = clean(values);
      const discrete = Array.from(counts).every((value) => Number.isInteger(value));
      return {
        rows: frame.length,
        result: {
          summary,
          histogram: histogram(values, request.bins === undefined ? {} : { bins: request.bins }),
          density: summary.count > 5000 ? [] : kde(values, { points: 96 }),
          box: boxSummary(values),
          ecdf: ecdf(values).filter(
            (_, index, all) => all.length < 400 || index % Math.ceil(all.length / 400) === 0,
          ),
          qq: qqPoints(values, normalQuantile).filter(
            (_, index, all) => all.length < 400 || index % Math.ceil(all.length / 400) === 0,
          ),
          normal: ksTest(values, (x) => fitted.cdf(x)),
          poisson: discrete ? fitPoisson(values).parameters : null,
        },
      };
    }

    case 'scatter': {
      const frame = await scopedFrame(request.scope);
      const x = columnValues(frame, request.x);
      const y = columnValues(frame, request.y);
      const colour = request.colour === undefined ? null : frame.strings(request.colour);
      const limit = request.sample ?? 20000;

      const points: { x: number; y: number; g: string | null }[] = [];
      const stride = frame.length > limit ? Math.ceil(frame.length / limit) : 1;
      for (let i = 0; i < frame.length; i += stride) {
        const a = x[i] ?? Number.NaN;
        const b = y[i] ?? Number.NaN;
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        points.push({ x: a, y: b, g: colour === null ? null : (colour[i] ?? null) });
      }

      const fit = request.fit ?? 'ols';
      const line =
        fit === 'loess'
          ? loess(x, y, { span: 0.3, points: 60 })
          : fit === 'ols'
            ? (() => {
                const model = ols(y, [x], { names: [request.x] });
                if (model === null) return [];
                const finite = clean(x);
                if (finite.length === 0) return [];
                const min = Math.min(...finite);
                const max = Math.max(...finite);
                return Array.from({ length: 24 }, (_, step) => {
                  const value = min + ((max - min) * step) / 23;
                  return { x: value, y: predictOls(model, [value]) };
                });
              })()
            : [];

      const model = fit === 'ols' ? ols(y, [x], { names: [request.x] }) : null;
      return {
        rows: frame.length,
        result: {
          points,
          line,
          stride,
          correlation: spearman(x, y),
          model:
            model === null
              ? null
              : {
                  slope: model.coefficients[1]?.estimate ?? Number.NaN,
                  intercept: model.coefficients[0]?.estimate ?? Number.NaN,
                  pValue: model.coefficients[1]?.pValue ?? Number.NaN,
                  rSquared: model.rSquared,
                  n: model.n,
                },
        },
      };
    }

    case 'scatter3d': {
      const frame = await scopedFrame(request.scope);
      const x = columnValues(frame, request.x);
      const y = columnValues(frame, request.y);
      const z = columnValues(frame, request.z);
      const colour = request.colour === undefined ? null : frame.strings(request.colour);
      const names = frame.strings('name');
      const limit = request.sample ?? 6000;
      const stride = frame.length > limit ? Math.ceil(frame.length / limit) : 1;

      const points: { x: number; y: number; z: number; g: string | null; label: string }[] = [];
      for (let i = 0; i < frame.length; i += stride) {
        const a = x[i] ?? Number.NaN;
        const b = y[i] ?? Number.NaN;
        const c = z[i] ?? Number.NaN;
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
        points.push({
          x: a,
          y: b,
          z: c,
          g: colour === null ? null : (colour[i] ?? null),
          label: names[i] ?? '',
        });
      }

      return {
        rows: frame.length,
        result: {
          points,
          stride,
          axes: { x: request.x, y: request.y, z: request.z },
          correlations: {
            xy: spearman(x, y).r,
            xz: spearman(x, z).r,
            yz: spearman(y, z).r,
          },
        },
      };
    }

    case 'surface': {
      const frame = await scopedFrame(request.scope);
      const x = columnValues(frame, request.x);
      const y = columnValues(frame, request.y);
      const z = columnValues(frame, request.z);
      const bins = Math.max(4, Math.min(40, request.bins));

      const finiteX = clean(x);
      const finiteY = clean(y);
      if (finiteX.length === 0 || finiteY.length === 0) {
        return {
          rows: 0,
          result: { cells: [], bins, axes: { x: request.x, y: request.y, z: request.z } },
        };
      }
      const xMin = Math.min(...finiteX);
      const xMax = Math.max(...finiteX);
      const yMin = Math.min(...finiteY);
      const yMax = Math.max(...finiteY);

      const buckets: number[][][] = Array.from({ length: bins }, () =>
        Array.from({ length: bins }, () => [] as number[]),
      );
      for (let i = 0; i < frame.length; i += 1) {
        const a = x[i] ?? Number.NaN;
        const b = y[i] ?? Number.NaN;
        const c = z[i] ?? Number.NaN;
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
        const xi = Math.min(bins - 1, Math.floor(((a - xMin) / (xMax - xMin || 1)) * bins));
        const yi = Math.min(bins - 1, Math.floor(((b - yMin) / (yMax - yMin || 1)) * bins));
        buckets[xi]?.[yi]?.push(c);
      }

      // A cell with nothing in it stays null: a surface interpolated across a
      // hole in the data is a picture of an assumption, not of the panel.
      const cells: {
        xi: number;
        yi: number;
        x: number;
        y: number;
        value: number | null;
        count: number;
      }[] = [];
      for (let xi = 0; xi < bins; xi += 1) {
        for (let yi = 0; yi < bins; yi += 1) {
          const values = buckets[xi]?.[yi] ?? [];
          const value =
            values.length === 0
              ? null
              : request.aggregation === 'count'
                ? values.length
                : request.aggregation === 'sum'
                  ? values.reduce((total, entry) => total + entry, 0)
                  : request.aggregation === 'median'
                    ? median(values)
                    : mean(values);
          cells.push({
            xi,
            yi,
            x: xMin + ((xMax - xMin) * (xi + 0.5)) / bins,
            y: yMin + ((yMax - yMin) * (yi + 0.5)) / bins,
            value,
            count: values.length,
          });
        }
      }

      return {
        rows: frame.length,
        result: { cells, bins, axes: { x: request.x, y: request.y, z: request.z } },
      };
    }

    case 'correlation': {
      const frame = await scopedFrame(request.scope);
      // Kendall is quadratic, so it is measured on a bounded sample rather than
      // refused: a rank correlation on 4,000 rows is the same number.
      const sampled =
        request.method === 'kendall' && frame.length > 4000 ? frame.head(4000) : frame;
      const columns = request.columns.map((name) => ({
        name,
        values: columnValues(sampled, name),
      }));
      return {
        rows: sampled.length,
        result: correlationMatrix(columns, request.method),
      };
    }

    case 'regress': {
      const frame = await scopedFrame(request.scope);
      const y = columnValues(frame, request.y);
      const xs = request.xs.map((name) => columnValues(frame, name));
      if (request.model === 'logistic') {
        const model = logistic(y, xs, { names: request.xs });
        if (model === null) return { rows: frame.length, result: null };
        const probabilities = new Float64Array(frame.length);
        for (let i = 0; i < frame.length; i += 1) {
          probabilities[i] = predictLogistic(
            model,
            xs.map((column) => column[i] ?? Number.NaN),
          );
        }
        return {
          rows: frame.length,
          result: {
            kind: 'logistic',
            model,
            metrics: classificationMetrics(y, probabilities),
            calibration: calibrationCurve(y, probabilities, 10),
          },
        };
      }
      if (request.model === 'ridge') {
        return {
          rows: frame.length,
          result: { kind: 'ridge', model: ridge(y, xs, { names: request.xs }) },
        };
      }
      const model = ols(y, xs, {
        names: request.xs,
        ...(request.robust === undefined ? {} : { robust: request.robust }),
      });
      if (model === null) return { rows: frame.length, result: null };
      // Residual diagnostics are drawn from a bounded sample: the shape of ten
      // thousand points is the shape of a hundred thousand.
      const stride = model.residuals.length > 4000 ? Math.ceil(model.residuals.length / 4000) : 1;
      const residuals: { fitted: number; residual: number }[] = [];
      for (let i = 0; i < model.residuals.length; i += stride) {
        residuals.push({ fitted: model.fitted[i] ?? 0, residual: model.residuals[i] ?? 0 });
      }
      return {
        rows: frame.length,
        result: {
          kind: 'ols',
          model: { ...model, residuals: [], fitted: [], leverage: [], cooksDistance: [] },
          residuals,
        },
      };
    }

    case 'compare': {
      const frame = await scopedFrame(request.scope);
      const values = columnValues(frame, request.column);
      const groups = frame.strings(request.groupColumn);
      const left: number[] = [];
      const right: number[] = [];
      for (let i = 0; i < frame.length; i += 1) {
        const value = values[i] ?? Number.NaN;
        if (!Number.isFinite(value)) continue;
        if (groups[i] === request.left) left.push(value);
        else if (groups[i] === request.right) right.push(value);
      }

      const seed = request.seed ?? 1;
      const result =
        request.test === 'mannWhitney'
          ? mannWhitney(left, right)
          : request.test === 'student'
            ? tTest(left, right, { equalVariance: true })
            : request.test === 'permutation'
              ? null
              : request.test === 'bootstrap'
                ? null
                : tTest(left, right);

      return {
        rows: left.length + right.length,
        result: {
          test: result,
          permutation:
            request.test === 'permutation'
              ? permutationTest(left, right, undefined, { resamples: 2000, seed })
              : null,
          bootstrap:
            request.test === 'bootstrap'
              ? {
                  left: bootstrapCi(left, (sample) => mean(sample), { resamples: 1000, seed }),
                  right: bootstrapCi(right, (sample) => mean(sample), {
                    resamples: 1000,
                    seed: seed + 1,
                  }),
                }
              : null,
          left: {
            name: request.left,
            n: left.length,
            mean: mean(left),
            sd: standardDeviation(left),
            median: median(left),
          },
          right: {
            name: request.right,
            n: right.length,
            mean: mean(right),
            sd: standardDeviation(right),
            median: median(right),
          },
        },
      };
    }

    case 'series': {
      const frame = await scopedFrame(request.scope);
      const groupKeys = request.groupBy === undefined ? [request.x] : [request.x, request.groupBy];
      const grouped = frame
        .groupBy(groupKeys)
        .agg([{ column: request.y, aggregation: request.aggregation, as: 'value' }]);

      const xs = grouped.strings(request.x);
      const groups = request.groupBy === undefined ? null : grouped.strings(request.groupBy);
      const values = grouped.values('value');
      const counts = grouped.values('count');

      const bySeries = new Map<string, { x: number | string; value: number; count: number }[]>();
      for (let i = 0; i < grouped.length; i += 1) {
        const series = groups === null ? 'all' : (groups[i] ?? 'unknown');
        const bucket = bySeries.get(series) ?? [];
        const label = xs[i] ?? '';
        bucket.push({
          x: request.x === 'season' ? label : Number(label),
          value: values[i] ?? Number.NaN,
          count: counts[i] ?? 0,
        });
        bySeries.set(series, bucket);
      }

      const smooth = request.smooth ?? 0;
      const series = [...bySeries.entries()].map(([name, points]) => {
        points.sort((a, b) => {
          if (typeof a.x === 'string' || typeof b.x === 'string') {
            return String(a.x).localeCompare(String(b.x));
          }
          return a.x - b.x;
        });
        const smoothed =
          smooth > 1
            ? rollingMean(
                points.map((point) => point.value),
                smooth,
              )
            : null;
        return {
          name,
          points: points.map((point, index) => ({
            ...point,
            smoothed: smoothed === null ? null : (smoothed[index] ?? null),
          })),
        };
      });

      return { rows: frame.length, result: { series } };
    }

    case 'autocorrelation': {
      const frame = await scopedFrame(request.scope);
      const values = columnValues(frame, request.column);
      // Autocorrelation is per player: concatenating every player's series would
      // measure the joins between players rather than form.
      const partitions = partitionsOf(frame);
      const perPlayer: number[][] = [];
      for (const partition of partitions) {
        if (partition.length < 8) continue;
        perPlayer.push(partition.map((row) => values[row] ?? Number.NaN));
        if (perPlayer.length >= 400) break;
      }
      const lags = Math.max(1, Math.min(20, request.lags));
      const totals = new Float64Array(lags + 1);
      const counts = new Int32Array(lags + 1);
      const partialTotals = new Float64Array(lags + 1);
      for (const series of perPlayer) {
        acf(series, lags).forEach((point) => {
          if (!Number.isFinite(point.value)) return;
          totals[point.lag] = (totals[point.lag] ?? 0) + point.value;
          counts[point.lag] = (counts[point.lag] ?? 0) + 1;
        });
        pacf(series, lags).forEach((point) => {
          if (!Number.isFinite(point.value)) return;
          partialTotals[point.lag] = (partialTotals[point.lag] ?? 0) + point.value;
        });
      }

      const points = Array.from({ length: lags + 1 }, (_, lag) => ({
        lag,
        value: (counts[lag] ?? 0) === 0 ? Number.NaN : (totals[lag] ?? 0) / (counts[lag] ?? 1),
        partial:
          (counts[lag] ?? 0) === 0 ? Number.NaN : (partialTotals[lag] ?? 0) / (counts[lag] ?? 1),
        band: 1.96 / Math.sqrt(Math.max(1, counts[lag] ?? 1)),
      }));

      return { rows: frame.length, result: { points, players: perPlayer.length } };
    }

    case 'factor': {
      const frame = await scopedFrame(request.scope);
      const factorValues = columnValues(frame, request.formula);
      const codes = frame.values('playerCode');
      const periods = frame.values('period');

      const observationsFor = (horizon: number): FactorObservation[] => {
        const forward = forwardReturns(frame, horizon);
        const out: FactorObservation[] = [];
        for (let i = 0; i < frame.length; i += 1) {
          const factor = factorValues[i] ?? Number.NaN;
          const value = forward[i] ?? Number.NaN;
          if (!Number.isFinite(factor) || !Number.isFinite(value)) continue;
          out.push({ id: codes[i] ?? 0, period: periods[i] ?? 0, factor, forward: value });
        }
        return out;
      };

      const observations = observationsFor(request.horizon);
      const decayHorizons = request.decayHorizons ?? [1, 2, 3, 6];
      return {
        rows: observations.length,
        result: {
          ic: informationCoefficient(observations),
          spread: quantileSpread(observations, request.buckets),
          turnover: turnover(observations, request.buckets),
          decay: icDecay(
            decayHorizons.map((horizon) => ({ horizon, observations: observationsFor(horizon) })),
          ),
          label: request.label,
          coverage: observations.length,
        },
      };
    }

    case 'backtest': {
      const frame = await scopedFrame(request.scope);
      const score = columnValues(frame, request.formula);
      const points = frame.values('totalPoints');
      const price = frame.values('price');
      const periods = frame.values('period');
      const codes = frame.values('playerCode');
      const names = frame.strings('name');
      const positions = frame.strings('position');
      const clubs = frame.strings('team');

      const rows: PanelRow[] = [];
      for (let i = 0; i < frame.length; i += 1) {
        const value = score[i] ?? Number.NaN;
        if (!Number.isFinite(value)) continue;
        rows.push({
          id: codes[i] ?? 0,
          name: names[i] ?? 'unknown',
          period: periods[i] ?? 0,
          group: positions[i] ?? 'MID',
          club: clubs[i] ?? 'unknown',
          cost: price[i] ?? 0,
          actual: points[i] ?? 0,
          score: value,
        });
      }

      const rule = {
        squadSize: request.squadSize,
        freeTransfers: request.freeTransfers,
        transferCost: request.transferCost,
        captainMultiplier: request.captainMultiplier,
      };
      const result = backtest(rows, rule);
      // The random baseline is what makes a total meaningful: beating the
      // average manager but not a coin flip over the same universe is nothing.
      const baselineRows = rows.length > 60000 ? rows.slice(0, 60000) : rows;
      return {
        rows: rows.length,
        result: {
          ...result,
          periods: result.periods.map((period) => ({
            ...period,
            holdings: period.holdings.slice(0, 15),
          })),
          baseline: {
            ...(await Promise.resolve(randomBaselineOf(baselineRows, rule, request.seed ?? 1))),
          },
        },
      };
    }

    case 'portfolio': {
      const frame = await scopedFrame({ ...request.scope, seasons: [request.season] });
      const codes = frame.values('playerCode');
      const names = frame.strings('name');
      const positions = frame.strings('position');
      const clubs = frame.strings('team');
      const price = frame.values('price');
      const points = frame.values('totalPoints');

      const byPlayer = new Map<
        number,
        { name: string; group: string; club: string; cost: number; returns: number[] }
      >();
      for (let i = 0; i < frame.length; i += 1) {
        const code = codes[i] ?? 0;
        const entry = byPlayer.get(code) ?? {
          name: names[i] ?? 'unknown',
          group: positions[i] ?? 'MID',
          club: clubs[i] ?? 'unknown',
          cost: price[i] ?? 0,
          returns: [],
        };
        entry.cost = price[i] ?? entry.cost;
        entry.returns.push(points[i] ?? 0);
        byPlayer.set(code, entry);
      }

      const candidates: Candidate[] = [];
      for (const [code, entry] of byPlayer) {
        if (entry.returns.length < 10) continue;
        const expected = mean(entry.returns);
        const risk = standardDeviation(entry.returns);
        candidates.push({
          id: code,
          name: entry.name,
          group: entry.group,
          club: entry.club,
          cost: entry.cost,
          expected,
          risk: Number.isFinite(risk) ? risk : 0,
        });
      }

      const constraints = {
        budget: request.budget,
        quota: { GKP: 2, DEF: 5, MID: 5, FWD: 3 },
        maxPerClub: request.maxPerClub,
      };
      const frontier = efficientFrontier(candidates, constraints, {
        clubCorrelation: request.clubCorrelation,
      });
      return {
        rows: candidates.length,
        result: {
          frontier: frontier.map((portfolio) => ({
            ...portfolio,
            contributions: riskContributions(portfolio.players, request.clubCorrelation).slice(
              0,
              6,
            ),
          })),
          candidates: candidates.length,
        },
      };
    }

    case 'simulateMatch':
      return {
        rows: request.draws,
        result: simulateMatch(request.homeGoals, request.awayGoals, {
          draws: request.draws,
          seed: request.seed,
        }),
      };

    case 'simulatePlayer': {
      const simulations = request.profiles.map((profile) =>
        simulatePlayerPoints(profile, { draws: request.draws, seed: request.seed }),
      );
      return {
        rows: request.draws * request.profiles.length,
        result: {
          simulations,
          captaincy: captaincyEv(request.profiles, {
            draws: Math.min(request.draws, 4000),
            seed: request.seed,
          }),
        },
      };
    }

    case 'simulateSeason': {
      const context = await loadContext();
      const teams = context.teams;
      const fixtures = context.fixtures;
      const byId = new Map(teams.map((team) => [team.id, team]));
      const strengths = new Map<string, { attack: number; defence: number }>();
      for (const team of teams) {
        const attack = (team.strengthAttackHome + team.strengthAttackAway) / 2;
        const defence = (team.strengthDefenceHome + team.strengthDefenceAway) / 2;
        const name = team.name;
        // FPL publishes strength on its own 1,000 point scale; dividing by the
        // division mean puts it on the ratio scale the simulator expects.
        strengths.set(name, { attack: attack || 1000, defence: defence || 1000 });
      }
      const attackMean = mean([...strengths.values()].map((entry) => entry.attack));
      const defenceMean = mean([...strengths.values()].map((entry) => entry.defence));
      for (const [name, entry] of strengths) {
        strengths.set(name, {
          attack: entry.attack / attackMean,
          defence: entry.defence / defenceMean,
        });
      }

      const seasonFixtures = fixtures
        .map((fixture) => ({
          home: byId.get(fixture.homeTeam)?.name ?? '',
          away: byId.get(fixture.awayTeam)?.name ?? '',
        }))
        .filter((fixture) => fixture.home !== '' && fixture.away !== '');

      return {
        rows: seasonFixtures.length,
        result: simulateSeason(seasonFixtures, strengths, {
          draws: request.draws,
          seed: request.seed,
          homeAdvantage: request.homeAdvantage,
        }),
      };
    }

    case 'model': {
      const frame = await scopedFrame(request.scope);
      const target =
        request.task === 'classification'
          ? columnValues(frame, request.target)
          : forwardReturns(frame, 1);
      const targetValues = request.target === 'forward1' ? forwardReturns(frame, 1) : target;
      const featureColumns = request.features.map((name) => ({
        name,
        values: columnValues(frame, name),
      }));

      // Rows where the target or any feature is missing are dropped once, here,
      // so every downstream count refers to the same rows.
      const keep: number[] = [];
      for (let i = 0; i < frame.length; i += 1) {
        if (!Number.isFinite(targetValues[i] ?? Number.NaN)) continue;
        if (featureColumns.some((column) => !Number.isFinite(column.values[i] ?? Number.NaN)))
          continue;
        keep.push(i);
      }
      if (keep.length < 200) {
        return { rows: keep.length, result: { error: 'too few complete rows to fit a model' } };
      }

      const periods = frame.values('period');
      const dataset: Dataset = datasetFrom(
        featureColumns.map((column) => ({
          name: column.name,
          values: Float64Array.from(keep, (row) => column.values[row] ?? Number.NaN),
        })),
      );
      const y = Float64Array.from(keep, (row) => targetValues[row] ?? Number.NaN);
      const periodColumn = Int32Array.from(keep, (row) => periods[row] ?? 0);

      const seed = request.seed ?? 1;
      const fit = (data: Dataset, values: Float64Array): Model => {
        switch (request.algorithm) {
          case 'forest':
            return fitForest(data, values, { trees: 40, maxDepth: 6, seed });
          case 'knn':
            return fitKnn(data, values, { k: 20 });
          case 'mlp':
            return fitMlp(data, values, { hidden: [12, 6], epochs: 25, seed });
          case 'ridge':
          case 'logistic':
            return linearModel(data, values, request.algorithm);
          default:
            return fitGbm(data, values, {
              loss: request.task === 'classification' ? 'logistic' : 'squared',
              // 120 rounds over the full panel is nearly half a minute in a
              // worker. Eighty rounds on half the rows per round lands within a
              // couple of seconds and scores the same to three decimals.
              rounds: request.rounds ?? 80,
              learningRate: request.learningRate ?? 0.08,
              maxDepth: request.maxDepth ?? 4,
              subsample: 0.5,
              seed,
            });
        }
      };

      // A fold is a full refit, and ten seasons produce nearly eighty of them:
      // measured on the real panel that is five and a half minutes, which is not
      // a wait anybody sits through. The folds are thinned evenly across the
      // period axis instead, so the validation still spans every era.
      const allSplits = walkForwardSplits(periodColumn, {
        minimumTrainPeriods: 12,
        testPeriods: 4,
        embargoPeriods: 1,
        // A rolling window keeps the last fold from training on ten seasons,
        // which is what made the late folds the expensive ones.
        window: 'rolling',
        windowPeriods: 76,
      });
      const maxFolds = 10;
      const stride = Math.max(1, Math.ceil(allSplits.length / maxFolds));
      const splits = allSplits.filter((_, index) => index % stride === 0);
      const validation = crossValidate(dataset, y, splits, fit, { task: request.task });

      const fitted = fit(dataset, y);
      const predictions = fitted.predict(dataset);
      const metrics =
        request.task === 'classification'
          ? classificationMetrics(y, predictions)
          : regressionMetrics(y, predictions);

      const explainFeature = request.explain ?? request.features[0] ?? '';
      return {
        rows: keep.length,
        result: {
          validation,
          foldCount: splits.length,
          foldsAvailable: allSplits.length,
          metrics,
          leakage: leakageReport(dataset, y).slice(0, 6),
          gainImportances: fitted.importances(),
          permutation: permutationImportance(fitted, dataset, y, {
            repeats: 3,
            seed,
            task: request.task,
          }),
          dependence:
            explainFeature === ''
              ? []
              : partialDependence(fitted, dataset, explainFeature, {
                  points: 16,
                  sample: 1500,
                  seed,
                }),
          calibration:
            request.task === 'classification' ? calibrationCurve(y, predictions, 10) : [],
          folds: validation.folds.map((fold) => ({
            period: fold.period,
            score: fold.score,
            trainRows: fold.trainRows,
            testRows: fold.testRows,
          })),
        },
      };
    }

    case 'cluster': {
      const frame = await scopedFrame(request.scope);
      const columns = request.columns.map((name) => ({ name, values: columnValues(frame, name) }));
      const keep: number[] = [];
      for (let i = 0; i < frame.length; i += 1) {
        if (columns.some((column) => !Number.isFinite(column.values[i] ?? Number.NaN))) continue;
        keep.push(i);
        if (keep.length >= 4000) break;
      }
      const dataset = datasetFrom(
        columns.map((column) => ({
          name: column.name,
          values: Float64Array.from(keep, (row) => column.values[row] ?? Number.NaN),
        })),
      );
      const standardised = standardiseDataset(dataset);
      const clustering = kmeans(standardised, request.k, { seed: request.seed ?? 1 });
      const components = pca(standardised, 3);
      const names = frame.strings('name');
      const positions = frame.strings('position');

      return {
        rows: keep.length,
        result: {
          clustering: { ...clustering, assignments: Array.from(clustering.assignments) },
          points: keep.map((row, index) => ({
            name: names[row] ?? '',
            position: positions[row] ?? '',
            cluster: clustering.assignments[index] ?? 0,
            x: components.scores[index]?.[0] ?? 0,
            y: components.scores[index]?.[1] ?? 0,
            z: components.scores[index]?.[2] ?? 0,
          })),
          loadings: components.loadings,
          explained: components.explained,
          names: components.names,
        },
      };
    }

    case 'pivot': {
      const frame = await scopedFrame(request.scope);
      return {
        rows: frame.length,
        result: pivot(frame, request.rows, request.columns, request.value, request.aggregation),
      };
    }

    case 'table': {
      const frame = await scopedFrame(request.scope);
      const ordered =
        request.sort === undefined
          ? frame
          : frame.sortBy(request.sort, request.direction ?? 'desc');
      const offset = request.offset ?? 0;
      const limit = request.limit ?? 50;
      const page = ordered.slice(offset, offset + limit).select(request.columns);
      return { rows: frame.length, result: { rows: page.toRows(), total: frame.length } };
    }

    case 'export': {
      const frame = await scopedFrame(request.scope);
      const limit = Math.min(request.limit ?? 20000, frame.length);
      const page = frame.head(limit).select(request.columns);
      const rows = page.toRows();
      const header = request.columns.join(',');
      const body = rows
        .map((row) =>
          request.columns
            .map((column) => {
              const value = row[column];
              if (value === null) return '';
              const text = String(value);
              return text.includes(',') ? `"${text.replace(/"/g, '""')}"` : text;
            })
            .join(','),
        )
        .join('\n');
      return { rows: rows.length, result: { csv: `${header}\n${body}\n`, rows: rows.length } };
    }

    case 'archive': {
      const rows = await loadMatches();
      const bySeason = new Map<
        string,
        {
          played: number;
          goals: number;
          homeGoals: number;
          homeWins: number;
          draws: number;
          attendance: number[];
        }
      >();
      for (const row of rows) {
        const home = row.homeScore;
        const away = row.awayScore;
        if (home === null || away === null) continue;
        const season = row.season;
        const entry = bySeason.get(season) ?? {
          played: 0,
          goals: 0,
          homeGoals: 0,
          homeWins: 0,
          draws: 0,
          attendance: [],
        };
        const h = home;
        const a = away;
        entry.played += 1;
        entry.goals += h + a;
        entry.homeGoals += h;
        if (h > a) entry.homeWins += 1;
        else if (h === a) entry.draws += 1;
        const crowd = row.attendance;
        if (crowd !== null && Number.isFinite(crowd)) entry.attendance.push(crowd);
        bySeason.set(season, entry);
      }

      const seasons = [...bySeason.entries()]
        .map(([season, entry]) => ({
          season,
          played: entry.played,
          goalsPerMatch: entry.goals / entry.played,
          homeWinShare: entry.homeWins / entry.played,
          drawShare: entry.draws / entry.played,
          awayWinShare: (entry.played - entry.homeWins - entry.draws) / entry.played,
          homeGoalShare: entry.goals === 0 ? Number.NaN : entry.homeGoals / entry.goals,
          attendance: entry.attendance.length === 0 ? null : mean(entry.attendance),
        }))
        .sort((left, right) => left.season.localeCompare(right.season));

      // Two eras, tested rather than eyeballed: the split is the season the
      // crowds came back, which is the obvious candidate for a step change.
      const early = seasons
        .filter((season) => season.season < '2010/11')
        .map((season) => season.homeWinShare);
      const late = seasons
        .filter((season) => season.season >= '2010/11')
        .map((season) => season.homeWinShare);

      return {
        rows: rows.length,
        result: {
          seasons,
          homeAdvantageTest: tTest(early, late),
          homeAdvantagePermutation: permutationTest(early, late, undefined, {
            resamples: 4000,
            seed: 7,
          }),
          matches: rows.length,
        },
      };
    }

    default:
      throw new Error('unknown request');
  }
}

/** Ridge and logistic wrapped as a `Model`, so the model panel can swap them in. */
function linearModel(dataset: Dataset, target: Float64Array, kind: 'ridge' | 'logistic'): Model {
  const columns = dataset.names.map((_, j) =>
    dataset.values.subarray(j * dataset.rows, (j + 1) * dataset.rows),
  );
  if (kind === 'logistic') {
    const model = logistic(target, columns, { names: dataset.names });
    return {
      kind: 'logistic',
      predict(other: Dataset): Float64Array {
        const out = new Float64Array(other.rows);
        if (model === null) return out.fill(Number.NaN);
        for (let i = 0; i < other.rows; i += 1) {
          out[i] = predictLogistic(
            model,
            other.names.map((_, j) => other.values[j * other.rows + i] ?? Number.NaN),
          );
        }
        return out;
      },
      importances() {
        return model === null
          ? null
          : model.coefficients
              .filter((coefficient) => coefficient.name !== '(intercept)')
              .map((coefficient) => ({
                name: coefficient.name,
                importance: Math.abs(coefficient.t),
              }));
      },
    };
  }

  const model = ridge(target, columns, { names: dataset.names });
  return {
    kind: 'ridge',
    predict(other: Dataset): Float64Array {
      const out = new Float64Array(other.rows);
      if (model === null) return out.fill(Number.NaN);
      for (let i = 0; i < other.rows; i += 1) {
        let value = model.intercept;
        model.coefficients.forEach((coefficient, j) => {
          value += coefficient.estimate * (other.values[j * other.rows + i] ?? 0);
        });
        out[i] = value;
      }
      return out;
    },
    importances() {
      return model === null
        ? null
        : model.coefficients.map((coefficient) => ({
            name: coefficient.name,
            importance: Math.abs(coefficient.estimate),
          }));
    },
  };
}

function standardiseDataset(dataset: Dataset): Dataset {
  const values = Float64Array.from(dataset.values);
  for (let j = 0; j < dataset.columns; j += 1) {
    const column = values.subarray(j * dataset.rows, (j + 1) * dataset.rows);
    const finite = clean(column);
    const centre = mean(finite);
    const spread = standardDeviation(finite) || 1;
    for (let i = 0; i < column.length; i += 1) column[i] = ((column[i] ?? 0) - centre) / spread;
  }
  return { ...dataset, values };
}

/** A deterministic shuffle of the scores, which is the backtest's null. */
function randomBaselineOf(
  rows: PanelRow[],
  rule: {
    squadSize: number;
    freeTransfers: number;
    transferCost: number;
    captainMultiplier: number;
  },
  seed: number,
): { mean: number; sd: number; runs: number } {
  const totals: number[] = [];
  for (let run = 0; run < 12; run += 1) {
    let state = (seed + run * 7919) >>> 0;
    const shuffled = rows.map((row) => {
      state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + row.id) >>> 0;
      return { ...row, score: state / 4294967296 };
    });
    totals.push(backtest(shuffled, rule).total);
  }
  return { mean: mean(totals), sd: standardDeviation(totals), runs: totals.length };
}

self.addEventListener('message', (event: MessageEvent<Envelope>) => {
  const { id, request } = event.data;
  const started = performance.now();
  handle(request)
    .then(({ result, rows }) => {
      const reply: Reply = { id, ok: true, elapsed: performance.now() - started, rows, result };
      self.postMessage(reply);
    })
    .catch((error: unknown) => {
      const reply: Reply = {
        id,
        ok: false,
        elapsed: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(reply);
    });
});

/**
 * The Lab's performance audit, run against the real panel.
 *
 * The worker cannot run in Node, so this exercises exactly what it does through
 * the same code: decode the parquet, build the frame, apply a scope, and run the
 * heaviest request of each panel. The numbers it prints are the numbers a reader
 * waits for, minus the browser's own overheads.
 *
 *   node scripts/bench-lab.mjs
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parquetReadObjects } from 'hyparquet';
import {
  Frame,
  compute,
  correlationMatrix,
  crossValidate,
  datasetFrom,
  fitGbm,
  informationCoefficient,
  quantileSpread,
  walkForwardSplits,
  describe,
  ols,
  simulateMatch,
  spearman,
} from '@fpl/quant';

const LAKE = path.join(process.cwd(), 'public', 'lake');
const GAMEWEEKS = 38;

function mark() {
  const started = process.hrtime.bigint();
  return (label, extra = '') => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const heap = process.memoryUsage().heapUsed / (1024 * 1024);
    console.info(
      `${label.padEnd(42)} ${ms.toFixed(0).padStart(6)} ms   heap ${heap.toFixed(0)} MB  ${extra}`,
    );
    return ms;
  };
}

async function loadSeasons() {
  const files = (await readdir(path.join(LAKE, 'history')))
    .filter((name) => name.endsWith('.parquet'))
    .sort();
  const rows = [];
  for (const file of files) {
    const buffer = await readFile(path.join(LAKE, 'history', file));
    const decoded = await parquetReadObjects({
      file: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    });
    const index = files.indexOf(file);
    for (const row of decoded) row.period = index * GAMEWEEKS + Number(row.gameweek ?? 0);
    rows.push(...decoded);
  }
  return { rows, seasons: files.length };
}

function partitionsOf(frame) {
  const codes = frame.values('playerCode');
  const seasons = frame.values('season');
  const periods = frame.values('period');
  const groups = new Map();
  for (let i = 0; i < frame.length; i += 1) {
    const key = `${codes[i]}:${seasons[i]}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [i]);
    else bucket.push(i);
  }
  const out = [];
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => periods[a] - periods[b]);
    out.push(bucket);
  }
  return out;
}

function forwardReturns(frame, partitions, horizon) {
  const points = frame.values('totalPoints');
  const out = new Float64Array(frame.length).fill(Number.NaN);
  for (const partition of partitions) {
    for (let index = 0; index < partition.length; index += 1) {
      let total = 0;
      let counted = 0;
      for (let step = 1; step <= horizon; step += 1) {
        const ahead = partition[index + step];
        if (ahead === undefined) break;
        total += points[ahead];
        counted += 1;
      }
      if (counted === horizon) out[partition[index]] = total;
    }
  }
  return out;
}

const timings = {};

console.info('\nThe Lab, measured end to end on the real panel\n');

let stop = mark();
const { rows, seasons } = await loadSeasons();
timings.decode = stop(
  `decode ${seasons} seasons of parquet`,
  `${rows.length.toLocaleString('en-GB')} rows`,
);

stop = mark();
const frame = Frame.fromRows(rows);
timings.frame = stop('build the columnar frame', `${frame.columns.length} columns`);

stop = mark();
const partitions = partitionsOf(frame);
timings.partitions = stop(
  'partition by player and season',
  `${partitions.length.toLocaleString('en-GB')} groups`,
);

stop = mark();
const minutesColumn = frame.values('minutes');
const played = frame.filter((i) => minutesColumn[i] > 0);
timings.filter = stop(
  'filter to rows with minutes',
  `${played.length.toLocaleString('en-GB')} rows`,
);

stop = mark();
const derived = compute('rolling_mean(totalPoints, 6)', { frame, partitions });
timings.formula = stop(
  'evaluate a rolling formula',
  `${derived.length.toLocaleString('en-GB')} values`,
);

stop = mark();
describe(frame.values('totalPoints'));
timings.describe = stop('describe a column');

stop = mark();
correlationMatrix(
  ['totalPoints', 'minutes', 'bps', 'expectedGoals', 'price', 'selectedBy'].map((name) => ({
    name,
    values: frame.values(name),
  })),
  'spearman',
);
timings.correlation = stop('six by six Spearman matrix');

stop = mark();
spearman(frame.values('expectedGoals'), frame.values('totalPoints'));
ols(frame.values('totalPoints'), [frame.values('expectedGoals'), frame.values('minutes')], {
  names: ['xG', 'minutes'],
});
timings.regression = stop('correlation and a two term regression');

stop = mark();
const forward = forwardReturns(frame, partitions, 1);
const codes = frame.values('playerCode');
const periods = frame.values('period');
const observations = [];
for (let i = 0; i < frame.length; i += 1) {
  if (!Number.isFinite(derived[i]) || !Number.isFinite(forward[i])) continue;
  observations.push({ id: codes[i], period: periods[i], factor: derived[i], forward: forward[i] });
}
const ic = informationCoefficient(observations);
const spread = quantileSpread(observations, 5);
timings.factor = stop(
  'factor: forward returns, IC, and buckets',
  `IC ${ic.mean.toFixed(4)}, spread ${spread.spread.toFixed(3)}`,
);

stop = mark();
const keep = [];
for (let i = 0; i < frame.length; i += 1) {
  if (Number.isFinite(forward[i]) && Number.isFinite(derived[i])) keep.push(i);
}
const minutesRolling = compute('rolling_mean(minutes, 6)', { frame, partitions });
const priceColumn = frame.values('price');
const dataset = datasetFrom([
  { name: 'form', values: Float64Array.from(keep, (row) => derived[row]) },
  { name: 'minutes', values: Float64Array.from(keep, (row) => minutesRolling[row]) },
  { name: 'price', values: Float64Array.from(keep, (row) => priceColumn[row]) },
]);
const target = Float64Array.from(keep, (row) => forward[row]);
const periodColumn = Int32Array.from(keep, (row) => periods[row]);
timings.features = stop('build the model matrix', `${keep.length.toLocaleString('en-GB')} rows`);

stop = mark();
const model = fitGbm(dataset, target, {
  rounds: 80,
  learningRate: 0.08,
  maxDepth: 4,
  subsample: 0.5,
  seed: 1,
});
timings.gbm = stop('gradient boosting, 80 rounds', `${model.trees.length} trees`);

stop = mark();
// The same thinning the worker applies: ten folds spread across the period
// axis, on a rolling window rather than an expanding one.
const allSplits = walkForwardSplits(periodColumn, {
  minimumTrainPeriods: 12,
  testPeriods: 4,
  embargoPeriods: 1,
  window: 'rolling',
  windowPeriods: 76,
});
const stride = Math.max(1, Math.ceil(allSplits.length / 10));
const splits = allSplits.filter((_, index) => index % stride === 0);
const validation = crossValidate(dataset, target, splits, (data, values) =>
  fitGbm(data, values, { rounds: 80, learningRate: 0.08, maxDepth: 4, subsample: 0.5, seed: 1 }),
);
timings.validation = stop(
  `walk forward validation, ${splits.length} folds`,
  `mean ${validation.metric} ${validation.mean.toFixed(4)} over ${splits.length} folds`,
);

stop = mark();
simulateMatch(1.7, 1.1, { draws: 20000, seed: 1 });
timings.simulation = stop('simulate a match, 20,000 draws');

const worst = Object.entries(timings).sort((a, b) => b[1] - a[1])[0];
console.info(
  `\nSlowest step: ${worst[0]} at ${worst[1].toFixed(0)} ms. Peak heap ${(
    process.memoryUsage().heapUsed /
    (1024 * 1024)
  ).toFixed(0)} MB for ${rows.length.toLocaleString('en-GB')} rows.\n`,
);

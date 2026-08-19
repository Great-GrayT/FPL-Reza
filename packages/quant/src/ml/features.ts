/**
 * Building a design matrix from a panel, without letting the answer into the
 * question.
 *
 * Every feature here is computed from rows strictly before the period it
 * describes. That is enforced rather than documented: `buildPanelFeatures`
 * constructs each row's features from the entity's own history up to the
 * previous period, and `leakageReport` scores every finished feature against
 * the target's own period to catch a mistake anyway.
 */
import { mean, standardDeviation } from '../internal.js';
import { spearman } from '../corr.js';
import { datasetFrom, type Dataset } from './types.js';

export interface PanelObservation {
  /** The entity: a player code, a club, anything with a history. */
  id: number;
  /** The ordered period: a gameweek index across seasons, never a label. */
  period: number;
  /** Values measured in this period. */
  values: Record<string, number | null>;
  /** What is being predicted, measured in this period. */
  target: number | null;
  /** Values known before the period starts: price, fixture difficulty, venue. */
  known?: Record<string, number | null>;
}

export interface FeatureOptions {
  /** Lookback windows, in periods. */
  windows?: number[];
  /** Measures to build rolling features from. Defaults to every value column. */
  measures?: string[];
  /** Periods of history required before a row is emitted. */
  minimumHistory?: number;
  /** Include the previous period's raw values as their own features. */
  includeLast?: boolean;
  /** Include the exponentially weighted mean at these half lives. */
  halfLives?: number[];
}

export interface BuiltFeatures {
  dataset: Dataset;
  target: Float64Array;
  /** Period of each row, for a walk forward split. */
  periods: Int32Array;
  ids: Int32Array;
  /** Rows dropped for having too little history. */
  dropped: number;
}

/**
 * Turn a panel into features and a target. For each observation, the features
 * summarise that entity's own previous periods; the target is this period's
 * outcome. Nothing from this period, other than what the `known` block declares
 * as available before kick off, is ever a feature.
 */
export function buildPanelFeatures(
  observations: PanelObservation[],
  options: FeatureOptions = {},
): BuiltFeatures {
  const windows = options.windows ?? [3, 6, 12];
  const halfLives = options.halfLives ?? [3];
  const minimumHistory = options.minimumHistory ?? Math.min(...windows);
  const includeLast = options.includeLast ?? true;

  const measures =
    options.measures ??
    [...new Set(observations.flatMap((observation) => Object.keys(observation.values)))].sort();
  const knownNames = [
    ...new Set(observations.flatMap((observation) => Object.keys(observation.known ?? {}))),
  ].sort();

  const byId = new Map<number, PanelObservation[]>();
  for (const observation of observations) {
    const bucket = byId.get(observation.id) ?? [];
    bucket.push(observation);
    byId.set(observation.id, bucket);
  }
  for (const bucket of byId.values()) bucket.sort((a, b) => a.period - b.period);

  const names: string[] = [];
  for (const measure of measures) {
    for (const window of windows) names.push(`${measure}_mean_${window}`);
    for (const window of windows) names.push(`${measure}_sd_${window}`);
    for (const life of halfLives) names.push(`${measure}_ewma_${life}`);
    if (includeLast) names.push(`${measure}_last`);
  }
  names.push('history_periods', 'periods_since_last');
  for (const known of knownNames) names.push(known);

  const rows: number[][] = [];
  const targets: number[] = [];
  const periods: number[] = [];
  const ids: number[] = [];
  let dropped = 0;

  for (const [id, bucket] of byId) {
    for (let index = 0; index < bucket.length; index += 1) {
      const current = bucket[index];
      if (current === undefined) continue;
      if (current.target === null || !Number.isFinite(current.target)) {
        dropped += 1;
        continue;
      }
      const history = bucket.slice(0, index);
      if (history.length < minimumHistory) {
        dropped += 1;
        continue;
      }

      const row: number[] = [];
      for (const measure of measures) {
        const series = history
          .map((observation) => observation.values[measure] ?? null)
          .filter((value): value is number => value !== null && Number.isFinite(value));

        for (const window of windows) {
          const slice = series.slice(Math.max(0, series.length - window));
          row.push(slice.length === 0 ? Number.NaN : mean(slice));
        }
        for (const window of windows) {
          const slice = series.slice(Math.max(0, series.length - window));
          row.push(slice.length < 2 ? Number.NaN : standardDeviation(slice));
        }
        for (const life of halfLives) {
          const alpha = 1 - Math.exp(-Math.LN2 / Math.max(life, 1e-9));
          let value = Number.NaN;
          for (const observation of series) {
            value = Number.isNaN(value) ? observation : alpha * observation + (1 - alpha) * value;
          }
          row.push(value);
        }
        if (includeLast) row.push(series[series.length - 1] ?? Number.NaN);
      }

      row.push(history.length);
      const previous = history[history.length - 1];
      row.push(previous === undefined ? Number.NaN : current.period - previous.period);
      for (const known of knownNames) row.push(current.known?.[known] ?? Number.NaN);

      rows.push(row);
      targets.push(current.target);
      periods.push(current.period);
      ids.push(id);
    }
  }

  const columns = names.map((name, j) => ({
    name,
    values: Float64Array.from(rows, (row) => row[j] ?? Number.NaN),
  }));

  return {
    dataset: datasetFrom(columns),
    target: Float64Array.from(targets),
    periods: Int32Array.from(periods),
    ids: Int32Array.from(ids),
    dropped,
  };
}

export interface LeakageFinding {
  name: string;
  correlation: number;
  /** True where a feature is suspiciously close to the target itself. */
  suspicious: boolean;
  reason: string;
}

/**
 * A guard rather than a diagnostic. A feature correlating above the threshold
 * with the target is not proof of leakage, but on a panel where the best honest
 * predictor of next gameweek points correlates about 0.2, a 0.95 means a column
 * has been carried in by accident, and the model would otherwise report a
 * spectacular score for having read the answer.
 */
export function leakageReport(
  dataset: Dataset,
  target: ArrayLike<number>,
  options: { threshold?: number } = {},
): LeakageFinding[] {
  const threshold = options.threshold ?? 0.9;
  return dataset.names
    .map((name, j) => {
      const column = dataset.values.subarray(j * dataset.rows, (j + 1) * dataset.rows);
      const correlation = spearman(column, target).r;
      const suspicious = Math.abs(correlation) >= threshold;
      return {
        name,
        correlation,
        suspicious,
        reason: suspicious
          ? `rank correlation with the target is ${correlation.toFixed(3)}, which is too high to be a genuine predictor here`
          : 'within the range a real predictor occupies',
      };
    })
    .sort((left, right) => Math.abs(right.correlation) - Math.abs(left.correlation));
}

/**
 * Forward returns over a horizon, keyed the way `buildPanelFeatures` expects.
 * Separated out because the horizon is a modelling choice: one gameweek is a
 * captaincy question, six is a transfer question, and they are different targets.
 */
export function forwardTarget(
  observations: { id: number; period: number; value: number | null }[],
  horizon: number,
): Map<string, number> {
  const byId = new Map<number, { period: number; value: number | null }[]>();
  for (const observation of observations) {
    const bucket = byId.get(observation.id) ?? [];
    bucket.push({ period: observation.period, value: observation.value });
    byId.set(observation.id, bucket);
  }

  const out = new Map<string, number>();
  for (const [id, bucket] of byId) {
    bucket.sort((a, b) => a.period - b.period);
    bucket.forEach((entry, index) => {
      const ahead = bucket.slice(index + 1, index + 1 + horizon);
      if (ahead.length < horizon) return;
      let total = 0;
      let counted = 0;
      for (const future of ahead) {
        if (future.value === null || !Number.isFinite(future.value)) continue;
        total += future.value;
        counted += 1;
      }
      if (counted === 0) return;
      out.set(`${id}:${entry.period}`, total);
    });
  }
  return out;
}

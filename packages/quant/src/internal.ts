/**
 * Shared primitives every module here leans on. Kept private to the package:
 * nothing in it is a statistical claim, it is the plumbing under one.
 */

/** A numeric series. Typed arrays and plain arrays are both accepted everywhere. */
export type Series = ArrayLike<number | null | undefined>;

/**
 * Indexed read under `noUncheckedIndexedAccess`. An out of range read is a
 * programming error, not a missing measure, so it throws rather than returning
 * a zero that would quietly enter a mean.
 */
export function at(values: ArrayLike<number>, index: number): number {
  const value = values[index];
  if (value === undefined) throw new RangeError(`index ${index} out of range (${values.length})`);
  return value;
}

/**
 * The finite values of a series, as a dense Float64Array. Null, undefined, and
 * NaN all drop out together: a measure the provider does not carry and a
 * measure that failed to parse are equally not observations.
 */
export function clean(values: Series): Float64Array {
  const out = new Float64Array(values.length);
  let n = 0;
  for (const value of Array.from(values)) {
    if (value === null || value === undefined) continue;
    if (!Number.isFinite(value)) continue;
    out[n] = value;
    n += 1;
  }
  return out.subarray(0, n);
}

/** Ascending copy. Sorting in place would surprise a caller who kept the input. */
export function sorted(values: ArrayLike<number>): Float64Array {
  const copy = Float64Array.from(values);
  copy.sort();
  return copy;
}

export function sum(values: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += at(values, i);
  return total;
}

export function mean(values: ArrayLike<number>): number {
  return values.length === 0 ? Number.NaN : sum(values) / values.length;
}

/** Sample variance, Bessel corrected. One observation has no spread, not zero spread. */
export function variance(values: ArrayLike<number>): number {
  if (values.length < 2) return Number.NaN;
  const m = mean(values);
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    const d = at(values, i) - m;
    total += d * d;
  }
  return total / (values.length - 1);
}

export function standardDeviation(values: ArrayLike<number>): number {
  return Math.sqrt(variance(values));
}

/**
 * Type 7 quantile: the default in R and NumPy, so a number here matches the
 * number an analyst gets checking the same column in either.
 */
export function quantileSorted(ascending: ArrayLike<number>, p: number): number {
  const n = ascending.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return at(ascending, 0);
  const clamped = Math.min(1, Math.max(0, p));
  const h = (n - 1) * clamped;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const low = at(ascending, lo);
  if (lo === hi) return low;
  return low + (h - lo) * (at(ascending, hi) - low);
}

export function quantile(values: Series, p: number): number {
  return quantileSorted(sorted(clean(values)), p);
}

export function median(values: Series): number {
  return quantile(values, 0.5);
}

/**
 * Ranks with ties averaged, which is what Spearman and Mann-Whitney both need.
 * Returns ranks in the input's own order, 1 based.
 */
export function rankAverage(values: ArrayLike<number>): Float64Array {
  const n = values.length;
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => at(values, a) - at(values, b),
  );
  const ranks = new Float64Array(n);
  let i = 0;
  while (i < n) {
    const index = order[i];
    if (index === undefined) break;
    let j = i + 1;
    while (j < n) {
      const next = order[j];
      if (next === undefined) break;
      if (at(values, next) !== at(values, index)) break;
      j += 1;
    }
    const rank = (i + j + 1) / 2;
    for (let k = i; k < j; k += 1) {
      const target = order[k];
      if (target !== undefined) ranks[target] = rank;
    }
    i = j;
  }
  return ranks;
}

/**
 * Pairs where both series carry a finite value. Every bivariate method starts
 * here, because dropping a row from one side and not the other silently
 * correlates a value with a different observation's partner.
 */
export function pairs(x: Series, y: Series): { x: Float64Array; y: Float64Array } {
  const n = Math.min(x.length, y.length);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    const a = x[i];
    const b = y[i];
    if (a === null || a === undefined || !Number.isFinite(a)) continue;
    if (b === null || b === undefined || !Number.isFinite(b)) continue;
    xs[k] = a;
    ys[k] = b;
    k += 1;
  }
  return { x: xs.subarray(0, k), y: ys.subarray(0, k) };
}

/** Numbers a reader can compare at a glance, without a chain of toFixed calls. */
export function round(value: number, places = 6): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

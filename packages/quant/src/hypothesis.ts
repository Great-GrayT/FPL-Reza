/**
 * Hypothesis tests and resampling. Named hypothesis.ts rather than test.ts so
 * the repository's test runner glob does not try to execute it.
 *
 * Every resampling method takes a seed. A p value that moves on refresh is not
 * evidence, and a shared link has to reproduce the number its author saw.
 */
import { at, clean, mean, rankAverage, variance, type Series } from './internal.js';
import { createRng, type Rng } from './rng.js';
import { normalCdf, tQuantile, tTwoSided } from './special.js';

export type Alternative = 'two-sided' | 'greater' | 'less';

export interface TestResult {
  name: string;
  statistic: number;
  pValue: number;
  degreesOfFreedom: number | null;
  /** The estimate the test is about: a mean, a difference, a shift. */
  estimate: number;
  lower: number;
  upper: number;
  n: number;
  alternative: Alternative;
  /** One line a reader can quote, stating what the number licenses. */
  verdict: string;
}

function directional(p: number, statistic: number, alternative: Alternative): number {
  if (alternative === 'two-sided') return p;
  const half = p / 2;
  if (alternative === 'greater') return statistic > 0 ? half : 1 - half;
  return statistic < 0 ? half : 1 - half;
}

function verdictFor(p: number, claim: string): string {
  if (!Number.isFinite(p)) return 'not enough data to test';
  return p < 0.05
    ? `${claim} (p = ${p.toPrecision(3)})`
    : `no detectable difference (p = ${p.toPrecision(3)})`;
}

/** One sample t test against a reference mean. */
export function tTestOneSample(
  values: Series,
  reference = 0,
  options: { alternative?: Alternative; level?: number } = {},
): TestResult {
  const finite = clean(values);
  const n = finite.length;
  const alternative = options.alternative ?? 'two-sided';
  if (n < 2) {
    return {
      name: 'one sample t',
      statistic: Number.NaN,
      pValue: Number.NaN,
      degreesOfFreedom: null,
      estimate: Number.NaN,
      lower: Number.NaN,
      upper: Number.NaN,
      n,
      alternative,
      verdict: 'too few observations',
    };
  }
  const m = mean(finite);
  const se = Math.sqrt(variance(finite) / n);
  const t = (m - reference) / se;
  const df = n - 1;
  const critical = tQuantile(1 - (1 - (options.level ?? 0.95)) / 2, df);
  const p = directional(tTwoSided(t, df), t, alternative);
  return {
    name: 'one sample t',
    statistic: t,
    pValue: p,
    degreesOfFreedom: df,
    estimate: m - reference,
    lower: m - reference - critical * se,
    upper: m - reference + critical * se,
    n,
    alternative,
    verdict: verdictFor(p, `the mean differs from ${reference}`),
  };
}

/**
 * Two sample t test, Welch by default. Equal variances are the exception in
 * this data, not the rule: a striker's points vary far more than a keeper's.
 */
export function tTest(
  a: Series,
  b: Series,
  options: { alternative?: Alternative; equalVariance?: boolean; level?: number } = {},
): TestResult {
  const x = clean(a);
  const y = clean(b);
  const nx = x.length;
  const ny = y.length;
  const alternative = options.alternative ?? 'two-sided';
  if (nx < 2 || ny < 2) {
    return {
      name: 'two sample t',
      statistic: Number.NaN,
      pValue: Number.NaN,
      degreesOfFreedom: null,
      estimate: Number.NaN,
      lower: Number.NaN,
      upper: Number.NaN,
      n: nx + ny,
      alternative,
      verdict: 'too few observations',
    };
  }

  const mx = mean(x);
  const my = mean(y);
  const vx = variance(x);
  const vy = variance(y);

  let se: number;
  let df: number;
  if (options.equalVariance === true) {
    const pooled = ((nx - 1) * vx + (ny - 1) * vy) / (nx + ny - 2);
    se = Math.sqrt(pooled * (1 / nx + 1 / ny));
    df = nx + ny - 2;
  } else {
    se = Math.sqrt(vx / nx + vy / ny);
    // Welch-Satterthwaite.
    df =
      (vx / nx + vy / ny) ** 2 / (vx ** 2 / (nx * nx * (nx - 1)) + vy ** 2 / (ny * ny * (ny - 1)));
  }

  const difference = mx - my;
  const t = difference / se;
  const critical = tQuantile(1 - (1 - (options.level ?? 0.95)) / 2, df);
  const p = directional(tTwoSided(t, df), t, alternative);
  return {
    name: options.equalVariance === true ? 'two sample t' : "Welch's t",
    statistic: t,
    pValue: p,
    degreesOfFreedom: df,
    estimate: difference,
    lower: difference - critical * se,
    upper: difference + critical * se,
    n: nx + ny,
    alternative,
    verdict: verdictFor(p, 'the two groups differ in mean'),
  };
}

/** Paired t test on the differences: the same players before and after. */
export function tTestPaired(
  a: Series,
  b: Series,
  options: { alternative?: Alternative } = {},
): TestResult {
  const differences: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === null || x === undefined || !Number.isFinite(x)) continue;
    if (y === null || y === undefined || !Number.isFinite(y)) continue;
    differences.push(x - y);
  }
  const result = tTestOneSample(differences, 0, options);
  return {
    ...result,
    name: 'paired t',
    verdict: verdictFor(result.pValue, 'the paired difference is not zero'),
  };
}

/**
 * Mann-Whitney U with a tie correction and the normal approximation, which is
 * the right test when the distribution is anything but normal, and points per
 * gameweek never are.
 */
export function mannWhitney(
  a: Series,
  b: Series,
  options: { alternative?: Alternative } = {},
): TestResult {
  const x = clean(a);
  const y = clean(b);
  const nx = x.length;
  const ny = y.length;
  const alternative = options.alternative ?? 'two-sided';
  if (nx === 0 || ny === 0) {
    return {
      name: 'Mann-Whitney U',
      statistic: Number.NaN,
      pValue: Number.NaN,
      degreesOfFreedom: null,
      estimate: Number.NaN,
      lower: Number.NaN,
      upper: Number.NaN,
      n: nx + ny,
      alternative,
      verdict: 'too few observations',
    };
  }

  const combined = new Float64Array(nx + ny);
  combined.set(x, 0);
  combined.set(y, nx);
  const ranks = rankAverage(combined);

  let rankSumX = 0;
  for (let i = 0; i < nx; i += 1) rankSumX += at(ranks, i);
  const u1 = rankSumX - (nx * (nx + 1)) / 2;
  const u2 = nx * ny - u1;
  const u = Math.min(u1, u2);

  const counts = new Map<number, number>();
  for (let i = 0; i < combined.length; i += 1) {
    const value = at(combined, i);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let tieTerm = 0;
  for (const count of counts.values()) tieTerm += count ** 3 - count;

  const n = nx + ny;
  const meanU = (nx * ny) / 2;
  const varianceU = ((nx * ny) / (n * (n - 1))) * ((n ** 3 - n - tieTerm) / 12);
  const z = varianceU > 0 ? (u1 - meanU) / Math.sqrt(varianceU) : Number.NaN;
  const p = directional(2 * (1 - normalCdf(Math.abs(z))), z, alternative);

  return {
    name: 'Mann-Whitney U',
    statistic: u,
    pValue: p,
    degreesOfFreedom: null,
    // The rank biserial correlation: an effect size the U alone does not give.
    estimate: (2 * u1) / (nx * ny) - 1,
    lower: Number.NaN,
    upper: Number.NaN,
    n,
    alternative,
    verdict: verdictFor(p, 'one group tends to score higher than the other'),
  };
}

/** Wilcoxon signed rank on paired differences, zeros dropped as the test defines. */
export function wilcoxon(
  a: Series,
  b: Series,
  options: { alternative?: Alternative } = {},
): TestResult {
  const differences: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === null || x === undefined || !Number.isFinite(x)) continue;
    if (y === null || y === undefined || !Number.isFinite(y)) continue;
    const difference = x - y;
    if (difference !== 0) differences.push(difference);
  }
  const alternative = options.alternative ?? 'two-sided';
  const count = differences.length;
  if (count < 6) {
    return {
      name: 'Wilcoxon signed rank',
      statistic: Number.NaN,
      pValue: Number.NaN,
      degreesOfFreedom: null,
      estimate: Number.NaN,
      lower: Number.NaN,
      upper: Number.NaN,
      n: count,
      alternative,
      verdict: 'too few non zero differences',
    };
  }

  const magnitudes = differences.map((difference) => Math.abs(difference));
  const ranks = rankAverage(magnitudes);
  let positive = 0;
  for (let i = 0; i < count; i += 1) if (at(differences, i) > 0) positive += at(ranks, i);

  const meanW = (count * (count + 1)) / 4;
  const varianceW = (count * (count + 1) * (2 * count + 1)) / 24;
  const z = (positive - meanW) / Math.sqrt(varianceW);
  const p = directional(2 * (1 - normalCdf(Math.abs(z))), z, alternative);

  return {
    name: 'Wilcoxon signed rank',
    statistic: positive,
    pValue: p,
    degreesOfFreedom: null,
    estimate: mean(differences),
    lower: Number.NaN,
    upper: Number.NaN,
    n: count,
    alternative,
    verdict: verdictFor(p, 'the paired difference is not zero'),
  };
}

/** Two proportion z test: clean sheet rates, start rates, anything binary. */
export function proportionTest(
  successesA: number,
  totalA: number,
  successesB: number,
  totalB: number,
  options: { alternative?: Alternative } = {},
): TestResult {
  const alternative = options.alternative ?? 'two-sided';
  if (totalA === 0 || totalB === 0) {
    return {
      name: 'two proportion z',
      statistic: Number.NaN,
      pValue: Number.NaN,
      degreesOfFreedom: null,
      estimate: Number.NaN,
      lower: Number.NaN,
      upper: Number.NaN,
      n: totalA + totalB,
      alternative,
      verdict: 'no trials',
    };
  }
  const pa = successesA / totalA;
  const pb = successesB / totalB;
  const pooled = (successesA + successesB) / (totalA + totalB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / totalA + 1 / totalB));
  const z = se === 0 ? Number.NaN : (pa - pb) / se;
  const p = directional(2 * (1 - normalCdf(Math.abs(z))), z, alternative);
  const seDifference = Math.sqrt((pa * (1 - pa)) / totalA + (pb * (1 - pb)) / totalB);
  return {
    name: 'two proportion z',
    statistic: z,
    pValue: p,
    degreesOfFreedom: null,
    estimate: pa - pb,
    lower: pa - pb - 1.959963985 * seDifference,
    upper: pa - pb + 1.959963985 * seDifference,
    n: totalA + totalB,
    alternative,
    verdict: verdictFor(p, 'the two rates differ'),
  };
}

export interface BootstrapResult {
  estimate: number;
  lower: number;
  upper: number;
  standardError: number;
  resamples: number;
  seed: number;
  /** Every resampled statistic, for the histogram the interval came from. */
  distribution: number[];
}

/**
 * Percentile bootstrap. Distribution free, so it works on the statistics that
 * have no textbook standard error: a median, a ratio of sums, an IC mean.
 */
export function bootstrapCi(
  values: Series,
  statistic: (sample: Float64Array) => number,
  options: { resamples?: number; seed?: number; level?: number } = {},
): BootstrapResult {
  const finite = clean(values);
  const n = finite.length;
  const resamples = options.resamples ?? 2000;
  const seed = options.seed ?? 1;
  const level = options.level ?? 0.95;
  if (n === 0) {
    return {
      estimate: Number.NaN,
      lower: Number.NaN,
      upper: Number.NaN,
      standardError: Number.NaN,
      resamples: 0,
      seed,
      distribution: [],
    };
  }

  const rng = createRng(seed);
  const draws = new Float64Array(resamples);
  const sample = new Float64Array(n);
  for (let r = 0; r < resamples; r += 1) {
    for (let i = 0; i < n; i += 1) sample[i] = at(finite, rng.int(n));
    draws[r] = statistic(sample);
  }
  const ascending = Float64Array.from(draws);
  ascending.sort();

  const lowIndex = Math.floor(((1 - level) / 2) * (resamples - 1));
  const highIndex = Math.ceil((1 - (1 - level) / 2) * (resamples - 1));

  return {
    estimate: statistic(finite),
    lower: at(ascending, lowIndex),
    upper: at(ascending, highIndex),
    standardError: Math.sqrt(variance(draws)),
    resamples,
    seed,
    distribution: Array.from(draws),
  };
}

export interface PermutationResult {
  observed: number;
  pValue: number;
  resamples: number;
  seed: number;
  distribution: number[];
  verdict: string;
}

/**
 * Permutation test: shuffle the group labels, recompute, and see how often
 * chance beats what was observed. The only test here that needs no assumption
 * about the distribution at all.
 */
export function permutationTest(
  a: Series,
  b: Series,
  statistic: (x: Float64Array, y: Float64Array) => number = (x, y) => mean(x) - mean(y),
  options: { resamples?: number; seed?: number; alternative?: Alternative } = {},
): PermutationResult {
  const x = clean(a);
  const y = clean(b);
  const nx = x.length;
  const ny = y.length;
  const resamples = options.resamples ?? 2000;
  const seed = options.seed ?? 1;
  const alternative = options.alternative ?? 'two-sided';
  if (nx === 0 || ny === 0) {
    return {
      observed: Number.NaN,
      pValue: Number.NaN,
      resamples: 0,
      seed,
      distribution: [],
      verdict: 'no observations',
    };
  }

  const observed = statistic(x, y);
  const pooled = new Float64Array(nx + ny);
  pooled.set(x, 0);
  pooled.set(y, nx);

  const rng: Rng = createRng(seed);
  const draws = new Float64Array(resamples);
  const shuffled = new Float64Array(pooled.length);
  let extreme = 0;

  for (let r = 0; r < resamples; r += 1) {
    shuffled.set(pooled);
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = rng.int(i + 1);
      const swap = at(shuffled, i);
      shuffled[i] = at(shuffled, j);
      shuffled[j] = swap;
    }
    const value = statistic(shuffled.subarray(0, nx), shuffled.subarray(nx));
    draws[r] = value;
    if (alternative === 'two-sided' && Math.abs(value) >= Math.abs(observed)) extreme += 1;
    else if (alternative === 'greater' && value >= observed) extreme += 1;
    else if (alternative === 'less' && value <= observed) extreme += 1;
  }

  // The plus one is Phipson and Smyth: a permutation p value of exactly zero
  // claims more than the resampling can support.
  const pValue = (extreme + 1) / (resamples + 1);
  return {
    observed,
    pValue,
    resamples,
    seed,
    distribution: Array.from(draws),
    verdict: verdictFor(pValue, 'the observed difference is larger than chance'),
  };
}

/**
 * Benjamini-Hochberg. Testing forty factors against next gameweek points will
 * produce two significant ones by luck; this is what stops that being reported
 * as a discovery.
 */
export function falseDiscoveryRate(
  pValues: number[],
  level = 0.05,
): { index: number; p: number; significant: boolean }[] {
  const entries = pValues.map((p, index) => ({ index, p })).sort((left, right) => left.p - right.p);
  const m = entries.length;
  let threshold = -1;
  entries.forEach((entry, rank) => {
    if (entry.p <= ((rank + 1) / m) * level) threshold = rank;
  });
  return entries
    .map((entry, rank) => ({ ...entry, significant: rank <= threshold }))
    .sort((left, right) => left.index - right.index);
}

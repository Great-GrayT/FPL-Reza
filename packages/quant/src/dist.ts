/**
 * Parametric distributions, their fits, and the goodness of fit tests that say
 * whether the fit is worth keeping. Football counts are the reason the Poisson
 * and negative binomial are here: goals per match are close to Poisson, points
 * per gameweek are not, and being able to show which is which is the point.
 */
import { at, clean, mean, sorted, standardDeviation, variance, type Series } from './internal.js';
import {
  chiSquareP,
  erf,
  incompleteBeta,
  logGamma,
  lowerGamma,
  normalCdf,
  normalQuantile,
} from './special.js';
import type { Rng } from './rng.js';

export interface Distribution {
  readonly name: string;
  /** Density for a continuous law, probability mass for a discrete one. */
  pdf(x: number): number;
  cdf(x: number): number;
  quantile(p: number): number;
  sample(rng: Rng): number;
  readonly mean: number;
  readonly variance: number;
  /** Free parameters, which is what a goodness of fit test must subtract. */
  readonly parameters: Record<string, number>;
  readonly discrete: boolean;
}

export function normal(mu: number, sigma: number): Distribution {
  const s = Math.max(sigma, Number.EPSILON);
  return {
    name: 'normal',
    discrete: false,
    parameters: { mu, sigma: s },
    mean: mu,
    variance: s * s,
    pdf: (x) => Math.exp(-0.5 * ((x - mu) / s) ** 2) / (s * Math.sqrt(2 * Math.PI)),
    cdf: (x) => 0.5 * (1 + erf((x - mu) / (s * Math.SQRT2))),
    quantile: (p) => mu + s * normalQuantile(p),
    sample: (rng) => mu + s * rng.normal(),
  };
}

export function poisson(lambda: number): Distribution {
  const l = Math.max(lambda, 0);
  return {
    name: 'poisson',
    discrete: true,
    parameters: { lambda: l },
    mean: l,
    variance: l,
    pdf: (k) => {
      if (k < 0 || !Number.isInteger(k)) return 0;
      return Math.exp(-l + k * Math.log(l === 0 ? Number.EPSILON : l) - logGamma(k + 1));
    },
    // The regularised upper incomplete gamma is the Poisson cdf exactly, which
    // beats summing terms once lambda is large.
    cdf: (k) => (k < 0 ? 0 : 1 - lowerGamma(Math.floor(k) + 1, l)),
    quantile: (p) => discreteQuantile(p, (k) => (k < 0 ? 0 : 1 - lowerGamma(k + 1, l))),
    sample: (rng) => rng.poisson(l),
  };
}

/**
 * Negative binomial in the (r, p) parameterisation, which is the overdispersed
 * count law: variance = mean / p, so it fits totals a Poisson underestimates.
 */
export function negativeBinomial(r: number, p: number): Distribution {
  const rr = Math.max(r, Number.EPSILON);
  const pp = Math.min(Math.max(p, Number.EPSILON), 1);
  const m = (rr * (1 - pp)) / pp;
  return {
    name: 'negative-binomial',
    discrete: true,
    parameters: { r: rr, p: pp },
    mean: m,
    variance: m / pp,
    pdf: (k) => {
      if (k < 0 || !Number.isInteger(k)) return 0;
      return Math.exp(
        logGamma(k + rr) -
          logGamma(rr) -
          logGamma(k + 1) +
          rr * Math.log(pp) +
          k * Math.log(1 - pp),
      );
    },
    cdf: (k) => (k < 0 ? 0 : incompleteBeta(pp, rr, Math.floor(k) + 1)),
    quantile: (p2) => discreteQuantile(p2, (k) => incompleteBeta(pp, rr, k + 1)),
    sample: (rng) => {
      // Gamma-Poisson mixture: the definition, and it reuses the Poisson draw.
      let shape = rr;
      let value = 0;
      while (shape > 0) {
        const step = Math.min(1, shape);
        let u = rng.next();
        while (u === 0) u = rng.next();
        value += -Math.log(u) * step;
        shape -= step;
      }
      return rng.poisson((value * (1 - pp)) / pp);
    },
  };
}

export function binomial(n: number, p: number): Distribution {
  const nn = Math.max(0, Math.round(n));
  const pp = Math.min(Math.max(p, 0), 1);
  return {
    name: 'binomial',
    discrete: true,
    parameters: { n: nn, p: pp },
    mean: nn * pp,
    variance: nn * pp * (1 - pp),
    pdf: (k) => {
      if (k < 0 || k > nn || !Number.isInteger(k)) return 0;
      return Math.exp(
        logGamma(nn + 1) -
          logGamma(k + 1) -
          logGamma(nn - k + 1) +
          k * Math.log(pp === 0 ? Number.EPSILON : pp) +
          (nn - k) * Math.log(pp === 1 ? Number.EPSILON : 1 - pp),
      );
    },
    cdf: (k) => {
      if (k < 0) return 0;
      if (k >= nn) return 1;
      return incompleteBeta(1 - pp, nn - Math.floor(k), Math.floor(k) + 1);
    },
    quantile: (target) =>
      discreteQuantile(target, (k) => (k >= nn ? 1 : incompleteBeta(1 - pp, nn - k, k + 1))),
    sample: (rng) => {
      let count = 0;
      for (let i = 0; i < nn; i += 1) if (rng.next() < pp) count += 1;
      return count;
    },
  };
}

export function exponential(rate: number): Distribution {
  const r = Math.max(rate, Number.EPSILON);
  return {
    name: 'exponential',
    discrete: false,
    parameters: { rate: r },
    mean: 1 / r,
    variance: 1 / (r * r),
    pdf: (x) => (x < 0 ? 0 : r * Math.exp(-r * x)),
    cdf: (x) => (x < 0 ? 0 : 1 - Math.exp(-r * x)),
    quantile: (p) => -Math.log(1 - Math.min(Math.max(p, 0), 1 - 1e-15)) / r,
    sample: (rng) => {
      let u = rng.next();
      while (u === 0) u = rng.next();
      return -Math.log(u) / r;
    },
  };
}

export function beta(a: number, b: number): Distribution {
  const aa = Math.max(a, Number.EPSILON);
  const bb = Math.max(b, Number.EPSILON);
  const logB = logGamma(aa) + logGamma(bb) - logGamma(aa + bb);
  return {
    name: 'beta',
    discrete: false,
    parameters: { alpha: aa, beta: bb },
    mean: aa / (aa + bb),
    variance: (aa * bb) / ((aa + bb) ** 2 * (aa + bb + 1)),
    pdf: (x) => {
      if (x <= 0 || x >= 1) return 0;
      return Math.exp((aa - 1) * Math.log(x) + (bb - 1) * Math.log(1 - x) - logB);
    },
    cdf: (x) => incompleteBeta(x, aa, bb),
    quantile: (p) => {
      // Bisection: the beta quantile has no closed form and the cdf is monotone.
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 200; i += 1) {
        const mid = (lo + hi) / 2;
        if (incompleteBeta(mid, aa, bb) < p) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    },
    sample: (rng) => {
      // Two gamma draws by Marsaglia-Tsang, then the ratio.
      const g1 = gammaSample(rng, aa);
      const g2 = gammaSample(rng, bb);
      return g1 / (g1 + g2);
    },
  };
}

function gammaSample(rng: Rng, shape: number): number {
  if (shape < 1) {
    let u = rng.next();
    while (u === 0) u = rng.next();
    return gammaSample(rng, shape + 1) * u ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const z = rng.normal();
    const v = (1 + c * z) ** 3;
    if (v <= 0) continue;
    let u = rng.next();
    while (u === 0) u = rng.next();
    if (Math.log(u) < 0.5 * z * z + d - d * v + d * Math.log(v)) return d * v;
  }
}

function discreteQuantile(p: number, cdf: (k: number) => number): number {
  if (p <= 0) return 0;
  let k = 0;
  while (k < 100000) {
    if (cdf(k) >= p) return k;
    k += 1;
  }
  return k;
}

/** Maximum likelihood fits. Each returns the distribution, so a fit is drawable. */
export function fitNormal(values: Series): Distribution {
  const finite = clean(values);
  return normal(mean(finite), standardDeviation(finite));
}

export function fitPoisson(values: Series): Distribution {
  return poisson(mean(clean(values)));
}

/**
 * Negative binomial by moment matching, then a Newton polish on r. Moments
 * alone are fine when the data is overdispersed and undefined when it is not,
 * so an underdispersed sample falls back to a Poisson shaped fit.
 */
export function fitNegativeBinomial(values: Series): Distribution {
  const finite = clean(values);
  const m = mean(finite);
  const v = variance(finite);
  if (!(v > m) || !Number.isFinite(v)) return negativeBinomial(1e6, 1e6 / (1e6 + m));
  const p = m / v;
  const r = (m * p) / (1 - p);
  return negativeBinomial(r, p);
}

export function fitExponential(values: Series): Distribution {
  const m = mean(clean(values));
  return exponential(m === 0 ? Number.EPSILON : 1 / m);
}

/** Beta by method of moments, which is stable on the 0 to 1 shares this site has. */
export function fitBeta(values: Series): Distribution {
  const finite = clean(values);
  const m = mean(finite);
  const v = variance(finite);
  if (!(v > 0) || m <= 0 || m >= 1) return beta(1, 1);
  const common = (m * (1 - m)) / v - 1;
  return beta(m * common, (1 - m) * common);
}

export interface GoodnessOfFit {
  statistic: number;
  pValue: number;
  /** What the number means in one line, so a reader is not left to guess. */
  verdict: string;
}

/**
 * One sample Kolmogorov-Smirnov against a fully specified continuous law. Note
 * the caveat and state it: fitting the parameters from the same sample makes
 * this p value conservative (a Lilliefors correction would be needed to be
 * exact), so it is reported as evidence rather than as proof.
 */
export function ksTest(values: Series, cdf: (x: number) => number): GoodnessOfFit {
  const ascending = sorted(clean(values));
  const n = ascending.length;
  if (n === 0) return { statistic: Number.NaN, pValue: Number.NaN, verdict: 'no observations' };

  let d = 0;
  for (let i = 0; i < n; i += 1) {
    const f = cdf(at(ascending, i));
    d = Math.max(d, Math.abs((i + 1) / n - f), Math.abs(f - i / n));
  }

  // Kolmogorov's asymptotic series, with the small sample scaling correction.
  const en = Math.sqrt(n);
  const lambda = (en + 0.12 + 0.11 / en) * d;
  let p = 0;
  for (let j = 1; j <= 100; j += 1) {
    p += 2 * (-1) ** (j - 1) * Math.exp(-2 * j * j * lambda * lambda);
  }
  const pValue = Math.min(1, Math.max(0, p));

  return {
    statistic: d,
    pValue,
    verdict:
      pValue < 0.05
        ? 'the sample departs from the reference distribution'
        : 'no detectable departure from the reference distribution',
  };
}

export interface ChiSquareResult extends GoodnessOfFit {
  degreesOfFreedom: number;
  /** Observed against expected, per bucket, which is where a bad fit is visible. */
  cells: { value: number; observed: number; expected: number }[];
}

/**
 * Pearson chi square for a discrete law: exactly the test for "are goals per
 * match Poisson". Buckets with an expectation below 5 are pooled into the tail,
 * because the chi square approximation fails on thin cells.
 */
export function chiSquareTest(counts: Series, distribution: Distribution): ChiSquareResult {
  const finite = clean(counts);
  const n = finite.length;
  if (n === 0) {
    return {
      statistic: Number.NaN,
      pValue: Number.NaN,
      degreesOfFreedom: 0,
      cells: [],
      verdict: 'no observations',
    };
  }

  const observed = new Map<number, number>();
  let max = 0;
  for (let i = 0; i < n; i += 1) {
    const value = Math.round(at(finite, i));
    observed.set(value, (observed.get(value) ?? 0) + 1);
    if (value > max) max = value;
  }

  const cells: { value: number; observed: number; expected: number }[] = [];
  let pooledObserved = 0;
  let pooledExpected = 0;
  for (let k = 0; k <= max; k += 1) {
    const expected = distribution.pdf(k) * n;
    const seen = observed.get(k) ?? 0;
    if (expected < 5) {
      pooledObserved += seen;
      pooledExpected += expected;
      continue;
    }
    cells.push({ value: k, observed: seen, expected });
  }
  // The tail beyond the largest observation still carries probability mass.
  pooledExpected += (1 - distribution.cdf(max)) * n;
  if (pooledExpected > 0) {
    cells.push({
      value: Number.POSITIVE_INFINITY,
      observed: pooledObserved,
      expected: pooledExpected,
    });
  }

  let statistic = 0;
  for (const cell of cells) {
    if (cell.expected <= 0) continue;
    statistic += (cell.observed - cell.expected) ** 2 / cell.expected;
  }

  const parameters = Object.keys(distribution.parameters).length;
  const degreesOfFreedom = Math.max(1, cells.length - 1 - parameters);
  const pValue = chiSquareP(statistic, degreesOfFreedom);

  return {
    statistic,
    pValue,
    degreesOfFreedom,
    cells,
    verdict:
      pValue < 0.05
        ? `the counts do not follow this ${distribution.name}`
        : `the counts are consistent with this ${distribution.name}`,
  };
}

/**
 * Anderson-Darling against a fully specified law. More sensitive than KS in the
 * tails, which is where an FPL points distribution actually differs from a
 * normal, so both are offered rather than one.
 */
export function andersonDarling(values: Series, cdf: (x: number) => number): GoodnessOfFit {
  const ascending = sorted(clean(values));
  const n = ascending.length;
  if (n < 2) return { statistic: Number.NaN, pValue: Number.NaN, verdict: 'too few observations' };

  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const lower = Math.min(Math.max(cdf(at(ascending, i)), 1e-12), 1 - 1e-12);
    const upper = Math.min(Math.max(cdf(at(ascending, n - 1 - i)), 1e-12), 1 - 1e-12);
    total += (2 * i + 1) * (Math.log(lower) + Math.log(1 - upper));
  }
  const statistic = -n - total / n;

  // D'Agostino's p value approximation for the adjusted statistic.
  const adjusted = statistic * (1 + 0.75 / n + 2.25 / (n * n));
  let pValue: number;
  if (adjusted >= 0.6) pValue = Math.exp(1.2937 - 5.709 * adjusted + 0.0186 * adjusted * adjusted);
  else if (adjusted >= 0.34)
    pValue = Math.exp(0.9177 - 4.279 * adjusted - 1.38 * adjusted * adjusted);
  else if (adjusted >= 0.2)
    pValue = 1 - Math.exp(-8.318 + 42.796 * adjusted - 59.938 * adjusted * adjusted);
  else pValue = 1 - Math.exp(-13.436 + 101.14 * adjusted - 223.73 * adjusted * adjusted);

  return {
    statistic,
    pValue: Math.min(1, Math.max(0, pValue)),
    verdict:
      pValue < 0.05
        ? 'the tails depart from the reference'
        : 'the tails are consistent with the reference',
  };
}

/** Shapiro-Wilk is not implemented; normality is judged by KS, AD, and the QQ plot. */
export function normalityReport(values: Series): { ks: GoodnessOfFit; ad: GoodnessOfFit } {
  const fitted = fitNormal(values);
  return {
    ks: ksTest(values, (x) => fitted.cdf(x)),
    ad: andersonDarling(values, (x) => fitted.cdf(x)),
  };
}

export { normalCdf, normalQuantile };

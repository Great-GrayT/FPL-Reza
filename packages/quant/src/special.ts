/**
 * Special functions and the distribution tails every p value in this package
 * is read off. All computed, none tabulated: a table would be a second source
 * of truth that could disagree with the test using it.
 */

/** Log gamma, Lanczos g = 7, n = 9. Accurate to about 15 significant figures. */
export function logGamma(x: number): number {
  if (x <= 0) {
    // Reflection, so the negative half is available to the beta function.
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  }
  const coefficients = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  const z = x - 1;
  let a = coefficients[0] ?? 0;
  const t = z + 7.5;
  for (let i = 1; i < coefficients.length; i += 1) a += (coefficients[i] ?? 0) / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

export function gamma(x: number): number {
  return Math.exp(logGamma(x));
}

export function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/** Regularised lower incomplete gamma P(a, x), series below the mode and continued fraction above. */
export function lowerGamma(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let term = 1 / a;
    let total = term;
    for (let n = 1; n < 1000; n += 1) {
      term *= x / (a + n);
      total += term;
      if (Math.abs(term) < Math.abs(total) * 1e-15) break;
    }
    return total * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  return 1 - upperGamma(a, x);
}

/** Regularised upper incomplete gamma Q(a, x), by Lentz's continued fraction. */
export function upperGamma(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - lowerGamma(a, x);
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Regularised incomplete beta I_x(a, b), the tail behind the t, F, and binomial tests. */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBeta(a, b));
  // The continued fraction converges only on the left of the mode, so the
  // symmetry relation carries the right hand side back into range.
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);

  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let numerator = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;

    numerator = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return (front * h) / a;
}

/** Error function, via the incomplete gamma so one approximation serves both. */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  return sign * lowerGamma(0.5, x * x);
}

export function erfc(x: number): number {
  return 1 - erf(x);
}

/** Standard normal cumulative distribution. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Standard normal quantile, Acklam's rational approximation refined by one Halley step. */
export function normalQuantile(p: number): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pick = (list: number[], i: number): number => list[i] ?? 0;
  const low = 0.02425;
  let x: number;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((pick(c, 0) * q + pick(c, 1)) * q + pick(c, 2)) * q + pick(c, 3)) * q + pick(c, 4)) * q +
        pick(c, 5)) /
      ((((pick(d, 0) * q + pick(d, 1)) * q + pick(d, 2)) * q + pick(d, 3)) * q + 1);
  } else if (p <= 1 - low) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((pick(a, 0) * r + pick(a, 1)) * r + pick(a, 2)) * r + pick(a, 3)) * r + pick(a, 4)) * r +
        pick(a, 5)) *
        q) /
      (((((pick(b, 0) * r + pick(b, 1)) * r + pick(b, 2)) * r + pick(b, 3)) * r + pick(b, 4)) * r +
        1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(
        ((((pick(c, 0) * q + pick(c, 1)) * q + pick(c, 2)) * q + pick(c, 3)) * q + pick(c, 4)) * q +
        pick(c, 5)
      ) /
      ((((pick(d, 0) * q + pick(d, 1)) * q + pick(d, 2)) * q + pick(d, 3)) * q + 1);
  }
  // One Halley refinement takes the approximation from about 1e-9 to machine precision.
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** Student t, two sided p value for a statistic with df degrees of freedom. */
export function tTwoSided(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return Number.NaN;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

export function tCdf(t: number, df: number): number {
  const half = tTwoSided(t, df) / 2;
  return t > 0 ? 1 - half : half;
}

/** Student t quantile, by bisection on the cdf: exact enough and impossible to get subtly wrong. */
export function tQuantile(p: number, df: number): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  let lo = -1e3;
  let hi = 1e3;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function chiSquareCdf(x: number, df: number): number {
  if (x <= 0) return 0;
  return lowerGamma(df / 2, x / 2);
}

/** Upper tail of chi square, which is the p value a goodness of fit test reports. */
export function chiSquareP(x: number, df: number): number {
  if (x <= 0) return 1;
  return upperGamma(df / 2, x / 2);
}

export function fCdf(x: number, df1: number, df2: number): number {
  if (x <= 0) return 0;
  return incompleteBeta((df1 * x) / (df1 * x + df2), df1 / 2, df2 / 2);
}

/** Upper tail of F, the p value beside a regression's F statistic. */
export function fP(x: number, df1: number, df2: number): number {
  return 1 - fCdf(x, df1, df2);
}

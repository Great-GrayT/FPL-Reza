/**
 * Linear and logistic models, with the diagnostics that decide whether a fit
 * means anything. Solved by Householder QR rather than by inverting the normal
 * matrix: with collinear football columns (price and ownership, xG and shots)
 * the normal equations lose about half the available precision.
 */
import { at, mean, type Series } from './internal.js';
import { fP, normalCdf, tQuantile, tTwoSided } from './special.js';

export interface Matrix {
  rows: number;
  columns: number;
  /** Row major. */
  values: Float64Array;
}

export function matrixFrom(columns: Series[]): Matrix {
  const rows = columns[0]?.length ?? 0;
  const width = columns.length;
  const values = new Float64Array(rows * width);
  for (let j = 0; j < width; j += 1) {
    const column = columns[j];
    if (column === undefined) continue;
    for (let i = 0; i < rows; i += 1) {
      const value = column[i];
      values[i * width + j] = value ?? Number.NaN;
    }
  }
  return { rows, columns: width, values };
}

export interface Coefficient {
  name: string;
  estimate: number;
  standardError: number;
  t: number;
  pValue: number;
  lower: number;
  upper: number;
}

export interface OlsModel {
  kind: 'ols';
  coefficients: Coefficient[];
  /** Observations actually used, after rows with any missing value were dropped. */
  n: number;
  /** Parameters including the intercept. */
  k: number;
  rSquared: number;
  adjustedRSquared: number;
  fStatistic: number;
  fPValue: number;
  residualStandardError: number;
  aic: number;
  bic: number;
  logLikelihood: number;
  residuals: number[];
  fitted: number[];
  /** Diagonal of the hat matrix: how much each row pulls its own fit. */
  leverage: number[];
  cooksDistance: number[];
  durbinWatson: number;
  /** Breusch-Pagan p value. Small means the residual spread depends on the fit. */
  heteroskedasticityP: number;
  intercept: boolean;
  robust: boolean;
}

export interface OlsOptions {
  names?: string[];
  intercept?: boolean;
  /** HC1 standard errors, which is what to use when the Breusch-Pagan test bites. */
  robust?: boolean;
  confidenceLevel?: number;
}

interface Prepared {
  x: number[][];
  y: number[];
  names: string[];
}

/** Rows where the target and every predictor are finite. Listwise, and counted. */
function prepare(y: Series, predictors: Series[], names: string[], intercept: boolean): Prepared {
  const rows: number[][] = [];
  const targets: number[] = [];
  const n = y.length;
  for (let i = 0; i < n; i += 1) {
    const target = y[i];
    if (target === null || target === undefined || !Number.isFinite(target)) continue;
    const row: number[] = intercept ? [1] : [];
    let usable = true;
    for (const predictor of predictors) {
      const value = predictor[i];
      if (value === null || value === undefined || !Number.isFinite(value)) {
        usable = false;
        break;
      }
      row.push(value);
    }
    if (!usable) continue;
    rows.push(row);
    targets.push(target);
  }
  return {
    x: rows,
    y: targets,
    names: intercept ? ['(intercept)', ...names] : [...names],
  };
}

/** Householder QR of a tall matrix, returning R and Q'y in place of Q. */
function qrSolve(
  x: number[][],
  y: number[],
): { beta: Float64Array; rInverse: Float64Array } | null {
  const n = x.length;
  const p = x[0]?.length ?? 0;
  if (n === 0 || p === 0 || n < p) return null;

  const a: number[][] = x.map((row) => [...row]);
  const qty = [...y];

  for (let k = 0; k < p; k += 1) {
    let norm = 0;
    for (let i = k; i < n; i += 1) norm += (a[i]?.[k] ?? 0) ** 2;
    norm = Math.sqrt(norm);
    if (norm === 0) return null;
    const akk = a[k]?.[k] ?? 0;
    const alpha = akk > 0 ? -norm : norm;
    const v = new Float64Array(n);
    for (let i = k; i < n; i += 1) v[i] = a[i]?.[k] ?? 0;
    v[k] = (v[k] ?? 0) - alpha;
    let vNorm = 0;
    for (let i = k; i < n; i += 1) vNorm += (v[i] ?? 0) ** 2;
    if (vNorm === 0) continue;

    for (let j = k; j < p; j += 1) {
      let dot = 0;
      for (let i = k; i < n; i += 1) dot += (v[i] ?? 0) * (a[i]?.[j] ?? 0);
      const scale = (2 * dot) / vNorm;
      for (let i = k; i < n; i += 1) {
        const row = a[i];
        if (row === undefined) continue;
        row[j] = (row[j] ?? 0) - scale * (v[i] ?? 0);
      }
    }
    let dotY = 0;
    for (let i = k; i < n; i += 1) dotY += (v[i] ?? 0) * (qty[i] ?? 0);
    const scaleY = (2 * dotY) / vNorm;
    for (let i = k; i < n; i += 1) qty[i] = (qty[i] ?? 0) - scaleY * (v[i] ?? 0);
  }

  // Back substitution against the upper triangle.
  const beta = new Float64Array(p);
  for (let i = p - 1; i >= 0; i -= 1) {
    let total = qty[i] ?? 0;
    for (let j = i + 1; j < p; j += 1) total -= (a[i]?.[j] ?? 0) * (beta[j] ?? 0);
    const pivot = a[i]?.[i] ?? 0;
    if (pivot === 0) return null;
    beta[i] = total / pivot;
  }

  // R inverse, which gives (X'X) inverse as R^-1 R^-T without forming X'X.
  const rInverse = new Float64Array(p * p);
  for (let i = 0; i < p; i += 1) {
    const pivot = a[i]?.[i] ?? 0;
    if (pivot === 0) return null;
    rInverse[i * p + i] = 1 / pivot;
    for (let j = i + 1; j < p; j += 1) {
      let total = 0;
      for (let k = i; k < j; k += 1) total += (rInverse[i * p + k] ?? 0) * (a[k]?.[j] ?? 0);
      const jj = a[j]?.[j] ?? 0;
      if (jj === 0) return null;
      rInverse[i * p + j] = -total / jj;
    }
  }
  return { beta, rInverse };
}

function covariance(rInverse: Float64Array, p: number, sigmaSquared: number): Float64Array {
  const out = new Float64Array(p * p);
  for (let i = 0; i < p; i += 1) {
    for (let j = 0; j < p; j += 1) {
      let total = 0;
      for (let k = Math.max(i, j); k < p; k += 1) {
        total += (rInverse[i * p + k] ?? 0) * (rInverse[j * p + k] ?? 0);
      }
      out[i * p + j] = total * sigmaSquared;
    }
  }
  return out;
}

export function ols(y: Series, predictors: Series[], options: OlsOptions = {}): OlsModel | null {
  const intercept = options.intercept ?? true;
  const names = options.names ?? predictors.map((_, i) => `x${i + 1}`);
  const level = options.confidenceLevel ?? 0.95;
  const prepared = prepare(y, predictors, names, intercept);
  const n = prepared.x.length;
  const p = prepared.x[0]?.length ?? 0;
  if (n <= p) return null;

  const solved = qrSolve(prepared.x, prepared.y);
  if (solved === null) return null;
  const beta = solved.beta;

  const fitted: number[] = new Array<number>(n).fill(0);
  const residuals: number[] = new Array<number>(n).fill(0);
  let rss = 0;
  for (let i = 0; i < n; i += 1) {
    const row = prepared.x[i];
    if (row === undefined) continue;
    let value = 0;
    for (let j = 0; j < p; j += 1) value += (row[j] ?? 0) * (beta[j] ?? 0);
    fitted[i] = value;
    const residual = (prepared.y[i] ?? 0) - value;
    residuals[i] = residual;
    rss += residual * residual;
  }

  const yMean = mean(prepared.y);
  let tss = 0;
  for (const value of prepared.y) tss += (value - yMean) ** 2;

  const df = n - p;
  const sigmaSquared = rss / df;
  const xtxInverse = covariance(solved.rInverse, p, 1);

  // Leverage, needed both for Cook's distance and for the robust sandwich.
  const leverage: number[] = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const row = prepared.x[i];
    if (row === undefined) continue;
    let total = 0;
    for (let a = 0; a < p; a += 1) {
      for (let b = 0; b < p; b += 1) {
        total += (row[a] ?? 0) * (xtxInverse[a * p + b] ?? 0) * (row[b] ?? 0);
      }
    }
    leverage[i] = total;
  }

  let variances: Float64Array;
  if (options.robust === true) {
    // HC1: the sandwich with the small sample scaling, which is the default in Stata.
    const meat = new Float64Array(p * p);
    for (let i = 0; i < n; i += 1) {
      const row = prepared.x[i];
      if (row === undefined) continue;
      const weight = (residuals[i] ?? 0) ** 2;
      for (let a = 0; a < p; a += 1) {
        for (let b = 0; b < p; b += 1) {
          meat[a * p + b] = (meat[a * p + b] ?? 0) + weight * (row[a] ?? 0) * (row[b] ?? 0);
        }
      }
    }
    const scale = n / df;
    variances = new Float64Array(p);
    for (let a = 0; a < p; a += 1) {
      let total = 0;
      for (let b = 0; b < p; b += 1) {
        for (let c = 0; c < p; c += 1) {
          total +=
            (xtxInverse[a * p + b] ?? 0) * (meat[b * p + c] ?? 0) * (xtxInverse[c * p + a] ?? 0);
        }
      }
      variances[a] = total * scale;
    }
  } else {
    variances = new Float64Array(p);
    for (let a = 0; a < p; a += 1) variances[a] = (xtxInverse[a * p + a] ?? 0) * sigmaSquared;
  }

  const critical = tQuantile(1 - (1 - level) / 2, df);
  const coefficients: Coefficient[] = [];
  for (let j = 0; j < p; j += 1) {
    const estimate = beta[j] ?? Number.NaN;
    const standardError = Math.sqrt(variances[j] ?? Number.NaN);
    const t = estimate / standardError;
    coefficients.push({
      name: prepared.names[j] ?? `x${j}`,
      estimate,
      standardError,
      t,
      pValue: tTwoSided(t, df),
      lower: estimate - critical * standardError,
      upper: estimate + critical * standardError,
    });
  }

  const rSquared = tss === 0 ? Number.NaN : 1 - rss / tss;
  const regressors = intercept ? p - 1 : p;
  const adjustedRSquared = 1 - (1 - rSquared) * ((n - (intercept ? 1 : 0)) / df);
  const fStatistic = regressors > 0 ? (tss - rss) / regressors / sigmaSquared : Number.NaN;

  const logLikelihood = -0.5 * n * (Math.log(2 * Math.PI) + Math.log(rss / n) + 1);
  const cooksDistance = residuals.map((residual, i) => {
    const h = leverage[i] ?? 0;
    if (h >= 1) return Number.POSITIVE_INFINITY;
    return (residual * residual * h) / (p * sigmaSquared * (1 - h) ** 2);
  });

  let dwNumerator = 0;
  for (let i = 1; i < n; i += 1)
    dwNumerator += ((residuals[i] ?? 0) - (residuals[i - 1] ?? 0)) ** 2;

  return {
    kind: 'ols',
    coefficients,
    n,
    k: p,
    rSquared,
    adjustedRSquared,
    fStatistic,
    fPValue: Number.isFinite(fStatistic) ? fP(fStatistic, regressors, df) : Number.NaN,
    residualStandardError: Math.sqrt(sigmaSquared),
    aic: -2 * logLikelihood + 2 * (p + 1),
    bic: -2 * logLikelihood + Math.log(n) * (p + 1),
    logLikelihood,
    residuals,
    fitted,
    leverage,
    cooksDistance,
    durbinWatson: rss === 0 ? Number.NaN : dwNumerator / rss,
    heteroskedasticityP: breuschPagan(residuals, fitted, p),
    intercept,
    robust: options.robust ?? false,
  };
}

/** Breusch-Pagan: regress squared residuals on the fit and test the slope. */
function breuschPagan(residuals: number[], fitted: number[], p: number): number {
  const n = residuals.length;
  if (n < p + 3) return Number.NaN;
  const squared = residuals.map((residual) => residual * residual);
  const auxiliary = ols(squared, [fitted], { intercept: true, names: ['fitted'] });
  if (auxiliary === null) return Number.NaN;
  // The Lagrange multiplier statistic is n R squared, chi square with one degree of freedom.
  const statistic = n * auxiliary.rSquared;
  return Number.isFinite(statistic)
    ? 2 * (1 - normalCdf(Math.sqrt(Math.max(statistic, 0))))
    : Number.NaN;
}

export function predictOls(model: OlsModel, row: number[]): number {
  const values = model.intercept ? [1, ...row] : row;
  let total = 0;
  model.coefficients.forEach((coefficient, index) => {
    total += coefficient.estimate * (values[index] ?? 0);
  });
  return total;
}

export interface RidgeModel {
  kind: 'ridge';
  lambda: number;
  intercept: number;
  coefficients: { name: string; estimate: number }[];
  rSquared: number;
  n: number;
  /** Cross validated error at each lambda tried, so the choice is visible. */
  path: { lambda: number; cvError: number }[];
}

/**
 * Ridge on standardised predictors, coefficients returned on the original
 * scale. Standardising inside is not a convenience: an unstandardised ridge
 * penalises a price in tenths and a share in percent by wildly different amounts.
 */
export function ridge(
  y: Series,
  predictors: Series[],
  options: { names?: string[]; lambda?: number; folds?: number; lambdas?: number[] } = {},
): RidgeModel | null {
  const names = options.names ?? predictors.map((_, i) => `x${i + 1}`);
  const prepared = prepare(y, predictors, names, false);
  const n = prepared.x.length;
  const p = predictors.length;
  if (n <= 2 || p === 0) return null;

  const columnMeans = new Float64Array(p);
  const columnSds = new Float64Array(p);
  for (let j = 0; j < p; j += 1) {
    let total = 0;
    for (let i = 0; i < n; i += 1) total += prepared.x[i]?.[j] ?? 0;
    const m = total / n;
    columnMeans[j] = m;
    let variance = 0;
    for (let i = 0; i < n; i += 1) variance += ((prepared.x[i]?.[j] ?? 0) - m) ** 2;
    columnSds[j] = Math.sqrt(variance / n) || 1;
  }
  const yMean = mean(prepared.y);

  const z: number[][] = prepared.x.map((row) =>
    row.map((value, j) => (value - (columnMeans[j] ?? 0)) / (columnSds[j] ?? 1)),
  );
  const centred = prepared.y.map((value) => value - yMean);

  const solveFor = (lambda: number, rows: number[][], targets: number[]): Float64Array | null => {
    // (Z'Z + lambda I) beta = Z'y, solved by Cholesky since the left side is positive definite.
    const gram = new Float64Array(p * p);
    const rhs = new Float64Array(p);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row === undefined) continue;
      const target = targets[i] ?? 0;
      for (let a = 0; a < p; a += 1) {
        rhs[a] = (rhs[a] ?? 0) + (row[a] ?? 0) * target;
        for (let b = 0; b < p; b += 1) {
          gram[a * p + b] = (gram[a * p + b] ?? 0) + (row[a] ?? 0) * (row[b] ?? 0);
        }
      }
    }
    for (let a = 0; a < p; a += 1) gram[a * p + a] = (gram[a * p + a] ?? 0) + lambda;
    return choleskySolve(gram, rhs, p);
  };

  const lambdas = options.lambdas ?? [0.01, 0.1, 1, 3, 10, 30, 100, 300, 1000];
  const folds = Math.max(2, Math.min(options.folds ?? 5, n));
  const path: { lambda: number; cvError: number }[] = [];
  let chosen = options.lambda;

  if (chosen === undefined) {
    for (const lambda of lambdas) {
      let error = 0;
      let counted = 0;
      for (let fold = 0; fold < folds; fold += 1) {
        const trainRows: number[][] = [];
        const trainTargets: number[] = [];
        const testRows: number[][] = [];
        const testTargets: number[] = [];
        for (let i = 0; i < n; i += 1) {
          const row = z[i];
          if (row === undefined) continue;
          if (i % folds === fold) {
            testRows.push(row);
            testTargets.push(centred[i] ?? 0);
          } else {
            trainRows.push(row);
            trainTargets.push(centred[i] ?? 0);
          }
        }
        const beta = solveFor(lambda, trainRows, trainTargets);
        if (beta === null) continue;
        for (let i = 0; i < testRows.length; i += 1) {
          const row = testRows[i];
          if (row === undefined) continue;
          let prediction = 0;
          for (let j = 0; j < p; j += 1) prediction += (row[j] ?? 0) * (beta[j] ?? 0);
          error += ((testTargets[i] ?? 0) - prediction) ** 2;
          counted += 1;
        }
      }
      path.push({ lambda, cvError: counted === 0 ? Number.NaN : error / counted });
    }
    chosen = path.reduce(
      (best, entry) =>
        Number.isFinite(entry.cvError) && entry.cvError < best.cvError ? entry : best,
      { lambda: lambdas[0] ?? 1, cvError: Number.POSITIVE_INFINITY },
    ).lambda;
  }

  const beta = solveFor(chosen, z, centred);
  if (beta === null) return null;

  let rss = 0;
  let tss = 0;
  for (let i = 0; i < n; i += 1) {
    const row = z[i];
    if (row === undefined) continue;
    let prediction = 0;
    for (let j = 0; j < p; j += 1) prediction += (row[j] ?? 0) * (beta[j] ?? 0);
    rss += ((centred[i] ?? 0) - prediction) ** 2;
    tss += (centred[i] ?? 0) ** 2;
  }

  let intercept = yMean;
  const coefficients = names.map((name, j) => {
    const estimate = (beta[j] ?? 0) / (columnSds[j] ?? 1);
    intercept -= estimate * (columnMeans[j] ?? 0);
    return { name, estimate };
  });

  return {
    kind: 'ridge',
    lambda: chosen,
    intercept,
    coefficients,
    rSquared: tss === 0 ? Number.NaN : 1 - rss / tss,
    n,
    path,
  };
}

function choleskySolve(gram: Float64Array, rhs: Float64Array, p: number): Float64Array | null {
  const l = new Float64Array(p * p);
  for (let i = 0; i < p; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let total = gram[i * p + j] ?? 0;
      for (let k = 0; k < j; k += 1) total -= (l[i * p + k] ?? 0) * (l[j * p + k] ?? 0);
      if (i === j) {
        if (total <= 0) return null;
        l[i * p + j] = Math.sqrt(total);
      } else {
        const pivot = l[j * p + j] ?? 0;
        if (pivot === 0) return null;
        l[i * p + j] = total / pivot;
      }
    }
  }
  const forward = new Float64Array(p);
  for (let i = 0; i < p; i += 1) {
    let total = rhs[i] ?? 0;
    for (let k = 0; k < i; k += 1) total -= (l[i * p + k] ?? 0) * (forward[k] ?? 0);
    forward[i] = total / (l[i * p + i] ?? 1);
  }
  const beta = new Float64Array(p);
  for (let i = p - 1; i >= 0; i -= 1) {
    let total = forward[i] ?? 0;
    for (let k = i + 1; k < p; k += 1) total -= (l[k * p + i] ?? 0) * (beta[k] ?? 0);
    beta[i] = total / (l[i * p + i] ?? 1);
  }
  return beta;
}

export interface LogisticModel {
  kind: 'logistic';
  coefficients: Coefficient[];
  n: number;
  logLikelihood: number;
  nullLogLikelihood: number;
  /** McFadden's pseudo R squared. 0.2 is a strong fit here, not a weak one. */
  pseudoRSquared: number;
  aic: number;
  converged: boolean;
  iterations: number;
  intercept: boolean;
}

/**
 * Logistic regression by iteratively reweighted least squares. Used for every
 * binary question the panel supports: will this player start, haul, or keep a
 * clean sheet.
 */
export function logistic(
  y: Series,
  predictors: Series[],
  options: {
    names?: string[];
    intercept?: boolean;
    maxIterations?: number;
    tolerance?: number;
  } = {},
): LogisticModel | null {
  const intercept = options.intercept ?? true;
  const names = options.names ?? predictors.map((_, i) => `x${i + 1}`);
  const prepared = prepare(y, predictors, names, intercept);
  const n = prepared.x.length;
  const p = prepared.x[0]?.length ?? 0;
  if (n <= p || p === 0) return null;

  const beta = new Float64Array(p);
  const maxIterations = options.maxIterations ?? 50;
  const tolerance = options.tolerance ?? 1e-9;
  let converged = false;
  let iterations = 0;
  const covarianceMatrix = new Float64Array(p * p);

  for (; iterations < maxIterations; iterations += 1) {
    const weights = new Float64Array(n);
    const working = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const row = prepared.x[i];
      if (row === undefined) continue;
      let eta = 0;
      for (let j = 0; j < p; j += 1) eta += (row[j] ?? 0) * (beta[j] ?? 0);
      const mu = 1 / (1 + Math.exp(-eta));
      // A weight at the floor means a perfectly separated point; clamping keeps
      // the solve finite rather than diverging on it.
      const weight = Math.max(mu * (1 - mu), 1e-10);
      weights[i] = weight;
      working[i] = eta + ((prepared.y[i] ?? 0) - mu) / weight;
    }

    const gram = new Float64Array(p * p);
    const rhs = new Float64Array(p);
    for (let i = 0; i < n; i += 1) {
      const row = prepared.x[i];
      if (row === undefined) continue;
      const weight = weights[i] ?? 0;
      const target = working[i] ?? 0;
      for (let a = 0; a < p; a += 1) {
        rhs[a] = (rhs[a] ?? 0) + weight * (row[a] ?? 0) * target;
        for (let b = 0; b < p; b += 1) {
          gram[a * p + b] = (gram[a * p + b] ?? 0) + weight * (row[a] ?? 0) * (row[b] ?? 0);
        }
      }
    }

    const next = choleskySolve(gram, rhs, p);
    if (next === null) break;
    let delta = 0;
    for (let j = 0; j < p; j += 1) {
      delta = Math.max(delta, Math.abs((next[j] ?? 0) - (beta[j] ?? 0)));
      beta[j] = next[j] ?? 0;
    }
    // Kept from the last successful inversion: the final iteration's weights
    // are the ones the standard errors are read off.
    const inverted = invertPositiveDefinite(gram, p);
    if (inverted !== null) covarianceMatrix.set(inverted);
    if (delta < tolerance) {
      converged = true;
      iterations += 1;
      break;
    }
  }

  let logLikelihood = 0;
  for (let i = 0; i < n; i += 1) {
    const row = prepared.x[i];
    if (row === undefined) continue;
    let eta = 0;
    for (let j = 0; j < p; j += 1) eta += (row[j] ?? 0) * (beta[j] ?? 0);
    const mu = Math.min(Math.max(1 / (1 + Math.exp(-eta)), 1e-12), 1 - 1e-12);
    const target = prepared.y[i] ?? 0;
    logLikelihood += target * Math.log(mu) + (1 - target) * Math.log(1 - mu);
  }

  const positives = prepared.y.reduce((total, value) => total + value, 0);
  const baseRate = Math.min(Math.max(positives / n, 1e-12), 1 - 1e-12);
  const nullLogLikelihood =
    positives * Math.log(baseRate) + (n - positives) * Math.log(1 - baseRate);

  const coefficients: Coefficient[] = [];
  for (let j = 0; j < p; j += 1) {
    const estimate = beta[j] ?? Number.NaN;
    const standardError = Math.sqrt(covarianceMatrix[j * p + j] ?? Number.NaN);
    const z = estimate / standardError;
    coefficients.push({
      name: prepared.names[j] ?? `x${j}`,
      estimate,
      standardError,
      t: z,
      pValue: 2 * (1 - normalCdf(Math.abs(z))),
      lower: estimate - 1.959963985 * standardError,
      upper: estimate + 1.959963985 * standardError,
    });
  }

  return {
    kind: 'logistic',
    coefficients,
    n,
    logLikelihood,
    nullLogLikelihood,
    pseudoRSquared: 1 - logLikelihood / nullLogLikelihood,
    aic: -2 * logLikelihood + 2 * p,
    converged,
    iterations,
    intercept,
  };
}

function invertPositiveDefinite(gram: Float64Array, p: number): Float64Array | null {
  const out = new Float64Array(p * p);
  for (let column = 0; column < p; column += 1) {
    const unit = new Float64Array(p);
    unit[column] = 1;
    const solved = choleskySolve(gram, unit, p);
    if (solved === null) return null;
    for (let row = 0; row < p; row += 1) out[row * p + column] = solved[row] ?? 0;
  }
  return out;
}

export function predictLogistic(model: LogisticModel, row: number[]): number {
  const values = model.intercept ? [1, ...row] : row;
  let eta = 0;
  model.coefficients.forEach((coefficient, index) => {
    eta += coefficient.estimate * (values[index] ?? 0);
  });
  return 1 / (1 + Math.exp(-eta));
}

/**
 * Variance inflation factors. Above 5 the coefficient is being shared between
 * two columns measuring the same thing, which is common here: price, ownership,
 * and last season's points move together.
 */
export function vif(predictors: Series[], names?: string[]): { name: string; vif: number }[] {
  return predictors.map((column, index) => {
    const others = predictors.filter((_, i) => i !== index);
    if (others.length === 0) return { name: names?.[index] ?? `x${index + 1}`, vif: 1 };
    const model = ols(column, others, { intercept: true });
    const r2 = model?.rSquared ?? 0;
    return {
      name: names?.[index] ?? `x${index + 1}`,
      vif: r2 >= 1 ? Number.POSITIVE_INFINITY : 1 / (1 - r2),
    };
  });
}

/**
 * Locally estimated scatterplot smoothing: a line through a cloud that assumes
 * no functional form, which is what a scatter of 250,000 points needs before
 * anyone claims the relationship is linear.
 */
export function loess(
  x: Series,
  y: Series,
  options: { span?: number; points?: number } = {},
): { x: number; y: number }[] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < x.length; i += 1) {
    const a = x[i];
    const b = y[i];
    if (a === null || a === undefined || !Number.isFinite(a)) continue;
    if (b === null || b === undefined || !Number.isFinite(b)) continue;
    xs.push(a);
    ys.push(b);
  }
  const n = xs.length;
  if (n < 3) return [];

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => at(xs, a) - at(xs, b));
  const sortedX = order.map((i) => at(xs, i));
  const sortedY = order.map((i) => at(ys, i));

  const span = Math.min(1, Math.max(0.05, options.span ?? 0.3));
  const window = Math.max(3, Math.floor(span * n));
  const points = Math.max(8, Math.min(200, options.points ?? 60));
  const out: { x: number; y: number }[] = [];

  for (let p = 0; p < points; p += 1) {
    const target = at(sortedX, 0) + ((at(sortedX, n - 1) - at(sortedX, 0)) * p) / (points - 1);
    // Nearest neighbours by a binary search plus a two sided walk.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at(sortedX, mid) < target) lo = mid + 1;
      else hi = mid;
    }
    let left = lo;
    let right = lo;
    while (right - left + 1 < window && (left > 0 || right < n - 1)) {
      const leftDistance =
        left > 0 ? Math.abs(target - at(sortedX, left - 1)) : Number.POSITIVE_INFINITY;
      const rightDistance =
        right < n - 1 ? Math.abs(at(sortedX, right + 1) - target) : Number.POSITIVE_INFINITY;
      if (leftDistance <= rightDistance) left -= 1;
      else right += 1;
    }

    const maxDistance = Math.max(
      Math.abs(target - at(sortedX, left)),
      Math.abs(at(sortedX, right) - target),
      1e-12,
    );

    // Tricube weights, then a weighted straight line through the neighbourhood.
    let sw = 0;
    let swx = 0;
    let swy = 0;
    let swxx = 0;
    let swxy = 0;
    for (let i = left; i <= right; i += 1) {
      const distance = Math.abs(at(sortedX, i) - target) / maxDistance;
      const weight = (1 - distance ** 3) ** 3;
      if (!(weight > 0)) continue;
      const xi = at(sortedX, i);
      const yi = at(sortedY, i);
      sw += weight;
      swx += weight * xi;
      swy += weight * yi;
      swxx += weight * xi * xi;
      swxy += weight * xi * yi;
    }
    const denominator = sw * swxx - swx * swx;
    const slope = denominator === 0 ? 0 : (sw * swxy - swx * swy) / denominator;
    const interceptValue = sw === 0 ? Number.NaN : (swy - slope * swx) / sw;
    out.push({ x: target, y: interceptValue + slope * target });
  }
  return out;
}

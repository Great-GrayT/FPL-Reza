/**
 * The message contract between the Lab's interface and its worker.
 *
 * Every panel speaks through this file and nothing else, which is what keeps
 * the main thread free of both hyparquet and `@fpl/quant`: the interface sends
 * a request describing what it wants, and gets back a plain object it can
 * render. Nothing here carries a function, so every message is structured
 * cloneable and every request is serialisable into a URL.
 */

export interface Scope {
  /** Season partitions to read, as the archive spells them ("2024-25"). */
  seasons: string[];
  /** A filter formula, in the expression language. Empty means every row. */
  filter?: string;
  /** Derived columns, applied before the filter so a filter can use them. */
  derived?: { name: string; formula: string }[];
  /** Minutes floor, the one filter every panel wants and nobody wants to retype. */
  minMinutes?: number;
}

export type Request =
  | { kind: 'load'; seasons: string[] }
  | { kind: 'coverage'; scope: Scope }
  | { kind: 'describe'; scope: Scope; column: string; bins?: number }
  | {
      kind: 'scatter';
      scope: Scope;
      x: string;
      y: string;
      colour?: string;
      sample?: number;
      fit?: 'none' | 'ols' | 'loess';
      seed?: number;
    }
  | {
      kind: 'scatter3d';
      scope: Scope;
      x: string;
      y: string;
      z: string;
      colour?: string;
      sample?: number;
    }
  | {
      kind: 'surface';
      scope: Scope;
      x: string;
      y: string;
      z: string;
      bins: number;
      aggregation: 'mean' | 'median' | 'count' | 'sum';
    }
  | {
      kind: 'correlation';
      scope: Scope;
      columns: string[];
      method: 'pearson' | 'spearman' | 'kendall';
    }
  | {
      kind: 'regress';
      scope: Scope;
      y: string;
      xs: string[];
      model: 'ols' | 'ridge' | 'logistic';
      robust?: boolean;
    }
  | {
      kind: 'compare';
      scope: Scope;
      column: string;
      groupColumn: string;
      left: string;
      right: string;
      test: 'welch' | 'student' | 'mannWhitney' | 'permutation' | 'bootstrap';
      seed?: number;
    }
  | {
      kind: 'series';
      scope: Scope;
      x: 'period' | 'gameweek' | 'season';
      y: string;
      aggregation: 'mean' | 'median' | 'sum' | 'count' | 'p90' | 'sd';
      groupBy?: string;
      /** Rolling window over the aggregated series, in periods. */
      smooth?: number;
    }
  | { kind: 'autocorrelation'; scope: Scope; column: string; lags: number }
  | {
      kind: 'factor';
      scope: Scope;
      formula: string;
      label: string;
      horizon: number;
      buckets: number;
      decayHorizons?: number[];
    }
  | {
      kind: 'backtest';
      scope: Scope;
      formula: string;
      squadSize: number;
      freeTransfers: number;
      transferCost: number;
      captainMultiplier: number;
      seed?: number;
    }
  | {
      kind: 'portfolio';
      scope: Scope;
      season: string;
      budget: number;
      maxPerClub: number;
      clubCorrelation: number;
    }
  | { kind: 'simulateMatch'; homeGoals: number; awayGoals: number; draws: number; seed: number }
  | {
      kind: 'simulatePlayer';
      profiles: {
        name: string;
        position: 'GKP' | 'DEF' | 'MID' | 'FWD';
        startProbability: number;
        expectedGoals: number;
        expectedAssists: number;
        cleanSheetProbability: number;
      }[];
      draws: number;
      seed: number;
    }
  | { kind: 'simulateSeason'; draws: number; seed: number; homeAdvantage: number }
  | {
      kind: 'model';
      scope: Scope;
      target: string;
      features: string[];
      algorithm: 'gbm' | 'forest' | 'ridge' | 'logistic' | 'knn' | 'mlp';
      task: 'regression' | 'classification';
      rounds?: number;
      learningRate?: number;
      maxDepth?: number;
      seed?: number;
      explain?: string;
    }
  | { kind: 'cluster'; scope: Scope; columns: string[]; k: number; seed?: number }
  | {
      kind: 'pivot';
      scope: Scope;
      rows: string;
      columns: string;
      value: string;
      aggregation: 'mean' | 'sum' | 'count' | 'median' | 'max';
    }
  | {
      kind: 'table';
      scope: Scope;
      columns: string[];
      sort?: string;
      direction?: 'asc' | 'desc';
      offset?: number;
      limit?: number;
    }
  | { kind: 'export'; scope: Scope; columns: string[]; limit?: number }
  | { kind: 'archive' };

export interface Envelope {
  id: number;
  request: Request;
}

export interface Reply {
  id: number;
  ok: boolean;
  /** Milliseconds the worker spent, which the status bar prints. */
  elapsed: number;
  /** Rows the request ran over, after the scope was applied. */
  rows?: number;
  result?: unknown;
  error?: string;
}

export function scopeKey(scope: Scope): string {
  return JSON.stringify({
    seasons: [...scope.seasons].sort(),
    filter: scope.filter ?? '',
    derived: scope.derived ?? [],
    minMinutes: scope.minMinutes ?? 0,
  });
}

'use client';

/**
 * A finding is a link. Every panel's configuration encodes into the query
 * string, so a reader who has built something can send it rather than describe
 * it, and it reopens exactly as it was, down to the simulation seed.
 *
 * The encoding is a short key per field rather than JSON, because a URL with a
 * base64 blob in it cannot be read, edited, or trusted by the person pasting it.
 */

export type PanelId =
  | 'screener'
  | 'distributions'
  | 'relationships'
  | 'factors'
  | 'time'
  | 'model'
  | 'simulate'
  | 'portfolio'
  | 'backtest'
  | 'space'
  | 'archive';

export interface LabState {
  panel: PanelId;
  seasons: string[];
  filter: string;
  minMinutes: number;
  x: string;
  y: string;
  colour: string;
  columns: string[];
  factor: string;
  horizon: number;
  buckets: number;
  target: string;
  features: string[];
  algorithm: 'gbm' | 'forest' | 'ridge' | 'logistic' | 'knn' | 'mlp';
  seed: number;
  sort: string;
  fit: 'none' | 'ols' | 'loess';
  method: 'pearson' | 'spearman' | 'kendall';
  z: string;
  aggregation: 'mean' | 'median' | 'sum' | 'count' | 'p90' | 'sd';
  k: number;
}

export const DEFAULT_STATE: LabState = {
  panel: 'screener',
  seasons: ['2023-24', '2024-25', '2025-26'],
  filter: 'minutes > 0',
  minMinutes: 0,
  x: 'expectedGoals',
  y: 'totalPoints',
  colour: 'position',
  columns: [
    'name',
    'season',
    'gameweek',
    'position',
    'team',
    'minutes',
    'totalPoints',
    'bps',
    'price',
  ],
  factor: 'rolling_mean(totalPoints, 6)',
  horizon: 1,
  buckets: 5,
  target: 'forward1',
  features: [
    'rolling_mean(totalPoints, 6)',
    'rolling_mean(minutes, 6)',
    'lag(bps, 1)',
    'price',
    'selectedBy',
  ],
  algorithm: 'gbm',
  seed: 1,
  sort: 'totalPoints',
  fit: 'ols',
  method: 'spearman',
  z: 'minutes',
  aggregation: 'mean',
  k: 4,
};

const KEYS: Record<string, keyof LabState> = {
  p: 'panel',
  s: 'seasons',
  f: 'filter',
  m: 'minMinutes',
  x: 'x',
  y: 'y',
  c: 'colour',
  col: 'columns',
  fa: 'factor',
  h: 'horizon',
  b: 'buckets',
  t: 'target',
  fe: 'features',
  a: 'algorithm',
  sd: 'seed',
  so: 'sort',
  fi: 'fit',
  me: 'method',
  z: 'z',
  ag: 'aggregation',
  k: 'k',
};

const LIST_FIELDS = new Set<keyof LabState>(['seasons', 'columns', 'features']);
const NUMBER_FIELDS = new Set<keyof LabState>(['minMinutes', 'horizon', 'buckets', 'seed', 'k']);

export function encodeState(state: LabState): string {
  const params = new URLSearchParams();
  for (const [key, field] of Object.entries(KEYS)) {
    const value = state[field];
    const fallback = DEFAULT_STATE[field];
    if (LIST_FIELDS.has(field)) {
      const list = value as string[];
      if (list.join('|') === (fallback as string[]).join('|')) continue;
      params.set(key, list.join('|'));
      continue;
    }
    if (String(value) === String(fallback)) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export function decodeState(search: string): LabState {
  const params = new URLSearchParams(search);
  const state: LabState = { ...DEFAULT_STATE, seasons: [...DEFAULT_STATE.seasons] };
  for (const [key, field] of Object.entries(KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    if (LIST_FIELDS.has(field)) {
      const list = raw.split('|').filter((entry) => entry !== '');
      if (list.length > 0) (state[field] as string[]) = list;
      continue;
    }
    if (NUMBER_FIELDS.has(field)) {
      const value = Number(raw);
      if (Number.isFinite(value)) (state[field] as number) = value;
      continue;
    }
    (state[field] as string) = raw;
  }
  return state;
}

const STORAGE_KEY = 'fpl-lab-views-v1';

export interface SavedView {
  name: string;
  query: string;
  savedAt: string;
}

/** Named views, kept in this browser only. Nothing here leaves the machine. */
export function loadViews(): SavedView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SavedView =>
        typeof entry === 'object' && entry !== null && 'name' in entry && 'query' in entry,
    );
  } catch {
    return [];
  }
}

export function saveView(name: string, query: string): SavedView[] {
  const views = loadViews().filter((view) => view.name !== name);
  const next = [{ name, query, savedAt: new Date().toISOString() }, ...views].slice(0, 20);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteView(name: string): SavedView[] {
  const next = loadViews().filter((view) => view.name !== name);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

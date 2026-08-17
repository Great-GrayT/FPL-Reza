import type { Format } from './types.js';

export type Row = Record<string, unknown>;

export interface Codec {
  readonly format: Format;
  readonly extension: string;
  encode(rows: readonly Row[]): Uint8Array | Promise<Uint8Array>;
  decode(bytes: Uint8Array): Row[] | Promise<Row[]>;
}

/**
 * Dates become ISO strings on the way out. Every schema reads them back with
 * `z.coerce.date()`, so the round trip is lossless and format independent.
 */
export function serializeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function serializeRow(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = serializeValue(value);
  }
  return out;
}

/** Union of every key seen, so sparse rows still produce a complete column set. */
export function columnNames(rows: readonly Row[]): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) names.add(key);
  }
  return [...names];
}

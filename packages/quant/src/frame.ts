/**
 * A columnar data frame over typed arrays.
 *
 * The panel this is built for is 253,900 rows by 29 columns. As row objects
 * that is roughly 300 MB of heap and a garbage collection pause on every
 * operation; as columns it is under 30 MB and never moves. Filtering returns a
 * view over the same buffers rather than a copy, so a stack of five filters
 * costs five index arrays, not five copies of the data.
 *
 * Missing values: a numeric column stores NaN, a string column stores the code
 * -1. Both mean "not recorded" and neither is ever coerced to zero or to an
 * empty string, because a mean over zeros is a different claim from a mean over
 * what was actually measured.
 */
import { at, clean, mean, quantileSorted, sorted, standardDeviation, sum } from './internal.js';

export type ColumnKind = 'number' | 'string' | 'boolean';

export interface NumberColumn {
  kind: 'number';
  name: string;
  values: Float64Array;
}

export interface StringColumn {
  kind: 'string';
  name: string;
  /** Dictionary codes; -1 is null. */
  codes: Int32Array;
  dictionary: string[];
}

export interface BooleanColumn {
  kind: 'boolean';
  name: string;
  /** 0 false, 1 true, 2 null. */
  values: Uint8Array;
}

export type Column = NumberColumn | StringColumn | BooleanColumn;

export type Aggregation =
  | 'count'
  | 'nonNull'
  | 'sum'
  | 'mean'
  | 'median'
  | 'min'
  | 'max'
  | 'sd'
  | 'p10'
  | 'p25'
  | 'p75'
  | 'p90'
  | 'first'
  | 'last'
  | 'distinct';

export interface AggregationSpec {
  column: string;
  as?: string;
  aggregation: Aggregation;
}

const MISSING = Number.NaN;

function isMissing(value: number): boolean {
  return Number.isNaN(value);
}

/** One row as a plain object, which is only ever produced at the display edge. */
export type Row = Record<string, number | string | boolean | null>;

export class Frame {
  private readonly columnMap: Map<string, Column>;
  /** Row positions into the underlying buffers. Null means the identity. */
  private readonly index: Int32Array | null;
  private readonly baseLength: number;
  /**
   * Materialised columns for this view. Reading one is O(rows), and a panel
   * reads the same column several times in a single render, so the first read
   * is kept. A frame is immutable once built, so a cached column cannot go
   * stale; the cost is at most one array per column actually read.
   */
  private readonly numericCache = new Map<string, Float64Array>();
  private readonly stringCache = new Map<string, (string | null)[]>();

  private constructor(
    columnMap: Map<string, Column>,
    index: Int32Array | null,
    baseLength: number,
  ) {
    this.columnMap = columnMap;
    this.index = index;
    this.baseLength = baseLength;
  }

  static empty(): Frame {
    return new Frame(new Map(), null, 0);
  }

  /** Build from row objects. Column kinds are inferred from the first non null value. */
  static fromRows(rows: readonly Record<string, unknown>[]): Frame {
    if (rows.length === 0) return Frame.empty();
    const names = new Set<string>();
    // The first row is the common case, but a source that omits a null field
    // would hide a column, so a bounded scan looks wider than one row.
    const scan = Math.min(rows.length, 200);
    for (let i = 0; i < scan; i += 1) {
      const row = rows[i];
      if (row === undefined) continue;
      for (const key of Object.keys(row)) names.add(key);
    }

    const columns = new Map<string, Column>();
    for (const name of names) {
      let kind: ColumnKind = 'number';
      for (const row of rows) {
        const value = row[name];
        if (value === null || value === undefined) continue;
        if (typeof value === 'string') kind = 'string';
        else if (typeof value === 'boolean') kind = 'boolean';
        else if (value instanceof Date) kind = 'number';
        else kind = 'number';
        break;
      }
      columns.set(name, buildColumn(name, kind, rows));
    }
    return new Frame(columns, null, rows.length);
  }

  static fromColumns(columns: Column[], length?: number): Frame {
    const map = new Map<string, Column>();
    for (const column of columns) map.set(column.name, column);
    const first = columns[0];
    const size =
      length ??
      (first === undefined
        ? 0
        : first.kind === 'string'
          ? first.codes.length
          : first.values.length);
    return new Frame(map, null, size);
  }

  get length(): number {
    return this.index === null ? this.baseLength : this.index.length;
  }

  get columns(): string[] {
    return [...this.columnMap.keys()];
  }

  has(name: string): boolean {
    return this.columnMap.has(name);
  }

  kindOf(name: string): ColumnKind | null {
    return this.columnMap.get(name)?.kind ?? null;
  }

  /** The raw column, still in base order. Callers reading a view want values(). */
  rawColumn(name: string): Column | undefined {
    return this.columnMap.get(name);
  }

  /** Row positions of this view into the base buffers. */
  positions(): Int32Array {
    if (this.index !== null) return this.index;
    const identity = new Int32Array(this.baseLength);
    for (let i = 0; i < this.baseLength; i += 1) identity[i] = i;
    return identity;
  }

  /**
   * Numeric values in view order. A string column is returned as its codes and
   * a boolean as 0/1, so any column can feed a chart axis or a model matrix.
   */
  values(name: string): Float64Array {
    const cached = this.numericCache.get(name);
    if (cached !== undefined) return cached;
    const column = this.columnMap.get(name);
    if (column === undefined) return new Float64Array(0);
    const n = this.length;
    const out = new Float64Array(n);
    const index = this.index;
    for (let i = 0; i < n; i += 1) {
      const position = index === null ? i : (index[i] ?? 0);
      if (column.kind === 'number') out[i] = column.values[position] ?? MISSING;
      else if (column.kind === 'string') {
        const code = column.codes[position] ?? -1;
        out[i] = code < 0 ? MISSING : code;
      } else {
        const value = column.values[position] ?? 2;
        out[i] = value === 2 ? MISSING : value;
      }
    }
    this.numericCache.set(name, out);
    return out;
  }

  /** String values in view order, with null preserved. */
  strings(name: string): (string | null)[] {
    const cached = this.stringCache.get(name);
    if (cached !== undefined) return cached;
    const column = this.columnMap.get(name);
    const n = this.length;
    const out: (string | null)[] = new Array<string | null>(n).fill(null);
    if (column === undefined) return out;
    const index = this.index;
    for (let i = 0; i < n; i += 1) {
      const position = index === null ? i : (index[i] ?? 0);
      if (column.kind === 'string') {
        const code = column.codes[position] ?? -1;
        out[i] = code < 0 ? null : (column.dictionary[code] ?? null);
      } else if (column.kind === 'number') {
        const value = column.values[position] ?? MISSING;
        out[i] = isMissing(value) ? null : String(value);
      } else {
        const value = column.values[position] ?? 2;
        out[i] = value === 2 ? null : value === 1 ? 'true' : 'false';
      }
    }
    this.stringCache.set(name, out);
    return out;
  }

  /** Distinct values of a string column, sorted, for a filter's option list. */
  distinct(name: string): string[] {
    const seen = new Set<string>();
    for (const value of this.strings(name)) if (value !== null) seen.add(value);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }

  /** A view holding the rows the mask marks. Buffers are shared, never copied. */
  filter(mask: Uint8Array | ((index: number) => boolean)): Frame {
    const n = this.length;
    const positions = this.positions();
    const kept: number[] = [];
    if (typeof mask === 'function') {
      for (let i = 0; i < n; i += 1) if (mask(i)) kept.push(positions[i] ?? 0);
    } else {
      for (let i = 0; i < n; i += 1) if ((mask[i] ?? 0) === 1) kept.push(positions[i] ?? 0);
    }
    return new Frame(this.columnMap, Int32Array.from(kept), this.baseLength);
  }

  select(names: string[]): Frame {
    const map = new Map<string, Column>();
    for (const name of names) {
      const column = this.columnMap.get(name);
      if (column !== undefined) map.set(name, column);
    }
    return new Frame(map, this.index, this.baseLength);
  }

  drop(names: string[]): Frame {
    const map = new Map(this.columnMap);
    for (const name of names) map.delete(name);
    return new Frame(map, this.index, this.baseLength);
  }

  /**
   * Add a column whose values are given in view order. The result is a new
   * frame with no index, since the added column only exists for these rows.
   */
  withColumn(
    name: string,
    values: ArrayLike<number> | (string | null)[] | (number | null)[],
  ): Frame {
    const n = this.length;
    const materialised = new Map<string, Column>();
    for (const [key, column] of this.columnMap) {
      materialised.set(key, materialise(column, this.positions(), n));
    }
    // A plain array is the ambiguous case: a derived column arrives as either
    // numbers or labels, and Array.isArray alone cannot tell them apart, so the
    // first value that is not missing decides.
    const looksTextual = Array.isArray(values) && values.some((value) => typeof value === 'string');
    if (looksTextual) {
      materialised.set(name, buildStringColumn(name, values as (string | null)[]));
    } else {
      const numbers = values as ArrayLike<number | null>;
      const target = new Float64Array(n);
      for (let i = 0; i < n; i += 1) target[i] = numbers[i] ?? MISSING;
      materialised.set(name, { kind: 'number', name, values: target });
    }
    return new Frame(materialised, null, n);
  }

  /** Order a view. Missing values sort last in both directions, never first. */
  sortBy(name: string, direction: 'asc' | 'desc' = 'asc'): Frame {
    const values = this.values(name);
    const positions = this.positions();
    const order = Array.from({ length: this.length }, (_, i) => i);
    const sign = direction === 'asc' ? 1 : -1;
    order.sort((a, b) => {
      const left = values[a] ?? MISSING;
      const right = values[b] ?? MISSING;
      const leftMissing = isMissing(left);
      const rightMissing = isMissing(right);
      if (leftMissing && rightMissing) return 0;
      if (leftMissing) return 1;
      if (rightMissing) return -1;
      return sign * (left - right);
    });
    return new Frame(
      this.columnMap,
      Int32Array.from(order.map((i) => positions[i] ?? 0)),
      this.baseLength,
    );
  }

  head(count: number): Frame {
    const positions = this.positions().slice(0, Math.max(0, count));
    return new Frame(this.columnMap, positions, this.baseLength);
  }

  slice(from: number, to: number): Frame {
    const positions = this.positions().slice(Math.max(0, from), Math.max(0, to));
    return new Frame(this.columnMap, positions, this.baseLength);
  }

  /** Rows as objects. Only for display: a table shows a page, not a panel. */
  toRows(limit?: number): Row[] {
    const n = limit === undefined ? this.length : Math.min(limit, this.length);
    const names = this.columns;
    const numeric = new Map<string, Float64Array>();
    const text = new Map<string, (string | null)[]>();
    for (const name of names) {
      const column = this.columnMap.get(name);
      if (column === undefined) continue;
      if (column.kind === 'string') text.set(name, this.strings(name));
      else numeric.set(name, this.values(name));
    }
    const rows: Row[] = [];
    for (let i = 0; i < n; i += 1) {
      const row: Row = {};
      for (const name of names) {
        const column = this.columnMap.get(name);
        if (column === undefined) continue;
        if (column.kind === 'string') row[name] = text.get(name)?.[i] ?? null;
        else if (column.kind === 'boolean') {
          const value = numeric.get(name)?.[i] ?? MISSING;
          row[name] = isMissing(value) ? null : value === 1;
        } else {
          const value = numeric.get(name)?.[i] ?? MISSING;
          row[name] = isMissing(value) ? null : value;
        }
      }
      rows.push(row);
    }
    return rows;
  }

  /** Group keys are read as strings, so a number and a label group the same way. */
  groupBy(keys: string[]): GroupedFrame {
    const n = this.length;
    const keyValues = keys.map((key) => this.strings(key));
    const groups = new Map<string, number[]>();
    for (let i = 0; i < n; i += 1) {
      const parts: string[] = [];
      for (const values of keyValues) parts.push(values[i] ?? ' ');
      const signature = parts.join('');
      const bucket = groups.get(signature);
      if (bucket === undefined) groups.set(signature, [i]);
      else bucket.push(i);
    }
    return new GroupedFrame(this, keys, groups);
  }

  /** Inner hash join on one key. The right frame's columns are prefixed on collision. */
  join(other: Frame, on: string, options: { suffix?: string } = {}): Frame {
    const suffix = options.suffix ?? '_right';
    const rightKeys = other.strings(on);
    const rightIndex = new Map<string, number>();
    for (let i = rightKeys.length - 1; i >= 0; i -= 1) {
      const key = rightKeys[i];
      if (key !== null && key !== undefined) rightIndex.set(key, i);
    }

    const leftKeys = this.strings(on);
    const leftKeep: number[] = [];
    const rightKeep: number[] = [];
    for (let i = 0; i < leftKeys.length; i += 1) {
      const key = leftKeys[i];
      if (key === null || key === undefined) continue;
      const match = rightIndex.get(key);
      if (match === undefined) continue;
      leftKeep.push(i);
      rightKeep.push(match);
    }

    // Positions are taken directly rather than through filter(), which would
    // need a membership test per row and turn the join quadratic.
    const leftPositions = this.positions();
    let result = new Frame(
      this.columnMap,
      Int32Array.from(leftKeep.map((i) => leftPositions[i] ?? 0)),
      this.baseLength,
    );
    for (const name of other.columns) {
      if (name === on) continue;
      const target = result.has(name) ? `${name}${suffix}` : name;
      const column = other.rawColumn(name);
      if (column === undefined) continue;
      if (column.kind === 'string') {
        const source = other.strings(name);
        result = result.withColumn(
          target,
          rightKeep.map((i) => source[i] ?? null),
        );
      } else {
        const source = other.values(name);
        const values = new Float64Array(rightKeep.length);
        rightKeep.forEach((position, i) => {
          values[i] = source[position] ?? MISSING;
        });
        result = result.withColumn(target, values);
      }
    }
    return result;
  }

  /** Summary of one column, in this view. */
  summary(name: string): {
    count: number;
    missing: number;
    mean: number;
    sd: number;
    min: number;
    max: number;
  } {
    const values = this.values(name);
    const finite = clean(values);
    const ascending = sorted(finite);
    return {
      count: finite.length,
      missing: values.length - finite.length,
      mean: mean(finite),
      sd: standardDeviation(finite),
      min: ascending.length === 0 ? Number.NaN : at(ascending, 0),
      max: ascending.length === 0 ? Number.NaN : at(ascending, ascending.length - 1),
    };
  }
}

export class GroupedFrame {
  private readonly frame: Frame;
  private readonly keys: string[];
  private readonly groups: Map<string, number[]>;

  constructor(frame: Frame, keys: string[], groups: Map<string, number[]>) {
    this.frame = frame;
    this.keys = keys;
    this.groups = groups;
  }

  get size(): number {
    return this.groups.size;
  }

  /** One row per group: the key columns, a count, and every requested aggregate. */
  agg(specs: AggregationSpec[]): Frame {
    const keyValues = this.keys.map((key) => this.frame.strings(key));
    const sourceValues = new Map<string, Float64Array>();
    for (const spec of specs) {
      if (!sourceValues.has(spec.column))
        sourceValues.set(spec.column, this.frame.values(spec.column));
    }

    const keyOutputs: (string | null)[][] = this.keys.map(() => []);
    const counts: number[] = [];
    const outputs = new Map<string, number[]>();
    const names = specs.map((spec) => spec.as ?? `${spec.column}_${spec.aggregation}`);
    for (const name of names) outputs.set(name, []);

    for (const rows of this.groups.values()) {
      const first = rows[0] ?? 0;
      this.keys.forEach((_, k) => {
        keyOutputs[k]?.push(keyValues[k]?.[first] ?? null);
      });
      counts.push(rows.length);

      specs.forEach((spec, s) => {
        const values = sourceValues.get(spec.column);
        const name = names[s];
        if (values === undefined || name === undefined) return;
        outputs.get(name)?.push(aggregate(spec.aggregation, values, rows));
      });
    }

    let result = Frame.fromColumns(
      this.keys.map((key, k) => buildStringColumn(key, keyOutputs[k] ?? [])),
      this.groups.size,
    );
    result = result.withColumn('count', Float64Array.from(counts));
    for (const name of names) {
      result = result.withColumn(name, Float64Array.from(outputs.get(name) ?? []));
    }
    return result;
  }

  /** Group sizes without any aggregation, which is what a crosstab needs. */
  counts(): { key: string; count: number }[] {
    return [...this.groups.entries()].map(([key, rows]) => ({ key, count: rows.length }));
  }
}

function aggregate(aggregation: Aggregation, values: Float64Array, rows: number[]): number {
  if (aggregation === 'count') return rows.length;

  const picked = new Float64Array(rows.length);
  let n = 0;
  for (const row of rows) {
    const value = values[row] ?? MISSING;
    if (isMissing(value)) continue;
    picked[n] = value;
    n += 1;
  }
  const finite = picked.subarray(0, n);
  if (aggregation === 'nonNull') return n;
  if (n === 0) return Number.NaN;

  switch (aggregation) {
    case 'sum':
      return sum(finite);
    case 'mean':
      return mean(finite);
    case 'sd':
      return standardDeviation(finite);
    case 'min':
      return at(sorted(finite), 0);
    case 'max':
      return at(sorted(finite), n - 1);
    case 'median':
      return quantileSorted(sorted(finite), 0.5);
    case 'p10':
      return quantileSorted(sorted(finite), 0.1);
    case 'p25':
      return quantileSorted(sorted(finite), 0.25);
    case 'p75':
      return quantileSorted(sorted(finite), 0.75);
    case 'p90':
      return quantileSorted(sorted(finite), 0.9);
    case 'first':
      return at(finite, 0);
    case 'last':
      return at(finite, n - 1);
    case 'distinct':
      return new Set(Array.from(finite)).size;
    default:
      return Number.NaN;
  }
}

export interface PivotResult {
  rowKey: string;
  columnKey: string;
  rows: string[];
  columns: string[];
  /** Row major, rows.length by columns.length, NaN where a cell has no rows. */
  values: number[][];
}

/** A crosstab: one aggregate per row key and column key pair. */
export function pivot(
  frame: Frame,
  rowKey: string,
  columnKey: string,
  valueColumn: string,
  aggregation: Aggregation = 'mean',
): PivotResult {
  const rowLabels = frame.strings(rowKey);
  const columnLabels = frame.strings(columnKey);
  const values = frame.values(valueColumn);

  const rowNames = [...new Set(rowLabels.filter((label): label is string => label !== null))].sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true }),
  );
  const columnNames = [
    ...new Set(columnLabels.filter((label): label is string => label !== null)),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const rowIndex = new Map(rowNames.map((name, i) => [name, i]));
  const columnIndex = new Map(columnNames.map((name, i) => [name, i]));
  const cells: number[][][] = rowNames.map(() => columnNames.map(() => []));

  for (let i = 0; i < frame.length; i += 1) {
    const rowLabel = rowLabels[i];
    const columnLabel = columnLabels[i];
    if (rowLabel === null || rowLabel === undefined) continue;
    if (columnLabel === null || columnLabel === undefined) continue;
    const r = rowIndex.get(rowLabel);
    const c = columnIndex.get(columnLabel);
    if (r === undefined || c === undefined) continue;
    cells[r]?.[c]?.push(i);
  }

  const out = rowNames.map((_, r) =>
    columnNames.map((__, c) => aggregate(aggregation, values, cells[r]?.[c] ?? [])),
  );

  return { rowKey, columnKey, rows: rowNames, columns: columnNames, values: out };
}

function materialise(column: Column, positions: Int32Array, length: number): Column {
  if (column.kind === 'string') {
    const codes = new Int32Array(length);
    for (let i = 0; i < length; i += 1) codes[i] = column.codes[positions[i] ?? 0] ?? -1;
    return { kind: 'string', name: column.name, codes, dictionary: column.dictionary };
  }
  if (column.kind === 'boolean') {
    const values = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) values[i] = column.values[positions[i] ?? 0] ?? 2;
    return { kind: 'boolean', name: column.name, values };
  }
  const values = new Float64Array(length);
  for (let i = 0; i < length; i += 1) values[i] = column.values[positions[i] ?? 0] ?? MISSING;
  return { kind: 'number', name: column.name, values };
}

function buildColumn(
  name: string,
  kind: ColumnKind,
  rows: readonly Record<string, unknown>[],
): Column {
  if (kind === 'string') {
    return buildStringColumn(
      name,
      rows.map((row) => {
        const value = row[name];
        if (value === null || value === undefined) return null;
        // Anything not already text is JSON encoded rather than stringified,
        // so a nested value reads as its contents instead of [object Object].
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        return JSON.stringify(value);
      }),
    );
  }
  if (kind === 'boolean') {
    const values = new Uint8Array(rows.length);
    rows.forEach((row, i) => {
      const value = row[name];
      values[i] = value === null || value === undefined ? 2 : value === true ? 1 : 0;
    });
    return { kind: 'boolean', name, values };
  }
  const values = new Float64Array(rows.length);
  rows.forEach((row, i) => {
    const value = row[name];
    if (value === null || value === undefined) values[i] = MISSING;
    else if (typeof value === 'number') values[i] = value;
    else if (value instanceof Date) values[i] = value.getTime();
    else if (typeof value === 'boolean') values[i] = value ? 1 : 0;
    else {
      const parsed = Number(value);
      values[i] = Number.isFinite(parsed) ? parsed : MISSING;
    }
  });
  return { kind: 'number', name, values };
}

export function buildStringColumn(name: string, values: (string | null)[]): StringColumn {
  const dictionary: string[] = [];
  const lookup = new Map<string, number>();
  const codes = new Int32Array(values.length);
  values.forEach((value, i) => {
    if (value === null) {
      codes[i] = -1;
      return;
    }
    let code = lookup.get(value);
    if (code === undefined) {
      code = dictionary.length;
      dictionary.push(value);
      lookup.set(value, code);
    }
    codes[i] = code;
  });
  return { kind: 'string', name, codes, dictionary };
}

export function numberColumn(name: string, values: ArrayLike<number>): NumberColumn {
  const target = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) target[i] = values[i] ?? MISSING;
  return { kind: 'number', name, values: target };
}

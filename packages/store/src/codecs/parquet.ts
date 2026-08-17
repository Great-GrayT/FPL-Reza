import { parquetReadObjects } from 'hyparquet';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { columnNames, serializeValue, type Codec, type Row } from '../codec.js';

/** The subset of parquet types this codec emits. Enough for FPL's flat rows. */
type ColumnType = 'BOOLEAN' | 'INT32' | 'DOUBLE' | 'STRING';

const INT32_MAX = 2_147_483_647;

/**
 * Picks the narrowest type that holds every value in the column. Nulls are
 * ignored: every column is written nullable, so they never force a widening.
 */
function inferType(values: readonly unknown[]): ColumnType {
  let sawValue = false;
  let allBoolean = true;
  let allNumber = true;
  let allInt32 = true;

  for (const value of values) {
    if (value === null || value === undefined) continue;
    sawValue = true;
    if (typeof value !== 'boolean') allBoolean = false;
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || Math.abs(value) > INT32_MAX) allInt32 = false;
    } else {
      allNumber = false;
      allInt32 = false;
    }
  }

  if (!sawValue) return 'STRING';
  if (allBoolean) return 'BOOLEAN';
  if (allNumber) return allInt32 ? 'INT32' : 'DOUBLE';
  return 'STRING';
}

/** Anything that is not a scalar of the column's type is carried as JSON text. */
function coerce(value: unknown, type: ColumnType): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'STRING') {
    const serialized = serializeValue(value);
    return typeof serialized === 'string' ? serialized : JSON.stringify(serialized);
  }
  return value;
}

function asAsyncBuffer(bytes: Uint8Array): {
  byteLength: number;
  slice: (start: number, end?: number) => ArrayBuffer;
} {
  const base = bytes.byteOffset;
  return {
    byteLength: bytes.byteLength,
    slice: (start: number, end?: number): ArrayBuffer =>
      bytes.buffer.slice(base + start, base + (end ?? bytes.byteLength)) as ArrayBuffer,
  };
}

/**
 * Columnar storage for datasets that have settled. Roughly an order of
 * magnitude smaller than JSONL on the per gameweek player tables, and column
 * pruning makes analytics scans cheap.
 */
export const parquetCodec: Codec = {
  format: 'parquet',
  extension: 'parquet',

  encode(rows: readonly Row[]): Uint8Array {
    const names = columnNames(rows);
    const columnData = names.map((name) => {
      const raw = rows.map((row) => serializeValue(row[name]) ?? null);
      const type = inferType(raw);
      return {
        name,
        data: raw.map((value) => coerce(value, type)),
        type,
        nullable: true,
      };
    });

    // hyparquet-writer cannot infer a schema with no columns, so an empty
    // dataset is written as a zero byte file and read back as zero rows.
    if (columnData.length === 0) return new Uint8Array(0);

    const buffer = parquetWriteBuffer({ columnData });
    return new Uint8Array(buffer);
  },

  async decode(bytes: Uint8Array): Promise<Row[]> {
    if (bytes.byteLength === 0) return [];
    const rows = await parquetReadObjects({ file: asAsyncBuffer(bytes) });
    return rows as Row[];
  },
};

/**
 * The shapes every model here takes and returns. A dataset is column major
 * because every operation in a tree, a linear fit, or a standardiser walks one
 * feature at a time, and row major would touch a new cache line per row.
 */

export interface Dataset {
  rows: number;
  columns: number;
  /** Column major: feature j of row i is at j * rows + i. NaN is missing. */
  values: Float64Array;
  names: string[];
}

export function datasetFrom(columns: { name: string; values: ArrayLike<number> }[]): Dataset {
  const rows = columns[0]?.values.length ?? 0;
  const values = new Float64Array(rows * columns.length);
  columns.forEach((column, j) => {
    for (let i = 0; i < rows; i += 1) values[j * rows + i] = column.values[i] ?? Number.NaN;
  });
  return { rows, columns: columns.length, values, names: columns.map((column) => column.name) };
}

export function columnOf(dataset: Dataset, index: number): Float64Array {
  return dataset.values.subarray(index * dataset.rows, (index + 1) * dataset.rows);
}

export function rowOf(dataset: Dataset, index: number): Float64Array {
  const out = new Float64Array(dataset.columns);
  for (let j = 0; j < dataset.columns; j += 1)
    out[j] = dataset.values[j * dataset.rows + index] ?? Number.NaN;
  return out;
}

/** A subset of rows, which is how every split, fold, and bag is passed around. */
export type RowIndex = Int32Array;

export function allRows(dataset: Dataset): RowIndex {
  const out = new Int32Array(dataset.rows);
  for (let i = 0; i < dataset.rows; i += 1) out[i] = i;
  return out;
}

export function selectRows(dataset: Dataset, rows: RowIndex): Dataset {
  const values = new Float64Array(rows.length * dataset.columns);
  for (let j = 0; j < dataset.columns; j += 1) {
    for (let i = 0; i < rows.length; i += 1) {
      values[j * rows.length + i] = dataset.values[j * dataset.rows + (rows[i] ?? 0)] ?? Number.NaN;
    }
  }
  return { rows: rows.length, columns: dataset.columns, values, names: dataset.names };
}

export function selectTargets(target: ArrayLike<number>, rows: RowIndex): Float64Array {
  const out = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i += 1) out[i] = target[rows[i] ?? 0] ?? Number.NaN;
  return out;
}

/** Everything a fitted model must be able to do, whatever it is inside. */
export interface Model {
  readonly kind: string;
  predict(dataset: Dataset): Float64Array;
  /** Feature importances where the model has them, otherwise null. */
  importances(): { name: string; importance: number }[] | null;
}

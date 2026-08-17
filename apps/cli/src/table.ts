/**
 * Minimal column aligned table renderer. No external table dependency: FPL CLI
 * output only ever needs left aligned columns with a header and separator.
 */

export interface Table {
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}

export function renderTable(table: Table): string {
  const widths = table.columns.map((column, index) =>
    Math.max(column.length, ...table.rows.map((row) => row[index]?.length ?? 0)),
  );

  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
      .join('  ')
      .trimEnd();

  const header = line(table.columns);
  const separator = widths.map((width) => '-'.repeat(width)).join('  ');

  if (table.rows.length === 0) {
    return [header, separator, '(no rows)'].join('\n');
  }

  return [header, separator, ...table.rows.map((row) => line(row))].join('\n');
}

/**
 * Minimal RFC 4180 reader. Provider CSVs are small and well formed, so a
 * dependency would buy nothing, but quoted fields still have to be handled
 * because team names contain commas.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };

  const endRow = (): void => {
    endField();
    // A trailing newline would otherwise produce a final row of one empty field.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index] ?? '';

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r') {
      index += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Rows keyed by header name. Duplicate headers keep the first occurrence. */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (header === undefined) return [];

  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    for (const [index, name] of header.entries()) {
      if (name === '' || name in record) continue;
      record[name] = row[index] ?? '';
    }
    return record;
  });
}

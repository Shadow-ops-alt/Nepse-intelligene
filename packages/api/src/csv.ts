/**
 * Minimal RFC 4180 CSV reader for the local data files the API reads directly
 * (the import pipeline has its own parser in @stock/providers / @stock/personal).
 *
 * - A field that starts with `"` is quoted: it may contain commas, line breaks
 *   and doubled quotes (`""` → `"`). Text after the closing quote up to the next
 *   delimiter is kept as-is (lenient, like most spreadsheet exports).
 * - A quote inside an unquoted field is literal.
 * - CRLF, LF and lone CR all end a record; a leading UTF-8 BOM is dropped.
 * - It never throws: an unterminated quote runs to the end of the input.
 */
export function parseCsvRows(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStart = true;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      fieldStart = true;
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldStart = true;
      continue;
    }
    field += char;
    fieldStart = false;
  }
  if (!fieldStart || field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Header-keyed records. Header names are trimmed; blank lines are skipped;
 * short rows leave the missing columns as "" and extra cells are ignored.
 */
export function parseCsvRecords(input: string): Array<Record<string, string>> {
  const rows = parseCsvRows(input);
  const header = rows[0]?.map((name) => name.trim()) ?? [];
  const records: Array<Record<string, string>> = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.length === 1 && row[0]!.trim() === "") continue;
    const record: Record<string, string> = {};
    header.forEach((name, column) => {
      if (name) record[name] = row[column] ?? "";
    });
    records.push(record);
  }
  return records;
}

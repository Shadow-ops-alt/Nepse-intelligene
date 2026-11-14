import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse } from "csv-parse/sync";

export type CsvRow = Record<string, string>;

/** Minimal CSV helpers shared by the web normalisers. */
export function readCsv(path: string): CsvRow[] {
  if (!existsSync(path)) return [];
  return parse(readFileSync(path, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: false,
  }) as CsvRow[];
}

export function cell(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function line(
  values: Array<string | number | boolean | null | undefined>,
): string {
  return values.map(cell).join(",");
}

export function writeCsv(
  path: string,
  header: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
): void {
  const content = `${[header.map(cell).join(","), ...rows.map(line)].join("\n")}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export function optionalNumber(value: string | undefined): number | undefined {
  const cleaned = (value ?? "").replaceAll(",", "").trim();
  if (cleaned === "") return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

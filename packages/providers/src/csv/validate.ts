/**
 * Row-level validation for operator-supplied CSV files.
 *
 * These checks exist so an import can tell the operator exactly which row and
 * column is wrong. They never repair, interpolate, or drop a row silently.
 */

export type CsvRow = Record<string, string>;

export interface CsvIssue {
  file: string;
  /** 1-based data row number as a human would count it (header is row 1). */
  row: number;
  column?: string;
  value?: string;
  reason: string;
}

function text(row: CsvRow, key: string): string {
  return (row[key] ?? "").trim();
}

function issue(
  file: string,
  row: number,
  column: string,
  value: string | undefined,
  reason: string,
): CsvIssue {
  return {
    file,
    row,
    column,
    ...(value === undefined ? {} : { value }),
    reason,
  };
}

function numberValue(
  file: string,
  row: number,
  values: CsvRow,
  key: string,
  options: { required?: boolean; min?: number } = {},
): CsvIssue | null {
  const raw = text(values, key);
  if (raw === "") {
    return options.required
      ? issue(file, row, key, raw, "required number is missing")
      : null;
  }
  const cleaned = raw.replace(/,/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    return issue(file, row, key, raw, "not a finite number");
  }
  if (options.min !== undefined && parsed < options.min) {
    return issue(file, row, key, raw, `must be at least ${options.min}`);
  }
  return null;
}

function dateValue(
  file: string,
  row: number,
  values: CsvRow,
  key: string,
  required: boolean,
): CsvIssue | null {
  const raw = text(values, key);
  if (raw === "") {
    return required
      ? issue(file, row, key, raw, "required date is missing")
      : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(raw)) {
    return issue(file, row, key, raw, "expected YYYY-MM-DD or ISO date-time");
  }
  if (Number.isNaN(new Date(raw.replace(" ", "T")).getTime())) {
    return issue(file, row, key, raw, "invalid date");
  }
  return null;
}

function textValue(
  file: string,
  row: number,
  values: CsvRow,
  key: string,
): CsvIssue | null {
  return text(values, key) === ""
    ? issue(file, row, key, "", "required text is missing")
    : null;
}

function push(issues: CsvIssue[], value: CsvIssue | null): void {
  if (value) issues.push(value);
}

function numeric(row: CsvRow, key: string): number {
  const raw = text(row, key).replace(/,/g, "");
  return raw === "" ? Number.NaN : Number(raw);
}

export function validateCompanyRows(
  rows: CsvRow[],
  file = "companies.csv",
): CsvIssue[] {
  const issues: CsvIssue[] = [];
  const symbols = new Set<string>();
  rows.forEach((row, index) => {
    const line = index + 2;
    push(issues, textValue(file, line, row, "id"));
    push(issues, textValue(file, line, row, "symbol"));
    push(issues, textValue(file, line, row, "name"));
    push(issues, textValue(file, line, row, "sector"));
    const symbol = text(row, "symbol").toUpperCase();
    if (symbol && !/^[A-Z0-9._-]{1,24}$/.test(symbol)) {
      issues.push(
        issue(file, line, "symbol", symbol, "expected 1–24 letters/digits/._-"),
      );
    }
    if (symbol && symbols.has(symbol)) {
      issues.push(issue(file, line, "symbol", symbol, "duplicate symbol"));
    }
    symbols.add(symbol);
  });
  return issues;
}

export function validateOhlcRows(
  rows: CsvRow[],
  file = "ohlc.csv",
): CsvIssue[] {
  const issues: CsvIssue[] = [];
  const dates = new Set<string>();
  rows.forEach((row, index) => {
    const line = index + 2;
    const date = text(row, "date") || text(row, "timestamp").slice(0, 10);
    if (!date) {
      issues.push(issue(file, line, "date", "", "required date is missing"));
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      issues.push(issue(file, line, "date", date, "expected YYYY-MM-DD"));
    }
    if (dates.has(date)) {
      issues.push(issue(file, line, "date", date, "duplicate trading date"));
    }
    dates.add(date);

    for (const key of ["open", "high", "low", "close"]) {
      push(
        issues,
        numberValue(file, line, row, key, { required: true, min: 0 }),
      );
    }
    push(issues, numberValue(file, line, row, "volume", { required: true, min: 0 }));
    push(issues, numberValue(file, line, row, "turnover", { min: 0 }));
    push(issues, numberValue(file, line, row, "trades", { min: 0 }));

    const open = numeric(row, "open");
    const high = numeric(row, "high");
    const low = numeric(row, "low");
    const close = numeric(row, "close");
    if ([open, high, low, close].every(Number.isFinite)) {
      if (high < low) {
        issues.push(
          issue(file, line, "high", String(high), "high is below low"),
        );
      }
      const upper = Math.max(open, close);
      const lower = Math.min(open, close);
      if (high < upper) {
        issues.push(
          issue(file, line, "high", String(high), "high is below open/close"),
        );
      }
      if (low > lower) {
        issues.push(
          issue(file, line, "low", String(low), "low is above open/close"),
        );
      }
    }
  });
  return issues;
}

export function validateQuoteRows(
  rows: CsvRow[],
  file = "quotes.csv",
): CsvIssue[] {
  const issues: CsvIssue[] = [];
  const symbols = new Set<string>();
  rows.forEach((row, index) => {
    const line = index + 2;
    push(issues, textValue(file, line, row, "symbol"));
    push(issues, dateValue(file, line, row, "asOf", true));
    for (const key of [
      "ltp",
      "change",
      "changePercent",
      "open",
      "high",
      "low",
      "previousClose",
      "volume",
      "turnover",
    ]) {
      push(issues, numberValue(file, line, row, key, { required: true }));
    }
    push(issues, numberValue(file, line, row, "volume", { min: 0 }));
    push(issues, numberValue(file, line, row, "turnover", { min: 0 }));
    const symbol = text(row, "symbol").toUpperCase();
    if (symbol && symbols.has(symbol)) {
      issues.push(issue(file, line, "symbol", symbol, "duplicate quote"));
    }
    symbols.add(symbol);
  });
  return issues;
}

export function validateSummaryRows(
  rows: CsvRow[],
  file = "market-summary.csv",
): CsvIssue[] {
  const issues: CsvIssue[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    push(issues, dateValue(file, line, row, "asOf", true));
    for (const key of [
      "indexValue",
      "change",
      "changePercent",
      "turnover",
      "sharesTraded",
      "transactions",
      "scripsTraded",
    ]) {
      push(issues, numberValue(file, line, row, key, { required: true }));
    }
  });
  return issues;
}

export function validateSectorRows(
  rows: CsvRow[],
  file = "sector-performance.csv",
): CsvIssue[] {
  const issues: CsvIssue[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    push(issues, textValue(file, line, row, "sector"));
    for (const key of [
      "indexValue",
      "changePercent",
      "turnover",
      "volume",
      "companies",
    ]) {
      push(issues, numberValue(file, line, row, key));
    }
  });
  return issues;
}

export function validateIndexRows(
  rows: CsvRow[],
  file = "indices.csv",
): CsvIssue[] {
  const issues: CsvIssue[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    push(issues, textValue(file, line, row, "symbol"));
    push(issues, textValue(file, line, row, "name"));
  });
  return issues;
}

export function formatIssues(issues: CsvIssue[], limit = 8): string {
  const shown = issues.slice(0, limit).map((entry) => {
    const column = entry.column ? ` (${entry.column})` : "";
    return `${entry.file} row ${entry.row}${column}: ${entry.reason}`;
  });
  if (issues.length > limit) {
    shown.push(`…and ${issues.length - limit} more`);
  }
  return shown.join("; ");
}

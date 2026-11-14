import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Company } from "@stock/core";
import { WebClient } from "./http";
import { readCsv, writeCsv, type CsvRow } from "./csv";
import {
  SHARESANSAR_BASE,
  parseCompanyProfile as parseShareSansarProfile,
  parseCompanyIdentity,
  parseQuarterlyReport,
  parseDataTablesJson,
  parseDividendRows,
  parseAgmRows,
  parseRightShareRows,
  parseArticleRows,
  type ShareSansarCompanyEvent,
  type ShareSansarQuarterlyReport,
} from "./sharesansar";
import {
  MEROLAGANI_BASE,
  parseCompanyProfile as parseMerolaganiProfile,
  parseCorporateActions,
  type MerolaganiCompanyProfile,
  type MerolaganiCorporateAction,
} from "./merolagani";
import type { ShareSansarCompanyProfile } from "./sharesansar";

export const COMPANY_HEADER = [
  "id",
  "symbol",
  "name",
  "sector",
  "instrumentType",
  "status",
  "email",
  "website",
  "regulatoryBody",
  "listedAt",
  "marketCap",
  "sharesOutstanding",
  "paidUpValue",
  "totalPaidUpValue",
  "operationDate",
  "registrar",
  "address",
  "phone",
  "profileSource",
  "profileAsOf",
] as const;

export const FUNDAMENTALS_HEADER = [
  "period",
  "metric",
  "value",
  "unit",
  "currency",
  "fiscalYear",
  "quarter",
  "reportedAt",
  "source",
  "confidence",
  "notes",
] as const;

export const CORPORATE_ACTION_HEADER = [
  "symbol",
  "type",
  "ratio",
  "value",
  "currency",
  "announcedAt",
  "exDate",
  "recordDate",
  "sourceUrl",
  "notes",
] as const;

/**
 * Company-specific events and disclosures. These are kept in their own file
 * because they are not corporate actions (an announcement is not a dividend)
 * and they are not market-wide news. The schema is deliberately generic so a
 * new source category can be added without changing the provider interface.
 */
export const COMPANY_EVENT_HEADER = [
  "symbol",
  "type",
  "date",
  "fiscalYear",
  "title",
  "detail",
  "url",
  "source",
  "classification",
  "notes",
  "fetchedAt",
] as const;

export interface CompanyDetailsOptions {
  dataDir: string;
  symbols?: string[];
  /** Maximum number of companies to fetch; 0 means all selected. */
  limit?: number;
  force?: boolean;
  maxAgeMinutes?: number;
  now?: Date;
  /** Also fetch quarterly statements and company event tabs. Default true. */
  statements?: boolean;
  onProgress?: (message: string) => void;
}

export interface DetailsConflict {
  symbol: string;
  field: string;
  kept: string;
  alternative: string;
  source: string;
}

export interface DetailsFailure {
  symbol: string;
  source: "sharesansar" | "merolagani";
  error: string;
}

export interface CompanyDetailsResult {
  requested: number;
  fetched: number;
  companiesWithProfile: number;
  fundamentalsFiles: number;
  statementFiles: number;
  statementRows: number;
  companyEventRows: number;
  corporateActionRows: number;
  conflicts: DetailsConflict[];
  failures: DetailsFailure[];
  skipped: string[];
  reportPath: string;
  companyFile: string;
  corporateActionsFile: string;
  companyEventsFile: string;
}

interface MergedProfile {
  symbol: string;
  name?: string;
  sector?: string;
  sharesOutstanding?: number;
  paidUpValue?: number;
  totalPaidUpValue?: number;
  operationDate?: string;
  registrar?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  marketCap?: number;
  profileSource: string;
  profileAsOf: string;
  sharesAlternative?: number;
}

function numberText(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  return String(value);
}

function clean(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function validSymbol(value: string): boolean {
  return /^[A-Z0-9._-]{1,24}$/.test(value);
}

function normaliseWebsite(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  return `https://${value}`;
}

function parseCompanyRows(rows: CsvRow[]): Company[] {
  return rows.map((row) => ({
    id: row.id ?? row.symbol ?? "",
    symbol: row.symbol ?? "",
    name: row.name ?? "",
    sector: row.sector ?? "",
    instrumentType: row.instrumentType ?? "",
    status: (row.status || "unknown") as Company["status"],
  }));
}

function lastCloseBySymbol(dataDir: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of readCsv(join(dataDir, "quotes.csv"))) {
    const symbol = (row.symbol ?? "").toUpperCase();
    const close = Number((row.ltp ?? "").replaceAll(",", ""));
    if (symbol && Number.isFinite(close) && close > 0) map.set(symbol, close);
  }
  return map;
}

function pickPrimary<T>(
  primary: T | undefined,
  fallback: T | undefined,
): T | undefined {
  return primary ?? fallback;
}

function reconcile(
  symbol: string,
  ss: ShareSansarCompanyProfile | null,
  ml: MerolaganiCompanyProfile | null,
  fetchedAt: string,
  conflicts: DetailsConflict[],
): MergedProfile | null {
  if (!ss && !ml) return null;
  const sharesOutstanding = pickPrimary(
    ss?.sharesOutstanding,
    ml?.sharesOutstanding,
  );
  if (
    ss?.sharesOutstanding !== undefined &&
    ml?.sharesOutstanding !== undefined &&
    ss.sharesOutstanding > 0 &&
    Math.abs(ss.sharesOutstanding - ml.sharesOutstanding) /
      ss.sharesOutstanding >
      0.0001
  ) {
    conflicts.push({
      symbol,
      field: "sharesOutstanding",
      kept: numberText(ss.sharesOutstanding),
      alternative: numberText(ml.sharesOutstanding),
      source: "ShareSansar (kept) vs Merolagani",
    });
  }
  const name = pickPrimary(ss?.name, ml?.name);
  const sector = pickPrimary(ss?.sector, ml?.sector);
  return {
    symbol,
    ...(name ? { name } : {}),
    ...(sector ? { sector } : {}),
    ...(sharesOutstanding !== undefined ? { sharesOutstanding } : {}),
    ...(pickPrimary(ss?.paidUpValue, ml?.paidUpValue) !== undefined
      ? { paidUpValue: pickPrimary(ss?.paidUpValue, ml?.paidUpValue)! }
      : {}),
    ...(pickPrimary(ss?.totalPaidUpValue, ml?.totalPaidUpValue) !== undefined
      ? {
          totalPaidUpValue: pickPrimary(
            ss?.totalPaidUpValue,
            ml?.totalPaidUpValue,
          )!,
        }
      : {}),
    ...(ss?.operationDate ? { operationDate: ss.operationDate } : {}),
    ...(ss?.registrar ? { registrar: ss.registrar } : {}),
    ...(ss?.address ? { address: ss.address } : {}),
    ...(ss?.phone ? { phone: ss.phone } : {}),
    ...(ss?.email ? { email: ss.email } : {}),
    ...(normaliseWebsite(ss?.website) ? { website: normaliseWebsite(ss?.website)! } : {}),
    ...(ml?.marketCap !== undefined ? { marketCap: ml.marketCap } : {}),
    profileSource: [
      ...(ss ? ["ShareSansar"] : []),
      ...(ml ? ["Merolagani"] : []),
    ].join(" + "),
    profileAsOf: fetchedAt,
    ...(ml?.sharesOutstanding !== undefined
      ? { sharesAlternative: ml.sharesOutstanding }
      : {}),
  };
}

function metricRow(
  period: string,
  metric: string,
  value: number | undefined,
  unit: string,
  options: {
    fiscalYear?: string;
    quarter?: number;
    source: string;
    currency?: string;
    notes?: string;
    reportedAt: string;
  },
): string[] | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return [
    period,
    metric,
    String(value),
    unit,
    options.currency ?? "",
    options.fiscalYear ?? "",
    options.quarter === undefined ? "" : String(options.quarter),
    options.reportedAt.slice(0, 10),
    options.source,
    "unverified",
    options.notes ?? "",
  ];
}

function writeFundamentals(
  dataDir: string,
  symbol: string,
  ml: MerolaganiCompanyProfile,
  reportedAt: string,
): { period: string; metrics: number } | null {
  const period = ml.epsFiscalYear
    ? `FY${ml.epsFiscalYear}`
    : ml.dividendFiscalYear
      ? `FY${ml.dividendFiscalYear}`
      : `snapshot-${reportedAt.slice(0, 10)}`;
  const rows: string[][] = [];
  const add = (row: string[] | null): void => {
    if (row) rows.push(row);
  };
  const fiscalYear = ml.epsFiscalYear ?? ml.dividendFiscalYear;
  add(
    metricRow(period, "eps", ml.eps, "currency", {
      ...(fiscalYear ? { fiscalYear } : {}),
      ...(ml.epsQuarter ? { quarter: ml.epsQuarter } : {}),
      source: "merolagani",
      reportedAt,
      currency: "NPR",
      notes: "Reported EPS as displayed by Merolagani; period is the source's fiscal year/quarter.",
    }),
  );
  add(
    metricRow(period, "peRatio", ml.peRatio, "ratio", {
      ...(fiscalYear ? { fiscalYear } : {}),
      source: "merolagani",
      reportedAt,
    }),
  );
  add(
    metricRow(period, "bookValue", ml.bookValue, "currency", {
      ...(fiscalYear ? { fiscalYear } : {}),
      source: "merolagani",
      reportedAt,
      currency: "NPR",
    }),
  );
  add(
    metricRow(period, "pbv", ml.pbv, "ratio", {
      ...(fiscalYear ? { fiscalYear } : {}),
      source: "merolagani",
      reportedAt,
    }),
  );
  add(
    metricRow(period, "marketCap", ml.marketCap, "currency", {
      ...(fiscalYear ? { fiscalYear } : {}),
      source: "merolagani",
      reportedAt,
      currency: "NPR",
    }),
  );
  add(
    metricRow(period, "sharesOutstanding", ml.sharesOutstanding, "shares", {
      ...(fiscalYear ? { fiscalYear } : {}),
      source: "merolagani",
      reportedAt,
    }),
  );
  add(
    metricRow(period, "marketPrice", ml.marketPrice, "currency", {
      ...(fiscalYear ? { fiscalYear } : {}),
      source: "merolagani",
      reportedAt,
      currency: "NPR",
    }),
  );
  add(
    metricRow(period, "dividendPercent", ml.dividendPercent, "percent", {
      ...(ml.dividendFiscalYear ? { fiscalYear: ml.dividendFiscalYear } : {}),
      source: "merolagani",
      reportedAt,
      notes: "Cash dividend as % of paid-up value.",
    }),
  );
  add(
    metricRow(period, "bonusPercent", ml.bonusPercent, "percent", {
      ...(ml.bonusFiscalYear ? { fiscalYear: ml.bonusFiscalYear } : {}),
      source: "merolagani",
      reportedAt,
      notes: "Bonus share as % of paid-up capital.",
    }),
  );
  if (rows.length === 0) return null;

  const file = join(dataDir, "fundamentals", `${symbol}.csv`);
  const existing = readCsv(file);
  const merged = new Map<string, string[]>();
  for (const row of existing) {
    const key = `${row.period ?? ""}|${row.metric ?? ""}`;
    if (!key.startsWith("|")) merged.set(key, FUNDAMENTALS_HEADER.map((h) => row[h] ?? ""));
  }
  for (const row of rows) merged.set(`${row[0]}|${row[1]}`, row);
  writeCsv(file, [...FUNDAMENTALS_HEADER], [...merged.values()]);
  return { period, metrics: rows.length };
}

function actionKey(
  symbol: string,
  type: string,
  fiscalYear: string | undefined,
  value: number,
): string {
  return `${symbol}|${type}|${fiscalYear ?? ""}|${value}`;
}

function metricSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

const KEY_METRIC_ALIASES: Array<[RegExp, string]> = [
  [/basic earnings per share/i, "eps"],
  [/diluted earnings per share/i, "dilutedEps"],
  [/non-performing loan/i, "npl"],
  [/net worth per share/i, "netWorthPerShare"],
  [/^p\/e ratio/i, "peRatio"],
  [/price to book/i, "pbv"],
  [/return on equity/i, "roe"],
  [/return on assets/i, "roa"],
  [/no\.? of outstanding shares/i, "sharesOutstanding"],
  [/total shareholder'?s equity/i, "totalEquity"],
];

function keyMetricUnit(
  label: string,
): { unit: string; notes: string } {
  if (/earnings per share|net worth per share/i.test(label)) {
    return { unit: "currency", notes: "NPR per share." };
  }
  if (/p\/e|price to book|ratio/i.test(label)) {
    return { unit: "ratio", notes: "" };
  }
  if (/outstanding shares|no\. of shares/i.test(label)) {
    return { unit: "shares", notes: "" };
  }
  if (/in rs/i.test(label)) {
    return { unit: "currency", notes: "Amount in Rs. '000 as displayed." };
  }
  return { unit: "percent", notes: "Percent as displayed." };
}

/**
 * Persist the quarterly statement tabs as prefixed fundamental metrics. The
 * prefixes keep balance-sheet, profit-and-loss and key-metric rows distinct
 * even when the source uses the same label in more than one table.
 */
function writeStatementFundamentals(
  dataDir: string,
  symbol: string,
  report: ShareSansarQuarterlyReport,
  reportedAt: string,
): { rows: number; period?: string } {
  const period =
    report.period ||
    (report.fiscalYear
      ? `FY${report.fiscalYear}${report.quarter ? ` Q${report.quarter}` : ""}`
      : `statement-${reportedAt.slice(0, 10)}`);
  const rows: string[][] = [];
  const used = new Set<string>();
  const add = (
    prefix: "bs" | "pl" | "km",
    statement: ShareSansarQuarterlyReport["balanceSheet"],
    sectionNote: string,
    includeAlias: boolean,
  ): void => {
    for (const entry of statement) {
      if (entry.value === undefined) continue;
      let metric = `${prefix}.${metricSlug(entry.label)}`;
      if (!metric.split(".")[1]) metric = `${prefix}.unlabelled`;
      let suffix = 2;
      while (used.has(metric)) {
        metric = `${prefix}.${metricSlug(entry.label)}_${suffix}`;
        suffix += 1;
      }
      used.add(metric);
      const unit =
        prefix === "km"
          ? keyMetricUnit(entry.label)
          : {
              unit: "currency",
              notes: "Amount in Rs. '000 as displayed in the unaudited quarterly statement.",
            };
      rows.push([
        period,
        metric,
        String(entry.value),
        unit.unit,
        "NPR",
        report.fiscalYear ?? "",
        report.quarter === undefined ? "" : String(report.quarter),
        reportedAt.slice(0, 10),
        "sharesansar",
        "unverified",
        [entry.label, unit.notes, sectionNote].filter(Boolean).join(" · "),
      ]);
      if (prefix === "km" && includeAlias) {
        for (const [pattern, alias] of KEY_METRIC_ALIASES) {
          if (!pattern.test(entry.label)) continue;
          const aliasMetric = `statement.${alias}`;
          if (used.has(aliasMetric)) continue;
          used.add(aliasMetric);
          rows.push([
            period,
            aliasMetric,
            String(entry.value),
            unit.unit,
            "NPR",
            report.fiscalYear ?? "",
            report.quarter === undefined ? "" : String(report.quarter),
            reportedAt.slice(0, 10),
            "sharesansar",
            "unverified",
            `${entry.label} (canonical alias of km.${metricSlug(entry.label)})`,
          ]);
          break;
        }
      }
    }
  };
  add("bs", report.balanceSheet, "Balance sheet as displayed by ShareSansar.", true);
  add("pl", report.profitLoss, "Profit and loss account as displayed by ShareSansar.", true);
  add("km", report.keyMetrics, "Key metrics as displayed by ShareSansar.", true);
  if (rows.length === 0) return { rows: 0 };

  const file = join(dataDir, "fundamentals", `${symbol}.csv`);
  const existing = readCsv(file);
  const merged = new Map<string, string[]>();
  for (const row of existing) {
    const key = `${row.period ?? ""}|${row.metric ?? ""}`;
    if (!key.startsWith("|")) {
      merged.set(key, FUNDAMENTALS_HEADER.map((header) => row[header] ?? ""));
    }
  }
  for (const row of rows) merged.set(`${row[0]}|${row[1]}`, row);
  writeCsv(file, [...FUNDAMENTALS_HEADER], [...merged.values()]);
  return { rows: rows.length, period };
}

function buildCompanyEventRows(
  events: ShareSansarCompanyEvent[],
  symbol: string,
  source: string,
  fetchedAt: string,
): Array<{ key: string; row: string[] }> {
  return events.map((event) => {
    const date = event.date ?? "";
    const key = [
      symbol,
      event.type,
      date,
      event.fiscalYear ?? "",
      event.title.toLowerCase(),
    ].join("|");
    return {
      key,
      row: [
        symbol,
        event.type,
        date,
        event.fiscalYear ?? "",
        event.title,
        event.detail ?? "",
        event.url ?? "",
        source,
        "UNVERIFIED",
        Object.entries(event.fields)
          .map(([name, value]) => `${name}=${value}`)
          .join("; "),
        fetchedAt,
      ],
    };
  });
}


interface SupplementalResult {
  report: { report: ShareSansarQuarterlyReport; fetchedAt: string } | null;
  events: Array<{ event: ShareSansarCompanyEvent; fetchedAt: string }>;
  failures: Array<{ symbol: string; source: "sharesansar"; error: string }>;
}

function dataTableFields(
  companyId: string,
  columns: string[],
  extra: Record<string, string> = {},
): Record<string, string> {
  const fields: Record<string, string> = {
    draw: "1",
    start: "0",
    length: "-1",
    "search[value]": "",
    "search[regex]": "false",
    company: companyId,
    ...extra,
  };
  for (const [index, data] of columns.entries()) {
    fields[`columns[${index}][data]`] = data;
  }
  return fields;
}

const DIVIDEND_COLUMNS = [
  "DT_Row_Index",
  "bonus_share",
  "cash_dividend",
  "total_dividend",
  "announcement_date",
  "bookclose_date",
  "distribution_date",
  "bonus_listing_date",
  "year",
];
const AGM_COLUMNS = [
  "DT_Row_Index",
  "agm",
  "venue_time",
  "bookclose_date",
  "meeting_date",
  "agenda",
];
const RIGHT_COLUMNS = [
  "DT_Row_Index",
  "ratio_value",
  "total_units",
  "issue_price",
  "opening_date",
  "closing_date",
  "final_date",
  "listing_date",
  "issue_manager",
  "status",
  "view",
];
const ARTICLE_COLUMNS = ["published_date", "title"];

async function fetchCompanyTabs(
  client: WebClient,
  symbol: string,
  pageUrl: string,
  html: string,
): Promise<SupplementalResult> {
  const identity = parseCompanyIdentity(html);
  const result: SupplementalResult = {
    report: null,
    events: [],
    failures: [],
  };
  if (!identity.companyId || !identity.csrfToken) {
    result.failures.push({
      symbol,
      source: "sharesansar",
      error:
        "company page did not expose the hidden company id / CSRF token needed for detail tabs",
    });
    return result;
  }

  const headers = {
    "x-csrf-token": identity.csrfToken,
    "x-requested-with": "XMLHttpRequest",
    origin: SHARESANSAR_BASE,
    referer: pageUrl,
  };

  const call = async (
    label: string,
    endpoint: string,
    fields: Record<string, string>,
  ): Promise<string | null> => {
    try {
      const response = await client.postForm(
        `${SHARESANSAR_BASE}/${endpoint}`,
        fields,
        headers,
      );
      const text = response.text.trim();
      if (/"message"\s*:\s*"CSRF token mismatch/i.test(text)) {
        throw new Error("CSRF token was rejected");
      }
      return text;
    } catch (error) {
      result.failures.push({
        symbol,
        source: "sharesansar",
        error: `${label}: ${error instanceof Error ? error.message : String(error)}`,
      });
      return null;
    }
  };

  const event = (
    label: string,
    text: string | null,
    parse: (rows: Array<Record<string, unknown>>) => ShareSansarCompanyEvent[],
    fetchedAt: string,
  ): void => {
    if (!text) return;
    const page = parseDataTablesJson(text);
    if (page.rows.length === 0) {
      if (page.recordsFiltered === undefined && !/^\s*\[/.test(text)) {
        result.failures.push({
          symbol,
          source: "sharesansar",
          error: `${label}: response was not a DataTables payload`,
        });
      }
      return;
    }
    for (const parsed of parse(page.rows)) {
      result.events.push({ event: parsed, fetchedAt });
    }
  };

  const quarterly = await call(
    "quarterly report",
    "company-quarterly-report",
    {
      company: identity.companyId,
      symbol: identity.symbol ?? symbol,
      sector: identity.sector ?? "",
    },
  );
  if (quarterly) {
    const report = parseQuarterlyReport(quarterly, `${SHARESANSAR_BASE}/company/${symbol.toLowerCase()}`);
    if (
      report.balanceSheet.length > 0 ||
      report.profitLoss.length > 0 ||
      report.keyMetrics.length > 0
    ) {
      result.report = { report, fetchedAt: new Date().toISOString() };
    } else {
      result.failures.push({
        symbol,
        source: "sharesansar",
        error: "quarterly report: no statement rows were returned",
      });
    }
  }

  const dividend = await call(
    "dividend history",
    "company-dividend",
    dataTableFields(identity.companyId, DIVIDEND_COLUMNS),
  );
  event("dividend history", dividend, parseDividendRows, new Date().toISOString());

  const agm = await call(
    "AGM history",
    "company-agm",
    dataTableFields(identity.companyId, AGM_COLUMNS),
  );
  event("AGM history", agm, parseAgmRows, new Date().toISOString());

  const right = await call(
    "right share history",
    "company-rightshare",
    dataTableFields(identity.companyId, RIGHT_COLUMNS),
  );
  event("right share history", right, parseRightShareRows, new Date().toISOString());

  const announcements = await call(
    "announcements",
    "company-announcements",
    dataTableFields(identity.companyId, ARTICLE_COLUMNS),
  );
  event(
    "announcements",
    announcements,
    (rows) => parseArticleRows(rows, "announcement"),
    new Date().toISOString(),
  );

  const announcementCategory = await call(
    "financial-report announcements",
    "company-announcement-category",
    dataTableFields(identity.companyId, ARTICLE_COLUMNS, { category: "11" }),
  );
  event(
    "financial-report announcements",
    announcementCategory,
    (rows) => parseArticleRows(rows, "announcement"),
    new Date().toISOString(),
  );

  const companyNews = await call(
    "company news",
    "company-news-category",
    dataTableFields(identity.companyId, ARTICLE_COLUMNS, { category: "19" }),
  );
  event(
    "company news",
    companyNews,
    (rows) => parseArticleRows(rows, "companyNews"),
    new Date().toISOString(),
  );

  return result;
}

export async function acquireCompanyDetails(
  options: CompanyDetailsOptions,
): Promise<CompanyDetailsResult> {
  const runStartedAt = options.now ?? new Date();
  const clock = options.now ? () => options.now! : () => new Date();
  const dataDir = options.dataDir;
  const companyFile = join(dataDir, "companies.csv");
  const companyRows = readCsv(companyFile);
  if (companyRows.length === 0) {
    throw new Error(`companies.csv is missing or empty: ${companyFile}`);
  }
  const companies = parseCompanyRows(companyRows);
  const requestedSymbols = (options.symbols ?? [])
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  let selected = companies.filter((company) => {
    if (!validSymbol(company.symbol)) return false;
    if (requestedSymbols.length > 0) return requestedSymbols.includes(company.symbol);
    return (
      company.instrumentType === "Equity" &&
      (company.status === "active" || company.status === "unknown")
    );
  });
  if (requestedSymbols.length > 0) {
    const found = new Set(selected.map((company) => company.symbol));
    for (const symbol of requestedSymbols) {
      if (!found.has(symbol)) {
        selected.push({
          id: symbol,
          symbol,
          name: symbol,
          sector: "Unclassified",
          instrumentType: "Equity",
          status: "unknown",
        });
      }
    }
  }
  const limit = Math.max(0, options.limit ?? 0);
  if (limit > 0) selected = selected.slice(0, limit);
  selected.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const client = new WebClient({
    outputDir: dataDir,
    hostIntervalsMs: {
      "www.sharesansar.com": 1_200,
      "sharesansar.com": 1_200,
      "merolagani.com": 1_200,
    },
    timeoutMs: 30_000,
    attempts: 3,
    maxAgeMinutes: options.force ? 0 : (options.maxAgeMinutes ?? 720),
    now: clock,
  });

  const conflicts: DetailsConflict[] = [];
  const failures: DetailsFailure[] = [];
  const skipped: string[] = [];
  const mergedProfiles = new Map<string, MergedProfile>();
  const merolaganiProfiles = new Map<
    string,
    { profile: MerolaganiCompanyProfile; fetchedAt: string }
  >();
  const statementEntries = new Map<
    string,
    { report: ShareSansarQuarterlyReport; fetchedAt: string }
  >();
  const eventEntries: Array<{
    symbol: string;
    event: ShareSansarCompanyEvent;
    fetchedAt: string;
  }> = [];
  const actionsBySymbol = new Map<string, MerolaganiCorporateAction[]>();
  const latestClose = lastCloseBySymbol(dataDir);

  let fetched = 0;
  for (const [index, company] of selected.entries()) {
    const symbol = company.symbol.toUpperCase();
    if (!validSymbol(symbol)) {
      skipped.push(`${symbol || "(blank)"}: invalid symbol`);
      continue;
    }
    options.onProgress?.(`company ${index + 1}/${selected.length}: ${symbol}`);
    let ssProfile: ShareSansarCompanyProfile | null = null;
    let mlProfile: MerolaganiCompanyProfile | null = null;
    let ssHtml: string | null = null;
    let mlHtml: string | null = null;
    let fetchedAt = runStartedAt.toISOString();

    const ssUrl = `${SHARESANSAR_BASE}/company/${symbol.toLowerCase()}`;
    const mlUrl = `${MEROLAGANI_BASE}/CompanyDetail.aspx?symbol=${encodeURIComponent(symbol)}`;
    try {
      const page = await client.getText(ssUrl);
      ssHtml = page.text;
      fetchedAt = page.fetchedAt;
      ssProfile = parseShareSansarProfile(page.text, symbol, ssUrl);
    } catch (error) {
      failures.push({
        symbol,
        source: "sharesansar",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      const page = await client.getText(mlUrl);
      mlHtml = page.text;
      fetchedAt = page.fetchedAt;
      mlProfile = parseMerolaganiProfile(page.text, symbol, mlUrl);
    } catch (error) {
      failures.push({
        symbol,
        source: "merolagani",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!ssProfile && !mlProfile) {
      skipped.push(`${symbol}: both public pages were unavailable`);
      continue;
    }

    if (options.statements !== false && ssHtml) {
      options.onProgress?.(`company details ${symbol}: statements and events`);
      const supplemental = await fetchCompanyTabs(client, symbol, ssUrl, ssHtml);
      failures.push(...supplemental.failures);
      if (supplemental.report) {
        statementEntries.set(symbol, supplemental.report);
      }
      for (const entry of supplemental.events) {
        eventEntries.push({ symbol, ...entry });
      }
    }
    if (ssHtml && ssProfile && !ssProfile.sharesOutstanding && !ssProfile.name) {
      skipped.push(`${symbol}: ShareSansar page did not contain a company profile`);
    }
    if (mlHtml && mlProfile && !mlProfile.sharesOutstanding && !mlProfile.eps) {
      skipped.push(`${symbol}: Merolagani page did not contain key ratios`);
    }

    const merged = reconcile(symbol, ssProfile, mlProfile, fetchedAt, conflicts);
    if (!merged) {
      skipped.push(`${symbol}: no usable profile fields`);
      continue;
    }
    if (merged.marketCap === undefined && merged.sharesOutstanding !== undefined) {
      const close = latestClose.get(symbol);
      if (close !== undefined) {
        merged.marketCap = Math.round(merged.sharesOutstanding * close * 100) / 100;
        merged.profileSource += " + derived market cap (shares × last close)";
      }
    }
    fetched += 1;
    mergedProfiles.set(symbol, merged);
    if (mlProfile) {
      merolaganiProfiles.set(symbol, { profile: mlProfile, fetchedAt });
      const actions = parseCorporateActions(mlHtml ?? "", symbol, mlUrl);
      if (actions.length > 0) actionsBySymbol.set(symbol, actions);
    }
  }

  // Update the company master in place. Existing rows for symbols that were
  // not selected are preserved byte-for-byte at the field level.
  const updatedCompanyRows = companyRows.map((row) => {
    const symbol = (row.symbol ?? "").toUpperCase();
    const profile = mergedProfiles.get(symbol);
    if (!profile) return COMPANY_HEADER.map((key) => row[key] ?? "");
    const existingName = row.name ?? "";
    const existingSector = row.sector ?? "";
    const name = existingName && existingName !== symbol
      ? existingName
      : (profile.name ?? existingName);
    const sector =
      existingSector && existingSector !== "Unclassified"
        ? existingSector
        : (profile.sector ?? existingSector);
    return [
      row.id ?? symbol,
      symbol,
      name,
      sector,
      row.instrumentType ?? "Equity",
      row.status ?? "unknown",
      profile.email ?? row.email ?? "",
      profile.website ?? row.website ?? "",
      row.regulatoryBody ?? "",
      row.listedAt ?? "",
      numberText(profile.marketCap ?? Number(row.marketCap || "NaN")),
      numberText(profile.sharesOutstanding),
      numberText(profile.paidUpValue),
      numberText(profile.totalPaidUpValue),
      profile.operationDate ?? "",
      profile.registrar ?? "",
      profile.address ?? "",
      profile.phone ?? "",
      profile.profileSource,
      profile.profileAsOf,
    ];
  });
  writeCsv(companyFile, [...COMPANY_HEADER], updatedCompanyRows);

  let fundamentalsFiles = 0;
  for (const [symbol, entry] of merolaganiProfiles) {
    const result = writeFundamentals(dataDir, symbol, entry.profile, entry.fetchedAt);
    if (result) fundamentalsFiles += 1;
  }

  let statementFiles = 0;
  let statementRows = 0;
  for (const [symbol, entry] of statementEntries) {
    const written = writeStatementFundamentals(
      dataDir,
      symbol,
      entry.report,
      entry.fetchedAt,
    );
    if (written.rows > 0) {
      statementFiles += 1;
      statementRows += written.rows;
    }
  }

  // Company events: append only new keys. The full raw source row is kept in
  // `notes`, so a later schema addition can be backfilled without re-fetching.
  const eventsFile = join(dataDir, "company-events.csv");
  const existingEventRows = readCsv(eventsFile);
  const eventRows = new Map<string, string[]>();
  for (const row of existingEventRows) {
    const key = [
      (row.symbol ?? "").toUpperCase(),
      row.type ?? "",
      row.date ?? "",
      row.fiscalYear ?? "",
      (row.title ?? "").toLowerCase(),
    ].join("|");
    eventRows.set(key, COMPANY_EVENT_HEADER.map((header) => row[header] ?? ""));
  }
  let companyEventRows = 0;
  for (const entry of eventEntries) {
    const rows = buildCompanyEventRows(
      [entry.event],
      entry.symbol,
      "sharesansar",
      entry.fetchedAt,
    );
    for (const item of rows) {
      if (eventRows.has(item.key)) continue;
      eventRows.set(item.key, item.row);
      companyEventRows += 1;
    }
  }
  writeCsv(
    eventsFile,
    [...COMPANY_EVENT_HEADER],
    [...eventRows.values()],
  );

  // Corporate actions: append only genuinely new keys. A changed value for an
  // existing key is reported, never overwritten silently.
  const actionsFile = join(dataDir, "corporate-actions.csv");
  const existingActions = readCsv(actionsFile);
  const actionRows = new Map<
    string,
    { row: string[]; fiscalYear?: string }
  >();
  const fiscalYearFromNotes = (notes: string | undefined): string | undefined => {
    const match = clean(notes ?? "").match(/FY\s*([0-9]{3}\s*[-/]\s*[0-9]{3})/i);
    return match?.[1] ? match[1].replace(/\s+/g, "") : undefined;
  };
  for (const row of existingActions) {
    const fiscalYear = row.fiscalYear || fiscalYearFromNotes(row.notes);
    const key = actionKey(
      (row.symbol ?? "").toUpperCase(),
      row.type ?? "",
      fiscalYear,
      Number(row.value ?? ""),
    );
    actionRows.set(key, {
      row: CORPORATE_ACTION_HEADER.map((header) => row[header] ?? ""),
      ...(fiscalYear ? { fiscalYear } : {}),
    });
  }
  let corporateActionRows = 0;
  for (const [symbol, actions] of actionsBySymbol) {
    for (const action of actions) {
      const key = actionKey(symbol, action.type, action.fiscalYear, action.percent);
      if (actionRows.has(key)) continue;
      const samePeriod = [...actionRows.keys()].find(
        (candidate) =>
          candidate.startsWith(`${symbol}|${action.type}|${action.fiscalYear ?? ""}|`),
      );
      if (samePeriod) {
        const previous = actionRows.get(samePeriod);
        conflicts.push({
          symbol,
          field: `corporateAction:${action.type}:${action.fiscalYear ?? ""}`,
          kept: (previous?.row ?? []).join(" | "),
          alternative: `${action.percent}%`,
          source: "existing canonical value kept; Merolagani reports a different value",
        });
        continue;
      }
      actionRows.set(key, {
        row: [
          symbol,
          action.type,
          `${action.percent}%`,
          String(action.percent),
          action.type === "cashDividend" ? "NPR" : "",
          "",
          "",
          "",
          action.sourceUrl,
          action.fiscalYear
            ? `FY ${action.fiscalYear}; percentage of paid-up value (unofficial)`
            : "percentage of paid-up value (unofficial)",
        ],
        ...(action.fiscalYear ? { fiscalYear: action.fiscalYear } : {}),
      });
      corporateActionRows += 1;
    }
  }
  writeCsv(
    actionsFile,
    [...CORPORATE_ACTION_HEADER],
    [...actionRows.values()].map((entry) => entry.row),
  );

  const reportPath = join(dataDir, "reports", "company-details.json");
  mkdirSync(join(dataDir, "reports"), { recursive: true });
  const report = {
    schemaVersion: 1,
    generatedAt: runStartedAt.toISOString(),
    sources: [
      {
        id: "sharesansar.com",
        url: SHARESANSAR_BASE,
        classification: "UNVERIFIED",
        termsStatus: "unverified",
        note: "Public company pages; no reuse licence. Fields are stored as displayed and are not redistributed under a licence.",
      },
      {
        id: "merolagani.com",
        url: MEROLAGANI_BASE,
        classification: "UNVERIFIED",
        termsStatus: "unverified",
        note: "Public company pages; no reuse licence. Key ratios and dividend history are stored as displayed.",
      },
    ],
    requested: selected.length,
    fetched,
    companiesWithProfile: mergedProfiles.size,
    fundamentalsFiles,
    statementFiles,
    statementRows,
    companyEventRows,
    corporateActionRows,
    conflicts,
    failures,
    skipped,
    symbols: [...mergedProfiles.values()].map((profile) => ({
      symbol: profile.symbol,
      sharesOutstanding: profile.sharesOutstanding ?? null,
      sharesAlternative: profile.sharesAlternative ?? null,
      marketCap: profile.marketCap ?? null,
      profileSource: profile.profileSource,
    })),
    note:
      "Unofficial data. ShareSansar is the primary profile source; Merolagani supplies key ratios and dividend history. Quarterly statements and company events are stored as displayed. Disagreements are reported, not silently resolved.",
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    requested: selected.length,
    fetched,
    companiesWithProfile: mergedProfiles.size,
    fundamentalsFiles,
    statementFiles,
    statementRows,
    companyEventRows,
    corporateActionRows,
    conflicts,
    failures,
    skipped,
    reportPath,
    companyFile,
    corporateActionsFile: actionsFile,
    companyEventsFile: eventsFile,
  };
}

export function companyDetailsHeader(): readonly string[] {
  return COMPANY_HEADER;
}

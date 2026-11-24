#!/usr/bin/env node
/**
 * Enrich stored Merolagani corporate-action snapshots with derived ex-dates
 * from ShareSansar book-closure dates, and add bonus/right actions that the
 * Merolagani dividend table does not carry.
 *
 * The output is DERIVED research data. A book-closure date is not an
 * exchange-published ex-date: every filled date is labelled
 * `dateBasis: "book-closure"` so the API and UI can warn that results may
 * shift by one session. Nothing is guessed: a row without a valid book-closure
 * date, a right row without both ratio and issue price, or a cash dividend
 * without a known paid-up value stays unresolved.
 *
 * Usage:
 *   npx --yes tsx scripts/enrich-corporate-actions.ts --symbols ADBL,NABIL,CHCL
 *   npx --yes tsx scripts/enrich-corporate-actions.ts --all
 *
 * Defaults target a TEMP database. Never point --db at a database the running
 * API is using.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PersonalStore } from "../packages/store/src/store.ts";
import { WebClient } from "../packages/personal/src/web/http.ts";
import {
  SHARESANSAR_BASE,
  parseCompanyIdentity,
  parseDataTablesJson,
  parseDividendRows,
  parseRightShareRows,
  type ShareSansarCompanyEvent,
} from "../packages/personal/src/web/sharesansar.ts";
import { createMeta } from "../packages/core/src/freshness.ts";
import type { ProviderDescriptor } from "../packages/core/src/types.ts";
import {
  resolveCorporateActions,
  type ResolvedCorporateAction,
} from "../packages/analytics/src/adjust.ts";

const PROVIDER_ID = "free-source";
const CAPABILITY = "corporateActions";
const DESKTOP_DB_GZ = resolve(
  process.cwd(),
  "apps/desktop/resources/personal.db.gz",
);
const DEFAULT_DB = "/tmp/nepse-enrich/personal.db";
const DEFAULT_DATA_DIR = "/tmp/nepse-enrich/data";
const DEFAULT_REPORT = "reports/corporate-action-enrichment.json";

interface Options {
  db: string;
  dataDir: string;
  symbols: string[];
  all: boolean;
  force: boolean;
  limit: number;
  report: string;
  dryRun: boolean;
}

interface CachedTabs {
  symbol: string;
  sourceUrl: string;
  fetchedAt: string;
  dividendRows: Array<Record<string, unknown>>;
  rightRows: Array<Record<string, unknown>>;
}

interface SymbolResult {
  symbol: string;
  fetched: boolean;
  cached: boolean;
  dividendRows: number;
  rightRows: number;
  matchedCash: number;
  matchedBonus: number;
  matchedRight: number;
  addedBonus: number;
  addedRight: number;
  unresolved: number;
  failure?: string;
}

interface EnrichmentReport {
  generatedAt: string;
  database: string;
  symbolsRequested: number;
  symbolsScanned: number;
  symbolsWithShareSansarData: number;
  matchedActions: number;
  addedActions: number;
  addedBonus: number;
  addedRight: number;
  unresolvedAfter: number;
  failedFetches: number;
  cachedSymbols: number;
  results: SymbolResult[];
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

function parseArgs(argv: string[]): Options {
  const options: Options = {
    db: process.env.PERSONAL_DB ?? DEFAULT_DB,
    dataDir: process.env.PERSONAL_DATA_DIR ?? DEFAULT_DATA_DIR,
    symbols: [],
    all: false,
    force: false,
    limit: 0,
    report: DEFAULT_REPORT,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} needs a value`);
      index += 1;
      return value;
    };
    if (arg === "--db") options.db = resolve(next());
    else if (arg === "--data-dir") options.dataDir = resolve(next());
    else if (arg === "--symbols") {
      options.symbols = next()
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
    } else if (arg === "--all") options.all = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--limit") options.limit = Number(next());
    else if (arg === "--report") options.report = next();
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: tsx scripts/enrich-corporate-actions.ts [--symbols A,B | --all] [--db path] [--data-dir path] [--force] [--limit N] [--report path] [--dry-run]",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }
  if (!options.all && options.symbols.length === 0) {
    throw new Error("pass --symbols A,B or --all");
  }
  return options;
}

/* ------------------------------------------------------------------ */
/* fiscal-year normalisation and small parsers                          */
/* ------------------------------------------------------------------ */

/** `081-082`, `2081/82`, `FY 2081-2082` -> `2081/82`. */
export function canonicalFiscalYear(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d{2,4})\s*[-\/]\s*(\d{2,4})/);
  if (!match?.[1] || !match[2]) return undefined;
  const firstRaw = Number(match[1]);
  if (!Number.isFinite(firstRaw)) return undefined;
  const first = firstRaw < 1000 ? 2000 + firstRaw : firstRaw;
  const secondRaw = Number(match[2]);
  if (!Number.isFinite(secondRaw)) return undefined;
  const second = secondRaw < 1000 ? 2000 + secondRaw : secondRaw;
  const suffix = second % 100;
  return `${first}/${String(suffix).padStart(2, "0")}`;
}

function isoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  if (!match) return undefined;
  const day = match[0];
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === day
    ? day
    : undefined;
}

function numeric(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const cleaned = String(value).replace(/[,%\s]/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function actionValue(action: Record<string, unknown>): number | undefined {
  return (
    numeric(action.value) ??
    numeric(action.percent) ??
    numeric(String(action.ratio ?? "").replace("%", ""))
  );
}

/**
 * Approximate the Bikram Sambat fiscal year a Gregorian date falls in.
 * The Nepali fiscal year starts around Shrawan 1 (~17 July). This is used only
 * to line up right-share rows, which carry no fiscal-year column; a match is
 * accepted only when it is unique.
 */
function fiscalYearFromDate(day: string | undefined): string | undefined {
  if (!day) return undefined;
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return undefined;
  const month = date.getUTCMonth() + 1;
  const dayOfMonth = date.getUTCDate();
  const bsYear = date.getUTCFullYear() + (month > 4 || (month === 4 && dayOfMonth >= 14) ? 56 : 57);
  const startYear = month > 7 || (month === 7 && dayOfMonth >= 17) ? bsYear : bsYear - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Parse `2:1` (2 existing : 1 new) into new shares per existing share (0.5). */
function rightRatioFromLabel(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const pair = value.trim().match(/^([0-9]*\.?[0-9]+)\s*:\s*([0-9]*\.?[0-9]+)$/);
  if (!pair?.[1] || !pair[2]) return undefined;
  const existing = Number(pair[1]);
  const fresh = Number(pair[2]);
  if (!Number.isFinite(existing) || !Number.isFinite(fresh) || existing <= 0 || fresh <= 0) {
    return undefined;
  }
  return fresh / existing;
}

function tolerance(reference: number): number {
  return Math.max(0.1, Math.abs(reference) * 0.02);
}

/* ------------------------------------------------------------------ */
/* ShareSansar tab fetch                                                */
/* ------------------------------------------------------------------ */

function dataTableFields(
  companyId: string,
  columns: string[],
): Record<string, string> {
  const fields: Record<string, string> = {
    draw: "1",
    start: "0",
    length: "-1",
    "search[value]": "",
    "search[regex]": "false",
    company: companyId,
  };
  for (const [index, data] of columns.entries()) {
    fields[`columns[${index}][data]`] = data;
  }
  return fields;
}

async function fetchTabs(
  client: WebClient,
  symbol: string,
): Promise<CachedTabs> {
  const pageUrl = `${SHARESANSAR_BASE}/company/${symbol.toLowerCase()}`;
  const page = await client.getText(pageUrl, {}, { bypassCache: true });
  const identity = parseCompanyIdentity(page.text);
  if (!identity.companyId || !identity.csrfToken) {
    throw new Error("company page did not expose the company id / CSRF token");
  }
  const headers = {
    "x-csrf-token": identity.csrfToken,
    "x-requested-with": "XMLHttpRequest",
    origin: SHARESANSAR_BASE,
    referer: pageUrl,
  };
  const post = async (endpoint: string, columns: string[]) => {
    const response = await client.postForm(
      `${SHARESANSAR_BASE}/${endpoint}`,
      dataTableFields(identity.companyId!, columns),
      headers,
    );
    if (/"message"\s*:\s*"CSRF token mismatch/i.test(response.text)) {
      throw new Error("CSRF token was rejected");
    }
    return parseDataTablesJson(response.text).rows;
  };
  const dividendRows = await post("company-dividend", DIVIDEND_COLUMNS);
  const rightRows = await post("company-rightshare", RIGHT_COLUMNS);
  return {
    symbol,
    sourceUrl: pageUrl,
    fetchedAt: new Date().toISOString(),
    dividendRows,
    rightRows,
  };
}

function cachePath(dataDir: string, symbol: string): string {
  return join(dataDir, "sharesansar-corporate-actions", `${symbol}.json`);
}

function readCache(dataDir: string, symbol: string): CachedTabs | undefined {
  const path = cachePath(dataDir, symbol);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CachedTabs;
  } catch {
    return undefined;
  }
}

function writeCache(dataDir: string, tabs: CachedTabs): void {
  const path = cachePath(dataDir, tabs.symbol);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(tabs, null, 2)}\n`, "utf8");
}

/* ------------------------------------------------------------------ */
/* matching and enrichment                                              */
/* ------------------------------------------------------------------ */

interface DividendRow {
  fiscalYear?: string;
  bonus?: number;
  cash?: number;
  bookClose?: string;
}

function dividendRowsOf(tabs: CachedTabs): DividendRow[] {
  const rows: DividendRow[] = [];
  for (const event of parseDividendRows(tabs.dividendRows) as ShareSansarCompanyEvent[]) {
    const fields = event.fields;
    rows.push({
      fiscalYear: canonicalFiscalYear(event.fiscalYear ?? fields.year),
      bonus: numeric(fields.bonus_share),
      cash: numeric(fields.cash_dividend),
      bookClose: isoDate(fields.bookclose_date),
    });
  }
  return rows;
}

interface RightRow {
  fiscalYear?: string;
  ratio?: number;
  ratioLabel?: string;
  issuePrice?: number;
  bookClose?: string;
}

function rightRowsOf(tabs: CachedTabs): RightRow[] {
  const rows: RightRow[] = [];
  for (const event of parseRightShareRows(tabs.rightRows) as ShareSansarCompanyEvent[]) {
    const fields = event.fields;
    const bookClose = isoDate(fields.final_date);
    rows.push({
      fiscalYear: fiscalYearFromDate(bookClose),
      ratio: rightRatioFromLabel(fields.ratio_value),
      ratioLabel: fields.ratio_value,
      issuePrice: numeric(fields.issue_price),
      bookClose,
    });
  }
  return rows;
}

function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed === "" ? undefined : trimmed;
}

function enrichSymbol(
  symbol: string,
  actions: Array<Record<string, unknown>>,
  tabs: CachedTabs,
  paidUpValue: number | undefined,
): {
  actions: Array<Record<string, unknown>>;
  result: SymbolResult;
} {
  const dividendRows = dividendRowsOf(tabs);
  const rightRows = rightRowsOf(tabs);
  const result: SymbolResult = {
    symbol,
    fetched: true,
    cached: false,
    dividendRows: dividendRows.length,
    rightRows: rightRows.length,
    matchedCash: 0,
    matchedBonus: 0,
    matchedRight: 0,
    addedBonus: 0,
    addedRight: 0,
    unresolved: 0,
  };
  const updated = actions.map((action) => ({ ...action }));
  const existingFiscalYears = new Set<string>();
  for (const action of updated) {
    const year = canonicalFiscalYear(
      text(action.fiscalYear) ?? text(action.notes),
    );
    if (year) existingFiscalYears.add(year);
  }

  // 1. Fill an ex-date on an existing action when exactly one source row
  //    matches by fiscal year and value.
  for (const action of updated) {
    const type = String(action.type ?? "").toLowerCase();
    const year = canonicalFiscalYear(text(action.fiscalYear) ?? text(action.notes));
    if (!year) continue;
    if (action.exDate) continue;
    const value = actionValue(action);

    if (type === "cashdividend" || type === "dividend" || type === "cash") {
      if (value === undefined) continue;
      const candidates = dividendRows.filter(
        (row) =>
          row.fiscalYear === year &&
          row.cash !== undefined &&
          row.cash > 0 &&
          Math.abs(row.cash - value) <= tolerance(value) &&
          row.bookClose !== undefined,
      );
      if (candidates.length !== 1) continue;
      const match = candidates[0]!;
      action.exDate = match.bookClose;
      action.dateBasis = "book-closure";
      action.bookClosureDate = match.bookClose;
      action.matchSource = "sharesansar";
      action.matchSourceUrl = tabs.sourceUrl;
      const note = `ex-date derived from ShareSansar book closure ${match.bookClose} (approximate book-closure basis)`;
      action.notes = text(action.notes) ? `${text(action.notes)}; ${note}` : note;
      if (paidUpValue !== undefined && paidUpValue > 0 && action.dividendPerShare === undefined) {
        action.dividendPerShare =
          Math.round((value / 100) * paidUpValue * 10000) / 10000;
        action.paidUpValue = paidUpValue;
      }
      result.matchedCash += 1;
      continue;
    }

    if (type === "bonus") {
      if (value === undefined) continue;
      const candidates = dividendRows.filter(
        (row) =>
          row.fiscalYear === year &&
          row.bonus !== undefined &&
          row.bonus > 0 &&
          Math.abs(row.bonus - value) <= tolerance(value) &&
          row.bookClose !== undefined,
      );
      if (candidates.length !== 1) continue;
      const match = candidates[0]!;
      action.exDate = match.bookClose;
      action.dateBasis = "book-closure";
      action.bookClosureDate = match.bookClose;
      action.matchSource = "sharesansar";
      action.matchSourceUrl = tabs.sourceUrl;
      const note = `ex-date derived from ShareSansar book closure ${match.bookClose} (approximate book-closure basis)`;
      action.notes = text(action.notes) ? `${text(action.notes)}; ${note}` : note;
      result.matchedBonus += 1;
      continue;
    }

    if (type === "right") {
      const candidates = rightRows.filter(
        (row) => row.fiscalYear === year && row.bookClose !== undefined,
      );
      if (candidates.length !== 1) continue;
      const match = candidates[0]!;
      action.exDate = match.bookClose;
      action.dateBasis = "book-closure";
      action.bookClosureDate = match.bookClose;
      action.matchSource = "sharesansar";
      action.matchSourceUrl = tabs.sourceUrl;
      const note = `ex-date derived from ShareSansar right-share book closure ${match.bookClose} (approximate book-closure basis)`;
      action.notes = text(action.notes) ? `${text(action.notes)}; ${note}` : note;
      result.matchedRight += 1;
    }
  }

  // 2. Add bonus actions the Merolagani snapshot does not contain. ShareSansar
  //    reports the bonus as a percent of paid-up value.
  const bonusYears = new Set(
    updated
      .filter((action) => String(action.type ?? "").toLowerCase() === "bonus")
      .map((action) =>
        canonicalFiscalYear(text(action.fiscalYear) ?? text(action.notes)),
      )
      .filter((year): year is string => Boolean(year)),
  );
  for (const row of dividendRows) {
    if (!row.fiscalYear || row.bonus === undefined || row.bonus <= 0) continue;
    if (!row.bookClose) continue;
    if (bonusYears.has(row.fiscalYear)) continue;
    bonusYears.add(row.fiscalYear);
    updated.push({
      symbol,
      type: "bonus",
      ratio: `${row.bonus}%`,
      value: row.bonus,
      fiscalYear: row.fiscalYear,
      exDate: row.bookClose,
      dateBasis: "book-closure",
      bookClosureDate: row.bookClose,
      source: "sharesansar",
      sourceUrl: tabs.sourceUrl,
      notes: `FY ${row.fiscalYear}; ${row.bonus}% bonus share from ShareSansar dividend history (book-closure date used as approximate ex-date)`,
    });
    result.addedBonus += 1;
  }

  // 3. Add right issues that carry both a ratio and an issue price.
  const rightYears = new Set(
    updated
      .filter((action) => String(action.type ?? "").toLowerCase() === "right")
      .map((action) =>
        canonicalFiscalYear(text(action.fiscalYear) ?? text(action.notes)),
      )
      .filter((year): year is string => Boolean(year)),
  );
  for (const row of rightRows) {
    if (!row.fiscalYear || !row.bookClose) continue;
    if (row.ratio === undefined || row.issuePrice === undefined || row.issuePrice <= 0) {
      continue;
    }
    if (rightYears.has(row.fiscalYear)) continue;
    rightYears.add(row.fiscalYear);
    updated.push({
      symbol,
      type: "right",
      ratio: row.ratio,
      rightRatioLabel: row.ratioLabel,
      issuePrice: row.issuePrice,
      fiscalYear: row.fiscalYear,
      exDate: row.bookClose,
      dateBasis: "book-closure",
      bookClosureDate: row.bookClose,
      source: "sharesansar",
      sourceUrl: tabs.sourceUrl,
      notes: `FY ${row.fiscalYear}; right ${row.ratioLabel ?? `${row.ratio}:1`} at NPR ${row.issuePrice} from ShareSansar right-share history (book-closure date used as approximate ex-date)`,
    });
    result.addedRight += 1;
  }

  // Count what is still unresolved so the report is honest about the gain.
  const resolution = resolveCorporateActions(updated, {
    symbol,
    ...(paidUpValue !== undefined ? { parValue: paidUpValue } : {}),
  });
  result.unresolved = resolution.unresolved.length;
  return { actions: updated, result };
}

/* ------------------------------------------------------------------ */
/* provenance-preserving write-back                                     */
/* ------------------------------------------------------------------ */

function descriptorFor(provenance: {
  providerId: string;
  sourceType: string;
  termsStatus: string;
  productionReady: boolean;
  classification: string;
}): ProviderDescriptor {
  return {
    id: provenance.providerId,
    name: "Personal free-source provider",
    sourceType: provenance.sourceType as ProviderDescriptor["sourceType"],
    environment: "development",
    termsStatus: provenance.termsStatus as ProviderDescriptor["termsStatus"],
    productionReady: provenance.productionReady,
    reliability: "low",
    priority: 900,
    capabilities: ["corporateActions"],
    configRequired: [],
  };
}

/* ------------------------------------------------------------------ */
/* main                                                                 */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.db)) {
    throw new Error(
      `database ${options.db} does not exist; decompress apps/desktop/resources/personal.db.gz into a temp path first`,
    );
  }
  if (options.db === "/tmp/nepse-v3/personal.db") {
    throw new Error(
      "refusing to modify the live LAN database; copy it to a temp path first",
    );
  }
  const store = new PersonalStore(options.db);
  const companies = new Map(
    store.getCompanies(PROVIDER_ID).map((company) => [
      company.symbol.toUpperCase(),
      company,
    ]),
  );
  const keys = store.listSnapshotKeys(PROVIDER_ID, CAPABILITY);
  const requested =
    options.all || options.symbols.length === 0
      ? keys
      : options.symbols.filter((symbol) => keys.includes(symbol));
  const missing = options.symbols.filter((symbol) => !keys.includes(symbol));
  for (const symbol of missing) {
    console.warn(`${symbol}: no corporateActions snapshot; skipped`);
  }
  let selected = requested;
  if (options.limit > 0) selected = selected.slice(0, options.limit);

  const client = new WebClient({
    outputDir: options.dataDir,
    hostIntervalsMs: {
      "www.sharesansar.com": 1_200,
      "sharesansar.com": 1_200,
    },
    timeoutMs: 30_000,
    attempts: 2,
    maxAgeMinutes: options.force ? 0 : 720,
  });

  const report: EnrichmentReport = {
    generatedAt: new Date().toISOString(),
    database: options.db,
    symbolsRequested: selected.length,
    symbolsScanned: 0,
    symbolsWithShareSansarData: 0,
    matchedActions: 0,
    addedActions: 0,
    addedBonus: 0,
    addedRight: 0,
    unresolvedAfter: 0,
    failedFetches: 0,
    cachedSymbols: 0,
    results: [],
  };

  for (const [index, symbol] of selected.entries()) {
    process.stdout.write(
      `[${index + 1}/${selected.length}] ${symbol}: `,
    );
    const snapshot = store.getSnapshotWithProvenance<unknown[]>(
      PROVIDER_ID,
      CAPABILITY,
      symbol,
    );
    if (!snapshot || !Array.isArray(snapshot.data)) {
      console.log("snapshot is not a list; skipped");
      continue;
    }
    let tabs = options.force ? undefined : readCache(options.dataDir, symbol);
    let fromCache = Boolean(tabs);
    if (!tabs) {
      try {
        tabs = await fetchTabs(client, symbol);
        writeCache(options.dataDir, tabs);
      } catch (error) {
        report.failedFetches += 1;
        report.results.push({
          symbol,
          fetched: false,
          cached: false,
          dividendRows: 0,
          rightRows: 0,
          matchedCash: 0,
          matchedBonus: 0,
          matchedRight: 0,
          addedBonus: 0,
          addedRight: 0,
          unresolved: 0,
          failure: error instanceof Error ? error.message : String(error),
        });
        console.log(`fetch failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }
    if (fromCache) report.cachedSymbols += 1;
    report.symbolsScanned += 1;
    if (tabs.dividendRows.length > 0 || tabs.rightRows.length > 0) {
      report.symbolsWithShareSansarData += 1;
    }
    const paidUpValue = companies.get(symbol)?.paidUpValue;
    const { actions, result } = enrichSymbol(
      symbol,
      snapshot.data as Array<Record<string, unknown>>,
      tabs,
      paidUpValue,
    );
    result.cached = fromCache;
    result.fetched = !fromCache;
    report.results.push(result);
    report.matchedActions +=
      result.matchedCash + result.matchedBonus + result.matchedRight;
    report.addedActions += result.addedBonus + result.addedRight;
    report.addedBonus += result.addedBonus;
    report.addedRight += result.addedRight;
    report.unresolvedAfter += result.unresolved;
    console.log(
      `cash ${result.matchedCash}, bonus ${result.matchedBonus} matched / ${result.addedBonus} added, right ${result.matchedRight} matched / ${result.addedRight} added, unresolved ${result.unresolved}${fromCache ? " (cached)" : ""}`,
    );

    if (!options.dryRun) {
      const descriptor = descriptorFor(snapshot.provenance);
      store.upsertSnapshot(CAPABILITY, symbol, {
        data: actions,
        meta: createMeta({
          descriptor,
          now: new Date(),
          classification: snapshot.provenance.classification as never,
          ...(snapshot.provenance.asOf ? { asOf: snapshot.provenance.asOf } : {}),
        }),
      });
    }
  }

  if (!options.dryRun) {
    mkdirSync(dirname(resolve(options.report)), { recursive: true });
    writeFileSync(
      resolve(options.report),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    console.log(`report: ${resolve(options.report)}`);
  }
  store.close();
  console.log(
    `scanned ${report.symbolsScanned}, matched ${report.matchedActions}, added ${report.addedActions} (bonus ${report.addedBonus}, right ${report.addedRight}), unresolved ${report.unresolvedAfter}, failed ${report.failedFetches}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

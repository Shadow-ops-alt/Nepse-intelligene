import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { WebClient, type FetchResult } from "./http";
import { readCsv, writeCsv, type CsvRow } from "./csv";
import {
  SHARESANSAR_BASE,
  parseMarketSummary,
  parseTodaySharePrice,
  parseIndexOptions,
  parseIndexHistoryJson,
  parseMutualFundNavJson,
  parseUpcomingIssuesJson,
  parseNews as parseShareSansarNews,
  type IndexDefinition,
  type IndexHistoryRow,
  type MutualFundNavRow,
  type ShareSansarPriceRow,
  type UpcomingIssueRow,
} from "./sharesansar";
import {
  MEROLAGANI_BASE,
  parseIndexRows as parseMerolaganiIndexRows,
  parseFloorsheet,
  parseFloorsheetPager,
  parseNews as parseMerolaganiNews,
  type MerolaganiIndexRow,
  type MerolaganiTrade,
} from "./merolagani";
import { FUNDAMENTALS_HEADER } from "./company-details";

/**
 * Bulk acquisition of the remaining unofficial public datasets:
 * market summary, index/sub-index history, sector performance, today's
 * prices, floorsheet, broker flows, news, IPO pipeline and mutual-fund NAV.
 *
 * Rules:
 *  - Only public, anonymously reachable pages are read.
 *  - Existing valid history is never overwritten; differences are reported.
 *  - Missing values stay missing. Nothing is interpolated or fabricated.
 */

export interface BulkOptions {
  dataDir: string;
  /** History start for sub-index/price backfill. Default: five years ago. */
  from?: string;
  /** History end. Default: today. */
  to?: string;
  force?: boolean;
  maxAgeMinutes?: number;
  now?: Date;
  onProgress?: (message: string) => void;
}

export interface BulkConflict {
  dataset: string;
  key: string;
  field: string;
  kept: string;
  alternative: string;
  source: string;
}

export interface BulkFailure {
  dataset: string;
  source: string;
  error: string;
}

export interface BulkResult {
  generatedAt: string;
  marketSummary: boolean;
  indices: { count: number; rows: number; files: number; added: number };
  sectorRows: number;
  prices: { quotes: number; quoteUpdates: number; candles: number; candleAdds: number };
  floorsheet: { date: string | null; trades: number; added: number };
  news: { total: number; added: number };
  ipos: { total: number; added: number };
  mutualFunds: number;
  conflicts: BulkConflict[];
  failureCount: number;
  failures: BulkFailure[];
  skipped: string[];
  files: string[];
  reportPath: string;
  rawSnapshots: string[];
}

const QUOTE_HEADER = [
  "symbol",
  "ltp",
  "change",
  "changePercent",
  "open",
  "high",
  "low",
  "previousClose",
  "volume",
  "turnover",
  "trades",
  "session",
  "asOf",
] as const;

const CANDLE_HEADER = [
  "symbol",
  "timeframe",
  "timestamp",
  "date",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "turnover",
  "trades",
  "adjusted",
  "adjustmentFactor",
] as const;

const SUMMARY_HEADER = [
  "asOf",
  "indexName",
  "indexValue",
  "change",
  "changePercent",
  "turnover",
  "sharesTraded",
  "transactions",
  "scripsTraded",
] as const;

const SECTOR_HEADER = [
  "sector",
  "indexValue",
  "changePercent",
  "turnover",
  "volume",
  "companies",
] as const;

const INDEX_LIST_HEADER = ["symbol", "name", "isSector"] as const;

const FLOORSHEET_HEADER = [
  "contractId",
  "businessDate",
  "symbol",
  "buyerBroker",
  "sellerBroker",
  "quantity",
  "rate",
  "amount",
  "asOf",
] as const;

const NEWS_HEADER = [
  "id",
  "title",
  "url",
  "publishedAt",
  "source",
  "symbols",
  "summary",
] as const;

const IPO_HEADER = [
  "id",
  "companyName",
  "symbol",
  "type",
  "openDate",
  "closeDate",
  "price",
  "units",
  "status",
  "sourceUrl",
  "notes",
] as const;

/** Fallback index ids when the public index page cannot be read. */
const FALLBACK_INDICES: IndexDefinition[] = [
  { id: 12, name: "NEPSE Index", symbol: "NEPSE", isSector: false },
  { id: 16, name: "Sensitive Index", symbol: "SENSITIVE", isSector: false },
  { id: 17, name: "Trading Index", symbol: "TRADING", isSector: true },
  { id: 4, name: "Float Index", symbol: "FLOAT", isSector: false },
  { id: 15, name: "Sensitive Float Index", symbol: "SENSITIVE_FLOAT", isSector: false },
  { id: 1, name: "Banking SubIndex", symbol: "BANKING", isSector: true },
  { id: 2, name: "Development Bank Index", symbol: "DEVELOPMENT_BANK", isSector: true },
  { id: 3, name: "Finance Index", symbol: "FINANCE", isSector: true },
  { id: 5, name: "Hotels And Tourism", symbol: "HOTELS_TOURISM", isSector: true },
  { id: 6, name: "HydroPower Index", symbol: "HYDROPOWER", isSector: true },
  { id: 7, name: "Insurance", symbol: "INSURANCE", isSector: true },
  { id: 8, name: "Life Insurance", symbol: "LIFE_INSURANCE", isSector: true },
  { id: 9, name: "Manufacturing And Processing", symbol: "MANUFACTURING", isSector: true },
  { id: 10, name: "Microfinance Index", symbol: "MICROFINANCE", isSector: true },
  { id: 11, name: "Mutual Fund", symbol: "MUTUAL_FUND", isSector: true },
  { id: 13, name: "Non Life Insurance", symbol: "NON_LIFE_INSURANCE", isSector: true },
  { id: 14, name: "Others Index", symbol: "OTHERS", isSector: true },
  { id: 18, name: "Investment", symbol: "INVESTMENT", isSector: true },
];

const SECTOR_INDEX_SYMBOLS = new Set([
  "BANKING",
  "DEVELOPMENT_BANK",
  "FINANCE",
  "HOTELS_TOURISM",
  "HYDROPOWER",
  "INSURANCE",
  "LIFE_INSURANCE",
  "MANUFACTURING",
  "MICROFINANCE",
  "MUTUAL_FUND",
  "NON_LIFE_INSURANCE",
  "OTHERS",
  "INVESTMENT",
  "TRADING",
]);

const SECTOR_DISPLAY_NAME: Record<string, string> = {
  BANKING: "Commercial Banks",
  DEVELOPMENT_BANK: "Development Banks",
  FINANCE: "Finance",
  HOTELS_TOURISM: "Hotels and Tourism",
  HYDROPOWER: "Hydropower",
  INSURANCE: "Insurance",
  LIFE_INSURANCE: "Life Insurance",
  MANUFACTURING: "Manufacturing and Processing",
  MICROFINANCE: "Microfinance",
  MUTUAL_FUND: "Mutual Fund",
  NON_LIFE_INSURANCE: "Non Life Insurance",
  OTHERS: "Others",
  INVESTMENT: "Investment",
  TRADING: "Trading",
};

const IPO_TYPES: Array<{ type: UpcomingIssueRow["type"]; id: number }> = [
  { type: "ipo", id: 1 },
  { type: "fpo", id: 2 },
  { type: "right", id: 3 },
  { type: "mutualFund", id: 4 },
  { type: "ipo", id: 5 },
  { type: "debenture", id: 7 },
];

/** ShareSansar only returns JSON for its DataTables endpoints when this header is present. */
const AJAX_HEADERS = { "x-requested-with": "XMLHttpRequest" };

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function number(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: number | string | undefined): string {
  if (value === undefined) return "";
  return String(value);
}

function nearlyEqual(a: number, b: number, tolerance = 1e-6): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

function candleTimestamp(date: string): string {
  return `${date}T15:00:00+05:45`;
}

function addConflict(
  conflicts: BulkConflict[],
  conflict: BulkConflict,
): void {
  if (conflicts.length < 2_000) conflicts.push(conflict);
}

/** Merge a daily candle series without replacing valid existing values. */
function mergeCandleFile(
  dataDir: string,
  symbol: string,
  fresh: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    turnover?: number;
    trades?: number;
  }>,
  conflicts: BulkConflict[],
  allowUpdate: boolean,
  kind: "equity" | "index" = "equity",
): { rows: number; added: number; changed: boolean } {
  const file = join(dataDir, kind === "index" ? "indices" : "ohlc", `${symbol}.csv`);
  const existing = readCsv(file);
  const byDate = new Map<string, CsvRow>();
  for (const row of existing) {
    const date = (row.date ?? row.timestamp ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) byDate.set(date, row);
  }
  let added = 0;
  let changed = false;
  for (const candle of fresh) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candle.date)) continue;
    const previous = byDate.get(candle.date);
    if (!previous) {
      byDate.set(candle.date, {
        symbol,
        timeframe: "1day",
        timestamp: candleTimestamp(candle.date),
        date: candle.date,
        open: String(candle.open),
        high: String(candle.high),
        low: String(candle.low),
        close: String(candle.close),
        volume: text(candle.volume ?? 0),
        turnover: text(candle.turnover ?? 0),
        trades: text(candle.trades ?? ""),
        adjusted: "false",
        adjustmentFactor: "1.0",
      });
      added += 1;
      changed = true;
      continue;
    }
    const fields: Array<{
      key: "open" | "high" | "low" | "close" | "volume" | "turnover" | "trades";
      value: number | undefined;
      zeroMeansMissing: boolean;
    }> = [
      { key: "open", value: candle.open, zeroMeansMissing: false },
      { key: "high", value: candle.high, zeroMeansMissing: false },
      { key: "low", value: candle.low, zeroMeansMissing: false },
      { key: "close", value: candle.close, zeroMeansMissing: false },
      { key: "volume", value: candle.volume, zeroMeansMissing: true },
      { key: "turnover", value: candle.turnover, zeroMeansMissing: true },
      { key: "trades", value: candle.trades, zeroMeansMissing: true },
    ];
    for (const field of fields) {
      if (field.value === undefined) continue;
      const before = number(previous[field.key]);
      const missing =
        before === undefined || (field.zeroMeansMissing && before === 0);
      if (missing) {
        previous[field.key] = String(field.value);
        changed = true;
        continue;
      }
      if (!nearlyEqual(before, field.value, 1e-4)) {
        if (allowUpdate && field.key === "close") {
          previous[field.key] = String(field.value);
          changed = true;
        }
        addConflict(conflicts, {
          dataset: "candles",
          key: `${symbol} ${candle.date}`,
          field: field.key,
          kept: String(before),
          alternative: String(field.value),
          source: "existing canonical row kept",
        });
      }
    }
  }
  if (changed) {
    const rows = [...byDate.values()].sort((a, b) =>
      (a.date ?? "").localeCompare(b.date ?? ""),
    );
    writeCsv(
      file,
      [...CANDLE_HEADER],
      rows.map((row) => CANDLE_HEADER.map((key) => row[key] ?? "")),
    );
  }
  return { rows: byDate.size, added, changed };
}

function upsertCsvById(
  file: string,
  header: readonly string[],
  fresh: Array<Record<string, string>>,
  idKey: string,
  conflicts: BulkConflict[],
  dataset: string,
): { total: number; added: number } {
  const existing = readCsv(file);
  const byId = new Map<string, CsvRow>();
  for (const row of existing) {
    const id = (row[idKey] ?? "").trim();
    if (id) byId.set(id, row);
  }
  let added = 0;
  for (const row of fresh) {
    const id = (row[idKey] ?? "").trim();
    if (!id) continue;
    const previous = byId.get(id);
    if (!previous) {
      byId.set(id, row);
      added += 1;
      continue;
    }
    for (const key of header) {
      if (key === idKey) continue;
      const before = (previous[key] ?? "").trim();
      const after = (row[key] ?? "").trim();
      if (before && after && before !== after) {
        addConflict(conflicts, {
          dataset,
          key: id,
          field: key,
          kept: before,
          alternative: after,
          source: "existing canonical row kept",
        });
      } else if (!before && after) {
        previous[key] = after;
      }
    }
  }
  writeCsv(file, [...header], [...byId.values()].map((row) => header.map((key) => row[key] ?? "")));
  return { total: byId.size, added };
}

function latestByDate<T extends { date: string }>(rows: T[]): T | undefined {
  return rows.reduce<T | undefined>(
    (latest, row) => (!latest || row.date > latest.date ? row : latest),
    undefined,
  );
}

export async function acquireBulkData(
  options: BulkOptions,
): Promise<BulkResult> {
  const dataDir = options.dataDir;
  const now = options.now ?? new Date();
  const clock = options.now ? () => options.now! : () => new Date();
  const to = options.to ?? isoDate(now);
  const fromDate = new Date(`${to}T00:00:00Z`);
  fromDate.setUTCFullYear(fromDate.getUTCFullYear() - 5);
  const from = options.from ?? isoDate(fromDate);

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

  const conflicts: BulkConflict[] = [];
  const failures: BulkFailure[] = [];
  const skipped: string[] = [];
  const files: string[] = [];
  const rawSnapshots: string[] = [];
  const progress = (message: string): void => options.onProgress?.(message);

  const fetchText = async (
    dataset: string,
    source: string,
    url: string,
    headers: Record<string, string> = {},
  ): Promise<string | null> => {
    try {
      const page: FetchResult = await client.getText(url, headers);
      rawSnapshots.push(page.snapshotPath);
      return page.text;
    } catch (error) {
      failures.push({
        dataset,
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  // ---------------------------------------------------------------- indices
  const indexPage = await fetchText(
    "indices",
    "sharesansar",
    `${SHARESANSAR_BASE}/index-history-data`,
  );
  let definitions: IndexDefinition[] = indexPage
    ? parseIndexOptions(indexPage)
    : [];
  if (definitions.length === 0) {
    definitions = FALLBACK_INDICES;
    if (indexPage) {
      skipped.push("index options could not be parsed; used the known index id map");
    }
  }

  const indexHistory = new Map<string, IndexHistoryRow[]>();
  for (const [position, definition] of definitions.entries()) {
    progress(`index ${position + 1}/${definitions.length}: ${definition.symbol}`);
    const url =
      `${SHARESANSAR_BASE}/index-history-data?draw=1&start=0&length=-1` +
      `&index_id=${definition.id}&from=${from}&to=${to}`;
    const json = await fetchText("indices", "sharesansar", url, AJAX_HEADERS);
    if (!json) continue;
    const rows = parseIndexHistoryJson(json, definition.id);
    if (rows.length === 0) {
      skipped.push(`${definition.symbol}: index history returned no valid rows`);
      continue;
    }
    indexHistory.set(definition.symbol, rows);
  }

  // Write index history files.
  let indexRows = 0;
  let indexFiles = 0;
  let indexAdds = 0;
  for (const definition of definitions) {
    const rows = indexHistory.get(definition.symbol);
    if (!rows || rows.length === 0) continue;
    const merged = mergeCandleFile(
      dataDir,
      definition.symbol,
      rows.map((row) => ({
        date: row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        ...(row.turnover !== undefined ? { turnover: row.turnover } : {}),
      })),
      conflicts,
      false,
      "index",
    );
    indexRows += merged.rows;
    indexAdds += merged.added;
    if (merged.changed) indexFiles += 1;
  }

  // Extend the index list without modifying known entries.
  const indexListFile = join(dataDir, "indices.csv");
  const knownIndices = new Map<string, CsvRow>();
  for (const row of readCsv(indexListFile)) {
    const symbol = (row.symbol ?? "").toUpperCase();
    if (symbol) knownIndices.set(symbol, row);
  }
  for (const definition of definitions) {
    if (!indexHistory.has(definition.symbol)) continue;
    if (knownIndices.has(definition.symbol)) continue;
    knownIndices.set(definition.symbol, {
      symbol: definition.symbol,
      name: definition.name,
      isSector: definition.isSector ? "true" : "false",
    });
  }
  writeCsv(
    indexListFile,
    [...INDEX_LIST_HEADER],
    [...knownIndices.values()].map((row) =>
      INDEX_LIST_HEADER.map((key) => row[key] ?? ""),
    ),
  );
  files.push("indices.csv", "indices/");

  // ------------------------------------------------------------ market summary
  progress("market summary");
  const summaryHtml = await fetchText(
    "marketSummary",
    "sharesansar",
    `${SHARESANSAR_BASE}/market-summary`,
  );
  const summary = summaryHtml ? parseMarketSummary(summaryHtml) : null;

  let merolaganiIndices: MerolaganiIndexRow[] = [];
  const merolaganiIndexHtml = await fetchText(
    "marketSummary",
    "merolagani",
    `${MEROLAGANI_BASE}/Indices.aspx`,
  );
  if (merolaganiIndexHtml) {
    merolaganiIndices = parseMerolaganiIndexRows(merolaganiIndexHtml);
  }

  const nepseHistory = indexHistory.get("NEPSE") ?? [];
  const nepseLatest = latestByDate(nepseHistory);
  const mlLatest = latestByDate(merolaganiIndices);
  let marketSummary = false;
  let summaryAsOf: string | null = null;
  if (summary && summary.asOfDate) {
    const mr = mlLatest && mlLatest.date === summary.asOfDate ? mlLatest : undefined;
    const indexValue = nepseLatest?.date === summary.asOfDate
      ? nepseLatest.close
      : mr?.value ?? nepseLatest?.close;
    const change = nepseLatest?.date === summary.asOfDate
      ? nepseLatest.change
      : mr?.change ?? nepseLatest?.change;
    const changePercent = nepseLatest?.date === summary.asOfDate
      ? nepseLatest.changePercent
      : mr?.changePercent ?? nepseLatest?.changePercent;
    if (
      indexValue !== undefined &&
      change !== undefined &&
      changePercent !== undefined &&
      summary.turnover !== undefined &&
      summary.sharesTraded !== undefined &&
      summary.transactions !== undefined &&
      summary.scripsTraded !== undefined
    ) {
      if (
        mr &&
        nepseLatest &&
        mr.date === nepseLatest.date &&
        !nearlyEqual(mr.value, nepseLatest.close, 5e-4)
      ) {
        addConflict(conflicts, {
          dataset: "marketSummary",
          key: summary.asOfDate,
          field: "nepseIndexValue",
          kept: String(nepseLatest.close),
          alternative: String(mr.value),
          source: "ShareSansar index history kept; Merolagani cross-check differs",
        });
      }
      const asOf = `${summary.asOfDate}T15:00:00+05:45`;
      writeCsv(join(dataDir, "market-summary.csv"), [...SUMMARY_HEADER], [
        [
          asOf,
          "NEPSE",
          indexValue,
          change,
          changePercent,
          summary.turnover,
          summary.sharesTraded,
          summary.transactions,
          summary.scripsTraded,
        ],
      ]);
      marketSummary = true;
      summaryAsOf = summary.asOfDate;
      files.push("market-summary.csv");
    } else {
      skipped.push(
        "market summary available, but NEPSE index value/change could not be matched to the summary date",
      );
    }
  }

  // ------------------------------------------------------- sector performance
  const sectorRows: string[][] = [];
  for (const definition of definitions) {
    if (!SECTOR_INDEX_SYMBOLS.has(definition.symbol)) continue;
    const rows = indexHistory.get(definition.symbol);
    const latest = rows ? latestByDate(rows) : undefined;
    if (!latest) continue;
    if (summaryAsOf && latest.date !== summaryAsOf) continue;
    sectorRows.push([
      SECTOR_DISPLAY_NAME[definition.symbol] ?? definition.name,
      String(latest.close),
      latest.changePercent === undefined ? "" : String(latest.changePercent),
      latest.turnover === undefined ? "" : String(latest.turnover),
      "",
      "",
    ]);
  }
  if (sectorRows.length > 0) {
    writeCsv(join(dataDir, "sector-performance.csv"), [...SECTOR_HEADER], sectorRows);
    files.push("sector-performance.csv");
  }

  // ------------------------------------------------------------ today prices
  progress("today's prices");
  const priceHtml = await fetchText(
    "prices",
    "sharesansar",
    `${SHARESANSAR_BASE}/today-share-price`,
  );
  const priceRows: ShareSansarPriceRow[] = priceHtml
    ? parseTodaySharePrice(priceHtml)
    : [];
  let quoteUpdates = 0;
  let candleAdds = 0;
  if (priceHtml && priceRows.length === 0) {
    skipped.push("today's price page contained no valid rows");
  }
  if (priceRows.length > 0) {
    const priceDate = summaryAsOf ?? to;
    const asOf = `${priceDate}T15:00:00+05:45`;
    const quoteFile = join(dataDir, "quotes.csv");
    const existingQuotes = new Map<string, CsvRow>();
    for (const row of readCsv(quoteFile)) {
      const symbol = (row.symbol ?? "").toUpperCase();
      if (symbol) existingQuotes.set(symbol, row);
    }
    const candleRowsBySymbol = new Map<string, ShareSansarPriceRow[]>();
    for (const row of priceRows) {
      const previous = existingQuotes.get(row.symbol);
      const previousAsOf = (previous?.asOf ?? "").slice(0, 10);
      if (previousAsOf && previousAsOf > priceDate) {
        addConflict(conflicts, {
          dataset: "quotes",
          key: row.symbol,
          field: "asOf",
          kept: previousAsOf,
          alternative: priceDate,
          source: "existing quote is newer; not replaced",
        });
        continue;
      }
      if (previous) {
        const before = number(previous.ltp);
        if (
          previousAsOf === priceDate &&
          before !== undefined &&
          !nearlyEqual(before, row.ltp, 1e-4)
        ) {
          addConflict(conflicts, {
            dataset: "quotes",
            key: row.symbol,
            field: "ltp",
            kept: String(before),
            alternative: String(row.ltp),
            source: "source snapshot replaced by newer ShareSansar value",
          });
        }
        quoteUpdates += 1;
      }
      existingQuotes.set(row.symbol, {
        symbol: row.symbol,
        ltp: String(row.ltp),
        change: String(
          row.ltp - row.previousClose,
        ),
        changePercent: String(
          row.previousClose > 0
            ? ((row.ltp - row.previousClose) / row.previousClose) * 100
            : 0,
        ),
        open: String(row.open),
        high: String(row.high),
        low: String(row.low),
        previousClose: String(row.previousClose),
        volume: String(row.volume),
        turnover: String(row.turnover),
        trades: row.trades === undefined ? "" : String(row.trades),
        session: "eod",
        asOf,
      });
      candleRowsBySymbol.set(row.symbol, [
        ...(candleRowsBySymbol.get(row.symbol) ?? []),
        row,
      ]);
    }
    writeCsv(
      quoteFile,
      [...QUOTE_HEADER],
      [...existingQuotes.values()].map((row) =>
        QUOTE_HEADER.map((key) => row[key] ?? ""),
      ),
    );
    files.push("quotes.csv");

    for (const [symbol, rows] of candleRowsBySymbol) {
      const merged = mergeCandleFile(
        dataDir,
        symbol,
        rows.map((row) => ({
          date: priceDate,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
          turnover: row.turnover,
          ...(row.trades !== undefined ? { trades: row.trades } : {}),
        })),
        conflicts,
        false,
      );
      candleAdds += merged.added;
    }
  }

  // --------------------------------------------------------------- floorsheet
  progress("floorsheet");
  const floorsheetUrl = `${MEROLAGANI_BASE}/Floorsheet.aspx`;
  let floorsheetHtml: string | null = null;
  try {
    const first = await client.getText(floorsheetUrl);
    rawSnapshots.push(first.snapshotPath);
    floorsheetHtml = first.text;
  } catch (error) {
    failures.push({
      dataset: "floorsheet",
      source: "merolagani",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const trades: MerolaganiTrade[] = [];
  const tradeIds = new Set<string>();
  if (floorsheetHtml) {
    const addTrades = (html: string): void => {
      for (const trade of parseFloorsheet(html)) {
        if (tradeIds.has(trade.contractId)) continue;
        tradeIds.add(trade.contractId);
        trades.push(trade);
      }
    };
    addTrades(floorsheetHtml);
    let pager = parseFloorsheetPager(floorsheetHtml);
    const totalPages = pager.totalPages;
    progress(`floorsheet page 1/${totalPages}`);
    for (let page = 2; page <= totalPages; page += 1) {
      try {
        const response = await client.postForm(floorsheetUrl, {
          ...pager.fields,
          [pager.currentPageField]: String(page),
          [pager.pagingButtonField]: "",
        });
        rawSnapshots.push(response.snapshotPath);
        addTrades(response.text);
        pager = parseFloorsheetPager(response.text);
        if (page % 10 === 0 || page === totalPages) {
          progress(`floorsheet page ${page}/${totalPages}`);
        }
      } catch (error) {
        failures.push({
          dataset: "floorsheet",
          source: "merolagani",
          error: `page ${page}: ${error instanceof Error ? error.message : String(error)}`,
        });
        break;
      }
    }
  }
  let floorsheetDate: string | null = null;
  let floorsheetAdded = 0;
  if (trades.length > 0) {
    const byDate = new Map<string, MerolaganiTrade[]>();
    for (const trade of trades) {
      const date = trade.date;
      if (!date) continue;
      byDate.set(date, [...(byDate.get(date) ?? []), trade]);
    }
    for (const [date, dayTrades] of byDate) {
      if (floorsheetDate === null || date > floorsheetDate) floorsheetDate = date;
      const file = join(dataDir, "floorsheet", `${date}.csv`);
      const result = upsertCsvById(
        file,
        FLOORSHEET_HEADER,
        dayTrades.map((trade) => ({
          contractId: trade.contractId,
          businessDate: date,
          symbol: trade.symbol,
          buyerBroker: trade.buyerBroker,
          sellerBroker: trade.sellerBroker,
          quantity: String(trade.quantity),
          rate: String(trade.rate),
          amount: String(trade.amount),
          asOf: `${date}T15:00:00+05:45`,
        })),
        "contractId",
        conflicts,
        "floorsheet",
      );
      floorsheetAdded += result.added;
      files.push(`floorsheet/${basename(file)}`);
    }
  } else if (floorsheetHtml) {
    skipped.push("Merolagani floorsheet page contained no valid trades");
  }

  // -------------------------------------------------------------------- news
  progress("news");
  const newsItems: Array<Record<string, string>> = [];
  const ssNewsHtml = await fetchText(
    "news",
    "sharesansar",
    `${SHARESANSAR_BASE}/category/latest`,
  );
  if (ssNewsHtml) {
    for (const item of parseShareSansarNews(ssNewsHtml)) {
      newsItems.push({
        id: item.id,
        title: item.title,
        url: item.url,
        publishedAt: item.publishedAt,
        source: "ShareSansar",
        symbols: "",
        summary: item.summary ?? "",
      });
    }
  }
  const mlNewsHtml = await fetchText(
    "news",
    "merolagani",
    `${MEROLAGANI_BASE}/NewsList.aspx`,
  );
  if (mlNewsHtml) {
    for (const item of parseMerolaganiNews(mlNewsHtml)) {
      newsItems.push({
        id: item.id,
        title: item.title,
        url: item.url,
        publishedAt: item.publishedAt,
        source: "Merolagani",
        symbols: "",
        summary: item.summary ?? "",
      });
    }
  }
  let newsResult = { total: 0, added: 0 };
  if (newsItems.length > 0) {
    const deduped = new Map<string, Record<string, string>>();
    for (const item of newsItems) {
      const id = item.id;
      if (id) deduped.set(id, item);
    }
    newsResult = upsertCsvById(
      join(dataDir, "news.csv"),
      NEWS_HEADER,
      [...deduped.values()],
      "id",
      conflicts,
      "news",
    );
    const rows = readCsv(join(dataDir, "news.csv")).sort((a, b) =>
      (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
    );
    writeCsv(
      join(dataDir, "news.csv"),
      [...NEWS_HEADER],
      rows.slice(0, 500).map((row) => NEWS_HEADER.map((key) => row[key] ?? "")),
    );
    files.push("news.csv");
  }

  // -------------------------------------------------------------------- IPOs
  progress("IPO pipeline");
  const ipoRows: Array<Record<string, string>> = [];
  const today = to;
  for (const entry of IPO_TYPES) {
    const json = await fetchText(
      "ipos",
      "sharesansar",
      `${SHARESANSAR_BASE}/upcoming-issue?draw=1&start=0&length=-1&type=${entry.id}`,
      AJAX_HEADERS,
    );
    if (!json) continue;
    for (const issue of parseUpcomingIssuesJson(json, entry.type)) {
      const id = `ss-${entry.type}-${entry.id}-${issue.symbol || issue.companyName.replace(/\s+/g, "-")}-${issue.applicationDate ?? "unknown"}`;
      const status =
        issue.applicationDate === undefined
          ? "unknown"
          : issue.applicationDate >= today
            ? "upcoming"
            : "closed";
      ipoRows.push({
        id,
        companyName: issue.companyName,
        symbol: issue.symbol,
        type: issue.type,
        openDate: issue.applicationDate ?? "",
        closeDate: "",
        price: "",
        units: issue.units === undefined ? "" : String(issue.units),
        status,
        sourceUrl: `${SHARESANSAR_BASE}/upcoming-issue`,
        notes: [
          "ShareSansar upcoming/past issue list (unofficial)",
          issue.sebonDate ? `SEBON date: ${issue.sebonDate}` : "",
          issue.issueManager ? `Issue manager: ${issue.issueManager}` : "",
          issue.remark ? `Source remark: ${issue.remark}` : "",
        ]
          .filter(Boolean)
          .join("; "),
      });
    }
  }
  let ipoResult = { total: 0, added: 0 };
  if (ipoRows.length > 0) {
    ipoResult = upsertCsvById(
      join(dataDir, "ipos.csv"),
      IPO_HEADER,
      ipoRows,
      "id",
      conflicts,
      "ipos",
    );
  }

  // ------------------------------------------------------------ mutual funds
  progress("mutual fund NAV");
  const mfJson = await fetchText(
    "mutualFunds",
    "sharesansar",
    `${SHARESANSAR_BASE}/mutual-fund-navs?draw=1&start=0&length=-1&type=-1`,
    AJAX_HEADERS,
  );
  const fundRows: MutualFundNavRow[] = mfJson ? parseMutualFundNavJson(mfJson) : [];
  const fundsBySymbol = new Map<string, MutualFundNavRow[]>();
  for (const fund of fundRows) {
    fundsBySymbol.set(fund.symbol, [...(fundsBySymbol.get(fund.symbol) ?? []), fund]);
  }
  for (const [symbol, funds] of fundsBySymbol) {
    const file = join(dataDir, "fundamentals", `${symbol}.csv`);
    const existing = readCsv(file);
    const merged = new Map<string, string[]>();
    for (const row of existing) {
      const key = `${row.period ?? ""}|${row.metric ?? ""}`;
      if (!key.startsWith("|")) {
        merged.set(key, FUNDAMENTALS_HEADER.map((header) => row[header] ?? ""));
      }
    }
    for (const fund of funds) {
      const period = fund.publishedDate ?? fund.weeklyNavDate ?? today;
      const reportedAt = fund.publishedDate ?? fund.weeklyNavDate ?? today;
      const add = (
        metric: string,
        value: number | undefined,
        unit: string,
        notes = "",
      ): void => {
        if (value === undefined || !Number.isFinite(value)) return;
        merged.set(`${period}|${metric}`, [
          period,
          metric,
          String(value),
          unit,
          unit === "currency" ? "NPR" : "",
          "",
          "",
          reportedAt,
          "sharesansar",
          "unverified",
          notes,
        ]);
      };
      add("nav", fund.weeklyNav ?? fund.dailyNav, "currency", "Mutual fund NAV as displayed by ShareSansar (weekly unless a daily NAV is published).");
      add("navDaily", fund.dailyNav, "currency");
      add("navWeekly", fund.weeklyNav, "currency");
      add("navMonthly", fund.monthlyNav, "currency", fund.monthlyNavDate ?? "");
      add("close", fund.close, "currency", "Market close on the NAV publication date.");
      add("fundSize", fund.fundSize, "currency");
      add("premiumDiscountPercent", fund.premiumDiscountPercent, "percent", "Market price versus NAV as displayed.");
    }
    writeCsv(file, [...FUNDAMENTALS_HEADER], [...merged.values()]);
    files.push(`fundamentals/${symbol}.csv`);
  }

  // ------------------------------------------------------------------ report
  const reportPath = join(dataDir, "reports", "bulk.json");
  mkdirSync(join(dataDir, "reports"), { recursive: true });
  const result: BulkResult = {
    generatedAt: now.toISOString(),
    marketSummary,
    indices: {
      count: definitions.length,
      rows: indexRows,
      files: indexFiles,
      added: indexAdds,
    },
    sectorRows: sectorRows.length,
    prices: {
      quotes: priceRows.length,
      quoteUpdates,
      candles: priceRows.length,
      candleAdds,
    },
    floorsheet: {
      date: floorsheetDate,
      trades: trades.length,
      added: floorsheetAdded,
    },
    news: newsResult,
    ipos: ipoResult,
    mutualFunds: fundRows.length,
    conflicts,
    failureCount: failures.length,
    failures,
    skipped,
    files: [...new Set(files)],
    reportPath,
    rawSnapshots: [...new Set(rawSnapshots)],
  };
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        ...result,
        conflicts: conflicts.slice(0, 500),
        conflictsTruncated: Math.max(0, conflicts.length - 500),
        sources: [
          {
            id: "sharesansar.com",
            url: SHARESANSAR_BASE,
            classification: "UNVERIFIED",
            termsStatus: "unverified",
            note: "Public pages. No reuse licence; stored as displayed, not redistributed under a licence.",
          },
          {
            id: "merolagani.com",
            url: MEROLAGANI_BASE,
            classification: "UNVERIFIED",
            termsStatus: "unverified",
            note: "Public pages. Floorsheet, NEPSE index cross-check and news are stored as displayed.",
          },
        ],
        note:
          "Unofficial data. Existing valid history is never overwritten; disagreements and skipped datasets are reported. Nothing is interpolated.",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return result;
}

/** Dates of floorsheet files already present, for the sync/import step. */
export function floorsheetDates(dataDir: string): string[] {
  const dir = join(dataDir, "floorsheet");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => name.replace(/\.csv$/, ""))
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
}

/** Fundamental symbols already present, for the sync/import step. */
export function fundamentalSymbols(dataDir: string): string[] {
  const dir = join(dataDir, "fundamentals");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => name.replace(/\.csv$/, "").toUpperCase())
    .filter((name) => /^[A-Z0-9._-]{1,24}$/.test(name))
    .sort();
}

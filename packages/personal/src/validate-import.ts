import type { Candle } from "@stock/core";
import type { PersonalStore } from "@stock/store";

/**
 * Post-import data quality checks.
 *
 * The automatic refresh never edits, deletes or "repairs" imported rows. It
 * runs these checks after a successful sync, writes `reports/validation.json`
 * and surfaces a short, human-readable summary. Everything here is pure and
 * deterministic so the same report can be reproduced from a store or from a
 * synthetic fixture.
 */

export interface ValidationCandle {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ValidationQuote {
  symbol: string;
  ltp: number;
  asOf: string;
}

export interface ValidationCompany {
  symbol: string;
  instrumentType: string;
  status: string;
}

export interface ImportValidationInput {
  candles: readonly ValidationCandle[];
  quotes: readonly ValidationQuote[];
  companies: readonly ValidationCompany[];
  /**
   * Every symbol with any stored equity candle, when the caller can query it
   * cheaply. Used for archive coverage instead of the (possibly windowed)
   * candle sample.
   */
  candleSymbols?: readonly string[];
  /** True stored candle row count, when known. */
  totalCandleRows?: number;
  now?: Date;
}

export type ValidationIssueCode =
  | "duplicate-candles"
  | "ohlc-invariant"
  | "quote-close-mismatch"
  | "missing-latest-session"
  | "empty-archive"
  | "partial-archive"
  | "no-quotes";

export interface ValidationIssue {
  code: ValidationIssueCode;
  severity: "warning" | "error";
  message: string;
  count?: number;
  symbols?: string[];
}

export interface DuplicateSample {
  symbol: string;
  session: string;
  rows: number;
}

export interface OhlcSample {
  symbol: string;
  session: string;
  reason: string;
}

export interface QuoteMismatchSample {
  symbol: string;
  quoteLtp: number;
  candleClose: number;
  discrepancyPercent: number;
  session: string;
}

export interface ImportValidationReport {
  checkedAt: string;
  status: "ok" | "warning" | "error";
  latestSession: string | null;
  counts: {
    candles: number;
    companies: number;
    activeEquities: number;
    quotes: number;
    candleSymbols: number;
  };
  checks: {
    duplicates: {
      count: number;
      samples: DuplicateSample[];
    };
    ohlcViolations: {
      count: number;
      samples: OhlcSample[];
    };
    quoteMismatches: {
      thresholdPercent: number;
      skippedNewerQuotes: number;
      count: number;
      samples: QuoteMismatchSample[];
    };
    missingLatestSession: {
      activeSymbols: number;
      tradedSymbols: number;
      tradedShare: number;
      count: number;
      symbols: string[];
    };
    archive: {
      empty: boolean;
      partial: boolean;
      activeSymbols: number;
      candleSymbols: number;
      coverage: number;
    };
  };
  issues: ValidationIssue[];
}

const MAX_SAMPLES = 20;
const MAX_SYMBOL_LIST = 50;
const QUOTE_MISMATCH_THRESHOLD = 0.005;
const PARTIAL_ARCHIVE_COVERAGE = 0.5;
const MISSING_SESSION_MIN_SHARE = 0.6;

function sessionOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function upper(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Run every post-import check on already-collected rows. */
export function validateImport(
  input: ImportValidationInput,
): ImportValidationReport {
  const activeSymbols = [
    ...new Set(
      input.companies
        .filter(
          (company) =>
            company.instrumentType.trim().toLowerCase() === "equity" &&
            company.status.trim().toLowerCase() === "active",
        )
        .map((company) => upper(company.symbol)),
    ),
  ];
  const activeSet = new Set(activeSymbols);
  const issues: ValidationIssue[] = [];

  // 1. Duplicate (symbol, session) candles.
  const candleCountByKey = new Map<string, number>();
  for (const candle of input.candles) {
    const session = sessionOf(candle.timestamp);
    if (!isDate(session)) continue;
    const key = `${upper(candle.symbol)}|${session}`;
    candleCountByKey.set(key, (candleCountByKey.get(key) ?? 0) + 1);
  }
  const duplicateSamples: DuplicateSample[] = [];
  let duplicateCount = 0;
  for (const [key, rows] of candleCountByKey) {
    if (rows <= 1) continue;
    duplicateCount += 1;
    if (duplicateSamples.length < MAX_SAMPLES) {
      const [symbol = "", session = ""] = key.split("|");
      duplicateSamples.push({ symbol, session, rows });
    }
  }
  if (duplicateCount > 0) {
    issues.push({
      code: "duplicate-candles",
      severity: "error",
      message: `${duplicateCount} duplicate (symbol, session) candle group${duplicateCount === 1 ? "" : "s"} found`,
      count: duplicateCount,
      symbols: [...new Set(duplicateSamples.map((sample) => sample.symbol))].slice(
        0,
        MAX_SYMBOL_LIST,
      ),
    });
  }

  // 2. OHLC invariants.
  const ohlcSamples: OhlcSample[] = [];
  let ohlcCount = 0;
  for (const candle of input.candles) {
    const session = sessionOf(candle.timestamp);
    const reasons: string[] = [];
    if (!finite(candle.volume) || candle.volume < 0) {
      reasons.push("negative or invalid volume");
    }
    if (candle.high < candle.low) {
      reasons.push("high below low");
    }
    if (candle.high < Math.max(candle.open, candle.close)) {
      reasons.push("high below open/close");
    }
    if (candle.low > Math.min(candle.open, candle.close)) {
      reasons.push("low above open/close");
    }
    if (reasons.length === 0) continue;
    ohlcCount += 1;
    if (ohlcSamples.length < MAX_SAMPLES) {
      ohlcSamples.push({
        symbol: upper(candle.symbol),
        session,
        reason: reasons.join("; "),
      });
    }
  }
  if (ohlcCount > 0) {
    issues.push({
      code: "ohlc-invariant",
      severity: "error",
      message: `${ohlcCount} candle${ohlcCount === 1 ? "" : "s"} break an OHLC or volume invariant`,
      count: ohlcCount,
      symbols: [...new Set(ohlcSamples.map((sample) => sample.symbol))].slice(
        0,
        MAX_SYMBOL_LIST,
      ),
    });
  }

  // 3. Quote LTP vs the latest candle close.
  const latest = new Map<string, { session: string; close: number }>();
  for (const candle of input.candles) {
    const symbol = upper(candle.symbol);
    const session = sessionOf(candle.timestamp);
    if (!isDate(session) || !finite(candle.close)) continue;
    const current = latest.get(symbol);
    if (!current || session > current.session) {
      latest.set(symbol, { session, close: candle.close });
    }
  }
  const mismatchSamples: QuoteMismatchSample[] = [];
  let mismatchCount = 0;
  let skippedNewerQuotes = 0;
  for (const quote of input.quotes) {
    const symbol = upper(quote.symbol);
    const candle = latest.get(symbol);
    if (!candle || candle.close <= 0) continue;
    if (!finite(quote.ltp) || quote.ltp <= 0) continue;
    const quoteSession = sessionOf(quote.asOf);
    if (!isDate(quoteSession)) continue;
    // A quote dated after the latest candle is an intraday print; a move is
    // expected and comparing it with yesterday's close would be a false alarm.
    if (quoteSession > candle.session) {
      skippedNewerQuotes += 1;
      continue;
    }
    const discrepancy = Math.abs(quote.ltp - candle.close) / candle.close;
    if (discrepancy < QUOTE_MISMATCH_THRESHOLD) continue;
    mismatchCount += 1;
    if (mismatchSamples.length < MAX_SAMPLES) {
      mismatchSamples.push({
        symbol,
        quoteLtp: quote.ltp,
        candleClose: candle.close,
        discrepancyPercent: round(discrepancy * 100, 2),
        session: candle.session,
      });
    }
  }
  if (mismatchCount > 0) {
    issues.push({
      code: "quote-close-mismatch",
      severity: "warning",
      message: `${mismatchCount} quote${mismatchCount === 1 ? "" : "s"} differ from the latest candle close by 0.5% or more`,
      count: mismatchCount,
      symbols: [...new Set(mismatchSamples.map((sample) => sample.symbol))].slice(
        0,
        MAX_SYMBOL_LIST,
      ),
    });
  }

  // 4. Symbols missing from the latest session while most of the market traded.
  let latestSession: string | null = null;
  for (const candle of input.candles) {
    const session = sessionOf(candle.timestamp);
    if (isDate(session) && (latestSession === null || session > latestSession)) {
      latestSession = session;
    }
  }
  const tradedOnLatest = new Set<string>();
  if (latestSession !== null) {
    for (const candle of input.candles) {
      if (sessionOf(candle.timestamp) === latestSession) {
        tradedOnLatest.add(upper(candle.symbol));
      }
    }
  }
  const tradedActive = activeSymbols.filter((symbol) => tradedOnLatest.has(symbol));
  const tradedShare =
    activeSymbols.length > 0 ? tradedActive.length / activeSymbols.length : 0;
  let missingSymbols: string[] = [];
  if (
    latestSession !== null &&
    activeSymbols.length > 0 &&
    tradedShare >= MISSING_SESSION_MIN_SHARE
  ) {
    missingSymbols = activeSymbols
      .filter((symbol) => !tradedOnLatest.has(symbol))
      .sort();
    if (missingSymbols.length > 0) {
      issues.push({
        code: "missing-latest-session",
        severity: "warning",
        message: `${missingSymbols.length} active symbol${missingSymbols.length === 1 ? " has" : "s have"} no candle on ${latestSession} while ${round(tradedShare * 100, 1)}% of active equities traded`,
        count: missingSymbols.length,
        symbols: missingSymbols.slice(0, MAX_SYMBOL_LIST),
      });
    }
  }

  // 5. Empty or partial archive.
  const candleSymbols = new Set(
    (input.candleSymbols ?? input.candles.map((candle) => upper(candle.symbol)))
      .map(upper)
      .filter((symbol) => symbol.length > 0),
  );
  const storedRows = input.totalCandleRows ?? input.candles.length;
  const empty = storedRows === 0;
  const coverage =
    activeSymbols.length > 0
      ? candleSymbols.size / activeSymbols.length
      : candleSymbols.size > 0
        ? 1
        : 0;
  const partial = !empty && activeSymbols.length > 0 && coverage < PARTIAL_ARCHIVE_COVERAGE;
  if (empty) {
    issues.push({
      code: "empty-archive",
      severity: "error",
      message: "the imported archive contains no candles",
      count: 0,
    });
  } else if (partial) {
    issues.push({
      code: "partial-archive",
      severity: "warning",
      message: `only ${candleSymbols.size} of ${activeSymbols.length} active equities have any stored candle (${round(coverage * 100, 1)}%)`,
      count: activeSymbols.length - candleSymbols.size,
    });
  }
  if (input.quotes.length === 0) {
    issues.push({
      code: "no-quotes",
      severity: "warning",
      message: "the import contains no quotes, so price alerts have no end-of-day fallback",
      count: 0,
    });
  }

  const status: ImportValidationReport["status"] = issues.some(
    (issue) => issue.severity === "error",
  )
    ? "error"
    : issues.length > 0
      ? "warning"
      : "ok";

  return {
    checkedAt: (input.now ?? new Date()).toISOString(),
    status,
    latestSession,
    counts: {
      candles: storedRows,
      companies: input.companies.length,
      activeEquities: activeSymbols.length,
      quotes: input.quotes.length,
      candleSymbols: candleSymbols.size,
    },
    checks: {
      duplicates: { count: duplicateCount, samples: duplicateSamples },
      ohlcViolations: { count: ohlcCount, samples: ohlcSamples },
      quoteMismatches: {
        thresholdPercent: QUOTE_MISMATCH_THRESHOLD * 100,
        skippedNewerQuotes,
        count: mismatchCount,
        samples: mismatchSamples,
      },
      missingLatestSession: {
        activeSymbols: activeSymbols.length,
        tradedSymbols: tradedActive.length,
        tradedShare: round(tradedShare, 4),
        count: missingSymbols.length,
        symbols: missingSymbols.slice(0, MAX_SYMBOL_LIST),
      },
      archive: {
        empty,
        partial,
        activeSymbols: activeSymbols.length,
        candleSymbols: candleSymbols.size,
        coverage: round(coverage, 4),
      },
    },
    issues,
  };
}

export interface ValidateStoreOptions {
  store: PersonalStore;
  providerId: string;
  now?: Date;
  /** Days of candles to inspect for row-level checks. Default 21. */
  windowDays?: number;
  /** Safety cap on symbols read. Default 2000. */
  maxSymbols?: number;
}

/**
 * Read the store and run the checks. Reads a short recent window for the row
 * checks (duplicates, OHLC, quote reconciliation) and uses cheap store counts
 * for archive coverage, so it stays fast even on a large archive.
 */
export function validateImportedStore(
  options: ValidateStoreOptions,
): ImportValidationReport {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? 21;
  const maxSymbols = options.maxSymbols ?? 2000;
  const today = now.toISOString().slice(0, 10);
  const latestStored = options.store.latestMarketAsOf(options.providerId);
  const latestDay = latestStored ? latestStored.slice(0, 10) : today;
  // Anchor the window to the latest stored session, not to wall-clock today:
  // when the archive is older than the window, a today-anchored query reads no
  // rows and every row-level check silently passes.
  const end = latestDay;
  const start = new Date(
    Date.parse(`${end}T00:00:00Z`) - windowDays * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);

  const candleSymbols = options.store
    .getSymbolsWithCandles(options.providerId, "equity")
    .slice(0, maxSymbols);
  const candles: ValidationCandle[] = [];
  for (const symbol of candleSymbols) {
    let rows: Candle[];
    try {
      rows = options.store.getCandles({
        providerId: options.providerId,
        kind: "equity",
        symbol,
        timeframe: "1day",
        from: start,
        to: end,
      });
    } catch {
      // One unreadable series must not derail the report.
      continue;
    }
    for (const row of rows) {
      candles.push({
        symbol: row.symbol,
        timestamp: row.timestamp,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      });
    }
  }

  const companies = options.store
    .getCompanies(options.providerId)
    .map<ValidationCompany>((company) => ({
      symbol: company.symbol,
      instrumentType: company.instrumentType,
      status: company.status,
    }));
  const quotes = options.store
    .getQuotes(options.providerId)
    .map<ValidationQuote>((quote) => ({
      symbol: quote.symbol,
      ltp: quote.ltp,
      asOf: quote.asOf,
    }));
  const summary = options.store.summary(options.providerId);

  return validateImport({
    candles,
    companies,
    quotes,
    candleSymbols,
    totalCandleRows: summary.candles,
    now,
  });
}

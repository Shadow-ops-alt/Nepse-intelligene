import { describe, expect, it } from "vitest";
import type { PersonalStore } from "@stock/store";
import {
  validateImport,
  validateImportedStore,
  type ValidationCandle,
  type ValidationCompany,
  type ValidationQuote,
} from "./validate-import";

function candle(
  symbol: string,
  session: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1_000,
): ValidationCandle {
  return {
    symbol,
    timestamp: `${session}T09:00:00.000Z`,
    open,
    high,
    low,
    close,
    volume,
  };
}

function quote(symbol: string, ltp: number, asOf: string): ValidationQuote {
  return { symbol, ltp, asOf: `${asOf}T09:00:00.000Z` };
}

function company(
  symbol: string,
  status = "active",
  instrumentType = "Equity",
): ValidationCompany {
  return { symbol, status, instrumentType };
}

describe("validateImport", () => {
  it("reports a clean import as ok", () => {
    const report = validateImport({
      candles: [
        candle("AAA", "2026-11-20", 100, 105, 99, 104),
        candle("BBB", "2026-11-20", 200, 205, 198, 202),
      ],
      quotes: [quote("AAA", 104, "2026-11-20"), quote("BBB", 202, "2026-11-20")],
      companies: [company("AAA"), company("BBB")],
      now: new Date("2026-11-21T00:00:00.000Z"),
    });
    expect(report.status).toBe("ok");
    expect(report.latestSession).toBe("2026-11-20");
    expect(report.issues).toEqual([]);
    expect(report.checks.duplicates.count).toBe(0);
    expect(report.checks.ohlcViolations.count).toBe(0);
  });

  it("finds duplicate (symbol, session) candles", () => {
    const report = validateImport({
      candles: [
        candle("AAA", "2026-11-20", 100, 105, 99, 104),
        candle("AAA", "2026-11-20", 100, 105, 99, 103),
      ],
      quotes: [quote("AAA", 104, "2026-11-20")],
      companies: [company("AAA")],
    });
    expect(report.checks.duplicates.count).toBe(1);
    expect(report.checks.duplicates.samples[0]).toMatchObject({
      symbol: "AAA",
      session: "2026-11-20",
      rows: 2,
    });
    expect(report.status).toBe("error");
    expect(report.issues.map((issue) => issue.code)).toContain("duplicate-candles");
  });

  it("finds OHLC invariant violations and negative volume", () => {
    const report = validateImport({
      candles: [
        // high below open and close
        candle("AAA", "2026-11-20", 100, 99, 90, 98),
        // low above open and close
        candle("BBB", "2026-11-20", 100, 110, 105, 101),
        // negative volume
        candle("CCC", "2026-11-20", 100, 105, 95, 102, -5),
      ],
      quotes: [],
      companies: [company("AAA"), company("BBB"), company("CCC")],
    });
    expect(report.checks.ohlcViolations.count).toBe(3);
    expect(report.checks.ohlcViolations.samples.map((s) => s.reason)).toEqual([
      "high below open/close",
      "low above open/close",
      "negative or invalid volume",
    ]);
    expect(report.status).toBe("error");
  });

  it("flags a quote that differs from the latest close by 0.5% or more", () => {
    const report = validateImport({
      candles: [candle("AAA", "2026-11-20", 100, 105, 99, 100)],
      quotes: [
        quote("AAA", 100.4, "2026-11-20"),
        quote("BBB", 100.6, "2026-11-20"),
      ],
      companies: [company("AAA")],
    });
    // AAA is below the threshold; BBB has no candle and is ignored.
    expect(report.checks.quoteMismatches.count).toBe(0);

    const flagged = validateImport({
      candles: [candle("AAA", "2026-11-20", 100, 105, 99, 100)],
      quotes: [quote("AAA", 100.6, "2026-11-20")],
      companies: [company("AAA")],
    });
    expect(flagged.checks.quoteMismatches.count).toBe(1);
    expect(flagged.checks.quoteMismatches.samples[0]?.discrepancyPercent).toBe(0.6);
    expect(flagged.issues.map((issue) => issue.code)).toContain(
      "quote-close-mismatch",
    );
  });

  it("skips quotes newer than the latest candle instead of raising a false alarm", () => {
    const report = validateImport({
      candles: [candle("AAA", "2026-11-20", 100, 105, 99, 100)],
      quotes: [quote("AAA", 110, "2026-11-21")],
      companies: [company("AAA")],
    });
    expect(report.checks.quoteMismatches.count).toBe(0);
    expect(report.checks.quoteMismatches.skippedNewerQuotes).toBe(1);
  });

  it("lists active symbols missing from the latest session once 60% traded", () => {
    const report = validateImport({
      candles: [
        candle("AAA", "2026-11-19", 100, 105, 99, 104),
        candle("CCC", "2026-11-19", 100, 105, 99, 104),
        candle("AAA", "2026-11-20", 100, 105, 99, 104),
        candle("BBB", "2026-11-20", 100, 105, 99, 104),
      ],
      quotes: [],
      companies: [company("AAA"), company("BBB"), company("CCC")],
    });
    expect(report.checks.missingLatestSession.tradedSymbols).toBe(2);
    expect(report.checks.missingLatestSession.tradedShare).toBeCloseTo(0.6667, 3);
    expect(report.checks.missingLatestSession.symbols).toEqual(["CCC"]);
    expect(report.issues.map((issue) => issue.code)).toContain(
      "missing-latest-session",
    );
  });

  it("does not report missing symbols when most of the market did not trade", () => {
    const report = validateImport({
      candles: [
        candle("AAA", "2026-11-19", 100, 105, 99, 104),
        candle("BBB", "2026-11-19", 100, 105, 99, 104),
        candle("CCC", "2026-11-19", 100, 105, 99, 104),
        candle("AAA", "2026-11-20", 100, 105, 99, 104),
      ],
      quotes: [],
      companies: [company("AAA"), company("BBB"), company("CCC")],
    });
    expect(report.checks.missingLatestSession.symbols).toEqual([]);
    expect(report.issues.map((issue) => issue.code)).not.toContain(
      "missing-latest-session",
    );
  });

  it("flags an empty archive", () => {
    const report = validateImport({
      candles: [],
      quotes: [],
      companies: [company("AAA")],
      totalCandleRows: 0,
    });
    expect(report.checks.archive.empty).toBe(true);
    expect(report.status).toBe("error");
    expect(report.issues.map((issue) => issue.code)).toContain("empty-archive");
  });

  it("flags a partial archive when under half of active equities have candles", () => {
    const report = validateImport({
      candles: [candle("AAA", "2026-11-20", 100, 105, 99, 104)],
      quotes: [],
      companies: [
        company("AAA"),
        company("BBB"),
        company("CCC"),
        company("DDD"),
      ],
      candleSymbols: ["AAA"],
      totalCandleRows: 10,
    });
    expect(report.checks.archive.partial).toBe(true);
    expect(report.checks.archive.coverage).toBe(0.25);
    expect(report.issues.map((issue) => issue.code)).toContain("partial-archive");
  });

  it("warns when an import has no quotes", () => {
    const report = validateImport({
      candles: [candle("AAA", "2026-11-20", 100, 105, 99, 104)],
      quotes: [],
      companies: [company("AAA")],
    });
    expect(report.issues.map((issue) => issue.code)).toContain("no-quotes");
  });
});

describe("validateImportedStore", () => {
  it("reads the store, windows the candle query and returns a report", () => {
    const calls: Array<{ from?: string; to?: string; symbol: string }> = [];
    const store = {
      latestMarketAsOf: () => "2026-11-20T09:00:00.000Z",
      getSymbolsWithCandles: () => ["AAA"],
      getCandles: (query: { symbol: string; from?: string; to?: string }) => {
        calls.push({
          symbol: query.symbol,
          ...(query.from ? { from: query.from } : {}),
          ...(query.to ? { to: query.to } : {}),
        });
        return [
          {
            symbol: "AAA",
            timeframe: "1day",
            timestamp: "2026-11-20T09:00:00.000Z",
            open: 100,
            high: 105,
            low: 99,
            close: 104,
            volume: 1_000,
          },
        ];
      },
      getCompanies: () => [
        { symbol: "AAA", instrumentType: "Equity", status: "active" },
      ],
      getQuotes: () => [
        { symbol: "AAA", ltp: 104, asOf: "2026-11-20T09:00:00.000Z" },
      ],
      summary: () => ({ candles: 1 }),
    } as unknown as PersonalStore;

    const report = validateImportedStore({
      store,
      providerId: "test",
      now: new Date("2026-11-21T00:00:00.000Z"),
      windowDays: 10,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.symbol).toBe("AAA");
    expect(calls[0]?.to).toBe("2026-11-20");
    expect(calls[0]?.from).toBe("2026-11-10");
    expect(report.status).toBe("ok");
    expect(report.counts.candles).toBe(1);
    expect(report.counts.activeEquities).toBe(1);
  });
});

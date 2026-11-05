import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireNepseSource } from "./acquire";

const directories: string[] = [];

function temporary(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), `stock-acquire-${name}-`));
  directories.push(directory);
  return directory;
}

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function fixtureSource(): string {
  const source = temporary("source");
  const data = join(source, "data");
  mkdirSync(join(data, "nepse"), { recursive: true });
  mkdirSync(join(data, "reference"), { recursive: true });

  write(
    join(data, "reference", "nepse-symbols.csv"),
    [
      "symbol,name,source_category,instrument_type,sector,status",
      "NABIL,Nabil Bank Limited,Commercial Bank,ordinary,Commercial Bank,listed",
      "BOKL,Bank of Kathmandu Limited,Merged,ordinary,,merged",
      "TESTD,Test Debenture,Corporate Debentures,debenture,,listed",
      "ALICLP,Asian Life Promoter Share,Promoter Share,promoter_share,,listed",
      "",
    ].join("\n"),
  );

  write(
    join(data, "nepse", "NABIL.csv"),
    [
      "published_date,open,high,low,close,per_change,traded_quantity,traded_amount,status",
      "2026-11-02,540,548,538,545,1.0,12000,6540000.0,A",
      "2026-11-03,547,556,545,552,1.28,42360,23333426.4,A",
      // high is below open: excluded by the canonical OHLC invariant.
      "2026-11-04,500,490,480,495,0.0,1000,500000.0,A",
      // a zero price is not a real NEPSE trade: excluded.
      "2026-11-05,552,552,552,0,0.0,1000,500000.0,A",
      "",
    ].join("\n"),
  );

  write(
    join(data, "nepse", "BOKL.csv"),
    [
      "published_date,open,high,low,close,per_change,traded_quantity,traded_amount,status",
      "2026-11-02,200,205,198,203,,500,101500.0,A",
      "2026-11-03,203,206,200,205,,400,82000.0,A",
      "",
    ].join("\n"),
  );

  write(
    join(data, "nepse", "TESTD.csv"),
    [
      "published_date,open,high,low,close,per_change,traded_quantity,traded_amount,status",
      "2026-11-02,1000,1005,998,1002,,10,10020.0,A",
      "2026-11-03,1002,1008,1000,1005,,20,20100.0,A",
      "",
    ].join("\n"),
  );

  write(
    join(data, "nepse", "ALICLP.csv"),
    [
      "published_date,open,high,low,close,per_change,traded_quantity,traded_amount,status",
      "2026-11-03,700,710,695,705,,100,70500.0,A",
      "",
    ].join("\n"),
  );

  write(
    join(data, "nepse", "NEPSE_INDEX.csv"),
    [
      "published_date,open,high,low,close,per_change,traded_quantity,traded_amount,status",
      "2026-11-02,2650.00,2670.00,2640.00,2657.50,-1.21,,7183713047.01,A",
      // index OHLC invariant violation: excluded.
      "2026-11-04,2650.00,2600.00,2640.00,2657.50,-1.21,,1.0,A",
      "2026-11-03,2655.55,2664.13,2643.03,2664.13,0.24,,5651142523.49,A",
      "",
    ].join("\n"),
  );

  write(join(source, "LICENSE"), "MIT License\n");
  write(join(source, "README.md"), "# fixture\n");
  return source;
}

function readCsv(path: string): Array<Record<string, string>> {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const header = lines[0]!.split(",");
  return lines.slice(1).map((line) => {
    // The fixture has no quoted commas; the production writer escapes them.
    const cells = line.split(",");
    return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""]));
  });
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe("acquireNepseSource", () => {
  it("normalizes the public archive into canonical files and reports exclusions", async () => {
    const source = fixtureSource();
    const output = temporary("out");
    const now = new Date("2026-11-04T12:00:00.000Z");

    const result = await acquireNepseSource({
      sourceDir: source,
      outputDir: output,
      cacheDir: join(output, "cache"),
      now,
    });

    expect(result.totals.symbols).toBe(4);
    expect(result.totals.companies).toBe(4);
    expect(result.totals.ordinaryListed).toBe(1);
    expect(result.totals.priceRows).toBe(7);
    expect(result.totals.excludedRows).toBe(3);
    expect(result.totals.indexRows).toBe(2);
    expect(result.totals.indexExcludedRows).toBe(1);
    expect(result.totals.quotes).toBe(1);
    expect(result.totals.latestSession).toBe("2026-11-03");

    const companies = readCsv(join(output, "companies.csv"));
    expect(companies).toHaveLength(4);
    const nabil = companies.find((row) => row.symbol === "NABIL");
    expect(nabil).toMatchObject({
      id: "NABIL",
      sector: "Commercial Bank",
      instrumentType: "Equity",
      status: "active",
    });
    const bokl = companies.find((row) => row.symbol === "BOKL");
    expect(bokl).toMatchObject({
      sector: "Unclassified",
      status: "delisted",
    });
    const debenture = companies.find((row) => row.symbol === "TESTD");
    expect(debenture?.instrumentType).toBe("Debenture");

    const securities = readCsv(join(output, "securities.csv"));
    expect(
      securities.find((row) => row.symbol === "ALICLP")?.isPromoter,
    ).toBe("true");

    const nabilHistory = readCsv(join(output, "ohlc", "NABIL.csv"));
    expect(nabilHistory).toHaveLength(2);
    expect(nabilHistory.map((row) => row.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(nabilHistory.at(-1)).toMatchObject({
      symbol: "NABIL",
      timeframe: "1day",
      timestamp: "2026-11-03T15:00:00+05:45",
      close: "552",
      volume: "42360",
      turnover: "23333426.4",
      adjusted: "false",
    });

    const quotes = readCsv(join(output, "quotes.csv"));
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      symbol: "NABIL",
      ltp: "552",
      previousClose: "545",
      change: "7",
      changePercent: "1.2844",
      volume: "42360",
      turnover: "23333426.4",
      session: "eod",
      asOf: "2026-11-03T15:00:00+05:45",
    });

    const index = readCsv(join(output, "indices", "NEPSE.csv"));
    expect(index).toHaveLength(2);
    expect(index.at(-1)).toMatchObject({
      symbol: "NEPSE",
      close: "2664.13",
      volume: "0",
      turnover: "5651142523.49",
    });

    expect(readCsv(join(output, "indices.csv"))).toEqual([
      { symbol: "NEPSE", name: "NEPSE Index", isSector: "false" },
    ]);
    expect(existsSync(join(output, "market-summary.csv"))).toBe(false);
    expect(existsSync(join(output, "sector-performance.csv"))).toBe(false);

    const report = JSON.parse(
      readFileSync(join(output, "reports", "import-report.json"), "utf8"),
    ) as {
      totals: { excludedRows: number };
      exclusions: { reasons: Record<string, number> };
      quotesBasis: string;
      unavailable: { marketSummary: string };
    };
    expect(report.totals.excludedRows).toBe(3);
    expect(report.exclusions.reasons["OHLC invariant violated"]).toBe(2);
    expect(report.exclusions.reasons["non-positive price"]).toBe(1);
    expect(report.quotesBasis).toMatch(/end-of-day/);
    expect(report.unavailable.marketSummary).toMatch(/not published/);

    const excluded = readCsv(join(output, "reports", "excluded-rows.csv"));
    expect(excluded).toHaveLength(3);
    expect(excluded.map((row) => row.reason)).toContain(
      "OHLC invariant violated",
    );

    // Re-running over the same source produces byte-identical canonical files
    // and reports no changed or removed history rows.
    const before = new Map(
      [
        "companies.csv",
        "securities.csv",
        "indices.csv",
        "quotes.csv",
        "ohlc/NABIL.csv",
        "indices/NEPSE.csv",
      ].map((path) => [path, readFileSync(join(output, path), "utf8")]),
    );
    const second = await acquireNepseSource({
      sourceDir: source,
      outputDir: output,
      cacheDir: join(output, "cache"),
      now: new Date("2026-11-04T12:05:00.000Z"),
    });
    for (const [path, content] of before) {
      expect(readFileSync(join(output, path), "utf8")).toBe(content);
    }
    const changes = JSON.parse(
      readFileSync(join(output, "reports", "history-changes.json"), "utf8"),
    ) as { changedRows: number; removedRows: number };
    expect(changes.changedRows).toBe(0);
    expect(changes.removedRows).toBe(0);
    expect(second.totals).toEqual(result.totals);
  });

  it("refuses to normalize a malformed symbol master", async () => {
    const source = temporary("bad-source");
    const data = join(source, "data");
    mkdirSync(join(data, "nepse"), { recursive: true });
    mkdirSync(join(data, "reference"), { recursive: true });
    write(
      join(data, "reference", "nepse-symbols.csv"),
      "symbol,name,source_category,instrument_type,sector,status\n,Blank Name,X,ordinary,,listed\n",
    );
    const output = temporary("bad-out");
    await expect(
      acquireNepseSource({ sourceDir: source, outputDir: output }),
    ).rejects.toThrow(/invalid symbol master/);
    expect(existsSync(join(output, "companies.csv"))).toBe(false);
    const health = JSON.parse(
      readFileSync(join(output, "reports", "provider-health.json"), "utf8"),
    ) as { status: string; consecutiveFailures: number };
    expect(health.status).toBe("error");
    expect(health.consecutiveFailures).toBe(1);
  });
});

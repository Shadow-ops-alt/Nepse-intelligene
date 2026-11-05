import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CsvProvider } from "./csv-provider";

const directories: string[] = [];

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "stock-csv-"));
  directories.push(directory);
  writeFileSync(
    join(directory, "companies.csv"),
    [
      "id,symbol,name,sector,instrumentType,status",
      "131,NABIL,Nabil Bank Limited,Commercial Banks,Equity,active",
      "132,NICA,NIC Asia Bank Limited,Commercial Banks,Equity,active",
      "",
    ].join("\n"),
    "utf8",
  );
  mkdirSync(join(directory, "ohlc"), { recursive: true });
  writeFileSync(
    join(directory, "ohlc", "NABIL.csv"),
    [
      "symbol,date,open,high,low,close,volume,turnover,trades",
      "NABIL,2026-11-02,540,548,538,545,12000,6540000,120",
      "NABIL,2026-11-03,547,555,545,552,42360,23333426.4,309",
      "",
    ].join("\n"),
    "utf8",
  );
  return directory;
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe("CsvProvider", () => {
  it("parses companies and filters OHLC by date", async () => {
    const provider = new CsvProvider({ dataDir: fixture() });
    const companies = await provider.getCompanyList();
    expect(companies.data).toHaveLength(2);
    expect(companies.data[0]!.symbol).toBe("NABIL");
    expect(companies.meta.sourceType).toBe("manual");
    expect(companies.meta.productionReady).toBe(false);

    const candles = await provider.getDailyOhlc("NABIL", {
      from: "2026-11-03",
      to: "2026-11-03",
    });
    expect(candles.data).toHaveLength(1);
    expect(candles.data[0]!.close).toBe(552);
    // 15:00 Asia/Kathmandu equals 09:15 UTC.
    expect(candles.data[0]!.timestamp).toBe("2026-11-03T09:15:00.000Z");
  });

  it("only claims production readiness after an explicit licence attestation", () => {
    const unlicensed = new CsvProvider({ dataDir: fixture() });
    expect(unlicensed.descriptor.termsStatus).toBe("unverified");
    expect(unlicensed.descriptor.productionReady).toBe(false);

    const licensed = new CsvProvider({
      dataDir: fixture(),
      attestLicensed: true,
    });
    expect(licensed.descriptor.termsStatus).toBe("verified");
    expect(licensed.descriptor.productionReady).toBe(true);
  });

  it("does not invent a market summary when the file is absent", async () => {
    const provider = new CsvProvider({ dataDir: fixture() });
    await expect(provider.getMarketSummary()).rejects.toThrow(
      /market-summary.csv is missing or empty/,
    );
  });

  it("labels derived instrument lists as DERIVED instead of primary data", async () => {
    const provider = new CsvProvider({ dataDir: fixture() });

    const securities = await provider.getSecurityList();
    expect(securities.meta.classification).toBe("DERIVED");
    expect(securities.meta.warnings.join(" ")).toMatch(/derived/);

    const sectors = await provider.getSectors();
    expect(sectors.meta.classification).toBe("DERIVED");

    const indices = await provider.getIndices();
    expect(indices.meta.classification).toBe("DERIVED");
    expect(indices.meta.warnings.join(" ")).toMatch(/derived/);
  });

  it("rejects invalid OHLC rows with a row-addressed error", async () => {
    const directory = fixture();
    writeFileSync(
      join(directory, "ohlc", "NABIL.csv"),
      [
        "symbol,date,open,high,low,close,volume",
        "NABIL,2026-11-02,540,548,538,545,12000",
        "NABIL,2026-11-03,547,550,560,552,13000",
        "",
      ].join("\n"),
      "utf8",
    );
    const provider = new CsvProvider({ dataDir: directory });
    await expect(
      provider.getDailyOhlc("NABIL", { from: "2026-11-01", to: "2026-11-04" }),
    ).rejects.toThrow(/row 3.*low is above open\/close/);
  });

  it("rejects duplicate trading dates instead of silently merging them", async () => {
    const directory = fixture();
    writeFileSync(
      join(directory, "ohlc", "NABIL.csv"),
      [
        "symbol,date,open,high,low,close,volume",
        "NABIL,2026-11-03,540,548,538,545,12000",
        "NABIL,2026-11-03,545,556,544,552,13000",
        "",
      ].join("\n"),
      "utf8",
    );
    const provider = new CsvProvider({ dataDir: directory });
    await expect(
      provider.getDailyOhlc("NABIL", { from: "2026-11-01", to: "2026-11-04" }),
    ).rejects.toThrow(/duplicate trading date/);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEVELOPMENT_POLICY } from "@stock/core";
import { createPersonalFreeProvider } from "@stock/providers";
import { PersonalStore } from "@stock/store";
import { syncPersonalData } from "./sync";

const directories: string[] = [];

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "stock-sync-"));
  directories.push(directory);
  writeFileSync(
    join(directory, "companies.csv"),
    [
      "id,symbol,name,sector,instrumentType,status",
      "131,NABIL,Nabil Bank Limited,Commercial Banks,Equity,active",
      "",
    ].join("\n"),
    "utf8",
  );
  mkdirSync(join(directory, "ohlc"), { recursive: true });
  writeFileSync(
    join(directory, "ohlc", "NABIL.csv"),
    [
      "symbol,date,open,high,low,close,volume",
      "NABIL,2026-11-02,540,548,538,545,12000",
      "NABIL,2026-11-03,547,555,545,552,42360",
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

describe("syncPersonalData", () => {
  it("loads free-source files into the personal namespace", async () => {
    const store = new PersonalStore(":memory:");
    try {
      const result = await syncPersonalData({
        provider: createPersonalFreeProvider({ dataDir: fixture() }),
        policy: { ...DEVELOPMENT_POLICY, allowUnofficial: true },
        store,
        from: "2026-11-01",
        to: "2026-11-03",
      });

      expect(result.companies).toBe(1);
      expect(result.equitySeries).toBe(1);
      expect(result.candleRows).toBe(2);
      expect(result.failedSymbols).toEqual([]);

      const candles = store.getCandles({
        providerId: "free-source",
        kind: "equity",
        symbol: "NABIL",
      });
      expect(candles.map((row) => row.close)).toEqual([545, 552]);
      expect(store.getCompanies("free-source")).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("imports the optional public-web datasets when files are present", async () => {
    const dataDir = fixture();
    mkdirSync(join(dataDir, "fundamentals"), { recursive: true });
    mkdirSync(join(dataDir, "floorsheet"), { recursive: true });
    writeFileSync(
      join(dataDir, "fundamentals", "NABIL.csv"),
      [
        "period,metric,value,unit,currency,fiscalYear,quarter,reportedAt,source,confidence,notes",
        "FY083-084,eps,33.89,currency,NPR,083-084,1,2026-11-14,merolagani,unverified,test",
        "FY083-084,peRatio,16.2,ratio,,083-084,1,2026-11-14,merolagani,unverified,test",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(dataDir, "corporate-actions.csv"),
      [
        "symbol,type,ratio,value,currency,announcedAt,exDate,recordDate,sourceUrl,notes",
        "NABIL,cashDividend,10.8%,10.8,NPR,,,,https://merolagani.com/example,FY 082-083",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(dataDir, "floorsheet", "2026-11-13.csv"),
      [
        "contractId,businessDate,symbol,buyerBroker,sellerBroker,quantity,rate,amount,asOf",
        "2026111305011775,2026-11-13,AHL,62,40,10,400,4000,2026-11-13T09:15:00.000Z",
        "2026111305011377,2026-11-13,AHL,33,45,194,398.2,77250.8,2026-11-13T09:15:00.000Z",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(dataDir, "news.csv"),
      [
        "id,title,url,publishedAt,source,symbols,summary",
        "1,Headline,https://example.com/news/1,2026-11-13T12:00:00+05:45,sharesansar,,",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(dataDir, "ipos.csv"),
      [
        "id,companyName,symbol,type,openDate,closeDate,price,units,status,sourceUrl,notes",
        "1,Tenx Hydro,TENX,ipo,2026-10-28,,100,800000,closed,https://example.com/ipo,",
        "",
      ].join("\n"),
      "utf8",
    );

    const store = new PersonalStore(":memory:");
    try {
      const result = await syncPersonalData({
        provider: createPersonalFreeProvider({ dataDir }),
        policy: { ...DEVELOPMENT_POLICY, allowUnofficial: true },
        store,
        from: "2026-11-01",
        to: "2026-11-13",
        dataDir,
      });

      expect(result.fundamentals).toBe(1);
      expect(result.corporateActions).toBe(1);
      expect(result.floorsheetTrades).toBe(2);
      expect(result.brokerFlows).toBe(4);
      expect(result.ipos).toBe(1);
      expect(result.news).toBe(1);
      expect(result.snapshots).toBeGreaterThanOrEqual(7);

      expect(store.countSnapshots("free-source", "fundamentals")).toBe(1);
      expect(store.countSnapshots("free-source", "fundamentalsHistory")).toBe(1);
      expect(store.countSnapshots("free-source", "corporateActions")).toBe(1);
      expect(store.countSnapshots("free-source", "floorsheet")).toBe(1);
      expect(store.countSnapshots("free-source", "brokerFlows")).toBe(1);
      expect(store.countSnapshots("free-source", "news")).toBe(1);
      expect(store.countSnapshots("free-source", "ipos")).toBe(1);
    } finally {
      store.close();
    }
  });

  it("is blocked when unofficial data is not allowed", async () => {
    const store = new PersonalStore(":memory:");
    try {
      await expect(
        syncPersonalData({
          provider: createPersonalFreeProvider({ dataDir: fixture() }),
          policy: DEVELOPMENT_POLICY,
          store,
          from: "2026-11-01",
          to: "2026-11-03",
        }),
      ).rejects.toThrow();

      expect(store.summary("free-source").syncRuns).toBe(1);
    } finally {
      store.close();
    }
  });
});

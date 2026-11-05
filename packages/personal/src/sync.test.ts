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

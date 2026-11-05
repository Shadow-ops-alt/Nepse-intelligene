import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMeta,
  type Candle,
  type DataEnvelope,
  type ProviderDescriptor,
  type Quote,
} from "@stock/core";
import { PersonalStore } from "./store";

const personal: ProviderDescriptor = {
  id: "free-source",
  name: "Personal free-source provider",
  sourceType: "unofficial",
  environment: "development",
  termsStatus: "unverified",
  productionReady: false,
  reliability: "low",
  priority: 900,
  capabilities: ["dailyOhlc"],
  configRequired: [],
};

const licensed: ProviderDescriptor = {
  id: "licensed-vendor",
  name: "Licensed Vendor",
  sourceType: "licensed",
  environment: "production",
  termsStatus: "verified",
  productionReady: true,
  reliability: "high",
  priority: 10,
  capabilities: ["dailyOhlc"],
  configRequired: [],
};

const mock: ProviderDescriptor = {
  id: "mock",
  name: "Synthetic demo",
  sourceType: "mock",
  environment: "test",
  termsStatus: "verified",
  productionReady: false,
  reliability: "high",
  priority: 100,
  capabilities: ["dailyOhlc"],
  configRequired: [],
};

function candle(close: number, date = "2026-11-03"): Candle {
  return {
    symbol: "NABIL",
    timeframe: "1day",
    timestamp: `${date}T09:15:00.000Z`,
    open: close - 2,
    high: close + 3,
    low: close - 4,
    close,
    volume: 1000,
    adjusted: false,
  };
}

function envelope<T>(
  descriptor: ProviderDescriptor,
  data: T,
): DataEnvelope<T> {
  return { data, meta: createMeta({ descriptor }) };
}

function store(): PersonalStore {
  return new PersonalStore(":memory:");
}

describe("PersonalStore", () => {
  it("keeps each provider in its own namespace", () => {
    const db = store();
    try {
      db.upsertCandles(envelope(personal, [candle(552)]), "equity");
      db.upsertCandles(envelope(licensed, [candle(600)]), "equity");

      const free = db.getCandles({
        providerId: "free-source",
        kind: "equity",
        symbol: "NABIL",
      });
      const paid = db.getCandles({
        providerId: "licensed-vendor",
        kind: "equity",
        symbol: "NABIL",
      });

      expect(free).toHaveLength(1);
      expect(paid).toHaveLength(1);
      expect(free[0]!.close).toBe(552);
      expect(paid[0]!.close).toBe(600);

      expect(db.summary("free-source").candles).toBe(1);
      expect(db.summary("licensed-vendor").candles).toBe(1);
      expect(db.summary().candles).toBe(2);
    } finally {
      db.close();
    }
  });

  it("reports the newest stored market timestamp, not the import time", () => {
    const db = store();
    try {
      const quote: Quote = {
        symbol: "NABIL",
        ltp: 552,
        change: 2,
        changePercent: 0.36,
        open: 550,
        high: 555,
        low: 548,
        previousClose: 550,
        volume: 1000,
        turnover: 552000,
        asOf: "2026-11-03T09:15:00.000Z",
      };
      db.upsertQuotes({
        data: [quote],
        meta: createMeta({
          descriptor: personal,
          asOf: "2026-11-03T09:15:00.000Z",
        }),
      });

      expect(db.latestMarketAsOf("free-source")).toBe(
        "2026-11-03T09:15:00.000Z",
      );
      expect(db.latestMarketAsOf("licensed-vendor")).toBeNull();
      expect(db.latestMarketAsOf()).toBe("2026-11-03T09:15:00.000Z");
    } finally {
      db.close();
    }
  });

  it("filters by date range and upserts idempotently", () => {
    const db = store();
    try {
      const rows = [candle(540, "2026-11-01"), candle(545, "2026-11-02"), candle(552, "2026-11-03")];
      db.upsertCandles(envelope(personal, rows), "equity");
      db.upsertCandles(envelope(personal, rows), "equity");

      expect(
        db.getCandles({
          providerId: "free-source",
          kind: "equity",
          symbol: "NABIL",
        }),
      ).toHaveLength(3);

      const window = db.getCandles({
        providerId: "free-source",
        kind: "equity",
        symbol: "NABIL",
        from: "2026-11-02",
        to: "2026-11-03",
      });
      expect(window.map((row) => row.close)).toEqual([545, 552]);
    } finally {
      db.close();
    }
  });

  it("returns stored provenance with every record", () => {
    const db = store();
    try {
      const meta = createMeta({
        descriptor: personal,
        asOf: "2026-11-03T09:15:00.000Z",
      });
      db.upsertCandles(
        { data: [candle(552)], meta },
        "equity",
      );
      const entries = db.getCandlesWithProvenance({
        providerId: "free-source",
        kind: "equity",
        symbol: "NABIL",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.provenance).toMatchObject({
        providerId: "free-source",
        sourceType: "unofficial",
        termsStatus: "unverified",
        productionReady: false,
        asOf: "2026-11-03T09:15:00.000Z",
        classification: "UNVERIFIED",
      });
      expect(entries[0]!.provenance.fetchedAt).toBe(meta.fetchedAt);
    } finally {
      db.close();
    }
  });

  it("refuses to store demo/mock data in the product database", () => {
    const db = store();
    try {
      expect(() =>
        db.upsertCandles(envelope(mock, [candle(552)]), "equity"),
      ).toThrow(/demo\/mock data cannot be stored/);
    } finally {
      db.close();
    }
  });

  it("rejects unofficial data that claims production readiness", () => {
    const db = store();
    try {
      const meta = createMeta({ descriptor: personal });
      const unsafe: DataEnvelope<Candle[]> = {
        data: [candle(552)],
        meta: { ...meta, productionReady: true },
      };
      expect(() => db.upsertCandles(unsafe, "equity")).toThrow(
        /cannot be stored as production-ready/,
      );
    } finally {
      db.close();
    }
  });

  it("records sync runs", () => {
    const db = store();
    try {
      const id = db.beginSync("free-source");
      db.finishSync(id, "ok");
      expect(db.summary("free-source").syncRuns).toBe(1);
    } finally {
      db.close();
    }
  });

  it("stores, lists, and removes portfolio transactions", () => {
    const db = store();
    try {
      const added = db.addPortfolioTransaction({
        symbol: "nabil",
        side: "buy",
        quantity: 10,
        price: 500,
        fees: 25,
        tradedAt: "2026-11-03",
        notes: " first lot ",
      });
      expect(added.symbol).toBe("NABIL");
      expect(added.notes).toBe("first lot");

      db.addPortfolioTransaction({
        symbol: "NABIL",
        side: "sell",
        quantity: 2,
        price: 600,
        tradedAt: "2026-11-04",
      });

      const rows = db.getPortfolioTransactions();
      expect(rows.map((row) => row.side)).toEqual(["buy", "sell"]);
      expect(db.removePortfolioTransaction(added.id)).toBe(true);
      expect(db.removePortfolioTransaction(added.id)).toBe(false);
      expect(db.getPortfolioTransactions()).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("rejects invalid portfolio transactions", () => {
    const db = store();
    try {
      expect(() =>
        db.addPortfolioTransaction({
          symbol: "NABIL",
          side: "buy",
          quantity: 0,
          price: 500,
          tradedAt: "2026-11-03",
        }),
      ).toThrow(/quantity/);
      expect(() =>
        db.addPortfolioTransaction({
          symbol: "NABIL",
          side: "buy",
          quantity: 1,
          price: 500,
          tradedAt: "03/11/2026",
        }),
      ).toThrow(/tradedAt/);
    } finally {
      db.close();
    }
  });

  it("lists symbols that have stored candles", () => {
    const db = store();
    try {
      db.upsertCandles(envelope(personal, [candle(552)]), "equity");
      expect(db.getSymbolsWithCandles("free-source")).toEqual(["NABIL"]);
      expect(db.getSymbolsWithCandles("free-source", "index")).toEqual([]);
      expect(db.getLatestCandle("free-source", "nabil")).toEqual({
        close: 552,
        timestamp: "2026-11-03T09:15:00.000Z",
      });
      expect(db.getLatestCandle("free-source", "NABIL", "index")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("tracks schema versions and reopens idempotently", () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-store-"));
    const dbPath = join(directory, "personal.db");
    try {
      const first = new PersonalStore(dbPath);
      expect(first.getSchemaVersion()).toBeGreaterThanOrEqual(3);
      first.upsertCandles(envelope(personal, [candle(552)]), "equity");
      first.close();

      const second = new PersonalStore(dbPath);
      expect(second.getSchemaVersion()).toBeGreaterThanOrEqual(3);
      expect(second.summary("free-source").candles).toBe(1);
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates a consistent backup with VACUUM INTO", () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-backup-"));
    const dbPath = join(directory, "personal.db");
    const backupPath = join(directory, "backup.db");
    try {
      const db = new PersonalStore(dbPath);
      db.upsertCandles(envelope(personal, [candle(552)]), "equity");
      db.backupTo(backupPath);
      db.close();

      const restored = new PersonalStore(backupPath);
      expect(restored.summary("free-source").candles).toBe(1);
      expect(restored.getCandlesWithProvenance({
        providerId: "free-source",
        kind: "equity",
        symbol: "NABIL",
      })[0]?.provenance.classification).toBe("UNVERIFIED");
      restored.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("records import audit entries", () => {
    const db = store();
    try {
      const id = db.recordImportAudit({
        providerId: "free-source",
        startedAt: "2026-11-04T10:00:00.000Z",
        finishedAt: "2026-11-04T10:01:00.000Z",
        status: "ok",
        files: ["companies.csv", "ohlc/NABIL.csv"],
        counts: { companies: 1, candleRows: 2 },
        warnings: [],
        failedSymbols: [],
      });
      const entries = db.getImportAudit(5);
      expect(id).toBeGreaterThan(0);
      expect(entries[0]).toMatchObject({
        providerId: "free-source",
        status: "ok",
        files: ["companies.csv", "ohlc/NABIL.csv"],
        counts: { companies: 1, candleRows: 2 },
      });
    } finally {
      db.close();
    }
  });
});

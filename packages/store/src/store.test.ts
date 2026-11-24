import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

      // A later news snapshot (stamped with its fetch time) must not move the
      // market session forward.
      db.upsertSnapshot(
        "news",
        "latest",
        {
          data: [{ title: "fetched on a weekend" }],
          meta: createMeta({ descriptor: personal, asOf: "2026-11-07T10:00:00.000Z" }),
        },
      );
      expect(db.latestMarketAsOf("free-source")).toBe("2026-11-03T09:15:00.000Z");
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

  it("creates, reads, updates and deletes trade plans", () => {
    const db = store();
    try {
      const plan = db.addTradePlan({
        symbol: "nabil",
        side: "buy",
        entry: 500,
        stop: 480,
        targets: [550, 600],
        quantity: 10,
        notes: "  breakout  ",
      });
      expect(plan).toMatchObject({
        symbol: "NABIL",
        side: "buy",
        entry: 500,
        stop: 480,
        targets: [550, 600],
        quantity: 10,
        riskAmount: 200,
        riskPercent: 4,
        rewardRisk: 2.5,
        fees: 0,
        notes: "breakout",
      });
      expect(db.getTradePlans()).toHaveLength(1);
      expect(db.getTradePlans("NABIL")).toHaveLength(1);
      expect(db.getTradePlan(plan.id)?.symbol).toBe("NABIL");

      const updated = db.updateTradePlan(plan.id, { stop: 470 });
      expect(updated?.stop).toBe(470);
      expect(updated?.riskAmount).toBe(300);
      expect(updated?.rewardRisk).toBeCloseTo(5 / 3, 4);

      expect(db.removeTradePlan(plan.id)).toBe(true);
      expect(db.getTradePlan(plan.id)).toBeNull();
      expect(db.removeTradePlan(plan.id)).toBe(false);
    } finally {
      db.close();
    }
  });

  it("rejects invalid trade plans", () => {
    const db = store();
    try {
      const valid = {
        symbol: "NABIL",
        side: "buy" as const,
        entry: 500,
        stop: 480,
        targets: [550],
        quantity: 10,
      };
      expect(() => db.addTradePlan({ ...valid, symbol: "bad symbol" })).toThrow(
        /symbol/,
      );
      expect(() => db.addTradePlan({ ...valid, side: "hold" as "buy" })).toThrow(
        /side/,
      );
      expect(() => db.addTradePlan({ ...valid, entry: 0 })).toThrow(/entry/);
      expect(() => db.addTradePlan({ ...valid, quantity: 1.5 })).toThrow(
        /quantity/,
      );
      expect(() => db.addTradePlan({ ...valid, targets: [] })).toThrow(
        /targets/,
      );
      expect(() =>
        db.addTradePlan({ ...valid, targets: [550, 560, 570, 580] }),
      ).toThrow(/targets/);
      expect(() => db.addTradePlan({ ...valid, stop: 520 })).toThrow(/stop/);
      expect(() =>
        db.addTradePlan({ ...valid, targets: [450] }),
      ).toThrow(/targets/);
      expect(() =>
        db.addTradePlan({
          symbol: "NABIL",
          side: "sell",
          entry: 500,
          stop: 520,
          targets: [450],
          quantity: 10,
        }),
      ).not.toThrow();
      expect(() =>
        db.addTradePlan({
          symbol: "NABIL",
          side: "sell",
          entry: 500,
          stop: 480,
          targets: [450],
          quantity: 10,
        }),
      ).toThrow(/sell stop/);
    } finally {
      db.close();
    }
  });

  it("computes journal P&L and leaves it null without an exit", () => {
    const db = store();
    try {
      const closed = db.addJournalEntry({
        symbol: "NABIL",
        side: "buy",
        actualEntry: 500,
        actualExit: 550,
        quantity: 10,
        fees: 25,
        tags: ["breakout", " "],
        snapshot: { rsi: 61 },
        openedAt: "2026-01-02",
        closedAt: "2026-01-05",
      });
      expect(closed.pnl).toBe(475);
      expect(closed.tags).toEqual(["breakout"]);
      expect(closed.snapshot).toEqual({ rsi: 61 });
      expect(closed.paper).toBe(false);

      const open = db.addJournalEntry({
        symbol: "NABIL",
        side: "buy",
        actualEntry: 500,
        quantity: 10,
      });
      expect(open.pnl).toBeNull();
      expect(open.actualExit).toBeNull();

      const short = db.addJournalEntry({
        symbol: "NABIL",
        side: "sell",
        actualEntry: 500,
        actualExit: 450,
        quantity: 10,
      });
      expect(short.pnl).toBe(500);

      const listed = db.getJournalEntries({ symbol: "NABIL" });
      expect(listed).toHaveLength(3);
      const patched = db.updateJournalEntry(open.id, { actualExit: 530 });
      expect(patched?.pnl).toBe(300);
      // Clearing the exit clears the P&L again: no fill is invented.
      const cleared = db.updateJournalEntry(open.id, { actualExit: null });
      expect(cleared?.pnl).toBeNull();

      expect(db.getJournalEntries({ from: "2026-01-01", to: "2026-01-31" })).toHaveLength(
        1,
      );
      expect(db.removeJournalEntry(closed.id)).toBe(true);
      expect(db.getJournalEntries()).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it("stores journal chart snapshots without leaking them in reads", () => {
    const db = store();
    try {
      const png =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      const image = `data:image/png;base64,${png}`;

      const created = db.addJournalEntry({
        symbol: "NABIL",
        side: "buy",
        snapshotImage: image,
      });
      expect(created.hasSnapshot).toBe(true);
      expect(created).not.toHaveProperty("snapshotImage");

      const stored = db.getJournalSnapshot(created.id);
      expect(stored?.mime).toBe("image/png");
      expect(stored?.data.toString("base64")).toBe(png);

      const listed = db.getJournalEntries({ symbol: "NABIL" });
      expect(listed[0]?.hasSnapshot).toBe(true);
      expect(listed[0]).not.toHaveProperty("snapshotImage");

      // An update that does not mention the image keeps it.
      const kept = db.updateJournalEntry(created.id, { reason: "kept" });
      expect(kept?.hasSnapshot).toBe(true);
      expect(db.getJournalSnapshot(created.id)).not.toBeNull();

      // null removes it.
      const removed = db.updateJournalEntry(created.id, {
        snapshotImage: null,
      });
      expect(removed?.hasSnapshot).toBe(false);
      expect(db.getJournalSnapshot(created.id)).toBeNull();

      // A string replaces it.
      const replaced = db.updateJournalEntry(created.id, {
        snapshotImage: image,
      });
      expect(replaced?.hasSnapshot).toBe(true);

      expect(() =>
        db.addJournalEntry({
          symbol: "NABIL",
          side: "buy",
          snapshotImage: "data:image/gif;base64,AAAA",
        }),
      ).toThrow(/snapshotImage/);

      const oversized = `data:image/png;base64,${"A".repeat(2_097_288)}`;
      expect(() =>
        db.addJournalEntry({
          symbol: "NABIL",
          side: "buy",
          snapshotImage: oversized,
        }),
      ).toThrow(/1\.5 MB/);
    } finally {
      db.close();
    }
  });

  it("imports reconciliation rows idempotently by external id", () => {
    const db = store();
    try {
      const rows = [
        {
          symbol: "NABIL",
          side: "buy" as const,
          quantity: 10,
          price: 500,
          fees: 50,
          tradedAt: "2026-01-02",
          externalId: "broker-1",
          notes: "first fill",
        },
        {
          symbol: "NABIL",
          side: "buy" as const,
          quantity: 5,
          price: 510,
          tradedAt: "2026-01-03",
          externalId: "broker-2",
        },
      ];
      const first = db.importReconciliation("csv", rows);
      expect(first.imported).toBe(2);
      expect(first.skipped).toBe(0);
      expect(first.importId).toBeGreaterThan(0);

      const second = db.importReconciliation("csv", rows);
      expect(second.imported).toBe(0);
      expect(second.skipped).toBe(2);

      // A row without an external id is always inserted.
      const manual = db.importReconciliation("csv", [
        {
          symbol: "ADBL",
          side: "sell",
          quantity: 1,
          price: 300,
          tradedAt: "2026-01-04",
        },
      ]);
      expect(manual.imported).toBe(1);

      const transactions = db.getReconciliationTransactions();
      expect(transactions).toHaveLength(3);
      expect(transactions[0]).toMatchObject({
        symbol: "NABIL",
        source: "csv",
        externalId: "broker-1",
        kind: "trade",
        notes: "first fill",
      });
      expect(db.getPortfolioTransactions()).toHaveLength(3);

      const imports = db.listReconciliationImports();
      expect(imports).toHaveLength(3);
      expect(imports[0]).toMatchObject({ source: "csv", rowsCount: 1 });
      expect(imports[1]?.summary).toEqual({ imported: 0, skipped: 2 });
    } finally {
      db.close();
    }
  });

  it("records corporate ledger entries", () => {
    const db = store();
    try {
      const dividend = db.addCorporateLedgerEntry({
        symbol: "NABIL",
        kind: "dividend",
        exDate: "2026-02-01",
        amount: 1200,
        notes: "cash dividend",
      });
      const bonus = db.addCorporateLedgerEntry({
        symbol: "NABIL",
        kind: "bonus",
        exDate: "2026-03-01",
        shares: 5,
      });
      expect(dividend.amount).toBe(1200);
      expect(bonus.shares).toBe(5);
      expect(db.getCorporateLedger("NABIL")).toHaveLength(2);
      expect(db.getCorporateLedger()).toHaveLength(2);
      expect(() =>
        db.addCorporateLedgerEntry({
          symbol: "NABIL",
          kind: "merger" as "other",
        }),
      ).toThrow(/kind/);
      expect(db.removeCorporateLedgerEntry(dividend.id)).toBe(true);
      expect(db.getCorporateLedger("NABIL")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("repairs a database that records version 5 without the trading tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "store-migrate-"));
    const dbPath = join(dir, "personal.db");
    try {
      const first = new PersonalStore(dbPath);
      first.close();

      // The field failure: the bookkeeping row says version 5 is applied, but
      // the trading tables were never created (adopted or partially migrated
      // file). Migration 6 used to ALTER the missing journal and crash.
      const raw = new DatabaseSync(dbPath);
      raw.exec("DROP TABLE IF EXISTS trade_journal");
      raw.exec("DROP TABLE IF EXISTS trade_plans");
      raw.exec("DELETE FROM schema_migrations WHERE version >= 5");
      raw
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?)")
        .run(new Date().toISOString());
      raw.close();

      const repaired = new PersonalStore(dbPath);
      expect(repaired.getSchemaVersion()).toBe(6);
      // Reads snapshot_image, so it throws if the column is absent.
      expect(repaired.getJournalSnapshot(1)).toBeNull();
      repaired.close();

      const check = new DatabaseSync(dbPath);
      const tables = check
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('trade_plans','trade_journal','corporate_ledger','reconciliation_imports')",
        )
        .all()
        .map((row) => String(row.name))
        .sort();
      check.close();
      expect(tables).toEqual([
        "corporate_ledger",
        "reconciliation_imports",
        "trade_journal",
        "trade_plans",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

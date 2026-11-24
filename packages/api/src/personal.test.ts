import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMeta,
  type Candle,
  type DataEnvelope,
  type ProviderDescriptor,
  type Quote,
} from "@stock/core";
import { PersonalStore } from "@stock/store";
import { createApiServer } from "./app";

const directories: string[] = [];

const descriptor: ProviderDescriptor = {
  id: "free-source",
  name: "Personal free-source provider",
  sourceType: "unofficial",
  environment: "development",
  termsStatus: "unverified",
  productionReady: false,
  reliability: "low",
  priority: 900,
  capabilities: ["dailyOhlc", "liveQuotes"],
  configRequired: [],
};

function envelope<T>(data: T): DataEnvelope<T> {
  return { data, meta: createMeta({ descriptor }) };
}

function equityCandle(symbol: string, close: number, date: string): Candle {
  return {
    symbol,
    timeframe: "1day",
    timestamp: `${date}T09:15:00.000Z`,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1000,
    adjusted: false,
  };
}

function dateOf(day: number): string {
  return `2026-01-${String(day).padStart(2, "0")}`;
}

interface JsonResult {
  status: number;
  body: Record<string, unknown>;
}

async function jsonFetch(
  base: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<JsonResult> {
  const response = await fetch(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers:
      init?.body === undefined
        ? {}
        : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

interface RawResult {
  status: number;
  contentType: string | null;
  cacheControl: string | null;
  bytes: Uint8Array;
}

async function rawFetch(base: string, path: string): Promise<RawResult> {
  const response = await fetch(`${base}${path}`);
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe("personal endpoints", () => {
  it("serves trade plans, journal, reconciliation, ledger and data quality", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-personal-api-"));
    directories.push(directory);
    const dbPath = join(directory, "personal.db");
    const dataDir = join(directory, "data");
    mkdirSync(dataDir, { recursive: true });

    const seed = new PersonalStore(dbPath);
    const candles: Candle[] = [];
    for (let day = 1; day <= 10; day += 1) {
      candles.push(equityCandle("NABIL", 640 + day, dateOf(day)));
      candles.push(equityCandle("ADBL", 299 + day, dateOf(day)));
      if (day <= 9) {
        candles.push(equityCandle("SCB", 400 + day, dateOf(day)));
      }
    }
    seed.upsertCandles(envelope(candles), "equity");

    const nabilsQuote: Quote = {
      symbol: "NABIL",
      ltp: 660,
      change: 10,
      changePercent: 1.5385,
      open: 652,
      high: 662,
      low: 650,
      previousClose: 650,
      volume: 5000,
      turnover: 3_300_000,
      session: "eod",
      asOf: "2026-01-10T09:15:00.000Z",
    };
    seed.upsertQuotes(envelope([nabilsQuote]));

    seed.addPortfolioTransaction({
      symbol: "NABIL",
      side: "buy",
      quantity: 10,
      price: 600,
      fees: 50,
      tradedAt: "2026-01-02",
    });
    seed.addPortfolioTransaction({
      symbol: "NABIL",
      side: "sell",
      quantity: 5,
      price: 700,
      fees: 25,
      tradedAt: "2026-01-05",
    });
    seed.addCorporateLedgerEntry({
      symbol: "NABIL",
      kind: "dividend",
      exDate: "2026-01-06",
      amount: 120,
    });
    seed.addCorporateLedgerEntry({
      symbol: "NABIL",
      kind: "bonus",
      exDate: "2026-01-07",
      shares: 2,
    });
    seed.addCorporateLedgerEntry({
      symbol: "NABIL",
      kind: "right",
      exDate: "2026-01-08",
      shares: 1,
    });
    seed.close();

    const { server } = createApiServer({
      dbPath,
      dataDir,
      env: {
        NODE_ENV: "development",
        PERSONAL_DATA_DIR: dataDir,
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    try {
      // --- reconciliation summary (before importing extra rows) ---
      const summary = await jsonFetch(base, "/api/reconciliation/summary");
      expect(summary.status).toBe(200);
      expect(summary.body).toMatchObject({
        realizedPnl: 450,
        unrealizedPnl: 275,
        totalPnl: 725,
        dividends: 120,
        bonusShares: 2,
        rightsShares: 1,
        concentration: {
          topSymbol: "NABIL",
          topPercent: 100,
          hhi: 1,
        },
      });
      expect(summary.body.xirr).not.toBeNull();
      expect(typeof summary.body.xirr).toBe("number");
      expect(summary.body.exposure).toEqual([
        { symbol: "NABIL", marketValue: 3300, percent: 100 },
      ]);
      expect(summary.body.imports).toEqual([]);

      // --- data quality ---
      const quality = await jsonFetch(base, "/api/data-quality");
      expect(quality.status).toBe(200);
      expect(quality.body.latestSession).toBe("2026-01-10");
      expect(quality.body.summary).toEqual({
        symbols: 3,
        fresh: 0,
        stale: 1,
        missingSessions: 1,
        quoteDiscrepancies: 1,
      });
      const rows = quality.body.symbols as Array<Record<string, unknown>>;
      expect(rows.map((row) => row.symbol)).toEqual(["NABIL", "SCB", "ADBL"]);
      expect(rows[0]).toMatchObject({
        symbol: "NABIL",
        lastCandle: 650,
        lastQuote: 660,
        sessions: 10,
        missingSessions: 0,
        staleDays: 0,
        status: "discrepancy",
      });
      expect(rows[0]?.quoteVsCandlePercent).toBeCloseTo(1.5385, 4);
      expect(rows[1]).toMatchObject({
        symbol: "SCB",
        sessions: 9,
        missingSessions: 1,
        staleDays: 1,
        lastQuote: null,
        quoteVsCandlePercent: null,
        status: "stale",
      });
      expect(rows[2]).toMatchObject({ symbol: "ADBL", sessions: 10, status: "thin" });

      // --- trade plans ---
      const createdPlan = await jsonFetch(base, "/api/trade-plans", {
        method: "POST",
        body: {
          symbol: "nabil",
          side: "buy",
          entry: 500,
          stop: 480,
          targets: [550, 600],
          quantity: 10,
        },
      });
      expect(createdPlan.status).toBe(201);
      const plan = createdPlan.body.plan as Record<string, unknown>;
      expect(plan).toMatchObject({
        symbol: "NABIL",
        riskAmount: 200,
        riskPercent: 4,
        rewardRisk: 2.5,
      });

      const invalidPlan = await jsonFetch(base, "/api/trade-plans", {
        method: "POST",
        body: {
          symbol: "NABIL",
          side: "buy",
          entry: 500,
          stop: 520,
          targets: [550],
          quantity: 10,
        },
      });
      expect(invalidPlan.status).toBe(400);
      expect(typeof invalidPlan.body.error).toBe("string");

      const patchedPlan = await jsonFetch(
        base,
        `/api/trade-plans/${String(plan.id)}`,
        { method: "PATCH", body: { stop: 470 } },
      );
      expect(patchedPlan.status).toBe(200);
      expect(patchedPlan.body.plan).toMatchObject({ stop: 470, riskAmount: 300 });

      const plans = await jsonFetch(base, "/api/trade-plans?symbol=NABIL");
      expect((plans.body.plans as unknown[]).length).toBe(1);

      const removedPlan = await jsonFetch(
        base,
        `/api/trade-plans/${String(plan.id)}`,
        { method: "DELETE" },
      );
      expect(removedPlan.status).toBe(200);
      expect(removedPlan.body).toEqual({ deleted: true });

      // --- journal ---
      const closed = await jsonFetch(base, "/api/journal", {
        method: "POST",
        body: {
          symbol: "NABIL",
          side: "buy",
          actualEntry: 500,
          actualExit: 550,
          quantity: 10,
          fees: 25,
          tags: ["breakout"],
          openedAt: "2026-01-02",
        },
      });
      expect(closed.status).toBe(201);
      const journalEntry = closed.body.entry as Record<string, unknown>;
      expect(journalEntry.pnl).toBe(475);
      expect(journalEntry.tags).toEqual(["breakout"]);

      const open = await jsonFetch(base, "/api/journal", {
        method: "POST",
        body: {
          symbol: "NABIL",
          side: "buy",
          actualEntry: 500,
          quantity: 10,
        },
      });
      expect((open.body.entry as Record<string, unknown>).pnl).toBeNull();

      const openId = (open.body.entry as Record<string, unknown>).id;
      const patchedJournal = await jsonFetch(
        base,
        `/api/journal/${String(openId)}`,
        { method: "PATCH", body: { actualExit: 530 } },
      );
      expect(patchedJournal.status).toBe(200);
      expect(patchedJournal.body.entry).toMatchObject({ pnl: 300 });

      const journal = await jsonFetch(base, "/api/journal?symbol=NABIL");
      expect((journal.body.entries as unknown[]).length).toBe(2);

      // --- corporate ledger ---
      const ledgerEntry = await jsonFetch(base, "/api/corporate-ledger", {
        method: "POST",
        body: {
          symbol: "ADBL",
          kind: "dividend",
          exDate: "2026-01-09",
          amount: 75,
        },
      });
      expect(ledgerEntry.status).toBe(201);
      const ledgerId = (ledgerEntry.body.entry as Record<string, unknown>).id;
      const ledger = await jsonFetch(base, "/api/corporate-ledger?symbol=ADBL");
      expect((ledger.body.entries as unknown[]).length).toBe(1);
      const removedLedger = await jsonFetch(
        base,
        `/api/corporate-ledger/${String(ledgerId)}`,
        { method: "DELETE" },
      );
      expect(removedLedger.body).toEqual({ deleted: true });

      // --- reconciliation import ---
      const csv =
        "symbol,side,quantity,price,traded_at,fees,external_id,notes\n" +
        "ADBL,buy,10,300,2026-01-07,15,imp-1,first fill\n" +
        "ADBL,buy,10,300,2026-01-07,15,imp-1,duplicate\n";
      const firstImport = await jsonFetch(base, "/api/reconciliation/import", {
        method: "POST",
        body: { source: "csv", csv },
      });
      expect(firstImport.status).toBe(200);
      expect(firstImport.body).toMatchObject({ imported: 1, skipped: 1 });
      expect(firstImport.body.importId).toBeGreaterThan(0);

      const secondImport = await jsonFetch(base, "/api/reconciliation/import", {
        method: "POST",
        body: { source: "csv", csv },
      });
      expect(secondImport.body).toMatchObject({ imported: 0, skipped: 2 });

      const transactions = await jsonFetch(
        base,
        "/api/reconciliation/transactions",
      );
      const rows2 = transactions.body.transactions as Array<
        Record<string, unknown>
      >;
      const imported = rows2.find((row) => row.externalId === "imp-1");
      expect(imported).toMatchObject({
        symbol: "ADBL",
        source: "csv",
        kind: "trade",
        notes: "first fill",
      });

      const missingSource = await jsonFetch(
        base,
        "/api/reconciliation/import",
        { method: "POST", body: { csv } },
      );
      expect(missingSource.status).toBe(400);

      const badCsv = await jsonFetch(base, "/api/reconciliation/import", {
        method: "POST",
        body: {
          source: "csv",
          csv: "symbol,side,quantity,price,traded_at\nNABIL,hold,1,10,2026-01-01\n",
        },
      });
      expect(badCsv.status).toBe(400);
      expect(typeof badCsv.body.error).toBe("string");

      const summaryAfter = await jsonFetch(base, "/api/reconciliation/summary");
      expect((summaryAfter.body.imports as unknown[]).length).toBe(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("stores journal chart snapshots and serves the raw image", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-journal-snapshot-"));
    directories.push(directory);
    const dbPath = join(directory, "personal.db");
    const dataDir = join(directory, "data");
    mkdirSync(dataDir, { recursive: true });
    const seed = new PersonalStore(dbPath);
    seed.close();

    const { server } = createApiServer({
      dbPath,
      dataDir,
      env: {
        NODE_ENV: "development",
        PERSONAL_DATA_DIR: dataDir,
      },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    try {
      const png =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      const image = `data:image/png;base64,${png}`;

      const created = await jsonFetch(base, "/api/journal", {
        method: "POST",
        body: { symbol: "NABIL", side: "buy", snapshotImage: image },
      });
      expect(created.status).toBe(201);
      const entry = created.body.entry as Record<string, unknown>;
      expect(entry.hasSnapshot).toBe(true);
      expect(entry).not.toHaveProperty("snapshotImage");
      const id = Number(entry.id);

      const listed = await jsonFetch(base, "/api/journal?symbol=NABIL");
      const rows = listed.body.entries as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.hasSnapshot).toBe(true);
      expect(rows[0]).not.toHaveProperty("snapshotImage");

      const raw = await rawFetch(base, `/api/journal/${String(id)}/snapshot`);
      expect(raw.status).toBe(200);
      expect(raw.contentType).toBe("image/png");
      expect(raw.cacheControl).toBe("no-store");
      expect(Buffer.from(raw.bytes).toString("base64")).toBe(png);

      // Omitting the field keeps the image.
      const kept = await jsonFetch(base, `/api/journal/${String(id)}`, {
        method: "PATCH",
        body: { reason: "kept" },
      });
      expect(
        (kept.body.entry as Record<string, unknown>).hasSnapshot,
      ).toBe(true);

      // null removes it and the snapshot route then returns 404.
      const cleared = await jsonFetch(base, `/api/journal/${String(id)}`, {
        method: "PATCH",
        body: { snapshotImage: null },
      });
      expect(
        (cleared.body.entry as Record<string, unknown>).hasSnapshot,
      ).toBe(false);
      const gone = await rawFetch(
        base,
        `/api/journal/${String(id)}/snapshot`,
      );
      expect(gone.status).toBe(404);

      const invalid = await jsonFetch(base, "/api/journal", {
        method: "POST",
        body: {
          symbol: "NABIL",
          side: "buy",
          snapshotImage: "data:image/gif;base64,AAAA",
        },
      });
      expect(invalid.status).toBe(400);
      expect(String(invalid.body.error)).toMatch(/snapshotImage/);

      const oversized = `data:image/png;base64,${"A".repeat(2_097_288)}`;
      const tooBig = await jsonFetch(base, "/api/journal", {
        method: "POST",
        body: { symbol: "NABIL", side: "buy", snapshotImage: oversized },
      });
      expect(tooBig.status).toBe(400);
      expect(String(tooBig.body.error)).toMatch(/1\.5 MB/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

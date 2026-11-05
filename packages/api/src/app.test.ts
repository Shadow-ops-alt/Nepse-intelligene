import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMeta,
  type Candle,
  type Company,
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
  environment: "production",
  termsStatus: "unverified",
  productionReady: false,
  reliability: "low",
  priority: 900,
  capabilities: ["companyList", "dailyOhlc", "liveQuotes"],
  configRequired: [],
};

function envelope<T>(data: T): DataEnvelope<T> {
  return { data, meta: createMeta({ descriptor }) };
}

function candle(close: number, date: string): Candle {
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

function rawRequest(
  port: number,
  options: { method: string; path: string; headers: Record<string, string>; body?: string },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe("api server", () => {
  it("serves free-edition data from the local store", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-api-"));
    directories.push(directory);
    const dbPath = join(directory, "personal.db");
    const dataDir = join(directory, "data");
    mkdirSync(join(dataDir, "ohlc"), { recursive: true });
    writeFileSync(
      join(dataDir, "companies.csv"),
      "id,symbol,name,sector,instrumentType,status\n131,NABIL,Nabil Bank Limited,Commercial Banks,Equity,active\n",
    );
    writeFileSync(
      join(dataDir, "ohlc", "NABIL.csv"),
      "date,open,high,low,close,volume\n2026-11-02,540,548,538,545,12000\n2026-11-03,545,556,544,552,13000\n",
    );

    const store = new PersonalStore(dbPath);
    const company: Company = {
      id: "131",
      symbol: "NABIL",
      name: "Nabil Bank Limited",
      sector: "Commercial Banks",
      instrumentType: "Equity",
      status: "active",
    };
    store.upsertCompanies(envelope([company]));
    store.upsertCandles(
      envelope([candle(545, "2026-11-02"), candle(552, "2026-11-03")]),
      "equity",
    );
    store.upsertSnapshot(
      "indices",
      "all",
      envelope([{ symbol: "NEPSE", name: "NEPSE Index", isSector: false }]),
    );
    store.upsertCandles(
      envelope([
        {
          symbol: "NEPSE",
          timeframe: "1day",
          timestamp: "2026-11-02T09:15:00.000Z",
          open: 2650,
          high: 2670,
          low: 2640,
          close: 2657.5,
          volume: 0,
          adjusted: false,
        },
        {
          symbol: "NEPSE",
          timeframe: "1day",
          timestamp: "2026-11-03T09:15:00.000Z",
          open: 2655,
          high: 2665,
          low: 2643,
          close: 2664.13,
          volume: 0,
          adjusted: false,
        },
      ]),
      "index",
    );
    const eodQuote: Quote = {
      symbol: "NABIL",
      ltp: 552,
      change: 7,
      changePercent: 1.2844,
      open: 547,
      high: 556,
      low: 545,
      previousClose: 545,
      volume: 42360,
      turnover: 23333426.4,
      session: "eod",
      asOf: new Date().toISOString(),
    };
    store.upsertQuotes(envelope([eodQuote]));
    store.close();

    const { server } = createApiServer({
      dbPath,
      dataDir,
      env: {
        NODE_ENV: "production",
        DATA_EDITION: "free",
        PERSONAL_DATA_DIR: dataDir,
      },
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    try {
      const meta = (await (await fetch(`${base}/api/meta`)).json()) as {
        edition: string;
        provider: { sourceType: string } | null;
        dataState: { state: string; classification: string };
      };
      expect(meta.edition).toBe("free");
      expect(meta.provider?.sourceType).toBe("unofficial");
      expect(meta.dataState.classification).toBe("UNVERIFIED");
      expect(meta.dataState.state).not.toBe("live");

      const candles = (await (
        await fetch(`${base}/api/candles?symbol=NABIL`)
      ).json()) as {
        candles: Candle[];
        provenance: { classification: string; state: string } | null;
        dataState: { state: string };
      };
      expect(candles.candles).toHaveLength(2);
      expect(candles.provenance?.classification).toBe("UNVERIFIED");
      expect(["eod", "stale"]).toContain(candles.provenance?.state);
      expect(candles.dataState.state).toBe(candles.provenance?.state);

      const analysis = (await (
        await fetch(`${base}/api/analysis?symbol=NABIL`)
      ).json()) as { analysis: { lastClose: number } | null };
      expect(analysis.analysis?.lastClose).toBe(552);

      const indices = (await (
        await fetch(`${base}/api/indices`)
      ).json()) as {
        indices: Array<{
          symbol: string;
          value: number | null;
          change: number | null;
          changePercent: number | null;
          provenance: { classification: string } | null;
        }>;
      };
      expect(indices.indices).toHaveLength(1);
      expect(indices.indices[0]?.symbol).toBe("NEPSE");
      expect(indices.indices[0]?.value).toBe(2664.13);
      expect(indices.indices[0]?.change).toBe(6.63);
      expect(indices.indices[0]?.changePercent).toBe(0.2495);
      expect(indices.indices[0]?.provenance?.classification).toBe("UNVERIFIED");

      const quotes = (await (await fetch(`${base}/api/quotes`)).json()) as {
        quotes: Quote[];
        provenance: Record<string, { state: string }>;
        dataState: { state: string };
      };
      expect(quotes.quotes).toHaveLength(1);
      expect(quotes.quotes[0]?.session).toBe("eod");
      expect(quotes.provenance.NABIL?.state).toBe("eod");
      expect(quotes.dataState.state).toBe("eod");

      const added = (await (
        await fetch(`${base}/api/watchlist`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ symbol: "nabil", action: "add" }),
        })
      ).json()) as { symbols: string[] };
      expect(added.symbols).toEqual(["NABIL"]);

      const watchlist = (await (
        await fetch(`${base}/api/watchlist`)
      ).json()) as { symbols: string[] };
      expect(watchlist.symbols).toEqual(["NABIL"]);

      const screener = (await (
        await fetch(`${base}/api/screener`)
      ).json()) as { rows: Array<{ symbol: string; observations: number }> };
      expect(screener.rows).toHaveLength(1);
      expect(screener.rows[0]?.symbol).toBe("NABIL");
      expect(screener.rows[0]?.observations).toBe(2);

      const created = (await (
        await fetch(`${base}/api/portfolio/transactions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            symbol: "NABIL",
            side: "buy",
            quantity: 10,
            price: 500,
            fees: 50,
            tradedAt: "2026-11-03",
          }),
        })
      ).json()) as { transaction: { id: number } };
      expect(created.transaction.id).toBeGreaterThan(0);

      const portfolio = (await (
        await fetch(`${base}/api/portfolio`)
      ).json()) as {
        positions: Array<{
          symbol: string;
          quantity: number;
          averageCost: number;
          marketPrice: number | null;
          realizedPnl: number;
        }>;
        totals: { costBasis: number; unrealizedPnl: number };
        warnings: string[];
      };
      expect(portfolio.positions[0]?.symbol).toBe("NABIL");
      expect(portfolio.positions[0]?.quantity).toBe(10);
      expect(portfolio.positions[0]?.averageCost).toBe(505);
      expect(portfolio.positions[0]?.marketPrice).toBe(552);
      expect(portfolio.totals.costBasis).toBe(5050);
      expect(portfolio.totals.unrealizedPnl).toBe(470);
      // A stored quote takes precedence over the daily-close fallback.
      expect(portfolio.warnings).toEqual([]);

      const removed = (await (
        await fetch(`${base}/api/portfolio/transactions/remove`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: created.transaction.id }),
        })
      ).json()) as { removed: boolean };
      expect(removed.removed).toBe(true);

      const importStatus = (await (
        await fetch(`${base}/api/import/status`)
      ).json()) as {
        canImport: boolean;
        ready: boolean;
        missing: string[];
        files: Array<{ name: string; exists: boolean }>;
        ohlc: string[];
      };
      expect(importStatus.canImport).toBe(true);
      expect(importStatus.ready).toBe(true);
      expect(importStatus.missing).toEqual([]);
      expect(importStatus.ohlc).toEqual(["NABIL.csv"]);
      expect(
        importStatus.files.find((file) => file.name === "companies.csv")?.exists,
      ).toBe(true);

      const imported = (await (
        await fetch(`${base}/api/import/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ from: "2026-11-01", to: "2026-11-04" }),
        })
      ).json()) as { result: { equitySeries: number; candleRows: number } };
      expect(imported.result.equitySeries).toBe(1);
      expect(imported.result.candleRows).toBe(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("explains which files are missing instead of a generic provider failure", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-api-empty-"));
    directories.push(directory);
    const dbPath = join(directory, "personal.db");
    const dataDir = join(directory, "data");
    mkdirSync(dataDir, { recursive: true });

    const { server } = createApiServer({
      dbPath,
      dataDir,
      env: {
        NODE_ENV: "production",
        DATA_EDITION: "free",
        PERSONAL_DATA_DIR: dataDir,
      },
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    try {
      const status = (await (
        await fetch(`${base}/api/import/status`)
      ).json()) as { ready: boolean; missing: string[] };
      expect(status.ready).toBe(false);
      expect(status.missing).toEqual(["companies.csv", "ohlc/<SYMBOL>.csv"]);

      const response = await fetch(`${base}/api/import/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(/Nothing to import/);
      expect(body.error).toContain(dataDir);
      expect(body.error).toContain("companies.csv");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("previews without writing and rolls back a fatal validation error", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-api-bad-"));
    directories.push(directory);
    const dbPath = join(directory, "personal.db");
    const dataDir = join(directory, "data");
    mkdirSync(join(dataDir, "ohlc"), { recursive: true });
    writeFileSync(
      join(dataDir, "companies.csv"),
      "id,symbol,name,sector,instrumentType,status\n131,NABIL,Nabil Bank Limited,Commercial Banks,Equity,active\n",
    );
    writeFileSync(
      join(dataDir, "ohlc", "NABIL.csv"),
      "symbol,date,open,high,low,close,volume\nNABIL,2026-11-03,547,550,560,552,13000\n",
    );

    const { server } = createApiServer({
      dbPath,
      dataDir,
      env: {
        NODE_ENV: "production",
        DATA_EDITION: "free",
        PERSONAL_DATA_DIR: dataDir,
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    try {
      const preview = await fetch(
        `${base}/api/import/preview?from=2026-11-01&to=2026-11-04`,
      );
      expect(preview.status).toBe(400);
      const previewBody = (await preview.json()) as { error: string };
      expect(previewBody.error).toMatch(/invalid row/);
      expect(previewBody.error).toMatch(/row 2/);
      expect(previewBody.error).toMatch(/low is above open\/close/);

      const before = (await (await fetch(`${base}/api/meta`)).json()) as {
        store: { companies: number; candles: number };
      };
      expect(before.store.companies).toBe(0);
      expect(before.store.candles).toBe(0);

      const run = await fetch(`${base}/api/import/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "2026-11-01", to: "2026-11-04" }),
      });
      expect(run.status).toBe(400);
      const runBody = (await run.json()) as { error: string };
      expect(runBody.error).toMatch(/invalid row/);

      const after = (await (await fetch(`${base}/api/meta`)).json()) as {
        store: { companies: number; candles: number };
      };
      expect(after.store.companies).toBe(0);
      expect(after.store.candles).toBe(0);

      const history = (await (
        await fetch(`${base}/api/import/history`)
      ).json()) as {
        entries: Array<{ status: string; counts: Record<string, number> }>;
      };
      expect(history.entries).toHaveLength(1);
      expect(history.entries[0]?.status).toBe("failed");
      expect(history.entries[0]?.counts.companies).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("never labels a quote live, guards writes, and separates capability from data", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-api-guard-"));
    directories.push(directory);
    const dbPath = join(directory, "personal.db");
    const dataDir = join(directory, "data");
    mkdirSync(dataDir, { recursive: true });

    const store = new PersonalStore(dbPath);
    // A quote file with no session column, timestamped "now".
    const sessionless: Quote = {
      symbol: "NABIL",
      ltp: 552,
      change: 7,
      changePercent: 1.2844,
      open: 547,
      high: 556,
      low: 545,
      previousClose: 545,
      volume: 42360,
      turnover: 23333426.4,
      asOf: new Date().toISOString(),
    };
    store.upsertQuotes(envelope([sessionless]));
    store.close();

    const { server } = createApiServer({
      dbPath,
      dataDir,
      env: { NODE_ENV: "production", DATA_EDITION: "free", PERSONAL_DATA_DIR: dataDir },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    try {
      const quotes = (await (await fetch(`${base}/api/quotes`)).json()) as {
        provenance: Record<string, { state: string }>;
        dataState: { state: string };
      };
      expect(quotes.provenance.NABIL?.state).toBe("eod");
      expect(quotes.dataState.state).not.toBe("live");

      const body = JSON.stringify({ symbol: "NABIL", action: "add" });
      // A cross-site form/text POST can skip the CORS preflight; refuse it.
      expect(
        await rawRequest(port, {
          method: "POST",
          path: "/api/watchlist",
          headers: { "content-type": "text/plain" },
          body,
        }),
      ).toBe(403);
      expect(
        await rawRequest(port, {
          method: "POST",
          path: "/api/watchlist",
          headers: { "content-type": "application/json", origin: "https://evil.example" },
          body,
        }),
      ).toBe(403);
      // DNS rebinding: a foreign Host header is refused even for reads.
      expect(
        await rawRequest(port, {
          method: "GET",
          path: "/api/portfolio",
          headers: { host: "evil.example" },
        }),
      ).toBe(403);
      // The desktop renderer and the Vite dev server are loopback origins.
      expect(
        await rawRequest(port, {
          method: "POST",
          path: "/api/watchlist",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:5173",
          },
          body,
        }),
      ).toBe(200);

      const coverage = (await (await fetch(`${base}/api/coverage`)).json()) as {
        datasets: Array<{
          capability: string;
          available: boolean;
          session: string | null;
          classification: string;
          unavailableReason: string | null;
        }>;
      };
      const byName = new Map(coverage.datasets.map((d) => [d.capability, d]));
      expect(byName.get("liveQuotes")).toMatchObject({ available: true, session: "eod" });
      expect(byName.get("marketSummary")).toMatchObject({
        available: false,
        classification: "MISSING",
      });
      expect(byName.get("floorsheet")?.available).toBe(false);
      expect(byName.get("floorsheet")?.unavailableReason).toBeTruthy();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

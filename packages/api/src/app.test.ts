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
      ).json()) as {
        generatedAt: string;
        rows: Array<{ symbol: string; observations: number }>;
      };
      expect(screener.rows).toHaveLength(1);
      expect(screener.rows[0]?.symbol).toBe("NABIL");
      expect(screener.rows[0]?.observations).toBe(2);
      // A repeated call is served from the cached computation.
      const cachedScreener = (await (
        await fetch(`${base}/api/screener`)
      ).json()) as { generatedAt: string };
      expect(cachedScreener.generatedAt).toBe(screener.generatedAt);

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

      // An import invalidates the cached screener computation.
      const afterImport = (await (
        await fetch(`${base}/api/screener`)
      ).json()) as { generatedAt: string; rows: unknown[] };
      expect(afterImport.rows).toHaveLength(1);
      expect(afterImport.generatedAt).not.toBe(screener.generatedAt);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("serves stored public-web datasets with provenance", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-api-web-"));
    directories.push(directory);
    const dbPath = join(directory, "personal.db");
    const dataDir = join(directory, "data");
    mkdirSync(dataDir, { recursive: true });
    const store = new PersonalStore(dbPath);
    store.upsertSnapshot("news", "latest", envelope([
      {
        id: "1",
        title: "Headline",
        url: "https://example.com/news/1",
        publishedAt: "2026-11-13T12:00:00+05:45",
        source: "sharesansar",
        symbols: [],
      },
    ]));
    store.upsertSnapshot("ipos", "all", envelope([
      {
        id: "1",
        companyName: "Tenx Hydro",
        symbol: "TENX",
        type: "ipo",
        units: 800000,
        status: "closed",
      },
    ]));
    store.upsertSnapshot("fundamentals", "NABIL", envelope({
      symbol: "NABIL",
      asOf: "2026-11-14T00:00:00.000Z",
      period: "FY083-084",
      metrics: {
        eps: {
          metric: "eps",
          value: 33.89,
          unit: "currency",
          currency: "NPR",
          confidence: "unverified",
        },
      },
    }));
    store.upsertSnapshot("fundamentalsHistory", "NABIL", envelope([]));
    store.upsertSnapshot("fundamentals", "NGF", envelope({
      symbol: "NGF",
      asOf: "2026-11-14T00:00:00.000Z",
      period: "2026-11-13",
      metrics: {
        nav: {
          metric: "nav",
          value: 9.94,
          unit: "currency",
          currency: "NPR",
          confidence: "unverified",
        },
      },
    }));
    store.upsertSnapshot("corporateActions", "NABIL", envelope([
      {
        symbol: "NABIL",
        type: "cashDividend",
        ratio: "10.8%",
        value: 10.8,
        currency: "NPR",
      },
    ]));
    store.upsertSnapshot("floorsheet", "2026-11-13", envelope([
      {
        contractId: "2026111305011775",
        businessDate: "2026-11-13",
        symbol: "AHL",
        buyerBroker: "62",
        sellerBroker: "40",
        quantity: 10,
        rate: 400,
        amount: 4000,
      },
    ]));
    store.upsertSnapshot("brokerFlows", "2026-11-13", envelope([
      {
        brokerId: "62",
        businessDate: "2026-11-13",
        buyQuantity: 10,
        buyAmount: 4000,
        sellQuantity: 0,
        sellAmount: 0,
        netQuantity: 10,
        netAmount: 4000,
      },
    ]));
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
      const news = (await (await fetch(`${base}/api/news`)).json()) as {
        news: unknown[];
        provenance: { classification: string } | null;
      };
      expect(news.news).toHaveLength(1);
      expect(news.provenance?.classification).toBe("UNVERIFIED");

      const ipos = (await (await fetch(`${base}/api/ipos`)).json()) as {
        ipos: unknown[];
      };
      expect(ipos.ipos).toHaveLength(1);

      const fundamentals = (await (
        await fetch(`${base}/api/fundamentals?symbol=NABIL`)
      ).json()) as {
        latest: { period: string; metrics: Record<string, { value: number }> };
        history: unknown[];
      };
      expect(fundamentals.latest.period).toBe("FY083-084");
      expect(fundamentals.latest.metrics.eps?.value).toBe(33.89);

      const symbols = (await (
        await fetch(`${base}/api/fundamentals`)
      ).json()) as { symbols: string[] };
      expect(symbols.symbols.sort()).toEqual(["NABIL", "NGF"]);

      const actions = (await (
        await fetch(`${base}/api/corporate-actions?symbol=NABIL`)
      ).json()) as { actions: unknown[] };
      expect(actions.actions).toHaveLength(1);

      const floorsheet = (await (
        await fetch(`${base}/api/floorsheet`)
      ).json()) as {
        date: string | null;
        trades: unknown[];
        availableDates: string[];
      };
      expect(floorsheet.date).toBe("2026-11-13");
      expect(floorsheet.trades).toHaveLength(1);
      expect(floorsheet.availableDates).toEqual(["2026-11-13"]);

      const flows = (await (
        await fetch(`${base}/api/broker-flows`)
      ).json()) as { date: string | null; flows: unknown[] };
      expect(flows.date).toBe("2026-11-13");
      expect(flows.flows).toHaveLength(1);

      const funds = (await (
        await fetch(`${base}/api/mutual-funds`)
      ).json()) as { funds: Array<{ symbol: string }> };
      expect(funds.funds.map((fund) => fund.symbol)).toEqual(["NGF"]);

      const coverage = (await (
        await fetch(`${base}/api/coverage`)
      ).json()) as {
        datasets: Array<{
          capability: string;
          available: boolean;
          note: string | null;
        }>;
      };
      const floorsheetCoverage = coverage.datasets.find(
        (row) => row.capability === "floorsheet",
      );
      expect(floorsheetCoverage?.available).toBe(true);
      expect(floorsheetCoverage?.note).toContain("1 stored trading day");
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

  it("serves latest fundamentals and corporate actions for all symbols", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-api-all-"));
    directories.push(directory);
    const dbPath = join(directory, "personal.db");
    const dataDir = join(directory, "data");
    mkdirSync(dataDir, { recursive: true });
    const store = new PersonalStore(dbPath);
    store.upsertSnapshot("fundamentals", "NGF", envelope({
      symbol: "NGF",
      asOf: "2026-11-14T00:00:00.000Z",
      period: "2026-11-13",
      metrics: { nav: { metric: "nav", value: 9.94, unit: "currency" } },
    }));
    store.upsertSnapshot("fundamentals", "NABIL", envelope({
      symbol: "NABIL",
      asOf: "2026-11-14T00:00:00.000Z",
      period: "FY083-084",
      metrics: { eps: { metric: "eps", value: 33.89, unit: "currency" } },
    }));
    // A quarterly statement in history carries ROE/NPL that the latest
    // (key-ratio) snapshot lacks; it must be merged with its own period.
    store.upsertSnapshot("fundamentalsHistory", "NABIL", envelope([
      {
        symbol: "NABIL",
        asOf: "2026-11-10T00:00:00.000Z",
        period: "1st Quarter 2083/2084",
        metrics: {
          "statement.roe": { metric: "statement.roe", value: 12.4, unit: "percent" },
          "statement.npl": { metric: "statement.npl", value: 2.1, unit: "percent" },
          eps: { metric: "eps", value: 99, unit: "currency" },
        },
      },
    ]));
    store.upsertSnapshot("corporateActions", "NABIL", envelope([
      { symbol: "NABIL", type: "cashDividend", ratio: "10.8%", value: 10.8 },
      { symbol: "NABIL", type: "bonusShare", ratio: "5%", value: 5 },
    ]));
    // A stored action without its own symbol takes the snapshot key.
    store.upsertSnapshot("corporateActions", "AHL", envelope([
      { type: "rightShare", ratio: "1:1" },
    ]));
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
      const fundamentals = (await (
        await fetch(`${base}/api/fundamentals/latest`)
      ).json()) as {
        providerId: string;
        rows: Array<{ symbol: string; period: string; metrics: Record<string, { value: number }> }>;
        provenance: { classification: string; state: string } | null;
        dataState: { total: number; state: string };
      };
      expect(fundamentals.providerId).toBe("free-source");
      expect(fundamentals.rows.map((row) => row.symbol)).toEqual(["NABIL", "NGF"]);
      expect(fundamentals.rows[0]?.metrics.eps?.value).toBe(33.89);
      const nabil = fundamentals.rows[0] as unknown as {
        metrics: Record<string, { value: number; period?: string }>;
        filledFromHistory?: string[];
      };
      expect(nabil.metrics["statement.roe"]).toMatchObject({
        value: 12.4,
        period: "1st Quarter 2083/2084",
      });
      expect(nabil.metrics["statement.npl"]?.value).toBe(2.1);
      // The latest snapshot's own value wins over history.
      expect(nabil.metrics.eps?.value).toBe(33.89);
      expect(nabil.filledFromHistory).toEqual(["statement.roe", "statement.npl"]);
      expect(fundamentals.provenance?.classification).toBe("UNVERIFIED");
      expect(fundamentals.provenance?.state).not.toBe("live");
      expect(fundamentals.dataState.total).toBe(2);

      const actions = (await (
        await fetch(`${base}/api/corporate-actions/all`)
      ).json()) as {
        providerId: string;
        actions: Array<{ symbol: string; type: string }>;
        provenance: { classification: string } | null;
        dataState: { total: number };
      };
      expect(actions.actions.map((action) => `${action.symbol}:${action.type}`)).toEqual([
        "AHL:rightShare",
        "NABIL:cashDividend",
        "NABIL:bonusShare",
      ]);
      expect(actions.provenance?.classification).toBe("UNVERIFIED");
      expect(actions.dataState.total).toBe(2);

      // The per-symbol routes are unchanged and never read "latest"/"all" as a symbol.
      const one = (await (
        await fetch(`${base}/api/corporate-actions?symbol=NABIL`)
      ).json()) as { actions: unknown[] };
      expect(one.actions).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Nothing stored: empty lists and an unavailable state, never mocked rows.
    const emptyDirectory = mkdtempSync(join(tmpdir(), "stock-api-all-empty-"));
    directories.push(emptyDirectory);
    const empty = createApiServer({
      dbPath: join(emptyDirectory, "personal.db"),
      dataDir: emptyDirectory,
      env: { NODE_ENV: "production", DATA_EDITION: "free", PERSONAL_DATA_DIR: emptyDirectory },
    }).server;
    await new Promise<void>((resolve) => empty.listen(0, "127.0.0.1", resolve));
    const emptyBase = `http://127.0.0.1:${(empty.address() as AddressInfo).port}`;
    try {
      const fundamentals = (await (
        await fetch(`${emptyBase}/api/fundamentals/latest`)
      ).json()) as { rows: unknown[]; provenance: unknown; dataState: { state: string } };
      expect(fundamentals.rows).toEqual([]);
      expect(fundamentals.provenance).toBeNull();
      expect(fundamentals.dataState.state).toBe("unavailable");
      const actions = (await (
        await fetch(`${emptyBase}/api/corporate-actions/all`)
      ).json()) as { actions: unknown[]; provenance: unknown };
      expect(actions.actions).toEqual([]);
      expect(actions.provenance).toBeNull();
    } finally {
      await new Promise<void>((resolve) => empty.close(() => resolve()));
    }
  });

  it("reads company events from the data folder and tolerates a missing file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-api-events-"));
    directories.push(directory);
    const dbPath = join(directory, "personal.db");
    const dataDir = join(directory, "data");
    mkdirSync(dataDir, { recursive: true });

    const { server } = createApiServer({
      dbPath,
      dataDir,
      env: { NODE_ENV: "production", DATA_EDITION: "free", PERSONAL_DATA_DIR: dataDir },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    type EventsResponse = {
      providerId: string;
      symbol: string | null;
      types: string[];
      events: Array<{
        symbol: string;
        type: string;
        date: string | null;
        fiscalYear: string | null;
        title: string;
        detail: string | null;
        url: string | null;
        source: string | null;
        classification: string;
        fetchedAt: string | null;
      }>;
      source: { file: string; modifiedAt: string } | null;
      dataState: { state: string; classification?: string };
    };

    try {
      const missing = await fetch(`${base}/api/company-events?symbol=NABIL`);
      expect(missing.status).toBe(200);
      const missingBody = (await missing.json()) as EventsResponse;
      expect(missingBody.events).toEqual([]);
      expect(missingBody.types).toEqual([]);
      expect(missingBody.source).toBeNull();
      expect(missingBody.symbol).toBe("NABIL");
      expect(missingBody.dataState.state).toBe("unavailable");

      writeFileSync(
        join(dataDir, "company-events.csv"),
        [
          "symbol,type,date,fiscalYear,title,detail,url,source,classification,notes,fetchedAt",
          'NABIL,dividend,2026-10-01,082/83,"Cash dividend 10%, bonus 5%",,https://example.com/1,sharesansar,UNVERIFIED,"a=1; b=2",2026-11-14T10:00:00.000Z',
          'NABIL,agm,2026-11-05,082/83,"25th AGM","Venue: ""Hotel"", Kathmandu\r\nSecond line",,sharesansar,UNVERIFIED,,2026-11-14T10:00:00.000Z',
          "AHL,dividend,,,Proposed dividend,,,sharesansar,,,",
          "",
        ].join("\r\n"),
      );

      const all = (await (
        await fetch(`${base}/api/company-events`)
      ).json()) as EventsResponse;
      expect(all.symbol).toBeNull();
      expect(all.types).toEqual(["agm", "dividend"]);
      expect(all.source?.file).toMatch(/company-events\.csv$/);
      expect(all.source?.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // Newest dated first; an undated row last.
      expect(all.events.map((event) => event.type)).toEqual(["agm", "dividend", "dividend"]);
      expect(all.events[0]?.detail).toBe('Venue: "Hotel", Kathmandu\r\nSecond line');
      expect(all.events[1]?.title).toBe("Cash dividend 10%, bonus 5%");
      expect(all.events[1]?.url).toBe("https://example.com/1");
      expect(all.events[1]?.detail).toBeNull();
      expect(all.events[2]).toMatchObject({
        symbol: "AHL",
        date: null,
        fiscalYear: null,
        classification: "UNVERIFIED",
        fetchedAt: null,
      });
      expect(all.dataState.classification).toBe("UNVERIFIED");
      expect(all.dataState.state).not.toBe("live");

      const filtered = (await (
        await fetch(`${base}/api/company-events?symbol=nabil&type=dividend&limit=200`)
      ).json()) as EventsResponse;
      expect(filtered.symbol).toBe("NABIL");
      expect(filtered.types).toEqual(["agm", "dividend"]);
      expect(filtered.events).toHaveLength(1);
      expect(filtered.events[0]?.fiscalYear).toBe("082/83");

      const limited = (await (
        await fetch(`${base}/api/company-events?limit=1`)
      ).json()) as EventsResponse;
      expect(limited.events).toHaveLength(1);

      const bad = await fetch(`${base}/api/company-events?limit=lots`);
      expect(bad.status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("extends screener rows and serves recent signals from one cached pass", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-api-signals-"));
    directories.push(directory);
    const dbPath = join(directory, "personal.db");
    const dataDir = join(directory, "data");
    mkdirSync(dataDir, { recursive: true });

    const day = (offset: number) =>
      new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
    // A slow decline, then a high-volume jump `jumpFromEnd` sessions before the end.
    const series = (
      symbol: string,
      length: number,
      jumpFromEnd: number,
      startOffset = 0,
    ): Candle[] =>
      Array.from({ length }, (_, index) => {
        const jump = index === length - 1 - jumpFromEnd;
        const after = index > length - 1 - jumpFromEnd;
        const close = jump || after ? 190 : 200 - index * 0.2;
        return {
          symbol,
          timeframe: "1day",
          timestamp: `${day(startOffset + index)}T09:15:00.000Z`,
          open: jump ? 150 : close,
          high: close + 1,
          low: jump ? 149 : close - 1,
          close,
          volume: jump ? 20_000 : 1000,
          adjusted: false,
        };
      });

    const store = new PersonalStore(dbPath);
    store.upsertCandles(envelope(series("NABIL", 260, 0)), "equity");
    store.upsertCandles(envelope(series("HDL", 260, 2)), "equity");
    // A series that stopped trading 100 days before the others.
    store.upsertCandles(envelope(series("OLDCO", 160, 0)), "equity");
    store.close();

    const { server } = createApiServer({
      dbPath,
      dataDir,
      env: { NODE_ENV: "production", DATA_EDITION: "free", PERSONAL_DATA_DIR: dataDir },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    type Row = Record<string, unknown> & {
      symbol: string;
      observations: number;
      events: Array<{ id: string; index: number; timestamp: string; type: string }>;
    };
    type Signals = {
      providerId: string;
      generatedAt: string;
      latestSession: string | null;
      events: Array<{
        id: string;
        index: number;
        timestamp: string;
        type: string;
        direction: string;
        label: string;
        detail: string;
        symbol: string;
      }>;
    };

    try {
      const screener = (await (
        await fetch(`${base}/api/screener`)
      ).json()) as { generatedAt: string; rows: Row[] };
      expect(screener.rows.map((row) => row.symbol)).toEqual(["HDL", "NABIL", "OLDCO"]);
      const nabil = screener.rows.find((row) => row.symbol === "NABIL")!;
      for (const field of [
        "return1W",
        "return2W",
        "lastVolume",
        "avgVolume20",
        "volume3d",
        "volume3dRatio",
        "volume5d",
        "turnover5d",
        "priceChange3d",
        "upDays3",
        "volumeBreakout",
        "avgAbsMove20",
        "supertrendDir",
        "adx14",
        "rsiPrev",
        "events",
      ]) {
        expect(nabil).toHaveProperty(field);
      }
      expect(nabil.lastVolume).toBe(20_000);
      expect(nabil.avgVolume20).toBe(1000);
      expect(nabil.volume5d).toBe(24_000);
      expect(nabil.upDays3).toBe(1);
      expect(nabil.volumeBreakout).toBe(true);
      expect(typeof nabil.return1W).toBe("number");
      expect(typeof nabil.rsiPrev).toBe("number");
      expect([1, -1]).toContain(nabil.supertrendDir);
      // Row events cover the series' own last 5 sessions.
      expect(nabil.events.map((event) => event.type)).toEqual(
        expect.arrayContaining(["volume-breakout", "price-breakout"]),
      );
      for (const row of screener.rows) {
        for (const event of row.events) {
          expect(event.index).toBeGreaterThanOrEqual(row.observations - 5);
        }
      }
      const oldco = screener.rows.find((row) => row.symbol === "OLDCO")!;
      expect(oldco.events.length).toBeGreaterThan(0);

      const signals = (await (
        await fetch(`${base}/api/signals`)
      ).json()) as Signals;
      expect(signals.providerId).toBe("free-source");
      expect(signals.generatedAt).toBe(screener.generatedAt);
      expect(signals.latestSession).toBe(day(259));
      expect(signals.events.length).toBeGreaterThan(0);
      for (const event of signals.events) {
        expect(Object.keys(event).sort()).toEqual(
          ["detail", "direction", "id", "index", "label", "symbol", "timestamp", "type"],
        );
        // Within the market's last 5 sessions: OLDCO's stale events stay out.
        expect(event.timestamp.slice(0, 10) >= day(255)).toBe(true);
      }
      expect(signals.events.some((event) => event.symbol === "OLDCO")).toBe(false);
      // Newest first, then by symbol.
      const order = signals.events.map((event) => `${event.timestamp}|${event.symbol}`);
      expect(order).toEqual(
        [...order].sort((a, b) => {
          const [ta, sa] = a.split("|");
          const [tb, sb] = b.split("|");
          return ta! === tb! ? sa!.localeCompare(sb!) : ta! < tb! ? 1 : -1;
        }),
      );
      expect(signals.events[0]?.symbol).toBe("NABIL");
      expect(
        signals.events.some(
          (event) => event.symbol === "HDL" && event.type === "volume-breakout",
        ),
      ).toBe(true);

      const lastSession = (await (
        await fetch(`${base}/api/signals?lookback=1`)
      ).json()) as Signals;
      expect(lastSession.events.length).toBeGreaterThan(0);
      expect(lastSession.events.every((event) => event.symbol === "NABIL")).toBe(true);

      const widest = (await (
        await fetch(`${base}/api/signals?lookback=99`)
      ).json()) as Signals & { lookback: number };
      expect(widest.lookback).toBe(20);
      expect(widest.events.length).toBeGreaterThanOrEqual(signals.events.length);

      expect((await fetch(`${base}/api/signals?lookback=soon`)).status).toBe(400);

      // Another process writing to the database invalidates the cache.
      const writer = new PersonalStore(dbPath);
      writer.upsertCandles(
        envelope([
          {
            symbol: "NABIL",
            timeframe: "1day",
            timestamp: `${day(260)}T09:15:00.000Z`,
            open: 190,
            high: 192,
            low: 189,
            close: 191,
            volume: 1500,
            adjusted: false,
          },
        ]),
        "equity",
      );
      writer.close();
      const refreshed = (await (
        await fetch(`${base}/api/screener`)
      ).json()) as { generatedAt: string; rows: Row[] };
      expect(
        refreshed.rows.find((row) => row.symbol === "NABIL")?.observations,
      ).toBe(261);
      const refreshedSignals = (await (
        await fetch(`${base}/api/signals`)
      ).json()) as Signals;
      expect(refreshedSignals.latestSession).toBe(day(260));
      expect(refreshedSignals.generatedAt).toBe(refreshed.generatedAt);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

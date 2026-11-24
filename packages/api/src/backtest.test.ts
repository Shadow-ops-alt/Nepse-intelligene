import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  capabilities: [
    "companyList",
    "dailyOhlc",
    "indexHistory",
    "corporateActions",
  ],
  configRequired: [],
};

function envelope<T>(data: T): DataEnvelope<T> {
  return { data, meta: createMeta({ descriptor }) };
}

function dates(count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
  );
}

function candle(symbol: string, date: string, close: number): Candle {
  return {
    symbol,
    timeframe: "1day",
    timestamp: `${date}T09:15:00.000Z`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000,
    adjusted: false,
  };
}

const dayList = dates(10);

function equitySeries(symbol: string): Candle[] {
  return dayList.map((date, index) => candle(symbol, date, 100 + index));
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

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

async function buildServer(): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "stock-backtest-"));
  directories.push(directory);
  const dbPath = join(directory, "personal.db");
  const dataDir = join(directory, "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "companies.csv"),
    "id,symbol,name,sector,instrumentType,status\nTEST,TEST,Test Limited,Commercial Banks,Equity,active\n",
  );

  const store = new PersonalStore(dbPath);
  const companies: Company[] = [
    {
      id: "TEST",
      symbol: "TEST",
      name: "Test Limited",
      sector: "Commercial Banks",
      instrumentType: "Equity",
      status: "active",
      paidUpValue: 100,
    },
    {
      id: "NOP",
      symbol: "NOP",
      name: "No Ex-Date Limited",
      sector: "Commercial Banks",
      instrumentType: "Equity",
      status: "active",
      paidUpValue: 100,
    },
    {
      id: "MISS",
      symbol: "MISS",
      name: "Missing Coverage Limited",
      sector: "Commercial Banks",
      instrumentType: "Equity",
      status: "active",
    },
  ];
  store.upsertCompanies(envelope(companies));
  store.upsertCandles(
    envelope([
      ...equitySeries("TEST"),
      ...equitySeries("NOP"),
      ...dayList.map((date, index) => candle("MISS", date, 50 + index)),
    ]),
    "equity",
  );
  store.upsertCandles(
    envelope(dayList.map((date, index) => candle("NEPSE", date, 2000 + index * 5))),
    "index",
  );
  store.upsertSnapshot(
    "corporateActions",
    "TEST",
    envelope([
      {
        symbol: "TEST",
        type: "bonus",
        percent: 10,
        exDate: dayList[4],
        fiscalYear: "082-083",
      },
    ]),
  );
  store.upsertSnapshot(
    "corporateActions",
    "NOP",
    envelope([
      {
        symbol: "NOP",
        type: "cashDividend",
        percent: 10,
        fiscalYear: "082-083",
      },
    ]),
  );
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
  return `http://127.0.0.1:${port}`;
}

describe("backtest coverage", () => {
  it("reports eligible and blocked symbols with reasons", async () => {
    const base = await buildServer();
    const response = await jsonFetch(
      base,
      "/api/backtest/coverage?symbols=TEST,NOP,MISS&from=2026-01-01&to=2026-01-10",
    );
    expect(response.status).toBe(200);
    const body = response.body as {
      symbols: Array<{
        symbol: string;
        eligible: boolean;
        resolvedActions: number;
        unresolvedActions: number;
        reasons: string[];
        adjustedSeriesValid: boolean;
      }>;
      summary: {
        requested: number;
        eligible: number;
        ineligible: number;
        allEligible: boolean;
      };
    };
    const bySymbol = new Map(body.symbols.map((row) => [row.symbol, row]));
    expect(bySymbol.get("TEST")?.eligible).toBe(true);
    expect(bySymbol.get("TEST")?.resolvedActions).toBe(1);
    expect(bySymbol.get("TEST")?.adjustedSeriesValid).toBe(true);
    expect(bySymbol.get("NOP")?.eligible).toBe(false);
    expect(bySymbol.get("NOP")?.unresolvedActions).toBe(1);
    expect(bySymbol.get("NOP")?.reasons.join(" ")).toContain("no ex-date");
    expect(bySymbol.get("MISS")?.eligible).toBe(false);
    expect(bySymbol.get("MISS")?.reasons.join(" ")).toContain(
      "no corporate-action snapshot",
    );
    expect(body.summary.requested).toBe(3);
    expect(body.summary.eligible).toBe(1);
    expect(body.summary.ineligible).toBe(2);
    expect(body.summary.allEligible).toBe(false);
  });

  it("rejects a missing symbols parameter", async () => {
    const base = await buildServer();
    const response = await jsonFetch(base, "/api/backtest/coverage");
    expect(response.status).toBe(400);
  });
});

describe("POST /api/backtest/run", () => {
  it("refuses a symbol whose action has no ex-date", async () => {
    const base = await buildServer();
    const response = await jsonFetch(base, "/api/backtest/run", {
      method: "POST",
      body: {
        strategy: "buyAndHold",
        symbols: ["NOP"],
        from: "2026-01-01",
        to: "2026-01-10",
        capital: 100_000,
        positionPercent: 100,
        maxPositions: 1,
      },
    });
    expect(response.status).toBe(400);
    expect(String(response.body.error)).toContain("gate");
  });

  it("runs a small eligible backtest end to end", async () => {
    const base = await buildServer();
    const response = await jsonFetch(base, "/api/backtest/run", {
      method: "POST",
      body: {
        strategy: "buyAndHold",
        symbols: ["TEST"],
        from: "2026-01-01",
        to: "2026-01-10",
        capital: 100_000,
        positionPercent: 100,
        maxPositions: 1,
        slippageBps: 0,
        costs: {
          schedule: {
            commissionTiers: [{ upTo: null, ratePercent: 0 }],
            minCommission: 0,
            sebonFeePercent: 0,
            dpChargePerScrip: 0,
            nameTransferFee: 0,
            cgtIndividualShortTermPercent: 0,
            cgtIndividualLongTermPercent: 0,
            cgtInstitutionPercent: 0,
            cashDividendTaxPercent: 0,
            bonusTaxPercent: 0,
          },
          investor: "individual",
        },
      },
    });
    expect(response.status).toBe(200);
    const result = response.body.result as {
      symbols: string[];
      metrics: { trades: number; finalEquity: number };
      equityCurve: Array<{ date: string; equity: number; benchmark: number | null }>;
      trades: Array<{ symbol: string; exitReason: string }>;
      adjustments: Array<{ symbol: string; applied: number }>;
      benchmark: { symbol: string; returnPercent: number | null } | null;
    };
    expect(result.symbols).toEqual(["TEST"]);
    expect(result.metrics.trades).toBe(1);
    expect(result.trades[0]?.symbol).toBe("TEST");
    expect(result.equityCurve).toHaveLength(10);
    expect(result.equityCurve[0]?.equity).toBe(100_000);
    expect(result.equityCurve[0]?.benchmark).toBe(100_000);
    expect(result.adjustments[0]?.applied).toBe(1);
    expect(result.benchmark?.symbol).toBe("NEPSE");
    expect(result.benchmark?.returnPercent).not.toBeNull();
  });

  it("returns a clear error when the request is too large or invalid", async () => {
    const base = await buildServer();
    const missingCapital = await jsonFetch(base, "/api/backtest/run", {
      method: "POST",
      body: {
        strategy: "buyAndHold",
        symbols: ["TEST"],
        from: "2026-01-01",
        to: "2026-01-10",
      },
    });
    expect(missingCapital.status).toBe(400);
    expect(String(missingCapital.body.error)).toContain("capital");
  });
});

import { describe, expect, it } from "vitest";
import {
  mapLiveMarket,
  mapMarketDepth,
  mapMarketState,
  mapMarketSummary,
  mapNepseIndex,
  mapSecurityIds,
  toIsoTimestamp,
  toNumber,
} from "./mapping";

/** Shaped like a `GET /api/nots/lives-market` response during trading. */
const SAMPLE_LIVE_MARKET = [
  {
    securityId: "131",
    securityName: "Nabil Bank Limited",
    symbol: "NABIL",
    indexId: 51,
    openPrice: 500,
    highPrice: 510.5,
    lowPrice: 498,
    totalTradeQuantity: 12345,
    totalTradeValue: 6172500.5,
    lastTradedPrice: 505,
    percentageChange: 1.2,
    lastUpdatedDateTime: "2026-11-15T14:59:58.123456",
    lastTradedVolume: 10,
    previousClose: 499,
    averageTradedPrice: 503.2,
  },
  {
    // Renamed/stringly fields, no percentage: change is derived from inputs.
    securityId: 2792,
    securityName: "Asian Hydropower Limited",
    symbol: "ahl",
    ltp: "1,234.5",
    previousClosing: "1200",
    open: "1,210",
    totalTradedQuantity: "300",
    totalTradedValue: null,
    lastUpdatedDateTime: "2026-11-15T15:00:00",
  },
  { symbol: "NOLTP", lastTradedPrice: null },
  { securityName: "No symbol", lastTradedPrice: 10 },
  "garbage",
  null,
];

describe("live market mapping", () => {
  it("maps NEPSE live-market rows into LiveQuote", () => {
    const mapped = mapLiveMarket(SAMPLE_LIVE_MARKET);
    expect(mapped.sourceRows).toBe(4);
    expect(mapped.rows).toEqual([
      {
        symbol: "AHL",
        securityName: "Asian Hydropower Limited",
        ltp: 1234.5,
        previousClose: 1200,
        change: 34.5,
        changePercent: 2.88,
        open: 1210,
        high: null,
        low: null,
        volume: 300,
        turnover: null,
        lastTradedAt: "2026-11-15T09:15:00.000Z",
      },
      {
        symbol: "NABIL",
        securityName: "Nabil Bank Limited",
        ltp: 505,
        previousClose: 499,
        change: 6,
        changePercent: 1.2,
        open: 500,
        high: 510.5,
        low: 498,
        volume: 12345,
        turnover: 6172500.5,
        lastTradedAt: "2026-11-15T09:14:58.123Z",
      },
    ]);
    expect(mapped.asOf).toBe("2026-11-15T09:15:00.000Z");
  });

  it("accepts a { content: [...] } wrapper and empty payloads", () => {
    expect(mapLiveMarket({ content: SAMPLE_LIVE_MARKET.slice(0, 1) }).rows).toHaveLength(1);
    expect(mapLiveMarket(null)).toEqual({ rows: [], sourceRows: 0, asOf: null });
    expect(mapLiveMarket([])).toEqual({ rows: [], sourceRows: 0, asOf: null });
    expect(mapLiveMarket("<html>")).toEqual({ rows: [], sourceRows: 0, asOf: null });
  });

  it("leaves change null when previous close is missing", () => {
    const [quote] = mapLiveMarket([{ symbol: "X", lastTradedPrice: 10 }]).rows;
    expect(quote).toMatchObject({ previousClose: null, change: null, changePercent: null });
  });
});

describe("value helpers", () => {
  it("parses numbers defensively", () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber("1,234.50")).toBe(1234.5);
    expect(toNumber("-0.5")).toBe(-0.5);
    expect(toNumber("")).toBeNull();
    expect(toNumber("12abc")).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber({})).toBeNull();
  });

  it("treats zone-less NEPSE timestamps as Nepal time", () => {
    expect(toIsoTimestamp("2026-11-15T11:00:00")).toBe("2026-11-15T05:15:00.000Z");
    expect(toIsoTimestamp("2026-11-15 11:00")).toBe("2026-11-15T05:15:00.000Z");
    expect(toIsoTimestamp("2026-11-15T05:15:00Z")).toBe("2026-11-15T05:15:00.000Z");
    expect(toIsoTimestamp(1794670523000)).toBe("2026-11-14T15:35:23.000Z");
    expect(toIsoTimestamp("yesterday")).toBeNull();
    expect(toIsoTimestamp(undefined)).toBeNull();
  });
});

describe("market state", () => {
  it("reads isOpen", () => {
    expect(mapMarketState({ isOpen: "OPEN", asOf: "2026-11-15T11:00:00", id: 12 })).toEqual({
      open: true,
      asOf: "2026-11-15T05:15:00.000Z",
    });
    expect(mapMarketState({ isOpen: "CLOSE", asOf: "2026-11-14T15:00:00" }).open).toBe(false);
    expect(mapMarketState({ isOpen: "PRE-OPEN" }).open).toBe(false);
    expect(mapMarketState({ isOpen: "SOMETHING" }).open).toBeNull();
    expect(mapMarketState({}).open).toBeNull();
    expect(mapMarketState(null)).toEqual({ open: null, asOf: null });
  });
});

describe("summary and index", () => {
  it("maps the { detail, value } market summary list", () => {
    expect(
      mapMarketSummary([
        { detail: "Total Turnover Rs:", value: 4567890123.45 },
        { detail: "Total Traded Shares", value: 12345678 },
        { detail: "Total Transactions", value: 98765 },
        { detail: "Total Scrips Traded", value: 312 },
        { detail: "Total Market Capitalization Rs:", value: 4.5e12 },
      ]),
    ).toEqual({
      turnover: 4567890123.45,
      sharesTraded: 12345678,
      transactions: 98765,
      scripsTraded: 312,
    });
  });

  it("maps the object-shaped summary from the package types", () => {
    expect(
      mapMarketSummary({ totalTurnover: "100", totalTradedShares: 5, totalTransactions: 2, totalScrips: 1 }),
    ).toEqual({ turnover: 100, sharesTraded: 5, transactions: 2, scripsTraded: 1 });
    expect(mapMarketSummary(null)).toEqual({
      turnover: null,
      sharesTraded: null,
      transactions: null,
      scripsTraded: null,
    });
  });

  it("picks the NEPSE index (id 58) out of the index list", () => {
    const payload = [
      { id: 57, index: "Sensitive Index", currentValue: 480.1, change: 1, perChange: 0.2 },
      {
        id: 58,
        index: "NEPSE Index",
        currentValue: 2701.25,
        change: -12.4,
        perChange: -0.45,
        generatedTime: "2026-11-15T14:45:00",
      },
      { id: 62, index: "Float Index", currentValue: 190 },
    ];
    expect(mapNepseIndex(payload)).toEqual({
      index: { value: 2701.25, change: -12.4, changePercent: -0.45 },
      asOf: "2026-11-15T09:00:00.000Z",
    });
    expect(mapNepseIndex([{ index: "Float Index", currentValue: 190 }]).index).toBeNull();
    // `close` is the previous session's close on this endpoint, never the value.
    expect(mapNepseIndex([{ id: 58, index: "NEPSE Index", close: 2655.23 }]).index).toBeNull();
    expect(mapNepseIndex(undefined)).toEqual({ index: null, asOf: null });
  });
});

describe("market depth and securities", () => {
  it("maps buy/sell depth lists", () => {
    const payload = {
      symbol: "NABIL",
      totalBuyQty: 150,
      totalSellQty: 60,
      marketDepth: {
        buyMarketDepthList: [
          { orderBookOrderPrice: 504, quantity: 50, orderCount: 1, isBuy: 1 },
          { orderBookOrderPrice: 505, quantity: "100", orderCount: 3, isBuy: 1 },
          { orderBookOrderPrice: null, quantity: 1 },
        ],
        sellMarketDepthList: [
          { orderBookOrderPrice: 507, quantity: 20 },
          { orderBookOrderPrice: 506, quantity: 40, orderCount: 2 },
        ],
      },
    };
    expect(mapMarketDepth(payload)).toEqual({
      bids: [
        { price: 505, quantity: 100, orders: 3 },
        { price: 504, quantity: 50, orders: 1 },
      ],
      asks: [
        { price: 506, quantity: 40, orders: 2 },
        { price: 507, quantity: 20 },
      ],
    });
    expect(mapMarketDepth(null)).toEqual({ bids: [], asks: [] });
  });

  it("maps the security list to ids", () => {
    const ids = mapSecurityIds([
      { id: 131, symbol: "NABIL", securityName: "Nabil Bank Limited" },
      { id: "2792", symbol: "ahl" },
      { symbol: "NOID" },
    ]);
    expect([...ids]).toEqual([
      ["NABIL", 131],
      ["AHL", 2792],
    ]);
  });
});

import { describe, expect, it } from "vitest";
import type { Candle } from "@stock/core";
import { computePortfolio, screenCandles } from "./portfolio";

function candle(close: number, day: number, volume = 1000): Candle {
  const date = `2026-01-${String(day).padStart(2, "0")}`;
  return {
    symbol: "NABIL",
    timeframe: "1day",
    timestamp: `${date}T09:15:00.000Z`,
    open: close,
    high: close + 2,
    low: close - 2,
    close,
    volume,
    adjusted: false,
  };
}

describe("computePortfolio", () => {
  it("tracks weighted average cost, fees, and realised P&L", () => {
    const result = computePortfolio(
      [
        {
          symbol: "nabil",
          side: "buy",
          quantity: 10,
          price: 500,
          fees: 50,
          tradedAt: "2026-01-02",
        },
        {
          symbol: "NABIL",
          side: "buy",
          quantity: 10,
          price: 600,
          fees: 50,
          tradedAt: "2026-01-03",
        },
        {
          symbol: "NABIL",
          side: "sell",
          quantity: 5,
          price: 700,
          fees: 25,
          tradedAt: "2026-01-04",
        },
      ],
      [{ symbol: "NABIL", price: 650, asOf: "2026-01-04T10:00:00Z" }],
    );

    expect(result.positions).toHaveLength(1);
    const position = result.positions[0]!;
    expect(position.quantity).toBe(15);
    // (10*500 + 50 + 10*600 + 50) / 20 = 555
    expect(position.averageCost).toBe(555);
    expect(position.costBasis).toBe(8325);
    expect(position.realizedPnl).toBe(700);
    expect(position.marketValue).toBe(9750);
    expect(position.unrealizedPnl).toBe(1425);
    expect(position.unrealizedPnlPercent).toBe(17.12);
    expect(result.totals.realizedPnl).toBe(700);
    expect(result.totals.totalPnl).toBe(2125);
  });

  it("flags an oversell instead of creating a short position", () => {
    const result = computePortfolio([
      {
        symbol: "NABIL",
        side: "buy",
        quantity: 5,
        price: 500,
        tradedAt: "2026-01-02",
      },
      {
        symbol: "NABIL",
        side: "sell",
        quantity: 9,
        price: 600,
        tradedAt: "2026-01-03",
      },
    ]);

    expect(result.positions[0]?.quantity).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/exceeded the held 5/);
  });

  it("reports unpriced open positions honestly", () => {
    const result = computePortfolio([
      {
        symbol: "NABIL",
        side: "buy",
        quantity: 2,
        price: 500,
        tradedAt: "2026-01-02",
      },
    ]);

    expect(result.positions[0]?.marketValue).toBeNull();
    expect(result.totals.unpricedPositions).toBe(1);
    expect(result.totals.unrealizedPnl).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/no stored quote/);
  });
});

describe("screenCandles", () => {
  it("computes trend, streak, RSI zone, and distance from the high", () => {
    const candles = Array.from({ length: 260 }, (_, index) => {
      const item = candle(100 + index, (index % 28) + 1);
      const date = new Date(Date.UTC(2024, 0, 1) + index * 86_400_000);
      item.timestamp = `${date.toISOString().slice(0, 10)}T09:15:00.000Z`;
      return item;
    });

    const row = screenCandles(candles);
    expect(row.observations).toBe(260);
    expect(row.trend).toBe("up");
    expect(row.aboveSma200).toBe(true);
    expect(row.rsiZone).toBe("overbought");
    expect(row.distanceFromHigh52w).toBe(-0.55);
    expect(row.averageVolume20).toBe(1000);
    expect(row.volumeRatio).toBe(1);
    // Derived quant fields for a steady uptrend.
    expect(row.macdState).toBe("bullish");
    expect(row.maxDrawdown1Y).toBe(0);
    expect(row.return1M).toBeGreaterThan(0);
    expect(row.signalRating).toMatch(/bullish/);
    expect(Array.isArray(row.patterns)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { Candle } from "@stock/core";
import { computePortfolio, screenCandles } from "./portfolio";
import { adx, averageAbsoluteMove, signalEvents } from "./technicals";
import { rsi } from "./analysis";

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

  it("adds short-window returns, the volume profile, trend strength and recent events", () => {
    // 40 consecutive calendar days rising by 1, then a high-volume jump to 150.
    const candles = Array.from({ length: 40 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, 1) + index * 86_400_000);
      const last = index === 39;
      const item = candle(last ? 150 : 100 + index, 1, last ? 5000 : 1000);
      item.timestamp = `${date.toISOString().slice(0, 10)}T09:15:00.000Z`;
      return item;
    });

    const row = screenCandles(candles);
    // Base = close 7 / 14 calendar days earlier (index 32 → 132, index 25 → 125).
    expect(row.return1W).toBe(13.64);
    expect(row.return2W).toBe(20);
    expect(row.lastVolume).toBe(5000);
    expect(row.avgVolume20).toBe(1000);
    expect(row.volume3d).toBe(7000);
    expect(row.volume3dRatio).toBe(2.33);
    expect(row.volume5d).toBe(9000);
    // No reported turnover: close × volume over the last 5 sessions.
    expect(row.turnover5d).toBe((135 + 136 + 137 + 138) * 1000 + 150 * 5000);
    expect(row.priceChange3d).toBe(10.29);
    expect(row.upDays3).toBe(3);
    expect(row.volumeBreakout).toBe(true);
    expect(row.avgAbsMove20).toBe(
      Math.round(averageAbsoluteMove(candles, 20)! * 100) / 100,
    );
    expect(row.supertrendDir).toBe(1);
    expect(row.adx14).toBe(
      Math.round(adx(candles, 14).adx.at(-1)! * 100) / 100,
    );
    const rsiSeries = rsi(candles.map((item) => item.close), 14);
    expect(row.rsiPrev).toBe(Math.round(rsiSeries.at(-2)! * 100) / 100);
    expect(row.events).toEqual(signalEvents(candles, 5));
    expect(row.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["volume-breakout", "price-breakout"]),
    );
    expect(screenCandles(candles, { signalLookback: 1 }).events.every(
      (event) => event.index === 39,
    )).toBe(true);
    // Unchanged existing fields: averageVolume20 still includes the last session.
    expect(row.averageVolume20).toBe(1200);
  });

  it("uses the close on or before the cutoff and never interpolates", () => {
    const candles = Array.from({ length: 40 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, 1) + index * 86_400_000);
      const item = candle(100 + index, 1);
      item.timestamp = `${date.toISOString().slice(0, 10)}T09:15:00.000Z`;
      return item;
    }).filter((_, index) => index !== 32);
    // Day 32 is missing, so the 7-day base is day 31 (close 131).
    expect(screenCandles(candles).return1W).toBe(6.11);

    const short = candles.slice(-5);
    const row = screenCandles(short);
    expect(row.return1W).toBeNull();
    expect(row.return2W).toBeNull();
    expect(row.avgVolume20).toBeNull();
    expect(row.adx14).toBeNull();
    expect(row.volumeBreakout).toBe(false);
    expect(Array.isArray(row.events)).toBe(true);
  });
});

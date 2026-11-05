import { describe, expect, it } from "vitest";
import type { Candle } from "@stock/core";
import { analyzeCandles, ema, rsi, sma } from "./analysis";

function candle(close: number, index: number): Candle {
  const day = String(index + 1).padStart(2, "0");
  return {
    symbol: "TEST",
    timeframe: "1day",
    timestamp: `2026-10-${day}T09:15:00.000Z`,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1000,
    adjusted: false,
  };
}

describe("indicators", () => {
  it("computes SMA with a warm-up window", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("computes EMA seeded from the first period average", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("computes Wilder RSI at the extremes and midpoints", () => {
    expect(rsi([1, 2, 3, 4], 2)).toEqual([null, null, 100, 100]);
    expect(rsi([4, 3, 2, 1], 2)).toEqual([null, null, 0, 0]);
    expect(rsi([1, 2, 1, 2], 2)).toEqual([null, null, 50, 75]);
  });

  it("treats a perfectly flat series as neutral, not overbought", () => {
    expect(rsi([5, 5, 5, 5], 2)).toEqual([null, null, 50, 50]);
  });

  it("rejects a non-positive period", () => {
    expect(() => sma([1, 2], 0)).toThrow(/positive/);
  });
});

describe("analyzeCandles", () => {
  it("summarises a stored series without a provider", () => {
    const candles = [100, 101, 102, 103, 104].map(candle);
    const analysis = analyzeCandles(candles);

    expect(analysis.symbol).toBe("TEST");
    expect(analysis.observations).toBe(5);
    expect(analysis.lastClose).toBe(104);
    expect(analysis.returnPercent).toBe(4);
    expect(analysis.high52w).toBe(106);
    expect(analysis.low52w).toBe(98);
    expect(analysis.sma20).toBeNull();
    expect(analysis.rsi14).toBeNull();
  });

  it("uses a calendar 52-week window, not the last 252 rows", () => {
    // Monthly sessions for three years: the last 252 rows would span it all.
    const candles = Array.from({ length: 36 }, (_, index) => {
      const date = new Date(Date.UTC(2023, index, 15));
      return {
        ...candle(index === 0 ? 500 : 100 + index, 0),
        timestamp: `${date.toISOString().slice(0, 10)}T09:15:00.000Z`,
      };
    });
    const analysis = analyzeCandles(candles);
    // The 500 close in Jan 2023 is outside the trailing year.
    expect(analysis.high52w).toBe(137);
    expect(analysis.low52w).toBe(122);
  });
});

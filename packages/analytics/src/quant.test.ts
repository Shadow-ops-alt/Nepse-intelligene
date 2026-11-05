import { describe, expect, it } from "vitest";
import type { Candle } from "@stock/core";
import {
  atr,
  bollinger,
  breadth,
  detectPatternsAt,
  latestCross,
  logReturns,
  macd,
  maxDrawdown,
  monthlyReturns,
  periodReturns,
  pivotPoints,
  quantProfile,
  relativeRisk,
  sectorBreadth,
  sessionsPerYear,
  signalTally,
  stdev,
  stochastic,
  trueRange,
} from "./quant";

function dayString(offset: number, start = "2025-01-01"): string {
  const base = Date.parse(`${start}T00:00:00Z`);
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

function bar(
  day: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000,
): Candle {
  return {
    symbol: "TEST",
    timeframe: "1day",
    timestamp: `${day}T15:00:00+05:45`,
    open,
    high,
    low,
    close,
    volume,
    adjusted: false,
  };
}

function fromCloses(closes: number[], start = "2025-01-01"): Candle[] {
  return closes.map((close, index) =>
    bar(dayString(index, start), close, close + 1, close - 1, close),
  );
}

describe("bands and oscillators", () => {
  it("computes Bollinger bands with population deviation", () => {
    const bands = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect(bands.slice(0, 7).every((value) => value === null)).toBe(true);
    // mean 5, population sd 2 → 5 ± 4
    expect(bands[7]).toEqual({ middle: 5, upper: 9, lower: 1 });
  });

  it("computes MACD as fast EMA minus slow EMA with a seeded signal", () => {
    const values = Array.from({ length: 60 }, (_, index) => 100 + index);
    const result = macd(values, 3, 6, 3);
    expect(result.macd[4]).toBeNull();
    // For a straight line, EMA(n) lags by (n − 1) / 2, so MACD = (6−3)/2 = 1.5.
    expect(result.macd.at(-1)).toBeCloseTo(1.5, 6);
    expect(result.signal.at(-1)).toBeCloseTo(1.5, 6);
    expect(result.histogram.at(-1)).toBeCloseTo(0, 6);
  });

  it("rejects a fast period that is not shorter than the slow period", () => {
    expect(() => macd([1, 2, 3], 5, 5)).toThrow();
  });

  it("computes true range with gaps and Wilder ATR", () => {
    const candles = [
      bar("2025-01-01", 10, 12, 9, 11),
      bar("2025-01-02", 14, 15, 13, 14), // gap up: |15 − 11| = 4
      bar("2025-01-03", 14, 14.5, 13.5, 14),
    ];
    expect(trueRange(candles)).toEqual([3, 4, 1]);
    const values = atr(candles, 2);
    expect(values[0]).toBeNull();
    expect(values[1]).toBe(3.5);
    expect(values[2]).toBe((3.5 * 1 + 1) / 2);
  });

  it("puts stochastic %K at 100 on the high and 0 on the low", () => {
    const rising = fromCloses([1, 2, 3, 4, 5]);
    const { k } = stochastic(rising, 3, 2);
    // Close 5, window low 2 (3 − 1), high 6 (5 + 1) → (5 − 2) / 4 = 75%
    expect(k.at(-1)).toBeCloseTo(75, 6);
  });
});

describe("returns and risk", () => {
  it("computes log returns and sample deviation", () => {
    expect(logReturns([100, 110])[0]).toBeCloseTo(Math.log(1.1), 10);
    expect(stdev([1, 2, 3, 4])).toBeCloseTo(Math.sqrt(5 / 3), 10);
    expect(stdev([1])).toBeNull();
  });

  it("measures sessions per year from the series instead of assuming 252", () => {
    // Five sessions a week for two years ≈ 261 per year.
    const candles: Candle[] = [];
    for (let day = 0; day < 730; day += 1) {
      const weekday = new Date(Date.parse("2024-01-01T00:00:00Z") + day * 86_400_000).getUTCDay();
      if (weekday === 5 || weekday === 6) continue; // NEPSE is closed Fri/Sat
      candles.push(bar(dayString(day, "2024-01-01"), 10, 11, 9, 10));
    }
    const perYear = sessionsPerYear(candles);
    expect(perYear).toBeGreaterThanOrEqual(259);
    expect(perYear).toBeLessThanOrEqual(263);
  });

  it("finds the maximum drawdown and the current drawdown", () => {
    const result = maxDrawdown([100, 120, 90, 110, 60, 80]);
    expect(result?.maxDrawdownPercent).toBe(-50);
    expect(result?.peakIndex).toBe(1);
    expect(result?.troughIndex).toBe(4);
    expect(result?.currentDrawdownPercent).toBeCloseTo(-33.333, 2);
  });

  it("computes beta and correlation only on common dates", () => {
    const benchmark = fromCloses(
      Array.from({ length: 80 }, (_, index) => 1000 * (1 + 0.01 * Math.sin(index))),
    );
    // Asset moves exactly twice the benchmark's daily return.
    const assetCloses = [100];
    for (let index = 1; index < 80; index += 1) {
      const r = benchmark[index]!.close / benchmark[index - 1]!.close - 1;
      assetCloses.push(assetCloses[index - 1]! * (1 + 2 * r));
    }
    const asset = fromCloses(assetCloses);
    const risk = relativeRisk(asset, benchmark);
    expect(risk?.beta).toBeCloseTo(2, 6);
    expect(risk?.correlation).toBeCloseTo(1, 6);
    expect(risk?.observations).toBe(79);

    // No overlapping dates → no statistic, rather than a fabricated one.
    expect(relativeRisk(asset, fromCloses([1, 2, 3], "2010-01-01"))).toBeNull();
  });

  it("returns null for periods the series does not reach", () => {
    const candles = fromCloses(
      Array.from({ length: 40 }, (_, index) => 100 + index),
      "2026-01-01",
    );
    const returns = periodReturns(candles);
    // Last close 139 on 2026-02-09; 1W base is the close on 2026-02-02 (132).
    expect(returns["1W"]).toBeCloseTo((139 / 132 - 1) * 100, 2);
    expect(returns["1Y"]).toBeNull();
    // No session before 2026-01-01, so YTD has no base.
    expect(returns.YTD).toBeNull();
  });

  it("builds month-over-month returns without bridging gaps", () => {
    const candles = [
      bar("2026-01-15", 100, 100, 100, 100),
      bar("2026-01-31", 100, 100, 100, 110),
      bar("2026-02-27", 121, 121, 121, 121),
      bar("2026-04-30", 130, 130, 130, 130),
    ];
    const months = monthlyReturns(candles);
    expect(months).toEqual([
      { year: 2026, month: 1, returnPercent: null },
      { year: 2026, month: 2, returnPercent: 10 },
      { year: 2026, month: 4, returnPercent: null },
    ]);
  });

  it("computes classic pivot levels", () => {
    const levels = pivotPoints({ high: 110, low: 90, close: 100 });
    expect(levels).toEqual({
      pivot: 100,
      r1: 110,
      s1: 90,
      r2: 120,
      s2: 80,
      r3: 130,
      s3: 70,
    });
  });
});

describe("candlestick patterns", () => {
  const downtrend = [120, 118, 115, 112, 110, 106].map((close, index) =>
    bar(dayString(index), close + 1, close + 2, close - 1, close),
  );
  const uptrend = [100, 103, 106, 110, 113, 117].map((close, index) =>
    bar(dayString(index), close - 1, close + 1, close - 2, close),
  );

  function names(candles: Candle[]): string[] {
    return detectPatternsAt(candles, candles.length - 1).map((p) => p.id);
  }

  it("ignores sessions with no range", () => {
    expect(names([bar("2025-01-01", 10, 10, 10, 10)])).toEqual([]);
  });

  it("detects a doji family by body-to-range ratio", () => {
    expect(names([bar("2025-01-01", 10, 11, 9, 10.05)])).toContain("doji");
    expect(names([bar("2025-01-01", 10, 10.02, 8, 10.01)])).toContain(
      "dragonfly-doji",
    );
    expect(names([bar("2025-01-01", 10, 12, 9.99, 10.01)])).toContain(
      "gravestone-doji",
    );
  });

  it("separates a hammer from a hanging man by the prior trend", () => {
    const hammer = bar(dayString(6), 104, 104.6, 100, 104.5);
    expect(names([...downtrend, hammer])).toContain("hammer");
    const hangingMan = bar(dayString(6), 117, 117.6, 113, 117.5);
    expect(names([...uptrend, hangingMan])).toContain("hanging-man");
  });

  it("separates a shooting star from an inverted hammer", () => {
    const star = bar(dayString(6), 117, 121.5, 116.9, 117.5);
    expect(names([...uptrend, star])).toContain("shooting-star");
    const inverted = bar(dayString(6), 104, 108.5, 103.9, 104.5);
    expect(names([...downtrend, inverted])).toContain("inverted-hammer");
  });

  it("detects bullish and bearish engulfing", () => {
    const bullish = [
      ...downtrend,
      bar(dayString(6), 106, 106.5, 103.5, 104),
      bar(dayString(7), 103.5, 107.5, 103, 107),
    ];
    expect(names(bullish)).toContain("bullish-engulfing");
    const bearish = [
      ...uptrend,
      bar(dayString(6), 117, 119.5, 116.5, 119),
      bar(dayString(7), 119.5, 120, 115.5, 116),
    ];
    expect(names(bearish)).toContain("bearish-engulfing");
  });

  it("detects a morning star and three white soldiers", () => {
    const morning = [
      ...downtrend,
      bar(dayString(6), 110, 110.5, 99.5, 100),
      bar(dayString(7), 99, 100, 98, 99.3),
      bar(dayString(8), 100, 107, 99.8, 106.5),
    ];
    expect(names(morning)).toContain("morning-star");

    const soldiers = [
      bar(dayString(0), 100, 104.2, 99.8, 104),
      bar(dayString(1), 102, 108.2, 101.8, 108),
      bar(dayString(2), 106, 112.2, 105.8, 112),
    ];
    expect(names(soldiers)).toContain("three-white-soldiers");
  });
});

describe("signals and market statistics", () => {
  it("reports the most recent golden cross", () => {
    const closes = [
      ...Array.from({ length: 60 }, () => 100),
      ...Array.from({ length: 10 }, (_, index) => 101 + index),
    ];
    const cross = latestCross(closes, 5, 20, 20);
    expect(cross?.type).toBe("golden");
    expect(cross?.sessionsAgo).toBe(9);
  });

  it("tallies signals into an auditable rating", () => {
    const rising = fromCloses(Array.from({ length: 260 }, (_, index) => 100 + index));
    const tally = signalTally(rising);
    expect(tally).not.toBeNull();
    expect(tally!.checks.length).toBeGreaterThanOrEqual(6);
    expect(tally!.checks.find((check) => check.id === "sma200")?.vote).toBe(
      "bullish",
    );
    expect(tally!.bullish + tally!.bearish + tally!.neutral).toBe(
      tally!.checks.length,
    );
    expect(signalTally(fromCloses([1, 2, 3]))).toBeNull();
  });

  it("builds a full profile without inventing missing periods", () => {
    const candles = fromCloses(
      Array.from({ length: 300 }, (_, index) => 100 + Math.sin(index / 5) * 10),
    );
    const profile = quantProfile(candles);
    expect(profile.returns["5Y"]).toBeNull();
    expect(profile.volatility1M).not.toBeNull();
    expect(profile.pivots).not.toBeNull();
    expect(profile.position52w).toBeGreaterThanOrEqual(0);
    expect(profile.position52w).toBeLessThanOrEqual(100);
  });

  it("computes breadth and equal-weighted sector breadth", () => {
    const rows = [
      { symbol: "A", changePercent: 1 },
      { symbol: "B", changePercent: -2 },
      { symbol: "C", changePercent: 0 },
      { symbol: "D", changePercent: 3 },
    ];
    expect(breadth(rows)).toEqual({
      total: 4,
      advancers: 2,
      decliners: 1,
      unchanged: 1,
      advanceDeclineRatio: 2,
      meanChangePercent: 0.5,
      medianChangePercent: 0.5,
    });
    const sectors = sectorBreadth(rows, (symbol) =>
      symbol === "A" || symbol === "D" ? "Banks" : undefined,
    );
    expect(sectors.map((sector) => sector.sector)).toEqual([
      "Banks",
      "Unclassified",
    ]);
    expect(sectors[0]!.meanChangePercent).toBe(2);
  });
});

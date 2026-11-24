import { describe, expect, it } from "vitest";
import type { Candle } from "@stock/core";
import {
  adjustCandles,
  adjustmentIsComplete,
  normalizeExDate,
  parseRatioValue,
  resolveCorporateActions,
  type ResolvedCorporateAction,
} from "./adjust";

function bar(date: string, close: number, volume = 1000): Candle {
  return {
    symbol: "TEST",
    timeframe: "1day",
    timestamp: `${date}T09:15:00.000Z`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume,
    adjusted: false,
  };
}

const series = [
  bar("2026-01-01", 100),
  bar("2026-01-02", 100),
  bar("2026-01-03", 100),
  bar("2026-01-04", 100),
];

function bonus(overrides: Partial<ResolvedCorporateAction> = {}): ResolvedCorporateAction {
  return {
    id: "TEST:bonus:2026-01-03",
    symbol: "TEST",
    type: "bonus",
    exDate: "2026-01-03",
    bonusPercent: 10,
    percent: 10,
    ...overrides,
  };
}

describe("normalizeExDate", () => {
  it("accepts a day and an ISO timestamp", () => {
    expect(normalizeExDate("2026-01-03")).toBe("2026-01-03");
    expect(normalizeExDate("2026-01-03T09:15:00.000Z")).toBe("2026-01-03");
  });

  it("rejects a missing, malformed or impossible date", () => {
    expect(normalizeExDate(undefined)).toBeNull();
    expect(normalizeExDate("03/01/2026")).toBeNull();
    expect(normalizeExDate("2026-02-30")).toBeNull();
  });
});

describe("parseRatioValue", () => {
  it("reads a number, a pair and a percent", () => {
    expect(parseRatioValue(1.5)).toBe(1.5);
    expect(parseRatioValue("1:2")).toBe(0.5);
    expect(parseRatioValue("2:1")).toBe(2);
    expect(parseRatioValue("50%")).toBe(0.5);
  });
});

describe("resolveCorporateActions", () => {
  it("resolves a bonus that carries an ex-date and a percent", () => {
    const result = resolveCorporateActions(
      [
        {
          symbol: "TEST",
          type: "bonus",
          percent: 10,
          exDate: "2026-01-03",
          fiscalYear: "082-083",
        },
      ],
      { symbol: "TEST" },
    );
    expect(result.unresolved).toHaveLength(0);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]).toMatchObject({
      type: "bonus",
      exDate: "2026-01-03",
      bonusPercent: 10,
    });
  });

  it("resolves a cash dividend with an explicit per-share amount", () => {
    const result = resolveCorporateActions([
      {
        symbol: "TEST",
        type: "cashDividend",
        dividendPerShare: 9.75,
        exDate: "2026-01-03",
      },
    ]);
    expect(result.resolved[0]?.dividendPerShare).toBe(9.75);
  });

  it("converts a percent of paid-up value only when the par value is known", () => {
    const withPar = resolveCorporateActions(
      [{ symbol: "TEST", type: "cashDividend", percent: 10, exDate: "2026-01-03" }],
      { parValue: 100 },
    );
    expect(withPar.resolved[0]?.dividendPerShare).toBe(10);

    const withoutPar = resolveCorporateActions([
      { symbol: "TEST", type: "cashDividend", percent: 10, exDate: "2026-01-03" },
    ]);
    expect(withoutPar.resolved).toHaveLength(0);
    expect(withoutPar.unresolved[0]?.reason).toContain("paid-up");
  });

  it("keeps an action without an ex-date unresolved, even with a record date", () => {
    const result = resolveCorporateActions([
      { symbol: "TEST", type: "cashDividend", percent: 10, recordDate: "2026-01-03" },
    ]);
    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved[0]?.reason).toContain("not an ex-date");
  });

  it("resolves a right only when both ratio and issue price are present", () => {
    const result = resolveCorporateActions([
      { symbol: "TEST", type: "right", ratio: "1:1", issuePrice: 100, exDate: "2026-01-03" },
    ]);
    expect(result.resolved[0]).toMatchObject({ ratio: 1, issuePrice: 100 });

    const missingPrice = resolveCorporateActions([
      { symbol: "TEST", type: "right", ratio: "1:1", exDate: "2026-01-03" },
    ]);
    expect(missingPrice.unresolved[0]?.reason).toContain("issue price");
  });

  it("resolves a split and rejects a no-op ratio", () => {
    const result = resolveCorporateActions([
      { symbol: "TEST", type: "split", ratio: "2:1", exDate: "2026-01-03" },
    ]);
    expect(result.resolved[0]?.splitRatio).toBe(2);

    const noop = resolveCorporateActions([
      { symbol: "TEST", type: "split", ratio: "1:1", exDate: "2026-01-03" },
    ]);
    expect(noop.unresolved).toHaveLength(1);
  });

  it("rejects an unsupported type", () => {
    const result = resolveCorporateActions([
      { symbol: "TEST", type: "merger", exDate: "2026-01-03" },
    ]);
    expect(result.unresolved[0]?.reason).toContain("unsupported");
  });
});

describe("adjustCandles", () => {
  it("scales prices and volume before a bonus ex-date and leaves the rest alone", () => {
    const result = adjustCandles(series, [bonus()], { mode: "price" });
    expect(result.validation.ok).toBe(true);
    // 1 / 1.1
    expect(result.candles[0]?.close).toBeCloseTo(100 / 1.1, 10);
    expect(result.candles[1]?.close).toBeCloseTo(100 / 1.1, 10);
    expect(result.candles[2]?.close).toBe(100);
    expect(result.candles[3]?.close).toBe(100);
    expect(result.candles[0]?.volume).toBeCloseTo(1100, 10);
    expect(result.candles[0]?.adjusted).toBe(true);
    expect(result.candles[0]?.adjustmentFactor).toBeCloseTo(1 / 1.1, 10);
    expect(result.actions[0]?.shareFactor).toBeCloseTo(1.1, 10);
    // Raw rows are untouched.
    expect(result.raw[0]?.close).toBe(100);
    expect(series[0]?.close).toBe(100);
  });

  it("adjusts prior prices for a cash dividend in price mode", () => {
    const result = adjustCandles(
      series,
      [
        {
          id: "d",
          symbol: "TEST",
          type: "cashDividend",
          exDate: "2026-01-03",
          dividendPerShare: 5,
        },
      ],
      { mode: "price" },
    );
    expect(result.validation.ok).toBe(true);
    expect(result.candles[0]?.close).toBeCloseTo(95, 10);
    expect(result.candles[2]?.close).toBe(100);
    expect(result.cashEvents[0]?.perShare).toBe(5);
  });

  it("leaves prices alone for a dividend in total-return mode but still emits cash", () => {
    const result = adjustCandles(
      series,
      [
        {
          id: "d",
          symbol: "TEST",
          type: "cashDividend",
          exDate: "2026-01-03",
          dividendPerShare: 5,
        },
      ],
      { mode: "totalReturn" },
    );
    expect(result.validation.ok).toBe(true);
    expect(result.candles[0]?.close).toBe(100);
    expect(result.cashEvents).toHaveLength(1);
    expect(result.cashEvents[0]?.perShare).toBe(5);
  });

  it("applies the right-issue factor to prior prices", () => {
    // 1:1 right at 50 with a 100 previous close → (100 + 50) / (2 × 100) = 0.75
    const result = adjustCandles(
      series,
      [
        {
          id: "r",
          symbol: "TEST",
          type: "right",
          exDate: "2026-01-03",
          ratio: 1,
          issuePrice: 50,
        },
      ],
      { mode: "price" },
    );
    expect(result.validation.ok).toBe(true);
    expect(result.candles[0]?.close).toBeCloseTo(75, 10);
    expect(result.actions[0]?.shareFactor).toBe(2);
  });

  it("applies a split factor to prior prices", () => {
    const result = adjustCandles(
      series,
      [
        {
          id: "s",
          symbol: "TEST",
          type: "split",
          exDate: "2026-01-03",
          splitRatio: 2,
        },
      ],
      { mode: "price" },
    );
    expect(result.candles[0]?.close).toBeCloseTo(50, 10);
    expect(result.actions[0]?.shareFactor).toBe(2);
  });

  it("fails validation when a dividend is not below the previous close", () => {
    const result = adjustCandles(
      series,
      [
        {
          id: "d",
          symbol: "TEST",
          type: "cashDividend",
          exDate: "2026-01-03",
          dividendPerShare: 100,
        },
      ],
      { mode: "price" },
    );
    expect(result.validation.ok).toBe(false);
    expect(result.actions[0]?.status).toBe("invalid");
    expect(result.actions[0]?.reason).toContain("not below");
  });

  it("marks an action before the series as outside range without failing", () => {
    const result = adjustCandles(series, [bonus({ exDate: "2025-12-01" })], {
      mode: "price",
    });
    expect(result.validation.ok).toBe(true);
    expect(result.actions[0]?.status).toBe("outside-range");
    expect(result.candles[0]?.close).toBe(100);
    expect(adjustmentIsComplete(result)).toBe(true);
  });

  it("keeps multiple actions in date order with cumulative factors", () => {
    const result = adjustCandles(
      series,
      [
        bonus({ id: "b1", exDate: "2026-01-03", bonusPercent: 10 }),
        bonus({ id: "b2", exDate: "2026-01-04", bonusPercent: 10 }),
      ],
      { mode: "price" },
    );
    expect(result.validation.ok).toBe(true);
    // Bars 1 and 2 are before both ex-dates, bar 3 only before the second.
    expect(result.candles[0]?.close).toBeCloseTo(100 / 1.21, 10);
    expect(result.candles[2]?.close).toBeCloseTo(100 / 1.1, 10);
    expect(result.candles[3]?.close).toBe(100);
  });
});

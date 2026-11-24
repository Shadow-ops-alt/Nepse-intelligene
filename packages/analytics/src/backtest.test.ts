import { describe, expect, it } from "vitest";
import type { Candle } from "@stock/core";
import type { FeeSchedule } from "./fees";
import type { ResolvedCorporateAction } from "./adjust";
import { runBacktest, type BacktestConfig } from "./backtest";

const ZERO_COSTS: Partial<FeeSchedule> = {
  commissionTiers: [{ upTo: null, ratePercent: 0 }],
  minCommission: 0,
  sebonFeePercent: 0,
  dpChargePerScrip: 0,
  nameTransferFee: 0,
  cgtIndividualShortTermPercent: 0,
  cgtIndividualLongTermPercent: 0,
  cgtInstitutionPercent: 0,
  longTermHoldingDays: 365,
  cashDividendTaxPercent: 0,
  bonusTaxPercent: 0,
};

function days(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 1 + index));
    return date.toISOString().slice(0, 10);
  });
}

function bar(
  symbol: string,
  date: string,
  close: number,
  open = close,
  low = Math.min(open, close),
  high = Math.max(open, close),
): Candle {
  return {
    symbol,
    timeframe: "1day",
    timestamp: `${date}T09:15:00.000Z`,
    open,
    high,
    low,
    close,
    volume: 1000,
    adjusted: false,
  };
}

function config(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    strategy: { kind: "buyAndHold" },
    initialCapital: 100_000,
    positionSizing: { mode: "fixed", amount: 100_000 },
    maxPositions: 1,
    costs: { schedule: ZERO_COSTS, slippageBps: 0 },
    ...overrides,
  };
}

describe("no lookahead", () => {
  it("fills a close-of-bar signal at the next bar's open", () => {
    const dates = days(8);
    const closes = [10, 11, 12, 11, 10, 9, 8, 7];
    const candles = closes.map((close, index) =>
      bar(
        "TEST",
        dates[index]!,
        close,
        index === 3 ? 20 : close, // a deliberately distant next-open price
        Math.min(index === 3 ? 20 : close, close),
        Math.max(index === 3 ? 20 : close, close),
      ),
    );

    const result = runBacktest({
      symbols: [{ symbol: "TEST", candles }],
      config: config({
        strategy: { kind: "smaCross", fastPeriod: 2, slowPeriod: 3 },
      }),
    });

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0]!;
    // The 2/3 SMA cross happened on the close of day 3.
    expect(trade.entryDate).toBe(dates[3]);
    expect(trade.entryPrice).toBe(20);
    // The opposite cross happened on the close of day 5.
    expect(trade.exitDate).toBe(dates[5]);
    expect(trade.exitPrice).toBe(9);
    expect(trade.exitReason).toBe("signal");
    expect(trade.quantity).toBe(5000);
    expect(result.metrics.totalReturnPercent).toBe(-55);
  });

  it("does not act on an indicator that needs more history", () => {
    const dates = days(2);
    const candles = [100, 110].map((close, index) =>
      bar("TEST", dates[index]!, close),
    );
    const result = runBacktest({
      symbols: [{ symbol: "TEST", candles }],
      config: config({
        strategy: { kind: "smaCross", fastPeriod: 5, slowPeriod: 10 },
      }),
    });
    expect(result.trades).toHaveLength(0);
    expect(result.metrics.finalEquity).toBe(100_000);
  });
});

describe("fees and CGT", () => {
  it("charges buy fees, sell fees and CGT on the known trade", () => {
    const dates = days(3);
    const candles = [
      bar("TEST", dates[0]!, 100),
      bar("TEST", dates[1]!, 100, 100),
      bar("TEST", dates[2]!, 110, 110, 110, 110),
    ];
    const schedule: Partial<FeeSchedule> = {
      ...ZERO_COSTS,
      commissionTiers: [{ upTo: null, ratePercent: 1 }],
      cgtIndividualShortTermPercent: 10,
      cgtIndividualLongTermPercent: 10,
      cgtInstitutionPercent: 10,
    };
    const result = runBacktest({
      symbols: [{ symbol: "TEST", candles }],
      config: config({
        costs: { schedule, slippageBps: 0 },
        positionSizing: { mode: "fixed", amount: 10_000 },
      }),
    });

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0]!;
    expect(trade.quantity).toBe(100);
    expect(trade.buyCostTotal).toBe(10_100);
    expect(trade.sellProceeds).toBe(10_811);
    expect(trade.cgt).toBe(79);
    expect(trade.netProfit).toBe(711);
    expect(result.metrics.finalEquity).toBe(100_711);
    expect(result.metrics.totalCgt).toBe(79);
    expect(result.metrics.totalFees).toBe(210);
  });

  it("applies slippage against the trader", () => {
    const dates = days(3);
    const candles = [
      bar("TEST", dates[0]!, 100),
      bar("TEST", dates[1]!, 100),
      bar("TEST", dates[2]!, 110, 110, 110, 110),
    ];
    const result = runBacktest({
      symbols: [{ symbol: "TEST", candles }],
      config: config({
        costs: { schedule: ZERO_COSTS, slippageBps: 100 },
      }),
    });
    // 1% slippage: buy at 101, sell at 108.9.
    expect(result.trades[0]?.entryPrice).toBeCloseTo(101, 6);
    expect(result.trades[0]?.exitPrice).toBeCloseTo(108.9, 6);
    // 990 shares: 100,000 / 101 rounds down.
    expect(result.metrics.finalEquity).toBeCloseTo(107_821, 2);
  });
});

describe("corporate actions", () => {
  it("applies a bonus to the open position without an artificial equity jump", () => {
    const dates = days(5);
    const raw = 100;
    const exRaw = raw / 1.1;
    const candles = [
      bar("TEST", dates[0]!, raw),
      bar("TEST", dates[1]!, raw),
      bar("TEST", dates[2]!, raw),
      bar("TEST", dates[3]!, exRaw, exRaw, exRaw, exRaw),
      bar("TEST", dates[4]!, exRaw, exRaw, exRaw, exRaw),
    ];
    const action: ResolvedCorporateAction = {
      id: "TEST:bonus:2026-01-04",
      symbol: "TEST",
      type: "bonus",
      exDate: dates[3]!,
      bonusPercent: 10,
    };
    const result = runBacktest({
      symbols: [{ symbol: "TEST", candles, actions: [action] }],
      config: config(),
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.quantity).toBeCloseTo(1100, 6);
    expect(result.trades[0]?.exitReason).toBe("end-of-test");
    // Entry 1000 shares at 100, then 100 more shares; the raw price fell to
    // 90.909, so equity must not jump on the ex-date.
    const equity = result.equityCurve.map((point) => point.equity);
    for (const value of equity) expect(value).toBeCloseTo(100_000, 2);
    expect(result.metrics.totalReturnPercent).toBeCloseTo(0, 6);
  });

  it("keeps a trend signal continuous through a bonus gap", () => {
    const dates = days(8);
    const pre = [100, 101, 102, 103];
    const exRaw = 103 / 1.1;
    const candles = [
      ...pre.map((close, index) => bar("TEST", dates[index]!, close)),
      bar("TEST", dates[4]!, exRaw, exRaw, exRaw, exRaw),
      bar("TEST", dates[5]!, exRaw * 1.01, exRaw * 1.01, exRaw * 1.01, exRaw * 1.01),
      bar("TEST", dates[6]!, exRaw * 1.02, exRaw * 1.02, exRaw * 1.02, exRaw * 1.02),
      bar("TEST", dates[7]!, exRaw * 1.03, exRaw * 1.03, exRaw * 1.03, exRaw * 1.03),
    ];
    const action: ResolvedCorporateAction = {
      id: "TEST:bonus:2026-01-05",
      symbol: "TEST",
      type: "bonus",
      exDate: dates[4]!,
      bonusPercent: 10,
    };
    const result = runBacktest({
      symbols: [{ symbol: "TEST", candles, actions: [action] }],
      config: config({
        strategy: { kind: "smaCross", fastPeriod: 2, slowPeriod: 3 },
      }),
    });

    // On raw prices the 9% bonus gap would have closed the long. The adjusted
    // signal series stays in an uptrend, so the position is only closed at the
    // end of the test.
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.exitReason).toBe("end-of-test");
  });

  it("credits a cash dividend to the open position", () => {
    const dates = days(4);
    const candles = [
      bar("TEST", dates[0]!, 100),
      bar("TEST", dates[1]!, 100),
      bar("TEST", dates[2]!, 95, 95, 95, 95),
      bar("TEST", dates[3]!, 95, 95, 95, 95),
    ];
    const action: ResolvedCorporateAction = {
      id: "TEST:cashDividend:2026-01-03",
      symbol: "TEST",
      type: "cashDividend",
      exDate: dates[2]!,
      dividendPerShare: 5,
    };
    const result = runBacktest({
      symbols: [{ symbol: "TEST", candles, actions: [action] }],
      config: config(),
    });

    // 1000 shares, 5 per share, no dividend tax.
    expect(result.metrics.totalDividends).toBe(5000);
    expect(result.trades[0]?.dividends).toBe(5000);
    expect(result.equityCurve.map((point) => point.equity)).toEqual([
      100_000, 100_000, 100_000, 100_000,
    ]);
  });

  it("does not trigger a stop on a dividend's mechanical price drop", () => {
    const dates = days(4);
    const candles = [
      bar("TEST", dates[0]!, 100),
      bar("TEST", dates[1]!, 100),
      bar("TEST", dates[2]!, 95, 95, 95, 95),
      bar("TEST", dates[3]!, 95, 95, 95, 95),
    ];
    const action: ResolvedCorporateAction = {
      id: "TEST:cashDividend:2026-01-03",
      symbol: "TEST",
      type: "cashDividend",
      exDate: dates[2]!,
      dividendPerShare: 5,
    };
    const result = runBacktest({
      symbols: [{ symbol: "TEST", candles, actions: [action] }],
      config: config({ stopLossPercent: 5 }),
    });

    // The raw price touched 95 (the original stop) on the ex-date, but the
    // holder also received Rs 5 per share, so the stop is scaled to 90.25.
    expect(result.trades[0]?.exitReason).toBe("end-of-test");
    expect(result.metrics.totalDividends).toBe(5000);
    expect(result.metrics.finalEquity).toBeCloseTo(100_000, 2);
  });

  it("applies a right issue to shares and cash", () => {
    const dates = days(4);
    const candles = [
      bar("TEST", dates[0]!, 100),
      bar("TEST", dates[1]!, 100),
      bar("TEST", dates[2]!, 75, 75, 75, 75),
      bar("TEST", dates[3]!, 75, 75, 75, 75),
    ];
    const action: ResolvedCorporateAction = {
      id: "TEST:right:2026-01-03",
      symbol: "TEST",
      type: "right",
      exDate: dates[2]!,
      ratio: 1,
      issuePrice: 50,
    };
    const result = runBacktest({
      symbols: [{ symbol: "TEST", candles, actions: [action] }],
      config: config({
        initialCapital: 150_000,
        positionSizing: { mode: "fixed", amount: 100_000 },
      }),
    });

    // 1000 shares bought at 100; the 1:1 right adds 1000 shares for 50,000.
    expect(result.trades[0]?.quantity).toBe(2000);
    expect(result.metrics.finalEquity).toBeCloseTo(150_000, 2);
  });
});

describe("risk controls", () => {
  it("exits at the stop price when the bar trades through it", () => {
    const dates = days(3);
    const candles = [
      bar("TEST", dates[0]!, 100),
      bar("TEST", dates[1]!, 100),
      bar("TEST", dates[2]!, 94, 100, 94, 100),
    ];
    const result = runBacktest({
      symbols: [{ symbol: "TEST", candles }],
      config: config({ stopLossPercent: 5 }),
    });
    const trade = result.trades[0]!;
    expect(trade.exitReason).toBe("stop");
    expect(trade.exitPrice).toBe(95);
    expect(trade.netProfit).toBe(-5000);
  });

  it("exits at the target price when the bar trades through it", () => {
    const dates = days(3);
    const candles = [
      bar("TEST", dates[0]!, 100),
      bar("TEST", dates[1]!, 100),
      bar("TEST", dates[2]!, 111, 100, 100, 111),
    ];
    const result = runBacktest({
      symbols: [{ symbol: "TEST", candles }],
      config: config({ takeProfitPercent: 10 }),
    });
    const trade = result.trades[0]!;
    expect(trade.exitReason).toBe("target");
    expect(trade.exitPrice).toBeCloseTo(110, 6);
    expect(trade.netProfit).toBeCloseTo(10_000, 6);
  });
});

describe("metrics", () => {
  it("computes return, drawdown and trade statistics", () => {
    const dates = days(4);
    const candles = [
      bar("TEST", dates[0]!, 100),
      bar("TEST", dates[1]!, 100),
      bar("TEST", dates[2]!, 90, 90, 90, 90),
      bar("TEST", dates[3]!, 110, 110, 110, 110),
    ];
    const result = runBacktest({
      symbols: [{ symbol: "TEST", candles }],
      config: config(),
    });
    const metrics = result.metrics;
    expect(metrics.trades).toBe(1);
    expect(metrics.winningTrades).toBe(1);
    expect(metrics.winRatePercent).toBe(100);
    expect(metrics.expectancy).toBe(10_000);
    expect(metrics.totalReturnPercent).toBe(10);
    expect(metrics.maxDrawdownPercent).toBeCloseTo(-10, 6);
    expect(metrics.exposurePercent).toBeGreaterThan(0);
    expect(metrics.sessions).toBe(4);
    expect(result.monthlyReturns.length).toBeGreaterThan(0);
    expect(result.drawdownCurve).toHaveLength(4);
    expect(result.equityCurve[0]?.equity).toBe(100_000);
    expect(result.equityCurve.at(-1)?.equity).toBe(110_000);
  });

  it("respects maxPositions", () => {
    const dates = days(4);
    const up = [100, 100, 110, 110].map((close, index) =>
      bar("AAA", dates[index]!, close),
    );
    const flat = [100, 100, 100, 100].map((close, index) =>
      bar("BBB", dates[index]!, close, close, close, close),
    );
    const result = runBacktest({
      symbols: [
        { symbol: "AAA", candles: up },
        { symbol: "BBB", candles: flat },
      ],
      config: config({
        maxPositions: 1,
        positionSizing: { mode: "percent", percent: 50 },
      }),
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.symbol).toBe("AAA");
  });

  it("refuses a series that fails adjustment validation", () => {
    const dates = days(3);
    const candles = [
      bar("TEST", dates[0]!, 100),
      bar("TEST", dates[1]!, 100),
      bar("TEST", dates[2]!, 100),
    ];
    expect(() =>
      runBacktest({
        symbols: [
          {
            symbol: "TEST",
            candles,
            actions: [
              {
                id: "bad",
                symbol: "TEST",
                type: "cashDividend",
                exDate: dates[2]!,
                dividendPerShare: 200,
              },
            ],
          },
        ],
        config: config(),
      }),
    ).toThrow(/failed validation/);
  });
});

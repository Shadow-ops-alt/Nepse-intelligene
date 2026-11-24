/**
 * Event-driven daily backtester over stored NEPSE candles.
 *
 * Model summary (see docs/BACKTESTING.md for the full list):
 * - Signals are evaluated on the close of bar `i` and filled at the open of
 *   bar `i + 1`. No signal can use a price it could not have known.
 * - Signals read a corporate-action-adjusted close series, so a bonus, right
 *   or dividend cannot create a fake gap in an indicator. Fills, fees and
 *   position accounting use the raw exchange price.
 * - Bonus, right and split actions change the open position at the ex-date;
 *   a cash dividend is credited to cash on the ex-date. Rights are assumed to
 *   be exercised, with the subscription cost debited from cash.
 * - Costs come from `fees.ts` (`buyCost` / `sellProceeds`), including CGT.
 *
 * Everything is DERIVED research. It is not investment advice.
 */

import type { Candle } from "@stock/core";
import { ema, rsi, sma } from "./analysis";
import { drawdownSeries, macd, maxDrawdown } from "./quant";
import {
  buyCost,
  resolveFeeSchedule,
  sellProceeds,
  type FeeSchedule,
  type InvestorType,
} from "./fees";
import {
  adjustCandles,
  type ActionApplication,
  type ResolvedCorporateAction,
} from "./adjust";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

export type StrategyKind =
  | "smaCross"
  | "emaCross"
  | "rsi"
  | "macd"
  | "breakout"
  | "buyAndHold";

export interface StrategyConfig {
  kind: StrategyKind;
  /** SMA/EMA fast period. Default 20. */
  fastPeriod?: number;
  /** SMA/EMA slow period. Default 50. */
  slowPeriod?: number;
  /** RSI period. Default 14. */
  rsiPeriod?: number;
  /** RSI level whose upward cross opens a long. Default 30. */
  rsiBuyBelow?: number;
  /** RSI level whose downward cross closes a long. Default 70. */
  rsiSellAbove?: number;
  macdFast?: number;
  macdSlow?: number;
  macdSignal?: number;
  /** Breakout entry lookback. Default 20. */
  breakoutEntryLookback?: number;
  /** Breakout exit lookback. Default 10. */
  breakoutExitLookback?: number;
}

export interface PositionSizing {
  mode: "percent" | "fixed";
  /** Percent of current equity per new position (1..100). */
  percent?: number;
  /** Fixed NPR amount per new position. */
  amount?: number;
}

export interface BacktestCosts {
  schedule?: Partial<FeeSchedule>;
  investor?: InvestorType;
  /** Slippage applied against the trader, in basis points. */
  slippageBps?: number;
  /**
   * Withholding tax on cash dividends, percent. Defaults to the schedule's
   * `cashDividendTaxPercent`. Set 0 to credit gross dividends.
   */
  dividendTaxPercent?: number;
}

export interface BacktestSymbolInput {
  symbol: string;
  /** Raw, unadjusted candles. */
  candles: readonly Candle[];
  /** Resolved corporate actions. Unresolved actions must be filtered out first. */
  actions?: readonly ResolvedCorporateAction[];
}

export interface BacktestConfig {
  strategy: StrategyConfig;
  initialCapital: number;
  positionSizing: PositionSizing;
  maxPositions: number;
  from?: string;
  to?: string;
  costs?: BacktestCosts;
  /** Stop loss below the entry fill, percent. */
  stopLossPercent?: number | null;
  /** Take profit above the entry fill, percent. */
  takeProfitPercent?: number | null;
  /** NEPSE index series used as the benchmark. */
  benchmark?: { symbol: string; candles: readonly Candle[] } | null;
  /** Force-close open positions at the last stored close. Default true. */
  closeAtEnd?: boolean;
}

export interface BacktestInput {
  symbols: readonly BacktestSymbolInput[];
  config: BacktestConfig;
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

export type ExitReason = "signal" | "stop" | "target" | "end-of-test";

export interface BacktestTrade {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  quantity: number;
  buyCostTotal: number;
  /** Net cash received on the sale, after sell fees and CGT. */
  sellProceeds: number;
  netProfit: number;
  returnPercent: number;
  holdingDays: number;
  exitReason: ExitReason;
  fees: number;
  cgt: number;
  /** Cash dividends credited while the position was open. */
  dividends: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
  invested: number;
  cash: number;
  /** Benchmark value normalised to the initial capital; null when no benchmark. */
  benchmark: number | null;
}

export interface DrawdownPoint {
  date: string;
  /** Percent below the running peak; 0 at a new high and negative in a drawdown. */
  drawdownPercent: number;
}

export interface BacktestMonthlyReturn {
  /** `YYYY-MM`. */
  month: string;
  returnPercent: number;
}

export interface BacktestMetrics {
  initialCapital: number;
  finalEquity: number;
  totalReturnPercent: number;
  cagrPercent: number | null;
  /** Negative percent, 0 when the equity curve never fell. */
  maxDrawdownPercent: number;
  sharpe: number | null;
  sortino: number | null;
  volatilityPercent: number | null;
  winRatePercent: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  trades: number;
  winningTrades: number;
  losingTrades: number;
  exposurePercent: number;
  turnoverPercent: number;
  benchmarkReturnPercent: number | null;
  sessions: number;
  sessionsPerYear: number;
  totalFees: number;
  totalCgt: number;
  totalDividends: number;
  totalTurnover: number;
}

export interface BacktestAdjustmentSummary {
  symbol: string;
  actions: number;
  applied: number;
  invalid: number;
  outsideRange: number;
  cashEvents: number;
  /** Applied actions whose ex-date is a derived book-closure date. */
  bookClosureActions: number;
  validationOk: boolean;
  warnings: string[];
}

export interface BacktestResult {
  generatedAt: string;
  /** All performance figures are derived from raw prices and resolved actions. */
  classification: "DERIVED";
  symbols: string[];
  strategy: StrategyConfig;
  period: {
    from: string | null;
    to: string | null;
    sessions: number;
    days: number;
    sessionsPerYear: number;
  };
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  drawdownCurve: DrawdownPoint[];
  monthlyReturns: BacktestMonthlyReturn[];
  trades: BacktestTrade[];
  adjustments: BacktestAdjustmentSummary[];
  benchmark: { symbol: string; returnPercent: number | null; points: number } | null;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

type Target = "long" | "flat";

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function daysBetween(from: string, to: string): number {
  const value = Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function filterCandles(
  candles: readonly Candle[],
  from: string | null,
  to: string | null,
): Candle[] {
  return [...candles]
    .filter((candle) => {
      const day = dayOf(candle.timestamp);
      return (!from || day >= from) && (!to || day <= to);
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than zero`);
  }
  return value;
}

function integerAtLeast(value: number, name: string, min: number): number {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer of at least ${min}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// strategy normalisation and targets
// ---------------------------------------------------------------------------

interface NormalizedStrategy {
  kind: StrategyKind;
  fastPeriod: number;
  slowPeriod: number;
  rsiPeriod: number;
  rsiBuyBelow: number;
  rsiSellAbove: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  breakoutEntryLookback: number;
  breakoutExitLookback: number;
}

export function normalizeStrategy(config: StrategyConfig): NormalizedStrategy {
  const kind = config.kind;
  if (
    kind !== "smaCross" &&
    kind !== "emaCross" &&
    kind !== "rsi" &&
    kind !== "macd" &&
    kind !== "breakout" &&
    kind !== "buyAndHold"
  ) {
    throw new RangeError(`unknown strategy "${String(kind)}"`);
  }
  const normalized: NormalizedStrategy = {
    kind,
    fastPeriod: integerAtLeast(config.fastPeriod ?? 20, "fastPeriod", 1),
    slowPeriod: integerAtLeast(config.slowPeriod ?? 50, "slowPeriod", 1),
    rsiPeriod: integerAtLeast(config.rsiPeriod ?? 14, "rsiPeriod", 2),
    rsiBuyBelow: config.rsiBuyBelow ?? 30,
    rsiSellAbove: config.rsiSellAbove ?? 70,
    macdFast: integerAtLeast(config.macdFast ?? 12, "macdFast", 1),
    macdSlow: integerAtLeast(config.macdSlow ?? 26, "macdSlow", 1),
    macdSignal: integerAtLeast(config.macdSignal ?? 9, "macdSignal", 1),
    breakoutEntryLookback: integerAtLeast(
      config.breakoutEntryLookback ?? 20,
      "breakoutEntryLookback",
      1,
    ),
    breakoutExitLookback: integerAtLeast(
      config.breakoutExitLookback ?? 10,
      "breakoutExitLookback",
      1,
    ),
  };
  if (normalized.fastPeriod >= normalized.slowPeriod) {
    throw new RangeError("fastPeriod must be shorter than slowPeriod");
  }
  if (normalized.macdFast >= normalized.macdSlow) {
    throw new RangeError("macdFast must be shorter than macdSlow");
  }
  if (
    !Number.isFinite(normalized.rsiBuyBelow) ||
    !Number.isFinite(normalized.rsiSellAbove) ||
    normalized.rsiBuyBelow <= 0 ||
    normalized.rsiSellAbove >= 100 ||
    normalized.rsiBuyBelow >= normalized.rsiSellAbove
  ) {
    throw new RangeError(
      "RSI levels must satisfy 0 < rsiBuyBelow < rsiSellAbove < 100",
    );
  }
  return normalized;
}

/** Desired exposure at each bar's close; orders execute on the next bar. */
function targetsFor(
  bars: readonly Candle[],
  strategy: NormalizedStrategy,
): Target[] {
  const count = bars.length;
  const targets = new Array<Target>(count).fill("flat");
  if (count === 0) return targets;
  const closes = bars.map((bar) => bar.close);

  if (strategy.kind === "buyAndHold") {
    targets.fill("long");
    return targets;
  }

  if (strategy.kind === "smaCross" || strategy.kind === "emaCross") {
    const average = strategy.kind === "smaCross" ? sma : ema;
    const fast = average(closes, strategy.fastPeriod);
    const slow = average(closes, strategy.slowPeriod);
    for (let index = 0; index < count; index += 1) {
      const f = fast[index];
      const s = slow[index];
      targets[index] =
        f !== null && f !== undefined && s !== null && s !== undefined && f > s
          ? "long"
          : "flat";
    }
    return targets;
  }

  if (strategy.kind === "rsi") {
    const values = rsi(closes, strategy.rsiPeriod);
    let long = false;
    for (let index = 0; index < count; index += 1) {
      const previous = index > 0 ? values[index - 1] : null;
      const current = values[index];
      if (long) {
        if (
          previous !== null &&
          previous !== undefined &&
          current !== null &&
          current !== undefined &&
          previous >= strategy.rsiSellAbove &&
          current < strategy.rsiSellAbove
        ) {
          long = false;
        }
      } else if (
        previous !== null &&
        previous !== undefined &&
        current !== null &&
        current !== undefined &&
        previous <= strategy.rsiBuyBelow &&
        current > strategy.rsiBuyBelow
      ) {
        long = true;
      }
      targets[index] = long ? "long" : "flat";
    }
    return targets;
  }

  if (strategy.kind === "macd") {
    const series = macd(
      closes,
      strategy.macdFast,
      strategy.macdSlow,
      strategy.macdSignal,
    );
    for (let index = 0; index < count; index += 1) {
      const line = series.macd[index];
      const signal = series.signal[index];
      targets[index] =
        line !== null &&
        line !== undefined &&
        signal !== null &&
        signal !== undefined &&
        line > signal
          ? "long"
          : "flat";
    }
    return targets;
  }

  // breakout: close above the prior N-session high enters, close below the
  // prior M-session low exits. The lookback excludes the current bar.
  let long = false;
  for (let index = 0; index < count; index += 1) {
    if (!long && index >= strategy.breakoutEntryLookback) {
      let priorHigh = -Infinity;
      for (
        let offset = index - strategy.breakoutEntryLookback;
        offset < index;
        offset += 1
      ) {
        priorHigh = Math.max(priorHigh, bars[offset]?.high ?? -Infinity);
      }
      const close = closes[index];
      if (close !== undefined && Number.isFinite(priorHigh) && close > priorHigh) {
        long = true;
      }
    }
    if (long && index >= strategy.breakoutExitLookback) {
      let priorLow = Infinity;
      for (
        let offset = index - strategy.breakoutExitLookback;
        offset < index;
        offset += 1
      ) {
        priorLow = Math.min(priorLow, bars[offset]?.low ?? Infinity);
      }
      const close = closes[index];
      if (close !== undefined && Number.isFinite(priorLow) && close < priorLow) {
        long = false;
      }
    }
    targets[index] = long ? "long" : "flat";
  }
  return targets;
}

// ---------------------------------------------------------------------------
// internal state
// ---------------------------------------------------------------------------

interface Position {
  symbol: string;
  quantity: number;
  entryDate: string;
  entryPrice: number;
  buyCostTotal: number;
  buyFees: number;
  stopPrice: number | null;
  targetPrice: number | null;
  dividends: number;
}

interface PreparedSymbol {
  symbol: string;
  rawBars: Candle[];
  signalBars: Candle[];
  dates: string[];
  indexByDate: Map<string, number>;
  targets: Target[];
  actions: ActionApplication[];
  lastClose: number | null;
  lastDate: string | null;
  pending: { executeIndex: number; target: Target } | null;
}

interface BenchmarkCursor {
  symbol: string;
  bars: Array<{ date: string; close: number }>;
  index: number;
  lastClose: number | null;
  baseClose: number | null;
}

// ---------------------------------------------------------------------------
// engine
// ---------------------------------------------------------------------------

export function runBacktest(input: BacktestInput): BacktestResult {
  const config = input.config;
  const warnings: string[] = [];
  const strategy = normalizeStrategy(config.strategy);
  const schedule = resolveFeeSchedule(config.costs?.schedule);
  const investor: InvestorType = config.costs?.investor ?? "individual";
  const slippageBps = config.costs?.slippageBps ?? 0;
  if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 1000) {
    throw new RangeError("slippageBps must be between 0 and 1000");
  }
  const dividendTaxPercent =
    config.costs?.dividendTaxPercent ?? schedule.cashDividendTaxPercent;
  if (!Number.isFinite(dividendTaxPercent) || dividendTaxPercent < 0) {
    throw new RangeError("dividendTaxPercent must be zero or greater");
  }
  const initialCapital = positiveNumber(
    config.initialCapital,
    "initialCapital",
  );
  integerAtLeast(config.maxPositions, "maxPositions", 1);
  const sizing = config.positionSizing;
  if (sizing.mode !== "percent" && sizing.mode !== "fixed") {
    throw new RangeError(`unknown position sizing mode "${String(sizing.mode)}"`);
  }
  if (sizing.mode === "percent") {
    const percent = sizing.percent ?? 0;
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      throw new RangeError("positionPercent must be greater than 0 and at most 100");
    }
  } else {
    positiveNumber(sizing.amount ?? Number.NaN, "positionAmount");
  }
  const stopLossPercent = config.stopLossPercent ?? null;
  if (stopLossPercent !== null && (!Number.isFinite(stopLossPercent) || stopLossPercent <= 0 || stopLossPercent >= 100)) {
    throw new RangeError("stopLossPercent must be greater than 0 and below 100");
  }
  const takeProfitPercent = config.takeProfitPercent ?? null;
  if (takeProfitPercent !== null && (!Number.isFinite(takeProfitPercent) || takeProfitPercent <= 0)) {
    throw new RangeError("takeProfitPercent must be greater than zero");
  }
  if (input.symbols.length === 0) {
    throw new RangeError("at least one symbol is required");
  }

  const from = config.from ? dayOf(config.from) : null;
  const to = config.to ? dayOf(config.to) : null;

  const seen = new Set<string>();
  const prepared: PreparedSymbol[] = [];
  const adjustments: BacktestAdjustmentSummary[] = [];
  let bookClosureActions = 0;

  for (const entry of input.symbols) {
    const symbol = entry.symbol.trim().toUpperCase();
    if (!symbol) throw new RangeError("a symbol is empty");
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    const rawBars = filterCandles(entry.candles, from, to);
    if (rawBars.length < 2) {
      throw new RangeError(
        `${symbol}: fewer than two stored sessions in the requested range`,
      );
    }
    const actions = (entry.actions ?? []).filter(
      (action) => action.symbol.toUpperCase() === symbol,
    );
    const adjusted = adjustCandles(rawBars, actions, {
      mode: "price",
      symbol,
    });
    if (!adjusted.validation.ok) {
      throw new RangeError(
        `${symbol}: adjusted series failed validation: ${adjusted.validation.issues.join("; ")}`,
      );
    }
    warnings.push(...adjusted.validation.warnings.map((warning) => `${symbol}: ${warning}`));
    const applied = adjusted.actions.filter(
      (action) => action.status === "applied" && action.exDateIndex !== null,
    );
    const symbolBookClosure = applied.filter(
      (action) => action.action.dateBasis === "book-closure",
    ).length;
    bookClosureActions += symbolBookClosure;
    const dates = rawBars.map((bar) => dayOf(bar.timestamp));
    const indexByDate = new Map<string, number>();
    dates.forEach((date, index) => {
      indexByDate.set(date, index);
    });
    prepared.push({
      symbol,
      rawBars,
      signalBars: adjusted.candles,
      dates,
      indexByDate,
      targets: targetsFor(adjusted.candles, strategy),
      actions: applied,
      lastClose: null,
      lastDate: null,
      pending: null,
    });
    adjustments.push({
      symbol,
      actions: adjusted.actions.length,
      applied: applied.length,
      invalid: adjusted.actions.filter((action) => action.status === "invalid").length,
      outsideRange: adjusted.actions.filter((action) => action.status === "outside-range").length,
      cashEvents: adjusted.cashEvents.length,
      bookClosureActions: symbolBookClosure,
      validationOk: adjusted.validation.ok,
      warnings: adjusted.validation.warnings,
    });
  }

  if (bookClosureActions > 0) {
    warnings.push(
      `${bookClosureActions} action${bookClosureActions === 1 ? "" : "s"} use book-closure dates as approximate ex-dates; results may shift by one session.`,
    );
  }

  const bySymbol = new Map(prepared.map((entry) => [entry.symbol, entry]));
  const benchmark = prepareBenchmark(config.benchmark ?? null, from, to);
  if (config.benchmark && !benchmark) {
    warnings.push(
      `benchmark ${config.benchmark.symbol} has no stored sessions in the requested range`,
    );
  }

  let cash = initialCapital;
  let totalFees = 0;
  let totalCgt = 0;
  let totalDividends = 0;
  let totalTurnover = 0;
  const positions = new Map<string, Position>();
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  const allDates = [
    ...new Set(prepared.flatMap((entry) => entry.dates)),
  ].sort();

  const markToMarket = (currentSymbol: string | null, currentOpen: number | null): number => {
    let invested = 0;
    for (const position of positions.values()) {
      const entry = bySymbol.get(position.symbol);
      const price =
        position.symbol === currentSymbol && currentOpen !== null
          ? currentOpen
          : entry?.lastClose ?? position.entryPrice;
      invested += position.quantity * price;
    }
    return cash + invested;
  };

  const openPosition = (
    entry: PreparedSymbol,
    bar: Candle,
    date: string,
  ): void => {
    if (positions.has(entry.symbol)) return;
    if (positions.size >= config.maxPositions) return;
    const fill = bar.open * (1 + slippageBps / 10_000);
    if (!Number.isFinite(fill) || fill <= 0) {
      warnings.push(`${entry.symbol} ${date}: invalid open price; order skipped`);
      return;
    }
    const equityNow = markToMarket(entry.symbol, fill);
    let allocation =
      sizing.mode === "percent"
        ? (equityNow * (sizing.percent ?? 0)) / 100
        : (sizing.amount ?? 0);
    allocation = Math.min(allocation, cash);
    if (!(allocation > 0)) return;
    let quantity = Math.floor(allocation / fill);
    if (quantity < 1) {
      warnings.push(
        `${entry.symbol} ${date}: allocation ${round(allocation)} cannot buy one share at ${round(fill)}`,
      );
      return;
    }
    while (quantity > 0) {
      const cost = buyCost({ quantity, price: fill, schedule });
      if (cost.total <= cash) {
        cash -= cost.total;
        const buyFees = cost.total - cost.amount;
        totalFees += buyFees;
        totalTurnover += cost.amount;
        positions.set(entry.symbol, {
          symbol: entry.symbol,
          quantity,
          entryDate: date,
          entryPrice: fill,
          buyCostTotal: cost.total,
          buyFees,
          stopPrice:
            stopLossPercent !== null
              ? fill * (1 - stopLossPercent / 100)
              : null,
          targetPrice:
            takeProfitPercent !== null
              ? fill * (1 + takeProfitPercent / 100)
              : null,
          dividends: 0,
        });
        return;
      }
      quantity = Math.min(quantity - 1, Math.floor(cash / fill));
    }
    warnings.push(
      `${entry.symbol} ${date}: cash could not cover the buy fees; order skipped`,
    );
  };

  const closePosition = (
    entry: PreparedSymbol,
    date: string,
    rawPrice: number,
    reason: ExitReason,
  ): void => {
    const position = positions.get(entry.symbol);
    if (!position) return;
    const fill = rawPrice * (1 - slippageBps / 10_000);
    if (!Number.isFinite(fill) || fill <= 0) {
      warnings.push(`${entry.symbol} ${date}: invalid exit price; position left open`);
      return;
    }
    const sale = sellProceeds({
      quantity: position.quantity,
      price: fill,
      buyCostTotal: position.buyCostTotal,
      holdingDays: daysBetween(position.entryDate, date),
      investor,
      schedule,
    });
    cash += sale.receivable;
    totalFees += sale.fees;
    totalCgt += sale.cgt;
    totalTurnover += sale.amount;
    trades.push({
      symbol: entry.symbol,
      entryDate: position.entryDate,
      entryPrice: round(position.entryPrice, 4),
      exitDate: date,
      exitPrice: round(fill, 4),
      quantity: position.quantity,
      buyCostTotal: round(position.buyCostTotal, 2),
      sellProceeds: sale.receivable,
      netProfit: sale.netProfit,
      returnPercent:
        position.buyCostTotal > 0
          ? round((sale.netProfit / position.buyCostTotal) * 100, 4)
          : 0,
      holdingDays: daysBetween(position.entryDate, date),
      exitReason: reason,
      fees: round(position.buyFees + sale.fees, 2),
      cgt: sale.cgt,
      dividends: round(position.dividends, 2),
    });
    positions.delete(entry.symbol);
  };

  const applyCorporateActions = (entry: PreparedSymbol, index: number): void => {
    for (const application of entry.actions) {
      if (application.exDateIndex !== index) continue;
      const position = positions.get(entry.symbol);
      if (!position) continue;
      if (application.action.type === "cashDividend") {
        const perShare =
          application.cashPerShare ?? application.action.dividendPerShare ?? 0;
        const gross = perShare * position.quantity;
        const net = gross * (1 - dividendTaxPercent / 100);
        cash += net;
        totalDividends += net;
        position.dividends += net;
        // A cash dividend lowers the raw price on the ex-date. Scale the
        // protective levels by the same factor so the mechanical drop cannot
        // trigger a stop or a target by itself.
        const dividendFactor = application.priceFactor ?? 1;
        if (position.stopPrice !== null) position.stopPrice *= dividendFactor;
        if (position.targetPrice !== null) position.targetPrice *= dividendFactor;
        continue;
      }
      const shareFactor = application.shareFactor ?? 1;
      if (application.action.type === "right") {
        const newShares = position.quantity * (application.action.ratio ?? 0);
        const cost = newShares * (application.action.issuePrice ?? 0);
        if (cost > cash) {
          warnings.push(
            `${entry.symbol} ${application.action.exDate}: right subscription cost ${round(cost)} exceeds cash ${round(cash)}; the shortfall is carried as a negative cash balance`,
          );
        }
        cash -= cost;
        position.quantity += newShares;
        position.buyCostTotal += cost;
        totalTurnover += cost;
      } else if (shareFactor !== 1) {
        position.quantity *= shareFactor;
      }
      const priceFactor = application.priceFactor ?? 1;
      if (position.stopPrice !== null) position.stopPrice *= priceFactor;
      if (position.targetPrice !== null) position.targetPrice *= priceFactor;
    }
  };

  for (const date of allDates) {
    const today = prepared
      .filter((entry) => entry.indexByDate.has(date))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    for (const entry of today) {
      const index = entry.indexByDate.get(date)!;
      const bar = entry.rawBars[index]!;
      applyCorporateActions(entry, index);

      if (entry.pending && entry.pending.executeIndex === index) {
        const pending = entry.pending;
        entry.pending = null;
        if (pending.target === "long") {
          openPosition(entry, bar, date);
        } else if (positions.has(entry.symbol)) {
          closePosition(entry, date, bar.open, "signal");
        }
      }

      const position = positions.get(entry.symbol);
      if (position) {
        if (position.stopPrice !== null && bar.low <= position.stopPrice) {
          const raw = bar.open <= position.stopPrice ? bar.open : position.stopPrice;
          closePosition(entry, date, raw, "stop");
        } else if (
          position.targetPrice !== null &&
          bar.high >= position.targetPrice
        ) {
          const raw =
            bar.open >= position.targetPrice ? bar.open : position.targetPrice;
          closePosition(entry, date, raw, "target");
        }
      }

      entry.lastClose = bar.close;
      entry.lastDate = date;
    }

    let invested = 0;
    for (const position of positions.values()) {
      const entry = bySymbol.get(position.symbol);
      invested += position.quantity * (entry?.lastClose ?? position.entryPrice);
    }
    const equity = cash + invested;
    equityCurve.push({
      date,
      equity,
      invested,
      cash,
      benchmark: benchmark ? benchmarkValueAt(benchmark, date, initialCapital) : null,
    });

    for (const entry of today) {
      const index = entry.indexByDate.get(date)!;
      const nextIndex = index + 1;
      if (nextIndex >= entry.rawBars.length) {
        entry.pending = null;
        continue;
      }
      entry.pending = {
        executeIndex: nextIndex,
        target: entry.targets[index] ?? "flat",
      };
    }
  }

  if (config.closeAtEnd !== false) {
    for (const symbol of [...positions.keys()].sort()) {
      const entry = bySymbol.get(symbol);
      if (!entry || entry.lastClose === null || entry.lastDate === null) continue;
      closePosition(entry, entry.lastDate, entry.lastClose, "end-of-test");
    }
    const lastPoint = equityCurve.at(-1);
    if (lastPoint) {
      lastPoint.equity = cash;
      lastPoint.invested = 0;
      lastPoint.cash = cash;
    }
  }

  const metrics = computeMetrics({
    initialCapital,
    finalEquity: equityCurve.at(-1)?.equity ?? cash,
    equityCurve,
    trades,
    benchmarkReturnPercent: benchmark ? benchmarkReturn(benchmark) : null,
    totalFees,
    totalCgt,
    totalDividends,
    totalTurnover,
    sessionsPerYear: sessionsPerYearFromCurve(equityCurve),
  });

  const firstDate = equityCurve[0]?.date ?? null;
  const lastDate = equityCurve.at(-1)?.date ?? null;
  const days =
    firstDate !== null && lastDate !== null ? daysBetween(firstDate, lastDate) : 0;

  return {
    generatedAt: new Date().toISOString(),
    classification: "DERIVED",
    symbols: prepared.map((entry) => entry.symbol).sort(),
    strategy: { ...config.strategy },
    period: {
      from: firstDate,
      to: lastDate,
      sessions: equityCurve.length,
      days,
      sessionsPerYear: metrics.sessionsPerYear,
    },
    metrics,
    equityCurve: equityCurve.map((point) => ({
      ...point,
      equity: round(point.equity, 2),
      invested: round(point.invested, 2),
      cash: round(point.cash, 2),
      benchmark: point.benchmark === null ? null : round(point.benchmark, 2),
    })),
    drawdownCurve: drawdownCurve(equityCurve),
    monthlyReturns: monthlyEquityReturns(equityCurve, initialCapital),
    trades,
    adjustments,
    benchmark: benchmark
      ? {
          symbol: benchmark.symbol,
          returnPercent: benchmarkReturn(benchmark),
          points: benchmark.bars.length,
        }
      : null,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// benchmark
// ---------------------------------------------------------------------------

function prepareBenchmark(
  input: { symbol: string; candles: readonly Candle[] } | null,
  from: string | null,
  to: string | null,
): BenchmarkCursor | null {
  if (!input) return null;
  const bars = filterCandles(input.candles, from, to).map((candle) => ({
    date: dayOf(candle.timestamp),
    close: candle.close,
  }));
  if (bars.length < 1) return null;
  return {
    symbol: input.symbol.trim().toUpperCase(),
    bars,
    index: -1,
    lastClose: null,
    baseClose: null,
  };
}

function benchmarkValueAt(
  cursor: BenchmarkCursor,
  date: string,
  initialCapital: number,
): number | null {
  while (
    cursor.index + 1 < cursor.bars.length &&
    (cursor.bars[cursor.index + 1]?.date ?? "") <= date
  ) {
    cursor.index += 1;
    const bar = cursor.bars[cursor.index];
    if (bar) cursor.lastClose = bar.close;
  }
  if (cursor.lastClose === null) {
    // The benchmark starts after this equity date; use its first stored close
    // so the comparison begins on a common level.
    const first = cursor.bars[0];
    if (!first) return null;
    cursor.baseClose = first.close;
    return initialCapital;
  }
  if (cursor.baseClose === null) cursor.baseClose = cursor.lastClose;
  if (cursor.baseClose === null || cursor.baseClose <= 0) return null;
  return (initialCapital * cursor.lastClose) / cursor.baseClose;
}

function benchmarkReturn(cursor: BenchmarkCursor): number | null {
  // Use the values the equity loop actually saw, so the benchmark return covers
  // the same dates as the strategy rather than the benchmark's own full range.
  if (
    cursor.baseClose === null ||
    cursor.lastClose === null ||
    cursor.baseClose <= 0
  ) {
    return null;
  }
  return round((cursor.lastClose / cursor.baseClose - 1) * 100, 4);
}

// ---------------------------------------------------------------------------
// metrics
// ---------------------------------------------------------------------------

function sessionsPerYearFromCurve(curve: readonly EquityPoint[]): number {
  if (curve.length < 2) return 252;
  const first = curve[0]!.date;
  const last = curve.at(-1)!.date;
  const span = daysBetween(first, last);
  if (span <= 0) return 252;
  const scaled = ((curve.length - 1) / span) * 365.25;
  return Math.min(366, Math.max(1, Math.round(scaled)));
}

function computeMetrics({
  initialCapital,
  finalEquity,
  equityCurve,
  trades,
  benchmarkReturnPercent,
  totalFees,
  totalCgt,
  totalDividends,
  totalTurnover,
  sessionsPerYear,
}: {
  initialCapital: number;
  finalEquity: number;
  equityCurve: readonly EquityPoint[];
  trades: readonly BacktestTrade[];
  benchmarkReturnPercent: number | null;
  totalFees: number;
  totalCgt: number;
  totalDividends: number;
  totalTurnover: number;
  sessionsPerYear: number;
}): BacktestMetrics {
  const equities = equityCurve.map((point) => point.equity);
  const returns: number[] = [];
  for (let index = 1; index < equities.length; index += 1) {
    const previous = equities[index - 1]!;
    const current = equities[index]!;
    if (previous > 0) returns.push(current / previous - 1);
  }
  const averageReturn = returns.length > 0 ? mean(returns) : 0;
  const deviation = stdev(returns);
  const sharpe =
    deviation !== null && deviation > 0
      ? (averageReturn / deviation) * Math.sqrt(sessionsPerYear)
      : null;
  let sortino: number | null = null;
  if (returns.length > 0) {
    const downside = Math.sqrt(
      mean(returns.map((value) => Math.min(0, value) ** 2)),
    );
    sortino =
      downside > 0 ? (averageReturn / downside) * Math.sqrt(sessionsPerYear) : null;
  }
  const volatilityPercent =
    deviation !== null ? round(deviation * Math.sqrt(sessionsPerYear) * 100, 4) : null;

  const drawdown = maxDrawdown(equities);
  const averageEquity =
    equities.length > 0 ? mean(equities) : initialCapital;
  const exposurePercent =
    equities.length > 0
      ? round(
          mean(
            equityCurve.map((point) =>
              point.equity > 0 ? (point.invested / point.equity) * 100 : 0,
            ),
          ),
          4,
        )
      : 0;

  const winning = trades.filter((trade) => trade.netProfit > 0);
  const losing = trades.filter((trade) => trade.netProfit < 0);
  const grossProfit = winning.reduce((sum, trade) => sum + trade.netProfit, 0);
  const grossLoss = losing.reduce((sum, trade) => sum + trade.netProfit, 0);
  const profitFactor =
    losing.length > 0 && grossLoss < 0 ? round(grossProfit / Math.abs(grossLoss), 4) : null;
  const expectancy =
    trades.length > 0
      ? round(
          trades.reduce((sum, trade) => sum + trade.netProfit, 0) / trades.length,
          2,
        )
      : null;

  const days =
    equityCurve.length > 1
      ? daysBetween(equityCurve[0]!.date, equityCurve.at(-1)!.date)
      : 0;
  const cagrPercent =
    days > 0 && initialCapital > 0 && finalEquity > 0
      ? round(((finalEquity / initialCapital) ** (365.25 / days) - 1) * 100, 4)
      : null;

  return {
    initialCapital,
    finalEquity: round(finalEquity, 2),
    totalReturnPercent:
      initialCapital > 0
        ? round((finalEquity / initialCapital - 1) * 100, 4)
        : 0,
    cagrPercent,
    maxDrawdownPercent:
      drawdown !== null ? round(drawdown.maxDrawdownPercent, 4) : 0,
    sharpe: sharpe === null ? null : round(sharpe, 4),
    sortino: sortino === null ? null : round(sortino, 4),
    volatilityPercent,
    winRatePercent:
      trades.length > 0 ? round((winning.length / trades.length) * 100, 4) : null,
    profitFactor,
    expectancy,
    trades: trades.length,
    winningTrades: winning.length,
    losingTrades: losing.length,
    exposurePercent,
    turnoverPercent:
      averageEquity > 0 ? round((totalTurnover / averageEquity) * 100, 4) : 0,
    benchmarkReturnPercent,
    sessions: equityCurve.length,
    sessionsPerYear,
    totalFees: round(totalFees, 2),
    totalCgt: round(totalCgt, 2),
    totalDividends: round(totalDividends, 2),
    totalTurnover: round(totalTurnover, 2),
  };
}

function drawdownCurve(curve: readonly EquityPoint[]): DrawdownPoint[] {
  const values = drawdownSeries(curve.map((point) => point.equity));
  return curve.map((point, index) => ({
    date: point.date,
    drawdownPercent: round(values[index] ?? 0, 4),
  }));
}

function monthlyEquityReturns(
  curve: readonly EquityPoint[],
  initialCapital: number,
): BacktestMonthlyReturn[] {
  const lastByMonth = new Map<string, number>();
  for (const point of curve) {
    lastByMonth.set(point.date.slice(0, 7), point.equity);
  }
  const months = [...lastByMonth.keys()].sort();
  const result: BacktestMonthlyReturn[] = [];
  let previous = initialCapital;
  for (const month of months) {
    const current = lastByMonth.get(month)!;
    if (previous > 0) {
      result.push({
        month,
        returnPercent: round((current / previous - 1) * 100, 4),
      });
    }
    previous = current;
  }
  return result;
}

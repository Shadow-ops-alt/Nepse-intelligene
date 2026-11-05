import type { Candle } from "@stock/core";
import { analyzeCandles } from "./analysis";
import { quantProfile, type PatternBias, type SignalRating } from "./quant";

export type TradeSide = "buy" | "sell";

export interface TradeInput {
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  fees?: number;
  tradedAt: string;
}

export interface PriceSnapshot {
  symbol: string;
  price: number;
  asOf?: string | null;
}

export interface PortfolioPosition {
  symbol: string;
  quantity: number;
  /** Weighted average cost per share, including buy-side fees. */
  averageCost: number;
  costBasis: number;
  marketPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
  realizedPnl: number;
  firstTradeAt: string;
  lastTradeAt: string;
  quoteAsOf: string | null;
}

export interface PortfolioTotals {
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  pricedPositions: number;
  unpricedPositions: number;
}

export interface PortfolioResult {
  positions: PortfolioPosition[];
  totals: PortfolioTotals;
  warnings: string[];
}

interface WorkingPosition {
  symbol: string;
  quantity: number;
  costBasis: number;
  realizedPnl: number;
  firstTradeAt: string;
  lastTradeAt: string;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sortedTrades(trades: TradeInput[]): TradeInput[] {
  return [...trades].sort((a, b) => {
    const byDate = a.tradedAt.localeCompare(b.tradedAt);
    if (byDate !== 0) return byDate;
    // Buys before sells on the same timestamp keeps the ledger conservative.
    if (a.side === b.side) return 0;
    return a.side === "buy" ? -1 : 1;
  });
}

/**
 * Weighted-average-cost portfolio ledger.
 *
 * Buy fees are capitalised into the cost basis. Sell fees reduce realised
 * proceeds. Oversells are clamped to the held quantity and surfaced as a
 * warning instead of silently producing a negative position.
 */
export function computePortfolio(
  trades: TradeInput[],
  prices: PriceSnapshot[] = [],
): PortfolioResult {
  const warnings: string[] = [];
  const positions = new Map<string, WorkingPosition>();

  for (const trade of sortedTrades(trades)) {
    const symbol = trade.symbol.trim().toUpperCase();
    if (!symbol) continue;
    if (!Number.isFinite(trade.quantity) || trade.quantity <= 0) {
      warnings.push(`${symbol}: ignored a trade with non-positive quantity`);
      continue;
    }
    if (!Number.isFinite(trade.price) || trade.price < 0) {
      warnings.push(`${symbol}: ignored a trade with an invalid price`);
      continue;
    }

    const fees = Number.isFinite(trade.fees) ? Math.max(0, trade.fees ?? 0) : 0;
    const existing = positions.get(symbol) ?? {
      symbol,
      quantity: 0,
      costBasis: 0,
      realizedPnl: 0,
      firstTradeAt: trade.tradedAt,
      lastTradeAt: trade.tradedAt,
    };
    existing.firstTradeAt =
      trade.tradedAt < existing.firstTradeAt
        ? trade.tradedAt
        : existing.firstTradeAt;
    existing.lastTradeAt =
      trade.tradedAt > existing.lastTradeAt
        ? trade.tradedAt
        : existing.lastTradeAt;

    if (trade.side === "buy") {
      existing.quantity += trade.quantity;
      existing.costBasis += trade.quantity * trade.price + fees;
    } else {
      const sellQuantity = Math.min(trade.quantity, existing.quantity);
      if (sellQuantity < trade.quantity) {
        warnings.push(
          `${symbol}: sell of ${trade.quantity} exceeded the held ${existing.quantity}; clamped to ${sellQuantity}`,
        );
      }
      if (sellQuantity > 0) {
        const averageCost =
          existing.quantity > 0 ? existing.costBasis / existing.quantity : 0;
        existing.realizedPnl +=
          sellQuantity * trade.price - fees - sellQuantity * averageCost;
        existing.quantity -= sellQuantity;
        existing.costBasis -= sellQuantity * averageCost;
        if (existing.quantity <= 1e-9) {
          existing.quantity = 0;
          existing.costBasis = 0;
        }
      }
    }

    positions.set(symbol, existing);
  }

  const priceBySymbol = new Map(
    prices.map((price) => [price.symbol.toUpperCase(), price]),
  );

  let costBasisTotal = 0;
  let pricedCostBasis = 0;
  let marketValueTotal = 0;
  let realizedTotal = 0;
  let pricedPositions = 0;
  let unpricedPositions = 0;

  const result: PortfolioPosition[] = [...positions.values()]
    .filter((position) => position.quantity > 1e-9 || position.realizedPnl !== 0)
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((position) => {
      const price = priceBySymbol.get(position.symbol);
      const marketPrice = price && Number.isFinite(price.price) ? price.price : null;
      const marketValue =
        marketPrice === null ? null : marketPrice * position.quantity;
      const averageCost =
        position.quantity > 0 ? position.costBasis / position.quantity : 0;
      const unrealizedPnl =
        marketValue === null ? null : marketValue - position.costBasis;
      const unrealizedPnlPercent =
        unrealizedPnl === null || position.costBasis === 0
          ? null
          : (unrealizedPnl / position.costBasis) * 100;

      if (position.quantity > 0) {
        costBasisTotal += position.costBasis;
        realizedTotal += position.realizedPnl;
        if (marketValue === null) {
          unpricedPositions += 1;
        } else {
          marketValueTotal += marketValue;
          pricedCostBasis += position.costBasis;
          pricedPositions += 1;
        }
      } else {
        realizedTotal += position.realizedPnl;
      }

      return {
        symbol: position.symbol,
        quantity: round(position.quantity, 4),
        averageCost: round(averageCost, 4),
        costBasis: round(position.costBasis),
        marketPrice: marketPrice === null ? null : round(marketPrice),
        marketValue: marketValue === null ? null : round(marketValue),
        unrealizedPnl: unrealizedPnl === null ? null : round(unrealizedPnl),
        unrealizedPnlPercent:
          unrealizedPnlPercent === null ? null : round(unrealizedPnlPercent),
        realizedPnl: round(position.realizedPnl),
        firstTradeAt: position.firstTradeAt,
        lastTradeAt: position.lastTradeAt,
        quoteAsOf: price?.asOf ?? null,
      };
    });

  if (unpricedPositions > 0) {
    warnings.push(
      `${unpricedPositions} open position${unpricedPositions === 1 ? " has" : "s have"} no stored quote; market value and unrealised P&L exclude them`,
    );
  }

  const unrealizedTotal = marketValueTotal - pricedCostBasis;

  return {
    positions: result,
    totals: {
      costBasis: round(costBasisTotal),
      marketValue: round(marketValueTotal),
      unrealizedPnl: round(unrealizedTotal),
      realizedPnl: round(realizedTotal),
      totalPnl: round(unrealizedTotal + realizedTotal),
      pricedPositions,
      unpricedPositions,
    },
    warnings,
  };
}

export interface ScreenerRow {
  symbol: string;
  from: string | null;
  to: string | null;
  observations: number;
  lastClose: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  rsi14: number | null;
  high52w: number | null;
  low52w: number | null;
  returnPercent: number | null;
  averageVolume20: number | null;
  volumeRatio: number | null;
  /** Percent distance below the 52-week high (0 at the high). */
  distanceFromHigh52w: number | null;
  aboveSma20: boolean | null;
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
  trend: "up" | "down" | "sideways" | null;
  rsiZone: "oversold" | "neutral" | "overbought" | null;
  /** Calendar-window returns (percent); null when history is too short. */
  return1M: number | null;
  return3M: number | null;
  return1Y: number | null;
  /** Annualised volatility of the last ~63 sessions, percent. */
  volatility3M: number | null;
  /** ATR 14 as a percent of the last close. */
  atrPercent: number | null;
  macdHistogram: number | null;
  macdState: "bullish" | "bearish" | null;
  /** Worst peak-to-trough decline over the last year, negative percent. */
  maxDrawdown1Y: number | null;
  /** Where the close sits in the 52-week range: 0 = low, 100 = high. */
  position52w: number | null;
  /** Most recent SMA 50/200 crossover within 20 sessions. */
  cross: { type: "golden" | "death"; sessionsAgo: number } | null;
  /** Candlestick pattern(s) completed on the last stored session. */
  patterns: Array<{ id: string; name: string; bias: PatternBias }>;
  signalScore: number | null;
  signalRating: SignalRating | null;
}

/**
 * Extends the shared indicators with screener-specific rollups. Kept pure so
 * the same function works in the API, tests, and a future export.
 */
export function screenCandles(candles: Candle[]): ScreenerRow {
  const sorted = [...candles].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const analysis = analyzeCandles(sorted);
  const lastClose = analysis.lastClose;
  const sma20 = analysis.sma20;
  const sma50 = analysis.sma50;
  const sma200 = analysis.sma200;
  const rsi14 = analysis.rsi14;

  const recentVolumes = sorted.slice(-20).map((candle) => candle.volume);
  const averageVolume20 =
    recentVolumes.length > 0
      ? recentVolumes.reduce((sum, value) => sum + value, 0) /
        recentVolumes.length
      : null;
  const lastVolume = sorted.at(-1)?.volume ?? null;

  let trend: ScreenerRow["trend"] = null;
  if (sma20 !== null && sma50 !== null && sma200 !== null) {
    if (sma20 > sma50 && sma50 > sma200) trend = "up";
    else if (sma20 < sma50 && sma50 < sma200) trend = "down";
    else trend = "sideways";
  }

  const quant = quantProfile(sorted);

  return {
    ...analysis,
    averageVolume20:
      averageVolume20 === null ? null : round(averageVolume20, 0),
    volumeRatio:
      averageVolume20 && lastVolume !== null
        ? round(lastVolume / averageVolume20)
        : null,
    distanceFromHigh52w:
      analysis.high52w && lastClose !== null
        ? round(((lastClose - analysis.high52w) / analysis.high52w) * 100)
        : null,
    aboveSma20: sma20 === null || lastClose === null ? null : lastClose > sma20,
    aboveSma50: sma50 === null || lastClose === null ? null : lastClose > sma50,
    aboveSma200:
      sma200 === null || lastClose === null ? null : lastClose > sma200,
    trend,
    rsiZone:
      rsi14 === null
        ? null
        : rsi14 < 30
          ? "oversold"
          : rsi14 > 70
            ? "overbought"
            : "neutral",
    return1M: quant.returns["1M"],
    return3M: quant.returns["3M"],
    return1Y: quant.returns["1Y"],
    volatility3M: quant.volatility3M,
    atrPercent: quant.atrPercent,
    macdHistogram: quant.macdHistogram,
    macdState:
      quant.macdHistogram === null
        ? null
        : quant.macdHistogram >= 0
          ? "bullish"
          : "bearish",
    maxDrawdown1Y: quant.maxDrawdown1Y,
    position52w: quant.position52w,
    cross: quant.cross
      ? { type: quant.cross.type, sessionsAgo: quant.cross.sessionsAgo }
      : null,
    patterns: quant.lastPatterns.map(({ id, name, bias }) => ({ id, name, bias })),
    signalScore: quant.signals?.score ?? null,
    signalRating: quant.signals?.rating ?? null,
  };
}

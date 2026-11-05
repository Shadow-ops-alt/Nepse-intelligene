import type { Candle } from "@stock/core";
import { ema, rsi, sma } from "./analysis";

/**
 * Quantitative analytics computed purely from stored end-of-day candles.
 *
 * Everything in this module is DERIVED data: it is mathematics applied to the
 * unofficial EOD archive, never a substitute for a dataset the source does not
 * publish. Nothing here fetches, infers missing rows, or fills gaps. Callers
 * must label the output as derived research, not investment advice.
 */

type Series = Array<number | null>;

/**
 * The minimal OHLCV shape these functions need. Any candle-like object (the
 * core Candle, or the desktop's JSON copy of it) satisfies it.
 */
export type PriceBar = Pick<
  Candle,
  "timestamp" | "open" | "high" | "low" | "close" | "volume"
>;

const DAY_MS = 86_400_000;

function round(value: number | null | undefined, decimals = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function lastDefined(values: Series): number | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation (n - 1). Returns null for fewer than 2 values. */
export function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function sortCandles(candles: PriceBar[]): PriceBar[] {
  return [...candles].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function dayOf(candle: PriceBar): string {
  return candle.timestamp.slice(0, 10);
}

function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

// ---------------------------------------------------------------------------
// Bands and oscillators
// ---------------------------------------------------------------------------

export interface BollingerPoint {
  middle: number;
  upper: number;
  lower: number;
}

/**
 * Bollinger bands: SMA(period) ± k × population standard deviation of the
 * same window (Bollinger's original definition).
 */
export function bollinger(
  values: number[],
  period = 20,
  k = 2,
): Array<BollingerPoint | null> {
  if (period <= 0) throw new Error("period must be positive");
  const out = new Array<BollingerPoint | null>(values.length).fill(null);
  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    const middle = mean(window);
    const variance =
      window.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period;
    const deviation = Math.sqrt(variance);
    out[index] = {
      middle,
      upper: middle + k * deviation,
      lower: middle - k * deviation,
    };
  }
  return out;
}

export interface MacdSeries {
  macd: Series;
  signal: Series;
  histogram: Series;
}

/**
 * MACD line = EMA(fast) − EMA(slow); signal = EMA(signalPeriod) of the MACD
 * line, seeded once the MACD line exists; histogram = MACD − signal.
 */
export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdSeries {
  if (fast >= slow) throw new Error("fast period must be shorter than slow");
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line: Series = values.map((_, index) => {
    const a = fastEma[index];
    const b = slowEma[index];
    return a === null || a === undefined || b === null || b === undefined
      ? null
      : a - b;
  });

  const start = line.findIndex((value) => value !== null);
  const signal: Series = new Array<number | null>(values.length).fill(null);
  if (start >= 0) {
    const defined = line.slice(start).map((value) => value ?? 0);
    const smoothed = ema(defined, signalPeriod);
    smoothed.forEach((value, offset) => {
      signal[start + offset] = value;
    });
  }

  const histogram: Series = line.map((value, index) => {
    const s = signal[index];
    return value === null || s === null || s === undefined ? null : value - s;
  });

  return { macd: line, signal, histogram };
}

/** True range. The first candle has no previous close, so it uses high − low. */
export function trueRange(candles: PriceBar[]): number[] {
  return candles.map((candle, index) => {
    const previous = candles[index - 1];
    if (!previous) return candle.high - candle.low;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close),
    );
  });
}

/** Wilder's average true range, seeded with the simple mean of the first period. */
export function atr(candles: PriceBar[], period = 14): Series {
  if (period <= 0) throw new Error("period must be positive");
  const ranges = trueRange(candles);
  const out: Series = new Array<number | null>(candles.length).fill(null);
  if (ranges.length < period) return out;
  let current = mean(ranges.slice(0, period));
  out[period - 1] = current;
  for (let index = period; index < ranges.length; index += 1) {
    current = (current * (period - 1) + ranges[index]!) / period;
    out[index] = current;
  }
  return out;
}

export interface StochasticSeries {
  k: Series;
  d: Series;
}

/** Slow-free stochastic oscillator: %K over kPeriod, %D = SMA(dPeriod) of %K. */
export function stochastic(
  candles: PriceBar[],
  kPeriod = 14,
  dPeriod = 3,
): StochasticSeries {
  const k: Series = new Array<number | null>(candles.length).fill(null);
  for (let index = kPeriod - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - kPeriod + 1, index + 1);
    const highest = Math.max(...window.map((candle) => candle.high));
    const lowest = Math.min(...window.map((candle) => candle.low));
    const range = highest - lowest;
    k[index] = range === 0 ? 50 : ((candles[index]!.close - lowest) / range) * 100;
  }
  const start = k.findIndex((value) => value !== null);
  const d: Series = new Array<number | null>(candles.length).fill(null);
  if (start >= 0) {
    const smoothed = sma(
      k.slice(start).map((value) => value ?? 0),
      dPeriod,
    );
    smoothed.forEach((value, offset) => {
      d[start + offset] = value;
    });
  }
  return { k, d };
}

// ---------------------------------------------------------------------------
// Returns and risk
// ---------------------------------------------------------------------------

/** Natural-log daily returns; length is values.length − 1. Non-positive prices are skipped. */
export function logReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]!;
    const current = values[index]!;
    if (previous > 0 && current > 0) out.push(Math.log(current / previous));
  }
  return out;
}

/**
 * Trading sessions per year, measured from the series itself instead of
 * assuming a foreign-market 252. Uses the trailing 365 calendar days when the
 * series covers them, otherwise scales the observed density. Falls back to
 * 240 when the series is too short to measure.
 */
export function sessionsPerYear(candles: PriceBar[]): number {
  const sorted = sortCandles(candles);
  const last = sorted.at(-1);
  const first = sorted[0];
  if (!last || !first || sorted.length < 20) return 240;
  const lastMs = dayMs(dayOf(last));
  const spanDays = (lastMs - dayMs(dayOf(first))) / DAY_MS;
  if (spanDays >= 365) {
    const cutoff = lastMs - 365 * DAY_MS;
    const count = sorted.filter((candle) => dayMs(dayOf(candle)) > cutoff).length;
    return Math.min(300, Math.max(150, count));
  }
  if (spanDays < 30) return 240;
  const scaled = (sorted.length / spanDays) * 365;
  return Math.min(300, Math.max(150, Math.round(scaled)));
}

/** Annualised volatility (percent) of the last `window` log returns. */
export function annualizedVolatility(
  values: number[],
  window: number,
  periodsPerYear: number,
): number | null {
  const returns = logReturns(values).slice(-window);
  if (returns.length < Math.min(window, 20)) return null;
  const deviation = stdev(returns);
  if (deviation === null) return null;
  return deviation * Math.sqrt(periodsPerYear) * 100;
}

export interface DrawdownResult {
  /** Most negative peak-to-trough move, as a negative percent (0 if none). */
  maxDrawdownPercent: number;
  peakIndex: number;
  troughIndex: number;
  /** Current distance below the running peak, as a negative percent. */
  currentDrawdownPercent: number;
}

export function maxDrawdown(values: number[]): DrawdownResult | null {
  if (values.length < 2) return null;
  let peak = values[0]!;
  let peakIndex = 0;
  let worst = 0;
  let worstPeak = 0;
  let worstTrough = 0;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]!;
    if (value > peak) {
      peak = value;
      peakIndex = index;
    }
    const drawdown = peak > 0 ? (value - peak) / peak : 0;
    if (drawdown < worst) {
      worst = drawdown;
      worstPeak = peakIndex;
      worstTrough = index;
    }
  }
  const last = values.at(-1)!;
  return {
    maxDrawdownPercent: worst * 100,
    peakIndex: worstPeak,
    troughIndex: worstTrough,
    currentDrawdownPercent: peak > 0 ? ((last - peak) / peak) * 100 : 0,
  };
}

/** Percent below the running maximum at every point (0 at new highs). */
export function drawdownSeries(values: number[]): number[] {
  let peak = -Infinity;
  return values.map((value) => {
    peak = Math.max(peak, value);
    return peak > 0 ? ((value - peak) / peak) * 100 : 0;
  });
}

export interface RelativeRisk {
  beta: number;
  correlation: number;
  observations: number;
}

/**
 * Beta and Pearson correlation of daily simple returns against a benchmark
 * (normally the NEPSE index), using only dates present in both series. Returns
 * are taken between consecutive common dates; nothing is interpolated.
 */
export function relativeRisk(
  asset: PriceBar[],
  benchmark: PriceBar[],
  window = 250,
  minimumObservations = 30,
): RelativeRisk | null {
  const benchmarkByDay = new Map(
    benchmark.map((candle) => [dayOf(candle), candle.close]),
  );
  const aligned = sortCandles(asset)
    .map((candle) => ({
      asset: candle.close,
      benchmark: benchmarkByDay.get(dayOf(candle)),
    }))
    .filter(
      (point): point is { asset: number; benchmark: number } =>
        point.benchmark !== undefined && point.asset > 0 && point.benchmark > 0,
    );

  const assetReturns: number[] = [];
  const benchmarkReturns: number[] = [];
  for (let index = 1; index < aligned.length; index += 1) {
    const previous = aligned[index - 1]!;
    const current = aligned[index]!;
    assetReturns.push(current.asset / previous.asset - 1);
    benchmarkReturns.push(current.benchmark / previous.benchmark - 1);
  }

  const a = assetReturns.slice(-window);
  const b = benchmarkReturns.slice(-window);
  if (a.length < minimumObservations) return null;

  const meanA = mean(a);
  const meanB = mean(b);
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const da = a[index]! - meanA;
    const db = b[index]! - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (varianceB === 0 || varianceA === 0) return null;
  return {
    beta: covariance / varianceB,
    correlation: covariance / Math.sqrt(varianceA * varianceB),
    observations: a.length,
  };
}

/** Pearson correlation of aligned daily returns for two equity series. */
export function returnCorrelation(
  a: PriceBar[],
  b: PriceBar[],
  window = 250,
): number | null {
  return relativeRisk(a, b, window, 20)?.correlation ?? null;
}

export type ReturnPeriod = "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y";

const PERIOD_DAYS: Record<Exclude<ReturnPeriod, "YTD">, number> = {
  "1W": 7,
  "1M": 30,
  "3M": 91,
  "6M": 182,
  "1Y": 365,
  "3Y": 365 * 3,
  "5Y": 365 * 5,
};

/**
 * Point-to-point percent returns over calendar windows. The base is the last
 * stored close on or before the window start; if the series does not reach
 * back that far, the period is null rather than silently shortened. 3Y and 5Y
 * are cumulative, not annualised.
 */
export function periodReturns(
  candles: PriceBar[],
): Record<ReturnPeriod, number | null> {
  const sorted = sortCandles(candles);
  const result = {} as Record<ReturnPeriod, number | null>;
  const last = sorted.at(-1);
  const keys: ReturnPeriod[] = ["1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y"];
  if (!last || last.close <= 0) {
    for (const key of keys) result[key] = null;
    return result;
  }
  const lastMs = dayMs(dayOf(last));

  const baseOnOrBefore = (cutoffMs: number): number | null => {
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const candle = sorted[index]!;
      if (dayMs(dayOf(candle)) <= cutoffMs) {
        return candle.close > 0 ? candle.close : null;
      }
    }
    return null;
  };

  for (const key of keys) {
    let base: number | null;
    if (key === "YTD") {
      const yearStart = Date.UTC(new Date(lastMs).getUTCFullYear(), 0, 1);
      base = baseOnOrBefore(yearStart - DAY_MS);
    } else {
      base = baseOnOrBefore(lastMs - PERIOD_DAYS[key] * DAY_MS);
    }
    result[key] = base === null ? null : round((last.close / base - 1) * 100);
  }
  return result;
}

export interface MonthlyReturn {
  year: number;
  /** 1–12 */
  month: number;
  returnPercent: number | null;
}

/**
 * Month-over-month returns from month-end closes. A month whose previous
 * calendar month has no stored session is null; gaps are never bridged.
 */
export function monthlyReturns(candles: PriceBar[]): MonthlyReturn[] {
  const lastCloseByMonth = new Map<string, number>();
  for (const candle of sortCandles(candles)) {
    lastCloseByMonth.set(candle.timestamp.slice(0, 7), candle.close);
  }
  const months = [...lastCloseByMonth.keys()].sort();
  return months.map((key) => {
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(5, 7));
    const previousKey =
      month === 1
        ? `${year - 1}-12`
        : `${year}-${String(month - 1).padStart(2, "0")}`;
    const previous = lastCloseByMonth.get(previousKey);
    const current = lastCloseByMonth.get(key)!;
    return {
      year,
      month,
      returnPercent:
        previous && previous > 0 ? round((current / previous - 1) * 100) : null,
    };
  });
}

export interface PivotLevels {
  pivot: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
}

/** Classic floor-trader pivots from one session's high, low and close. */
export function pivotPoints(candle: Pick<PriceBar, "high" | "low" | "close">): PivotLevels {
  const { high, low, close } = candle;
  const pivot = (high + low + close) / 3;
  return {
    pivot,
    r1: 2 * pivot - low,
    s1: 2 * pivot - high,
    r2: pivot + (high - low),
    s2: pivot - (high - low),
    r3: high + 2 * (pivot - low),
    s3: low - 2 * (high - pivot),
  };
}

// ---------------------------------------------------------------------------
// Candlestick patterns
// ---------------------------------------------------------------------------

export type PatternBias = "bullish" | "bearish" | "neutral";

export interface CandlePattern {
  id: string;
  name: string;
  bias: PatternBias;
  /** Number of sessions the pattern spans (1–3). */
  span: number;
}

export interface PatternHit extends CandlePattern {
  index: number;
  timestamp: string;
}

interface Shape {
  open: number;
  close: number;
  high: number;
  low: number;
  body: number;
  range: number;
  upper: number;
  lower: number;
  bullish: boolean;
  bearish: boolean;
}

function shape(candle: PriceBar): Shape {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  return {
    open: candle.open,
    close: candle.close,
    high: candle.high,
    low: candle.low,
    body,
    range,
    upper: candle.high - Math.max(candle.open, candle.close),
    lower: Math.min(candle.open, candle.close) - candle.low,
    bullish: candle.close > candle.open,
    bearish: candle.close < candle.open,
  };
}

/**
 * Prior trend from the slope of closes over the `lookback` sessions before
 * `index`: compares the mean of the earlier half with the later half.
 */
function priorTrend(
  candles: PriceBar[],
  index: number,
  lookback = 6,
): "up" | "down" | "flat" {
  if (index < lookback) return "flat";
  const window = candles
    .slice(index - lookback, index)
    .map((candle) => candle.close);
  const half = Math.floor(window.length / 2);
  const early = mean(window.slice(0, half));
  const late = mean(window.slice(half));
  if (early === 0) return "flat";
  const change = (late - early) / early;
  if (change > 0.01) return "up";
  if (change < -0.01) return "down";
  return "flat";
}

const PATTERNS = {
  doji: { id: "doji", name: "Doji", bias: "neutral", span: 1 },
  dragonflyDoji: {
    id: "dragonfly-doji",
    name: "Dragonfly doji",
    bias: "bullish",
    span: 1,
  },
  gravestoneDoji: {
    id: "gravestone-doji",
    name: "Gravestone doji",
    bias: "bearish",
    span: 1,
  },
  hammer: { id: "hammer", name: "Hammer", bias: "bullish", span: 1 },
  hangingMan: { id: "hanging-man", name: "Hanging man", bias: "bearish", span: 1 },
  invertedHammer: {
    id: "inverted-hammer",
    name: "Inverted hammer",
    bias: "bullish",
    span: 1,
  },
  shootingStar: {
    id: "shooting-star",
    name: "Shooting star",
    bias: "bearish",
    span: 1,
  },
  bullishMarubozu: {
    id: "bullish-marubozu",
    name: "Bullish marubozu",
    bias: "bullish",
    span: 1,
  },
  bearishMarubozu: {
    id: "bearish-marubozu",
    name: "Bearish marubozu",
    bias: "bearish",
    span: 1,
  },
  spinningTop: { id: "spinning-top", name: "Spinning top", bias: "neutral", span: 1 },
  bullishEngulfing: {
    id: "bullish-engulfing",
    name: "Bullish engulfing",
    bias: "bullish",
    span: 2,
  },
  bearishEngulfing: {
    id: "bearish-engulfing",
    name: "Bearish engulfing",
    bias: "bearish",
    span: 2,
  },
  bullishHarami: {
    id: "bullish-harami",
    name: "Bullish harami",
    bias: "bullish",
    span: 2,
  },
  bearishHarami: {
    id: "bearish-harami",
    name: "Bearish harami",
    bias: "bearish",
    span: 2,
  },
  piercingLine: {
    id: "piercing-line",
    name: "Piercing line",
    bias: "bullish",
    span: 2,
  },
  darkCloudCover: {
    id: "dark-cloud-cover",
    name: "Dark cloud cover",
    bias: "bearish",
    span: 2,
  },
  morningStar: { id: "morning-star", name: "Morning star", bias: "bullish", span: 3 },
  eveningStar: { id: "evening-star", name: "Evening star", bias: "bearish", span: 3 },
  threeWhiteSoldiers: {
    id: "three-white-soldiers",
    name: "Three white soldiers",
    bias: "bullish",
    span: 3,
  },
  threeBlackCrows: {
    id: "three-black-crows",
    name: "Three black crows",
    bias: "bearish",
    span: 3,
  },
} satisfies Record<string, CandlePattern>;

export const CANDLE_PATTERNS: readonly CandlePattern[] = Object.values(PATTERNS);

/**
 * Detects classic candlestick patterns that complete on `index`. Geometry is
 * measured from the candle's own open/high/low/close; sessions with no range
 * (open = high = low = close, common for thinly traded scrips) never match.
 */
export function detectPatternsAt(candles: PriceBar[], index: number): CandlePattern[] {
  const current = candles[index];
  if (!current) return [];
  const c = shape(current);
  if (c.range <= 0) return [];

  const found: CandlePattern[] = [];
  const trend = priorTrend(candles, index);
  const isDoji = c.body <= 0.1 * c.range;
  const smallUpper = c.upper <= Math.max(0.1 * c.range, 0.5 * c.body);
  const smallLower = c.lower <= Math.max(0.1 * c.range, 0.5 * c.body);

  // --- single-candle shapes ------------------------------------------------
  if (isDoji) {
    if (c.upper <= 0.1 * c.range && c.lower >= 0.6 * c.range) {
      found.push(PATTERNS.dragonflyDoji);
    } else if (c.lower <= 0.1 * c.range && c.upper >= 0.6 * c.range) {
      found.push(PATTERNS.gravestoneDoji);
    } else {
      found.push(PATTERNS.doji);
    }
  } else {
    const longLower = c.lower >= 2 * c.body;
    const longUpper = c.upper >= 2 * c.body;
    if (longLower && smallUpper) {
      if (trend === "down") found.push(PATTERNS.hammer);
      else if (trend === "up") found.push(PATTERNS.hangingMan);
    } else if (longUpper && smallLower) {
      if (trend === "down") found.push(PATTERNS.invertedHammer);
      else if (trend === "up") found.push(PATTERNS.shootingStar);
    } else if (c.upper <= 0.05 * c.range && c.lower <= 0.05 * c.range) {
      found.push(c.bullish ? PATTERNS.bullishMarubozu : PATTERNS.bearishMarubozu);
    } else if (
      c.body <= 0.3 * c.range &&
      c.upper >= c.body &&
      c.lower >= c.body
    ) {
      found.push(PATTERNS.spinningTop);
    }
  }

  // --- two-candle patterns -------------------------------------------------
  const previousCandle = candles[index - 1];
  if (previousCandle) {
    const p = shape(previousCandle);
    const prevBodyTop = Math.max(p.open, p.close);
    const prevBodyBottom = Math.min(p.open, p.close);
    const bodyTop = Math.max(c.open, c.close);
    const bodyBottom = Math.min(c.open, c.close);
    const prevMid = (p.open + p.close) / 2;
    const prevLong = p.range > 0 && p.body >= 0.5 * p.range;

    if (
      p.bearish &&
      c.bullish &&
      c.open <= p.close &&
      c.close >= p.open &&
      c.body > p.body &&
      trend !== "up"
    ) {
      found.push(PATTERNS.bullishEngulfing);
    } else if (
      p.bullish &&
      c.bearish &&
      c.open >= p.close &&
      c.close <= p.open &&
      c.body > p.body &&
      trend !== "down"
    ) {
      found.push(PATTERNS.bearishEngulfing);
    } else if (
      prevLong &&
      p.bearish &&
      c.bullish &&
      bodyTop < prevBodyTop &&
      bodyBottom > prevBodyBottom &&
      c.body <= 0.5 * p.body
    ) {
      found.push(PATTERNS.bullishHarami);
    } else if (
      prevLong &&
      p.bullish &&
      c.bearish &&
      bodyTop < prevBodyTop &&
      bodyBottom > prevBodyBottom &&
      c.body <= 0.5 * p.body
    ) {
      found.push(PATTERNS.bearishHarami);
    } else if (
      prevLong &&
      p.bearish &&
      c.bullish &&
      c.open < p.close &&
      c.close > prevMid &&
      c.close < p.open
    ) {
      found.push(PATTERNS.piercingLine);
    } else if (
      prevLong &&
      p.bullish &&
      c.bearish &&
      c.open > p.close &&
      c.close < prevMid &&
      c.close > p.open
    ) {
      found.push(PATTERNS.darkCloudCover);
    }
  }

  // --- three-candle patterns -----------------------------------------------
  const first = candles[index - 2];
  const second = candles[index - 1];
  if (first && second) {
    const a = shape(first);
    const b = shape(second);
    const aLong = a.range > 0 && a.body >= 0.5 * a.range;
    const bSmall = b.body <= 0.3 * Math.max(a.body, 1e-9);
    const aMid = (a.open + a.close) / 2;

    if (aLong && a.bearish && bSmall && c.bullish && c.close > aMid) {
      found.push(PATTERNS.morningStar);
    } else if (aLong && a.bullish && bSmall && c.bearish && c.close < aMid) {
      found.push(PATTERNS.eveningStar);
    }

    const soldiers = [a, b, c].every(
      (s) => s.bullish && s.range > 0 && s.body >= 0.5 * s.range && s.upper <= 0.3 * s.body,
    );
    if (
      soldiers &&
      b.close > a.close &&
      c.close > b.close &&
      b.open >= a.open &&
      b.open <= a.close &&
      c.open >= b.open &&
      c.open <= b.close
    ) {
      found.push(PATTERNS.threeWhiteSoldiers);
    }
    const crows = [a, b, c].every(
      (s) => s.bearish && s.range > 0 && s.body >= 0.5 * s.range && s.lower <= 0.3 * s.body,
    );
    if (
      crows &&
      b.close < a.close &&
      c.close < b.close &&
      b.open <= a.open &&
      b.open >= a.close &&
      c.open <= b.open &&
      c.open >= b.close
    ) {
      found.push(PATTERNS.threeBlackCrows);
    }
  }

  return found;
}

/** All pattern hits over the last `lookback` sessions, newest last. */
export function scanPatterns(candles: PriceBar[], lookback = 120): PatternHit[] {
  const sorted = sortCandles(candles);
  const hits: PatternHit[] = [];
  const start = Math.max(0, sorted.length - lookback);
  for (let index = start; index < sorted.length; index += 1) {
    for (const pattern of detectPatternsAt(sorted, index)) {
      hits.push({ ...pattern, index, timestamp: sorted[index]!.timestamp });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Crosses and composite signal tally
// ---------------------------------------------------------------------------

export interface CrossEvent {
  type: "golden" | "death";
  index: number;
  sessionsAgo: number;
}

/** Most recent SMA(fast)/SMA(slow) crossover within `lookback` sessions. */
export function latestCross(
  values: number[],
  fast = 50,
  slow = 200,
  lookback = 20,
): CrossEvent | null {
  const f = sma(values, fast);
  const s = sma(values, slow);
  const last = values.length - 1;
  for (let index = last; index > Math.max(0, last - lookback); index -= 1) {
    const f0 = f[index - 1];
    const s0 = s[index - 1];
    const f1 = f[index];
    const s1 = s[index];
    if (
      f0 === null || f0 === undefined || s0 === null || s0 === undefined ||
      f1 === null || f1 === undefined || s1 === null || s1 === undefined
    ) {
      continue;
    }
    if (f0 <= s0 && f1 > s1) return { type: "golden", index, sessionsAgo: last - index };
    if (f0 >= s0 && f1 < s1) return { type: "death", index, sessionsAgo: last - index };
  }
  return null;
}

export type SignalVote = "bullish" | "bearish" | "neutral";

export interface SignalCheck {
  id: string;
  label: string;
  vote: SignalVote;
  detail: string;
}

export type SignalRating =
  | "strong-bullish"
  | "bullish"
  | "neutral"
  | "bearish"
  | "strong-bearish";

export interface SignalTally {
  rating: SignalRating;
  /** (bullish − bearish) / counted checks, in [−1, 1]. */
  score: number;
  bullish: number;
  bearish: number;
  neutral: number;
  checks: SignalCheck[];
}

function ratingFor(score: number): SignalRating {
  if (score >= 0.5) return "strong-bullish";
  if (score > 0.1) return "bullish";
  if (score <= -0.5) return "strong-bearish";
  if (score < -0.1) return "bearish";
  return "neutral";
}

/**
 * Transparent tally of standard technical conditions. Each check is shown
 * with its rule so the result is auditable; it is a summary of mathematics on
 * past prices, not a forecast or recommendation.
 */
export function signalTally(candles: PriceBar[]): SignalTally | null {
  const sorted = sortCandles(candles);
  if (sorted.length < 30) return null;
  const closes = sorted.map((candle) => candle.close);
  const close = closes.at(-1)!;
  const checks: SignalCheck[] = [];

  const fmt = (value: number) => value.toFixed(2);

  for (const period of [20, 50, 200]) {
    const average = lastDefined(sma(closes, period));
    if (average === null) continue;
    checks.push({
      id: `sma${period}`,
      label: `Close vs SMA ${period}`,
      vote: close > average ? "bullish" : close < average ? "bearish" : "neutral",
      detail: `${fmt(close)} vs ${fmt(average)}`,
    });
  }

  const sma50 = lastDefined(sma(closes, 50));
  const sma200 = lastDefined(sma(closes, 200));
  if (sma50 !== null && sma200 !== null) {
    checks.push({
      id: "sma50-200",
      label: "SMA 50 vs SMA 200",
      vote: sma50 > sma200 ? "bullish" : sma50 < sma200 ? "bearish" : "neutral",
      detail: `${fmt(sma50)} vs ${fmt(sma200)}`,
    });
  }

  const rsi14 = lastDefined(rsi(closes, 14));
  if (rsi14 !== null) {
    checks.push({
      id: "rsi14",
      label: "RSI 14 zone",
      vote: rsi14 < 30 ? "bullish" : rsi14 > 70 ? "bearish" : "neutral",
      detail: `${fmt(rsi14)} (oversold < 30, overbought > 70)`,
    });
  }

  const m = macd(closes);
  const line = lastDefined(m.macd);
  const signal = lastDefined(m.signal);
  if (line !== null && signal !== null) {
    checks.push({
      id: "macd",
      label: "MACD vs signal",
      vote: line > signal ? "bullish" : line < signal ? "bearish" : "neutral",
      detail: `${fmt(line)} vs ${fmt(signal)}`,
    });
  }

  const stoch = stochastic(sorted);
  const k = lastDefined(stoch.k);
  if (k !== null) {
    checks.push({
      id: "stoch",
      label: "Stochastic %K zone",
      vote: k < 20 ? "bullish" : k > 80 ? "bearish" : "neutral",
      detail: `${fmt(k)} (oversold < 20, overbought > 80)`,
    });
  }

  const band = bollinger(closes).at(-1);
  if (band) {
    checks.push({
      id: "bollinger",
      label: "Bollinger position",
      vote:
        close < band.lower ? "bullish" : close > band.upper ? "bearish" : "neutral",
      detail: `${fmt(band.lower)} – ${fmt(band.upper)}`,
    });
  }

  if (checks.length === 0) return null;
  const bullish = checks.filter((check) => check.vote === "bullish").length;
  const bearish = checks.filter((check) => check.vote === "bearish").length;
  const neutral = checks.length - bullish - bearish;
  const score = (bullish - bearish) / checks.length;
  return {
    rating: ratingFor(score),
    score: Math.round(score * 100) / 100,
    bullish,
    bearish,
    neutral,
    checks,
  };
}

// ---------------------------------------------------------------------------
// One-shot quantitative profile for a single series
// ---------------------------------------------------------------------------

export interface QuantProfile {
  sessionsPerYear: number;
  returns: Record<ReturnPeriod, number | null>;
  volatility1M: number | null;
  volatility3M: number | null;
  volatility1Y: number | null;
  maxDrawdown1Y: number | null;
  maxDrawdownAll: number | null;
  currentDrawdown: number | null;
  atr14: number | null;
  atrPercent: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  stochasticK: number | null;
  stochasticD: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  bollingerPercentB: number | null;
  position52w: number | null;
  pivots: PivotLevels | null;
  cross: CrossEvent | null;
  patterns: PatternHit[];
  lastPatterns: CandlePattern[];
  signals: SignalTally | null;
}

export function quantProfile(candles: PriceBar[]): QuantProfile {
  const sorted = sortCandles(candles);
  const closes = sorted.map((candle) => candle.close);
  const perYear = sessionsPerYear(sorted);
  const yearWindow = closes.slice(-perYear);
  const lastClose = closes.at(-1) ?? null;
  const lastCandle = sorted.at(-1) ?? null;

  const atrValue = lastDefined(atr(sorted, 14));
  const m = macd(closes);
  const stoch = stochastic(sorted);
  const band = bollinger(closes).at(-1) ?? null;
  const window52 = sorted.slice(-perYear);
  const high = window52.length ? Math.max(...window52.map((c) => c.high)) : null;
  const low = window52.length ? Math.min(...window52.map((c) => c.low)) : null;
  const patterns = scanPatterns(sorted, 120);
  const lastIndex = sorted.length - 1;

  return {
    sessionsPerYear: perYear,
    returns: periodReturns(sorted),
    volatility1M: round(annualizedVolatility(closes, 21, perYear)),
    volatility3M: round(annualizedVolatility(closes, 63, perYear)),
    volatility1Y: round(annualizedVolatility(closes, perYear, perYear)),
    maxDrawdown1Y: round(maxDrawdown(yearWindow)?.maxDrawdownPercent),
    maxDrawdownAll: round(maxDrawdown(closes)?.maxDrawdownPercent),
    currentDrawdown: round(maxDrawdown(closes)?.currentDrawdownPercent),
    atr14: round(atrValue),
    atrPercent:
      atrValue !== null && lastClose ? round((atrValue / lastClose) * 100) : null,
    macd: round(lastDefined(m.macd), 4),
    macdSignal: round(lastDefined(m.signal), 4),
    macdHistogram: round(lastDefined(m.histogram), 4),
    stochasticK: round(lastDefined(stoch.k)),
    stochasticD: round(lastDefined(stoch.d)),
    bollingerUpper: round(band?.upper),
    bollingerLower: round(band?.lower),
    bollingerPercentB:
      band && lastClose !== null && band.upper !== band.lower
        ? round(((lastClose - band.lower) / (band.upper - band.lower)) * 100)
        : null,
    position52w:
      high !== null && low !== null && lastClose !== null && high > low
        ? round(((lastClose - low) / (high - low)) * 100)
        : null,
    pivots: lastCandle ? roundPivots(pivotPoints(lastCandle)) : null,
    cross: latestCross(closes),
    patterns,
    lastPatterns: patterns
      .filter((hit) => hit.index === lastIndex)
      .map(({ id, name, bias, span }) => ({ id, name, bias, span })),
    signals: signalTally(sorted),
  };
}

function roundPivots(levels: PivotLevels): PivotLevels {
  return {
    pivot: round(levels.pivot)!,
    r1: round(levels.r1)!,
    r2: round(levels.r2)!,
    r3: round(levels.r3)!,
    s1: round(levels.s1)!,
    s2: round(levels.s2)!,
    s3: round(levels.s3)!,
  };
}

// ---------------------------------------------------------------------------
// Cross-sectional (market) statistics from end-of-day quotes
// ---------------------------------------------------------------------------

export interface BreadthInput {
  symbol: string;
  changePercent: number;
}

export interface Breadth {
  total: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  /** advancers / decliners; null when there are no decliners. */
  advanceDeclineRatio: number | null;
  meanChangePercent: number | null;
  medianChangePercent: number | null;
}

export function breadth(rows: BreadthInput[]): Breadth {
  const changes = rows
    .map((row) => row.changePercent)
    .filter((value) => Number.isFinite(value));
  const advancers = changes.filter((value) => value > 0).length;
  const decliners = changes.filter((value) => value < 0).length;
  const sorted = [...changes].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[middle]!
        : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return {
    total: changes.length,
    advancers,
    decliners,
    unchanged: changes.length - advancers - decliners,
    advanceDeclineRatio: decliners === 0 ? null : round(advancers / decliners),
    meanChangePercent: changes.length ? round(mean(changes)) : null,
    medianChangePercent: round(median),
  };
}

export interface SectorBreadth extends Breadth {
  sector: string;
}

/**
 * Equal-weighted per-sector breadth from EOD quotes. This is NOT an official
 * sector sub-index (those need market capitalisation weights the source does
 * not publish); it is the plain average of stored members' daily changes.
 */
export function sectorBreadth(
  rows: BreadthInput[],
  sectorOf: (symbol: string) => string | undefined,
): SectorBreadth[] {
  const groups = new Map<string, BreadthInput[]>();
  for (const row of rows) {
    const sector = sectorOf(row.symbol) ?? "Unclassified";
    const list = groups.get(sector) ?? [];
    list.push(row);
    groups.set(sector, list);
  }
  return [...groups.entries()]
    .map(([sector, members]) => ({ sector, ...breadth(members) }))
    .sort(
      (a, b) => (b.meanChangePercent ?? -Infinity) - (a.meanChangePercent ?? -Infinity),
    );
}

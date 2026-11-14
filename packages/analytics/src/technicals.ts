import { ema, rsi, sma } from "./analysis";
import { atr, macd, trueRange, type PriceBar } from "./quant";

/**
 * Chart-study technicals computed purely from stored end-of-day candles.
 *
 * Conventions shared by every function here:
 * - Input candles are sorted ascending by timestamp defensively; every index
 *   in an output refers to that ascending order.
 * - Series outputs are aligned to the input index and hold `null` during
 *   warm-up. Nothing is interpolated: a missing session is simply absent, and
 *   an untraded session (open = high = low = close) is used as stored.
 * - All output is DERIVED research from past prices, not a forecast or advice.
 */

type Series = Array<number | null>;

const DAY_MS = 86_400_000;

/** Returns the candles in ascending timestamp order, copying only if needed. */
function ascending<T extends PriceBar>(candles: readonly T[]): T[] {
  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index - 1]!.timestamp.localeCompare(candles[index]!.timestamp) > 0) {
      return [...candles].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }
  }
  return candles as T[];
}

function nulls(length: number): Series {
  return new Array<number | null>(length).fill(null);
}

function isNum(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function dayMs(candle: PriceBar): number {
  return Date.parse(`${candle.timestamp.slice(0, 10)}T00:00:00Z`);
}

function fmt(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

function requirePositive(value: number, name: string): void {
  if (!(value > 0)) throw new Error(`${name} must be positive`);
}

/** Midpoint of the highest high and lowest low over the trailing `period` sessions. */
function donchianMid(candles: PriceBar[], period: number): Series {
  const out = nulls(candles.length);
  for (let index = period - 1; index < candles.length; index += 1) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = index - period + 1; j <= index; j += 1) {
      const candle = candles[j]!;
      if (candle.high > highest) highest = candle.high;
      if (candle.low < lowest) lowest = candle.low;
    }
    out[index] = (highest + lowest) / 2;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trend overlays
// ---------------------------------------------------------------------------

export interface SupertrendResult {
  /** The active band: final lower band in an uptrend, final upper band in a downtrend. */
  value: Series;
  /** 1 = uptrend (close above the line), −1 = downtrend. */
  direction: Array<1 | -1 | null>;
}

/**
 * Supertrend on hl2 = (high + low) / 2 with Wilder ATR(period):
 * basic upper/lower = hl2 ± multiplier × ATR. Final bands carry over:
 * final upper = basic upper if it is lower than the previous final upper or the
 * previous close closed above it, else the previous final upper (mirror for the
 * lower band). An uptrend flips down when the close falls below the final lower
 * band; a downtrend flips up when the close rises above the final upper band.
 * The first defined session (index period − 1) starts as an uptrend when its
 * close is at or above hl2, otherwise as a downtrend.
 */
export function supertrend(
  candles: readonly PriceBar[],
  period = 10,
  multiplier = 3,
): SupertrendResult {
  const sorted = ascending(candles);
  const ranges = atr(sorted, period);
  const value = nulls(sorted.length);
  const direction = new Array<1 | -1 | null>(sorted.length).fill(null);

  let upper = 0;
  let lower = 0;
  let trend: 1 | -1 = 1;
  let started = false;
  for (let index = 0; index < sorted.length; index += 1) {
    const range = ranges[index];
    if (!isNum(range)) continue;
    const candle = sorted[index]!;
    const hl2 = (candle.high + candle.low) / 2;
    const basicUpper = hl2 + multiplier * range;
    const basicLower = hl2 - multiplier * range;
    if (!started) {
      upper = basicUpper;
      lower = basicLower;
      trend = candle.close >= hl2 ? 1 : -1;
      started = true;
    } else {
      const previousClose = sorted[index - 1]!.close;
      upper = basicUpper < upper || previousClose > upper ? basicUpper : upper;
      lower = basicLower > lower || previousClose < lower ? basicLower : lower;
      if (trend === 1 && candle.close < lower) trend = -1;
      else if (trend === -1 && candle.close > upper) trend = 1;
    }
    direction[index] = trend;
    value[index] = trend === 1 ? lower : upper;
  }
  return { value, direction };
}

export interface IchimokuResult {
  /** Tenkan-sen: Donchian midpoint over `conversion` sessions. */
  conversion: Series;
  /** Kijun-sen: Donchian midpoint over `base` sessions. */
  base: Series;
  /** Senkou span A = (conversion + base) / 2, NOT shifted: plot `displacement` sessions ahead. */
  spanA: Series;
  /** Senkou span B = Donchian midpoint over `spanB` sessions, NOT shifted: plot `displacement` sessions ahead. */
  spanB: Series;
  /** Chikou span = close, NOT shifted: plot `displacement` sessions behind. */
  lagging: Series;
  displacement: number;
}

/**
 * Ichimoku Kinko Hyo. Every series is aligned to the input index WITHOUT the
 * customary shift, so value i is computed from sessions up to and including i.
 * To draw the cloud, plot spanA[i] / spanB[i] at session i + displacement
 * (future sessions beyond the data are not invented here); plot lagging[i] at
 * session i − displacement.
 */
export function ichimoku(
  candles: readonly PriceBar[],
  conversion = 9,
  base = 26,
  spanB = 52,
  displacement = 26,
): IchimokuResult {
  requirePositive(conversion, "conversion period");
  requirePositive(base, "base period");
  requirePositive(spanB, "span B period");
  const sorted = ascending(candles);
  const tenkan = donchianMid(sorted, conversion);
  const kijun = donchianMid(sorted, base);
  const spanA: Series = tenkan.map((value, index) => {
    const other = kijun[index];
    return isNum(value) && isNum(other) ? (value + other) / 2 : null;
  });
  return {
    conversion: tenkan,
    base: kijun,
    spanA,
    spanB: donchianMid(sorted, spanB),
    lagging: sorted.map((candle) => candle.close),
    displacement,
  };
}

export interface ParabolicSarPoint {
  /** SAR plotted at this session (below the bar in an uptrend, above in a downtrend). */
  value: number;
  trend: 1 | -1;
}

/**
 * Wilder's parabolic SAR (TA-Lib conventions). Index 0 is null. The initial
 * trend is short only when session 1 has a larger down move (low₀ − low₁) than
 * up move (high₁ − high₀); the first SAR is then high₀ (short) or low₀ (long).
 * SARₙ₊₁ = SARₙ + AF × (EP − SARₙ), clamped so it never enters the prior two
 * sessions' range. AF starts at `step`, rises by `step` on each new extreme up
 * to `max`. A reversal needs the low (high) to trade STRICTLY through the SAR,
 * so untraded flat sessions never flip it; on a reversal the session's SAR is
 * the prior extreme point.
 */
export function parabolicSar(
  candles: readonly PriceBar[],
  step = 0.02,
  max = 0.2,
): Array<ParabolicSarPoint | null> {
  const sorted = ascending(candles);
  const out = new Array<ParabolicSarPoint | null>(sorted.length).fill(null);
  if (sorted.length < 2) return out;

  const first = sorted[0]!;
  const second = sorted[1]!;
  const upMove = second.high - first.high;
  const downMove = first.low - second.low;
  let trend: 1 | -1 = downMove > upMove && downMove > 0 ? -1 : 1;
  let af = step;
  let ep = trend === 1 ? second.high : second.low;
  let sar = trend === 1 ? first.low : first.high;

  for (let index = 1; index < sorted.length; index += 1) {
    const { high, low } = sorted[index]!;
    const previous = sorted[index - 1]!;
    if (trend === 1) {
      if (low < sar) {
        trend = -1;
        sar = Math.max(ep, previous.high, high);
        out[index] = { value: sar, trend };
        af = step;
        ep = low;
        sar = Math.max(sar + af * (ep - sar), previous.high, high);
      } else {
        out[index] = { value: sar, trend };
        if (high > ep) {
          ep = high;
          af = Math.min(af + step, max);
        }
        sar = Math.min(sar + af * (ep - sar), previous.low, low);
      }
    } else if (high > sar) {
      trend = 1;
      sar = Math.min(ep, previous.low, low);
      out[index] = { value: sar, trend };
      af = step;
      ep = high;
      sar = Math.min(sar + af * (ep - sar), previous.low, low);
    } else {
      out[index] = { value: sar, trend };
      if (low < ep) {
        ep = low;
        af = Math.min(af + step, max);
      }
      sar = Math.max(sar + af * (ep - sar), previous.high, high);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Volume and strength
// ---------------------------------------------------------------------------

/** On-balance volume: starts at 0; adds volume on an up close, subtracts on a down close. */
export function obv(candles: readonly PriceBar[]): number[] {
  const sorted = ascending(candles);
  let running = 0;
  return sorted.map((candle, index) => {
    const previous = sorted[index - 1];
    if (previous) {
      if (candle.close > previous.close) running += candle.volume;
      else if (candle.close < previous.close) running -= candle.volume;
    }
    return running;
  });
}

export interface AdxResult {
  adx: Series;
  plusDi: Series;
  minusDi: Series;
}

/**
 * Wilder's ADX/DMI. +DM = high − prev high when it exceeds prev low − low (and
 * is positive), −DM mirrors it. TR, +DM and −DM are Wilder-smoothed
 * (first value = sum of sessions 1..period, then S − S/period + x), so ±DI are
 * defined from index `period`. DX = 100 × |+DI − −DI| / (+DI + −DI); ADX is the
 * mean of the first `period` DX values (index 2·period − 1), then Wilder
 * smoothed. A flat stretch (zero true range) has DI = DX = 0 rather than NaN.
 */
export function adx(candles: readonly PriceBar[], period = 14): AdxResult {
  requirePositive(period, "period");
  const sorted = ascending(candles);
  const n = sorted.length;
  const result: AdxResult = { adx: nulls(n), plusDi: nulls(n), minusDi: nulls(n) };
  if (n <= period) return result;

  const ranges = trueRange(sorted);
  let smoothTr = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;
  let dxSum = 0;
  let current = 0;
  for (let index = 1; index < n; index += 1) {
    const candle = sorted[index]!;
    const previous = sorted[index - 1]!;
    const up = candle.high - previous.high;
    const down = previous.low - candle.low;
    const plusDm = up > down && up > 0 ? up : 0;
    const minusDm = down > up && down > 0 ? down : 0;
    const range = ranges[index]!;

    if (index <= period) {
      smoothTr += range;
      smoothPlus += plusDm;
      smoothMinus += minusDm;
      if (index < period) continue;
    } else {
      smoothTr = smoothTr - smoothTr / period + range;
      smoothPlus = smoothPlus - smoothPlus / period + plusDm;
      smoothMinus = smoothMinus - smoothMinus / period + minusDm;
    }

    const plusDi = smoothTr > 0 ? (100 * smoothPlus) / smoothTr : 0;
    const minusDi = smoothTr > 0 ? (100 * smoothMinus) / smoothTr : 0;
    result.plusDi[index] = plusDi;
    result.minusDi[index] = minusDi;
    const total = plusDi + minusDi;
    const dx = total > 0 ? (100 * Math.abs(plusDi - minusDi)) / total : 0;

    if (index < 2 * period - 1) {
      dxSum += dx;
    } else if (index === 2 * period - 1) {
      dxSum += dx;
      current = dxSum / period;
      result.adx[index] = current;
    } else {
      current = (current * (period - 1) + dx) / period;
      result.adx[index] = current;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Swings, structure and divergence
// ---------------------------------------------------------------------------

export interface SwingPoint {
  index: number;
  type: "high" | "low";
  /** The swing session's high (for a swing high) or low (for a swing low). */
  price: number;
}

/**
 * Fractal pivots: a swing high's high is STRICTLY greater than the highs of the
 * `left` sessions before and `right` sessions after it (ties never qualify);
 * a swing low mirrors that on lows. A pivot is only reported once its `right`
 * sessions exist, so the last `right` sessions never carry one. One session can
 * be both (an outside bar); the high is listed first. Sorted by index.
 */
export function swingPoints(
  candles: readonly PriceBar[],
  left = 3,
  right = 3,
): SwingPoint[] {
  requirePositive(left, "left");
  requirePositive(right, "right");
  const sorted = ascending(candles);
  const out: SwingPoint[] = [];
  for (let index = left; index < sorted.length - right; index += 1) {
    const { high, low } = sorted[index]!;
    let isHigh = true;
    let isLow = true;
    for (let j = index - left; j <= index + right && (isHigh || isLow); j += 1) {
      if (j === index) continue;
      const other = sorted[j]!;
      if (other.high >= high) isHigh = false;
      if (other.low <= low) isLow = false;
    }
    if (isHigh) out.push({ index, type: "high", price: high });
    if (isLow) out.push({ index, type: "low", price: low });
  }
  return out;
}

export interface StructureEvent {
  /** Session whose close broke the level. */
  index: number;
  type: "BOS" | "CHoCH";
  direction: "bullish" | "bearish";
  /** The broken swing price. */
  level: number;
  /** Index of the swing that set the level. */
  swingIndex: number;
}

/**
 * Break of structure (BOS) and change of character (CHoCH) from fractal swings.
 * Walking forward, a swing becomes the active level once it is confirmed
 * (`right` sessions after it); only the most recent confirmed swing high and
 * swing low are tracked. A CLOSE strictly above the active swing high is a
 * bullish break: CHoCH if the running trend was bearish, otherwise BOS (the
 * first break of the series is a BOS). A close strictly below the active swing
 * low is the bearish mirror. Each swing level is broken at most once: after a
 * break it stops being active until a newer swing of that side confirms.
 */
export function marketStructure(
  candles: readonly PriceBar[],
  left = 3,
  right = 3,
): StructureEvent[] {
  const sorted = ascending(candles);
  const swings = swingPoints(sorted, left, right);
  const events: StructureEvent[] = [];
  let pointer = 0;
  let activeHigh: SwingPoint | null = null;
  let activeLow: SwingPoint | null = null;
  let trend: "bullish" | "bearish" | null = null;

  for (let index = 0; index < sorted.length; index += 1) {
    while (pointer < swings.length && swings[pointer]!.index + right <= index) {
      const swing = swings[pointer]!;
      if (swing.type === "high") activeHigh = swing;
      else activeLow = swing;
      pointer += 1;
    }
    const close = sorted[index]!.close;
    if (activeHigh && close > activeHigh.price) {
      events.push({
        index,
        type: trend === "bearish" ? "CHoCH" : "BOS",
        direction: "bullish",
        level: activeHigh.price,
        swingIndex: activeHigh.index,
      });
      trend = "bullish";
      activeHigh = null;
    }
    if (activeLow && close < activeLow.price) {
      events.push({
        index,
        type: trend === "bullish" ? "CHoCH" : "BOS",
        direction: "bearish",
        level: activeLow.price,
        swingIndex: activeLow.index,
      });
      trend = "bearish";
      activeLow = null;
    }
  }
  return events;
}

export type DivergenceType =
  | "regular-bullish"
  | "regular-bearish"
  | "hidden-bullish"
  | "hidden-bearish";

export interface Divergence {
  type: DivergenceType;
  /** Earlier swing index. */
  fromIndex: number;
  /** Later swing index (the divergence is confirmed `right` sessions after it). */
  toIndex: number;
}

/**
 * Price/oscillator divergence on consecutive fractal swings of price. The
 * oscillator is sampled at the price swing indexes (it must be aligned to the
 * ascending-sorted candles). Consecutive swing lows: lower price low + higher
 * oscillator = regular bullish; higher price low + lower oscillator = hidden
 * bullish. Consecutive swing highs: higher price high + lower oscillator =
 * regular bearish; lower price high + higher oscillator = hidden bearish.
 * Pairs more than `maxGap` sessions apart, or with a null oscillator value at
 * either end, are skipped. Sorted by toIndex.
 */
export function divergences(
  candles: readonly PriceBar[],
  oscillator: ReadonlyArray<number | null>,
  left = 3,
  right = 3,
  maxGap = 60,
): Divergence[] {
  const swings = swingPoints(candles, left, right);
  const out: Divergence[] = [];
  let previousLow: SwingPoint | null = null;
  let previousHigh: SwingPoint | null = null;

  for (const swing of swings) {
    const prior: SwingPoint | null = swing.type === "low" ? previousLow : previousHigh;
    if (swing.type === "low") previousLow = swing;
    else previousHigh = swing;
    if (!prior || swing.index - prior.index > maxGap) continue;
    const a = oscillator[prior.index];
    const b = oscillator[swing.index];
    if (!isNum(a) || !isNum(b)) continue;

    let type: DivergenceType | null = null;
    if (swing.type === "low") {
      if (swing.price < prior.price && b > a) type = "regular-bullish";
      else if (swing.price > prior.price && b < a) type = "hidden-bullish";
    } else {
      if (swing.price > prior.price && b < a) type = "regular-bearish";
      else if (swing.price < prior.price && b > a) type = "hidden-bearish";
    }
    if (type) out.push({ type, fromIndex: prior.index, toIndex: swing.index });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zones and trendlines
// ---------------------------------------------------------------------------

export interface SupportResistanceZone {
  kind: "support" | "resistance";
  low: number;
  high: number;
  /** Mean of the clustered swing prices. */
  mid: number;
  /** Number of swing highs/lows in the cluster. */
  touches: number;
  /** Most recent swing index in the cluster. */
  lastIndex: number;
}

export interface SupportResistanceOptions {
  left?: number;
  right?: number;
  tolerancePct?: number;
  lookback?: number;
  maxZones?: number;
}

/**
 * Horizontal S/R zones from clustered swing highs AND lows whose swing index is
 * within the last `lookback` sessions. Clustering is greedy over swing prices
 * in ascending order: a price joins the current cluster when it is within
 * `tolerancePct` percent of the cluster's running mean, otherwise it opens a
 * new cluster. A zone spans its members' min..max price. Kind is relative to
 * the last close: mid at or below it = support, above it = resistance. Sorted
 * by touches desc, then lastIndex desc; at most `maxZones`.
 */
export function supportResistanceZones(
  candles: readonly PriceBar[],
  options: SupportResistanceOptions = {},
): SupportResistanceZone[] {
  const {
    left = 3,
    right = 3,
    tolerancePct = 1.5,
    lookback = 250,
    maxZones = 6,
  } = options;
  const sorted = ascending(candles);
  const last = sorted.at(-1);
  if (!last || maxZones <= 0) return [];
  const start = sorted.length - lookback;
  const swings = swingPoints(sorted, left, right)
    .filter((swing) => swing.index >= start && swing.price > 0)
    .sort((a, b) => a.price - b.price || a.index - b.index);

  const clusters: Array<{ prices: number[]; sum: number; lastIndex: number }> = [];
  for (const swing of swings) {
    const current = clusters.at(-1);
    const mid = current ? current.sum / current.prices.length : 0;
    if (current && Math.abs(swing.price - mid) <= (mid * tolerancePct) / 100) {
      current.prices.push(swing.price);
      current.sum += swing.price;
      current.lastIndex = Math.max(current.lastIndex, swing.index);
    } else {
      clusters.push({ prices: [swing.price], sum: swing.price, lastIndex: swing.index });
    }
  }

  return clusters
    .map((cluster): SupportResistanceZone => {
      const mid = cluster.sum / cluster.prices.length;
      return {
        kind: mid <= last.close ? "support" : "resistance",
        low: Math.min(...cluster.prices),
        high: Math.max(...cluster.prices),
        mid,
        touches: cluster.prices.length,
        lastIndex: cluster.lastIndex,
      };
    })
    .sort((a, b) => b.touches - a.touches || b.lastIndex - a.lastIndex)
    .slice(0, maxZones);
}

export interface SupplyDemandZone {
  kind: "demand" | "supply";
  low: number;
  high: number;
  baseStart: number;
  baseEnd: number;
  impulseIndex: number;
  /** True when no session after the impulse has traded back into the zone. */
  fresh: boolean;
}

export interface SupplyDemandOptions {
  lookback?: number;
  impulseAtr?: number;
  maxBase?: number;
  maxZones?: number;
}

/**
 * Base-and-impulse supply/demand zones. The reference volatility is ATR14 as
 * of the session before the impulse (so the impulse does not inflate its own
 * threshold). Impulse: |close − open| ≥ impulseAtr × ATR, closing beyond the
 * base (above its high for up, below its low for down). Base: the 1..maxBase
 * sessions immediately before the impulse whose range (high − low) is
 * < 0.6 × ATR, taken nearest-first. Up impulse → demand zone, down → supply;
 * the zone spans the base's lowest low..highest high. Fresh: no later session's
 * low (demand) / high (supply) has reached back into the zone. Only bases that
 * start within the last `lookback` sessions; newest impulse first.
 */
export function supplyDemandZones(
  candles: readonly PriceBar[],
  options: SupplyDemandOptions = {},
): SupplyDemandZone[] {
  const { lookback = 250, impulseAtr = 1.5, maxBase = 3, maxZones = 6 } = options;
  const sorted = ascending(candles);
  const n = sorted.length;
  if (n < 2 || maxZones <= 0 || maxBase <= 0) return [];
  const ranges = atr(sorted, 14);
  const start = n - lookback;
  const zones: SupplyDemandZone[] = [];

  for (let index = n - 1; index >= 1 && index > start; index -= 1) {
    const reference = ranges[index - 1];
    if (!isNum(reference) || reference <= 0) continue;
    const impulse = sorted[index]!;
    const body = Math.abs(impulse.close - impulse.open);
    if (body === 0 || body < impulseAtr * reference) continue;

    let baseStart = index;
    for (let j = index - 1; j >= Math.max(0, index - maxBase); j -= 1) {
      const candle = sorted[j]!;
      if (candle.high - candle.low < 0.6 * reference) baseStart = j;
      else break;
    }
    if (baseStart === index || baseStart < start) continue;

    let low = Infinity;
    let high = -Infinity;
    for (let j = baseStart; j < index; j += 1) {
      low = Math.min(low, sorted[j]!.low);
      high = Math.max(high, sorted[j]!.high);
    }
    const up = impulse.close > impulse.open;
    if (up ? impulse.close <= high : impulse.close >= low) continue;

    let fresh = true;
    for (let j = index + 1; j < n; j += 1) {
      const later = sorted[j]!;
      if (up ? later.low <= high : later.high >= low) {
        fresh = false;
        break;
      }
    }
    zones.push({
      kind: up ? "demand" : "supply",
      low,
      high,
      baseStart,
      baseEnd: index - 1,
      impulseIndex: index,
      fresh,
    });
    if (zones.length >= maxZones) break;
  }
  return zones;
}

export interface Trendline {
  kind: "support" | "resistance";
  from: { index: number; price: number };
  to: { index: number; price: number };
  slopePerBar: number;
  /** The two anchors plus earlier same-side swings within 1% of the line. */
  touches: number;
  /** Last close is below a support line / above a resistance line at the last index. */
  broken: boolean;
}

export interface TrendlineOptions {
  left?: number;
  right?: number;
  lookback?: number;
}

/**
 * Automatic trendlines from the two most recent swing lows (support, returned
 * only when the newer low is higher: a rising line) and the two most recent
 * swing highs (resistance, only when the newer high is lower: a falling line),
 * using swings within the last `lookback` sessions. `touches` counts both
 * anchors plus every earlier swing of the same side whose price is within 1%
 * of the line extended back to it. `broken` compares the last close with the
 * line projected to the last index. At most one line of each kind, support first.
 */
export function autoTrendlines(
  candles: readonly PriceBar[],
  options: TrendlineOptions = {},
): Trendline[] {
  const { left = 3, right = 3, lookback = 180 } = options;
  const sorted = ascending(candles);
  const last = sorted.at(-1);
  if (!last) return [];
  const lastIndex = sorted.length - 1;
  const start = sorted.length - lookback;
  const swings = swingPoints(sorted, left, right).filter((swing) => swing.index >= start);

  const build = (kind: Trendline["kind"]): Trendline | null => {
    const points = swings.filter((swing) =>
      kind === "support" ? swing.type === "low" : swing.type === "high",
    );
    const a = points.at(-2);
    const b = points.at(-1);
    if (!a || !b) return null;
    if (kind === "support" ? b.price <= a.price : b.price >= a.price) return null;
    const slopePerBar = (b.price - a.price) / (b.index - a.index);
    const lineAt = (index: number) => a.price + slopePerBar * (index - a.index);
    let touches = 2;
    for (const point of points.slice(0, -2)) {
      const y = lineAt(point.index);
      if (y > 0 && Math.abs(point.price - y) / y <= 0.01) touches += 1;
    }
    const projected = lineAt(lastIndex);
    return {
      kind,
      from: { index: a.index, price: a.price },
      to: { index: b.index, price: b.price },
      slopePerBar,
      touches,
      broken: kind === "support" ? last.close < projected : last.close > projected,
    };
  };

  return [build("support"), build("resistance")].filter(
    (line): line is Trendline => line !== null,
  );
}

// ---------------------------------------------------------------------------
// Events and screens
// ---------------------------------------------------------------------------

export interface CrossingEvent {
  index: number;
  direction: "up" | "down";
}

/**
 * Crossings of series `a` over `b` (a series or a constant level). Up at i when
 * a[i−1] ≤ b[i−1] and a[i] > b[i]; down when a[i−1] ≥ b[i−1] and a[i] < b[i].
 * Pairs with a null/non-finite value on either session are skipped.
 */
export function crossEvents(
  a: ReadonlyArray<number | null>,
  b: ReadonlyArray<number | null> | number,
): CrossingEvent[] {
  const level = (index: number): number | null =>
    typeof b === "number" ? b : (b[index] ?? null);
  const out: CrossingEvent[] = [];
  for (let index = 1; index < a.length; index += 1) {
    const a0 = a[index - 1];
    const a1 = a[index];
    const b0 = level(index - 1);
    const b1 = level(index);
    if (!isNum(a0) || !isNum(a1) || !isNum(b0) || !isNum(b1)) continue;
    if (a0 <= b0 && a1 > b1) out.push({ index, direction: "up" });
    else if (a0 >= b0 && a1 < b1) out.push({ index, direction: "down" });
  }
  return out;
}

/** A price bar that may carry the exchange-reported turnover. */
export type VolumeBar = PriceBar & { turnover?: number };

export interface VolumeAnalysis {
  lastVolume: number | null;
  /** Mean volume of the 20 sessions BEFORE the last one. */
  avgVolume20: number | null;
  /** lastVolume / avgVolume20. */
  volumeRatio: number | null;
  /** Sum of the last 3 sessions' volume. */
  volume3d: number | null;
  /** 3 × mean daily volume of the 20 sessions before the last 3 (the average 3-session sum). */
  avgVolume3dPrior: number | null;
  /** volume3d / avgVolume3dPrior. */
  volume3dRatio: number | null;
  volume5d: number | null;
  /** Sum of turnover over the last 5 sessions (reported turnover, else close × volume). */
  turnover5d: number | null;
  /** Percent change from the close 3 sessions ago to the last close. */
  priceChange3d: number | null;
  /** Of the last 3 sessions, how many closed above the previous close. */
  upDays3: number;
  /** Last close > highest high of the previous 20 sessions AND last volume ≥ 1.5 × avgVolume20. */
  breakout: boolean;
}

/**
 * Recent volume/turnover profile for screens. Averages exclude the sessions
 * they are compared with. The 3-session baseline is 3 × the mean daily volume
 * of the 20 sessions preceding the last 3, i.e. the average 3-session sum over
 * that span without block-boundary effects. Anything without enough history
 * is null.
 */
export function volumeAnalysis(candles: readonly VolumeBar[]): VolumeAnalysis {
  const sorted = ascending(candles);
  const n = sorted.length;
  const volumes = sorted.map((candle) => candle.volume);
  const sum = (from: number, to: number) => {
    let total = 0;
    for (let index = from; index < to; index += 1) total += volumes[index]!;
    return total;
  };
  const turnoverOf = (candle: VolumeBar) =>
    isNum(candle.turnover) ? candle.turnover : candle.close * candle.volume;

  const last = sorted.at(-1);
  const lastVolume = last ? last.volume : null;
  const avgVolume20 = n >= 21 ? sum(n - 21, n - 1) / 20 : null;
  const volumeRatio =
    lastVolume !== null && avgVolume20 !== null && avgVolume20 > 0
      ? lastVolume / avgVolume20
      : null;
  const volume3d = n >= 3 ? sum(n - 3, n) : null;
  const avgVolume3dPrior = n >= 23 ? (sum(n - 23, n - 3) / 20) * 3 : null;
  const volume3dRatio =
    volume3d !== null && avgVolume3dPrior !== null && avgVolume3dPrior > 0
      ? volume3d / avgVolume3dPrior
      : null;
  const volume5d = n >= 5 ? sum(n - 5, n) : null;
  const turnover5d =
    n >= 5 ? sorted.slice(-5).reduce((total, candle) => total + turnoverOf(candle), 0) : null;
  const base3 = sorted[n - 4];
  const priceChange3d =
    last && base3 && base3.close > 0 ? (last.close / base3.close - 1) * 100 : null;

  let upDays3 = 0;
  for (let index = Math.max(1, n - 3); index < n; index += 1) {
    if (sorted[index]!.close > sorted[index - 1]!.close) upDays3 += 1;
  }

  let breakout = false;
  if (last && n >= 21 && avgVolume20 !== null && last.volume > 0) {
    let priorHigh = -Infinity;
    for (let index = n - 21; index < n - 1; index += 1) {
      priorHigh = Math.max(priorHigh, sorted[index]!.high);
    }
    breakout = last.close > priorHigh && last.volume >= 1.5 * avgVolume20;
  }

  return {
    lastVolume,
    avgVolume20,
    volumeRatio,
    volume3d,
    avgVolume3dPrior,
    volume3dRatio,
    volume5d,
    turnover5d,
    priceChange3d,
    upDays3,
    breakout,
  };
}

/**
 * Mean absolute daily close-to-close move in percent over the last `window`
 * sessions: mean(|close / prevClose − 1|) × 100. Null when fewer than
 * window + 1 closes exist; pairs with a non-positive previous close are skipped.
 */
export function averageAbsoluteMove(
  candles: readonly PriceBar[],
  window = 20,
): number | null {
  requirePositive(window, "window");
  const sorted = ascending(candles);
  if (sorted.length < window + 1) return null;
  let total = 0;
  let count = 0;
  for (let index = sorted.length - window; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!.close;
    if (previous <= 0) continue;
    total += Math.abs(sorted[index]!.close / previous - 1);
    count += 1;
  }
  return count > 0 ? (total / count) * 100 : null;
}

export type SignalType =
  | "rsi-cross-30"
  | "rsi-cross-50"
  | "rsi-cross-70"
  | "macd-cross"
  | "ema-cross"
  | "supertrend-flip"
  | "golden-cross"
  | "death-cross"
  | "psar-flip"
  | "volume-breakout"
  | "price-breakout"
  | "new-52w-high"
  | "new-52w-low"
  | "bos"
  | "choch"
  | "divergence";

export interface SignalEvent {
  /** `${type}:${direction}:${YYYY-MM-DD}` — stable across recomputation, for de-duplication. */
  id: string;
  index: number;
  timestamp: string;
  type: SignalType;
  direction: "bullish" | "bearish" | "neutral";
  label: string;
  detail: string;
}

const DIVERGENCE_LABELS: Record<DivergenceType, string> = {
  "regular-bullish": "Regular bullish RSI divergence",
  "regular-bearish": "Regular bearish RSI divergence",
  "hidden-bullish": "Hidden bullish RSI divergence",
  "hidden-bearish": "Hidden bearish RSI divergence",
};

/**
 * Technical events whose session falls within the last `lookback` sessions,
 * oldest first:
 * - rsi-cross-30/50/70: RSI14 crossing the level (up = bullish, down = bearish)
 * - macd-cross: MACD(12, 26, 9) line crossing its signal line
 * - ema-cross: EMA 9 crossing EMA 21
 * - supertrend-flip: Supertrend(10, 3) direction change
 * - golden-cross / death-cross: SMA 50 crossing above / below SMA 200
 * - psar-flip: parabolic SAR(0.02, 0.2) trend change
 * - volume-breakout: volume ≥ 2 × mean of the prior 20 sessions (mean > 0) on an up close
 * - price-breakout: first close above the highest high of the prior 20 sessions
 *   (not repeated while the close stays above the rolling high)
 * - new-52w-high / new-52w-low: close strictly above / below every close in
 *   the prior 365 calendar days; only when the series reaches back a full
 *   365 days before that session
 * - bos / choch: marketStructure(3, 3) breaks
 * - divergence: RSI14 divergences(3, 3, 60), dated at the session that
 *   confirms the later swing (toIndex + 3), when it first became knowable
 * At most one event per id; ids repeat across calls for the same session.
 */
export function signalEvents(
  candles: readonly PriceBar[],
  lookback = 5,
): SignalEvent[] {
  const sorted = ascending(candles);
  const n = sorted.length;
  if (n < 2 || lookback <= 0) return [];
  const from = n - lookback;
  const events: SignalEvent[] = [];
  const seen = new Set<string>();
  const push = (
    index: number,
    type: SignalType,
    direction: SignalEvent["direction"],
    label: string,
    detail: string,
  ) => {
    if (index < from || index >= n) return;
    const timestamp = sorted[index]!.timestamp;
    const id = `${type}:${direction}:${timestamp.slice(0, 10)}`;
    if (seen.has(id)) return;
    seen.add(id);
    events.push({ id, index, timestamp, type, direction, label, detail });
  };

  const closes = sorted.map((candle) => candle.close);
  const close = (index: number) => closes[index]!;

  // RSI level crosses
  const rsi14 = rsi(closes, 14);
  for (const level of [30, 50, 70] as const) {
    for (const cross of crossEvents(rsi14, level)) {
      const up = cross.direction === "up";
      push(
        cross.index,
        `rsi-cross-${level}`,
        up ? "bullish" : "bearish",
        `RSI crossed ${up ? "above" : "below"} ${level}`,
        `RSI 14 moved from ${fmt(rsi14[cross.index - 1]!)} to ${fmt(rsi14[cross.index]!)}`,
      );
    }
  }

  // MACD line vs signal
  const m = macd(closes, 12, 26, 9);
  for (const cross of crossEvents(m.macd, m.signal)) {
    const up = cross.direction === "up";
    push(
      cross.index,
      "macd-cross",
      up ? "bullish" : "bearish",
      `MACD crossed ${up ? "above" : "below"} signal`,
      `MACD ${fmt(m.macd[cross.index]!, 4)} vs signal ${fmt(m.signal[cross.index]!, 4)}`,
    );
  }

  // EMA 9 / 21
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  for (const cross of crossEvents(ema9, ema21)) {
    const up = cross.direction === "up";
    push(
      cross.index,
      "ema-cross",
      up ? "bullish" : "bearish",
      `EMA 9 crossed ${up ? "above" : "below"} EMA 21`,
      `EMA 9 ${fmt(ema9[cross.index]!)} vs EMA 21 ${fmt(ema21[cross.index]!)}`,
    );
  }

  // Supertrend flips
  const st = supertrend(sorted, 10, 3);
  for (let index = Math.max(1, from); index < n; index += 1) {
    const before = st.direction[index - 1];
    const now = st.direction[index];
    if (before === null || before === undefined || now === null || now === undefined) continue;
    if (before === now) continue;
    const up = now === 1;
    push(
      index,
      "supertrend-flip",
      up ? "bullish" : "bearish",
      `Supertrend flipped ${up ? "bullish" : "bearish"}`,
      `Close ${fmt(close(index))} ${up ? "above" : "below"} Supertrend (10, 3) ${fmt(st.value[index]!)}`,
    );
  }

  // Golden / death cross
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  for (const cross of crossEvents(sma50, sma200)) {
    const up = cross.direction === "up";
    push(
      cross.index,
      up ? "golden-cross" : "death-cross",
      up ? "bullish" : "bearish",
      up ? "Golden cross (SMA 50 above SMA 200)" : "Death cross (SMA 50 below SMA 200)",
      `SMA 50 ${fmt(sma50[cross.index]!)} vs SMA 200 ${fmt(sma200[cross.index]!)}`,
    );
  }

  // Parabolic SAR flips
  const sar = parabolicSar(sorted);
  for (let index = Math.max(2, from); index < n; index += 1) {
    const before = sar[index - 1];
    const now = sar[index];
    if (!before || !now || before.trend === now.trend) continue;
    const up = now.trend === 1;
    push(
      index,
      "psar-flip",
      up ? "bullish" : "bearish",
      `Parabolic SAR flipped ${up ? "bullish" : "bearish"}`,
      `SAR ${fmt(now.value)} ${up ? "below" : "above"} close ${fmt(close(index))}`,
    );
  }

  // Volume and 20-session price breakouts
  const priorHigh20 = (index: number): number | null => {
    if (index < 20) return null;
    let highest = -Infinity;
    for (let j = index - 20; j < index; j += 1) highest = Math.max(highest, sorted[j]!.high);
    return highest;
  };
  for (let index = Math.max(20, from); index < n; index += 1) {
    const candle = sorted[index]!;
    let volumeSum = 0;
    for (let j = index - 20; j < index; j += 1) volumeSum += sorted[j]!.volume;
    const average = volumeSum / 20;
    if (average > 0 && candle.volume >= 2 * average && close(index) > close(index - 1)) {
      const change = (close(index) / close(index - 1) - 1) * 100;
      push(
        index,
        "volume-breakout",
        "bullish",
        "Volume breakout",
        `Volume ${Math.round(candle.volume)} is ${fmt(candle.volume / average)}× the 20-session average ${Math.round(average)}; close ${fmt(close(index))} (+${fmt(change)}%)`,
      );
    }

    const high = priorHigh20(index)!;
    const previousHigh = priorHigh20(index - 1);
    const wasAbove = previousHigh !== null && close(index - 1) > previousHigh;
    if (close(index) > high && !wasAbove) {
      push(
        index,
        "price-breakout",
        "bullish",
        "Broke above 20-session high",
        `Close ${fmt(close(index))} above prior 20-session high ${fmt(high)}`,
      );
    }
  }

  // New 52-week closing high / low (365 calendar days)
  const firstMs = dayMs(sorted[0]!);
  for (let index = Math.max(1, from); index < n; index += 1) {
    const cutoff = dayMs(sorted[index]!) - 365 * DAY_MS;
    if (firstMs > cutoff) continue;
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = index - 1; j >= 0 && dayMs(sorted[j]!) > cutoff; j -= 1) {
      highest = Math.max(highest, close(j));
      lowest = Math.min(lowest, close(j));
    }
    if (!Number.isFinite(highest)) continue;
    if (close(index) > highest) {
      push(
        index,
        "new-52w-high",
        "bullish",
        "New 52-week closing high",
        `Close ${fmt(close(index))} above prior 52-week closing high ${fmt(highest)}`,
      );
    } else if (close(index) < lowest) {
      push(
        index,
        "new-52w-low",
        "bearish",
        "New 52-week closing low",
        `Close ${fmt(close(index))} below prior 52-week closing low ${fmt(lowest)}`,
      );
    }
  }

  // Market structure
  for (const event of marketStructure(sorted, 3, 3)) {
    const bullish = event.direction === "bullish";
    const swingDay = sorted[event.swingIndex]!.timestamp.slice(0, 10);
    push(
      event.index,
      event.type === "BOS" ? "bos" : "choch",
      event.direction,
      `${bullish ? "Bullish" : "Bearish"} ${event.type === "BOS" ? "break of structure" : "change of character"}`,
      `Close ${fmt(close(event.index))} ${bullish ? "above swing high" : "below swing low"} ${fmt(event.level)} from ${swingDay}`,
    );
  }

  // RSI divergence, dated at confirmation of the later swing
  for (const divergence of divergences(sorted, rsi14, 3, 3, 60)) {
    const bullish = divergence.type.endsWith("bullish");
    const a = sorted[divergence.fromIndex]!;
    const b = sorted[divergence.toIndex]!;
    const priceA = bullish ? a.low : a.high;
    const priceB = bullish ? b.low : b.high;
    push(
      divergence.toIndex + 3,
      "divergence",
      bullish ? "bullish" : "bearish",
      DIVERGENCE_LABELS[divergence.type],
      `Swing ${bullish ? "lows" : "highs"} ${a.timestamp.slice(0, 10)} → ${b.timestamp.slice(0, 10)}: price ${fmt(priceA)} → ${fmt(priceB)}, RSI 14 ${fmt(rsi14[divergence.fromIndex]!)} → ${fmt(rsi14[divergence.toIndex]!)}`,
    );
  }

  return events.sort((x, y) => x.index - y.index);
}

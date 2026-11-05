import type { Candle } from "@stock/core";

export function sma(values: number[], period: number): Array<number | null> {
  if (period <= 0) throw new Error("period must be positive");
  const out = new Array<number | null>(values.length).fill(null);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index]!;
    if (index >= period) sum -= values[index - period]!;
    if (index >= period - 1) out[index] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Array<number | null> {
  if (period <= 0) throw new Error("period must be positive");
  const out = new Array<number | null>(values.length).fill(null);
  if (values.length < period) return out;

  const multiplier = 2 / (period + 1);
  let previous =
    values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = previous;

  for (let index = period; index < values.length; index += 1) {
    previous = values[index]! * multiplier + previous * (1 - multiplier);
    out[index] = previous;
  }
  return out;
}

/** Wilder's RSI. Returns null until the first full period is available. */
export function rsi(
  values: number[],
  period = 14,
): Array<number | null> {
  if (period <= 0) throw new Error("period must be positive");
  const out = new Array<number | null>(values.length).fill(null);
  if (values.length <= period) return out;

  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index]! - values[index - 1]!;
    if (change >= 0) averageGain += change;
    else averageLoss -= change;
  }
  averageGain /= period;
  averageLoss /= period;
  out[period] = rsiValue(averageGain, averageLoss);

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index]! - values[index - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    out[index] = rsiValue(averageGain, averageLoss);
  }
  return out;
}

function rsiValue(averageGain: number, averageLoss: number): number {
  // No movement at all (an untraded or perfectly flat series) is neutral, not
  // "overbought": RS is 0/0 there, so report the midpoint.
  if (averageGain === 0 && averageLoss === 0) return 50;
  if (averageLoss === 0) return 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function lastDefined(values: Array<number | null>): number | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function round(value: number | null, decimals = 2): number | null {
  if (value === null) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export interface SeriesAnalysis {
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
}

/**
 * Derived analytics over already-stored candles. Pure and offline: it never
 * calls a provider and never writes to the store.
 */
export function analyzeCandles(candles: Candle[]): SeriesAnalysis {
  const sorted = [...candles].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const closes = sorted.map((candle) => candle.close);
  // "52-week" means the trailing 365 calendar days, not the last 252 rows:
  // an illiquid scrip's last 252 rows can span many years.
  const lastDay = sorted.at(-1)?.timestamp.slice(0, 10);
  const cutoff = lastDay
    ? new Date(Date.parse(`${lastDay}T00:00:00Z`) - 365 * 86_400_000)
        .toISOString()
        .slice(0, 10)
    : "";
  const window = sorted.filter(
    (candle) => candle.timestamp.slice(0, 10) > cutoff,
  );

  const firstClose = window[0]?.close ?? null;
  const lastClose = closes.at(-1) ?? null;

  return {
    symbol: sorted[0]?.symbol ?? "",
    from: sorted[0]?.timestamp.slice(0, 10) ?? null,
    to: sorted.at(-1)?.timestamp.slice(0, 10) ?? null,
    observations: sorted.length,
    lastClose,
    sma20: round(lastDefined(sma(closes, 20))),
    sma50: round(lastDefined(sma(closes, 50))),
    sma200: round(lastDefined(sma(closes, 200))),
    ema20: round(lastDefined(ema(closes, 20))),
    rsi14: round(lastDefined(rsi(closes, 14))),
    high52w: window.length > 0 ? Math.max(...window.map((c) => c.high)) : null,
    low52w: window.length > 0 ? Math.min(...window.map((c) => c.low)) : null,
    returnPercent:
      firstClose && lastClose
        ? round(((lastClose - firstClose) / firstClose) * 100)
        : null,
  };
}

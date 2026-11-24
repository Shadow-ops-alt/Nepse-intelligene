/**
 * Intraday bars from sampled live quotes.
 *
 * NEPSE does not publish intraday history. The only intraday series the app
 * can honestly build is the current session, sampled from the unofficial live
 * feed while the app is open. These helpers turn those samples into canonical
 * 1-minute bars and resample them to 2m/3m/5m/… without inventing bars for
 * minutes where nothing traded.
 *
 * Everything here is pure and timezone-explicit:
 * - bar boundaries are aligned to Nepal Time (UTC+05:45), not UTC;
 * - a missing minute stays missing (no flat/filled bars);
 * - a cumulative volume/turnover counter is differenced, and a decrease is
 *   treated as a reset rather than a negative volume.
 */

import { ema, rsi, sma } from "./analysis";
import { bollinger, macd, type BollingerPoint, type MacdSeries } from "./quant";

/** NEPSE trades in Nepal Time (UTC+05:45). */
const NPT_OFFSET_MS = (5 * 60 + 45) * 60_000;
const MINUTE_MS = 60_000;

/** One observation of a symbol at a point in time. */
export interface IntradaySample {
  /** ISO timestamp of the last trade, as returned by the live feed. */
  timestamp: string;
  /** Last traded price at that time. */
  price: number;
  /** Cumulative volume for the session, when the source publishes it. */
  cumulativeVolume?: number | null;
  /** Cumulative turnover for the session, when the source publishes it. */
  cumulativeTurnover?: number | null;
}

/** One sampled bar. Volume/turnover stay null until two samples exist. */
export interface IntradayBar {
  /** ISO timestamp of the bar's start (Nepal Time boundary). */
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  turnover: number | null;
}

/** Supported intraday intervals, in minutes. */
export const INTRADAY_INTERVALS = [1, 2, 3, 5, 10, 15, 30, 60] as const;

function barStart(ms: number, spanMs: number): number {
  return Math.floor((ms + NPT_OFFSET_MS) / spanMs) * spanMs - NPT_OFFSET_MS;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Build one bar per traded minute from sampled prices.
 *
 * Samples are sorted by time. Repeated samples in the same minute update the
 * high/low/close and add the volume delta; a new minute starts a new bar.
 */
export function buildMinuteBars(
  samples: readonly IntradaySample[],
): IntradayBar[] {
  const ordered = samples
    .map((sample) => ({ sample, ms: Date.parse(sample.timestamp) }))
    .filter(
      ({ sample, ms }) =>
        Number.isFinite(ms) && finite(sample.price) && sample.price > 0,
    )
    .sort((a, b) => a.ms - b.ms);

  const bars: IntradayBar[] = [];
  let current: IntradayBar | null = null;
  let currentMinute = Number.NaN;
  let lastVolume: number | null = null;
  let lastTurnover: number | null = null;

  for (const { sample, ms } of ordered) {
    const minute = barStart(ms, MINUTE_MS);
    if (current === null || minute !== currentMinute) {
      current = {
        timestamp: new Date(minute).toISOString(),
        open: sample.price,
        high: sample.price,
        low: sample.price,
        close: sample.price,
        volume: null,
        turnover: null,
      };
      bars.push(current);
      currentMinute = minute;
    } else {
      current.high = Math.max(current.high, sample.price);
      current.low = Math.min(current.low, sample.price);
      current.close = sample.price;
    }

    if (finite(sample.cumulativeVolume)) {
      if (lastVolume !== null && sample.cumulativeVolume >= lastVolume) {
        const delta = sample.cumulativeVolume - lastVolume;
        current.volume = (current.volume ?? 0) + delta;
      }
      lastVolume = sample.cumulativeVolume;
    }

    if (finite(sample.cumulativeTurnover)) {
      if (lastTurnover !== null && sample.cumulativeTurnover >= lastTurnover) {
        const delta = sample.cumulativeTurnover - lastTurnover;
        current.turnover = (current.turnover ?? 0) + delta;
      }
      lastTurnover = sample.cumulativeTurnover;
    }
  }

  return bars;
}

/**
 * Resample 1-minute bars into `minutes`-minute bars, aligned to Nepal Time.
 * Bars with no trades in a bucket are simply absent.
 */
export function aggregateBars(
  bars: readonly IntradayBar[],
  minutes: number,
): IntradayBar[] {
  if (!Number.isFinite(minutes) || minutes <= 1) {
    return [...bars];
  }
  const span = Math.floor(minutes) * MINUTE_MS;
  const out: IntradayBar[] = [];
  let current: IntradayBar | null = null;
  let bucket = Number.NaN;

  for (const bar of bars) {
    const ms = Date.parse(bar.timestamp);
    if (!Number.isFinite(ms)) continue;
    const key = barStart(ms, span);
    if (current === null || key !== bucket) {
      current = {
        ...bar,
        timestamp: new Date(key).toISOString(),
      };
      out.push(current);
      bucket = key;
      continue;
    }
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    if (bar.volume !== null) {
      current.volume = (current.volume ?? 0) + bar.volume;
    }
    if (bar.turnover !== null) {
      current.turnover = (current.turnover ?? 0) + bar.turnover;
    }
  }

  return out;
}

/** Convenience: samples → bars for one interval. */
export function sessionBars(
  samples: readonly IntradaySample[],
  minutes: number,
): IntradayBar[] {
  return aggregateBars(buildMinuteBars(samples), minutes);
}

/** True when the timestamp belongs to the given Nepal-Time calendar day. */
export function isNptSessionDay(
  timestamp: string | null | undefined,
  day: string,
): boolean {
  if (!timestamp) return false;
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms + NPT_OFFSET_MS).toISOString().slice(0, 10) === day;
}

function nptDay(timestamp: string): string | null {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + NPT_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Running session VWAP for already-resampled bars.
 *
 * The value at bar `i` is `Σ(typical price × volume) / Σ(volume)` from the
 * start of that bar's Nepal-Time session. Typical price is `(H + L + C) / 3`.
 * The accumulator resets when the session day changes, so a multi-day input
 * never blends two sessions. A bar without volume keeps the previous VWAP;
 * when no volume has traded yet (or the whole series carries no volume) the
 * value is `null` rather than a made-up price.
 */
export function vwap(bars: readonly IntradayBar[]): Array<number | null> {
  const out = new Array<number | null>(bars.length).fill(null);
  let session: string | null = null;
  let cumulativeVolume = 0;
  let cumulativeValue = 0;

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index]!;
    const day = nptDay(bar.timestamp);
    if (day !== session) {
      session = day;
      cumulativeVolume = 0;
      cumulativeValue = 0;
    }
    const volume = finite(bar.volume) ? Math.max(0, bar.volume) : 0;
    if (volume > 0) {
      cumulativeVolume += volume;
      cumulativeValue += ((bar.high + bar.low + bar.close) / 3) * volume;
    }
    out[index] =
      cumulativeVolume > 0 ? cumulativeValue / cumulativeVolume : null;
  }

  return out;
}

/**
 * Indicator helpers used by the intraday chart. They are thin, named wrappers
 * over the shared analytics implementations so the chart computes on the
 * resampled bars with exactly the same math as every other screen.
 */

export function smaValues(
  values: readonly number[],
  period: number,
): Array<number | null> {
  return sma([...values], period);
}

export function emaValues(
  values: readonly number[],
  period: number,
): Array<number | null> {
  return ema([...values], period);
}

export function rsiValues(
  values: readonly number[],
  period = 14,
): Array<number | null> {
  return rsi([...values], period);
}

export function macdValues(
  values: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdSeries {
  return macd([...values], fast, slow, signalPeriod);
}

export function bollingerValues(
  values: readonly number[],
  period = 20,
  k = 2,
): Array<BollingerPoint | null> {
  return bollinger([...values], period, k);
}

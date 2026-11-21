/**
 * Session-scoped store for sampled live quotes.
 *
 * The live feed is the only intraday source the app has. We keep today's
 * samples in memory (and persist the symbols the user actually charted) so a
 * reload keeps the session's bars. Nothing here is written to the end-of-day
 * SQLite store, and samples from a previous Nepal-Time day are discarded.
 */
import {
  isNptSessionDay,
  sessionBars,
  type IntradayBar,
  type IntradaySample,
} from "@stock/analytics";
import { nptDate } from "../lib";
import type { LiveQuote } from "./types";

const PREFIX = "nepse-terminal.intraday.v1";
const MAX_SAMPLES_PER_SYMBOL = 1_500;
const MAX_PERSISTED_SYMBOLS = 20;

function todayNpt(): string {
  return nptDate(new Date().toISOString()) ?? new Date().toISOString().slice(0, 10);
}

let currentDay = todayNpt();
const samples = new Map<string, Map<string, IntradaySample>>();
const lastTimestamp = new Map<string, number>();
const watched = new Set<string>();

function storageKey(day: string): string {
  return `${PREFIX}.${day}`;
}

function prune(map: Map<string, IntradaySample>): void {
  if (map.size <= MAX_SAMPLES_PER_SYMBOL) return;
  const ordered = [...map.keys()].sort(
    (a, b) => (Date.parse(a) || 0) - (Date.parse(b) || 0),
  );
  for (const key of ordered.slice(0, map.size - MAX_SAMPLES_PER_SYMBOL)) {
    map.delete(key);
  }
}

function cleanupOldDays(): void {
  if (typeof window === "undefined") return;
  try {
    const keep = storageKey(currentDay);
    const stale: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(`${PREFIX}.`) && key !== keep) stale.push(key);
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup only.
  }
}

function hydrate(): void {
  if (typeof window === "undefined") return;
  cleanupOldDays();
  try {
    const raw = window.localStorage.getItem(storageKey(currentDay));
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, IntradaySample[]>;
    for (const [rawSymbol, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue;
      const symbol = rawSymbol.toUpperCase();
      const map = new Map<string, IntradaySample>();
      let newest = -Infinity;
      for (const item of list) {
        if (
          !item ||
          typeof item.timestamp !== "string" ||
          !Number.isFinite(item.price) ||
          item.price <= 0 ||
          !isNptSessionDay(item.timestamp, currentDay)
        ) {
          continue;
        }
        const ms = Date.parse(item.timestamp);
        if (!Number.isFinite(ms)) continue;
        map.set(item.timestamp, item);
        newest = Math.max(newest, ms);
      }
      if (map.size === 0) continue;
      samples.set(symbol, map);
      watched.add(symbol);
      lastTimestamp.set(symbol, newest);
    }
  } catch {
    // Corrupt cache: start the session clean.
  }
}

function rollover(): void {
  const today = todayNpt();
  if (today === currentDay) return;
  currentDay = today;
  samples.clear();
  lastTimestamp.clear();
  watched.clear();
  hydrate();
}

let persistTimer: number | null = null;

function persist(): void {
  if (typeof window === "undefined") return;
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  const data: Record<string, IntradaySample[]> = {};
  let count = 0;
  for (const symbol of watched) {
    if (count >= MAX_PERSISTED_SYMBOLS) break;
    const map = samples.get(symbol);
    if (!map || map.size === 0) continue;
    data[symbol] = [...map.values()].sort(
      (a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0),
    );
    count += 1;
  }
  try {
    window.localStorage.setItem(storageKey(currentDay), JSON.stringify(data));
  } catch {
    // Storage is best-effort; the in-memory session still works.
  }
}

function schedulePersist(): void {
  if (typeof window === "undefined") return;
  if (persistTimer !== null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    persist();
  }, 1_500);
}

export function watchSymbol(symbol: string): void {
  rollover();
  const key = symbol.trim().toUpperCase();
  if (!key) return;
  watched.add(key);
  if (!samples.has(key)) samples.set(key, new Map());
}

function ingestSample(symbol: string, sample: IntradaySample): void {
  rollover();
  const key = symbol.trim().toUpperCase();
  if (!watched.has(key)) return;
  if (!isNptSessionDay(sample.timestamp, currentDay)) return;
  const ms = Date.parse(sample.timestamp);
  if (!Number.isFinite(ms) || !Number.isFinite(sample.price) || sample.price <= 0) {
    return;
  }
  const previous = lastTimestamp.get(key);
  if (previous !== undefined && ms < previous) return;

  const map = samples.get(key) ?? new Map<string, IntradaySample>();
  map.set(sample.timestamp, sample);
  prune(map);
  samples.set(key, map);
  lastTimestamp.set(key, ms);
  schedulePersist();
}

/** Record every watched symbol from a live-market poll. */
export function ingestQuotes(rows: readonly LiveQuote[]): void {
  rollover();
  for (const row of rows) {
    if (!row.lastTradedAt) continue;
    ingestSample(row.symbol, {
      timestamp: row.lastTradedAt,
      price: row.ltp,
      cumulativeVolume: row.volume,
      cumulativeTurnover: row.turnover,
    });
  }
}

/** Record the live NEPSE index level from a live-summary poll. */
export function ingestIndex(value: number | null, asOf: string | null): void {
  if (value === null || asOf === null) return;
  ingestSample("NEPSE", {
    timestamp: asOf,
    price: value,
    cumulativeVolume: null,
    cumulativeTurnover: null,
  });
}

/** The session's bars for one symbol and interval. */
export function getSessionBars(
  symbol: string,
  minutes: number,
): IntradayBar[] {
  rollover();
  const map = samples.get(symbol.trim().toUpperCase());
  if (!map || map.size === 0) return [];
  const ordered = [...map.values()].sort(
    (a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0),
  );
  return sessionBars(ordered, minutes);
}

/** First recorded sample time for the session, if any. */
export function getSessionStart(symbol: string): string | null {
  rollover();
  const map = samples.get(symbol.trim().toUpperCase());
  if (!map || map.size === 0) return null;
  let first: string | null = null;
  let firstMs = Infinity;
  for (const key of map.keys()) {
    const ms = Date.parse(key);
    if (Number.isFinite(ms) && ms < firstMs) {
      firstMs = ms;
      first = key;
    }
  }
  return first;
}

/** Test hook: forget the in-memory session. */
export function resetSessionStore(): void {
  samples.clear();
  lastTimestamp.clear();
  watched.clear();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(storageKey(currentDay));
    } catch {
      // Best-effort.
    }
  }
}

if (typeof window !== "undefined") {
  hydrate();
  window.addEventListener("beforeunload", persist);
}

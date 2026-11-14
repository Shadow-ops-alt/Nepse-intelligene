import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SignalType } from "@stock/analytics";
import { api } from "./api";

/**
 * Rule-based alert engine. Signals are computed by the local API from stored
 * end-of-day candles (`/api/signals`); price alerts can also use unofficial
 * live LTP when the live service is reachable. Rules, the seen/read state and
 * the notification preference are per-viewer settings kept in localStorage.
 */

export interface SignalRow {
  symbol: string;
  id: string;
  index: number;
  timestamp: string;
  type: SignalType;
  direction: "bullish" | "bearish" | "neutral";
  label: string;
  detail: string;
}

export interface SignalsResponse {
  providerId: string;
  generatedAt: string;
  latestSession: string | null;
  events: Array<Omit<SignalRow, "symbol"> & { symbol: string }>;
}

export type AlertScope = "watchlist" | "portfolio" | "watch-or-portfolio" | "all";

export interface SignalRule {
  id: string;
  kind: "signal";
  enabled: boolean;
  type: SignalType;
  direction: "bullish" | "bearish" | "any";
  scope: AlertScope;
  label: string;
}

export interface PriceRule {
  id: string;
  kind: "price";
  enabled: boolean;
  symbol: string;
  condition: "above" | "below";
  price: number;
  label: string;
  /** Set once triggered so a level fires one notification. */
  triggeredAt?: string;
}

export type AlertRule = SignalRule | PriceRule;

export interface TriggeredAlert {
  key: string;
  ruleId: string;
  symbol: string;
  title: string;
  detail: string;
  direction: "bullish" | "bearish" | "neutral";
  session: string;
  source: "eod-signal" | "price-eod" | "price-live";
}

export const SIGNAL_TYPE_LABEL: Record<SignalType, string> = {
  "rsi-cross-30": "RSI 14 crosses 30",
  "rsi-cross-50": "RSI 14 crosses 50",
  "rsi-cross-70": "RSI 14 crosses 70",
  "macd-cross": "MACD crosses signal",
  "ema-cross": "EMA 9 crosses EMA 21",
  "supertrend-flip": "Supertrend flips",
  "golden-cross": "Golden cross (SMA 50/200)",
  "death-cross": "Death cross (SMA 50/200)",
  "psar-flip": "Parabolic SAR flips",
  "volume-breakout": "Volume breakout (≥2× avg)",
  "price-breakout": "Breaks 20-session high",
  "new-52w-high": "New 52-week high",
  "new-52w-low": "New 52-week low",
  bos: "Break of structure (BOS)",
  choch: "Change of character (CHoCH)",
  divergence: "RSI divergence",
};

export const SCOPE_LABEL: Record<AlertScope, string> = {
  watchlist: "Watchlist",
  portfolio: "Portfolio holdings",
  "watch-or-portfolio": "Watchlist + portfolio",
  all: "All active equities",
};

const RULES_KEY = "nepse-terminal.alert-rules";
const SEEN_KEY = "nepse-terminal.alert-seen";
const READ_KEY = "nepse-terminal.alert-read";
const NOTIFY_KEY = "nepse-terminal.alert-notify";

/** The client's two must-have alerts come first: RSI crossing 30 and 50. */
export const DEFAULT_RULES: AlertRule[] = [
  { id: "rsi30", kind: "signal", enabled: true, type: "rsi-cross-30", direction: "bullish", scope: "all", label: "RSI crosses above 30" },
  { id: "rsi50", kind: "signal", enabled: true, type: "rsi-cross-50", direction: "bullish", scope: "all", label: "RSI crosses above 50" },
  { id: "macd", kind: "signal", enabled: true, type: "macd-cross", direction: "any", scope: "watch-or-portfolio", label: "MACD cross" },
  { id: "ema", kind: "signal", enabled: true, type: "ema-cross", direction: "any", scope: "watch-or-portfolio", label: "EMA 9/21 cross" },
  { id: "st", kind: "signal", enabled: true, type: "supertrend-flip", direction: "any", scope: "watch-or-portfolio", label: "Supertrend flip" },
  { id: "vb", kind: "signal", enabled: true, type: "volume-breakout", direction: "bullish", scope: "all", label: "Volume breakout" },
  { id: "hi52", kind: "signal", enabled: true, type: "new-52w-high", direction: "any", scope: "watch-or-portfolio", label: "New 52-week high" },
  { id: "lo52", kind: "signal", enabled: true, type: "new-52w-low", direction: "any", scope: "portfolio", label: "Holding at a 52-week low" },
  { id: "golden", kind: "signal", enabled: true, type: "golden-cross", direction: "any", scope: "all", label: "Golden cross" },
];

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best-effort persistence.
  }
}

export function loadRules(): AlertRule[] {
  const stored = read<AlertRule[] | null>(RULES_KEY, null);
  return Array.isArray(stored) ? stored : DEFAULT_RULES;
}

export function saveRules(rules: AlertRule[]): void {
  write(RULES_KEY, rules);
}

function inScope(
  symbol: string,
  scope: AlertScope,
  watchlist: ReadonlySet<string>,
  holdings: ReadonlySet<string>,
  activeEquities: ReadonlySet<string>,
): boolean {
  switch (scope) {
    case "watchlist":
      return watchlist.has(symbol);
    case "portfolio":
      return holdings.has(symbol);
    case "watch-or-portfolio":
      return watchlist.has(symbol) || holdings.has(symbol);
    case "all":
      return activeEquities.size === 0 || activeEquities.has(symbol);
  }
}

export function matchAlerts(input: {
  rules: AlertRule[];
  events: SignalRow[];
  watchlist: ReadonlySet<string>;
  holdings: ReadonlySet<string>;
  activeEquities: ReadonlySet<string>;
  prices: ReadonlyMap<string, { price: number; asOf: string; live: boolean }>;
}): TriggeredAlert[] {
  const out: TriggeredAlert[] = [];
  for (const rule of input.rules) {
    if (!rule.enabled) continue;
    if (rule.kind === "signal") {
      for (const event of input.events) {
        if (event.type !== rule.type) continue;
        if (rule.direction !== "any" && event.direction !== rule.direction) continue;
        if (!inScope(event.symbol, rule.scope, input.watchlist, input.holdings, input.activeEquities)) continue;
        out.push({
          key: `${event.symbol}|${event.id}`,
          ruleId: rule.id,
          symbol: event.symbol,
          title: `${event.symbol}: ${event.label}`,
          detail: event.detail,
          direction: event.direction,
          session: event.timestamp.slice(0, 10),
          source: "eod-signal",
        });
      }
    } else {
      const quote = input.prices.get(rule.symbol);
      if (!quote) continue;
      const hit =
        rule.condition === "above" ? quote.price >= rule.price : quote.price <= rule.price;
      if (!hit) continue;
      out.push({
        key: `price|${rule.id}|${rule.condition}|${rule.price}`,
        ruleId: rule.id,
        symbol: rule.symbol,
        title: `${rule.symbol} is ${rule.condition} ${rule.price.toLocaleString("en-US")}`,
        detail: `${quote.live ? "Live LTP (unofficial)" : "Last end-of-day close"} ${quote.price.toLocaleString("en-US")} at ${quote.asOf.slice(0, 16).replace("T", " ")}`,
        direction: rule.condition === "above" ? "bullish" : "bearish",
        session: quote.asOf.slice(0, 10),
        source: quote.live ? "price-live" : "price-eod",
      });
    }
  }
  // Newest session first, then symbol.
  return out.sort((a, b) => b.session.localeCompare(a.session) || a.symbol.localeCompare(b.symbol));
}

export function notificationsEnabled(): boolean {
  return read<boolean>(NOTIFY_KEY, true);
}

export function setNotificationsEnabled(value: boolean): void {
  write(NOTIFY_KEY, value);
}

async function notify(alerts: TriggeredAlert[]): Promise<void> {
  if (!notificationsEnabled() || alerts.length === 0) return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      return;
    }
  }
  if (Notification.permission !== "granted") return;
  if (alerts.length > 3) {
    const bullish = alerts.filter((a) => a.direction === "bullish").length;
    new Notification(`NEPSE Terminal: ${alerts.length} new alerts`, {
      body: `${bullish} bullish, ${alerts.length - bullish} other. ${alerts
        .slice(0, 3)
        .map((a) => a.title)
        .join(" · ")}…`,
      tag: "nepse-alerts",
    });
    return;
  }
  for (const alert of alerts) {
    new Notification(alert.title, {
      body: `${alert.detail}${alert.source === "eod-signal" ? " · end-of-day signal" : ""}`,
      tag: alert.key,
    });
  }
}

interface WatchlistResponse {
  symbols: string[];
}

interface PortfolioLite {
  positions: Array<{ symbol: string; quantity: number }>;
}

interface CompanyLite {
  companies: Array<{ symbol: string; instrumentType: string; status: string }>;
}

interface QuotesLite {
  quotes: Array<{ symbol: string; ltp: number; asOf: string }>;
}

interface LiveLite {
  enabled: boolean;
  marketOpen: boolean | null;
  asOf: string | null;
  rows: Array<{ symbol: string; ltp: number }>;
}

/**
 * App-wide alert state: polls signals (cheap after the first, cached
 * computation) and live prices, matches rules, raises desktop notifications
 * for alerts not seen before, and tracks unread count.
 */
export function useAlerts(enabled = true) {
  const [rules, setRulesState] = useState<AlertRule[]>(() => loadRules());
  const [signals, setSignals] = useState<SignalsResponse | null>(null);
  const [context, setContext] = useState<{
    watchlist: Set<string>;
    holdings: Set<string>;
    active: Set<string>;
    prices: Map<string, { price: number; asOf: string; live: boolean }>;
  }>({ watchlist: new Set(), holdings: new Set(), active: new Set(), prices: new Map() });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [read, setRead] = useState<Set<string>>(() => new Set(readList(READ_KEY)));
  const initialised = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [signalResponse, watch, portfolio, companies, quotes] = await Promise.all([
        api<SignalsResponse>("/api/signals?lookback=5"),
        api<WatchlistResponse>("/api/watchlist").catch(() => ({ symbols: [] })),
        api<PortfolioLite>("/api/portfolio").catch(() => ({ positions: [] })),
        api<CompanyLite>("/api/companies").catch(() => ({ companies: [] })),
        api<QuotesLite>("/api/quotes").catch(() => ({ quotes: [] })),
      ]);
      const live = await api<LiveLite>("/api/live/market").catch(() => null);
      const prices = new Map<string, { price: number; asOf: string; live: boolean }>();
      for (const quote of quotes.quotes) {
        prices.set(quote.symbol, { price: quote.ltp, asOf: quote.asOf, live: false });
      }
      if (live?.enabled && live.rows.length > 0 && live.asOf) {
        for (const row of live.rows) {
          prices.set(row.symbol, { price: row.ltp, asOf: live.asOf, live: true });
        }
      }
      setSignals(signalResponse);
      setContext({
        watchlist: new Set(watch.symbols),
        holdings: new Set(portfolio.positions.filter((p) => p.quantity > 0).map((p) => p.symbol)),
        active: new Set(
          companies.companies
            .filter((c) => c.instrumentType === "Equity" && c.status === "active")
            .map((c) => c.symbol),
        ),
        prices,
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  const triggered = useMemo(
    () =>
      signals
        ? matchAlerts({
            rules,
            events: signals.events,
            watchlist: context.watchlist,
            holdings: context.holdings,
            activeEquities: context.active,
            prices: context.prices,
          })
        : [],
    [signals, rules, context],
  );

  // Desktop notifications for alerts never seen before. On the very first run
  // everything already present is marked seen without a notification burst.
  useEffect(() => {
    if (!signals) return;
    const previous = readList(SEEN_KEY);
    const seen = new Set(previous);
    const fresh = triggered.filter((alert) => !seen.has(alert.key));
    initialised.current = true;
    if (fresh.length === 0) return;
    for (const alert of fresh) seen.add(alert.key);
    writeList(SEEN_KEY, [...seen].slice(-5000));
    // First launch ever: record the backlog silently (seen and read) instead
    // of a notification burst and a 99+ badge; only new alerts count after.
    if (previous.length > 0) {
      void notify(fresh);
    } else {
      setRead((current) => {
        const next = new Set(current);
        for (const alert of fresh) next.add(alert.key);
        writeList(READ_KEY, [...next].slice(-5000));
        return next;
      });
    }
  }, [triggered, signals]);

  const setRules = useCallback((next: AlertRule[]) => {
    setRulesState(next);
    saveRules(next);
  }, []);

  const markRead = useCallback((keys: string[]) => {
    setRead((current) => {
      const next = new Set(current);
      for (const key of keys) next.add(key);
      writeList(READ_KEY, [...next].slice(-5000));
      return next;
    });
  }, []);

  const unread = triggered.filter((alert) => !read.has(alert.key)).length;

  return {
    rules,
    setRules,
    signals,
    triggered,
    unread,
    read,
    markRead,
    refresh,
    loading,
    error,
    context,
  };
}

export type AlertsState = ReturnType<typeof useAlerts>;

function readList(key: string): string[] {
  const value = read<string[]>(key, []);
  return Array.isArray(value) ? value : [];
}

function writeList(key: string, value: string[]): void {
  write(key, value);
}

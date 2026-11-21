/**
 * Polls the unofficial live feed while an intraday chart is open and records
 * the session's samples. Nothing is polled when the chart shows the daily
 * series, and nothing is written to the end-of-day store.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { IntradayBar } from "@stock/analytics";
import { api } from "../api";
import {
  getSessionBars,
  getSessionStart,
  ingestIndex,
  ingestQuotes,
  watchSymbol,
} from "./session-store";
import {
  minutesFor,
  type ChartTimeframe,
  type LiveMarket,
  type LiveQuote,
  type LiveStatus,
  type LiveSummary,
} from "./types";

const OPEN_POLL_MS = 5_000;
const CLOSED_POLL_MS = 30_000;

export interface LiveDisplayQuote {
  ltp: number;
  change: number | null;
  changePercent: number | null;
  asOf: string | null;
}

export interface LiveIntradayState {
  bars: IntradayBar[];
  status: LiveStatus | null;
  quote: LiveDisplayQuote | null;
  error: string | null;
  marketOpen: boolean | null;
  asOf: string | null;
  sessionStart: string | null;
  loading: boolean;
}

export function useLiveIntraday(
  symbol: string | null,
  timeframe: ChartTimeframe,
  source: "market" | "index" = "market",
): LiveIntradayState {
  const minutes = minutesFor(timeframe);
  const active = Boolean(symbol) && minutes !== null;
  const key = source === "index" ? "NEPSE" : (symbol?.trim().toUpperCase() ?? null);

  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [quote, setQuote] = useState<LiveDisplayQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(active);
  const [version, setVersion] = useState(0);

  const open = marketOpen === true;
  const interval = open ? OPEN_POLL_MS : CLOSED_POLL_MS;

  useEffect(() => {
    if (!active) {
      setLoading(false);
      return;
    }
    if (key) watchSymbol(key);
  }, [active, key]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const load = async () => {
      try {
        const next = await api<LiveStatus>("/api/live/status");
        if (!cancelled) {
          setStatus(next);
          setMarketOpen(next.marketOpen);
          if (!next.enabled) setError("Live market is turned off (NEPSE_LIVE=0).");
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    };

    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active]);

  useEffect(() => {
    if (!active || !key) return;
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      if (document.visibilityState === "visible") {
        try {
          if (source === "index") {
            const data = await api<LiveSummary>("/api/live/summary");
            if (!cancelled) {
              const value = data.index?.value ?? null;
              ingestIndex(value, data.asOf);
              setAsOf(data.asOf);
              setQuote(
                data.index
                  ? {
                      ltp: data.index.value,
                      change: data.index.change,
                      changePercent: data.index.changePercent,
                      asOf: data.asOf,
                    }
                  : null,
              );
              setError(
                data.enabled
                  ? data.lastError
                  : "Live market is turned off (NEPSE_LIVE=0).",
              );
              setVersion((value) => value + 1);
            }
          } else {
            const data = await api<LiveMarket>("/api/live/market");
            if (!cancelled) {
              ingestQuotes(data.rows);
              const row: LiveQuote | undefined = data.rows.find(
                (item) => item.symbol === key,
              );
              if (row) {
                setQuote({
                  ltp: row.ltp,
                  change: row.change,
                  changePercent: row.changePercent,
                  asOf: row.lastTradedAt ?? data.asOf,
                });
              }
              setAsOf(data.asOf);
              setMarketOpen(data.marketOpen);
              setError(
                data.enabled
                  ? data.lastError
                  : "Live market is turned off (NEPSE_LIVE=0).",
              );
              setVersion((value) => value + 1);
            }
          }
        } catch (cause) {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
      if (!cancelled) {
        timer = window.setTimeout(load, interval);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, key, source, interval]);

  const bars = useMemo(
    () => (active && key && minutes !== null ? getSessionBars(key, minutes) : []),
    // `version` intentionally refreshes the memo after each poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, key, minutes, version],
  );

  const sessionStart = useMemo(
    () => (key ? getSessionStart(key) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, version],
  );

  return {
    bars,
    status,
    quote,
    error,
    marketOpen,
    asOf,
    sessionStart,
    loading,
  };
}

import { useEffect, useState } from "react";
import type { FundamentalsResponse, FundamentalsSnapshot } from "../types";
import { cachedFetch } from "./useCachedApi";

export interface HistoryEnrichment {
  rows: FundamentalsSnapshot[];
  done: number;
  total: number;
  failed: number;
}

const CONCURRENCY = 6;
const FLUSH_EVERY = 25;

/**
 * `/api/fundamentals/latest` carries one stored period per symbol. When the
 * quarterly-statement period (ROE, ROA, NPL, …) is not that period, the
 * per-symbol history is fetched (cached, a few requests at a time) so the
 * desk can merge every period. Nothing is fetched when `symbols` is empty.
 */
export function useFundamentalsHistory(symbols: readonly string[]): HistoryEnrichment {
  const key = symbols.join(",");
  const [state, setState] = useState<HistoryEnrichment & { key: string }>({
    key: "",
    rows: [],
    done: 0,
    total: 0,
    failed: 0,
  });

  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (list.length === 0) {
      setState({ key, rows: [], done: 0, total: 0, failed: 0 });
      return;
    }
    let cancelled = false;
    const rows: FundamentalsSnapshot[] = [];
    let done = 0;
    let failed = 0;
    let next = 0;
    setState({ key, rows: [], done: 0, total: list.length, failed: 0 });

    const flush = () => {
      if (!cancelled) setState({ key, rows: [...rows], done, total: list.length, failed });
    };

    const worker = async () => {
      while (!cancelled && next < list.length) {
        const symbol = list[next]!;
        next += 1;
        try {
          const response = await cachedFetch<FundamentalsResponse>(
            `/api/fundamentals?symbol=${encodeURIComponent(symbol)}`,
          );
          rows.push(...(response.history ?? []));
          if (response.latest) rows.push(response.latest);
        } catch {
          failed += 1;
        }
        done += 1;
        if (done % FLUSH_EVERY === 0) flush();
      }
    };

    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker)).then(flush);
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state.key === key ? state : { rows: [], done: 0, total: symbols.length, failed: 0 };
}

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { RefreshStatus } from "./types";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    api<T>(path)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  return { data, error, loading, reload };
}

/**
 * Refresh status is polled faster while an import is running and slowly when
 * idle, so the banner and the Data page show live progress without a socket.
 */
export function useRefreshStatus(): ApiState<RefreshStatus> {
  const state = useApi<RefreshStatus>("/api/refresh/status");
  const running = state.data?.running ?? false;
  const { reload } = state;
  useEffect(() => {
    const timer = window.setInterval(reload, running ? 2_500 : 60_000);
    return () => window.clearInterval(timer);
  }, [running, reload]);
  return state;
}

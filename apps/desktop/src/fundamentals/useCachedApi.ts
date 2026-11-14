import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

/**
 * Small in-memory request cache so switching tabs, re-rendering or reopening
 * the same company does not refetch. Failures are not cached, so a dataset
 * that appears after `personal:details` + import is picked up on the next
 * open.
 */
const TTL_MS = 3 * 60_000;
const cache = new Map<string, { at: number; promise: Promise<unknown> }>();

export function cachedFetch<T>(path: string): Promise<T> {
  return cachedSelect<T, T>(path, "", (raw) => raw);
}

/**
 * Fetch `path` and cache only `select(raw)` under `path#selectKey`, so a large
 * response (e.g. a full-day floorsheet) is reduced once and not kept whole.
 */
export function cachedSelect<T, R>(path: string, selectKey: string, select: (raw: T) => R): Promise<R> {
  const key = selectKey ? `${path}#${selectKey}` : path;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise as Promise<R>;
  const promise = api<T>(path).then(select);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

export function invalidateCached(prefix: string): void {
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}

export interface CachedState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** HTTP status parsed from the error, e.g. 404 when an endpoint is absent. */
  status: number | null;
}

function statusOf(message: string | null): number | null {
  const match = message?.match(/^(\d{3}):/);
  return match?.[1] ? Number(match[1]) : null;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Like useApi, but cached across mounts; `null` path = do not fetch yet. */
export function useCachedApi<T>(path: string | null): CachedState<T> {
  return useCachedSelect<T, T>(path, "", identity);
}

function identity<T>(value: T): T {
  return value;
}

/**
 * Cached fetch plus a reduction of the payload. `select` must be stable for a
 * given `selectKey` (define it at module level or memoise it).
 */
export function useCachedSelect<T, R>(
  path: string | null,
  selectKey: string,
  select: (raw: T) => R,
): CachedState<R> {
  const [state, setState] = useState<{ path: string | null; data: R | null; error: string | null }>({
    path: null,
    data: null,
    error: null,
  });
  const stateKey = path ? `${path}#${selectKey}` : null;
  useEffect(() => {
    if (!path || !stateKey) return;
    let cancelled = false;
    cachedSelect<T, R>(path, selectKey, select).then(
      (data) => {
        if (!cancelled) setState({ path: stateKey, data, error: null });
      },
      (cause: unknown) => {
        if (!cancelled) setState({ path: stateKey, data: null, error: messageOf(cause) });
      },
    );
    return () => {
      cancelled = true;
    };
    // `select` is stable per selectKey by contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);
  return useMemo(() => {
    if (!stateKey) return { data: null, error: null, loading: false, status: null };
    if (state.path !== stateKey) return { data: null, error: null, loading: true, status: null };
    return { data: state.data, error: state.error, loading: false, status: statusOf(state.error) };
  }, [stateKey, state]);
}

/** Fetch several paths at once (e.g. one per compared company). */
export function useCachedApiMany<T>(paths: readonly string[]): Array<CachedState<T> & { path: string }> {
  const key = paths.join("\n");
  const [results, setResults] = useState<Record<string, { data: T | null; error: string | null }>>({});
  useEffect(() => {
    let cancelled = false;
    for (const path of key ? key.split("\n") : []) {
      cachedFetch<T>(path).then(
        (data) => {
          if (!cancelled) setResults((prev) => ({ ...prev, [path]: { data, error: null } }));
        },
        (cause: unknown) => {
          if (!cancelled) setResults((prev) => ({ ...prev, [path]: { data: null, error: messageOf(cause) } }));
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  return useMemo(
    () =>
      (key ? key.split("\n") : []).map((path) => {
        const entry = results[path];
        return {
          path,
          data: entry?.data ?? null,
          error: entry?.error ?? null,
          loading: entry === undefined,
          status: statusOf(entry?.error ?? null),
        };
      }),
    [key, results],
  );
}

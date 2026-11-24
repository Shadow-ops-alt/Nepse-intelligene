import type { ServerResponse } from "node:http";
import { sessionBars, type IntradayBar } from "@stock/analytics";
import { createWasmTokenProvider, type TokenProvider } from "./auth";
import {
  asRows,
  isRecord,
  latestIso,
  mapLiveMarket,
  mapMarketDepth,
  mapMarketState,
  mapMarketSummary,
  mapNepseIndex,
  mapSecurityIds,
  type DepthLevel,
  type LiveIndex,
  type LiveQuote,
  type LiveSummaryFigures,
  type MarketState,
} from "./mapping";
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  NEPSE_PATHS,
  NepseSession,
  type FetchLike,
} from "./session";
import { createShareSansarReader } from "./sharesansar";

/** The label the UI shows next to every live value. */
export const LIVE_LABEL =
  "LIVE (nepalstock.com, ShareSansar fallback)";
export const LIVE_SOURCE = "nepalstock.com and ShareSansar live pages";
export const LIVE_DISCLAIMER =
  "Live data read from nepalstock.com's internal web endpoints " +
  "and, as a fallback, ShareSansar's public live-trading page. Not provided or " +
  "endorsed by NEPSE; it may be delayed, incomplete, wrong or unavailable " +
  "(nepalstock.com blocks some networks/regions). It is never written to the " +
  "end-of-day store.";

/** Data freshness while the market is open. */
export const OPEN_TTL_MS = 10_000;
/** Market-open check interval while the market is open. */
export const STATUS_OPEN_TTL_MS = 60_000;
/** Poll interval for everything while the market is closed (or its state unknown). */
export const CLOSED_TTL_MS = 5 * 60_000;
/** Symbol → security id list (for market depth). */
export const SECURITY_LIST_TTL_MS = 6 * 60 * 60_000;
const MAX_DEPTH_SYMBOLS = 64;
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9&._-]{0,23}$/;

export interface LiveStatusResponse {
  enabled: boolean;
  source: string;
  marketOpen: boolean | null;
  asOf: string | null;
  lastError: string | null;
  disclaimer: string;
}

export interface LiveMarketResponse {
  enabled: boolean;
  marketOpen: boolean | null;
  /** Newest last-traded time in the payload, else when it was fetched. */
  asOf: string | null;
  fetchedAt: string | null;
  rows: LiveQuote[];
  lastError: string | null;
}

export interface LiveSummaryResponse extends LiveSummaryFigures {
  enabled: boolean;
  asOf: string | null;
  fetchedAt: string | null;
  index: LiveIndex | null;
  lastError: string | null;
}

export interface LiveDepthResponse {
  enabled: boolean;
  asOf: string | null;
  fetchedAt: string | null;
  symbol: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
  lastError: string | null;
}

/** Intraday intervals the NEPSE graph endpoint supports, in minutes. */
export const INTRADAY_GRAPH_INTERVALS = [1, 5, 15, 30, 60] as const;

const INTRADAY_TIMEFRAME: Record<number, string> = {
  1: "1min",
  5: "5min",
  15: "15min",
  30: "30min",
  60: "1h",
};

/**
 * NEPSE's index-graph ids, matching the constants nepseman-api publishes.
 * The app's stored index symbols are the same names uppercased.
 */
const INDEX_GRAPH_IDS: Readonly<Record<string, number>> = {
  BANKING: 51,
  HOTELS_TOURISM: 52,
  OTHERS: 53,
  HYDROPOWER: 54,
  DEVELOPMENT_BANK: 55,
  MANUFACTURING: 56,
  SENSITIVE: 57,
  NEPSE: 58,
  NON_LIFE_INSURANCE: 59,
  FINANCE: 60,
  TRADING: 61,
  FLOAT: 62,
  SENSITIVE_FLOAT: 63,
  MICROFINANCE: 64,
  LIFE_INSURANCE: 65,
  MUTUAL_FUND: 66,
  INVESTMENT: 67,
};

/** The latest session's intraday bars, one series per stored timeframe. */
export interface LiveIntradayResponse {
  enabled: boolean;
  kind: "equity" | "index";
  symbol: string;
  /** Nepal-Time session date (`YYYY-MM-DD`). */
  session: string | null;
  asOf: string | null;
  fetchedAt: string | null;
  points: number;
  series: Array<{ timeframe: string; bars: IntradayBar[] }>;
  source: string;
  disclaimer: string;
  lastError: string | null;
}

export interface LiveServiceOptions {
  /** Defaults to `NEPSE_LIVE !== "0"` (also "false"/"off"/"no" disable). */
  enabled?: boolean;
  /** Environment for NEPSE_LIVE / NEPSE_WASM_PATH. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  now?: () => number;
  /** Token decoder; defaults to NEPSE's WASM from the nepseman-api package. */
  tokenProvider?: TokenProvider;
  baseUrl?: string;
}

export interface LiveService {
  readonly enabled: boolean;
  /** Serves GET /api/live/{status,market,summary,depth}; false for any other path. */
  handle(url: URL, response: ServerResponse): Promise<boolean>;
  status(): Promise<LiveStatusResponse>;
  market(): Promise<LiveMarketResponse>;
  summary(): Promise<LiveSummaryResponse>;
  depth(symbol: string): Promise<LiveDepthResponse>;
  /** Latest-session 1m–1h bars from NEPSE's internal graph endpoint. */
  intraday(
    symbol: string,
    kind: "equity" | "index",
  ): Promise<LiveIntradayResponse>;
}

export function liveEnabledFromEnv(env: NodeJS.ProcessEnv): boolean {
  const flag = env.NEPSE_LIVE?.trim().toLowerCase();
  return !(flag === "0" || flag === "false" || flag === "off" || flag === "no");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function backoffMs(failures: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_MS);
}

/**
 * One upstream resource: last good value, last error, single-flight loads,
 * freshness TTL and per-resource exponential retry backoff.
 */
class Cached<T> {
  value: T | undefined;
  fetchedAt: number | null = null;
  lastError: string | null = null;
  attemptedAt: number | null = null;
  private failures = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly now: () => number,
    private readonly load: () => Promise<T>,
  ) {}

  /**
   * Refresh if older than `ttlMs`. After a failure, wait for the backoff
   * (and at least `minRetryMs`) before trying again; meanwhile the last good
   * value is served with `lastError` set.
   */
  async read(ttlMs: number, minRetryMs = 0): Promise<void> {
    if (this.inflight) return this.inflight;
    const now = this.now();
    if (this.fetchedAt !== null && now - this.fetchedAt < ttlMs) return;
    if (
      this.failures > 0 &&
      this.attemptedAt !== null &&
      now - this.attemptedAt < Math.max(backoffMs(this.failures), minRetryMs)
    ) {
      return;
    }
    this.attemptedAt = now;
    this.inflight = this.load()
      .then(
        (value) => {
          this.value = value;
          this.fetchedAt = this.now();
          this.lastError = null;
          this.failures = 0;
        },
        (error: unknown) => {
          this.lastError = errorMessage(error);
          this.failures += 1;
        },
      )
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function joinErrors(...errors: Array<string | null>): string | null {
  const distinct = [...new Set(errors.filter((error): error is string => Boolean(error)))];
  return distinct.length > 0 ? distinct.join("; ") : null;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

interface LiveMarketValue {
  rows: LiveQuote[];
  asOf: string | null;
}

interface DepthValue {
  bids: DepthLevel[];
  asks: DepthLevel[];
}

const DEPTH_KEYS = [
  "marketDepth",
  "buyMarketDepthList",
  "sellMarketDepthList",
  "bids",
  "asks",
  "buyList",
  "sellList",
];

/**
 * Live market service. Requests leave the machine only when a client asks
 * and the cached copy is stale: ~10 s while the market is open, 5 min while
 * it is closed. Nothing is ever written to the end-of-day store.
 */
export function createLiveService(options: LiveServiceOptions = {}): LiveService {
  const env = options.env ?? process.env;
  const enabled = options.enabled ?? liveEnabledFromEnv(env);
  const now = options.now ?? Date.now;
  const fetchImpl: FetchLike =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  const session = new NepseSession({
    fetchImpl,
    now,
    baseUrl: options.baseUrl,
    tokenProvider: options.tokenProvider ?? createWasmTokenProvider({ env }),
  });
  const shareSansar = createShareSansarReader(fetchImpl, now);

  const statusEntry = new Cached<MarketState>(now, async () => {
    try {
      return mapMarketState(await session.marketStatus());
    } catch (error) {
      try {
        return (await shareSansar.read()).state;
      } catch {
        throw error;
      }
    }
  });

  const liveEntry = new Cached<LiveMarketValue>(now, async () => {
    try {
      const payload = await session.getJson(NEPSE_PATHS.liveMarket);
      if (isRecord(payload) && asRows(payload).length === 0 && Object.keys(payload).length > 0) {
        throw new Error(
          `nepalstock.com live-market payload has an unexpected shape (keys: ${Object.keys(payload).slice(0, 6).join(", ")})`,
        );
      }
      const mapped = mapLiveMarket(payload);
      if (mapped.sourceRows > 0 && mapped.rows.length === 0) {
        throw new Error(
          `nepalstock.com live-market payload had ${mapped.sourceRows} rows but none with a recognisable symbol and last traded price (format changed?)`,
        );
      }
      return { rows: mapped.rows, asOf: mapped.asOf };
    } catch (error) {
      try {
        const fallback = await shareSansar.read();
        if (fallback.rows.length > 0) {
          return { rows: fallback.rows, asOf: fallback.state.asOf };
        }
      } catch {
        /* fall through to the original error */
      }
      throw error;
    }
  });

  const summaryEntry = new Cached<LiveSummaryFigures>(now, async () => {
    try {
      const payload = await session.getJson(NEPSE_PATHS.marketSummary);
      const figures = mapMarketSummary(payload);
      const empty = Object.values(figures).every((value) => value === null);
      if (empty && payload !== null && (asRows(payload).length > 0 || isRecord(payload))) {
        throw new Error("nepalstock.com market-summary payload was not recognised (format changed?)");
      }
      return figures;
    } catch (error) {
      try {
        const fallback = await shareSansar.read();
        const figures = fallback.summary;
        if (Object.values(figures).some((value) => value !== null)) return figures;
      } catch {
        /* fall through to the original error */
      }
      throw error;
    }
  });

  const indexEntry = new Cached<{ index: LiveIndex | null; asOf: string | null }>(now, async () => {
    try {
      const payload = await session.getJson(NEPSE_PATHS.nepseIndex);
      const mapped = mapNepseIndex(payload);
      if (mapped.index === null && payload !== null && (asRows(payload).length > 0 || isRecord(payload))) {
        throw new Error("nepalstock.com nepse-index payload had no recognisable NEPSE index (format changed?)");
      }
      return mapped;
    } catch (error) {
      try {
        const fallback = await shareSansar.read();
        if (fallback.index !== null) {
          return { index: fallback.index, asOf: fallback.state.asOf };
        }
      } catch {
        /* fall through to the original error */
      }
      throw error;
    }
  });

  const securitiesEntry = new Cached<Map<string, number>>(now, async () => {
    const ids = mapSecurityIds(await session.getJson(NEPSE_PATHS.securityList));
    if (ids.size === 0) {
      throw new Error("nepalstock.com security list was empty or not recognised");
    }
    return ids;
  });

  const depthEntries = new Map<string, Cached<DepthValue>>();

  /** Latest-session price points, cached per series. */
  interface IntradayValue {
    session: string;
    asOf: string;
    points: number;
    bars: Map<string, IntradayBar[]>;
  }

  const intradayEntries = new Map<string, Cached<IntradayValue>>();

  function nptDateOf(iso: string): string {
    const ms = Date.parse(iso);
    return new Date(ms + 5 * 60 * 60_000 + 45 * 60_000)
      .toISOString()
      .slice(0, 10);
  }

  /** NEPSE returns NPT wall-clock prices as epoch seconds (UTC instant). */
  function graphSamples(
    payload: unknown,
    kind: "equity" | "index",
  ): Array<{ timestamp: string; price: number }> {
    const rows = Array.isArray(payload) ? payload : [];
    const samples: Array<{ timestamp: string; price: number }> = [];
    for (const raw of rows) {
      if (kind === "index") {
        if (!Array.isArray(raw) || raw.length < 2) continue;
        const seconds = Number(raw[0]);
        const price = Number(raw[1]);
        if (!Number.isFinite(seconds) || !Number.isFinite(price) || price <= 0) {
          continue;
        }
        samples.push({
          timestamp: new Date(seconds * 1000).toISOString(),
          price,
        });
      } else {
        if (!isRecord(raw)) continue;
        const seconds = Number(raw.time);
        const price = Number(raw.contractRate);
        if (!Number.isFinite(seconds) || !Number.isFinite(price) || price <= 0) {
          continue;
        }
        samples.push({
          timestamp: new Date(seconds * 1000).toISOString(),
          price,
        });
      }
    }
    return samples;
  }

  function intradayValue(
    kind: "equity" | "index",
    payload: unknown,
  ): IntradayValue {
    const samples = graphSamples(payload, kind);
    if (samples.length === 0) {
      throw new Error(
        `nepalstock.com returned no ${kind} intraday points for the latest session (market closed or format changed)`,
      );
    }
    const minute = sessionBars(samples, 1);
    const bars = new Map<string, IntradayBar[]>();
    for (const minutes of INTRADAY_GRAPH_INTERVALS) {
      const timeframe = INTRADAY_TIMEFRAME[minutes]!;
      bars.set(
        timeframe,
        minutes === 1 ? minute : sessionBars(samples, minutes),
      );
    }
    const last = samples.reduce((newest, sample) =>
      Date.parse(sample.timestamp) > Date.parse(newest.timestamp)
        ? sample
        : newest,
    );
    return {
      session: nptDateOf(last.timestamp),
      asOf: last.timestamp,
      points: samples.length,
      bars,
    };
  }

  function intradayEntry(
    kind: "equity" | "index",
    symbol: string,
  ): Cached<IntradayValue> {
    const key = `${kind}:${symbol}`;
    let entry = intradayEntries.get(key);
    if (entry) {
      intradayEntries.delete(key);
      intradayEntries.set(key, entry);
      return entry;
    }
    entry = new Cached<IntradayValue>(now, async () => {
      if (kind === "index") {
        const id = INDEX_GRAPH_IDS[symbol];
        if (id === undefined) {
          throw new Error(
            `${symbol} has no nepalstock.com index-graph id (known: ${Object.keys(INDEX_GRAPH_IDS).join(", ")})`,
          );
        }
        return intradayValue(kind, await session.postJson(
          `/api/nots/graph/index/${id}`,
          "general",
        ));
      }
      await securitiesEntry.read(SECURITY_LIST_TTL_MS);
      const securityId = securitiesEntry.value?.get(symbol);
      if (securityId === undefined) {
        throw new Error(
          securitiesEntry.value
            ? `${symbol} is not in nepalstock.com's security list`
            : securitiesEntry.lastError ?? "security list unavailable",
        );
      }
      return intradayValue(kind, await session.postJson(
        `/api/nots/market/graphdata/daily/${securityId}`,
        "stock-live",
      ));
    });
    intradayEntries.set(key, entry);
    return entry;
  }

  async function intraday(
    input: string,
    kind: "equity" | "index",
  ): Promise<LiveIntradayResponse> {
    const symbol = input.trim().toUpperCase();
    const empty: LiveIntradayResponse = {
      enabled,
      kind,
      symbol,
      session: null,
      asOf: null,
      fetchedAt: null,
      points: 0,
      series: [],
      source: LIVE_SOURCE,
      disclaimer: LIVE_DISCLAIMER,
      lastError: null,
    };
    if (!enabled) return empty;
    if (!SYMBOL_PATTERN.test(symbol)) {
      return { ...empty, lastError: "invalid symbol" };
    }

    const open = kind === "equity" ? await marketOpen() : null;
    const ttl = open === true ? 30_000 : 5 * 60_000;
    const entry = intradayEntry(kind, symbol);
    await entry.read(ttl);
    return {
      enabled: true,
      kind,
      symbol,
      session: entry.value?.session ?? null,
      asOf: entry.value?.asOf ?? null,
      fetchedAt: isoOrNull(entry.fetchedAt),
      points: entry.value?.points ?? 0,
      series: [...INTRADAY_GRAPH_INTERVALS].map((minutes) => ({
        timeframe: INTRADAY_TIMEFRAME[minutes]!,
        bars: entry.value?.bars.get(INTRADAY_TIMEFRAME[minutes]!) ?? [],
      })),
      source: LIVE_SOURCE,
      disclaimer: LIVE_DISCLAIMER,
      lastError: joinErrors(entry.lastError, statusEntry.lastError),
    };
  }


  function depthEntry(symbol: string, securityId: number): Cached<DepthValue> {
    const entry = new Cached<DepthValue>(now, async () => {
      const payload = await session.getJson(`${NEPSE_PATHS.marketDepth}${securityId}/`);
      const mapped = mapMarketDepth(payload);
      if (
        isRecord(payload) &&
        mapped.bids.length === 0 &&
        mapped.asks.length === 0 &&
        !DEPTH_KEYS.some((key) => key in payload)
      ) {
        throw new Error("nepalstock.com market-depth payload was not recognised (format changed?)");
      }
      return mapped;
    });
    depthEntries.set(symbol, entry);
    while (depthEntries.size > MAX_DEPTH_SYMBOLS) {
      const oldest = depthEntries.keys().next().value;
      if (oldest === undefined) break;
      depthEntries.delete(oldest);
    }
    return entry;
  }

  /** Market state drives every interval; closed or unknown → 5 min. */
  async function marketOpen(): Promise<boolean | null> {
    const last = statusEntry.value?.open ?? null;
    await statusEntry.read(
      last === true ? STATUS_OPEN_TTL_MS : CLOSED_TTL_MS,
      last === false ? CLOSED_TTL_MS : 0,
    );
    return statusEntry.value?.open ?? null;
  }

  function dataTtl(open: boolean | null): [number, number] {
    return open === true ? [OPEN_TTL_MS, 0] : [CLOSED_TTL_MS, open === false ? CLOSED_TTL_MS : 0];
  }

  async function status(): Promise<LiveStatusResponse> {
    if (!enabled) {
      return {
        enabled: false,
        source: LIVE_SOURCE,
        marketOpen: null,
        asOf: null,
        lastError: null,
        disclaimer: LIVE_DISCLAIMER,
      };
    }
    const open = await marketOpen();
    // The most recent failure of any resource that is currently failing.
    const failing = [statusEntry, liveEntry, summaryEntry, indexEntry, securitiesEntry, ...depthEntries.values(), ...intradayEntries.values()]
      .filter((entry) => entry.lastError !== null)
      .sort((a, b) => (b.attemptedAt ?? 0) - (a.attemptedAt ?? 0));
    return {
      enabled: true,
      source: LIVE_SOURCE,
      marketOpen: open,
      asOf: statusEntry.value?.asOf ?? isoOrNull(statusEntry.fetchedAt),
      lastError: failing[0]?.lastError ?? null,
      disclaimer: LIVE_DISCLAIMER,
    };
  }

  async function market(): Promise<LiveMarketResponse> {
    if (!enabled) {
      return { enabled: false, marketOpen: null, asOf: null, fetchedAt: null, rows: [], lastError: null };
    }
    const open = await marketOpen();
    await liveEntry.read(...dataTtl(open));
    const fetchedAt = isoOrNull(liveEntry.fetchedAt);
    return {
      enabled: true,
      marketOpen: open,
      asOf: liveEntry.value?.asOf ?? fetchedAt,
      fetchedAt,
      rows: liveEntry.value?.rows ?? [],
      lastError: joinErrors(liveEntry.lastError, statusEntry.lastError),
    };
  }

  async function summary(): Promise<LiveSummaryResponse> {
    if (!enabled) {
      return {
        enabled: false,
        asOf: null,
        fetchedAt: null,
        index: null,
        turnover: null,
        sharesTraded: null,
        transactions: null,
        scripsTraded: null,
        lastError: null,
      };
    }
    const open = await marketOpen();
    const ttl = dataTtl(open);
    await Promise.all([summaryEntry.read(...ttl), indexEntry.read(...ttl)]);
    const fetchedAt = latestIso([isoOrNull(summaryEntry.fetchedAt), isoOrNull(indexEntry.fetchedAt)]);
    const figures = summaryEntry.value;
    // NEPSE sends no timestamp here (generatedTime is null). While closed the
    // figures are the last session's, so date them by the market-close time
    // from market-open rather than by when they were fetched.
    const sessionAsOf = open === false ? (statusEntry.value?.asOf ?? null) : null;
    return {
      enabled: true,
      asOf: indexEntry.value?.asOf ?? sessionAsOf ?? fetchedAt,
      fetchedAt,
      index: indexEntry.value?.index ?? null,
      turnover: figures?.turnover ?? null,
      sharesTraded: figures?.sharesTraded ?? null,
      transactions: figures?.transactions ?? null,
      scripsTraded: figures?.scripsTraded ?? null,
      lastError: joinErrors(indexEntry.lastError, summaryEntry.lastError),
    };
  }

  async function depth(input: string): Promise<LiveDepthResponse> {
    const symbol = input.trim().toUpperCase();
    const empty: LiveDepthResponse = {
      enabled,
      asOf: null,
      fetchedAt: null,
      symbol,
      bids: [],
      asks: [],
      lastError: null,
    };
    if (!enabled) return empty;
    if (!SYMBOL_PATTERN.test(symbol)) return { ...empty, lastError: "invalid symbol" };

    const ttl = dataTtl(await marketOpen());
    let entry = depthEntries.get(symbol);
    if (entry) {
      depthEntries.delete(symbol); // keep recently used symbols
      depthEntries.set(symbol, entry);
    } else {
      await securitiesEntry.read(SECURITY_LIST_TTL_MS);
      const securityId = securitiesEntry.value?.get(symbol);
      if (securityId === undefined) {
        return {
          ...empty,
          lastError: securitiesEntry.value
            ? `${symbol} is not in nepalstock.com's security list`
            : securitiesEntry.lastError,
        };
      }
      entry = depthEntry(symbol, securityId);
    }
    await entry.read(...ttl);
    const fetchedAt = isoOrNull(entry.fetchedAt);
    return {
      enabled: true,
      asOf: fetchedAt,
      fetchedAt,
      symbol,
      bids: entry.value?.bids ?? [],
      asks: entry.value?.asks ?? [],
      lastError: joinErrors(entry.lastError, statusEntry.lastError),
    };
  }

  async function handle(url: URL, response: ServerResponse): Promise<boolean> {
    switch (url.pathname) {
      case "/api/live/status":
        sendJson(response, 200, await status());
        return true;
      case "/api/live/market":
        sendJson(response, 200, await market());
        return true;
      case "/api/live/summary":
        sendJson(response, 200, await summary());
        return true;
      case "/api/live/depth": {
        const symbol = url.searchParams.get("symbol")?.trim().toUpperCase() ?? "";
        if (!symbol) {
          sendJson(response, 400, { error: "symbol is required" });
        } else if (!SYMBOL_PATTERN.test(symbol)) {
          sendJson(response, 400, { error: "invalid symbol" });
        } else {
          sendJson(response, 200, await depth(symbol));
        }
        return true;
      }
      case "/api/live/intraday": {
        const symbol = url.searchParams.get("symbol")?.trim().toUpperCase() ?? "";
        const kind =
          url.searchParams.get("kind") === "index" ? "index" : "equity";
        if (!symbol) {
          sendJson(response, 400, { error: "symbol is required" });
        } else if (!SYMBOL_PATTERN.test(symbol)) {
          sendJson(response, 400, { error: "invalid symbol" });
        } else {
          sendJson(response, 200, await intraday(symbol, kind));
        }
        return true;
      }
      default:
        return false;
    }
  }

  return { enabled, handle, status, market, summary, depth, intraday };
}

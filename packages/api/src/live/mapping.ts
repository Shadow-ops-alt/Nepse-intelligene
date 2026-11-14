/**
 * Defensive mapping of nepalstock.com's internal JSON into the live contract.
 *
 * Field names follow nepseman-api's types.ts plus the names the NEPSE web app
 * is known to use; every lookup tolerates missing, renamed or string-typed
 * fields and never throws on shape. Nothing here invents a value the source
 * did not publish: the only arithmetic is `change = ltp - previousClose`
 * (and its percentage) when the source gives both inputs but not the change.
 */

export interface LiveQuote {
  symbol: string;
  securityName?: string;
  ltp: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  turnover: number | null;
  lastTradedAt: string | null;
}

export interface LiveIndex {
  value: number;
  change: number | null;
  changePercent: number | null;
}

export interface LiveSummaryFigures {
  turnover: number | null;
  sharesTraded: number | null;
  transactions: number | null;
  scripsTraded: number | null;
}

export interface DepthLevel {
  price: number;
  quantity: number;
  orders?: number;
}

export interface MarketState {
  open: boolean | null;
  /** NEPSE's own `asOf` (UTC ISO) when it sends one. */
  asOf: string | null;
}

type Row = Record<string, unknown>;

/** Nepal Standard Time is UTC+05:45 (no daylight saving). */
const NPT_OFFSET_MS = (5 * 60 + 45) * 60_000;

export function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Number from a number or numeric string ("1,234.50"); otherwise null. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/,/g, "").trim();
  if (cleaned === "" || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickNumber(row: Row, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = toNumber(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function pickString(row: Row, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * NEPSE timestamps come without a zone and are Nepal time
 * ("2026-11-12T14:59:58.123456"). Return UTC ISO, or null if unparseable.
 * Epoch numbers (ms, or s if small) and zoned strings are accepted as-is.
 */
export function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value < 1e11 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  const naive = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/.exec(text);
  if (naive) {
    const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "0"] = naive;
    const ms = Number(`0.${frac}`) * 1000;
    const utc =
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Math.floor(ms)) -
      NPT_OFFSET_MS;
    return Number.isFinite(utc) ? new Date(utc).toISOString() : null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Latest of several ISO timestamps, or null. */
export function latestIso(values: Iterable<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > bestMs) {
      best = value;
      bestMs = ms;
    }
  }
  return best;
}

/** Unwrap `[...]`, `{ content: [...] }`, `{ data: [...] }` and similar. */
export function asRows(payload: unknown): Row[] {
  const list = Array.isArray(payload)
    ? payload
    : isRecord(payload)
      ? [payload.content, payload.data, payload.liveMarket, payload.rows, payload.items].find(Array.isArray)
      : undefined;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

/** `GET /api/nots/nepse-data/market-open` → `{ isOpen: "OPEN" | "CLOSE", asOf, id }`. */
export function mapMarketState(payload: unknown): MarketState {
  if (!isRecord(payload)) return { open: null, asOf: null };
  const flag = payload.isOpen ?? payload.status ?? payload.marketStatus;
  let open: boolean | null = null;
  if (typeof flag === "boolean") {
    open = flag;
  } else if (typeof flag === "string") {
    const normalized = flag.trim().toUpperCase().replace(/[\s_-]+/g, "");
    if (normalized === "OPEN") open = true;
    // CLOSE, CLOSED, PREOPEN, PRECLOSE...: not continuous trading.
    else if (/CLOSE|PRE|HALT|BREAK/.test(normalized)) open = false;
  }
  return { open, asOf: toIsoTimestamp(payload.asOf ?? payload.asOfDate) };
}

const SYMBOL_KEYS = ["symbol", "stockSymbol", "scrip", "securitySymbol"] as const;
const LTP_KEYS = ["lastTradedPrice", "ltp", "lastPrice", "closingPrice", "closePrice"] as const;
const PREVIOUS_CLOSE_KEYS = [
  "previousClose",
  "previousClosing",
  "previousDayClosePrice",
  "prevClose",
  "previousClosePrice",
] as const;

/** One row of `GET /api/nots/lives-market`, or null if it lacks symbol/LTP. */
export function mapLiveQuote(row: Row): LiveQuote | null {
  const symbol = pickString(row, SYMBOL_KEYS)?.toUpperCase();
  const ltp = pickNumber(row, LTP_KEYS);
  if (!symbol || ltp === null) return null;

  const previousClose = pickNumber(row, PREVIOUS_CLOSE_KEYS);
  const sourceChange = pickNumber(row, ["change", "pointChange", "priceChange", "schange"]);
  const change =
    sourceChange ?? (previousClose !== null ? round(ltp - previousClose, 2) : null);
  const sourcePercent = pickNumber(row, [
    "percentageChange",
    "perChange",
    "changePercent",
    "percentChange",
  ]);
  const changePercent =
    sourcePercent ??
    (previousClose !== null && previousClose !== 0
      ? round(((ltp - previousClose) / previousClose) * 100, 2)
      : null);

  const quote: LiveQuote = {
    symbol,
    ltp,
    previousClose,
    change,
    changePercent,
    open: pickNumber(row, ["openPrice", "open"]),
    high: pickNumber(row, ["highPrice", "high"]),
    low: pickNumber(row, ["lowPrice", "low"]),
    volume: pickNumber(row, [
      "totalTradeQuantity",
      "totalTradedQuantity",
      "volume",
      "shareTraded",
      "tradedQuantity",
    ]),
    turnover: pickNumber(row, ["totalTradeValue", "totalTradedValue", "turnover", "amount"]),
    lastTradedAt: toIsoTimestamp(
      row.lastUpdatedDateTime ?? row.lastUpdatedTime ?? row.lastTradedTime ?? row.lastTradedDateTime,
    ),
  };
  const securityName = pickString(row, ["securityName", "companyName", "name"]);
  if (securityName) quote.securityName = securityName;
  return quote;
}

export interface MappedLiveMarket {
  rows: LiveQuote[];
  /** Rows in the payload, mapped or not. */
  sourceRows: number;
  asOf: string | null;
}

export function mapLiveMarket(payload: unknown): MappedLiveMarket {
  const source = asRows(payload);
  const bySymbol = new Map<string, LiveQuote>();
  for (const row of source) {
    const quote = mapLiveQuote(row);
    if (quote) bySymbol.set(quote.symbol, quote);
  }
  const rows = [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    rows,
    sourceRows: source.length,
    asOf: latestIso(rows.map((row) => row.lastTradedAt)),
  };
}

/**
 * `GET /api/nots/nepse-index` → array of indices; the NEPSE index is id 58
 * (as in the package's graph endpoints) or named "NEPSE Index".
 */
export function mapNepseIndex(payload: unknown): { index: LiveIndex | null; asOf: string | null } {
  const rows = isRecord(payload) && !asRows(payload).length ? [payload] : asRows(payload);
  const nameOf = (row: Row) => pickString(row, ["index", "indexName", "name"]) ?? "";
  const match =
    rows.find((row) => toNumber(row.id) === 58 && /nepse/i.test(nameOf(row) || "nepse")) ??
    rows.find((row) => /^nepse(\s+index)?$/i.test(nameOf(row)));
  if (match) {
    // NEPSE's `close` on this endpoint is the previous session's close
    // (change ≈ currentValue - close), so it is never used as the value.
    const value = pickNumber(match, ["currentValue", "indexValue", "value"]);
    if (value !== null) {
      return {
        index: {
          value,
          change: pickNumber(match, ["change", "pointChange"]),
          changePercent: pickNumber(match, ["perChange", "percentageChange", "changePercent", "percentChange"]),
        },
        asOf: toIsoTimestamp(match.generatedTime ?? match.asOf ?? match.businessDate),
      };
    }
  }
  // nepseman-api's MarketSummary type carries the index on the summary itself.
  if (isRecord(payload)) {
    const value = pickNumber(payload, ["nepseIndex"]);
    if (value !== null) {
      return {
        index: {
          value,
          change: pickNumber(payload, ["nepseChange"]),
          changePercent: pickNumber(payload, ["nepsePercentChange", "nepseChangePercent"]),
        },
        asOf: null,
      };
    }
  }
  return { index: null, asOf: null };
}

const SUMMARY_PATTERNS: Array<[keyof LiveSummaryFigures, RegExp]> = [
  ["turnover", /turn\s*over/i],
  ["sharesTraded", /(traded\s+shares|shares?\s+traded)/i],
  ["transactions", /transaction/i],
  ["scripsTraded", /scrips?/i],
];

/**
 * `GET /api/nots/market-summary/` is an array of `{ detail, value }`
 * ("Total Turnover Rs:", "Total Traded Shares", "Total Transactions",
 * "Total Scrips Traded", ...); the package types it as an object
 * (totalTurnover, totalTradedShares, ...). Both are accepted.
 */
export function mapMarketSummary(payload: unknown): LiveSummaryFigures {
  const figures: LiveSummaryFigures = {
    turnover: null,
    sharesTraded: null,
    transactions: null,
    scripsTraded: null,
  };
  for (const row of asRows(payload)) {
    const label = pickString(row, ["detail", "label", "name", "title"]);
    const value = pickNumber(row, ["value", "amount"]);
    if (!label || value === null) continue;
    for (const [field, pattern] of SUMMARY_PATTERNS) {
      if (figures[field] === null && pattern.test(label) && !/market\s*cap/i.test(label)) {
        figures[field] = value;
        break;
      }
    }
  }
  if (isRecord(payload)) {
    figures.turnover ??= pickNumber(payload, ["totalTurnover", "turnover"]);
    figures.sharesTraded ??= pickNumber(payload, ["totalTradedShares", "totalTradedQuantity", "sharesTraded"]);
    figures.transactions ??= pickNumber(payload, ["totalTransactions", "transactions"]);
    figures.scripsTraded ??= pickNumber(payload, ["totalScripsTraded", "totalScrips", "scripsTraded"]);
  }
  return figures;
}

/** `GET /api/nots/security?nonDelisted=true` → symbol → security id. */
export function mapSecurityIds(payload: unknown): Map<string, number> {
  const ids = new Map<string, number>();
  for (const row of asRows(payload)) {
    const symbol = pickString(row, SYMBOL_KEYS)?.toUpperCase();
    const id = pickNumber(row, ["id", "securityId"]);
    if (symbol && id !== null && !ids.has(symbol)) ids.set(symbol, id);
  }
  return ids;
}

function mapDepthLevels(list: unknown): DepthLevel[] {
  if (!Array.isArray(list)) return [];
  const levels: DepthLevel[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const price = pickNumber(entry, ["orderBookOrderPrice", "price", "rate", "orderPrice"]);
    const quantity = pickNumber(entry, ["quantity", "orderQuantity", "qty", "totalQuantity"]);
    if (price === null || quantity === null) continue;
    const orders = pickNumber(entry, ["orderCount", "noOfOrders", "orders", "numberOfOrders"]);
    levels.push(orders === null ? { price, quantity } : { price, quantity, orders });
  }
  return levels;
}

/**
 * `GET /api/nots/nepse-data/marketdepth/{id}/` →
 * `{ marketDepth: { buyMarketDepthList, sellMarketDepthList }, ... }`.
 * NEPSE answers with an empty body outside trading hours (→ no levels).
 */
export function mapMarketDepth(payload: unknown): { bids: DepthLevel[]; asks: DepthLevel[] } {
  if (!isRecord(payload)) return { bids: [], asks: [] };
  const inner = isRecord(payload.marketDepth) ? payload.marketDepth : payload;
  const bids = mapDepthLevels(inner.buyMarketDepthList ?? inner.buyList ?? inner.bids ?? inner.buy);
  const asks = mapDepthLevels(inner.sellMarketDepthList ?? inner.sellList ?? inner.asks ?? inner.sell);
  bids.sort((a, b) => b.price - a.price);
  asks.sort((a, b) => a.price - b.price);
  return { bids, asks };
}

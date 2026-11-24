import type { LiveIndex, LiveQuote, LiveSummaryFigures, MarketState } from "./mapping";
import type { FetchLike } from "./session";

/** Public live-trading page used as the fallback when nepalstock.com blocks us. */
export const SHARESANSAR_PAGE = "https://www.sharesansar.com/live-trading";
export const SHARESANSAR_SOURCE = "ShareSansar Live Trading";
export const SHARESANSAR_DISCLAIMER =
  "Live data read from ShareSansar's public live-trading page. " +
  "Not provided or endorsed by NEPSE; it may be delayed, incomplete or wrong. " +
  "It is never written to the end-of-day store.";

const CACHE_TTL_MS = 30_000;
const TIMEOUT_MS = 25_000;
const MAX_BYTES = 4 * 1024 * 1024;

const AS_OF = /id="dDate"[^>]*>([\s\S]*?)<\/span>/i;
const TURNOVER =
  /<h4>\s*NEPSE Index\s*<\/h4>\s*<p\s+class="mu-price">([\s\S]*?)<\/p>/i;
const INDEX_VALUE =
  /<h4>\s*NEPSE Index\s*<\/h4>[\s\S]*?<span\s+class="mu-value([^"]*)"[^>]*>([\s\S]*?)<\/span>/i;
const INDEX_PERCENT =
  /<h4>\s*NEPSE Index\s*<\/h4>[\s\S]*?<span\s+class="mu-percent([^"]*)"[^>]*>([\s\S]*?)<\/span>/i;
const ROWS = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const CELLS = /<td[^>]*>([\s\S]*?)<\/td>/gi;
const SYMBOL = /^[A-Z0-9._-]{1,24}$/;

export interface ShareSansarSnapshot {
  state: MarketState;
  rows: LiveQuote[];
  summary: LiveSummaryFigures;
  index: LiveIndex | null;
  fetchedAt: string;
}

export interface ShareSansarReader {
  read(): Promise<ShareSansarSnapshot>;
}

export function createShareSansarReader(
  fetchImpl: FetchLike,
  now: () => number,
): ShareSansarReader {
  let cached: { at: number; value: ShareSansarSnapshot } | null = null;
  let inflight: Promise<ShareSansarSnapshot> | null = null;

  async function fetchPage(): Promise<ShareSansarSnapshot> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(SHARESANSAR_PAGE, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/131.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
          "accept-encoding": "identity",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`ShareSansar live-trading returned HTTP ${response.status}`);
      }
      const html = await response.text();
      if (html.length > MAX_BYTES) {
        throw new Error("ShareSansar live-trading page is too large");
      }
      return parse(html, new Date(now()).toISOString());
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async read() {
      if (cached && now() - cached.at < CACHE_TTL_MS) return cached.value;
      if (inflight) return inflight;
      inflight = fetchPage()
        .then((value) => {
          cached = { at: now(), value };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}

function parse(html: string, fetchedAt: string): ShareSansarSnapshot {
  const asOf = normalizeAsOf(strip(html.match(AS_OF)?.[1] ?? null));
  const open = html.includes("Market Closed")
    ? false
    : html.includes("Market Open")
      ? true
      : null;

  const turnover = number(strip(html.match(TURNOVER)?.[1] ?? null));
  const value = number(strip(html.match(INDEX_VALUE)?.[2] ?? null));
  const percentMatch = html.match(INDEX_PERCENT);
  let percent = number(strip(percentMatch?.[2] ?? null));
  if (percent !== null) {
    const classes = percentMatch?.[1] ?? "";
    const negative =
      classes.includes("text-red") || (percentMatch?.[0] ?? "").includes("fa-caret-down");
    percent = negative ? -Math.abs(percent) : Math.abs(percent);
  }
  const change =
    value !== null && percent !== null && percent > -100
      ? value - value / (1 + percent / 100)
      : null;
  const index: LiveIndex | null =
    value !== null
      ? { value, change, changePercent: percent }
      : null;

  const rows = parseRows(html);
  return {
    state: { open, asOf },
    rows,
    summary: {
      turnover,
      sharesTraded: null,
      transactions: null,
      scripsTraded: rows.length,
    },
    index,
    fetchedAt,
  };
}

function parseRows(html: string): LiveQuote[] {
  const table = html.indexOf('id="headFixed"');
  if (table < 0) return [];
  let start = html.indexOf("<tbody", table);
  let end = start >= 0 ? html.indexOf("</tbody>", start) : -1;
  if (start < 0 || end < 0) {
    start = table;
    end = html.indexOf("</table>", table);
  }
  if (end <= start) return [];

  const rows: LiveQuote[] = [];
  const body = html.slice(start, end);
  for (const match of body.matchAll(ROWS)) {
    const cells: string[] = [];
    for (const cell of (match[1] ?? "").matchAll(CELLS)) {
      cells.push(strip(cell[1] ?? null));
    }
    if (cells.length < 10) continue;
    const symbol = (cells[1] ?? "").trim().toUpperCase();
    if (!SYMBOL.test(symbol) || !/^\d+$/.test(cells[0] ?? "")) continue;
    const ltp = number(cells[2]);
    const previousClose = number(cells[9]);
    let change = number(cells[3]);
    let changePercent = number(cells[4]);
    if (ltp !== null && previousClose !== null && change === null) {
      change = ltp - previousClose;
    }
    if (
      change !== null &&
      previousClose !== null &&
      previousClose > 0 &&
      changePercent === null
    ) {
      changePercent = (change / previousClose) * 100;
    }
    if (ltp === null) continue;
    rows.push({
      symbol,
      ltp,
      previousClose,
      change,
      changePercent,
      open: number(cells[5]),
      high: number(cells[6]),
      low: number(cells[7]),
      volume: number(cells[8]),
      turnover: null,
      lastTradedAt: null,
    });
  }
  return rows;
}

function normalizeAsOf(text: string | null): string | null {
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return `${text.replace(" ", "T")}+05:45`;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  return null;
}

function strip(html: string | null | undefined): string {
  if (html === null || html === undefined) return "";
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code: string) => {
      const point = code.toLowerCase().startsWith("x")
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isFinite(point) && point > 0 ? String.fromCodePoint(point) : "";
    });
}

function number(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const cleaned = text.replace(/[,\s%]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

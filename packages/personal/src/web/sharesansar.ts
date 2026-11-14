import { load, type CheerioAPI } from "cheerio";

/** Parsers for public ShareSansar pages. Every parser is pure and lenient:
 * a missing field stays `undefined` and is never guessed. */

export const SHARESANSAR_BASE = "https://www.sharesansar.com";

export interface ShareSansarCompanyProfile {
  symbol: string;
  name?: string;
  sector?: string;
  sharesOutstanding?: number;
  paidUpValue?: number;
  totalPaidUpValue?: number;
  operationDate?: string;
  registrar?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  sourceUrl: string;
}

export interface ShareSansarMarketSummary {
  asOfDate?: string;
  turnover?: number;
  sharesTraded?: number;
  transactions?: number;
  scripsTraded?: number;
  totalMarketCap?: number;
  floatedMarketCap?: number;
  indexValue?: number;
  change?: number;
  changePercent?: number;
}

export interface ShareSansarPriceRow {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ltp: number;
  previousClose: number;
  volume: number;
  turnover: number;
  trades?: number;
  vwap?: number;
  perChange?: number;
}

export interface IndexDefinition {
  id: number;
  name: string;
  symbol: string;
  isSector: boolean;
}

export interface IndexHistoryRow {
  indexId: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change?: number;
  changePercent?: number;
  turnover?: number;
}

export interface MutualFundNavRow {
  symbol: string;
  name: string;
  fundSize?: number;
  maturityDate?: string;
  dailyNav?: number;
  dailyNavDate?: string;
  weeklyNav?: number;
  weeklyNavDate?: string;
  monthlyNav?: number;
  monthlyNavDate?: string;
  close?: number;
  publishedDate?: string;
  premiumDiscountPercent?: number;
  refundNav?: number;
}

export interface ShareSansarNewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  summary?: string;
}

export interface UpcomingIssueRow {
  symbol: string;
  companyName: string;
  type: "ipo" | "fpo" | "right" | "mutualFund" | "debenture";
  units?: number;
  amount?: number;
  applicationDate?: string;
  sebonDate?: string;
  issueManager?: string;
  remark?: string;
}

function clean(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function numberFrom(value: string | undefined | null): number | undefined {
  const cleaned = clean(value)
    .replaceAll(",", "")
    .replace(/Rs\.?/gi, "")
    .replace(/units?/gi, "")
    .replace(/%/g, "")
    .trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateFrom(value: string | undefined | null): string | undefined {
  const cleaned = clean(value);
  const iso = cleaned.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime())
    ? undefined
    : parsed.toISOString().slice(0, 10);
}

function absoluteUrl(href: string | undefined, base = SHARESANSAR_BASE): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function pairMap($: CheerioAPI, selector: string): Map<string, string> {
  const map = new Map<string, string>();
  $(selector).each((_, element) => {
    const cell = $(element);
    const label = clean(cell.text());
    const valueCell = cell.next("td");
    if (!label || valueCell.length === 0) return;
    const value = clean(valueCell.text());
    if (value) map.set(label.toLowerCase(), value);
  });
  return map;
}

export function parseCompanyProfile(
  html: string,
  symbol: string,
  sourceUrl: string,
): ShareSansarCompanyProfile {
  const $ = load(html);
  const heading = clean($("h1").first().text());
  const nameMatch = heading.match(/^(.*?)\s*\([^)]*\)\s*$/);
  const pairs = pairMap($, "td.text-bold");
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = pairs.get(key.toLowerCase());
      if (value) return value;
    }
    return undefined;
  };
  const websiteHref = $("#company-info a[target='_blank']").first().attr("href") ??
    $("td.text-bold a[href^='http'], td.text-bold a[href^='//']").first().attr("href");
  return {
    symbol: symbol.toUpperCase(),
    ...(nameMatch?.[1] ? { name: clean(nameMatch[1]) } : {}),
    ...(pick("sector") ? { sector: pick("sector")! } : {}),
    ...(numberFrom(pick("listed shares")) !== undefined
      ? { sharesOutstanding: numberFrom(pick("listed shares"))! }
      : {}),
    ...(numberFrom(pick("paid up")) !== undefined
      ? { paidUpValue: numberFrom(pick("paid up"))! }
      : {}),
    ...(numberFrom(pick("total paid up value")) !== undefined
      ? { totalPaidUpValue: numberFrom(pick("total paid up value"))! }
      : {}),
    ...(dateFrom(pick("operation date")) ? { operationDate: dateFrom(pick("operation date"))! } : {}),
    ...(pick("share registrar") ? { registrar: pick("share registrar")! } : {}),
    ...(pick("address") ? { address: pick("address")! } : {}),
    ...(pick("phone number") ? { phone: pick("phone number")! } : {}),
    ...(pick("email") ? { email: pick("email")! } : {}),
    ...(absoluteUrl(websiteHref) ? { website: absoluteUrl(websiteHref)! } : {}),
    sourceUrl,
  };
}

export function parseMarketSummary(html: string): ShareSansarMarketSummary {
  const $ = load(html);
  const asOfText = clean($("#market_symmary_data h5").first().text()) ||
    clean($("h5:contains('As of')").first().text());
  const asOfDate = dateFrom(asOfText.replace(/as of:?/i, ""));
  const summary = new Map<string, string>();
  $("#market_symmary_data tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;
    const label = clean(cells.eq(0).text()).toLowerCase();
    const value = clean(cells.eq(1).text());
    if (label) summary.set(label, value);
  });
  const get = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      for (const [label, value] of summary) {
        if (label.includes(key)) return value;
      }
    }
    return undefined;
  };
  const millions = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const parsed = numberFrom(value);
    if (parsed === undefined) return undefined;
    return /million/i.test(value) ? parsed * 1_000_000 : parsed;
  };
  return {
    ...(asOfDate ? { asOfDate } : {}),
    ...(numberFrom(get("total turnovers", "total turnover")) !== undefined
      ? { turnover: numberFrom(get("total turnovers", "total turnover"))! }
      : {}),
    ...(numberFrom(get("total traded shares")) !== undefined
      ? { sharesTraded: numberFrom(get("total traded shares"))! }
      : {}),
    ...(numberFrom(get("total transaction")) !== undefined
      ? { transactions: numberFrom(get("total transaction"))! }
      : {}),
    ...(numberFrom(get("total scrips traded")) !== undefined
      ? { scripsTraded: numberFrom(get("total scrips traded"))! }
      : {}),
    ...(millions(get("total market cap")) !== undefined
      ? { totalMarketCap: millions(get("total market cap"))! }
      : {}),
    ...(millions(get("floated market cap")) !== undefined
      ? { floatedMarketCap: millions(get("floated market cap"))! }
      : {}),
  };
}

export function parseTodaySharePrice(html: string): ShareSansarPriceRow[] {
  const $ = load(html);
  const rows: ShareSansarPriceRow[] = [];
  $("table tbody tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((__, cell) => clean($(cell).text()))
      .get();
    if (cells.length < 14) return;
    const symbol = (cells[1] ?? "").toUpperCase();
    if (!/^[A-Z0-9._-]{1,24}$/.test(symbol)) return;
    const open = numberFrom(cells[3]);
    const high = numberFrom(cells[4]);
    const low = numberFrom(cells[5]);
    const close = numberFrom(cells[6]);
    const ltp = numberFrom(cells[7]);
    const previousClose = numberFrom(cells[12]);
    const volume = numberFrom(cells[11]);
    const turnover = numberFrom(cells[13]);
    if (
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      ltp === undefined ||
      previousClose === undefined ||
      volume === undefined ||
      turnover === undefined
    ) {
      return;
    }
    if (
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      high < low ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    ) {
      return;
    }
    rows.push({
      symbol,
      open,
      high,
      low,
      close,
      ltp,
      previousClose,
      volume,
      turnover,
      ...(numberFrom(cells[14]) !== undefined
        ? { trades: numberFrom(cells[14])! }
        : {}),
      ...(numberFrom(cells[10]) !== undefined
        ? { vwap: numberFrom(cells[10])! }
        : {}),
      ...(numberFrom(cells[17]) !== undefined
        ? { perChange: numberFrom(cells[17])! }
        : {}),
    });
  });
  return rows;
}

const INDEX_SYMBOLS: Record<string, string> = {
  "banking subindex": "BANKING",
  "development bank index": "DEVELOPMENT_BANK",
  "finance index": "FINANCE",
  "float index": "FLOAT",
  "hotels and tourism": "HOTELS_TOURISM",
  "hydropower index": "HYDROPOWER",
  insurance: "INSURANCE",
  investment: "INVESTMENT",
  "life insurance": "LIFE_INSURANCE",
  "manufacturing and processing": "MANUFACTURING",
  "microfinance index": "MICROFINANCE",
  "mutual fund": "MUTUAL_FUND",
  "nepse index": "NEPSE",
  "non life insurance": "NON_LIFE_INSURANCE",
  "others index": "OTHERS",
  "sensitive float index": "SENSITIVE_FLOAT",
  "sensitive index": "SENSITIVE",
  "trading index": "TRADING",
};

export const SECTOR_INDEX_NAMES: Record<string, string> = {
  BANKING: "Commercial Banks",
  DEVELOPMENT_BANK: "Development Banks",
  FINANCE: "Finance",
  FLOAT: "Float Index",
  HOTELS_TOURISM: "Hotels and Tourism",
  HYDROPOWER: "Hydropower",
  INSURANCE: "Insurance",
  INVESTMENT: "Investment",
  LIFE_INSURANCE: "Life Insurance",
  MANUFACTURING: "Manufacturing and Processing",
  MICROFINANCE: "Microfinance",
  MUTUAL_FUND: "Mutual Fund",
  NEPSE: "NEPSE",
  NON_LIFE_INSURANCE: "Non Life Insurance",
  OTHERS: "Others",
  SENSITIVE_FLOAT: "Sensitive Float",
  SENSITIVE: "Sensitive",
  TRADING: "Trading",
};

export function parseIndexOptions(html: string): IndexDefinition[] {
  const $ = load(html);
  const definitions: IndexDefinition[] = [];
  $("#index option").each((_, option) => {
    const id = Number($(option).attr("value"));
    const name = clean($(option).text());
    if (!Number.isFinite(id) || !name) return;
    const symbol = INDEX_SYMBOLS[name.toLowerCase()] ??
      name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    definitions.push({
      id,
      name,
      symbol,
      isSector: symbol !== "NEPSE",
    });
  });
  return definitions;
}

export function parseIndexHistoryJson(
  json: string,
  indexId: number,
): IndexHistoryRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const data = (parsed as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const rows: IndexHistoryRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const date = dateFrom(String(row.published_date ?? ""));
    const open = numberFrom(String(row.open ?? ""));
    const high = numberFrom(String(row.high ?? ""));
    const low = numberFrom(String(row.low ?? ""));
    const close = numberFrom(String(row.current ?? row.close ?? ""));
    if (
      !date ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      high < low ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    ) {
      continue;
    }
    rows.push({
      indexId,
      date,
      open,
      high,
      low,
      close,
      ...(numberFrom(String(row.change_ ?? "")) !== undefined
        ? { change: numberFrom(String(row.change_ ?? ""))! }
        : {}),
      ...(numberFrom(String(row.per_change ?? "")) !== undefined
        ? { changePercent: numberFrom(String(row.per_change ?? ""))! }
        : {}),
      ...(numberFrom(String(row.turnover ?? "")) !== undefined
        ? { turnover: numberFrom(String(row.turnover ?? ""))! }
        : {}),
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

function dataRows(json: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(json) as { data?: unknown };
    return Array.isArray(parsed.data)
      ? parsed.data.filter(
          (row): row is Record<string, unknown> =>
            Boolean(row) && typeof row === "object",
        )
      : [];
  } catch {
    return [];
  }
}

export function parseMutualFundNavJson(json: string): MutualFundNavRow[] {
  const rows: MutualFundNavRow[] = [];
  for (const row of dataRows(json)) {
    const symbol = clean(String(row.symbol ?? "")).toUpperCase();
    const name = clean(String(row.companyname ?? ""));
    if (!symbol || !name) continue;
    rows.push({
      symbol,
      name,
      ...(numberFrom(String(row.fund_size ?? "")) !== undefined
        ? { fundSize: numberFrom(String(row.fund_size ?? ""))! }
        : {}),
      ...(dateFrom(String(row.maturity_date ?? ""))
        ? { maturityDate: dateFrom(String(row.maturity_date ?? ""))! }
        : {}),
      ...(numberFrom(String(row.daily_nav_price ?? "")) !== undefined
        ? { dailyNav: numberFrom(String(row.daily_nav_price ?? ""))! }
        : {}),
      ...(dateFrom(String(row.daily_date ?? ""))
        ? { dailyNavDate: dateFrom(String(row.daily_date ?? ""))! }
        : {}),
      ...(numberFrom(String(row.weekly_nav_price ?? "")) !== undefined
        ? { weeklyNav: numberFrom(String(row.weekly_nav_price ?? ""))! }
        : {}),
      ...(dateFrom(String(row.weekly_date ?? ""))
        ? { weeklyNavDate: dateFrom(String(row.weekly_date ?? ""))! }
        : {}),
      ...(numberFrom(String(row.monthly_nav_price ?? "")) !== undefined
        ? { monthlyNav: numberFrom(String(row.monthly_nav_price ?? ""))! }
        : {}),
      ...(row.monthly_date ? { monthlyNavDate: clean(String(row.monthly_date)) } : {}),
      ...(numberFrom(String(row.close ?? "")) !== undefined
        ? { close: numberFrom(String(row.close ?? ""))! }
        : {}),
      ...(dateFrom(String(row.published_date ?? ""))
        ? { publishedDate: dateFrom(String(row.published_date ?? ""))! }
        : {}),
      ...(numberFrom(String(row.prem_dis ?? "")) !== undefined
        ? { premiumDiscountPercent: numberFrom(String(row.prem_dis ?? ""))! }
        : {}),
      ...(numberFrom(String(row.refund_nav ?? "")) !== undefined
        ? { refundNav: numberFrom(String(row.refund_nav ?? ""))! }
        : {}),
    });
  }
  return rows;
}

export function parseUpcomingIssuesJson(
  json: string,
  type: UpcomingIssueRow["type"],
): UpcomingIssueRow[] {
  const rows: UpcomingIssueRow[] = [];
  for (const row of dataRows(json)) {
    const company = (row.company ?? {}) as Record<string, unknown>;
    const symbol = clean(String(company.symbol ?? ""))
      .replace(/<[^>]+>/g, "")
      .toUpperCase();
    const companyName = clean(String(company.companyname ?? ""))
      .replace(/<[^>]+>/g, "");
    if (!companyName) continue;
    rows.push({
      symbol,
      companyName,
      type,
      ...(numberFrom(String(row.total_units ?? "")) !== undefined
        ? { units: numberFrom(String(row.total_units ?? ""))! }
        : {}),
      ...(numberFrom(String(row.amount ?? "")) !== undefined
        ? { amount: numberFrom(String(row.amount ?? ""))! }
        : {}),
      ...(dateFrom(String(row.application_date ?? ""))
        ? { applicationDate: dateFrom(String(row.application_date ?? ""))! }
        : {}),
      ...(dateFrom(String(row.date_sebon ?? ""))
        ? { sebonDate: dateFrom(String(row.date_sebon ?? ""))! }
        : {}),
      ...(row.issue_manager ? { issueManager: clean(String(row.issue_manager)) } : {}),
      ...(row.remark ? { remark: clean(String(row.remark)) } : {}),
    });
  }
  return rows;
}

export function parseNews(html: string): ShareSansarNewsItem[] {
  const $ = load(html);
  const items: ShareSansarNewsItem[] = [];
  const seen = new Set<string>();
  $(".featured-news-list").each((_, element) => {
    const link = $(element).find("a[href*='/newsdetail/']").first();
    const href = absoluteUrl(link.attr("href"));
    const title = clean(link.attr("title") ?? link.find("h4").text());
    if (!href || !title) return;
    const dateText = clean($(element).find(".text-org").first().text());
    const published = new Date(dateText);
    if (Number.isNaN(published.getTime())) return;
    const idMatch = href.match(/newsdetail\/(.+)$/);
    const id = idMatch?.[1] ?? href;
    if (seen.has(id)) return;
    seen.add(id);
    items.push({
      id,
      title,
      url: href,
      // ShareSansar lists the calendar date, not a time. Noon NPT is the
      // least-surprising unambiguous timestamp for a date-only item.
      publishedAt: `${dateFrom(dateText) ?? published.toISOString().slice(0, 10)}T12:00:00+05:45`,
    });
  });
  return items;
}

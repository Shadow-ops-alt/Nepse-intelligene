import { load, type CheerioAPI } from "cheerio";
import type { ShareSansarNewsItem } from "./sharesansar";

export const MEROLAGANI_BASE = "https://merolagani.com";

export interface MerolaganiCompanyProfile {
  symbol: string;
  name?: string;
  sector?: string;
  sharesOutstanding?: number;
  listedShares?: number;
  paidUpValue?: number;
  totalPaidUpValue?: number;
  marketPrice?: number;
  marketCap?: number;
  eps?: number;
  epsFiscalYear?: string;
  epsQuarter?: number;
  peRatio?: number;
  bookValue?: number;
  pbv?: number;
  dividendPercent?: number;
  dividendFiscalYear?: string;
  bonusPercent?: number;
  bonusFiscalYear?: string;
  lastTradedAt?: string;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  sourceUrl: string;
}

export interface MerolaganiCorporateAction {
  symbol: string;
  type: "cashDividend" | "bonus" | "right";
  percent: number;
  fiscalYear?: string;
  sourceUrl: string;
}

export interface MerolaganiIndexRow {
  date: string;
  value: number;
  change?: number;
  changePercent?: number;
}

export interface MerolaganiTrade {
  contractId: string;
  symbol: string;
  buyerBroker: string;
  sellerBroker: string;
  quantity: number;
  rate: number;
  amount: number;
  date?: string;
}

export interface FloorsheetPager {
  /** All hidden ASP.NET form fields, including view state. */
  fields: Record<string, string>;
  totalPages: number;
  currentPage: number;
  currentPageField: string;
  pagingButtonField: string;
}

/** Read the hidden ASP.NET form fields and pager bounds from a floorsheet page. */
export function parseFloorsheetPager(html: string): FloorsheetPager {
  const $ = load(html);
  const fields: Record<string, string> = {};
  $("input[type='hidden']").each((_, element) => {
    const name = $(element).attr("name");
    if (!name) return;
    fields[name] = $(element).attr("value") ?? "";
  });
  const pagerText = clean($(".pagging").first().text());
  const totalPages = Number(pagerText.match(/Total pages:\s*(\d+)/i)?.[1] ?? 1);
  const currentPageField =
    Object.keys(fields).find((name) =>
      /PagerControl1\$hdnCurrentPage$/i.test(name),
    ) ?? "ctl00$ContentPlaceHolder1$PagerControl1$hdnCurrentPage";
  const pagingButtonField =
    "ctl00$ContentPlaceHolder1$PagerControl1$btnPaging";
  const currentPage = Number(fields[currentPageField] ?? "0") || 0;
  return {
    fields,
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1,
    currentPage,
    currentPageField,
    pagingButtonField,
  };
}

export interface MerolaganiIpoRow {
  companyName: string;
  symbol?: string;
  status: "upcoming" | "closed" | "listed" | "unknown";
  units?: number;
  price?: number;
  openDate?: string;
  closeDate?: string;
  sourceUrl: string;
}

function clean(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function numberFrom(value: string | undefined | null): number | undefined {
  const cleaned = clean(value)
    .replaceAll(",", "")
    .replace(/Rs\.?/gi, "")
    .replace(/%/g, "")
    .trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateFrom(value: string | undefined | null): string | undefined {
  const cleaned = clean(value);
  const iso = cleaned.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime())
    ? undefined
    : parsed.toISOString().slice(0, 10);
}

function pairs($: CheerioAPI): Map<string, string> {
  const map = new Map<string, string>();
  $("th").each((_, element) => {
    const cell = $(element);
    const label = clean(cell.text());
    const valueCell = cell.next("td");
    if (!label || valueCell.length === 0) return;
    const value = clean(valueCell.text());
    if (value) map.set(label.toLowerCase(), value);
  });
  return map;
}

function fiscalYear(value: string | undefined): string | undefined {
  const match = clean(value).match(/FY\s*:?\s*([0-9]{3}\s*[-/]\s*[0-9]{3})/i);
  return match?.[1] ? match[1].replace(/\s+/g, "") : undefined;
}

function quarter(value: string | undefined): number | undefined {
  const match = clean(value).match(/Q\s*:?\s*([1-4])/i);
  return match?.[1] ? Number(match[1]) : undefined;
}

function lastTradedAt(value: string | undefined): string | undefined {
  const match = clean(value).match(
    /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})/,
  );
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour!.padStart(2, "0")}:${minute}:${second}+05:45`;
}

export function parseCompanyProfile(
  html: string,
  symbol: string,
  sourceUrl: string,
): MerolaganiCompanyProfile {
  const $ = load(html);
  const map = pairs($);
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = map.get(key.toLowerCase());
      if (value) return value;
    }
    return undefined;
  };
  const epsRaw = pick("eps");
  const dividendRaw = pick("% dividend");
  const bonusRaw = pick("% bonus");
  const fiftyTwo = pick("52 weeks high - low", "52 weeks high/low");
  const fiftyTwoMatch = clean(fiftyTwo).match(
    /(-?[\d,.]+)\s*[-–]\s*(-?[\d,.]+)/,
  );
  return {
    symbol: symbol.toUpperCase(),
    ...(pick("company name") ? { name: pick("company name")! } : {}),
    ...(pick("sector") ? { sector: pick("sector")! } : {}),
    ...(numberFrom(pick("shares outstanding")) !== undefined
      ? { sharesOutstanding: numberFrom(pick("shares outstanding"))! }
      : {}),
    ...(numberFrom(pick("listed shares")) !== undefined
      ? { listedShares: numberFrom(pick("listed shares"))! }
      : {}),
    ...(numberFrom(pick("paidup value")) !== undefined
      ? { paidUpValue: numberFrom(pick("paidup value"))! }
      : {}),
    ...(numberFrom(pick("total paidup value")) !== undefined
      ? { totalPaidUpValue: numberFrom(pick("total paidup value"))! }
      : {}),
    ...(numberFrom(pick("market price")) !== undefined
      ? { marketPrice: numberFrom(pick("market price"))! }
      : {}),
    ...(numberFrom(pick("market capitalization")) !== undefined
      ? { marketCap: numberFrom(pick("market capitalization"))! }
      : {}),
    ...(numberFrom(epsRaw) !== undefined ? { eps: numberFrom(epsRaw)! } : {}),
    ...(fiscalYear(epsRaw) ? { epsFiscalYear: fiscalYear(epsRaw)! } : {}),
    ...(quarter(epsRaw) ? { epsQuarter: quarter(epsRaw)! } : {}),
    ...(numberFrom(pick("p/e ratio")) !== undefined
      ? { peRatio: numberFrom(pick("p/e ratio"))! }
      : {}),
    ...(numberFrom(pick("book value")) !== undefined
      ? { bookValue: numberFrom(pick("book value"))! }
      : {}),
    ...(numberFrom(pick("pbv")) !== undefined
      ? { pbv: numberFrom(pick("pbv"))! }
      : {}),
    ...(numberFrom(dividendRaw) !== undefined
      ? { dividendPercent: numberFrom(dividendRaw)! }
      : {}),
    ...(fiscalYear(dividendRaw)
      ? { dividendFiscalYear: fiscalYear(dividendRaw)! }
      : {}),
    ...(numberFrom(bonusRaw) !== undefined
      ? { bonusPercent: numberFrom(bonusRaw)! }
      : {}),
    ...(fiscalYear(bonusRaw) ? { bonusFiscalYear: fiscalYear(bonusRaw)! } : {}),
    ...(lastTradedAt(pick("last traded on"))
      ? { lastTradedAt: lastTradedAt(pick("last traded on"))! }
      : {}),
    ...(fiftyTwoMatch?.[1] ? { fiftyTwoWeekHigh: numberFrom(fiftyTwoMatch[1])! } : {}),
    ...(fiftyTwoMatch?.[2] ? { fiftyTwoWeekLow: numberFrom(fiftyTwoMatch[2])! } : {}),
    sourceUrl,
  };
}

function parseHistoryTable(
  $: CheerioAPI,
  panelId: string,
): Array<{ percent: number; fiscalYear?: string }> {
  const result: Array<{ percent: number; fiscalYear?: string }> = [];
  $(`#${panelId} tr`).each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((__, cell) => clean($(cell).text()))
      .get();
    if (cells.length < 2) return;
    const percent = numberFrom(cells[cells.length - 2]);
    if (percent === undefined) return;
    result.push({
      percent,
      ...(fiscalYear(cells[cells.length - 1])
        ? { fiscalYear: fiscalYear(cells[cells.length - 1])! }
        : {}),
    });
  });
  return result;
}

export function parseCorporateActions(
  html: string,
  symbol: string,
  sourceUrl: string,
): MerolaganiCorporateAction[] {
  const $ = load(html);
  const actions: MerolaganiCorporateAction[] = [];
  for (const entry of parseHistoryTable($, "dividend-panel")) {
    if (entry.percent <= 0) continue;
    actions.push({
      symbol: symbol.toUpperCase(),
      type: "cashDividend",
      percent: entry.percent,
      ...(entry.fiscalYear ? { fiscalYear: entry.fiscalYear } : {}),
      sourceUrl,
    });
  }
  for (const entry of parseHistoryTable($, "bonus-panel")) {
    if (entry.percent <= 0) continue;
    actions.push({
      symbol: symbol.toUpperCase(),
      type: "bonus",
      percent: entry.percent,
      ...(entry.fiscalYear ? { fiscalYear: entry.fiscalYear } : {}),
      sourceUrl,
    });
  }
  for (const entry of parseHistoryTable($, "right-panel")) {
    if (entry.percent <= 0) continue;
    actions.push({
      symbol: symbol.toUpperCase(),
      type: "right",
      percent: entry.percent,
      ...(entry.fiscalYear ? { fiscalYear: entry.fiscalYear } : {}),
      sourceUrl,
    });
  }
  return actions;
}

export function parseIndexRows(html: string): MerolaganiIndexRow[] {
  const $ = load(html);
  const rows: MerolaganiIndexRow[] = [];
  $("table tbody tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((__, cell) => clean($(cell).text()))
      .get();
    if (cells.length < 5) return;
    const date = dateFrom(cells[1]);
    const value = numberFrom(cells[2]);
    if (!date || value === undefined) return;
    rows.push({
      date,
      value,
      ...(numberFrom(cells[3]) !== undefined ? { change: numberFrom(cells[3])! } : {}),
      ...(numberFrom(cells[4]) !== undefined
        ? { changePercent: numberFrom(cells[4])! }
        : {}),
    });
  });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export function parseFloorsheet(html: string): MerolaganiTrade[] {
  const $ = load(html);
  const trades: MerolaganiTrade[] = [];
  $("table.sortable tbody tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((__, cell) => clean($(cell).text()))
      .get();
    if (cells.length < 8) return;
    const contractId = cells[1] ?? "";
    const symbol = (cells[2] ?? "").toUpperCase();
    const buyer = cells[3] ?? "";
    const seller = cells[4] ?? "";
    const quantity = numberFrom(cells[5]);
    const rate = numberFrom(cells[6]);
    const amount = numberFrom(cells[7]);
    if (
      !contractId ||
      !/^[A-Z0-9._-]{1,24}$/.test(symbol) ||
      !buyer ||
      !seller ||
      quantity === undefined ||
      quantity <= 0 ||
      rate === undefined ||
      rate <= 0 ||
      amount === undefined ||
      amount < 0
    ) {
      return;
    }
    const dateMatch = contractId.match(/^(\d{4})(\d{2})(\d{2})/);
    trades.push({
      contractId,
      symbol,
      buyerBroker: buyer,
      sellerBroker: seller,
      quantity,
      rate,
      amount,
      ...(dateMatch
        ? { date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` }
        : {}),
    });
  });
  return trades;
}

function nptTimestamp(value: string): string | undefined {
  const cleaned = clean(value);
  const match = cleaned.match(
    /([A-Za-z]{3,})\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)/i,
  );
  if (!match) return undefined;
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const month = months[(match[1] ?? "").slice(0, 3).toLowerCase()];
  if (!month) return undefined;
  let hour = Number(match[4]);
  const meridiem = (match[6] ?? "").toUpperCase();
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return `${match[3]}-${month}-${String(match[2]).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${match[5]}:00+05:45`;
}

export function parseNews(html: string): ShareSansarNewsItem[] {
  const $ = load(html);
  const items: ShareSansarNewsItem[] = [];
  const seen = new Set<string>();
  $(".media-news").each((_, element) => {
    const link = $(element).find("h4 a[href*='NewsDetail'], h4 a[href*='newsdetail']").first();
    const href = link.attr("href") ??
      $(element).find("a[href*='NewsDetail'], a[href*='newsdetail']").first().attr("href");
    const title = clean(link.text());
    if (!href || !title) return;
    const absolute = new URL(href, MEROLAGANI_BASE).toString();
    const idMatch = absolute.match(/newsID=(\d+)/i);
    const id = idMatch?.[1] ?? absolute;
    if (seen.has(id)) return;
    seen.add(id);
    const dateText = clean($(element).find(".media-label").first().text());
    const publishedAt = nptTimestamp(dateText);
    if (!publishedAt) return;
    items.push({ id, title, url: absolute, publishedAt });
  });
  return items;
}

export function parseIpos(html: string): MerolaganiIpoRow[] {
  const $ = load(html);
  const rows: MerolaganiIpoRow[] = [];
  $("table tbody tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((__, cell) => clean($(cell).text()))
      .get();
    if (cells.length < 3) return;
    const companyName = cells.find(
      (cell) => cell.length > 3 && !/^\d+$/.test(cell),
    );
    if (!companyName) return;
    rows.push({
      companyName,
      status: /upcoming/i.test(cells.join(" ")) ? "upcoming" : "unknown",
      sourceUrl: MEROLAGANI_BASE,
    });
  });
  return rows;
}

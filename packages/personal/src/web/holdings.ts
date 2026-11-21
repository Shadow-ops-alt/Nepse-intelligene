/**
 * Mutual-fund portfolio holdings from the managers' own factsheet PDFs.
 *
 * NEPSE, ShareSansar and Merolagani do not publish fund portfolios as data:
 * each manager releases a monthly factsheet PDF whose "Top ... Exposure"
 * table lists the fund's holdings as a percentage of NAV. This module
 * discovers the latest factsheet where the site exposes a stable listing
 * (currently Siddhartha Capital's WordPress media API), extracts its text and
 * turns the table into structured rows.
 *
 * Nothing is estimated. A manager without a supported discovery path simply
 * has no holdings stored, and the UI says so instead of inventing a portfolio.
 */
import { extractText, getDocumentProxy } from "unpdf";

export interface FundHolding {
  symbol: string;
  weightPercent: number;
  sector: string | null;
}

export interface FundSectorWeight {
  sector: string;
  fundPercent: number;
  marketPercent: number | null;
}

export interface FundHoldings {
  /** Fund ticker, e.g. SEF. */
  symbol: string;
  fundName: string;
  manager: string;
  /** Report month as printed, e.g. "Aswin 2083". */
  reportMonth: string | null;
  /** Publication date of the factsheet, `YYYY-MM-DD`. */
  publishedAt: string | null;
  sourceUrl: string;
  navPerUnit: number | null;
  totalAum: number | null;
  aumUnit: string | null;
  equityPositionPercent: number | null;
  holdings: FundHolding[];
  sectors: FundSectorWeight[];
}

export interface FactsheetSource {
  symbol: string;
  fundName: string;
  manager: string;
  url: string;
  publishedAt: string | null;
}

const FETCH_TIMEOUT_MS = 25_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function get(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json, text/html, application/pdf, */*",
      },
    });
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

interface WordPressMedia {
  date?: string;
  slug?: string;
  source_url?: string;
}

/**
 * Siddhartha Capital exposes every factsheet through the WordPress media
 * library. Slugs are stable (`...-sef`, `...-sef2`, `...-sigs2`,
 * `...-sigs3`), so the newest PDF per fund can be selected without scraping
 * the site's JavaScript.
 */
export const SIDDHARTHA_FUNDS: ReadonlyArray<{
  symbol: string;
  fundName: string;
  slug: RegExp;
}> = [
  {
    symbol: "SEF",
    fundName: "Siddhartha Equity Fund",
    slug: /-sef$/,
  },
  {
    symbol: "SEF2",
    fundName: "Siddhartha Equity Fund 2",
    slug: /-sef2$/,
  },
  {
    symbol: "SIGS2",
    fundName: "Siddhartha Investment Growth Scheme-2",
    slug: /-sigs2(?:-edited)?$/,
  },
  {
    symbol: "SIGS3",
    fundName: "Siddhartha Investment Growth Scheme 3",
    slug: /-sigs3$/,
  },
];

const SIDDHARTHA_MEDIA_URL =
  "https://www.siddharthacapital.com/wp-json/wp/v2/media" +
  "?search=factsheet&per_page=100&orderby=date&order=desc";

export async function discoverSiddharthaFactsheets(): Promise<
  FactsheetSource[]
> {
  const response = await get(SIDDHARTHA_MEDIA_URL);
  const entries = (await response.json()) as WordPressMedia[];
  if (!Array.isArray(entries)) {
    throw new Error("Siddhartha media listing was not an array");
  }
  const newest = new Map<string, FactsheetSource>();
  for (const entry of entries) {
    const url = entry.source_url ?? "";
    const slug = entry.slug ?? "";
    if (!url.toLowerCase().endsWith(".pdf")) continue;
    // Check the numbered funds first: `-sef$` must never claim `-sef2`.
    const fund = SIDDHARTHA_FUNDS.find((candidate) =>
      candidate.slug.test(slug),
    );
    if (!fund || newest.has(fund.symbol)) continue;
    newest.set(fund.symbol, {
      symbol: fund.symbol,
      fundName: fund.fundName,
      manager: "Siddhartha Capital Limited",
      url,
      publishedAt: entry.date ? entry.date.slice(0, 10) : null,
    });
  }
  return [...newest.values()];
}

function parseNumber(text: string | undefined): number | null {
  if (!text) return null;
  const value = Number(text.replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}

const MONTHS =
  "Baisakh|Jestha|Ashad|Shrawan|Bhadra|Aswin|Ashwin|Kartik|Mangsir|Poush|Magh|Falgun|Chaitra";

/**
 * Read the factsheet's exposure table. `knownSymbols` is the app's company
 * master and acts as a validation set, so sector rows and prose percentages
 * cannot masquerade as tickers.
 */
export function parseFactsheetText(
  text: string,
  knownSymbols: ReadonlySet<string>,
): Pick<
  FundHoldings,
  | "reportMonth"
  | "navPerUnit"
  | "totalAum"
  | "aumUnit"
  | "equityPositionPercent"
  | "holdings"
  | "sectors"
> {
  const monthMatch = new RegExp(`(${MONTHS})\\s+(\\d{4})`, "i").exec(text);
  const reportMonth = monthMatch
    ? `${monthMatch[1]!.replace(/^./, (c) => c.toUpperCase())} ${monthMatch[2]}`
    : null;

  const navMatch = /NAV per Unit\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  const aumMatch =
    /Total AUM\s*([\d,]+(?:\.\d+)?)\s*(Billion|Million|Arab|Crore)?/i.exec(
      text,
    );
  const equityMatch = /Equity Position\s*([\d.]+)\s*%/i.exec(text);

  const holdings = new Map<string, FundHolding>();
  const rowPattern =
    /(?:^|\s)([A-Z][A-Z0-9&._-]{1,14})\s+(\d{1,3}(?:\.\d+)?)\s*%\s+([A-Za-z][A-Za-z &-]{2,48})/g;
  for (const match of text.matchAll(rowPattern)) {
    const symbol = match[1]!.toUpperCase();
    const weight = Number(match[2]);
    const sector = match[3]!.replace(/\s+/g, " ").trim();
    if (!knownSymbols.has(symbol)) continue;
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) continue;
    if (holdings.has(symbol)) continue;
    holdings.set(symbol, { symbol, weightPercent: weight, sector });
  }

  const sectors = new Map<string, FundSectorWeight>();
  const sectorPattern =
    /(?:^|\n)([A-Za-z][A-Za-z &-]{2,48}?)\s+(\d{1,3}\.\d+)\s*%\s+(\d{1,3}\.\d+)\s*%/g;
  for (const match of text.matchAll(sectorPattern)) {
    const sector = match[1]!.replace(/\s+/g, " ").trim();
    if (!/^[A-Za-z]/.test(sector)) continue;
    if (sectors.has(sector)) continue;
    sectors.set(sector, {
      sector,
      fundPercent: Number(match[2]),
      marketPercent: Number(match[3]),
    });
  }

  return {
    reportMonth,
    navPerUnit: parseNumber(navMatch?.[1]),
    totalAum: parseNumber(aumMatch?.[1]),
    aumUnit: aumMatch?.[2] ?? null,
    equityPositionPercent: equityMatch ? Number(equityMatch[1]) : null,
    holdings: [...holdings.values()].sort(
      (a, b) => b.weightPercent - a.weightPercent,
    ),
    sectors: [...sectors.values()],
  };
}

export async function readFactsheetHoldings(
  source: FactsheetSource,
  knownSymbols: ReadonlySet<string>,
): Promise<FundHoldings> {
  const response = await get(source.url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  if (!text || text.length < 200) {
    throw new Error(
      `${source.symbol}: factsheet ${source.url} has no extractable text (scanned PDF)`,
    );
  }
  const parsed = parseFactsheetText(text, knownSymbols);
  if (parsed.holdings.length === 0) {
    throw new Error(
      `${source.symbol}: no holdings table found in ${source.url} (layout changed?)`,
    );
  }
  return {
    symbol: source.symbol,
    fundName: source.fundName,
    manager: source.manager,
    reportMonth: parsed.reportMonth,
    publishedAt: source.publishedAt,
    sourceUrl: source.url,
    navPerUnit: parsed.navPerUnit,
    totalAum: parsed.totalAum,
    aumUnit: parsed.aumUnit,
    equityPositionPercent: parsed.equityPositionPercent,
    holdings: parsed.holdings,
    sectors: parsed.sectors,
  };
}

/** Latest factsheets → parsed holdings. A failing fund does not stop others. */
export async function fetchAutomaticFundHoldings(
  knownSymbols: ReadonlySet<string>,
): Promise<{ funds: FundHoldings[]; errors: string[] }> {
  const errors: string[] = [];
  let sources: FactsheetSource[] = [];
  try {
    sources = await discoverSiddharthaFactsheets();
  } catch (error) {
    errors.push(
      `Siddhartha Capital factsheets: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const funds: FundHoldings[] = [];
  for (const source of sources) {
    try {
      funds.push(await readFactsheetHoldings(source, knownSymbols));
    } catch (error) {
      errors.push(
        `${source.symbol}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { funds, errors };
}

/**
 * Fundamentals model shared by the Fundamental desk and the company page.
 *
 * Data rules: every stored fundamental is UNVERIFIED (as displayed by public
 * pages). Anything computed here is DERIVED and is always returned with a
 * `derived` flag so the UI can label it. Metrics the source does not publish
 * stay null — nothing is inferred, interpolated or back-filled.
 */
import type {
  Company,
  CorporateAction,
  DataStateSummary,
  FundamentalsSnapshot,
  MetricValue,
  Provenance,
  Quote,
} from "../types";

// ---------------------------------------------------------------------------
// Response shapes for endpoints added in this feature push (page-local).
// ---------------------------------------------------------------------------

export interface FundamentalsLatestResponse {
  providerId: string;
  /** Latest snapshot per symbol. Tolerates several per symbol (merged). */
  rows: FundamentalsSnapshot[];
  provenance: Provenance | null;
  dataState: DataStateSummary;
}

export interface CorporateActionsAllResponse {
  providerId: string;
  actions: CorporateAction[];
  provenance: Provenance | null;
  dataState: DataStateSummary;
}

export interface CompanyEvent {
  symbol: string;
  type: string;
  date: string | null;
  fiscalYear: string | null;
  title: string;
  detail: string | null;
  url: string | null;
  source: string | null;
  classification: string;
  fetchedAt: string | null;
}

export interface CompanyEventsResponse {
  providerId: string;
  symbol: string | null;
  types: string[];
  events: CompanyEvent[];
  source: { file: string; modifiedAt: string } | null;
  total?: number;
  unavailableReason?: string | null;
  dataState: DataStateSummary;
}

// ---------------------------------------------------------------------------
// Canonical metrics and the stored keys they are read from.
// ---------------------------------------------------------------------------

export type Direction = "higher" | "lower" | "neutral";
export type MetricKind = "rs" | "ratio" | "percent" | "shares" | "rsBig" | "thousands";

export type CanonicalKey =
  | "eps"
  | "dilutedEps"
  | "peRatio"
  | "bookValue"
  | "pbv"
  | "roe"
  | "roa"
  | "npl"
  | "dividendPercent"
  | "bonusPercent"
  | "marketCap"
  | "sharesOutstanding"
  | "marketPrice"
  | "totalEquity";

export interface MetricDef {
  key: CanonicalKey;
  label: string;
  short: string;
  /** Stored metric keys, in order of preference. */
  sources: string[];
  kind: MetricKind;
  direction: Direction;
}

/**
 * Stored keys come from `personal:details`: Merolagani key ratios (eps,
 * peRatio, bookValue, pbv, marketCap, sharesOutstanding, marketPrice,
 * dividendPercent, bonusPercent) and the ShareSansar quarterly statement
 * (bs.*, pl.*, km.* with canonical `statement.*` aliases). Older imports used
 * `dividend` / `bonus`.
 */
export const METRICS: MetricDef[] = [
  { key: "eps", label: "EPS (Rs)", short: "EPS", sources: ["eps", "statement.eps", "km.earnings_per_share", "km.basic_earnings_per_share"], kind: "rs", direction: "higher" },
  { key: "dilutedEps", label: "Diluted EPS (Rs)", short: "Dil. EPS", sources: ["statement.dilutedEps", "km.diluted_earnings_per_share"], kind: "rs", direction: "higher" },
  { key: "peRatio", label: "P/E", short: "P/E", sources: ["peRatio", "statement.peRatio", "km.p_e_ratio", "km.price_to_earning_ratio"], kind: "ratio", direction: "lower" },
  { key: "bookValue", label: "Book value / share (Rs)", short: "BVPS", sources: ["bookValue", "statement.netWorthPerShare", "km.net_worth_per_share", "km.networth_per_share"], kind: "rs", direction: "neutral" },
  { key: "pbv", label: "P/B", short: "P/B", sources: ["pbv", "statement.pbv", "km.price_to_book_ratio"], kind: "ratio", direction: "lower" },
  { key: "roe", label: "ROE %", short: "ROE", sources: ["statement.roe", "roe", "km.return_on_equity"], kind: "percent", direction: "higher" },
  { key: "roa", label: "ROA %", short: "ROA", sources: ["statement.roa", "roa", "km.return_on_assets"], kind: "percent", direction: "higher" },
  { key: "npl", label: "NPL %", short: "NPL", sources: ["statement.npl", "npl", "km.non_performing_loan_to_total_loan"], kind: "percent", direction: "lower" },
  { key: "dividendPercent", label: "Cash dividend % of paid-up", short: "Cash div", sources: ["dividendPercent", "dividend"], kind: "percent", direction: "higher" },
  { key: "bonusPercent", label: "Bonus share %", short: "Bonus", sources: ["bonusPercent", "bonus"], kind: "percent", direction: "higher" },
  { key: "marketCap", label: "Market cap (Rs)", short: "Mkt cap", sources: ["marketCap"], kind: "rsBig", direction: "neutral" },
  { key: "sharesOutstanding", label: "Shares outstanding", short: "Shares", sources: ["sharesOutstanding", "statement.sharesOutstanding", "km.no_of_outstanding_shares"], kind: "shares", direction: "neutral" },
  { key: "marketPrice", label: "Market price as displayed (Rs)", short: "Price (src)", sources: ["marketPrice"], kind: "rs", direction: "neutral" },
  { key: "totalEquity", label: "Shareholders’ equity (Rs ’000)", short: "Equity", sources: ["statement.totalEquity", "km.total_shareholder_s_equity"], kind: "thousands", direction: "neutral" },
];

export const METRIC_BY_KEY = new Map(METRICS.map((def) => [def.key, def]));

/** One shared path per symbol so the events and dividends views share a fetch. */
export function companyEventsPath(symbol: string): string {
  return `/api/company-events?symbol=${encodeURIComponent(symbol)}&limit=1000`;
}

export function metricDef(key: CanonicalKey): MetricDef {
  return METRIC_BY_KEY.get(key)!;
}

/** Stored keys already covered by a canonical metric (hidden from "other"). */
const CANONICAL_SOURCES = new Set(METRICS.flatMap((def) => def.sources));

export const FUND_METRIC_KEYS = new Set([
  "nav",
  "navDaily",
  "navWeekly",
  "navMonthly",
  "close",
  "fundSize",
  "premiumDiscountPercent",
]);

/** A mutual fund snapshot carries only NAV-style metrics. */
export function isFundSnapshot(snapshot: FundamentalsSnapshot): boolean {
  const keys = Object.keys(snapshot.metrics);
  return keys.length > 0 && keys.every((key) => FUND_METRIC_KEYS.has(key));
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/** Bikram Sambat start year from "083-084", "2083/84", "FY082/83" … */
export function fiscalYearStart(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d{2,4})\s*[-/]\s*(\d{2,4})/);
  if (!match?.[1]) return null;
  const first = Number(match[1]);
  if (!Number.isFinite(first)) return null;
  return first < 1000 ? 2000 + first : first;
}

/** "082-083" → "082/83" style label used across the desk. */
export function fiscalYearLabel(text: string | null | undefined): string | null {
  const start = fiscalYearStart(text);
  if (start === null) return text ?? null;
  const end = String((start + 1) % 100).padStart(2, "0");
  return `${start}/${end}`;
}

function quarterOf(
  metric: MetricValue | undefined,
  snapshot: FundamentalsSnapshot | undefined,
): number {
  return metric?.quarter ?? snapshot?.quarter ?? 0;
}

/** Sortable rank for a value: fiscal year, then quarter, then fetch date. */
export function valueRank(
  metric: MetricValue | undefined,
  snapshot: FundamentalsSnapshot | undefined,
): string {
  const fy =
    fiscalYearStart(metric?.fiscalYear) ??
    fiscalYearStart(snapshot?.fiscalYear) ??
    fiscalYearStart(snapshot?.period);
  const reported = metric?.reportedAt ?? snapshot?.reportedAt ?? "";
  return `${fy === null ? "0000" : String(fy)}|${quarterOf(metric, snapshot)}|${reported}`;
}

export function snapshotRank(snapshot: FundamentalsSnapshot): string {
  return valueRank(undefined, snapshot);
}

/** Oldest → newest by fiscal year / quarter / reported date. */
export function sortSnapshots(snapshots: FundamentalsSnapshot[]): FundamentalsSnapshot[] {
  return [...snapshots].sort((a, b) => {
    const rank = snapshotRank(a).localeCompare(snapshotRank(b));
    return rank !== 0 ? rank : a.period.localeCompare(b.period);
  });
}

// ---------------------------------------------------------------------------
// Merging several period snapshots of one symbol
// ---------------------------------------------------------------------------

export interface StoredValue {
  key: string;
  value: number;
  metric: MetricValue;
  period: string;
  rank: string;
}

export interface MergedFundamentals {
  symbol: string;
  /** Latest value of every stored metric key, across periods. */
  values: Map<string, StoredValue>;
  /** Snapshots oldest → newest. */
  snapshots: FundamentalsSnapshot[];
  /** Newest reportedAt among the values. */
  reportedAt: string | null;
  /** Sources seen (merolagani, sharesansar, …). */
  sources: string[];
}

export function mergeSnapshots(
  symbol: string,
  snapshots: FundamentalsSnapshot[],
): MergedFundamentals {
  const values = new Map<string, StoredValue>();
  const sources = new Set<string>();
  let reportedAt: string | null = null;
  for (const snapshot of snapshots) {
    for (const [key, metric] of Object.entries(snapshot.metrics)) {
      if (metric.value === null || !Number.isFinite(metric.value)) continue;
      const rank = valueRank(metric, snapshot);
      const current = values.get(key);
      if (!current || rank > current.rank) {
        values.set(key, { key, value: metric.value, metric, period: snapshot.period, rank });
      }
      if (metric.source) sources.add(metric.source);
      const reported = metric.reportedAt ?? snapshot.reportedAt ?? null;
      if (reported && (!reportedAt || reported > reportedAt)) reportedAt = reported;
    }
  }
  // The same period can arrive twice (latest + history); keep one per period.
  const byPeriod = new Map<string, FundamentalsSnapshot>();
  for (const snapshot of snapshots) {
    const existing = byPeriod.get(snapshot.period);
    byPeriod.set(
      snapshot.period,
      existing ? { ...existing, ...snapshot, metrics: { ...existing.metrics, ...snapshot.metrics } } : snapshot,
    );
  }
  return {
    symbol,
    values,
    snapshots: sortSnapshots([...byPeriod.values()]),
    reportedAt,
    sources: [...sources].sort(),
  };
}

/** Group snapshot rows by symbol and merge each group. */
export function mergeRows(rows: FundamentalsSnapshot[]): Map<string, MergedFundamentals> {
  const groups = new Map<string, FundamentalsSnapshot[]>();
  for (const row of rows) {
    const symbol = row.symbol.toUpperCase();
    const list = groups.get(symbol) ?? [];
    list.push(row);
    groups.set(symbol, list);
  }
  const merged = new Map<string, MergedFundamentals>();
  for (const [symbol, list] of groups) merged.set(symbol, mergeSnapshots(symbol, list));
  return merged;
}

/** Canonical value from merged data, honouring the source preference order. */
export function pick(merged: MergedFundamentals | null | undefined, key: CanonicalKey): StoredValue | null {
  if (!merged) return null;
  for (const source of metricDef(key).sources) {
    const value = merged.values.get(source);
    if (value) return value;
  }
  return null;
}

/** Canonical value from a single period snapshot. */
export function pickInSnapshot(snapshot: FundamentalsSnapshot, key: CanonicalKey): number | null {
  for (const source of metricDef(key).sources) {
    const metric = snapshot.metrics[source];
    if (metric && metric.value !== null && Number.isFinite(metric.value)) return metric.value;
  }
  return null;
}

/** Human label for a stored statement key (from its notes, else the key). */
export function storedLabel(key: string, metric?: MetricValue): string {
  const fromNotes = metric?.notes?.split(" · ")[0]?.trim();
  if (fromNotes && !/^(reported|cash dividend|bonus share)/i.test(fromNotes) && key.includes(".")) {
    return fromNotes;
  }
  const tail = key.includes(".") ? key.slice(key.indexOf(".") + 1) : key;
  return tail.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

export type StatementGroup = "km" | "pl" | "bs" | "other";

/** Stored keys not covered by a canonical metric, grouped by statement. */
export function otherKeys(merged: MergedFundamentals[]): Record<StatementGroup, string[]> {
  const groups: Record<StatementGroup, Set<string>> = {
    km: new Set(),
    pl: new Set(),
    bs: new Set(),
    other: new Set(),
  };
  for (const entry of merged) {
    for (const key of entry.values.keys()) {
      if (CANONICAL_SOURCES.has(key) || FUND_METRIC_KEYS.has(key)) continue;
      if (key.startsWith("statement.")) continue;
      const prefix = key.split(".")[0];
      if (prefix === "km" || prefix === "pl" || prefix === "bs") groups[prefix].add(key);
      else groups.other.add(key);
    }
  }
  return {
    km: [...groups.km].sort(),
    pl: [...groups.pl].sort(),
    bs: [...groups.bs].sort(),
    other: [...groups.other].sort(),
  };
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

export interface Val {
  value: number | null;
  derived: boolean;
  /** How the value was obtained (tooltip / CSV). */
  note: string;
  period?: string;
}

export const NONE: Val = { value: null, derived: false, note: "not published by the stored source" };

function published(stored: StoredValue | null): Val | null {
  if (!stored) return null;
  const source = stored.metric.source ? ` (${stored.metric.source})` : "";
  const fy = stored.metric.fiscalYear ? ` · FY ${fiscalYearLabel(stored.metric.fiscalYear)}` : "";
  const q = stored.metric.quarter ? ` Q${stored.metric.quarter}` : "";
  return {
    value: stored.value,
    derived: false,
    note: `as displayed${source}${fy}${q} · ${stored.key}`,
    period: stored.period,
  };
}

function derived(value: number | null, note: string): Val {
  return value === null || !Number.isFinite(value)
    ? { ...NONE, note: `cannot derive: ${note}` }
    : { value, derived: true, note: `derived: ${note}` };
}

export type CapClass = "Large" | "High" | "Mid" | "Low";

export const CAP_RULE =
  "Cap class ranks every listed equity with a market cap (published, else shares outstanding × last close) — the same rule as the Screener: Large = top 10%, High = next 20%, Mid = next 30%, Low = remaining 40%.";

/**
 * Market cap: published key-ratio value → published profile value →
 * shares × last close (derived) → profile value the details run derived.
 */
export function resolveMarketCap(
  merged: MergedFundamentals | null | undefined,
  company: Company | undefined,
  close: number | null,
): Val {
  const metric = published(pick(merged, "marketCap"));
  if (metric) return metric;
  const profileDerived = /derived/i.test(company?.profileSource ?? "");
  if (company?.marketCap && company.marketCap > 0 && !profileDerived) {
    return {
      value: company.marketCap,
      derived: false,
      note: `as displayed (company profile${company.profileSource ? `: ${company.profileSource}` : ""})`,
    };
  }
  const shares = pick(merged, "sharesOutstanding")?.value ?? company?.sharesOutstanding ?? null;
  if (shares !== null && shares > 0 && close !== null && close > 0) {
    return derived(shares * close, "shares outstanding × last close");
  }
  if (company?.marketCap && company.marketCap > 0) {
    return { value: company.marketCap, derived: true, note: "derived when profiles were fetched (shares × close then)" };
  }
  return { ...NONE, note: "no market cap or shares outstanding stored" };
}

/** Assign cap classes by rank among all values (descending). */
export function capClasses(caps: Map<string, number>): Map<string, CapClass> {
  const entries = [...caps.entries()]
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1]);
  const result = new Map<string, CapClass>();
  const n = entries.length;
  let previousValue: number | null = null;
  let tierIndex = 0;
  entries.forEach(([symbol, value], index) => {
    if (value !== previousValue) tierIndex = index;
    previousValue = value;
    const share = tierIndex / n;
    result.set(symbol, share < 0.1 ? "Large" : share < 0.3 ? "High" : share < 0.6 ? "Mid" : "Low");
  });
  return result;
}

/** Same universe as the Screener's cap classes: equity instruments only. */
export function isRankedEquity(company: Company): boolean {
  return company.instrumentType === "Equity";
}

/**
 * Market cap of every listed equity. `merged` supplies published
 * fundamentals where loaded; the company master and quotes cover the rest.
 */
export function marketCapUniverse(
  companies: Company[],
  closes: Map<string, number>,
  merged: Map<string, MergedFundamentals>,
): Map<string, Val> {
  const result = new Map<string, Val>();
  for (const company of companies) {
    if (!isRankedEquity(company)) continue;
    const cap = resolveMarketCap(merged.get(company.symbol), company, closes.get(company.symbol) ?? null);
    if (cap.value !== null && cap.value > 0) result.set(company.symbol, cap);
  }
  return result;
}

export function closeMap(quotes: Quote[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const quote of quotes) {
    if (Number.isFinite(quote.ltp) && quote.ltp > 0) map.set(quote.symbol.toUpperCase(), quote.ltp);
  }
  return map;
}

export interface Ratios {
  eps: Val;
  pe: Val;
  bvps: Val;
  pb: Val;
  roe: Val;
  roa: Val;
  npl: Val;
  dividend: Val;
  bonus: Val;
  earningsYield: Val;
}

/** Published ratios with clearly-labelled derived fallbacks. */
export function ratios(merged: MergedFundamentals | null | undefined, close: number | null): Ratios {
  const epsStored = pick(merged, "eps");
  const eps = published(epsStored) ?? NONE;
  // Merolagani labels EPS with a quarter; a Q1–Q3 figure may be part-year.
  const quarter = epsStored?.key === "eps" ? (epsStored.metric.quarter ?? 0) : 0;
  const partYear = quarter >= 1 && quarter <= 3 ? ` (EPS labelled Q${quarter}; may be part-year)` : "";
  const bvps = published(pick(merged, "bookValue")) ?? NONE;
  const epsValue = eps.value;
  const bvpsValue = bvps.value;
  const closeOk = close !== null && close > 0;

  const pe =
    published(pick(merged, "peRatio")) ??
    (closeOk && epsValue !== null && epsValue > 0
      ? derived(close / epsValue, `last close ÷ EPS${partYear}`)
      : { ...NONE, note: epsValue !== null && epsValue <= 0 ? "not meaningful (EPS ≤ 0)" : NONE.note });
  const pb =
    published(pick(merged, "pbv")) ??
    (closeOk && bvpsValue !== null && bvpsValue > 0
      ? derived(close / bvpsValue, "last close ÷ book value per share")
      : NONE);
  const roe =
    published(pick(merged, "roe")) ??
    (epsValue !== null && bvpsValue !== null && bvpsValue > 0
      ? derived((epsValue / bvpsValue) * 100, `≈ EPS ÷ book value per share × 100${partYear}`)
      : NONE);
  const earningsYield =
    closeOk && epsValue !== null
      ? derived((epsValue / close) * 100, `EPS ÷ last close × 100${partYear}`)
      : NONE;
  return {
    eps,
    pe,
    bvps,
    pb,
    roe,
    roa: published(pick(merged, "roa")) ?? NONE,
    npl: published(pick(merged, "npl")) ?? NONE,
    dividend: published(pick(merged, "dividendPercent")) ?? NONE,
    bonus: published(pick(merged, "bonusPercent")) ?? NONE,
    earningsYield,
  };
}

// ---------------------------------------------------------------------------
// Corporate actions (dividends & rights)
// ---------------------------------------------------------------------------

export function actionFiscalYear(action: CorporateAction): string | null {
  const text = `${action.notes ?? ""} ${action.ratio ?? ""}`;
  const match = text.match(/FY\s*:?\s*([0-9]{2,4}\s*[-/]\s*[0-9]{2,4})/i);
  return match?.[1] ? match[1].replace(/\s+/g, "") : null;
}

export function actionPercent(action: CorporateAction): number | null {
  if (action.value !== undefined && Number.isFinite(action.value)) return action.value;
  const match = action.ratio?.match(/(-?[\d.]+)\s*%/);
  return match?.[1] ? Number(match[1]) : null;
}

export function actionKind(type: string): "cash" | "bonus" | "right" | "other" {
  const lower = type.toLowerCase();
  if (lower.includes("cash") || lower === "dividend") return "cash";
  if (lower.includes("bonus") || lower.includes("stock")) return "bonus";
  if (lower.includes("right")) return "right";
  return "other";
}

export interface DividendYear {
  fiscalYear: string;
  start: number;
  cash: number | null;
  bonus: number | null;
  right: string | null;
  /** Which public pages list this year (merolagani, sharesansar). */
  sources: string[];
  /** Set when the two pages disagree; the Merolagani value is kept. */
  conflict: string | null;
}

function percentIn(text: string, label: string): number | null {
  const match = text.match(new RegExp(`${label}\\s*([\\d.]+)\\s*%`, "i"));
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Per fiscal year cash/bonus/right, newest first. Merolagani corporate
 * actions come first; ShareSansar dividend events (from company-events)
 * fill years or bonus figures Merolagani does not list. A disagreement is
 * reported, never averaged away.
 */
export function dividendYears(actions: CorporateAction[], events: CompanyEvent[] = []): DividendYear[] {
  const years = new Map<number, DividendYear>();
  const entryFor = (start: number, fy: string | null): DividendYear => {
    const existing = years.get(start);
    if (existing) return existing;
    const created: DividendYear = {
      fiscalYear: fiscalYearLabel(fy) ?? String(start),
      start,
      cash: null,
      bonus: null,
      right: null,
      sources: [],
      conflict: null,
    };
    years.set(start, created);
    return created;
  };
  for (const action of actions) {
    const fy = actionFiscalYear(action);
    const start = fiscalYearStart(fy);
    if (start === null) continue;
    const entry = entryFor(start, fy);
    const kind = actionKind(action.type);
    const percent = actionPercent(action);
    if (kind === "cash" && percent !== null) entry.cash = (entry.cash ?? 0) + percent;
    if (kind === "bonus" && percent !== null) entry.bonus = (entry.bonus ?? 0) + percent;
    if (kind === "right") entry.right = action.ratio ?? (percent !== null ? `${percent}%` : "yes");
    if (!entry.sources.includes("merolagani")) entry.sources.push("merolagani");
  }
  // Newest announcement per fiscal year only (revisions are listed again).
  const seen = new Set<number>();
  const dividendEvents = events
    .filter((event) => event.type === "dividend")
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  for (const event of dividendEvents) {
    const start = fiscalYearStart(event.fiscalYear);
    if (start === null || seen.has(start)) continue;
    seen.add(start);
    const cash = percentIn(event.title, "Cash");
    const bonus = percentIn(event.title, "Bonus");
    if (cash === null && bonus === null) continue;
    const entry = entryFor(start, event.fiscalYear);
    const conflicts: string[] = [];
    if (cash !== null) {
      if (entry.cash === null) entry.cash = cash;
      else if (Math.abs(entry.cash - cash) > 0.01) conflicts.push(`ShareSansar lists cash ${cash}%`);
    }
    if (bonus !== null) {
      if (entry.bonus === null) entry.bonus = bonus;
      else if (Math.abs(entry.bonus - bonus) > 0.01) conflicts.push(`ShareSansar lists bonus ${bonus}%`);
    }
    if (conflicts.length > 0) entry.conflict = conflicts.join("; ");
    if (!entry.sources.includes("sharesansar")) entry.sources.push("sharesansar");
  }
  return [...years.values()].sort((a, b) => b.start - a.start);
}

export interface DividendSummary {
  years: DividendYear[];
  cashAverage: number | null;
  bonusAverage: number | null;
  cashYears: number;
  bonusYears: number;
}

/** The five most recent fiscal years the sources list, with averages. */
export function fiveYearDividends(actions: CorporateAction[], events: CompanyEvent[] = []): DividendSummary {
  const years = dividendYears(actions, events).slice(0, 5);
  const cash = years.map((year) => year.cash).filter((v): v is number => v !== null);
  const bonus = years.map((year) => year.bonus).filter((v): v is number => v !== null);
  const avg = (values: number[]) =>
    values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  return {
    years,
    cashAverage: avg(cash),
    bonusAverage: avg(bonus),
    cashYears: cash.length,
    bonusYears: bonus.length,
  };
}

// ---------------------------------------------------------------------------
// Statistics and formatting
// ---------------------------------------------------------------------------

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

/** NPR amounts in crore/arab are easier to read for NEPSE users. */
export function formatRsBig(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `Rs ${(value / 1e9).toLocaleString("en-US", { maximumFractionDigits: 2 })} arab`;
  if (abs >= 1e7) return `Rs ${(value / 1e7).toLocaleString("en-US", { maximumFractionDigits: 2 })} cr`;
  if (abs >= 1e5) return `Rs ${(value / 1e5).toLocaleString("en-US", { maximumFractionDigits: 2 })} lakh`;
  return `Rs ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function formatKind(value: number | null | undefined, kind: MetricKind): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  switch (kind) {
    case "rs":
      return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "ratio":
      return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
    case "percent":
      return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
    case "shares":
      return compact.format(value);
    case "rsBig":
      return formatRsBig(value);
    case "thousands":
      return formatRsBig(value * 1000);
  }
}

/** Unit-aware formatting for an arbitrary stored metric. */
export function formatStored(metric: MetricValue | undefined, key = ""): string {
  if (!metric || metric.value === null || !Number.isFinite(metric.value)) return "—";
  const value = metric.value;
  if (metric.unit === "percent") return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  if (metric.unit === "ratio") return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (metric.unit === "shares") return compact.format(value);
  if (metric.unit === "currency") {
    const thousands = /rs\.? ?'000/i.test(metric.notes ?? "") || key.startsWith("bs.") || key.startsWith("pl.");
    if (thousands) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
    return Math.abs(value) >= 1e6 ? formatRsBig(value) : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

/** "best" index among values for a direction; null when not comparable. */
export function bestIndex(values: Array<number | null>, direction: Direction): number[] {
  if (direction === "neutral") return [];
  const present = values
    .map((value, index) => ({ value, index }))
    .filter((entry): entry is { value: number; index: number } => entry.value !== null && Number.isFinite(entry.value));
  if (present.length < 2) return [];
  const target =
    direction === "higher"
      ? Math.max(...present.map((entry) => entry.value))
      : Math.min(...present.map((entry) => entry.value));
  return present.filter((entry) => entry.value === target).map((entry) => entry.index);
}

// ---------------------------------------------------------------------------
// Price performance helpers (derived from stored candles)
// ---------------------------------------------------------------------------

export interface YearReturn {
  year: number;
  returnPercent: number | null;
  /** True for the current, incomplete calendar year. */
  partial: boolean;
}

/**
 * Calendar-year returns from the last stored close of each year versus the
 * previous year's last close. A year without a stored previous year-end is
 * null (never bridged).
 */
export function calendarYearReturns(
  candles: Array<{ timestamp: string; close: number }>,
  years: number,
  currentYear: number,
): YearReturn[] {
  const lastByYear = new Map<number, number>();
  const sorted = [...candles].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (const candle of sorted) {
    lastByYear.set(Number(candle.timestamp.slice(0, 4)), candle.close);
  }
  const result: YearReturn[] = [];
  for (let year = currentYear - years + 1; year <= currentYear; year += 1) {
    const end = lastByYear.get(year);
    const start = lastByYear.get(year - 1);
    result.push({
      year,
      returnPercent:
        end !== undefined && start !== undefined && start > 0
          ? Math.round((end / start - 1) * 10_000) / 100
          : null,
      partial: year === currentYear,
    });
  }
  return result;
}

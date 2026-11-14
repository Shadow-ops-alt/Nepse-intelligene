import { useMemo, useState } from "react";
import { formatNumber } from "../api";
import type { CompaniesResponse, Company, FundamentalsSnapshot, QuotesResponse } from "../types";
import {
  Badge,
  Card,
  ClickableRow,
  EmptyState,
  Notice,
  SortHeader,
  Spinner,
  Stat,
  Tabs,
  downloadCsv,
  useSort,
} from "../components/ui";
import { Icon } from "../components/icons";
import {
  CAP_RULE,
  capClasses,
  closeMap,
  fiscalYearLabel,
  formatKind,
  isFundSnapshot,
  marketCapUniverse,
  median,
  mergeRows,
  pick,
  ratios,
  resolveMarketCap,
  type CapClass,
  type FundamentalsLatestResponse,
  type MergedFundamentals,
  type MetricKind,
  type Ratios,
  type Val,
} from "../fundamentals/model";
import { CapBadge, MissingData, ProvenanceLine, ValCell } from "../fundamentals/parts";
import { useCachedApi } from "../fundamentals/useCachedApi";
import { useFundamentalsHistory } from "../fundamentals/useHistory";
import { ComparePanel } from "../fundamentals/ComparePanel";

type DeskTab = "screen" | "compare" | "sectors";

export interface ScreenRow {
  symbol: string;
  name: string;
  sector: string;
  period: string | null;
  close: number | null;
  r: Ratios;
  marketCap: Val;
  capClass: CapClass | null;
  asOf: string | null;
  sources: string[];
  hasStatement: boolean;
}

type SortKey =
  | "symbol"
  | "sector"
  | "period"
  | "close"
  | "eps"
  | "pe"
  | "bvps"
  | "pb"
  | "roe"
  | "roa"
  | "npl"
  | "dividend"
  | "bonus"
  | "earningsYield"
  | "marketCap"
  | "capClass"
  | "asOf";

const CAP_ORDER: Record<CapClass, number> = { Large: 4, High: 3, Mid: 2, Low: 1 };
const CAP_CLASSES: CapClass[] = ["Large", "High", "Mid", "Low"];

type PresetId = "all" | "value" | "quality" | "dividend" | "banks-npl";

interface Preset {
  id: PresetId;
  label: string;
  rule: string;
  test: (row: ScreenRow) => boolean;
}

const v = (val: Val): number | null => val.value;

const PRESETS: Preset[] = [
  { id: "all", label: "All", rule: "No preset", test: () => true },
  {
    id: "value",
    label: "Value (P/E<20 & P/B<2)",
    rule: "0 < P/E < 20 and 0 < P/B < 2 (published, else derived from the last close)",
    test: (row) => {
      const pe = v(row.r.pe);
      const pb = v(row.r.pb);
      return pe !== null && pe > 0 && pe < 20 && pb !== null && pb > 0 && pb < 2;
    },
  },
  {
    id: "quality",
    label: "Quality (ROE>15)",
    rule: "ROE > 15% (published; ≈ EPS ÷ BVPS when unpublished, marked d)",
    test: (row) => (v(row.r.roe) ?? -Infinity) > 15,
  },
  {
    id: "dividend",
    label: "High dividend",
    rule: "Latest listed cash dividend ≥ 10% of paid-up value",
    test: (row) => (v(row.r.dividend) ?? -Infinity) >= 10,
  },
  {
    id: "banks-npl",
    label: "Banks NPL<2%",
    rule: "Bank sectors with a published NPL below 2%",
    test: (row) => /bank/i.test(row.sector) && (v(row.r.npl) ?? Infinity) < 2,
  },
];

export interface ScreenFilters {
  search: string;
  sector: string;
  cap: CapClass | "all";
  minPe: string;
  maxPe: string;
  minRoe: string;
  preset: PresetId;
}

const DEFAULT_FILTERS: ScreenFilters = {
  search: "",
  sector: "all",
  cap: "all",
  minPe: "",
  maxPe: "",
  minRoe: "",
  preset: "all",
};

function parseBound(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function periodLabel(merged: MergedFundamentals): string | null {
  const eps = pick(merged, "eps");
  if (eps?.metric.fiscalYear) {
    return `FY ${fiscalYearLabel(eps.metric.fiscalYear)}${eps.metric.quarter ? ` Q${eps.metric.quarter}` : ""}`;
  }
  return merged.snapshots.at(-1)?.period ?? null;
}

export interface DeskUniverse {
  rows: ScreenRow[];
  funds: number;
  capRanked: number;
  merged: Map<string, MergedFundamentals>;
  companyBySymbol: Map<string, Company>;
  closes: Map<string, number>;
  capClassBySymbol: Map<string, CapClass>;
}

function buildUniverse(
  snapshots: FundamentalsSnapshot[],
  companies: Company[],
  closes: Map<string, number>,
): DeskUniverse {
  const merged = mergeRows(snapshots);
  const companyBySymbol = new Map(companies.map((company) => [company.symbol.toUpperCase(), company]));
  const caps = marketCapUniverse(companies, closes, merged);
  const capClassBySymbol = capClasses(
    new Map([...caps.entries()].map(([symbol, cap]) => [symbol, cap.value ?? 0])),
  );
  const rows: ScreenRow[] = [];
  let funds = 0;
  for (const [symbol, entry] of merged) {
    const snapshots = entry.snapshots;
    if (snapshots.length > 0 && snapshots.every(isFundSnapshot)) {
      funds += 1;
      continue;
    }
    const company = companyBySymbol.get(symbol);
    const close = closes.get(symbol) ?? null;
    rows.push({
      symbol,
      name: company?.name ?? "",
      sector: company?.sector ?? "Unclassified",
      period: periodLabel(entry),
      close,
      r: ratios(entry, close),
      marketCap: caps.get(symbol) ?? resolveMarketCap(entry, company, close),
      capClass: capClassBySymbol.get(symbol) ?? null,
      asOf: entry.reportedAt,
      sources: entry.sources,
      hasStatement: [...entry.values.keys()].some((key) => key.startsWith("bs.") || key.startsWith("pl.")),
    });
  }
  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { rows, funds, capRanked: caps.size, merged, companyBySymbol, closes, capClassBySymbol };
}

interface CoverageItem {
  label: string;
  published: number;
  derived: number;
}

function coverage(rows: ScreenRow[]): CoverageItem[] {
  const count = (get: (row: ScreenRow) => Val): CoverageItem & { label: string } => ({
    label: "",
    published: rows.filter((row) => get(row).value !== null && !get(row).derived).length,
    derived: rows.filter((row) => get(row).value !== null && get(row).derived).length,
  });
  return [
    { ...count((row) => row.r.eps), label: "EPS" },
    { ...count((row) => row.r.pe), label: "P/E" },
    { ...count((row) => row.r.bvps), label: "Book value/share" },
    { ...count((row) => row.r.pb), label: "P/B" },
    { ...count((row) => row.r.roe), label: "ROE" },
    { ...count((row) => row.r.roa), label: "ROA" },
    { ...count((row) => row.r.npl), label: "NPL" },
    { ...count((row) => row.r.dividend), label: "Cash dividend" },
    { ...count((row) => row.r.bonus), label: "Bonus" },
    { ...count((row) => row.marketCap), label: "Market cap" },
  ];
}

export function FundamentalsPage({ onOpenSymbol }: { onOpenSymbol: (s: string) => void }) {
  const [tab, setTab] = useState<DeskTab>("screen");
  const [filters, setFilters] = useState<ScreenFilters>(DEFAULT_FILTERS);
  const latestState = useCachedApi<FundamentalsLatestResponse>("/api/fundamentals/latest");
  const companiesState = useCachedApi<CompaniesResponse>("/api/companies");
  const quotesState = useCachedApi<QuotesResponse>("/api/quotes");

  const closes = useMemo(() => closeMap(quotesState.data?.quotes ?? []), [quotesState.data]);
  // Symbols whose latest stored period carries no quarterly-statement keys:
  // their other periods (ROE, ROA, NPL …) are merged from per-symbol history.
  const needsHistory = useMemo(() => {
    const merged = mergeRows(latestState.data?.rows ?? []);
    return [...merged.values()]
      .filter(
        (entry) =>
          !entry.snapshots.every(isFundSnapshot) &&
          ![...entry.values.keys()].some((key) => /^(bs|pl|km|statement)\./.test(key)),
      )
      .map((entry) => entry.symbol)
      .sort();
  }, [latestState.data]);
  const history = useFundamentalsHistory(needsHistory);
  const snapshots = useMemo(
    () => [...(latestState.data?.rows ?? []), ...history.rows],
    [latestState.data, history.rows],
  );
  const universe = useMemo(
    () => buildUniverse(snapshots, companiesState.data?.companies ?? [], closes),
    [snapshots, companiesState.data, closes],
  );
  const cov = useMemo(() => coverage(universe.rows), [universe.rows]);

  if (latestState.loading || companiesState.loading) {
    return <Spinner label="Loading stored fundamentals" />;
  }

  const total = universe.rows.length;
  const covOf = (label: string) => cov.find((item) => item.label === label);

  return (
    <div className="stack">
      <div className="stats-row">
        <Stat
          label="Companies with fundamentals"
          value={total}
          hint={`${universe.funds} mutual funds excluded (NAV only)`}
        />
        <Stat
          label="EPS published"
          value={`${covOf("EPS")?.published ?? 0} / ${total}`}
          hint="as displayed, unverified"
        />
        <Stat
          label="ROE published"
          value={`${covOf("ROE")?.published ?? 0} / ${total}`}
          hint={`${covOf("ROE")?.derived ?? 0} more ≈ EPS ÷ BVPS (derived)`}
        />
        <Stat
          label="NPL published"
          value={`${covOf("NPL")?.published ?? 0} / ${total}`}
          hint="banks & financials only; never computed"
        />
        <Stat
          label="Cap-class universe"
          value={universe.capRanked}
          hint="listed equities with a market cap (same rule as Screener)"
        />
      </div>

      {history.total > 0 && history.done < history.total && (
        <Notice tone="info">
          Merging stored statement periods: {history.done} / {history.total} companies.
          The latest-per-symbol feed holds one period each, so ROE, ROA and NPL from the
          quarterly statement are read from each company’s stored history.
        </Notice>
      )}

      <Card>
        <Tabs<DeskTab>
          label="Fundamental desk"
          value={tab}
          onChange={setTab}
          items={[
            { value: "screen", label: "Screen all", count: total },
            { value: "compare", label: "Compare" },
            { value: "sectors", label: "Sector medians" },
          ]}
        />
        <p className="muted small" style={{ margin: 0 }}>
          Key ratios and dividend history as displayed by Merolagani, and the latest
          quarterly statement as displayed by ShareSansar. Everything stored is
          unofficial (UNVERIFIED); anything computed here is marked{" "}
          <strong>d</strong> (DERIVED).
        </p>
      </Card>

      {tab === "compare" ? (
        <ComparePanel universe={universe} />
      ) : latestState.error || total === 0 ? (
        <Card title={tab === "screen" ? "Screen all" : "Sector medians"}>
          <MissingData
            title={latestState.error ? "Fundamentals screen unavailable" : "No company fundamentals stored yet"}
            status={latestState.status}
            error={latestState.error}
            endpoint="/api/fundamentals/latest"
          >
            {!latestState.error && universe.funds > 0 ? (
              <p>
                Only mutual-fund NAVs ({universe.funds}) are stored. Run{" "}
                <code>pnpm personal:details</code> to fetch company key ratios and
                quarterly statements, then import (<strong>Data → Import</strong> or{" "}
                <code>pnpm personal:sync</code>).
              </p>
            ) : undefined}
          </MissingData>
        </Card>
      ) : tab === "screen" ? (
        <ScreenPanel
          universe={universe}
          filters={filters}
          setFilters={setFilters}
          onOpenSymbol={onOpenSymbol}
          latest={latestState.data}
          coverageItems={cov}
        />
      ) : (
        <SectorPanel
          universe={universe}
          latest={latestState.data}
          onPickSector={(sector) => {
            setFilters({ ...DEFAULT_FILTERS, sector });
            setTab("screen");
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen all
// ---------------------------------------------------------------------------

function accessor(row: ScreenRow, key: SortKey): number | string | null {
  switch (key) {
    case "symbol":
      return row.symbol;
    case "sector":
      return row.sector;
    case "period":
      return row.period;
    case "close":
      return row.close;
    case "eps":
      return row.r.eps.value;
    case "pe":
      return row.r.pe.value;
    case "bvps":
      return row.r.bvps.value;
    case "pb":
      return row.r.pb.value;
    case "roe":
      return row.r.roe.value;
    case "roa":
      return row.r.roa.value;
    case "npl":
      return row.r.npl.value;
    case "dividend":
      return row.r.dividend.value;
    case "bonus":
      return row.r.bonus.value;
    case "earningsYield":
      return row.r.earningsYield.value;
    case "marketCap":
      return row.marketCap.value;
    case "capClass":
      return row.capClass ? CAP_ORDER[row.capClass] : null;
    case "asOf":
      return row.asOf;
  }
}

const basis = (val: Val) => (val.value === null ? "" : val.derived ? "DERIVED" : "UNVERIFIED");

function UnavailableFooter({ items, total, statements }: { items: CoverageItem[]; total: number; statements: number }) {
  const missing = items.filter((item) => item.published + item.derived === 0).map((item) => item.label);
  const partial = items.filter((item) => item.published > 0 && item.published < total);
  return (
    <div className="stack-sm">
      <span>
        <strong>Derived (d)</strong>, computed locally from the last stored end-of-day
        close: P/E = close ÷ EPS (only when EPS &gt; 0 and no P/E is published); P/B =
        close ÷ book value per share (only when unpublished); ROE ≈ EPS ÷ BVPS × 100
        (only when ROE is unpublished); earnings yield = EPS ÷ close; market cap =
        shares outstanding × close when no published value. ROA and NPL are never
        computed. {CAP_RULE}
      </span>
      <span>
        <strong>Published coverage</strong> (of {total}):{" "}
        {items.map((item) => `${item.label} ${item.published}${item.derived ? ` (+${item.derived} d)` : ""}`).join(" · ")}.
      </span>
      <span>
        <strong>Unavailable</strong>
        {missing.length > 0
          ? `: ${missing.join(", ")} — not present for any company in the stored data.`
          : "."}{" "}
        {partial.length > 0 &&
          `Partially published: ${partial.map((item) => item.label).join(", ")} (shown as — where missing). `}
        Audited multi-year (5-year) statements, cash-flow statements and full
        historical balance sheets / income statements are not published by the free
        pages; only the latest quarterly statement as displayed is stored
        ({statements} of {total} companies have one). Bank ratios such as NPL appear
        only where that statement lists them.
      </span>
    </div>
  );
}

function ScreenPanel({
  universe,
  filters,
  setFilters,
  onOpenSymbol,
  latest,
  coverageItems,
}: {
  universe: DeskUniverse;
  filters: ScreenFilters;
  setFilters: (next: ScreenFilters) => void;
  onOpenSymbol: (symbol: string) => void;
  latest: FundamentalsLatestResponse | null;
  coverageItems: CoverageItem[];
}) {
  const { rows } = universe;
  const hasNpl = useMemo(() => rows.some((row) => row.r.npl.value !== null), [rows]);
  const presets = useMemo(
    () => PRESETS.filter((preset) => preset.id !== "banks-npl" || hasNpl),
    [hasNpl],
  );
  const sectors = useMemo(
    () => [...new Set(rows.map((row) => row.sector))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const statements = useMemo(() => rows.filter((row) => row.hasStatement).length, [rows]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const minPe = parseBound(filters.minPe);
    const maxPe = parseBound(filters.maxPe);
    const minRoe = parseBound(filters.minRoe);
    const preset = PRESETS.find((item) => item.id === filters.preset) ?? PRESETS[0]!;
    return rows.filter((row) => {
      if (q && !row.symbol.toLowerCase().includes(q) && !row.name.toLowerCase().includes(q)) return false;
      if (filters.sector !== "all" && row.sector !== filters.sector) return false;
      if (filters.cap !== "all" && row.capClass !== filters.cap) return false;
      const pe = row.r.pe.value;
      if (minPe !== null && (pe === null || pe < minPe)) return false;
      if (maxPe !== null && (pe === null || pe > maxPe)) return false;
      if (minRoe !== null && (row.r.roe.value === null || row.r.roe.value < minRoe)) return false;
      return preset.test(row);
    });
  }, [rows, filters]);

  const { sorted, sort, toggle } = useSort<ScreenRow, SortKey>(
    filtered,
    { key: "marketCap", direction: "desc" },
    accessor,
  );

  const activePreset = presets.find((item) => item.id === filters.preset) ?? PRESETS[0]!;
  const set = (patch: Partial<ScreenFilters>) => setFilters({ ...filters, ...patch });

  const exportRows = () =>
    downloadCsv(
      `nepse-fundamentals-${new Date().toISOString().slice(0, 10)}.csv`,
      sorted.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        period: row.period ?? "",
        close: row.close,
        eps: row.r.eps.value,
        eps_basis: basis(row.r.eps),
        pe: row.r.pe.value,
        pe_basis: basis(row.r.pe),
        book_value_per_share: row.r.bvps.value,
        pb: row.r.pb.value,
        pb_basis: basis(row.r.pb),
        roe: row.r.roe.value,
        roe_basis: basis(row.r.roe),
        roa: row.r.roa.value,
        npl: row.r.npl.value,
        cash_dividend_pct: row.r.dividend.value,
        bonus_pct: row.r.bonus.value,
        earnings_yield_pct: row.r.earningsYield.value,
        market_cap: row.marketCap.value,
        market_cap_basis: basis(row.marketCap),
        cap_class: row.capClass ?? "",
        as_of: row.asOf ?? "",
        sources: row.sources.join("; "),
      })),
    );

  return (
    <>
      <Card
        title="Screen all"
        subtitle={`${filtered.length} of ${rows.length} companies`}
        action={
          <ProvenanceLine
            provenance={latest?.provenance}
            dataState={latest?.dataState}
            sources={[...new Set(rows.flatMap((row) => row.sources))]}
          />
        }
      >
        <div className="presets" role="group" aria-label="Presets">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="toggle-chip"
              aria-pressed={filters.preset === preset.id}
              title={preset.rule}
              onClick={() => set({ preset: preset.id })}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="filters">
          <label className="grow">
            <span>Symbol or name</span>
            <input
              value={filters.search}
              placeholder="NABIL, hydro…"
              onChange={(event) => set({ search: event.target.value })}
            />
          </label>
          <label>
            <span>Sector</span>
            <select value={filters.sector} onChange={(event) => set({ sector: event.target.value })}>
              <option value="all">All sectors</option>
              {sectors.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Cap class</span>
            <select
              value={filters.cap}
              onChange={(event) => set({ cap: event.target.value as ScreenFilters["cap"] })}
            >
              <option value="all">All classes</option>
              {CAP_CLASSES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ minWidth: 90 }}>
            <span>Min P/E</span>
            <input value={filters.minPe} inputMode="decimal" onChange={(event) => set({ minPe: event.target.value })} />
          </label>
          <label style={{ minWidth: 90 }}>
            <span>Max P/E</span>
            <input value={filters.maxPe} inputMode="decimal" onChange={(event) => set({ maxPe: event.target.value })} />
          </label>
          <label style={{ minWidth: 90 }}>
            <span>Min ROE %</span>
            <input value={filters.minRoe} inputMode="decimal" onChange={(event) => set({ minRoe: event.target.value })} />
          </label>
          <button type="button" className="button button-ghost button-small" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Reset
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
          <strong>{activePreset.label}:</strong> {activePreset.rule}.
          {!hasNpl && " The “Banks NPL<2%” preset is hidden because no NPL values are stored."}
        </p>
      </Card>

      <Card
        title="Fundamentals"
        subtitle="Click a column to sort · click a row to open the company"
        action={
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={exportRows}
            disabled={sorted.length === 0}
          >
            <Icon.Download /> Export CSV
          </button>
        }
        footer={<UnavailableFooter items={coverageItems} total={rows.length} statements={statements} />}
      >
        {sorted.length === 0 ? (
          <EmptyState title="No companies match these filters" />
        ) : (
          <div className="table-scroll tall">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Symbol" sortKey="symbol" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <SortHeader label="Sector" sortKey="sector" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <SortHeader label="Period" sortKey="period" sort={sort} onSort={toggle} title="Fiscal year / quarter of the EPS shown" />
                  <SortHeader label="Close" sortKey="close" sort={sort} onSort={toggle} align="right" title="Last stored end-of-day close" />
                  <SortHeader label="EPS" sortKey="eps" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="P/E" sortKey="pe" sort={sort} onSort={toggle} align="right" defaultDirection="asc" />
                  <SortHeader label="BVPS" sortKey="bvps" sort={sort} onSort={toggle} align="right" title="Book value per share" />
                  <SortHeader label="P/B" sortKey="pb" sort={sort} onSort={toggle} align="right" defaultDirection="asc" />
                  <SortHeader label="ROE" sortKey="roe" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="ROA" sortKey="roa" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="NPL" sortKey="npl" sort={sort} onSort={toggle} align="right" defaultDirection="asc" />
                  <SortHeader label="Div %" sortKey="dividend" sort={sort} onSort={toggle} align="right" title="Cash dividend, % of paid-up value" />
                  <SortHeader label="Bonus %" sortKey="bonus" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="E/Y" sortKey="earningsYield" sort={sort} onSort={toggle} align="right" title="Earnings yield = EPS ÷ close (derived)" />
                  <SortHeader label="Mkt cap" sortKey="marketCap" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="Cap" sortKey="capClass" sort={sort} onSort={toggle} title={CAP_RULE} />
                  <SortHeader label="As of" sortKey="asOf" sort={sort} onSort={toggle} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <ClickableRow key={row.symbol} onClick={() => onOpenSymbol(row.symbol)}>
                    <td>
                      <strong>{row.symbol}</strong>
                      <span className="cell-sub">{row.name || "not in company master"}</span>
                    </td>
                    <td className="muted small">{row.sector}</td>
                    <td className="muted small nowrap">{row.period ?? "—"}</td>
                    <td className="right">{formatNumber(row.close)}</td>
                    <td className="right"><ValCell val={row.r.eps} kind="rs" /></td>
                    <td className="right"><ValCell val={row.r.pe} kind="ratio" /></td>
                    <td className="right"><ValCell val={row.r.bvps} kind="rs" /></td>
                    <td className="right"><ValCell val={row.r.pb} kind="ratio" /></td>
                    <td className="right"><ValCell val={row.r.roe} kind="percent" /></td>
                    <td className="right"><ValCell val={row.r.roa} kind="percent" /></td>
                    <td className="right"><ValCell val={row.r.npl} kind="percent" /></td>
                    <td className="right"><ValCell val={row.r.dividend} kind="percent" /></td>
                    <td className="right"><ValCell val={row.r.bonus} kind="percent" /></td>
                    <td className="right"><ValCell val={row.r.earningsYield} kind="percent" /></td>
                    <td className="right nowrap"><ValCell val={row.marketCap} kind="rsBig" /></td>
                    <td><CapBadge value={row.capClass} /></td>
                    <td className="muted small nowrap">{row.asOf ? row.asOf.slice(0, 10) : "—"}</td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sector medians
// ---------------------------------------------------------------------------

interface SectorColumn {
  id: string;
  label: string;
  kind: MetricKind;
  get: (row: ScreenRow) => Val;
  /** Drop non-positive values (e.g. loss-making P/E) from the median. */
  positiveOnly?: boolean;
}

const SECTOR_COLUMNS: SectorColumn[] = [
  { id: "eps", label: "EPS", kind: "rs", get: (row) => row.r.eps },
  { id: "pe", label: "P/E", kind: "ratio", get: (row) => row.r.pe, positiveOnly: true },
  { id: "bvps", label: "BVPS", kind: "rs", get: (row) => row.r.bvps },
  { id: "pb", label: "P/B", kind: "ratio", get: (row) => row.r.pb, positiveOnly: true },
  { id: "roe", label: "ROE", kind: "percent", get: (row) => row.r.roe },
  { id: "roa", label: "ROA", kind: "percent", get: (row) => row.r.roa },
  { id: "npl", label: "NPL", kind: "percent", get: (row) => row.r.npl },
  { id: "dividend", label: "Div %", kind: "percent", get: (row) => row.r.dividend },
  { id: "bonus", label: "Bonus %", kind: "percent", get: (row) => row.r.bonus },
  { id: "ey", label: "E/Y", kind: "percent", get: (row) => row.r.earningsYield },
  { id: "cap", label: "Mkt cap", kind: "rsBig", get: (row) => row.marketCap },
];

interface SectorRow {
  sector: string;
  companies: number;
  medians: Record<string, { value: number | null; n: number }>;
}

function sectorRow(sector: string, rows: ScreenRow[], includeDerived: boolean): SectorRow {
  const medians: SectorRow["medians"] = {};
  for (const column of SECTOR_COLUMNS) {
    const values = rows
      .map(column.get)
      .filter((val) => val.value !== null && (includeDerived || !val.derived))
      .map((val) => val.value!)
      .filter((value) => !column.positiveOnly || value > 0);
    medians[column.id] = { value: median(values), n: values.length };
  }
  return { sector, companies: rows.length, medians };
}

function SectorPanel({
  universe,
  latest,
  onPickSector,
}: {
  universe: DeskUniverse;
  latest: FundamentalsLatestResponse | null;
  onPickSector: (sector: string) => void;
}) {
  const [includeDerived, setIncludeDerived] = useState(true);
  const { rows } = universe;
  const sectorRows = useMemo(() => {
    const groups = new Map<string, ScreenRow[]>();
    for (const row of rows) {
      const list = groups.get(row.sector) ?? [];
      list.push(row);
      groups.set(row.sector, list);
    }
    return [...groups.entries()].map(([sector, list]) => sectorRow(sector, list, includeDerived));
  }, [rows, includeDerived]);
  const overall = useMemo(() => sectorRow("All companies", rows, includeDerived), [rows, includeDerived]);

  const { sorted, sort, toggle } = useSort<SectorRow, string>(
    sectorRows,
    { key: "companies", direction: "desc" },
    (row, key) => (key === "sector" ? row.sector : key === "companies" ? row.companies : (row.medians[key]?.value ?? null)),
  );

  const exportRows = () =>
    downloadCsv(
      `nepse-sector-medians-${new Date().toISOString().slice(0, 10)}.csv`,
      [overall, ...sorted].map((row) => {
        const record: Record<string, unknown> = { sector: row.sector, companies: row.companies };
        for (const column of SECTOR_COLUMNS) {
          record[`${column.id}_median`] = row.medians[column.id]?.value ?? null;
          record[`${column.id}_n`] = row.medians[column.id]?.n ?? 0;
        }
        record.classification = includeDerived ? "DERIVED (median of unverified + derived values)" : "DERIVED (median of unverified values)";
        return record;
      }),
    );

  const renderCells = (row: SectorRow) =>
    SECTOR_COLUMNS.map((column) => {
      const cell = row.medians[column.id];
      return (
        <td key={column.id} className="right">
          {cell && cell.value !== null ? formatKind(cell.value, column.kind) : <span className="subtle">—</span>}
          <span className="cell-sub">n={cell?.n ?? 0}</span>
        </td>
      );
    });

  return (
    <Card
      title="Sector medians"
      subtitle="Median of each metric per sector; n = companies with a value · click a sector to screen it"
      action={
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <label className="checkbox" style={{ paddingBottom: 0 }}>
            <input
              type="checkbox"
              checked={includeDerived}
              onChange={(event) => setIncludeDerived(event.target.checked)}
            />
            <span>Include derived values</span>
          </label>
          <button type="button" className="button button-ghost button-small" onClick={exportRows}>
            <Icon.Download /> Export CSV
          </button>
        </div>
      }
      footer={
        <div className="stack-sm">
          <ProvenanceLine
            provenance={latest?.provenance}
            dataState={latest?.dataState}
            sources={[...new Set(rows.flatMap((row) => row.sources))]}
            derived
          />
          <span>
            Medians are DERIVED from UNVERIFIED values as displayed by the source pages.
            {includeDerived
              ? " Where a ratio is unpublished, its derived value (P/E or P/B from the last close, ROE ≈ EPS ÷ BVPS, market cap = shares × close) is included; untick to use published values only."
              : " Only published values are used."}{" "}
            Loss-making companies (P/E or P/B ≤ 0) are left out of the P/E and P/B
            medians. A sector median with a small n says little. ROA and NPL are only
            what the quarterly statements list; nothing is computed for them.
          </span>
        </div>
      }
    >
      <div className="table-scroll tall">
        <table className="table">
          <thead>
            <tr>
              <SortHeader label="Sector" sortKey="sector" sort={sort} onSort={toggle} defaultDirection="asc" />
              <SortHeader label="Companies" sortKey="companies" sort={sort} onSort={toggle} align="right" />
              {SECTOR_COLUMNS.map((column) => (
                <SortHeader key={column.id} label={column.label} sortKey={column.id} sort={sort} onSort={toggle} align="right" />
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>{overall.sector}</strong>
                <span className="cell-sub">market-wide reference</span>
              </td>
              <td className="right">{overall.companies}</td>
              {renderCells(overall)}
            </tr>
            {sorted.map((row) => (
              <ClickableRow key={row.sector} onClick={() => onPickSector(row.sector)}>
                <td>
                  <strong>{row.sector}</strong>
                </td>
                <td className="right">
                  {row.companies}
                  {row.companies < 3 && (
                    <span className="cell-sub">
                      <Badge tone="warn">small n</Badge>
                    </span>
                  )}
                </td>
                {renderCells(row)}
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

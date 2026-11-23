import { useMemo, useState, type CSSProperties } from "react";
import { monthlyReturns, periodReturns, type ReturnPeriod } from "@stock/analytics";
import { formatNumber } from "../api";
import type {
  CandlesResponse,
  Company,
  CorporateAction,
  CorporateActionsResponse,
  FundamentalsResponse,
  FundamentalsSnapshot,
  Provenance,
} from "../types";
import { Badge, Card, Delta, EmptyState, Notice, Spinner, heatStyle } from "../components/ui";
import type { DeskUniverse } from "../pages/FundamentalsPage";
import {
  CAP_RULE,
  METRICS,
  bestIndex,
  calendarYearReturns,
  companyEventsPath,
  fiveYearDividends,
  formatKind,
  mergeSnapshots,
  metricDef,
  otherKeys,
  pickInSnapshot,
  ratios,
  resolveMarketCap,
  snapshotRank,
  storedLabel,
  type CanonicalKey,
  type CapClass,
  type CompanyEventsResponse,
  type Direction,
  type DividendSummary,
  type MergedFundamentals,
  type MetricKind,
  type Ratios,
  type Val,
  NONE,
} from "./model";
import { CapBadge, MissingData, ProvenanceLine, ValCell } from "./parts";
import { useCachedApiMany, type CachedState } from "./useCachedApi";

const STORAGE_KEY = "nepse.fundamentals.compare";
const MAX = 4;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PERIODS: ReturnPeriod[] = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y"];

const BEST_STYLE: CSSProperties = {
  background: "color-mix(in srgb, var(--up) 14%, var(--surface))",
  fontWeight: 650,
};

function readSelection(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

function writeSelection(symbols: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
  } catch {
    // Best-effort per-viewer convenience.
  }
}

interface Entry {
  symbol: string;
  company: Company | undefined;
  merged: MergedFundamentals | null;
  snapshots: FundamentalsSnapshot[];
  close: number | null;
  r: Ratios;
  cap: Val;
  capClass: CapClass | null;
  candles: CandlesResponse["candles"];
  actions: CorporateAction[];
  dividends: DividendSummary;
  dividendYield: Val;
  fundState: CachedState<FundamentalsResponse> | undefined;
  candleState: CachedState<CandlesResponse> | undefined;
  actionState: CachedState<CorporateActionsResponse> | undefined;
}

function dividendYield(cashPercent: number | null, paidUp: number | undefined, close: number | null, what: string): Val {
  if (cashPercent === null) return { ...NONE, note: "no cash dividend listed" };
  if (!paidUp || paidUp <= 0) return { ...NONE, note: "paid-up value per share not stored" };
  if (close === null || close <= 0) return { ...NONE, note: "no stored close" };
  return {
    value: ((cashPercent / 100) * paidUp * 100) / close,
    derived: true,
    note: `derived: ${what} cash dividend % × paid-up value (Rs ${paidUp}) ÷ last close`,
  };
}

export function ComparePanel({ universe }: { universe: DeskUniverse }) {
  const [selected, setSelectedState] = useState<string[]>(readSelection);
  const [draft, setDraft] = useState("");

  const setSelected = (next: string[]) => {
    setSelectedState(next);
    writeSelection(next);
  };

  const options = useMemo(() => {
    const symbols = new Set<string>(universe.rows.map((row) => row.symbol));
    for (const company of universe.companyBySymbol.values()) {
      if (company.instrumentType === "Equity") symbols.add(company.symbol.toUpperCase());
    }
    return [...symbols]
      .sort()
      .map((symbol) => ({ symbol, name: universe.companyBySymbol.get(symbol)?.name ?? "" }));
  }, [universe]);
  const optionSet = useMemo(() => new Set(options.map((option) => option.symbol)), [options]);

  const tryAdd = (text: string): boolean => {
    const symbol = text.trim().toUpperCase().split(/\s/)[0] ?? "";
    if (!optionSet.has(symbol) || selected.includes(symbol) || selected.length >= MAX) return false;
    setSelected([...selected, symbol]);
    setDraft("");
    return true;
  };

  const suggest = () => {
    const largest = [...universe.rows]
      .filter((row) => row.marketCap.value !== null)
      .sort((a, b) => (b.marketCap.value ?? 0) - (a.marketCap.value ?? 0));
    const sector = largest[0]?.sector;
    setSelected(largest.filter((row) => row.sector === sector).slice(0, MAX).map((row) => row.symbol));
  };

  const fundPaths = useMemo(
    () => selected.map((symbol) => `/api/fundamentals?symbol=${encodeURIComponent(symbol)}`),
    [selected],
  );
  const candlePaths = useMemo(
    () => selected.map((symbol) => `/api/candles?symbol=${encodeURIComponent(symbol)}`),
    [selected],
  );
  const actionPaths = useMemo(
    () => selected.map((symbol) => `/api/corporate-actions?symbol=${encodeURIComponent(symbol)}`),
    [selected],
  );
  const funds = useCachedApiMany<FundamentalsResponse>(fundPaths);
  const candles = useCachedApiMany<CandlesResponse>(candlePaths);
  const actions = useCachedApiMany<CorporateActionsResponse>(actionPaths);
  const eventPaths = useMemo(() => selected.map(companyEventsPath), [selected]);
  const events = useCachedApiMany<CompanyEventsResponse>(eventPaths);

  const entries = useMemo<Entry[]>(
    () =>
      selected.map((symbol, index) => {
        const fundState = funds[index];
        const data = fundState?.data;
        const snapshots = data ? [...(data.history ?? []), ...(data.latest ? [data.latest] : [])] : [];
        const merged = snapshots.length > 0 ? mergeSnapshots(symbol, snapshots) : (universe.merged.get(symbol) ?? null);
        const candleList = candles[index]?.data?.candles ?? [];
        const close = universe.closes.get(symbol) ?? candleList.at(-1)?.close ?? null;
        const company = universe.companyBySymbol.get(symbol);
        const actionList = actions[index]?.data?.actions ?? [];
        const dividends = fiveYearDividends(actionList, events[index]?.data?.events ?? []);
        const r = ratios(merged, close);
        return {
          symbol,
          company,
          merged,
          snapshots: merged?.snapshots ?? [],
          close,
          r,
          cap: resolveMarketCap(merged, company, close),
          capClass: universe.capClassBySymbol.get(symbol) ?? null,
          candles: candleList,
          actions: actionList,
          dividends,
          dividendYield: dividendYield(dividends.years[0]?.cash ?? null, company?.paidUpValue, close, "latest listed"),
          fundState,
          candleState: candles[index],
          actionState: actions[index],
        };
      }),
    [selected, funds, candles, actions, events, universe],
  );

  const loading = [...funds, ...candles, ...actions, ...events].some((state) => state.loading);

  return (
    <div className="stack">
      <Card
        title="Compare companies"
        subtitle="Pick 2–4 companies · the selection is remembered on this device"
        action={
          <button type="button" className="button button-ghost button-small" onClick={suggest}>
            Suggest: largest in top sector
          </button>
        }
      >
        <div className="filters">
          <label className="grow">
            <span>Add company ({selected.length}/{MAX})</span>
            <input
              list="fundamentals-compare-options"
              value={draft}
              placeholder={selected.length >= MAX ? "Remove one to add another" : "Type a symbol or name, then pick"}
              disabled={selected.length >= MAX}
              onChange={(event) => {
                const value = event.target.value;
                // Picking from the list fires a change without a typing inputType;
                // typed text only adds on Enter, so "NIC" never jumps to a match early.
                const inputType = (event.nativeEvent as InputEvent).inputType;
                const picked = !inputType || inputType === "insertReplacementText";
                if (!(picked && tryAdd(value))) setDraft(value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const match =
                    options.find((option) => option.symbol === draft.trim().toUpperCase()) ??
                    options.find((option) => option.name.toLowerCase().includes(draft.trim().toLowerCase()));
                  if (draft.trim() && match) tryAdd(match.symbol);
                }
              }}
            />
            <datalist id="fundamentals-compare-options">
              {options.map((option) => (
                <option key={option.symbol} value={option.symbol}>
                  {option.name}
                </option>
              ))}
            </datalist>
          </label>
        </div>
        <div className="chips" style={{ marginTop: 12 }}>
          {selected.length === 0 && <span className="muted small">No companies selected.</span>}
          {selected.map((symbol) => (
            <button
              key={symbol}
              type="button"
              className="toggle-chip"
              aria-pressed="true"
              title={`Remove ${symbol}`}
              onClick={() => setSelected(selected.filter((item) => item !== symbol))}
            >
              {symbol} ×
            </button>
          ))}
        </div>
      </Card>

      {selected.length < 2 ? (
        <Card>
          <EmptyState title="Pick at least two companies">
            Type a symbol or company name above. Up to four companies are compared
            side by side, with the best value per metric highlighted.
          </EmptyState>
        </Card>
      ) : (
        <>
          {loading && <Spinner label="Loading fundamentals, prices and dividends" />}
          <MissingNotices entries={entries} />
          <SideBySide entries={entries} />
          <HistoryCard entries={entries} />
          <PerformanceCard entries={entries} />
          <DividendCard entries={entries} />
        </>
      )}
    </div>
  );
}

function MissingNotices({ entries }: { entries: Entry[] }) {
  const noFundamentals = entries.filter((entry) => entry.fundState?.error).map((entry) => entry.symbol);
  const noCandles = entries.filter((entry) => !entry.candleState?.loading && entry.candles.length === 0).map((e) => e.symbol);
  if (noFundamentals.length === 0 && noCandles.length === 0) return null;
  return (
    <Notice tone="warn">
      {noFundamentals.length > 0 && (
        <span>
          No stored fundamentals for {noFundamentals.join(", ")}. Use{" "}
          <strong>Fetch company profiles</strong> on the Data page to load
          them; their columns stay blank until then.{" "}
        </span>
      )}
      {noCandles.length > 0 && (
        <span>No stored price history for {noCandles.join(", ")}; price performance is blank for them.</span>
      )}
    </Notice>
  );
}

function firstProvenance(entries: Entry[], pickOne: (entry: Entry) => Provenance | null | undefined): Provenance | null {
  for (const entry of entries) {
    const provenance = pickOne(entry);
    if (provenance) return provenance;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Side by side
// ---------------------------------------------------------------------------

interface CompareRow {
  id: string;
  label: string;
  kind: MetricKind;
  direction: Direction;
  values: Val[];
  positiveOnly?: boolean;
}

function kmDirection(label: string): Direction {
  if (/^non.?performing/i.test(label) || /^cost of funds?/i.test(label)) return "lower";
  if (
    /capital fund to rwa|tier i capital|cet i capital|return on|earnings per share|loan loss provision to total npl/i.test(
      label,
    )
  ) {
    return "higher";
  }
  return "neutral";
}

function unitKind(unit: string | undefined, key: string): MetricKind {
  if (unit === "percent") return "percent";
  if (unit === "ratio") return "ratio";
  if (unit === "shares") return "shares";
  if (key.startsWith("bs.") || key.startsWith("pl.")) return "thousands";
  return "rs";
}

function storedVal(merged: MergedFundamentals | null, key: string): Val {
  const stored = merged?.values.get(key);
  if (!stored) return NONE;
  return {
    value: stored.value,
    derived: false,
    note: `as displayed (${stored.metric.source ?? "source"}) · ${stored.period}`,
    period: stored.period,
  };
}

function canonicalVal(merged: MergedFundamentals | null, key: CanonicalKey): Val {
  for (const source of metricDef(key).sources) {
    const stored = merged?.values.get(source);
    if (stored) {
      return {
        value: stored.value,
        derived: false,
        note: `as displayed (${stored.metric.source ?? "source"}) · ${stored.period} · ${source}`,
        period: stored.period,
      };
    }
  }
  return NONE;
}

function RowsTable({ rows, entries }: { rows: CompareRow[]; entries: Entry[] }) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Metric</th>
            {entries.map((entry) => (
              <th key={entry.symbol} className="right">
                {entry.symbol}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const comparable = row.values.map((val) =>
              val.value !== null && (!row.positiveOnly || val.value > 0) ? val.value : null,
            );
            const best = new Set(bestIndex(comparable, row.direction));
            return (
              <tr key={row.id}>
                <td>
                  {row.label}
                  {row.direction !== "neutral" && (
                    <span className="cell-sub">{row.direction === "higher" ? "higher is better" : "lower is better"}</span>
                  )}
                </td>
                {row.values.map((val, index) => (
                  <td
                    key={entries[index]?.symbol ?? index}
                    className="right nowrap"
                    style={best.has(index) ? BEST_STYLE : undefined}
                    title={best.has(index) ? "Best among the compared companies" : undefined}
                  >
                    {best.has(index) && <span aria-label="best">★ </span>}
                    <ValCell val={val} kind={row.kind} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SideBySide({ entries }: { entries: Entry[] }) {
  const core = useMemo<CompareRow[]>(() => {
    const row = (
      id: string,
      label: string,
      kind: MetricKind,
      direction: Direction,
      get: (entry: Entry) => Val,
      positiveOnly = false,
    ): CompareRow => ({ id, label, kind, direction, values: entries.map(get), positiveOnly });
    const closeVal = (entry: Entry): Val =>
      entry.close === null ? NONE : { value: entry.close, derived: false, note: "last stored end-of-day close" };
    return [
      row("close", "Last close (EOD)", "rs", "neutral", closeVal),
      row("eps", "EPS (Rs)", "rs", "higher", (e) => e.r.eps),
      row("dilutedEps", "Diluted EPS (Rs)", "rs", "higher", (e) => canonicalVal(e.merged, "dilutedEps")),
      row("pe", "P/E", "ratio", "lower", (e) => e.r.pe, true),
      row("bvps", "Book value / share (Rs)", "rs", "neutral", (e) => e.r.bvps),
      row("pb", "P/B", "ratio", "lower", (e) => e.r.pb, true),
      row("ey", "Earnings yield %", "percent", "higher", (e) => e.r.earningsYield),
      row("roe", "ROE %", "percent", "higher", (e) => e.r.roe),
      row("roa", "ROA %", "percent", "higher", (e) => e.r.roa),
      row("npl", "NPL %", "percent", "lower", (e) => e.r.npl),
      row("div", "Cash dividend % (latest)", "percent", "higher", (e) => e.r.dividend),
      row("bonus", "Bonus % (latest)", "percent", "higher", (e) => e.r.bonus),
      row("dy", "Dividend yield % on close", "percent", "higher", (e) => e.dividendYield),
      row("cap", "Market cap", "rsBig", "neutral", (e) => e.cap),
      row("shares", "Shares outstanding", "shares", "neutral", (e) => canonicalVal(e.merged, "sharesOutstanding")),
      row("equity", "Shareholders’ equity", "thousands", "neutral", (e) => canonicalVal(e.merged, "totalEquity")),
      row("price", "Market price as displayed (Rs)", "rs", "neutral", (e) => canonicalVal(e.merged, "marketPrice")),
    ];
  }, [entries]);

  const groups = useMemo(() => otherKeys(entries.map((entry) => entry.merged).filter((m): m is MergedFundamentals => m !== null)), [entries]);

  const statementRows = (keys: string[], withDirection: boolean): CompareRow[] =>
    keys.map((key) => {
      const sample = entries.map((entry) => entry.merged?.values.get(key)).find(Boolean);
      const label = storedLabel(key, sample?.metric);
      return {
        id: key,
        label,
        kind: unitKind(sample?.metric.unit, key),
        direction: withDirection ? kmDirection(label) : "neutral",
        values: entries.map((entry) => storedVal(entry.merged, key)),
      };
    });

  const sources = [...new Set(entries.flatMap((entry) => entry.merged?.sources ?? []))];
  const asOf = entries
    .map((entry) => entry.merged?.reportedAt ?? null)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  return (
    <Card
      title="Side by side"
      subtitle="Latest stored value per metric (across periods) · ★ = best, direction-aware"
      action={
        <ProvenanceLine
          provenance={firstProvenance(entries, (entry) => entry.fundState?.data?.provenance.latest)}
          sources={sources}
          asOf={asOf ?? null}
        />
      }
      footer={
        <span>
          Values are UNVERIFIED as displayed; <strong>d</strong> marks DERIVED values
          (P/E or P/B from the last close when unpublished, ROE ≈ EPS ÷ BVPS, earnings
          yield, dividend yield = cash % × paid-up value ÷ close, market cap = shares ×
          close). Loss-making P/E and P/B are not ranked. Size metrics (market cap,
          shares, book value) have no “best”. {CAP_RULE} Hover a value for its period
          and source key. ROA, NPL and the bank ratios exist only where the quarterly
          statement lists them; nothing is computed for them.
        </span>
      }
    >
      <div className="stack">
        <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
          {entries.map((entry) => (
            <span key={entry.symbol} className="small">
              <strong>{entry.symbol}</strong>{" "}
              <span className="muted">{entry.company?.name ?? ""}</span>{" "}
              <span className="muted">· {entry.company?.sector ?? "—"} ·</span> <CapBadge value={entry.capClass} />
            </span>
          ))}
        </div>
        <RowsTable rows={core} entries={entries} />
        {groups.km.length > 0 && (
          <div>
            <h4 className="muted small" style={{ margin: "4px 0 8px" }}>
              Other key metrics as displayed (latest quarterly statement)
            </h4>
            <RowsTable rows={statementRows(groups.km, true)} entries={entries} />
          </div>
        )}
        {groups.pl.length > 0 && (
          <details>
            <summary className="muted small">Profit &amp; loss as displayed ({groups.pl.length} lines, Rs ’000)</summary>
            <RowsTable rows={statementRows(groups.pl, false)} entries={entries} />
          </details>
        )}
        {groups.bs.length > 0 && (
          <details>
            <summary className="muted small">Balance sheet as displayed ({groups.bs.length} lines, Rs ’000)</summary>
            <RowsTable rows={statementRows(groups.bs, false)} entries={entries} />
          </details>
        )}
        {groups.km.length + groups.pl.length + groups.bs.length === 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            No quarterly-statement lines are stored for these companies, so only the
            key ratios above are available.
          </p>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Metric history across periods
// ---------------------------------------------------------------------------

function HistoryCard({ entries }: { entries: Entry[] }) {
  const available = useMemo(
    () =>
      METRICS.filter((def) =>
        entries.some((entry) => entry.snapshots.some((snapshot) => pickInSnapshot(snapshot, def.key) !== null)),
      ),
    [entries],
  );
  const [chosen, setChosen] = useState<CanonicalKey>("eps");
  const metric = available.find((def) => def.key === chosen) ?? available[0];

  const periods = useMemo(() => {
    const ranked = new Map<string, string>();
    for (const entry of entries) {
      for (const snapshot of entry.snapshots) {
        const rank = snapshotRank(snapshot);
        const current = ranked.get(snapshot.period);
        if (!current || rank > current) ranked.set(snapshot.period, rank);
      }
    }
    return [...ranked.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([period]) => period);
  }, [entries]);

  return (
    <Card
      title="Metric history across stored periods"
      subtitle="Each stored period as displayed — not an audited multi-year history"
      action={
        available.length > 0 && metric ? (
          <label className="row" style={{ gap: 8 }}>
            <span className="muted small">Metric</span>
            <select value={metric.key} onChange={(event) => setChosen(event.target.value as CanonicalKey)}>
              {available.map((def) => (
                <option key={def.key} value={def.key}>
                  {def.label}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
      footer="Periods are whatever the public pages displayed when fetched (Merolagani key ratios are labelled by fiscal year; ShareSansar statements by quarter). The company-details pass adds new periods when it runs; older periods are never back-filled or interpolated."
    >
      {!metric || periods.length === 0 ? (
        <EmptyState title="No stored periods for these companies" />
      ) : (
        <div className="table-scroll short">
          <table className="table">
            <thead>
              <tr>
                <th>Period</th>
                {entries.map((entry) => (
                  <th key={entry.symbol} className="right">
                    {entry.symbol}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period}>
                  <td className="nowrap">
                    <strong>{period}</strong>
                  </td>
                  {entries.map((entry) => {
                    const snapshot = entry.snapshots.find((item) => item.period === period);
                    const value = snapshot ? pickInSnapshot(snapshot, metric.key) : null;
                    return (
                      <td key={entry.symbol} className="right">
                        {value === null ? <span className="subtle">—</span> : formatKind(value, metric.kind)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Price performance (derived from stored candles)
// ---------------------------------------------------------------------------

function PerformanceCard({ entries }: { entries: Entry[] }) {
  const perf = useMemo(() => {
    const lastStamp = entries
      .map((entry) => entry.candles.at(-1)?.timestamp ?? "")
      .filter(Boolean)
      .sort()
      .at(-1);
    if (!lastStamp) return null;
    const currentYear = Number(lastStamp.slice(0, 4));
    const lastMonth = Number(lastStamp.slice(5, 7));
    const months: Array<{ key: string; label: string }> = [];
    for (let back = 11; back >= 0; back -= 1) {
      const index = currentYear * 12 + (lastMonth - 1) - back;
      const year = Math.floor(index / 12);
      const month = (index % 12) + 1;
      months.push({
        key: `${year}-${String(month).padStart(2, "0")}`,
        label: `${MONTHS[month - 1]} ${String(year).slice(2)}`,
      });
    }
    return {
      currentYear,
      months,
      rows: entries.map((entry) => {
        const monthly = new Map(
          monthlyReturns(entry.candles).map((item) => [
            `${item.year}-${String(item.month).padStart(2, "0")}`,
            item.returnPercent,
          ]),
        );
        return {
          symbol: entry.symbol,
          periods: entry.candles.length > 1 ? periodReturns(entry.candles) : null,
          years: calendarYearReturns(entry.candles, 6, currentYear),
          monthly,
        };
      }),
    };
  }, [entries]);

  const provenance = firstProvenance(entries, (entry) => entry.candleState?.data?.provenance);

  if (!perf) {
    return (
      <Card title="Price performance">
        <EmptyState title="No stored price history for these companies">
          Price performance is computed from stored daily closes. Automatic
          updates fetch new end-of-day prices in the background; open the Data
          page to refresh now.
        </EmptyState>
      </Card>
    );
  }

  const yearHeaders = perf.rows[0]?.years ?? [];
  const periodBest = PERIODS.map(
    (key) => new Set(bestIndex(perf.rows.map((row) => row.periods?.[key] ?? null), "higher")),
  );
  const yearBest = yearHeaders.map(
    (_, column) => new Set(bestIndex(perf.rows.map((row) => row.years[column]?.returnPercent ?? null), "higher")),
  );

  return (
    <Card
      title="Price performance"
      subtitle="DERIVED from stored end-of-day closes · prices are unadjusted"
      action={<ProvenanceLine provenance={provenance} derived />}
      footer="Computed locally from stored daily closes with periodReturns / monthlyReturns (calendar windows; a window without a stored base close is blank, never bridged). Prices are NOT adjusted for bonus or right shares, so a year or month containing a book closure can show an artificial drop. Past returns describe history only."
    >
      <div className="stack">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Symbol</th>
                {PERIODS.map((key) => (
                  <th key={key} className="right">
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perf.rows.map((row, index) => (
                <tr key={row.symbol}>
                  <td>
                    <strong>{row.symbol}</strong>
                  </td>
                  {PERIODS.map((key, column) => (
                    <td key={key} className="right" style={periodBest[column]?.has(index) ? BEST_STYLE : undefined}>
                      <Delta value={row.periods?.[key] ?? null} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="muted small" style={{ margin: "0 0 8px" }}>
            Calendar-year returns (year-end close vs previous year-end close)
          </h4>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  {yearHeaders.map((year) => (
                    <th key={year.year} className="right">
                      {year.year}
                      {year.partial ? " YTD" : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perf.rows.map((row, index) => (
                  <tr key={row.symbol}>
                    <td>
                      <strong>{row.symbol}</strong>
                    </td>
                    {row.years.map((year, column) => (
                      <td
                        key={year.year}
                        className="right"
                        style={yearBest[column]?.has(index) ? BEST_STYLE : undefined}
                      >
                        <Delta value={year.returnPercent} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h4 className="muted small" style={{ margin: "0 0 8px" }}>
            Monthly returns, last 12 months (month-end close vs previous month-end)
          </h4>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  {perf.months.map((month) => (
                    <th key={month.key} className="right">
                      {month.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perf.rows.map((row) => (
                  <tr key={row.symbol}>
                    <td>
                      <strong>{row.symbol}</strong>
                    </td>
                    {perf.months.map((month) => {
                      const value = row.monthly.get(month.key) ?? null;
                      return (
                        <td
                          key={month.key}
                          className="right"
                          style={heatStyle(value, 10)}
                          title={value === null ? "no stored base month; not bridged" : `${value.toFixed(2)}%`}
                        >
                          {value === null ? "·" : value.toFixed(1)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Dividend history (5 fiscal years)
// ---------------------------------------------------------------------------

function DividendCard({ entries }: { entries: Entry[] }) {
  const years = useMemo(() => {
    const byStart = new Map<number, string>();
    for (const entry of entries) {
      for (const year of entry.dividends.years) byStart.set(year.start, year.fiscalYear);
    }
    return [...byStart.entries()].sort((a, b) => b[0] - a[0]).slice(0, 5);
  }, [entries]);
  const provenance = firstProvenance(entries, (entry) => entry.actionState?.data?.provenance);
  const anyActions = entries.some((entry) => entry.actions.length > 0 || entry.dividends.years.length > 0);
  const avgYield = entries.map((entry) =>
    dividendYield(entry.dividends.cashAverage, entry.company?.paidUpValue, entry.close, "5-year average"),
  );
  const cashBest = new Set(bestIndex(entries.map((entry) => entry.dividends.cashAverage), "higher"));
  const yieldBest = new Set(bestIndex(avgYield.map((val) => val.value), "higher"));

  return (
    <Card
      title="Dividend history (5 fiscal years)"
      subtitle="Cash % and bonus % of paid-up value as listed by Merolagani, gaps filled from ShareSansar dividend announcements"
      action={<ProvenanceLine provenance={provenance} />}
      footer="UNVERIFIED as displayed. Merolagani’s dividend history comes first; ShareSansar dividend announcements (company events) fill years or bonus figures it does not list, and a disagreement is marked ⚠ with the Merolagani value kept. A year neither page lists is shown as — and is not counted as zero (0% years are not listed). Averages use only listed years. Yield on close is DERIVED: cash % × paid-up value per share ÷ last stored close."
    >
      {!anyActions ? (
        <MissingData
          title="No dividend history stored for these companies"
          status={entries.find((entry) => entry.actionState?.error)?.actionState?.status ?? null}
          error={entries.find((entry) => entry.actionState?.error)?.actionState?.error ?? null}
          endpoint="/api/corporate-actions"
        />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Symbol</th>
                {years.map(([start, label]) => (
                  <th key={start} className="right">
                    FY {label}
                  </th>
                ))}
                <th className="right">Avg cash %</th>
                <th className="right">Avg bonus %</th>
                <th className="right">Avg yield on close</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.symbol}>
                  <td>
                    <strong>{entry.symbol}</strong>
                  </td>
                  {years.map(([start]) => {
                    const year = entry.dividends.years.find((item) => item.start === start);
                    return (
                      <td key={start} className="right nowrap">
                        {year && (year.cash !== null || year.bonus !== null) ? (
                          <>
                            {year.cash !== null ? `${formatNumber(year.cash)}%` : "—"}
                            <span className="muted"> + </span>
                            {year.bonus !== null ? `${formatNumber(year.bonus)}% B` : "— B"}
                            {year.conflict && (
                              <span className="tone-down" title={`${year.conflict} (Merolagani value kept)`}>
                                {" "}⚠
                              </span>
                            )}
                            {year.right && <span className="cell-sub">right {year.right}</span>}
                          </>
                        ) : (
                          <span className="subtle">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="right" style={cashBest.has(index) ? BEST_STYLE : undefined}>
                    {entry.dividends.cashAverage === null ? "—" : `${formatNumber(entry.dividends.cashAverage)}%`}
                    <span className="cell-sub">{entry.dividends.cashYears} listed yrs</span>
                  </td>
                  <td className="right">
                    {entry.dividends.bonusAverage === null ? "—" : `${formatNumber(entry.dividends.bonusAverage)}%`}
                    <span className="cell-sub">{entry.dividends.bonusYears} listed yrs</span>
                  </td>
                  <td className="right" style={yieldBest.has(index) ? BEST_STYLE : undefined}>
                    <ValCell val={avgYield[index] ?? NONE} kind="percent" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ margin: "8px 10px" }}>
            Cells read “cash % + bonus % B”. <Badge tone="warn">unofficial</Badge>
          </p>
        </div>
      )}
    </Card>
  );
}

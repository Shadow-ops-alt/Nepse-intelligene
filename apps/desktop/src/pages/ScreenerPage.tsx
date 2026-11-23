import { useMemo, useState } from "react";
import { formatCompact, formatNumber } from "../api";
import { useApi } from "../hooks";
import type { CompaniesResponse, ScreenerResponse, ScreenerRow } from "../types";
import {
  AsOf,
  Badge,
  Card,
  ClickableRow,
  DataStateBadge,
  Delta,
  EmptyState,
  RangeBar,
  RatingBadge,
  SortHeader,
  Spinner,
  downloadCsv,
  useSort,
} from "../components/ui";
import { Icon } from "../components/icons";

type Preset =
  | "all"
  | "uptrend"
  | "downtrend"
  | "sideways"
  | "golden"
  | "oversold"
  | "overbought"
  | "rsi30"
  | "rsi50"
  | "macd-cross"
  | "ema-cross"
  | "supertrend"
  | "near-high"
  | "near-low"
  | "volume-spike"
  | "volume-breakout"
  | "volume-3d"
  | "trending-1w"
  | "trending-2w"
  | "volatile-2"
  | "volatile-3"
  | "strong-trend"
  | "macd-bull"
  | "bull-candle"
  | "low-vol";

/** Fields added by the signal engine; optional so older APIs still work. */
type Extended = ScreenerRow & {
  return1W?: number | null;
  return2W?: number | null;
  volume3dRatio?: number | null;
  volume5d?: number | null;
  volumeBreakout?: boolean;
  avgAbsMove20?: number | null;
  supertrendDir?: 1 | -1 | null;
  adx14?: number | null;
  events?: Array<{ type: string; direction: string; label: string; timestamp: string }>;
};

const hasEvent = (row: ScreenerRow, type: string, direction = "bullish") =>
  ((row as Extended).events ?? []).some((event) => event.type === type && event.direction === direction);

const PRESETS: Array<{ value: Preset; label: string; rule: string; test: (row: ScreenerRow) => boolean }> = [
  { value: "all", label: "All", rule: "No preset", test: () => true },
  {
    value: "uptrend",
    label: "Uptrend",
    rule: "SMA 20 > SMA 50 > SMA 200",
    test: (row) => row.trend === "up",
  },
  {
    value: "downtrend",
    label: "Downtrend",
    rule: "SMA 20 < SMA 50 < SMA 200",
    test: (row) => row.trend === "down",
  },
  {
    value: "sideways",
    label: "Sideways",
    rule: "Moving averages not stacked either way",
    test: (row) => row.trend === "sideways",
  },
  {
    value: "rsi30",
    label: "RSI ↑30",
    rule: "RSI 14 crossed above 30 within the last 5 sessions",
    test: (row) => hasEvent(row, "rsi-cross-30"),
  },
  {
    value: "rsi50",
    label: "RSI ↑50",
    rule: "RSI 14 crossed above 50 within the last 5 sessions",
    test: (row) => hasEvent(row, "rsi-cross-50"),
  },
  {
    value: "macd-cross",
    label: "MACD cross ↑",
    rule: "MACD line crossed above its signal within 5 sessions",
    test: (row) => hasEvent(row, "macd-cross"),
  },
  {
    value: "ema-cross",
    label: "EMA 9/21 cross ↑",
    rule: "EMA 9 crossed above EMA 21 within 5 sessions",
    test: (row) => hasEvent(row, "ema-cross"),
  },
  {
    value: "supertrend",
    label: "Supertrend buy",
    rule: "Supertrend (10, 3) flipped up within 5 sessions",
    test: (row) => hasEvent(row, "supertrend-flip"),
  },
  {
    value: "volume-breakout",
    label: "Volume breakout",
    rule: "Close above the prior 20-session high on ≥1.5× average volume",
    test: (row) => (row as Extended).volumeBreakout === true,
  },
  {
    value: "volume-3d",
    label: "3-day volume ×1.5",
    rule: "Last 3 sessions' volume ≥ 1.5× the prior average 3-session volume",
    test: (row) => ((row as Extended).volume3dRatio ?? 0) >= 1.5,
  },
  {
    value: "trending-1w",
    label: "Trending 1W",
    rule: "1-week return ≥ 5% and volume above average",
    test: (row) => ((row as Extended).return1W ?? -Infinity) >= 5 && (row.volumeRatio ?? 0) >= 1,
  },
  {
    value: "trending-2w",
    label: "Trending 2W",
    rule: "2-week return ≥ 8%",
    test: (row) => ((row as Extended).return2W ?? -Infinity) >= 8,
  },
  {
    value: "volatile-2",
    label: "Volatile ≥2%",
    rule: "Average absolute daily move over 20 sessions ≥ 2%",
    test: (row) => ((row as Extended).avgAbsMove20 ?? 0) >= 2,
  },
  {
    value: "volatile-3",
    label: "Volatile ≥3%",
    rule: "Average absolute daily move over 20 sessions ≥ 3%",
    test: (row) => ((row as Extended).avgAbsMove20 ?? 0) >= 3,
  },
  {
    value: "strong-trend",
    label: "ADX > 25",
    rule: "Trend strength: ADX 14 above 25",
    test: (row) => ((row as Extended).adx14 ?? 0) > 25,
  },
  {
    value: "golden",
    label: "Golden cross",
    rule: "SMA 50 crossed above SMA 200 within 20 sessions",
    test: (row) => row.cross?.type === "golden",
  },
  {
    value: "oversold",
    label: "Oversold",
    rule: "RSI 14 < 30",
    test: (row) => row.rsiZone === "oversold",
  },
  {
    value: "overbought",
    label: "Overbought",
    rule: "RSI 14 > 70",
    test: (row) => row.rsiZone === "overbought",
  },
  {
    value: "near-high",
    label: "Near 52w high",
    rule: "Close in the top 10% of the 52-week range",
    test: (row) => (row.position52w ?? -1) >= 90,
  },
  {
    value: "near-low",
    label: "Near 52w low",
    rule: "Close in the bottom 10% of the 52-week range",
    test: (row) => row.position52w !== null && row.position52w <= 10,
  },
  {
    value: "volume-spike",
    label: "Volume spike",
    rule: "Last volume ≥ 2× the 20-session average",
    test: (row) => (row.volumeRatio ?? 0) >= 2,
  },
  {
    value: "macd-bull",
    label: "MACD bullish",
    rule: "MACD line above its signal line",
    test: (row) => row.macdState === "bullish",
  },
  {
    value: "bull-candle",
    label: "Bullish candle",
    rule: "A bullish candlestick pattern completed on the last session",
    test: (row) => row.patterns.some((pattern) => pattern.bias === "bullish"),
  },
  {
    value: "low-vol",
    label: "Low volatility",
    rule: "3-month annualised volatility < 20%",
    test: (row) => row.volatility3M !== null && row.volatility3M < 20,
  },
];

/** The screens used most days stay one click away; the rest live in a menu. */
const QUICK_PRESETS: Preset[] = [
  "all",
  "rsi30",
  "rsi50",
  "macd-cross",
  "volume-breakout",
  "uptrend",
  "near-high",
  "trending-1w",
];

const PRESET_GROUPS: Array<{ label: string; values: Preset[] }> = [
  { label: "Trend", values: ["uptrend", "downtrend", "sideways", "golden", "strong-trend", "supertrend"] },
  { label: "Momentum", values: ["rsi30", "rsi50", "oversold", "overbought", "macd-cross", "macd-bull", "ema-cross"] },
  { label: "Volume & breakouts", values: ["volume-breakout", "volume-spike", "volume-3d"] },
  { label: "Movers & volatility", values: ["trending-1w", "trending-2w", "volatile-2", "volatile-3", "low-vol"] },
  { label: "Price levels & patterns", values: ["near-high", "near-low", "bull-candle"] },
];

type CapClass = "Large" | "High" | "Mid" | "Low";

type SortKey =
  | "symbol"
  | "return1W"
  | "volume3dRatio"
  | "avgAbsMove20"
  | "marketCap"
  | "lastClose"
  | "return1M"
  | "return3M"
  | "return1Y"
  | "rsi14"
  | "position52w"
  | "volatility3M"
  | "maxDrawdown1Y"
  | "volumeRatio"
  | "signalScore"
  | "to";

export function ScreenerPage({
  onOpenSymbol,
}: {
  onOpenSymbol: (symbol: string) => void;
}) {
  const screenerState = useApi<ScreenerResponse>("/api/screener");
  const companiesState = useApi<CompaniesResponse>("/api/companies");
  const [preset, setPreset] = useState<Preset>("all");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("all");
  const [instrument, setInstrument] = useState("Equity");
  const [hideStale, setHideStale] = useState(true);
  const [activeOnly, setActiveOnly] = useState(true);
  const [minVolume, setMinVolume] = useState("");
  const [capClass, setCapClass] = useState<"all" | CapClass>("all");

  const rows = screenerState.data?.rows ?? [];
  const companies = companiesState.data?.companies ?? [];
  const companyBySymbol = useMemo(
    () => new Map(companies.map((company) => [company.symbol, company])),
    [companies],
  );
  const sectors = useMemo(
    () => [...new Set(companies.map((company) => company.sector))].sort(),
    [companies],
  );
  const instruments = useMemo(
    () => [...new Set(companies.map((company) => company.instrumentType))].sort(),
    [companies],
  );

  // Market cap = published value when present, else shares outstanding × last
  // close (derived). Classes are percentiles among stocks with a market cap.
  const caps = useMemo(() => {
    const closeBySymbol = new Map(rows.map((row) => [row.symbol, row.lastClose]));
    const values = new Map<string, number>();
    for (const company of companies) {
      const close = closeBySymbol.get(company.symbol);
      const cap =
        company.marketCap && company.marketCap > 0
          ? company.marketCap
          : company.sharesOutstanding && close
            ? company.sharesOutstanding * close
            : null;
      if (cap && company.instrumentType === "Equity") values.set(company.symbol, cap);
    }
    const ranked = [...values.entries()].sort((a, b) => b[1] - a[1]);
    const classes = new Map<string, CapClass>();
    ranked.forEach(([symbol], index) => {
      const pct = index / Math.max(1, ranked.length);
      classes.set(symbol, pct < 0.1 ? "Large" : pct < 0.3 ? "High" : pct < 0.6 ? "Mid" : "Low");
    });
    return { values, classes };
  }, [rows, companies]);
  const marketCapOf = (symbol: string) => caps.values.get(symbol) ?? null;

  const excluded = useMemo(() => {
    let stale = 0;
    let inactive = 0;
    for (const row of rows) {
      if (row.provenance.stale) stale += 1;
      if (companyBySymbol.get(row.symbol)?.status !== "active") inactive += 1;
    }
    return { stale, inactive };
  }, [rows, companyBySymbol]);

  const filtered = useMemo(() => {
    const needle = search.trim().toUpperCase();
    const floor = Number(minVolume);
    const presetTest = PRESETS.find((item) => item.value === preset)!.test;
    return rows.filter((row) => {
      const company = companyBySymbol.get(row.symbol);
      if (hideStale && row.provenance.stale) return false;
      if (activeOnly && company && company.status !== "active") return false;
      if (instrument !== "all" && company?.instrumentType !== instrument) return false;
      if (capClass !== "all" && caps.classes.get(row.symbol) !== capClass) return false;
      if (sector !== "all" && company?.sector !== sector) return false;
      if (
        needle &&
        !row.symbol.includes(needle) &&
        !(company?.name.toUpperCase().includes(needle) ?? false)
      ) {
        return false;
      }
      if (
        minVolume.trim() !== "" &&
        Number.isFinite(floor) &&
        (row.averageVolume20 ?? 0) < floor
      ) {
        return false;
      }
      return presetTest(row);
    });
  }, [rows, companyBySymbol, search, sector, instrument, hideStale, activeOnly, minVolume, preset, capClass, caps]);

  const { sorted, sort, toggle } = useSort<ScreenerRow, SortKey>(
    filtered,
    { key: "signalScore", direction: "desc" },
    (row, key) => {
      if (key === "symbol") return row.symbol;
      if (key === "marketCap") return marketCapOf(row.symbol);
      if (key === "return1W" || key === "volume3dRatio" || key === "avgAbsMove20") {
        return (row as Extended)[key] ?? null;
      }
      return row[key];
    },
  );

  const ratingCounts = useMemo(() => {
    const counts = { bull: 0, neutral: 0, bear: 0 };
    for (const row of filtered) {
      if (row.signalRating === "bullish" || row.signalRating === "strong-bullish") counts.bull += 1;
      else if (row.signalRating === "bearish" || row.signalRating === "strong-bearish") counts.bear += 1;
      else if (row.signalRating === "neutral") counts.neutral += 1;
    }
    return counts;
  }, [filtered]);

  if (screenerState.loading) {
    return <Spinner label="Computing indicators over every stored series" />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState title="Nothing to screen yet">
        Import daily OHLC files first. The screener only reads candles already
        stored locally, so it works offline.
      </EmptyState>
    );
  }

  const activePreset = PRESETS.find((item) => item.value === preset)!;

  const exportRows = () =>
    downloadCsv(
      `nepse-screener-${new Date().toISOString().slice(0, 10)}.csv`,
      sorted.map((row) => {
        const company = companyBySymbol.get(row.symbol);
        return {
          symbol: row.symbol,
          name: company?.name ?? "",
          sector: company?.sector ?? "",
          instrument: company?.instrumentType ?? "",
          lastSession: row.to,
          close: row.lastClose,
          return1M: row.return1M,
          return3M: row.return3M,
          return1Y: row.return1Y,
          rsi14: row.rsi14,
          macdState: row.macdState,
          trend: row.trend,
          position52w: row.position52w,
          volatility3M: row.volatility3M,
          maxDrawdown1Y: row.maxDrawdown1Y,
          volumeRatio: row.volumeRatio,
          patterns: row.patterns.map((pattern) => pattern.name).join("; "),
          signalRating: row.signalRating,
          signalScore: row.signalScore,
          state: row.provenance.state,
          classification: "DERIVED from " + row.provenance.classification,
        };
      }),
    );

  return (
    <div className="stack">
      <Card
        title="Screen"
        subtitle={`${filtered.length} of ${rows.length} series · computed ${screenerState.data?.generatedAt.slice(0, 16).replace("T", " ")} UTC`}
        action={
          <div className="card-actions">
            <Badge tone="info">derived</Badge>
            {screenerState.data && (
              <DataStateBadge
                state={
                  filtered.length === 0
                    ? "unavailable"
                    : filtered.some((row) => row.provenance.stale)
                      ? "stale"
                      : "eod"
                }
                classification={screenerState.data.dataState.classification}
                title="State of the series currently shown, not of the whole store"
              />
            )}
          </div>
        }
      >
        <div className="presets" role="group" aria-label="Quick screens">
          {QUICK_PRESETS.map((value) => {
            const item = PRESETS.find((entry) => entry.value === value)!;
            return (
              <button
                key={item.value}
                type="button"
                className="toggle-chip"
                aria-pressed={preset === item.value}
                title={item.rule}
                onClick={() => setPreset(item.value)}
              >
                {item.label}
              </button>
            );
          })}
          <select
            className="preset-more"
            aria-label="More screens"
            value={QUICK_PRESETS.includes(preset) ? "" : preset}
            onChange={(event) => event.target.value && setPreset(event.target.value as Preset)}
          >
            <option value="">More screens…</option>
            {PRESET_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.values.map((value) => {
                  const item = PRESETS.find((entry) => entry.value === value)!;
                  return (
                    <option key={value} value={value}>
                      {item.label} — {item.rule}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="filters">
          <label className="grow">
            <span>Symbol or name</span>
            <input
              value={search}
              placeholder="NABIL, hydro…"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            <span>Instrument</span>
            <select value={instrument} onChange={(event) => setInstrument(event.target.value)}>
              <option value="all">All instruments</option>
              {instruments.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Sector</span>
            <select value={sector} onChange={(event) => setSector(event.target.value)}>
              <option value="all">All sectors</option>
              {sectors.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label title="Large = top 10% by market cap, High = next 20%, Mid = next 30%, Low = bottom 40%">
            <span>Market cap</span>
            <select
              value={capClass}
              disabled={caps.values.size === 0}
              title={
                caps.values.size === 0
                  ? "No market caps yet: shares outstanding comes from company profiles. Use Fetch company profiles on the Data page to load them."
                  : undefined
              }
              onChange={(event) => setCapClass(event.target.value as "all" | CapClass)}
            >
              <option value="all">{caps.values.size === 0 ? "No market-cap data" : "All sizes"}</option>
              <option value="Large">Large cap (top 10%)</option>
              <option value="High">High cap (next 20%)</option>
              <option value="Mid">Mid cap (next 30%)</option>
              <option value="Low">Low cap (bottom 40%)</option>
            </select>
          </label>
          <label>
            <span>Avg volume 20 ≥</span>
            <input
              value={minVolume}
              inputMode="numeric"
              placeholder="0"
              onChange={(event) => setMinVolume(event.target.value)}
            />
          </label>
          <label className="checkbox" title={`${excluded.stale} series are older than the freshness window`}>
            <input
              type="checkbox"
              checked={hideStale}
              onChange={(event) => setHideStale(event.target.checked)}
            />
            <span>Hide stale ({excluded.stale})</span>
          </label>
          <label className="checkbox" title={`${excluded.inactive} series are delisted or merged`}>
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(event) => setActiveOnly(event.target.checked)}
            />
            <span>Active only ({excluded.inactive} delisted)</span>
          </label>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          <strong>{activePreset.label}:</strong> {activePreset.rule}. Signal mix
          in matches: <span className="tone-up">{ratingCounts.bull} bullish</span>{" "}
          · {ratingCounts.neutral} neutral ·{" "}
          <span className="tone-down">{ratingCounts.bear} bearish</span>.
        </p>
      </Card>

      <Card
        title="Matches"
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
        footer={
          <>
            Every column is computed locally from stored end-of-day closes:
            returns use calendar windows, volatility is annualised with sessions
            per year measured from each series, drawdown is from the running
            peak. Prices are unadjusted for corporate actions. Stale and
            delisted series are hidden by default so an old close cannot pass as
            a current signal.
          </>
        }
      >
        {sorted.length === 0 ? (
          <EmptyState title="No symbols match these filters" />
        ) : (
          <div className="table-scroll tall">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Symbol" sortKey="symbol" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <SortHeader label="Close" sortKey="lastClose" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="1W" sortKey="return1W" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="1M" sortKey="return1M" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="3M" sortKey="return3M" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="1Y" sortKey="return1Y" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="RSI" sortKey="rsi14" sort={sort} onSort={toggle} align="right" />
                  <th>MACD</th>
                  <th>Trend</th>
                  <SortHeader label="52w position" sortKey="position52w" sort={sort} onSort={toggle} />
                  <SortHeader label="Vol 3M" sortKey="volatility3M" sort={sort} onSort={toggle} align="right" title="Annualised volatility, last ~63 sessions" />
                  <SortHeader label="Max DD 1Y" sortKey="maxDrawdown1Y" sort={sort} onSort={toggle} align="right" defaultDirection="asc" />
                  <SortHeader label="Vol ×" sortKey="volumeRatio" sort={sort} onSort={toggle} align="right" title="Last volume / 20-session average" />
                  <SortHeader label="3d vol ×" sortKey="volume3dRatio" sort={sort} onSort={toggle} align="right" title="Last 3 sessions' volume / prior average 3-session volume" />
                  <SortHeader label="Avg move" sortKey="avgAbsMove20" sort={sort} onSort={toggle} align="right" title="Average absolute daily move, 20 sessions" />
                  <SortHeader label="Mkt cap" sortKey="marketCap" sort={sort} onSort={toggle} align="right" title="Published market cap, else shares outstanding × close (derived)" />
                  <th>Last candle</th>
                  <SortHeader label="Signal" sortKey="signalScore" sort={sort} onSort={toggle} />
                  <SortHeader label="Session" sortKey="to" sort={sort} onSort={toggle} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const company = companyBySymbol.get(row.symbol);
                  const pattern =
                    row.patterns.find((item) => item.bias !== "neutral") ?? row.patterns[0];
                  return (
                    <ClickableRow key={row.symbol} onClick={() => onOpenSymbol(row.symbol)}>
                      <td>
                        <strong>{row.symbol}</strong>
                        <span className="cell-sub">
                          {company ? `${company.sector} · ${company.name}` : ""}
                        </span>
                      </td>
                      <td className="right">{formatNumber(row.lastClose)}</td>
                      <td className="right"><Delta value={(row as Extended).return1W ?? null} /></td>
                      <td className="right"><Delta value={row.return1M} /></td>
                      <td className="right"><Delta value={row.return3M} /></td>
                      <td className="right"><Delta value={row.return1Y} /></td>
                      <td className="right">
                        <span
                          className={
                            row.rsiZone === "overbought"
                              ? "tone-down"
                              : row.rsiZone === "oversold"
                                ? "tone-up"
                                : ""
                          }
                        >
                          {formatNumber(row.rsi14, 0)}
                        </span>
                      </td>
                      <td>
                        {row.macdState ? (
                          <Badge tone={row.macdState === "bullish" ? "good" : "bad"}>
                            {row.macdState === "bullish" ? "▲" : "▼"}
                          </Badge>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {row.trend === "up" ? (
                          <Badge tone="good">up</Badge>
                        ) : row.trend === "down" ? (
                          <Badge tone="bad">down</Badge>
                        ) : row.trend === "sideways" ? (
                          <Badge>sideways</Badge>
                        ) : (
                          <span className="muted">—</span>
                        )}
                        {row.cross && (
                          <span className="cell-sub">
                            {row.cross.type} cross {row.cross.sessionsAgo}d ago
                          </span>
                        )}
                      </td>
                      <td style={{ minWidth: 110 }}>
                        <RangeBar
                          low={row.low52w}
                          high={row.high52w}
                          value={row.lastClose}
                          showLabels={false}
                        />
                      </td>
                      <td className="right">{formatNumber(row.volatility3M, 1)}%</td>
                      <td className="right tone-down">{formatNumber(row.maxDrawdown1Y, 1)}%</td>
                      <td className="right">{formatNumber(row.volumeRatio)}</td>
                      <td className="right">{formatNumber((row as Extended).volume3dRatio ?? null)}</td>
                      <td className="right">
                        {(row as Extended).avgAbsMove20 != null ? `${(row as Extended).avgAbsMove20!.toFixed(1)}%` : "—"}
                      </td>
                      <td className="right">
                        {marketCapOf(row.symbol) !== null ? formatCompact(marketCapOf(row.symbol)) : "—"}
                        <span className="cell-sub">{caps.classes.get(row.symbol) ?? ""}</span>
                      </td>
                      <td>
                        {pattern ? (
                          <Badge
                            tone={
                              pattern.bias === "bullish"
                                ? "good"
                                : pattern.bias === "bearish"
                                  ? "bad"
                                  : "neutral"
                            }
                          >
                            {pattern.name}
                          </Badge>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <RatingBadge rating={row.signalRating} />
                      </td>
                      <td>
                        <AsOf value={row.provenance?.asOf ?? row.to} ageSeconds={null} />{" "}
                        {row.provenance.stale && (
                          <DataStateBadge state="stale" showClassification={false} />
                        )}
                      </td>
                    </ClickableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

import { useMemo, useState } from "react";
import { formatNumber } from "../api";
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
  | "golden"
  | "oversold"
  | "overbought"
  | "near-high"
  | "volume-spike"
  | "macd-bull"
  | "bull-candle"
  | "low-vol";

const PRESETS: Array<{ value: Preset; label: string; rule: string; test: (row: ScreenerRow) => boolean }> = [
  { value: "all", label: "All", rule: "No preset", test: () => true },
  {
    value: "uptrend",
    label: "Uptrend",
    rule: "SMA 20 > SMA 50 > SMA 200",
    test: (row) => row.trend === "up",
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

type SortKey =
  | "symbol"
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
  }, [rows, companyBySymbol, search, sector, instrument, hideStale, activeOnly, minVolume, preset]);

  const { sorted, sort, toggle } = useSort<ScreenerRow, SortKey>(
    filtered,
    { key: "signalScore", direction: "desc" },
    (row, key) => (key === "symbol" ? row.symbol : row[key]),
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
        <div className="presets" role="group" aria-label="Presets">
          {PRESETS.map((item) => (
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
          ))}
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

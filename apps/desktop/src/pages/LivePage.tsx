import { useEffect, useMemo, useState } from "react";
import { formatCompact, formatNumber } from "../api";
import { useApi } from "../hooks";
import type { CompaniesResponse, QuotesResponse } from "../types";
import type {
  LiveDepth,
  LiveMarket,
  LiveQuote,
  LiveStatus,
  LiveSummary,
} from "../live/types";
import {
  Badge,
  Card,
  ClickableRow,
  Delta,
  EmptyState,
  Notice,
  SortHeader,
  Spinner,
  Stat,
  useSort,
} from "../components/ui";

type SortKey = "symbol" | "ltp" | "changePercent" | "volume" | "turnover";

function useTicker(ms: number, active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), ms);
    return () => window.clearInterval(timer);
  }, [ms, active]);
  return tick;
}

function nptTime(value: string | null): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return `${new Date(ms + (5 * 60 + 45) * 60_000).toISOString().slice(0, 19).replace("T", " ")} NPT`;
}

export function LivePage({ onOpenSymbol }: { onOpenSymbol: (symbol: string) => void }) {
  const status = useApi<LiveStatus>("/api/live/status");
  const open = status.data?.marketOpen === true;
  // Poll every 15 s while the market is open, every 5 min otherwise.
  const tick = useTicker(open ? 15_000 : 300_000, Boolean(status.data?.enabled));
  const market = useApi<LiveMarket>(`/api/live/market?t=${tick}`);
  const summary = useApi<LiveSummary>(`/api/live/summary?t=${tick}`);
  const companies = useApi<CompaniesResponse>("/api/companies");
  // End-of-day quotes are the fallback when the market is closed and the live
  // feed is empty, so the page still shows the last session.
  const quotes = useApi<QuotesResponse>("/api/quotes");
  const [search, setSearch] = useState("");
  const [depthSymbol, setDepthSymbol] = useState<string | null>(null);
  const depth = useApi<LiveDepth>(
    depthSymbol ? `/api/live/depth?symbol=${encodeURIComponent(depthSymbol)}&t=${tick}` : null,
  );

  useEffect(() => {
    if (tick > 0) status.reload();
    // status.reload is stable enough for a periodic refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const nameOf = useMemo(
    () => new Map((companies.data?.companies ?? []).map((c) => [c.symbol, c.name])),
    [companies.data],
  );

  const closed = status.data?.marketOpen === false;
  const liveRows = market.data?.rows ?? [];
  const eodRows = useMemo<LiveQuote[]>(
    () =>
      (quotes.data?.quotes ?? []).map((quote) => ({
        symbol: quote.symbol,
        ltp: quote.ltp,
        previousClose: quote.previousClose,
        change: quote.change,
        changePercent: quote.changePercent,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        volume: quote.volume,
        turnover: quote.turnover,
        lastTradedAt: quote.asOf,
      })),
    [quotes.data],
  );
  const usingEod = closed && liveRows.length === 0 && eodRows.length > 0;
  const displayRows = liveRows.length > 0 ? liveRows : closed ? eodRows : liveRows;
  const sessionDate = useMemo(() => {
    const dates = eodRows
      .map((row) => row.lastTradedAt?.slice(0, 10) ?? "")
      .filter(Boolean)
      .sort();
    return dates.at(-1) ?? market.data?.asOf?.slice(0, 10) ?? null;
  }, [eodRows, market.data?.asOf]);

  const rows = useMemo(() => {
    const needle = search.trim().toUpperCase();
    return displayRows.filter(
      (row) =>
        !needle ||
        row.symbol.includes(needle) ||
        (nameOf.get(row.symbol)?.toUpperCase().includes(needle) ?? false),
    );
  }, [displayRows, search, nameOf]);

  const { sorted, sort, toggle } = useSort<LiveQuote, SortKey>(
    rows,
    { key: "turnover", direction: "desc" },
    (row, key) => (key === "symbol" ? row.symbol : row[key]),
  );

  if (status.loading && !status.data) return <Spinner label="Checking the live service" />;

  if (status.error || !status.data) {
    return (
      <EmptyState title="Live service not available in this build">
        {status.error ?? "The local API did not answer /api/live/status."}
      </EmptyState>
    );
  }

  if (!status.data.enabled) {
    return (
      <EmptyState title="Live market is turned off">
        The live service is disabled (<code>NEPSE_LIVE=0</code>). End-of-day
        data remains available on every other page.
      </EmptyState>
    );
  }

  const error = market.data?.lastError ?? status.data.lastError;
  const gainers = displayRows.filter((r) => (r.changePercent ?? 0) > 0).length;
  const losers = displayRows.filter((r) => (r.changePercent ?? 0) < 0).length;

  return (
    <div className="stack">
      <Notice tone="warn">
        <strong>LIVE · unofficial.</strong> {status.data.disclaimer} Live prices
        are shown here only — they are never written into the end-of-day
        history used by charts, signals and the screener.
      </Notice>

      {error && (
        <Notice tone="error">
          Live data could not be refreshed: {error}
          {market.data?.asOf ? ` Showing the last good snapshot from ${nptTime(market.data.asOf)}.` : ""}
        </Notice>
      )}

      {closed && (
        <Notice tone="warn">
          <strong>Market closed.</strong> NEPSE trades Sunday to Thursday,
          11:00 to 15:00 NPT.{" "}
          {liveRows.length > 0
            ? `Showing the last live snapshot from ${nptTime(market.data?.asOf ?? null)}.`
            : usingEod
              ? `Showing the last stored session${sessionDate ? ` (${sessionDate})` : ""}. Prices are end-of-day closes, not live trades.`
              : "No stored session data is available yet. Automatic updates will fetch it."}
        </Notice>
      )}

      <div className="stats-row">
        <Stat
          label="Market"
          value={open ? "Open" : status.data.marketOpen === false ? "Closed" : "Unknown"}
          badge={<Badge tone={open ? "good" : "neutral"}>{open ? "LIVE" : "idle"}</Badge>}
          hint={
            usingEod
              ? `last stored session${sessionDate ? ` (${sessionDate})` : ""}`
              : `updated ${nptTime(market.data?.asOf ?? status.data.asOf)}`
          }
        />
        <Stat
          label="NEPSE (live)"
          value={summary.data?.index ? formatNumber(summary.data.index.value) : "—"}
          hint={summary.data?.index ? <Delta value={summary.data.index.changePercent} pill /> : "no live index"}
        />
        <Stat
          label="Turnover"
          value={summary.data?.turnover != null ? `Rs ${formatCompact(summary.data.turnover)}` : "—"}
          hint={
            summary.data?.transactions != null
              ? `${formatNumber(summary.data.transactions, 0)} transactions · ${formatNumber(summary.data.scripsTraded, 0)} scrips`
              : undefined
          }
        />
        <Stat
          label="Advancing / declining"
          value={
            <span>
              <span className="tone-up">{gainers}</span>
              <span className="subtle"> / </span>
              <span className="tone-down">{losers}</span>
            </span>
          }
          hint={`${displayRows.length} scrips ${usingEod ? "in the last stored session" : "in the live feed"}`}
        />
      </div>

      <div className="grid main-side">
        <Card
          title="Live market"
          subtitle={
            usingEod
              ? `Market closed · last stored session${sessionDate ? ` (${sessionDate})` : ""}`
              : `Source: ${status.data.source} · refresh every ${open ? "15 s" : "5 min (market closed)"}`
          }
          action={
            <div className="card-actions">
              <input
                type="search"
                placeholder="Filter symbol or name"
                aria-label="Filter live market"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Badge tone="warn">unofficial</Badge>
            </div>
          }
        >
          {market.loading && !market.data ? (
            <Spinner label="Loading live prices" />
          ) : sorted.length === 0 ? (
            <EmptyState title={open ? "No live rows yet" : "No live trading right now"}>
              {open
                ? "The live feed returned no rows."
                : "NEPSE trades Sunday to Thursday, 11:00 to 15:00 NPT. Outside those hours the live feed is empty. If end-of-day data is stored, it appears here as the last session; otherwise it is on the Market page."}
            </EmptyState>
          ) : (
            <div className="table-scroll tall">
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader label="Symbol" sortKey="symbol" sort={sort} onSort={toggle} defaultDirection="asc" />
                    <SortHeader label="LTP" sortKey="ltp" sort={sort} onSort={toggle} align="right" />
                    <SortHeader label="Change" sortKey="changePercent" sort={sort} onSort={toggle} align="right" />
                    <th className="right">Open / High / Low</th>
                    <SortHeader label="Volume" sortKey="volume" sort={sort} onSort={toggle} align="right" />
                    <SortHeader label="Turnover" sortKey="turnover" sort={sort} onSort={toggle} align="right" />
                    <th>Last trade</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => (
                    <ClickableRow key={row.symbol} onClick={() => onOpenSymbol(row.symbol)}>
                      <td>
                        <strong>{row.symbol}</strong>
                        <span className="cell-sub">{row.securityName ?? nameOf.get(row.symbol) ?? ""}</span>
                      </td>
                      <td className="right"><strong>{formatNumber(row.ltp)}</strong></td>
                      <td className="right"><Delta value={row.changePercent} pill /></td>
                      <td className="right muted small">
                        {formatNumber(row.open)} / {formatNumber(row.high)} / {formatNumber(row.low)}
                      </td>
                      <td className="right">{formatCompact(row.volume)}</td>
                      <td className="right">{formatCompact(row.turnover)}</td>
                      <td className="muted small nowrap">{row.lastTradedAt ? nptTime(row.lastTradedAt).slice(11) : "—"}</td>
                      <td className="right">
                        <button
                          type="button"
                          className="button button-ghost button-small"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDepthSymbol(row.symbol);
                          }}
                        >
                          Depth
                        </button>
                      </td>
                    </ClickableRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title={depthSymbol ? `Market depth · ${depthSymbol}` : "Market depth"}
          subtitle="Best bids and asks (live, unofficial; trading hours only)"
        >
          {!depthSymbol ? (
            <EmptyState title="Pick a symbol">Press “Depth” on any row.</EmptyState>
          ) : depth.loading && !depth.data ? (
            <Spinner />
          ) : !depth.data || (depth.data.bids.length === 0 && depth.data.asks.length === 0) ? (
            <EmptyState title="No order book">
              {depth.data?.lastError ?? "Depth is published only while the market is open."}
            </EmptyState>
          ) : (
            <div className="grid two">
              {(["bids", "asks"] as const).map((side) => (
                <table className="table" key={side}>
                  <thead>
                    <tr>
                      <th>{side === "bids" ? "Bid" : "Ask"}</th>
                      <th className="right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depth.data![side].map((level, index) => (
                      <tr key={index}>
                        <td className={side === "bids" ? "tone-up" : "tone-down"}>{formatNumber(level.price)}</td>
                        <td className="right">{formatNumber(level.quantity, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

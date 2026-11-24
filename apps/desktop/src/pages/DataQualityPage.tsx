import { useMemo, useState } from "react";
import { formatNumber } from "../api";
import { useApi } from "../hooks";
import type { DataQualityResponse, DataQualitySymbol } from "../types";
import {
  Badge,
  Card,
  EmptyState,
  Segmented,
  Spinner,
  Stat,
  formatTimestamp,
  type BadgeTone,
} from "../components/ui";

type QualityFilter = "all" | "fresh" | "stale" | "thin" | "discrepancy";

const FILTERS: Array<{ value: QualityFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "fresh", label: "Fresh" },
  { value: "stale", label: "Stale" },
  { value: "thin", label: "Thin" },
  { value: "discrepancy", label: "Discrepancy" },
];

const STATUS_RANK: Record<string, number> = {
  discrepancy: 0,
  stale: 1,
  thin: 2,
  fresh: 3,
};

const STATUS_LABEL: Record<string, string> = {
  discrepancy: "Quote discrepancy",
  stale: "Stale",
  thin: "Thin history",
  fresh: "Fresh",
};

function statusRank(status: string): number {
  return STATUS_RANK[status] ?? 4;
}

function statusTone(status: string): BadgeTone {
  if (status === "fresh") return "good";
  if (status === "discrepancy") return "bad";
  if (status === "stale") return "warn";
  return "info";
}

function sessionDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

function staleValue(row: DataQualitySymbol): number {
  return row.staleDays === null || row.staleDays === undefined
    ? -1
    : row.staleDays;
}

export function DataQualityPage() {
  const state = useApi<DataQualityResponse>("/api/data-quality");
  const [filter, setFilter] = useState<QualityFilter>("all");
  const [search, setSearch] = useState("");

  const data = state.data;
  const rows = useMemo(() => data?.symbols ?? [], [data]);

  const counts = useMemo(() => {
    const result: Record<QualityFilter, number> = {
      all: rows.length,
      fresh: 0,
      stale: 0,
      thin: 0,
      discrepancy: 0,
    };
    for (const row of rows) {
      if (
        row.status === "fresh" ||
        row.status === "stale" ||
        row.status === "thin" ||
        row.status === "discrepancy"
      ) {
        result[row.status] += 1;
      }
    }
    return result;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toUpperCase();
    return rows
      .filter((row) => {
        if (filter !== "all" && row.status !== filter) return false;
        if (needle && !row.symbol.toUpperCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => {
        const rank = statusRank(a.status) - statusRank(b.status);
        if (rank !== 0) return rank;
        const stale = staleValue(b) - staleValue(a);
        if (stale !== 0) return stale;
        const discrepancy =
          Math.abs(b.quoteVsCandlePercent ?? 0) -
          Math.abs(a.quoteVsCandlePercent ?? 0);
        if (discrepancy !== 0) return discrepancy;
        return a.symbol.localeCompare(b.symbol);
      });
  }, [rows, filter, search]);

  if (state.loading && !data) {
    return <Spinner label="Loading data quality" />;
  }

  if (state.error && !data) {
    return (
      <EmptyState title="Could not load data quality">
        {state.error}
      </EmptyState>
    );
  }

  const summary = data?.summary;

  return (
    <div className="stack">
      <div className="stats-row">
        <Stat
          label="Symbols"
          value={formatNumber(summary?.symbols, 0)}
          hint={data?.latestSession ? `latest ${sessionDate(data.latestSession)}` : undefined}
        />
        <Stat
          label="Fresh"
          value={formatNumber(summary?.fresh, 0)}
          tone={summary && summary.fresh > 0 ? "up" : undefined}
          hint="candle and quote recent"
        />
        <Stat
          label="Stale"
          value={formatNumber(summary?.stale, 0)}
          tone={summary && summary.stale > 0 ? "down" : undefined}
          hint="behind the latest session"
        />
        <Stat
          label="Missing sessions"
          value={formatNumber(summary?.missingSessions, 0)}
          hint="summed across symbols"
        />
        <Stat
          label="Quote discrepancies"
          value={formatNumber(summary?.quoteDiscrepancies, 0)}
          hint="quote vs last close"
        />
      </div>

      <Card
        title="Symbol quality"
        subtitle={
          data
            ? `Generated ${formatTimestamp(data.generatedAt)} · worst first`
            : "Worst first"
        }
        action={
          <div className="card-actions">
            <input
              type="search"
              placeholder="Search symbol"
              aria-label="Search symbols"
              value={search}
              onChange={(event) => setSearch(event.target.value.toUpperCase())}
            />
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={state.reload}
            >
              Refresh
            </button>
          </div>
        }
        footer={
          <>
            Missing sessions count recent market sessions (stored sessions where
            at least 60% of symbols traded) with no candle for this symbol, so a
            newly listed symbol also shows the sessions before it listed.
            Exchange holidays are not known, so a holiday can look like a gap. A
            quote discrepancy compares the stored end-of-day quote with the last
            candle close; it flags a source mismatch, it does not decide which
            value is right. This page shows what to inspect, it never fills or
            corrects a series.
          </>
        }
      >
        <div className="row-between" style={{ marginBottom: 12 }}>
          <Segmented
            value={filter}
            onChange={setFilter}
            items={FILTERS.map((item) => ({
              value: item.value,
              label: `${item.label} (${counts[item.value]})`,
            }))}
            label="Filter by quality status"
          />
          <span className="muted small">
            {filtered.length} of {rows.length}
          </span>
        </div>

        {state.error && data && (
          <p className="form-error">
            Refresh failed: {state.error}. Showing the last loaded result.
          </p>
        )}

        {filtered.length === 0 ? (
          <EmptyState title="No symbols match">
            {rows.length === 0
              ? "The local store has no symbols to assess yet."
              : "Change the status filter or clear the search."}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="right">Last close</th>
                  <th className="right">Last quote</th>
                  <th className="right">Sessions</th>
                  <th className="right">Stale days</th>
                  <th className="right">Missing</th>
                  <th className="right">Quote vs candle</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.symbol}>
                    <td>
                      <strong>{row.symbol}</strong>
                    </td>
                    <td className="right">{formatNumber(row.lastCandle)}</td>
                    <td className="right">{formatNumber(row.lastQuote)}</td>
                    <td className="right">{formatNumber(row.sessions, 0)}</td>
                    <td
                      className={`right ${
                        row.staleDays === null || row.staleDays === 0
                          ? ""
                          : "tone-down"
                      }`}
                    >
                      {formatNumber(row.staleDays, 0)}
                    </td>
                    <td
                      className={`right ${
                        row.missingSessions > 0 ? "tone-down" : ""
                      }`}
                    >
                      {formatNumber(row.missingSessions, 0)}
                    </td>
                    <td
                      className={`right ${
                        row.quoteVsCandlePercent === null
                          ? ""
                          : row.quoteVsCandlePercent >= 0
                            ? "tone-up"
                            : "tone-down"
                      }`}
                    >
                      {row.quoteVsCandlePercent === null
                        ? "—"
                        : `${formatNumber(row.quoteVsCandlePercent)}%`}
                    </td>
                    <td>
                      <Badge tone={statusTone(row.status)}>
                        {STATUS_LABEL[row.status] ?? row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

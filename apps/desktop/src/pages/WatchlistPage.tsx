import { useEffect, useMemo, useState } from "react";
import { returnCorrelation } from "@stock/analytics";
import { api, formatNumber } from "../api";
import { useApi } from "../hooks";
import type {
  Candle,
  CandlesResponse,
  CompaniesResponse,
  QuotesResponse,
  ScreenerResponse,
} from "../types";
import {
  AsOf,
  Badge,
  Card,
  ClickableRow,
  DataStateBadge,
  Delta,
  EmptyState,
  RatingBadge,
  Sparkline,
  Spinner,
  heatStyle,
} from "../components/ui";

interface WatchlistResponse {
  symbols: string[];
}

const MATRIX_LIMIT = 12;

/** Loads stored daily candles for a set of symbols (local API only). */
function useCandleSets(symbols: string[]) {
  const [sets, setSets] = useState<Record<string, Candle[]>>({});
  const [loading, setLoading] = useState(false);
  const key = symbols.join(",");

  useEffect(() => {
    if (symbols.length === 0) {
      setSets({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(
      symbols.map((symbol) =>
        api<CandlesResponse>(`/api/candles?symbol=${encodeURIComponent(symbol)}`)
          .then((response) => [symbol, response.candles] as const)
          .catch(() => [symbol, [] as Candle[]] as const),
      ),
    )
      .then((entries) => {
        if (!cancelled) setSets(Object.fromEntries(entries));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // key captures the symbol list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { sets, loading };
}

export function WatchlistPage({
  onOpenSymbol,
}: {
  onOpenSymbol: (symbol: string) => void;
}) {
  const watchState = useApi<WatchlistResponse>("/api/watchlist");
  const quotesState = useApi<QuotesResponse>("/api/quotes");
  const companiesState = useApi<CompaniesResponse>("/api/companies");
  const screenerState = useApi<ScreenerResponse>("/api/screener");
  const [busy, setBusy] = useState<string | null>(null);

  const symbols = watchState.data?.symbols ?? [];
  const { sets, loading: candlesLoading } = useCandleSets(symbols);

  const provenance = quotesState.data?.provenance ?? {};
  const companyBySymbol = useMemo(
    () =>
      new Map(
        (companiesState.data?.companies ?? []).map((company) => [company.symbol, company]),
      ),
    [companiesState.data],
  );
  const quoteBySymbol = useMemo(
    () => new Map((quotesState.data?.quotes ?? []).map((quote) => [quote.symbol, quote])),
    [quotesState.data],
  );
  const screenBySymbol = useMemo(
    () => new Map((screenerState.data?.rows ?? []).map((row) => [row.symbol, row])),
    [screenerState.data],
  );

  const matrixSymbols = symbols
    .filter((symbol) => (sets[symbol]?.length ?? 0) > 30)
    .slice(0, MATRIX_LIMIT);
  const matrix = useMemo(() => {
    const values: Array<Array<number | null>> = matrixSymbols.map((a) =>
      matrixSymbols.map((b) =>
        a === b ? 1 : returnCorrelation(sets[a] ?? [], sets[b] ?? [], 250),
      ),
    );
    const pairs: number[] = [];
    values.forEach((row, i) =>
      row.forEach((value, j) => {
        if (j > i && value !== null) pairs.push(value);
      }),
    );
    return {
      values,
      average: pairs.length ? pairs.reduce((s, v) => s + v, 0) / pairs.length : null,
    };
    // matrixSymbols is derived from symbols + sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets, matrixSymbols.join(",")]);

  async function remove(symbol: string) {
    setBusy(symbol);
    try {
      await api<WatchlistResponse>("/api/watchlist", {
        method: "POST",
        body: JSON.stringify({ symbol, action: "remove" }),
      });
      watchState.reload();
    } finally {
      setBusy(null);
    }
  }

  if (watchState.loading) return <Spinner label="Loading watchlist" />;

  return (
    <div className="stack">
      <Card
        title="Watchlist"
        subtitle={`${symbols.length} symbol${symbols.length === 1 ? "" : "s"} stored locally`}
        action={
          quotesState.data ? (
            <DataStateBadge
              state={quotesState.data.dataState.state}
              classification={quotesState.data.dataState.classification}
            />
          ) : undefined
        }
        footer="Returns, RSI, volatility and the signal tally are derived from stored end-of-day closes."
      >
        {symbols.length === 0 ? (
          <EmptyState title="Your watchlist is empty">
            Open a company (Ctrl K, type a symbol) and press the star.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>90 sessions</th>
                  <th className="right">Close</th>
                  <th className="right">Day</th>
                  <th className="right">1M</th>
                  <th className="right">3M</th>
                  <th className="right">1Y</th>
                  <th className="right">RSI</th>
                  <th className="right">Vol 3M</th>
                  <th>Signal</th>
                  <th>As of / state</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {symbols.map((symbol) => {
                  const quote = quoteBySymbol.get(symbol);
                  const company = companyBySymbol.get(symbol);
                  const screen = screenBySymbol.get(symbol);
                  const entry = provenance[symbol];
                  const closes = (sets[symbol] ?? []).slice(-90).map((c) => c.close);
                  return (
                    <ClickableRow key={symbol} onClick={() => onOpenSymbol(symbol)}>
                      <td>
                        <strong>{symbol}</strong>
                        <span className="cell-sub">
                          {company ? `${company.sector} · ${company.name}` : ""}
                        </span>
                      </td>
                      <td>
                        {candlesLoading && closes.length === 0 ? (
                          <span className="muted small">…</span>
                        ) : (
                          <Sparkline values={closes} width={110} height={28} />
                        )}
                      </td>
                      <td className="right">
                        {formatNumber(quote?.ltp ?? screen?.lastClose)}
                      </td>
                      <td className="right">
                        <Delta value={quote?.changePercent} />
                      </td>
                      <td className="right"><Delta value={screen?.return1M} /></td>
                      <td className="right"><Delta value={screen?.return3M} /></td>
                      <td className="right"><Delta value={screen?.return1Y} /></td>
                      <td className="right">{formatNumber(screen?.rsi14, 0)}</td>
                      <td className="right">
                        {screen?.volatility3M != null ? `${screen.volatility3M.toFixed(1)}%` : "—"}
                      </td>
                      <td>
                        {screenerState.loading ? (
                          <span className="muted small">…</span>
                        ) : (
                          <RatingBadge rating={screen?.signalRating} />
                        )}
                      </td>
                      <td>
                        {quote ? (
                          <>
                            <AsOf value={entry?.asOf ?? quote.asOf} ageSeconds={entry?.ageSeconds} />{" "}
                            {entry && (
                              <DataStateBadge
                                state={entry.state}
                                classification={entry.classification}
                                showClassification={false}
                              />
                            )}
                          </>
                        ) : screen ? (
                          <>
                            <span className="muted small">last close {screen.to}</span>{" "}
                            <DataStateBadge state={screen.provenance.state} showClassification={false} />
                          </>
                        ) : (
                          <span className="muted small">no stored price</span>
                        )}
                      </td>
                      <td className="right">
                        <button
                          className="button button-ghost button-small"
                          disabled={busy === symbol}
                          onClick={(event) => {
                            event.stopPropagation();
                            void remove(symbol);
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </ClickableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {symbols.length >= 2 && (
        <Card
          title="Correlation matrix"
          subtitle={`Pearson correlation of daily returns over up to 250 common sessions${
            symbols.length > MATRIX_LIMIT ? ` · first ${MATRIX_LIMIT} symbols` : ""
          }`}
          action={<Badge tone="info">derived</Badge>}
          footer={
            <>
              Computed only on dates both series traded; nothing is filled.
              Average pairwise correlation{" "}
              <strong>{matrix.average === null ? "—" : matrix.average.toFixed(2)}</strong>
              {matrix.average !== null &&
                (matrix.average > 0.6
                  ? " — these symbols tend to move together, so the list is not very diversified."
                  : matrix.average < 0.3
                    ? " — these symbols move fairly independently."
                    : " — moderate co-movement.")}
            </>
          }
        >
          {candlesLoading ? (
            <Spinner label="Loading histories" />
          ) : matrixSymbols.length < 2 ? (
            <EmptyState title="Needs at least two symbols with 30+ sessions" />
          ) : (
            <div className="scroll-x">
              <div
                className="corr-grid"
                style={{
                  gridTemplateColumns: `72px repeat(${matrixSymbols.length}, minmax(52px, 1fr))`,
                  minWidth: 72 + matrixSymbols.length * 56,
                }}
              >
                <span />
                {matrixSymbols.map((symbol) => (
                  <span key={`h-${symbol}`} className="corr-head">
                    {symbol}
                  </span>
                ))}
                {matrixSymbols.map((rowSymbol, i) => [
                  <span key={`r-${rowSymbol}`} className="corr-head" style={{ textAlign: "left" }}>
                    {rowSymbol}
                  </span>,
                  ...matrixSymbols.map((colSymbol, j) => {
                    const value = matrix.values[i]?.[j] ?? null;
                    const style = i === j ? { background: "var(--surface-3)" } : heatStyle(value, 1);
                    return (
                      <span
                        key={`${rowSymbol}-${colSymbol}`}
                        className="corr-cell"
                        style={style}
                        title={`${rowSymbol} vs ${colSymbol}`}
                      >
                        {value === null ? "—" : value.toFixed(2)}
                      </span>
                    );
                  }),
                ])}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { breadth, quantProfile, sectorBreadth } from "@stock/analytics";
import { useApi } from "../hooks";
import { formatCompact, formatNumber } from "../api";
import type {
  CandlesResponse,
  CompaniesResponse,
  IndicesResponse,
  Quote,
  QuotesResponse,
  ScreenerResponse,
  SummaryResponse,
} from "../types";
import {
  AsOf,
  Avatar,
  Badge,
  BreadthBar,
  Card,
  ClickableRow,
  DataStateBadge,
  Delta,
  EmptyState,
  MiniStats,
  RatingBadge,
  SortHeader,
  Sparkline,
  Spinner,
  Stat,
  Tabs,
  heatStyle,
  toneOf,
  useSort,
} from "../components/ui";
import { PriceChart } from "../components/PriceChart";
import { nptDate } from "../lib";

type MoverTab = "gainers" | "losers" | "turnover" | "volume";
type MarketSortKey =
  | "symbol"
  | "sector"
  | "ltp"
  | "changePercent"
  | "volume"
  | "turnover";

export function MarketPage({
  onOpenSymbol,
  onOpenData,
}: {
  onOpenSymbol: (symbol: string) => void;
  onOpenData: () => void;
}) {
  const summaryState = useApi<SummaryResponse>("/api/summary");
  const quotesState = useApi<QuotesResponse>("/api/quotes");
  const companiesState = useApi<CompaniesResponse>("/api/companies");
  const indicesState = useApi<IndicesResponse>("/api/indices");
  const screenerState = useApi<ScreenerResponse>("/api/screener");

  const [moverTab, setMoverTab] = useState<MoverTab>("gainers");
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const companies = companiesState.data?.companies ?? [];
  const summary = summaryState.data?.summary ?? null;
  const sectorsPublished = summaryState.data?.sectors ?? [];
  const quoteProvenance = quotesState.data?.provenance ?? {};

  const companyBySymbol = useMemo(
    () => new Map(companies.map((company) => [company.symbol, company])),
    [companies],
  );

  const currentIndex =
    indicesState.data?.indices.find((index) => !index.isSector) ??
    indicesState.data?.indices[0] ??
    null;
  const indexHistoryState = useApi<CandlesResponse>(
    `/api/candles?kind=index&symbol=${encodeURIComponent(
      currentIndex?.symbol ?? "NEPSE",
    )}`,
  );
  const indexHistory = indexHistoryState.data?.candles ?? [];
  const indexProvenance = indexHistoryState.data?.provenance ?? null;
  const indexProfile = useMemo(
    () => (indexHistory.length > 30 ? quantProfile(indexHistory) : null),
    [indexHistory],
  );

  // Rank only quotes from the latest stored session so movers never mix days.
  const allQuotes = quotesState.data?.quotes ?? [];
  const latestSession = useMemo(() => {
    let latest: string | null = null;
    for (const quote of allQuotes) {
      const date = nptDate(quote.asOf);
      if (date && (!latest || date > latest)) latest = date;
    }
    return latest;
  }, [allQuotes]);
  const sessionQuotes = useMemo(
    () => allQuotes.filter((quote) => nptDate(quote.asOf) === latestSession),
    [allQuotes, latestSession],
  );
  const olderQuotes = allQuotes.length - sessionQuotes.length;

  const marketBreadth = useMemo(() => breadth(sessionQuotes), [sessionQuotes]);
  const sectors = useMemo(
    () =>
      sectorBreadth(
        sessionQuotes,
        (symbol) => companyBySymbol.get(symbol)?.sector,
      ),
    [sessionQuotes, companyBySymbol],
  );

  const indexValue = summary?.indexValue ?? currentIndex?.value ?? null;
  const indexChangePercent =
    summary?.changePercent ?? currentIndex?.changePercent ?? null;
  const indexAsOf =
    summaryState.data?.provenance.summary?.asOf ??
    summary?.asOf ??
    currentIndex?.asOf ??
    null;
  const lastIndexCandle = indexHistory.at(-1);
  // The archive's NEPSE index file publishes market turnover (traded_amount).
  // It is source-reported, unverified, and shown only when present.
  const reportedTurnover =
    summary?.turnover ??
    (lastIndexCandle?.turnover && lastIndexCandle.turnover > 0
      ? lastIndexCandle.turnover
      : null);
  const turnoverSeries = indexHistory
    .slice(-30)
    .map((candle) => candle.turnover ?? 0)
    .filter((value) => value > 0);
  const averageTurnover =
    turnoverSeries.length > 0
      ? turnoverSeries.reduce((sum, value) => sum + value, 0) / turnoverSeries.length
      : null;

  const screenerRows = screenerState.data?.rows ?? [];
  const trendBreadth = useMemo(() => {
    const eligible = screenerRows.filter((row) => {
      const company = companyBySymbol.get(row.symbol);
      return (
        company?.instrumentType === "Equity" &&
        company.status === "active" &&
        !row.provenance.stale &&
        row.aboveSma200 !== null
      );
    });
    const above = eligible.filter((row) => row.aboveSma200).length;
    const above50 = eligible.filter((row) => row.aboveSma50).length;
    return {
      total: eligible.length,
      above200: above,
      above50,
      percent200: eligible.length ? (above / eligible.length) * 100 : null,
      percent50: eligible.length ? (above50 / eligible.length) * 100 : null,
    };
  }, [screenerRows, companyBySymbol]);

  const todaysPatterns = useMemo(
    () =>
      screenerRows
        .filter((row) => {
          const company = companyBySymbol.get(row.symbol);
          return (
            row.to === latestSession &&
            row.patterns.length > 0 &&
            company?.instrumentType === "Equity" &&
            company.status === "active"
          );
        })
        .flatMap((row) =>
          row.patterns
            .filter((pattern) => pattern.bias !== "neutral")
            .map((pattern) => ({ row, pattern })),
        )
        .sort((a, b) =>
          a.pattern.bias === b.pattern.bias
            ? a.row.symbol.localeCompare(b.row.symbol)
            : a.pattern.bias === "bullish"
              ? -1
              : 1,
        ),
    [screenerRows, latestSession, companyBySymbol],
  );

  const movers = useMemo(() => {
    const list = [...sessionQuotes];
    if (moverTab === "gainers") {
      return list.filter((q) => q.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 10);
    }
    if (moverTab === "losers") {
      return list.filter((q) => q.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 10);
    }
    if (moverTab === "turnover") {
      return list.sort((a, b) => b.turnover - a.turnover).slice(0, 10);
    }
    return list.sort((a, b) => b.volume - a.volume).slice(0, 10);
  }, [sessionQuotes, moverTab]);

  const tableRows = useMemo(() => {
    const needle = search.trim().toUpperCase();
    return sessionQuotes.filter((quote) => {
      const company = companyBySymbol.get(quote.symbol);
      if (sectorFilter && (company?.sector ?? "Unclassified") !== sectorFilter) {
        return false;
      }
      if (!needle) return true;
      return (
        quote.symbol.includes(needle) ||
        (company?.name.toUpperCase().includes(needle) ?? false)
      );
    });
  }, [sessionQuotes, companyBySymbol, sectorFilter, search]);

  const { sorted, sort, toggle } = useSort<Quote, MarketSortKey>(
    tableRows,
    { key: "turnover", direction: "desc" },
    (quote, key) => {
      if (key === "sector") return companyBySymbol.get(quote.symbol)?.sector ?? "";
      if (key === "symbol") return quote.symbol;
      return quote[key];
    },
  );

  if (
    !quotesState.loading &&
    !summaryState.loading &&
    !indicesState.loading &&
    allQuotes.length === 0 &&
    !summary &&
    indexValue === null
  ) {
    return (
      <EmptyState
        title="No market data imported yet"
        action={
          <button className="button" onClick={onOpenData}>
            Go to Data → Import
          </button>
        }
      >
        <p>
          The Free Edition does not download data by itself. Run{" "}
          <code>pnpm personal:update</code> to fetch the public archive, or put{" "}
          <code>companies.csv</code> and <code>ohlc/&lt;SYMBOL&gt;.csv</code> in
          the app’s data folder and import them.
        </p>
      </EmptyState>
    );
  }

  const quotesBadge = quotesState.data ? (
    <DataStateBadge
      state={quotesState.data.dataState.state}
      classification={quotesState.data.dataState.classification}
    />
  ) : undefined;

  return (
    <div className="stack">
      <div className="stats-row">
        <Stat
          label={currentIndex?.name ?? summary?.indexName ?? "NEPSE index"}
          value={indexValue !== null ? formatNumber(indexValue) : "—"}
          badge={<Badge tone="info">EOD</Badge>}
          hint={
            indexValue !== null ? (
              <>
                <Delta value={indexChangePercent} pill />
                <AsOf value={indexAsOf} ageSeconds={null} />
              </>
            ) : (
              "index unavailable"
            )
          }
        >
          <Sparkline
            values={indexHistory.slice(-60).map((candle) => candle.close)}
            width={220}
            height={34}
          />
        </Stat>
        <Stat
          label="Market turnover"
          value={reportedTurnover !== null ? `Rs ${formatCompact(reportedTurnover)}` : "—"}
          badge={
            reportedTurnover !== null ? <Badge tone="warn">unverified</Badge> : undefined
          }
          hint={
            reportedTurnover !== null ? (
              <>
                <span>
                  30-session avg Rs {formatCompact(averageTurnover)}
                </span>
              </>
            ) : (
              "not published by this source"
            )
          }
        >
          {turnoverSeries.length > 2 && (
            <Sparkline values={turnoverSeries} width={220} height={34} tone="flat" />
          )}
        </Stat>
        <Stat
          label="Breadth"
          value={
            marketBreadth.total > 0 ? (
              <span>
                <span className="tone-up">{marketBreadth.advancers}</span>
                <span className="subtle"> / </span>
                <span className="tone-down">{marketBreadth.decliners}</span>
              </span>
            ) : (
              "—"
            )
          }
          badge={<Badge tone="info">derived</Badge>}
          hint={
            marketBreadth.advanceDeclineRatio !== null
              ? `A/D ratio ${marketBreadth.advanceDeclineRatio.toFixed(2)} · ${marketBreadth.total} closes`
              : `${marketBreadth.total} closes`
          }
        >
          <BreadthBar
            advancers={marketBreadth.advancers}
            unchanged={marketBreadth.unchanged}
            decliners={marketBreadth.decliners}
          />
        </Stat>
        <Stat
          label="Median change"
          value={<Delta value={marketBreadth.medianChangePercent} />}
          badge={<Badge tone="info">derived</Badge>}
          hint={
            <>
              mean <Delta value={marketBreadth.meanChangePercent} /> · equal-weighted
            </>
          }
        />
        <Stat
          label="Above SMA 200"
          value={
            screenerState.loading
              ? "…"
              : trendBreadth.percent200 !== null
                ? `${trendBreadth.percent200.toFixed(0)}%`
                : "—"
          }
          badge={<Badge tone="info">derived</Badge>}
          hint={
            screenerState.loading
              ? "computing from stored candles"
              : `${trendBreadth.above200} of ${trendBreadth.total} active equities · ${
                  trendBreadth.percent50 !== null ? trendBreadth.percent50.toFixed(0) : "—"
                }% above SMA 50`
          }
        />
      </div>

      {olderQuotes > 0 && (
        <p className="muted small">
          Showing the {sessionQuotes.length} closes from the latest stored session
          ({latestSession}). {olderQuotes} symbol{olderQuotes === 1 ? "" : "s"} did
          not trade that day and {olderQuotes === 1 ? "is" : "are"} excluded from
          breadth and movers.
        </p>
      )}

      <div className="grid main-side">
        <Card
          title={`${currentIndex?.name ?? "NEPSE Index"}`}
          subtitle={
            indexHistory.length > 1
              ? `${indexHistory[0]?.timestamp.slice(0, 10)} → ${indexHistory.at(-1)?.timestamp.slice(0, 10)} · ${indexHistory.length.toLocaleString()} sessions · end-of-day`
              : "end-of-day index history"
          }
          action={
            indexProvenance ? (
              <DataStateBadge
                state={indexProvenance.state}
                classification={indexProvenance.classification}
              />
            ) : undefined
          }
          footer={
            <>
              Index level from stored end-of-day history. Share volume is not
              published for the index. Returns, volatility and drawdown are
              derived from these closes.
            </>
          }
        >
          {indexHistoryState.loading ? (
            <Spinner label="Loading index history" />
          ) : indexHistory.length > 1 ? (
            <div className="stack">
              <PriceChart
                candles={indexHistory}
                size="compact"
                defaultRange="1Y"
                defaultOverlays={["sma50", "sma200"]}
                defaultStudies={[]}
                showVolume={false}
              />
              {indexProfile && (
                <MiniStats
                  items={[
                    ...(["1W", "1M", "3M", "YTD", "1Y", "3Y"] as const).map((key) => ({
                      label: key,
                      value: <Delta value={indexProfile.returns[key]} />,
                    })),
                    {
                      label: "Vol 1Y",
                      value: `${formatNumber(indexProfile.volatility1Y)}%`,
                      hint: "annualised",
                    },
                    {
                      label: "Max DD 1Y",
                      value: `${formatNumber(indexProfile.maxDrawdown1Y)}%`,
                      tone: "down",
                    },
                  ]}
                />
              )}
            </div>
          ) : (
            <EmptyState title="No index history stored" />
          )}
        </Card>

        <Card
          title="Movers"
          subtitle={latestSession ? `Session ${latestSession}` : "Latest session"}
          action={quotesBadge}
        >
          <Tabs<MoverTab>
            label="Movers"
            value={moverTab}
            onChange={setMoverTab}
            items={[
              { value: "gainers", label: "Gainers" },
              { value: "losers", label: "Losers" },
              { value: "turnover", label: "Turnover" },
              { value: "volume", label: "Volume" },
            ]}
          />
          {quotesState.loading ? (
            <Spinner />
          ) : movers.length === 0 ? (
            <EmptyState title="Nothing to rank" />
          ) : (
            <table className="table table-fixed">
              <tbody>
                {movers.map((quote, index) => (
                  <ClickableRow
                    key={quote.symbol}
                    onClick={() => onOpenSymbol(quote.symbol)}
                  >
                    <td className="rank">{index + 1}</td>
                    <td className="grow">
                      <strong>{quote.symbol}</strong>
                      <span className="cell-sub">
                        {companyBySymbol.get(quote.symbol)?.name ?? ""}
                      </span>
                    </td>
                    <td className="right nowrap">
                      {moverTab === "turnover"
                        ? `Rs ${formatCompact(quote.turnover)}`
                        : moverTab === "volume"
                          ? formatCompact(quote.volume)
                          : formatNumber(quote.ltp)}
                    </td>
                    <td className="right">
                      <Delta value={quote.changePercent} pill />
                    </td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card
        title="Sector heatmap"
        subtitle="Equal-weighted mean daily change of stored members · click a tile to filter the table"
        action={
          <div className="card-actions">
            <Badge tone="info">derived</Badge>
            {sectorFilter && (
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => setSectorFilter(null)}
              >
                Clear filter
              </button>
            )}
          </div>
        }
        footer={
          <>
            Not an official sector sub-index: those need capitalisation weights
            this source does not publish. Each tile is the plain average of the
            members’ end-of-day change, with advancers/decliners counted.
            “Unclassified” is shown as-is rather than guessed.
          </>
        }
      >
        {sectors.length === 0 ? (
          <EmptyState title="No closes to aggregate" />
        ) : (
          <div className="heatmap">
            {sectors.map((sector) => {
              const style = heatStyle(sector.meanChangePercent, 2.5);
              return (
                <button
                  key={sector.sector}
                  type="button"
                  className="heat-tile"
                  style={{ background: style.background }}
                  aria-pressed={sectorFilter === sector.sector}
                  onClick={() =>
                    setSectorFilter((current) =>
                      current === sector.sector ? null : sector.sector,
                    )
                  }
                >
                  <span className="heat-name" style={style.color ? { color: style.color } : undefined}>
                    {sector.sector}
                  </span>
                  <span className="heat-value" style={style.color ? { color: style.color } : undefined}>
                    {sector.meanChangePercent === null
                      ? "—"
                      : `${sector.meanChangePercent >= 0 ? "+" : ""}${sector.meanChangePercent.toFixed(2)}%`}
                  </span>
                  <span className="heat-meta" style={style.color ? { color: style.color, opacity: 0.85 } : undefined}>
                    ▲{sector.advancers} ▼{sector.decliners} · {sector.total} members
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {sectorsPublished.length > 0 && (
          <p className="muted small" style={{ marginTop: 10 }}>
            A source-supplied sector-performance file is also imported (
            {sectorsPublished.length} sectors).
          </p>
        )}
      </Card>

      <Card
        title="Candlestick signals on the last session"
        subtitle={
          screenerState.loading
            ? "Scanning stored candles…"
            : `Active equities · ${todaysPatterns.filter((item) => item.pattern.bias === "bullish").length} bullish and ${todaysPatterns.filter((item) => item.pattern.bias === "bearish").length} bearish patterns completed on ${latestSession ?? "the latest session"}`
        }
        action={<Badge tone="info">derived</Badge>}
        footer={
          <>
            Patterns are detected geometrically from each session’s open, high,
            low and close plus the prior six-session trend. They describe the
            past; they are not forecasts or advice. Thinly traded scrips with no
            daily range never match.
          </>
        }
      >
        {screenerState.loading ? (
          <Spinner label="Scanning stored candles" />
        ) : todaysPatterns.length === 0 ? (
          <EmptyState title="No directional patterns on the last session" />
        ) : (
          <div className="table-scroll short">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Pattern</th>
                  <th className="right">Close</th>
                  <th className="right">RSI 14</th>
                  <th>Trend</th>
                  <th>Signal tally</th>
                </tr>
              </thead>
              <tbody>
                {todaysPatterns.map(({ row, pattern }) => (
                  <ClickableRow
                    key={`${row.symbol}-${pattern.id}`}
                    onClick={() => onOpenSymbol(row.symbol)}
                  >
                    <td>
                      <strong>{row.symbol}</strong>
                      <span className="cell-sub">
                        {companyBySymbol.get(row.symbol)?.name ?? ""}
                      </span>
                    </td>
                    <td>
                      <Badge tone={pattern.bias === "bullish" ? "good" : "bad"}>
                        {pattern.bias === "bullish" ? "▲" : "▼"} {pattern.name}
                      </Badge>
                    </td>
                    <td className="right">{formatNumber(row.lastClose)}</td>
                    <td className="right">{formatNumber(row.rsi14)}</td>
                    <td className="muted">{row.trend ?? "—"}</td>
                    <td>
                      <RatingBadge rating={row.signalRating} />
                    </td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Market"
        subtitle={`${sorted.length} of ${sessionQuotes.length} closes${
          sectorFilter ? ` · ${sectorFilter}` : ""
        }`}
        action={
          <div className="card-actions">
            <input
              type="search"
              placeholder="Filter symbol or name"
              aria-label="Filter market table"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {quotesBadge}
          </div>
        }
      >
        {quotesState.loading ? (
          <Spinner />
        ) : sessionQuotes.length === 0 ? (
          <EmptyState title="No end-of-day prices in the store">
            Import <code>quotes.csv</code> to populate this table.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Symbol" sortKey="symbol" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <SortHeader label="Sector" sortKey="sector" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <SortHeader label="Close" sortKey="ltp" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="Change" sortKey="changePercent" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="Volume" sortKey="volume" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="Turnover" sortKey="turnover" sort={sort} onSort={toggle} align="right" />
                  <th>As of / state</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((quote) => {
                  const provenance = quoteProvenance[quote.symbol];
                  const company = companyBySymbol.get(quote.symbol);
                  return (
                    <ClickableRow
                      key={quote.symbol}
                      onClick={() => onOpenSymbol(quote.symbol)}
                    >
                      <td>
                        <div className="symbol-cell">
                          <Avatar symbol={quote.symbol} />
                          <div>
                            <strong>{quote.symbol}</strong>
                            <span className="cell-sub">{company?.name ?? ""}</span>
                          </div>
                        </div>
                      </td>
                      <td className="muted">
                        {company?.sector ?? "—"}
                        <span className="cell-sub">{company?.instrumentType ?? ""}</span>
                      </td>
                      <td className="right">{formatNumber(quote.ltp)}</td>
                      <td className="right">
                        <span className={`tone-${toneOf(quote.changePercent)}`}>
                          <Delta value={quote.changePercent} />
                        </span>
                      </td>
                      <td className="right">{formatCompact(quote.volume)}</td>
                      <td className="right">{formatCompact(quote.turnover)}</td>
                      <td>
                        <AsOf
                          value={provenance?.asOf ?? quote.asOf}
                          ageSeconds={provenance?.ageSeconds}
                        />{" "}
                        {provenance && (
                          <DataStateBadge
                            state={provenance.state}
                            classification={provenance.classification}
                            showClassification={false}
                          />
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

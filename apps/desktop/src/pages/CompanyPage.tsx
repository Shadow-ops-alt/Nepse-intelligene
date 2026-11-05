import { useMemo, useState } from "react";
import {
  logReturns,
  monthlyReturns,
  quantProfile,
  relativeRisk,
  type PatternHit,
} from "@stock/analytics";
import { api, formatCompact, formatNumber } from "../api";
import { useApi } from "../hooks";
import type {
  AnalysisResponse,
  Candle,
  CandlesResponse,
  CompaniesResponse,
} from "../types";
import {
  AsOf,
  Avatar,
  Badge,
  Card,
  DataStateBadge,
  Delta,
  EmptyState,
  MiniStats,
  Notice,
  RangeBar,
  RatingGauge,
  Spinner,
  Stat,
  Tabs,
  heatStyle,
} from "../components/ui";
import { PriceChart, type ChartMarker } from "../components/PriceChart";
import { Icon } from "../components/icons";

interface WatchlistResponse {
  symbols: string[];
}

type DetailTab = "performance" | "seasonality" | "patterns" | "distribution";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pct(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(digits)}%`;
}

export function CompanyPage({
  symbol,
  onOpenSymbol,
}: {
  symbol: string;
  onOpenSymbol: (symbol: string) => void;
}) {
  const candlesState = useApi<CandlesResponse>(
    `/api/candles?symbol=${encodeURIComponent(symbol)}`,
  );
  const analysisState = useApi<AnalysisResponse>(
    `/api/analysis?symbol=${encodeURIComponent(symbol)}`,
  );
  const indexState = useApi<CandlesResponse>("/api/candles?kind=index&symbol=NEPSE");
  const companiesState = useApi<CompaniesResponse>("/api/companies");
  const watchState = useApi<WatchlistResponse>("/api/watchlist");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<DetailTab>("performance");

  const candles = candlesState.data?.candles ?? [];
  const analysis = analysisState.data?.analysis ?? null;
  const companies = companiesState.data?.companies ?? [];
  const company = companies.find((item) => item.symbol === symbol);
  const inWatchlist = (watchState.data?.symbols ?? []).includes(symbol);
  const provenance = candlesState.data?.provenance ?? null;

  const profile = useMemo(
    () => (candles.length >= 2 ? quantProfile(candles) : null),
    [candles],
  );
  const risk = useMemo(
    () =>
      candles.length > 30 && (indexState.data?.candles.length ?? 0) > 30
        ? relativeRisk(candles, indexState.data!.candles)
        : null,
    [candles, indexState.data],
  );
  const markers = useMemo<ChartMarker[]>(
    () =>
      (profile?.patterns ?? [])
        .filter((hit) => hit.bias !== "neutral")
        .map((hit) => ({
          time: hit.timestamp.slice(0, 10),
          bias: hit.bias,
          label: hit.name,
        })),
    [profile],
  );

  const last = candles.at(-1) ?? null;
  const previous = candles.at(-2) ?? null;
  const dayChange =
    last && previous && previous.close > 0
      ? ((last.close - previous.close) / previous.close) * 100
      : null;
  const avgVolume20 =
    candles.length > 0
      ? candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) /
        Math.min(20, candles.length)
      : null;

  async function toggleWatchlist() {
    setBusy(true);
    try {
      await api<WatchlistResponse>("/api/watchlist", {
        method: "POST",
        body: JSON.stringify({
          symbol,
          action: inWatchlist ? "remove" : "add",
        }),
      });
      watchState.reload();
    } finally {
      setBusy(false);
    }
  }

  if (candlesState.loading) return <Spinner label={`Loading ${symbol}`} />;

  if (candlesState.error) {
    return (
      <EmptyState title={`Could not load ${symbol}`}>
        {candlesState.error}
      </EmptyState>
    );
  }

  const unadjusted = !candles.some((candle) => candle.adjusted);

  return (
    <div className="stack">
      <div className="page-heading">
        <div className="company-head">
          <Avatar symbol={symbol} large />
          <div>
            <div className="symbol-title">
              {symbol}
              {company && <span className="muted"> · {company.name}</span>}
            </div>
            <div className="row" style={{ marginTop: 4 }}>
              <Badge>{company?.sector ?? "Unknown sector"}</Badge>
              <Badge>{company?.instrumentType ?? "Unknown type"}</Badge>
              <Badge tone={company?.status === "active" ? "good" : "warn"}>
                {company?.status ?? "unknown status"}
              </Badge>
              {provenance && (
                <DataStateBadge
                  state={provenance.state}
                  classification={provenance.classification}
                />
              )}
              {candles.length > 0 && (
                <Badge tone={unadjusted ? "warn" : "good"}>
                  {unadjusted ? "unadjusted" : "adjusted"}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="row">
          {last && (
            <div style={{ textAlign: "right" }}>
              <div className="price-block" style={{ justifyContent: "flex-end" }}>
                <span className="price-big">{formatNumber(last.close)}</span>
                <Delta value={dayChange} pill />
              </div>
              <div className="muted small">
                close {last.timestamp.slice(0, 10)}
                {previous ? ` vs ${previous.timestamp.slice(0, 10)}` : ""} · end-of-day
              </div>
            </div>
          )}
          <button
            type="button"
            className={`icon-button ${inWatchlist ? "active" : ""}`}
            disabled={busy}
            onClick={() => void toggleWatchlist()}
            aria-pressed={inWatchlist}
            aria-label={inWatchlist ? "Remove from watchlist" : "Add to watchlist"}
            title={inWatchlist ? "Remove from watchlist" : "Add to watchlist"}
          >
            {inWatchlist ? <Icon.StarFilled /> : <Icon.Watchlist />}
          </button>
        </div>
      </div>

      {candles.length === 0 ? (
        <EmptyState title={`No price history stored for ${symbol}`}>
          Add <code>ohlc/{symbol}.csv</code> inside the app’s data folder, then
          use <strong>Data → Import</strong> to load it.
        </EmptyState>
      ) : (
        <>
          {provenance?.stale && (
            <Notice tone="warn">
              This series is older than its freshness window (last session{" "}
              {last?.timestamp.slice(0, 10)}). Treat the close as historical,
              not current — the scrip may be suspended, merged or illiquid.
            </Notice>
          )}

          <div className="stats-row">
            <Stat
              label="52-week range"
              value={<span className="num">{pct(profile?.position52w, 0)}</span>}
              hint="position of the close in the 52-week range"
            >
              <RangeBar
                low={analysis?.low52w}
                high={analysis?.high52w}
                value={last?.close}
              />
            </Stat>
            <Stat
              label="Volume"
              value={formatCompact(last?.volume)}
              hint={
                avgVolume20
                  ? `${((last?.volume ?? 0) / avgVolume20).toFixed(2)}× 20-session avg (${formatCompact(avgVolume20)})`
                  : undefined
              }
            />
            <Stat
              label="RSI 14"
              value={formatNumber(analysis?.rsi14)}
              tone={
                analysis?.rsi14 == null
                  ? undefined
                  : analysis.rsi14 > 70
                    ? "down"
                    : analysis.rsi14 < 30
                      ? "up"
                      : undefined
              }
              hint={
                analysis?.rsi14 == null
                  ? "needs 15 sessions"
                  : analysis.rsi14 > 70
                    ? "overbought zone (> 70)"
                    : analysis.rsi14 < 30
                      ? "oversold zone (< 30)"
                      : "neutral zone"
              }
            />
            <Stat
              label="Volatility 3M"
              value={pct(profile?.volatility3M)}
              hint={`annualised · ${profile?.sessionsPerYear ?? "—"} sessions/yr measured`}
            />
            <Stat
              label="Beta vs NEPSE"
              value={risk ? risk.beta.toFixed(2) : "—"}
              hint={
                risk
                  ? `correlation ${risk.correlation.toFixed(2)} · ${risk.observations} common sessions`
                  : "needs 30 common sessions"
              }
            />
          </div>

          <div className="grid main-side">
            <Card
              title="Price"
              subtitle={`${candles[0]?.timestamp.slice(0, 10)} → ${last?.timestamp.slice(0, 10)} · ${candles.length.toLocaleString()} sessions`}
              footer={
                <div className="row" style={{ gap: 14 }}>
                  <AsOf value={provenance?.asOf} ageSeconds={provenance?.ageSeconds} />
                  {provenance && (
                    <span>
                      source {provenance.sourceType} · terms {provenance.termsStatus} ·
                      fetched {provenance.fetchedAt.slice(0, 16).replace("T", " ")}
                    </span>
                  )}
                  {unadjusted && (
                    <span>
                      Prices are unadjusted for bonus/rights; long-window indicators
                      can show artificial drops.
                    </span>
                  )}
                </div>
              }
            >
              <PriceChart
                candles={candles}
                size="tall"
                defaultRange="1Y"
                defaultOverlays={["sma20", "sma50", "sma200"]}
                defaultStudies={["volume", "rsi"]}
                markers={markers}
              />
            </Card>

            <div className="stack">
              <Card
                title="Signal tally"
                subtitle="Standard technical conditions, counted"
                action={<Badge tone="info">derived</Badge>}
                footer="A transparent count of rules on past prices — not a forecast or recommendation."
              >
                {profile?.signals ? (
                  <div className="stack-sm">
                    <RatingGauge
                      rating={profile.signals.rating}
                      score={profile.signals.score}
                    />
                    <div className="signal-list">
                      {profile.signals.checks.map((check) => (
                        <div className="signal-row" key={check.id}>
                          <div>
                            <span>{check.label}</span>
                            <span className="signal-detail">{check.detail}</span>
                          </div>
                          <Badge
                            tone={
                              check.vote === "bullish"
                                ? "good"
                                : check.vote === "bearish"
                                  ? "bad"
                                  : "neutral"
                            }
                          >
                            {check.vote}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState title="Needs at least 30 sessions" />
                )}
              </Card>

              <Card
                title="Pivot levels"
                subtitle={`Classic pivots from ${last?.timestamp.slice(0, 10)} H/L/C`}
                action={<Badge tone="info">derived</Badge>}
              >
                {profile?.pivots && last ? (
                  <PivotLadder close={last.close} pivots={profile.pivots} />
                ) : (
                  <EmptyState title="Unavailable" />
                )}
              </Card>
            </div>
          </div>

          <Card>
            <Tabs<DetailTab>
              label="Company analytics"
              value={tab}
              onChange={setTab}
              items={[
                { value: "performance", label: "Performance & risk" },
                { value: "seasonality", label: "Seasonality" },
                {
                  value: "patterns",
                  label: "Candlestick patterns",
                  count: profile?.patterns.length ?? 0,
                },
                { value: "distribution", label: "Return distribution" },
              ]}
            />
            {profile && tab === "performance" && (
              <PerformancePanel profile={profile} analysis={analysis} risk={risk} />
            )}
            {tab === "seasonality" && <SeasonalityPanel candles={candles} />}
            {profile && tab === "patterns" && (
              <PatternPanel candles={candles} hits={profile.patterns} />
            )}
            {tab === "distribution" && (
              <DistributionPanel candles={candles} sessionsPerYear={profile?.sessionsPerYear ?? 240} />
            )}
          </Card>

          {companies.length > 0 && company && (
            <PeerStrip
              sector={company.sector}
              symbol={symbol}
              peers={companies
                .filter(
                  (peer) =>
                    peer.sector === company.sector &&
                    peer.symbol !== symbol &&
                    peer.status === "active" &&
                    peer.instrumentType === company.instrumentType,
                )
                .slice(0, 24)
                .map((peer) => peer.symbol)}
              onOpenSymbol={onOpenSymbol}
            />
          )}
        </>
      )}
    </div>
  );
}

function PivotLadder({
  close,
  pivots,
}: {
  close: number;
  pivots: NonNullable<ReturnType<typeof quantProfile>["pivots"]>;
}) {
  const rows: Array<{ name: string; value: number; kind: "r" | "p" | "s" }> = [
    { name: "R3", value: pivots.r3, kind: "r" },
    { name: "R2", value: pivots.r2, kind: "r" },
    { name: "R1", value: pivots.r1, kind: "r" },
    { name: "P", value: pivots.pivot, kind: "p" },
    { name: "S1", value: pivots.s1, kind: "s" },
    { name: "S2", value: pivots.s2, kind: "s" },
    { name: "S3", value: pivots.s3, kind: "s" },
  ];
  return (
    <div className="levels">
      {rows.map((row) => {
        const distance = ((row.value - close) / close) * 100;
        return [
          <span className="lvl-name" key={`${row.name}-n`}>
            {row.name}
          </span>,
          <span key={`${row.name}-b`} className={`lvl-bar ${row.kind}`} />,
          <span key={`${row.name}-v`} className="right">
            {formatNumber(row.value)}{" "}
            <span className="subtle tiny">
              ({distance >= 0 ? "+" : ""}
              {distance.toFixed(1)}%)
            </span>
          </span>,
        ];
      })}
    </div>
  );
}

function PerformancePanel({
  profile,
  analysis,
  risk,
}: {
  profile: ReturnType<typeof quantProfile>;
  analysis: AnalysisResponse["analysis"];
  risk: ReturnType<typeof relativeRisk>;
}) {
  return (
    <div className="stack">
      <div>
        <h4 className="muted small" style={{ marginBottom: 8 }}>
          Point-to-point returns (calendar windows; blank when history is too short)
        </h4>
        <MiniStats
          items={(["1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y"] as const).map(
            (key) => ({ label: key, value: <Delta value={profile.returns[key]} /> }),
          )}
        />
      </div>
      <div>
        <h4 className="muted small" style={{ marginBottom: 8 }}>
          Risk
        </h4>
        <MiniStats
          items={[
            { label: "Vol 1M", value: pct(profile.volatility1M), hint: "annualised" },
            { label: "Vol 3M", value: pct(profile.volatility3M), hint: "annualised" },
            { label: "Vol 1Y", value: pct(profile.volatility1Y), hint: "annualised" },
            { label: "Max DD 1Y", value: pct(profile.maxDrawdown1Y), tone: "down" },
            {
              label: "Max DD all",
              value: pct(profile.maxDrawdownAll),
              tone: "down",
              hint: "unadjusted prices",
            },
            {
              label: "From peak",
              value: pct(profile.currentDrawdown),
              hint: "all-time, unadjusted",
            },
            { label: "ATR 14", value: formatNumber(profile.atr14), hint: pct(profile.atrPercent) + " of close" },
            {
              label: "Beta / corr",
              value: risk ? `${risk.beta.toFixed(2)} / ${risk.correlation.toFixed(2)}` : "—",
              hint: "vs NEPSE, daily",
            },
          ]}
        />
      </div>
      <div>
        <h4 className="muted small" style={{ marginBottom: 8 }}>
          Trend and oscillators
        </h4>
        <MiniStats
          items={[
            { label: "SMA 20", value: formatNumber(analysis?.sma20) },
            { label: "SMA 50", value: formatNumber(analysis?.sma50) },
            { label: "SMA 200", value: formatNumber(analysis?.sma200) },
            { label: "EMA 20", value: formatNumber(analysis?.ema20) },
            {
              label: "MACD",
              value: formatNumber(profile.macd, 3),
              hint: `signal ${formatNumber(profile.macdSignal, 3)}`,
              tone: (profile.macdHistogram ?? 0) >= 0 ? "up" : "down",
            },
            {
              label: "Stoch %K/%D",
              value: `${formatNumber(profile.stochasticK, 0)} / ${formatNumber(profile.stochasticD, 0)}`,
            },
            {
              label: "Bollinger %B",
              value: pct(profile.bollingerPercentB, 0),
              hint: `${formatNumber(profile.bollingerLower)} – ${formatNumber(profile.bollingerUpper)}`,
            },
            {
              label: "50/200 cross",
              value: profile.cross
                ? profile.cross.type === "golden"
                  ? "Golden"
                  : "Death"
                : "None",
              hint: profile.cross
                ? `${profile.cross.sessionsAgo} sessions ago`
                : "in the last 20 sessions",
              tone: profile.cross
                ? profile.cross.type === "golden"
                  ? "up"
                  : "down"
                : undefined,
            },
          ]}
        />
      </div>
      <p className="muted small">
        Volatility is the sample standard deviation of daily log returns ×
        √(sessions per year), with sessions per year measured from this series
        rather than assumed. Drawdown is the decline from the running peak close.
        Beta and correlation use only dates present in both this series and the
        NEPSE index; nothing is interpolated.
      </p>
    </div>
  );
}

function SeasonalityPanel({ candles }: { candles: Candle[] }) {
  const months = useMemo(() => monthlyReturns(candles), [candles]);
  const years = useMemo(() => {
    const byYear = new Map<number, Map<number, number | null>>();
    for (const entry of months) {
      const map = byYear.get(entry.year) ?? new Map<number, number | null>();
      map.set(entry.month, entry.returnPercent);
      byYear.set(entry.year, map);
    }
    return [...byYear.entries()].sort((a, b) => b[0] - a[0]).slice(0, 12);
  }, [months]);

  const monthStats = useMemo(
    () =>
      MONTHS.map((_, index) => {
        const values = months
          .filter((entry) => entry.month === index + 1 && entry.returnPercent !== null)
          .map((entry) => entry.returnPercent!);
        if (values.length === 0) return { mean: null, hit: null, n: 0 };
        return {
          mean: values.reduce((s, v) => s + v, 0) / values.length,
          hit: (values.filter((v) => v > 0).length / values.length) * 100,
          n: values.length,
        };
      }),
    [months],
  );

  if (years.length === 0) return <EmptyState title="Not enough monthly history" />;

  return (
    <div className="stack">
      <div className="scroll-x">
        <div className="month-grid">
          <span className="mg-head" />
          {MONTHS.map((month) => (
            <span className="mg-head" key={month}>
              {month}
            </span>
          ))}
          <span className="mg-head">Year</span>
          {years.map(([year, map]) => {
            const values = [...map.values()].filter((v): v is number => v !== null);
            const compounded =
              values.length > 0
                ? (values.reduce((acc, v) => acc * (1 + v / 100), 1) - 1) * 100
                : null;
            return [
              <span className="mg-year" key={`${year}-y`}>
                {year}
              </span>,
              ...MONTHS.map((_, index) => {
                const value = map.get(index + 1);
                const style = heatStyle(value ?? null, 10);
                return (
                  <span
                    key={`${year}-${index}`}
                    className={`mg-cell ${value === undefined || value === null ? "mg-empty" : ""}`}
                    style={style}
                    title={
                      value === undefined
                        ? "no session stored"
                        : value === null
                          ? "previous month missing; not bridged"
                          : `${value.toFixed(2)}%`
                    }
                  >
                    {value === undefined || value === null ? "·" : value.toFixed(1)}
                  </span>
                );
              }),
              <span
                key={`${year}-t`}
                className="mg-cell mg-total"
                style={heatStyle(compounded, 30)}
              >
                {compounded === null ? "·" : compounded.toFixed(1)}
              </span>,
            ];
          })}
          <span className="mg-year">Avg</span>
          {monthStats.map((stat, index) => (
            <span
              key={`avg-${index}`}
              className="mg-cell mg-total"
              style={heatStyle(stat.mean, 5)}
              title={`${stat.n} months`}
            >
              {stat.mean === null ? "·" : stat.mean.toFixed(1)}
            </span>
          ))}
          <span className="mg-cell mg-empty" />
          <span className="mg-year">Up %</span>
          {monthStats.map((stat, index) => (
            <span key={`hit-${index}`} className="mg-cell">
              {stat.hit === null ? "·" : stat.hit.toFixed(0)}
            </span>
          ))}
          <span className="mg-cell mg-empty" />
        </div>
      </div>
      <p className="muted small">
        Month-end close vs previous month-end close (percent). A month whose
        previous month has no stored session is left blank instead of bridged.
        “Avg” and “Up %” use every stored year, not just the rows shown.
        Prices are unadjusted, so bonus/rights months can show artificial drops.
      </p>
    </div>
  );
}

function PatternPanel({ candles, hits }: { candles: Candle[]; hits: PatternHit[] }) {
  const sorted = useMemo(
    () => [...candles].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [candles],
  );
  const rows = useMemo(
    () =>
      [...hits].reverse().map((hit) => {
        const base = sorted[hit.index]?.close ?? null;
        const ahead = sorted[hit.index + 5]?.close ?? null;
        return {
          hit,
          close: base,
          forward5:
            base !== null && ahead !== null && base > 0
              ? ((ahead - base) / base) * 100
              : null,
        };
      }),
    [hits, sorted],
  );
  const summary = useMemo(() => {
    const byBias = (bias: string) => rows.filter((row) => row.hit.bias === bias);
    const avg = (list: typeof rows) => {
      const values = list.map((r) => r.forward5).filter((v): v is number => v !== null);
      return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
    };
    return {
      bullish: byBias("bullish").length,
      bearish: byBias("bearish").length,
      neutral: byBias("neutral").length,
      bullishAvg: avg(byBias("bullish")),
      bearishAvg: avg(byBias("bearish")),
    };
  }, [rows]);

  if (rows.length === 0) {
    return <EmptyState title="No patterns detected in the last 120 sessions" />;
  }

  return (
    <div className="stack">
      <MiniStats
        items={[
          { label: "Bullish", value: summary.bullish, tone: "up" },
          { label: "Bearish", value: summary.bearish, tone: "down" },
          { label: "Neutral", value: summary.neutral },
          {
            label: "Avg +5 after bull",
            value: <Delta value={summary.bullishAvg} />,
            hint: "this series only",
          },
          {
            label: "Avg +5 after bear",
            value: <Delta value={summary.bearishAvg} />,
            hint: "this series only",
          },
        ]}
      />
      <div className="table-scroll short">
        <table className="table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Pattern</th>
              <th>Bias</th>
              <th className="right">Span</th>
              <th className="right">Close</th>
              <th className="right">Next 5 sessions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ hit, close, forward5 }) => (
              <tr key={`${hit.index}-${hit.id}`}>
                <td className="muted">{hit.timestamp.slice(0, 10)}</td>
                <td>
                  <strong>{hit.name}</strong>
                </td>
                <td>
                  <Badge
                    tone={
                      hit.bias === "bullish" ? "good" : hit.bias === "bearish" ? "bad" : "neutral"
                    }
                  >
                    {hit.bias}
                  </Badge>
                </td>
                <td className="right muted">{hit.span}</td>
                <td className="right">{formatNumber(close)}</td>
                <td className="right">
                  {forward5 === null ? (
                    <span className="subtle">pending</span>
                  ) : (
                    <Delta value={forward5} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        “Next 5 sessions” is what actually happened after each pattern in this
        series — a small, descriptive sample, not evidence that the pattern
        predicts anything.
      </p>
    </div>
  );
}

function DistributionPanel({
  candles,
  sessionsPerYear,
}: {
  candles: Candle[];
  sessionsPerYear: number;
}) {
  const stats = useMemo(() => {
    const closes = [...candles]
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((c) => c.close)
      .slice(-(sessionsPerYear + 1));
    const returns = logReturns(closes).map((r) => r * 100);
    if (returns.length < 20) return null;
    const n = returns.length;
    const mean = returns.reduce((s, v) => s + v, 0) / n;
    const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
    const sd = Math.sqrt(variance);
    const skew =
      sd > 0 ? returns.reduce((s, v) => s + ((v - mean) / sd) ** 3, 0) / n : 0;
    const kurt =
      sd > 0 ? returns.reduce((s, v) => s + ((v - mean) / sd) ** 4, 0) / n - 3 : 0;
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const var95 = sortedReturns[Math.floor(0.05 * n)] ?? null;
    const bins = 31;
    const bound = Math.max(Math.abs(sortedReturns[0]!), Math.abs(sortedReturns.at(-1)!), 0.5);
    const width = (2 * bound) / bins;
    const counts = new Array<number>(bins).fill(0);
    for (const value of returns) {
      const index = Math.min(bins - 1, Math.max(0, Math.floor((value + bound) / width)));
      counts[index] = (counts[index] ?? 0) + 1;
    }
    return {
      n,
      mean,
      sd,
      skew,
      kurt,
      var95,
      best: sortedReturns.at(-1)!,
      worst: sortedReturns[0]!,
      upDays: (returns.filter((r) => r > 0).length / n) * 100,
      flatDays: (returns.filter((r) => r === 0).length / n) * 100,
      counts,
      bound,
      width,
    };
  }, [candles, sessionsPerYear]);

  if (!stats) return <EmptyState title="Needs at least 20 daily returns" />;
  const max = Math.max(...stats.counts, 1);

  return (
    <div className="stack">
      <div className="histogram" role="img" aria-label="Histogram of daily returns over the last year">
        {stats.counts.map((count, index) => {
          const centre = -stats.bound + (index + 0.5) * stats.width;
          return (
            <span
              key={index}
              className={centre < -stats.width / 2 ? "neg" : centre > stats.width / 2 ? "pos" : ""}
              style={{ height: `${(count / max) * 100}%` }}
              title={`${centre.toFixed(2)}%: ${count} days`}
            />
          );
        })}
      </div>
      <div className="range-labels">
        <span>−{stats.bound.toFixed(1)}%</span>
        <span>0</span>
        <span>+{stats.bound.toFixed(1)}%</span>
      </div>
      <MiniStats
        items={[
          { label: "Sessions", value: stats.n, hint: "last ~1 year" },
          { label: "Mean / day", value: pct(stats.mean, 3) },
          { label: "Std dev / day", value: pct(stats.sd, 2) },
          { label: "Skew", value: stats.skew.toFixed(2) },
          { label: "Excess kurtosis", value: stats.kurt.toFixed(2) },
          { label: "Hist. VaR 95%", value: pct(stats.var95), tone: "down", hint: "5th percentile day" },
          { label: "Best day", value: pct(stats.best), tone: "up" },
          { label: "Worst day", value: pct(stats.worst), tone: "down" },
          { label: "Up days", value: pct(stats.upDays, 0), hint: `${stats.flatDays.toFixed(0)}% flat` },
        ]}
      />
      <p className="muted small">
        Daily log returns over the trailing year. NEPSE’s daily price band
        truncates extreme moves, and illiquid scrips show many flat days, so
        tails and kurtosis should be read with that in mind.
      </p>
    </div>
  );
}

function PeerStrip({
  sector,
  symbol,
  peers,
  onOpenSymbol,
}: {
  sector: string;
  symbol: string;
  peers: string[];
  onOpenSymbol: (symbol: string) => void;
}) {
  if (peers.length === 0 || sector === "Unclassified") return null;
  return (
    <Card title={`${sector} peers`} subtitle={`Other active instruments in the same sector as ${symbol}`}>
      <div className="chips">
        {peers.map((peer) => (
          <button
            key={peer}
            type="button"
            className="toggle-chip"
            onClick={() => onOpenSymbol(peer)}
          >
            {peer}
          </button>
        ))}
      </div>
    </Card>
  );
}

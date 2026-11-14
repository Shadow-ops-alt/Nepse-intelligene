import { useMemo, useState } from "react";
import type { SignalType } from "@stock/analytics";
import { breadth } from "@stock/analytics";
import { formatNumber } from "../api";
import { useApi } from "../hooks";
import type { IndicesResponse, QuotesResponse, ScreenerResponse } from "../types";
import {
  Badge,
  BreadthBar,
  Card,
  ClickableRow,
  Delta,
  EmptyState,

  Notice,
  Spinner,
  Tabs,
  downloadCsv,
} from "../components/ui";
import {
  SCOPE_LABEL,
  SIGNAL_TYPE_LABEL,
  DEFAULT_RULES,
  notificationsEnabled,
  setNotificationsEnabled,
  type AlertRule,
  type AlertScope,
  type AlertsState,
  type SignalRow,
} from "../alerts";
import { describeAge, nptDate, sessionAgeDays } from "../lib";

type Tab = "brief" | "inbox" | "feed" | "rsi" | "rules";

interface BriefItem {
  tone: "good" | "bad" | "info" | "warn";
  title: string;
  detail?: string;
  symbols?: string[];
}

/**
 * The "assistant" is deterministic: it ranks what changed in the stored data
 * so the user reads one page instead of scanning every chart. Every line comes
 * from a rule over end-of-day signals; nothing is predicted.
 */
function buildBrief(input: {
  latestSession: string | null;
  events: SignalRow[];
  watchlist: ReadonlySet<string>;
  holdings: ReadonlySet<string>;
  indexChange: number | null;
  indexValue: number | null;
  breadthUp: number;
  breadthDown: number;
}): BriefItem[] {
  const items: BriefItem[] = [];
  const today = input.events.filter((e) => e.timestamp.slice(0, 10) === input.latestSession);
  const ageDays = sessionAgeDays(input.latestSession ? `${input.latestSession}T09:15:00Z` : null);

  if (ageDays !== null && ageDays > 4) {
    items.push({
      tone: "warn",
      title: `Data is ${describeAge(ageDays)} — signals below are from ${input.latestSession}.`,
      detail: "Run the update command on the Data page to refresh.",
    });
  }

  if (input.indexValue !== null) {
    const direction =
      input.indexChange === null ? "" : input.indexChange >= 0 ? "rose" : "fell";
    items.push({
      tone: (input.indexChange ?? 0) >= 0 ? "good" : "bad",
      title: `NEPSE ${direction} ${input.indexChange !== null ? `${Math.abs(input.indexChange).toFixed(2)}%` : ""} to ${formatNumber(input.indexValue)} on ${input.latestSession ?? "the last session"}.`,
      detail: `${input.breadthUp} advanced, ${input.breadthDown} declined${
        input.breadthUp + input.breadthDown > 0
          ? ` — breadth ${input.breadthUp >= input.breadthDown ? "positive" : "negative"}`
          : ""
      }.`,
    });
  }

  const bullish = today.filter((e) => e.direction === "bullish");
  const bearish = today.filter((e) => e.direction === "bearish");
  items.push({
    tone: bullish.length >= bearish.length ? "good" : "bad",
    title: `${bullish.length} bullish and ${bearish.length} bearish technical signals fired on the last session.`,
    detail: "Counted across all stored equities (RSI, MACD, EMA, Supertrend, SAR, breakouts, structure).",
  });

  const bySymbol = new Map<string, SignalRow[]>();
  for (const event of today) {
    const list = bySymbol.get(event.symbol) ?? [];
    list.push(event);
    bySymbol.set(event.symbol, list);
  }

  const holdingsHit = [...bySymbol.entries()].filter(([symbol]) => input.holdings.has(symbol));
  for (const [symbol, events] of holdingsHit) {
    const negative = events.filter((e) => e.direction === "bearish");
    items.push({
      tone: negative.length > 0 ? "bad" : "good",
      title: `Your holding ${symbol}: ${events.map((e) => e.label).join("; ")}.`,
      symbols: [symbol],
    });
  }
  const watchHit = [...bySymbol.entries()].filter(
    ([symbol]) => input.watchlist.has(symbol) && !input.holdings.has(symbol),
  );
  if (watchHit.length > 0) {
    items.push({
      tone: "info",
      title: `${watchHit.length} watchlist symbol${watchHit.length === 1 ? "" : "s"} triggered signals.`,
      detail: watchHit.map(([symbol, events]) => `${symbol} (${events.map((e) => e.label).join(", ")})`).join(" · "),
      symbols: watchHit.map(([symbol]) => symbol),
    });
  }

  const confluence = [...bySymbol.entries()]
    .map(([symbol, events]) => ({
      symbol,
      bull: events.filter((e) => e.direction === "bullish"),
      bear: events.filter((e) => e.direction === "bearish"),
    }))
    .filter((item) => item.bull.length >= 2 && item.bear.length === 0)
    .sort((a, b) => b.bull.length - a.bull.length)
    .slice(0, 10);
  if (confluence.length > 0) {
    items.push({
      tone: "good",
      title: `${confluence.length} stock${confluence.length === 1 ? " has" : "s have"} two or more bullish signals agreeing on the same session.`,
      detail: confluence.map((c) => `${c.symbol}: ${c.bull.map((e) => e.label).join(" + ")}`).join(" · "),
      symbols: confluence.map((c) => c.symbol),
    });
  }

  const rsi30 = today.filter((e) => e.type === "rsi-cross-30" && e.direction === "bullish");
  const rsi50 = today.filter((e) => e.type === "rsi-cross-50" && e.direction === "bullish");
  if (rsi30.length + rsi50.length > 0) {
    items.push({
      tone: "info",
      title: `RSI recovery: ${rsi30.length} crossed above 30, ${rsi50.length} crossed above 50.`,
      detail: [...rsi30, ...rsi50].map((e) => `${e.symbol} (${e.type === "rsi-cross-30" ? "30" : "50"})`).join(" · "),
      symbols: [...new Set([...rsi30, ...rsi50].map((e) => e.symbol))],
    });
  }

  const breakouts = today.filter((e) => e.type === "volume-breakout" || e.type === "price-breakout");
  if (breakouts.length > 0) {
    items.push({
      tone: "good",
      title: `${new Set(breakouts.map((e) => e.symbol)).size} breakout${breakouts.length === 1 ? "" : "s"} on volume or above the 20-session high.`,
      detail: breakouts.slice(0, 12).map((e) => `${e.symbol}: ${e.detail}`).join(" · "),
      symbols: [...new Set(breakouts.map((e) => e.symbol))],
    });
  }

  const lows = today.filter((e) => e.type === "new-52w-low");
  const highs = today.filter((e) => e.type === "new-52w-high");
  if (highs.length + lows.length > 0) {
    items.push({
      tone: highs.length >= lows.length ? "good" : "bad",
      title: `${highs.length} new 52-week highs, ${lows.length} new 52-week lows.`,
      symbols: [...highs, ...lows].map((e) => e.symbol),
    });
  }

  return items;
}

export function AlertsPage({
  alerts,
  onOpenSymbol,
}: {
  alerts: AlertsState;
  onOpenSymbol: (symbol: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("brief");
  const indicesState = useApi<IndicesResponse>("/api/indices");
  const quotesState = useApi<QuotesResponse>("/api/quotes");
  const screenerState = useApi<ScreenerResponse>(tab === "rsi" ? "/api/screener" : null);
  const [typeFilter, setTypeFilter] = useState<SignalType | "all">("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "bullish" | "bearish">("all");
  const [notify, setNotify] = useState(() => notificationsEnabled());

  const events = useMemo<SignalRow[]>(
    () => (alerts.signals?.events ?? []) as SignalRow[],
    [alerts.signals],
  );
  const latestSession = alerts.signals?.latestSession ?? null;

  const nepse = indicesState.data?.indices.find((index) => !index.isSector) ?? null;
  const sessionQuotes = useMemo(() => {
    const quotes = quotesState.data?.quotes ?? [];
    return quotes.filter((quote) => nptDate(quote.asOf) === latestSession);
  }, [quotesState.data, latestSession]);
  const marketBreadth = useMemo(() => breadth(sessionQuotes), [sessionQuotes]);

  const brief = useMemo(
    () =>
      buildBrief({
        latestSession,
        events,
        watchlist: alerts.context.watchlist,
        holdings: alerts.context.holdings,
        indexChange: nepse?.changePercent ?? null,
        indexValue: nepse?.value ?? null,
        breadthUp: marketBreadth.advancers,
        breadthDown: marketBreadth.decliners,
      }),
    [latestSession, events, alerts.context, nepse, marketBreadth],
  );

  const feed = useMemo(
    () =>
      events.filter(
        (event) =>
          (typeFilter === "all" || event.type === typeFilter) &&
          (directionFilter === "all" || event.direction === directionFilter) &&
          (alerts.context.active.size === 0 || alerts.context.active.has(event.symbol)),
      ),
    [events, typeFilter, directionFilter, alerts.context.active],
  );

  const rsiZone = useMemo(() => {
    const rows = screenerState.data?.rows ?? [];
    return rows
      .filter(
        (row) =>
          row.rsi14 !== null &&
          row.rsi14 >= 30 &&
          row.rsi14 <= 50 &&
          !row.provenance.stale &&
          (alerts.context.active.size === 0 || alerts.context.active.has(row.symbol)),
      )
      .map((row) => {
        const crossed = events.filter(
          (event) =>
            event.symbol === row.symbol &&
            event.type === "rsi-cross-30" &&
            event.direction === "bullish",
        );
        return { row, crossed: crossed.at(-1) ?? null };
      })
      .sort((a, b) => Number(Boolean(b.crossed)) - Number(Boolean(a.crossed)) || (a.row.rsi14 ?? 0) - (b.row.rsi14 ?? 0));
  }, [screenerState.data, events, alerts.context.active]);

  const unreadKeys = alerts.triggered.filter((a) => !alerts.read.has(a.key)).map((a) => a.key);

  if (alerts.loading && !alerts.signals) {
    return <Spinner label="Computing signals over every stored series (first run takes a few seconds)" />;
  }

  if (alerts.error && !alerts.signals) {
    return (
      <EmptyState title="Signals unavailable">
        {alerts.error}
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <div className="stats-row">
        <div className="stat">
          <span className="stat-label">Last session</span>
          <span className="stat-value">{latestSession ?? "—"}</span>
          <span className="stat-hint">
            {describeAge(sessionAgeDays(latestSession ? `${latestSession}T09:15:00Z` : null))} ·
            end-of-day signals
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Your alerts</span>
          <span className="stat-value">{alerts.triggered.length}</span>
          <span className="stat-hint">{alerts.unread} unread</span>
        </div>
        <div className="stat">
          <span className="stat-label">Signals (5 sessions)</span>
          <span className="stat-value">{events.length}</span>
          <span className="stat-hint">
            <span className="tone-up">{events.filter((e) => e.direction === "bullish").length} bullish</span> ·{" "}
            <span className="tone-down">{events.filter((e) => e.direction === "bearish").length} bearish</span>
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Breadth</span>
          <span className="stat-value">
            <span className="tone-up">{marketBreadth.advancers}</span>
            <span className="subtle"> / </span>
            <span className="tone-down">{marketBreadth.decliners}</span>
          </span>
          <div className="stat-spark">
            <BreadthBar
              advancers={marketBreadth.advancers}
              unchanged={marketBreadth.unchanged}
              decliners={marketBreadth.decliners}
            />
          </div>
        </div>
      </div>

      <Card>
        <Tabs<Tab>
          label="Signals and alerts"
          value={tab}
          onChange={setTab}
          items={[
            { value: "brief", label: "Smart brief" },
            { value: "inbox", label: "My alerts", count: alerts.unread },
            { value: "feed", label: "Signal feed", count: events.length },
            { value: "rsi", label: "RSI 30–50 zone" },
            { value: "rules", label: "Alert rules", count: alerts.rules.filter((r) => r.enabled).length },
          ]}
        />

        {tab === "brief" && (
          <div className="stack-sm">
            <Notice tone="info">
              The brief is assembled by fixed rules from the stored end-of-day
              signals, your watchlist and your portfolio. It summarises what
              happened; it does not predict prices or give advice.
            </Notice>
            {brief.map((item, index) => (
              <div key={index} className="pattern-item" style={{ alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <Badge tone={item.tone}>
                    {item.tone === "good" ? "▲" : item.tone === "bad" ? "▼" : item.tone === "warn" ? "!" : "●"}
                  </Badge>
                  <div>
                    <strong>{item.title}</strong>
                    {item.detail && (
                      <div className="muted small brief-detail" title={item.detail} style={{ marginTop: 3 }}>
                        {item.detail}
                      </div>
                    )}
                    {item.symbols && item.symbols.length > 0 && (
                      <div className="row" style={{ marginTop: 6, gap: 6 }}>
                        {item.symbols.slice(0, 16).map((symbol) => (
                          <button
                            key={symbol}
                            type="button"
                            className="toggle-chip"
                            onClick={() => onOpenSymbol(symbol)}
                          >
                            {symbol}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "inbox" && (
          <div className="stack-sm">
            <div className="row-between">
              <span className="muted small">
                Alerts that match your rules over the last 5 sessions. Desktop
                notifications fire once per new alert.
              </span>
              <div className="row">
                <label className="checkbox" style={{ paddingBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={notify}
                    onChange={(event) => {
                      setNotify(event.target.checked);
                      setNotificationsEnabled(event.target.checked);
                      if (event.target.checked && typeof Notification !== "undefined") {
                        void Notification.requestPermission();
                      }
                    }}
                  />
                  <span>Desktop notifications</span>
                </label>
                <button
                  type="button"
                  className="button button-ghost button-small"
                  disabled={unreadKeys.length === 0}
                  onClick={() => alerts.markRead(unreadKeys)}
                >
                  Mark all read
                </button>
                <button
                  type="button"
                  className="button button-ghost button-small"
                  onClick={() => void alerts.refresh()}
                >
                  Refresh
                </button>
              </div>
            </div>
            {alerts.triggered.length === 0 ? (
              <EmptyState title="No alerts match your rules yet">
                Add symbols to your watchlist or portfolio, or widen a rule's
                scope on the Alert rules tab.
              </EmptyState>
            ) : (
              <div className="table-scroll tall">
                <table className="table">
                  <thead>
                    <tr>
                      <th />
                      <th>Session</th>
                      <th>Alert</th>
                      <th>Detail</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.triggered.map((alert) => {
                      const unread = !alerts.read.has(alert.key);
                      return (
                        <ClickableRow
                          key={alert.key}
                          onClick={() => {
                            alerts.markRead([alert.key]);
                            onOpenSymbol(alert.symbol);
                          }}
                        >
                          <td style={{ width: 18 }}>
                            {unread && <span className="dot dot-eod" title="unread" />}
                          </td>
                          <td className="muted nowrap">{alert.session}</td>
                          <td>
                            <Badge tone={alert.direction === "bullish" ? "good" : alert.direction === "bearish" ? "bad" : "neutral"}>
                              {alert.direction === "bullish" ? "▲" : alert.direction === "bearish" ? "▼" : "●"}
                            </Badge>{" "}
                            <strong style={{ fontWeight: unread ? 700 : 500 }}>{alert.title}</strong>
                          </td>
                          <td className="muted small">{alert.detail}</td>
                          <td className="muted small nowrap">
                            {alert.source === "price-live" ? "live LTP (unofficial)" : alert.source === "price-eod" ? "EOD close" : "EOD signal"}
                          </td>
                        </ClickableRow>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "feed" && (
          <div className="stack-sm">
            <div className="filters">
              <label>
                <span>Signal</span>
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as SignalType | "all")}>
                  <option value="all">All signals</option>
                  {(Object.keys(SIGNAL_TYPE_LABEL) as SignalType[]).map((type) => (
                    <option key={type} value={type}>
                      {SIGNAL_TYPE_LABEL[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Direction</span>
                <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value as "all" | "bullish" | "bearish")}>
                  <option value="all">Both</option>
                  <option value="bullish">Bullish</option>
                  <option value="bearish">Bearish</option>
                </select>
              </label>
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => downloadCsv(`nepse-signals-${latestSession ?? "latest"}.csv`, feed.map((e) => ({ session: e.timestamp.slice(0, 10), symbol: e.symbol, type: e.type, direction: e.direction, label: e.label, detail: e.detail })))}
              >
                Export CSV
              </button>
            </div>
            {feed.length === 0 ? (
              <EmptyState title="No signals match" />
            ) : (
              <div className="table-scroll tall">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Symbol</th>
                      <th>Signal</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feed.slice(0, 600).map((event) => (
                      <ClickableRow key={`${event.symbol}|${event.id}`} onClick={() => onOpenSymbol(event.symbol)}>
                        <td className="muted nowrap">{event.timestamp.slice(0, 10)}</td>
                        <td>
                          <strong>{event.symbol}</strong>
                          {alerts.context.holdings.has(event.symbol) && <Badge tone="info">holding</Badge>}{" "}
                          {alerts.context.watchlist.has(event.symbol) && <Badge>watch</Badge>}
                        </td>
                        <td>
                          <Badge tone={event.direction === "bullish" ? "good" : event.direction === "bearish" ? "bad" : "neutral"}>
                            {event.direction === "bullish" ? "▲" : "▼"} {event.label}
                          </Badge>
                        </td>
                        <td className="muted small">{event.detail}</td>
                      </ClickableRow>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "rsi" && (
          <div className="stack-sm">
            <p className="muted small">
              Active equities whose RSI 14 sits between 30 and 50 on the last
              session — recovering from oversold but not yet above the
              midline. Stocks that crossed above 30 within the last 5 sessions
              are listed first. Enable the "RSI crosses above 30/50" rules to
              be notified when one of these crosses.
            </p>
            {screenerState.loading ? (
              <Spinner label="Reading RSI for every series" />
            ) : rsiZone.length === 0 ? (
              <EmptyState title="No stocks in the 30–50 RSI zone" />
            ) : (
              <div className="table-scroll tall">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th className="right">Close</th>
                      <th className="right">RSI 14</th>
                      <th className="right">Prev RSI</th>
                      <th>Crossed 30</th>
                      <th className="right">1M</th>
                      <th>Signal tally</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rsiZone.map(({ row, crossed }) => (
                      <ClickableRow key={row.symbol} onClick={() => onOpenSymbol(row.symbol)}>
                        <td><strong>{row.symbol}</strong></td>
                        <td className="right">{formatNumber(row.lastClose)}</td>
                        <td className="right">{formatNumber(row.rsi14)}</td>
                        <td className="right muted">{formatNumber((row as { rsiPrev?: number | null }).rsiPrev ?? null)}</td>
                        <td>{crossed ? <Badge tone="good">▲ {crossed.timestamp.slice(0, 10)}</Badge> : <span className="muted">—</span>}</td>
                        <td className="right"><Delta value={row.return1M} /></td>
                        <td className="muted">{row.signalRating ?? "—"}</td>
                      </ClickableRow>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "rules" && <RulesEditor rules={alerts.rules} onChange={alerts.setRules} />}
      </Card>

      <p className="muted small">
        Signals are computed locally from unofficial end-of-day candles and are
        research aids, not trading advice. Price alerts use the unofficial live
        LTP when the live service responds, otherwise the last end-of-day close.
      </p>
    </div>
  );
}

function RulesEditor({
  rules,
  onChange,
}: {
  rules: AlertRule[];
  onChange: (rules: AlertRule[]) => void;
}) {
  const [type, setType] = useState<SignalType>("rsi-cross-30");
  const [direction, setDirection] = useState<"bullish" | "bearish" | "any">("bullish");
  const [scope, setScope] = useState<AlertScope>("watch-or-portfolio");
  const [symbol, setSymbol] = useState("");
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [price, setPrice] = useState("");

  const update = (id: string, patch: Partial<AlertRule>) =>
    onChange(rules.map((rule) => (rule.id === id ? ({ ...rule, ...patch } as AlertRule) : rule)));

  return (
    <div className="stack">
      <div className="table-scroll short">
        <table className="table">
          <thead>
            <tr>
              <th>On</th>
              <th>Rule</th>
              <th>Direction</th>
              <th>Scope</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Enable ${rule.label}`}
                    checked={rule.enabled}
                    onChange={(event) => update(rule.id, { enabled: event.target.checked })}
                  />
                </td>
                <td>
                  <strong>{rule.label}</strong>
                  <span className="cell-sub">
                    {rule.kind === "signal" ? SIGNAL_TYPE_LABEL[rule.type] : `Price ${rule.condition} ${rule.price}`}
                  </span>
                </td>
                <td>
                  {rule.kind === "signal" ? (
                    <select
                      aria-label="Direction"
                      value={rule.direction}
                      onChange={(event) => update(rule.id, { direction: event.target.value as "bullish" | "bearish" | "any" })}
                    >
                      <option value="bullish">Bullish / up</option>
                      <option value="bearish">Bearish / down</option>
                      <option value="any">Either</option>
                    </select>
                  ) : (
                    <span className="muted">{rule.condition}</span>
                  )}
                </td>
                <td>
                  {rule.kind === "signal" ? (
                    <select
                      aria-label="Scope"
                      value={rule.scope}
                      onChange={(event) => update(rule.id, { scope: event.target.value as AlertScope })}
                    >
                      {(Object.keys(SCOPE_LABEL) as AlertScope[]).map((value) => (
                        <option key={value} value={value}>
                          {SCOPE_LABEL[value]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted">{rule.symbol}</span>
                  )}
                </td>
                <td className="right">
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={() => onChange(rules.filter((item) => item.id !== rule.id))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid two">
        <div className="stack-sm">
          <strong>Add a signal rule</strong>
          <div className="form-grid">
            <label>
              <span>Signal</span>
              <select value={type} onChange={(e) => setType(e.target.value as SignalType)}>
                {(Object.keys(SIGNAL_TYPE_LABEL) as SignalType[]).map((value) => (
                  <option key={value} value={value}>
                    {SIGNAL_TYPE_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Direction</span>
              <select value={direction} onChange={(e) => setDirection(e.target.value as "bullish" | "bearish" | "any")}>
                <option value="bullish">Bullish / up</option>
                <option value="bearish">Bearish / down</option>
                <option value="any">Either</option>
              </select>
            </label>
            <label>
              <span>Scope</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as AlertScope)}>
                {(Object.keys(SCOPE_LABEL) as AlertScope[]).map((value) => (
                  <option key={value} value={value}>
                    {SCOPE_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="button"
                onClick={() =>
                  onChange([
                    ...rules,
                    {
                      id: crypto.randomUUID(),
                      kind: "signal",
                      enabled: true,
                      type,
                      direction,
                      scope,
                      label: `${SIGNAL_TYPE_LABEL[type]} (${direction}) · ${SCOPE_LABEL[scope]}`,
                    },
                  ])
                }
              >
                Add rule
              </button>
            </div>
          </div>
        </div>
        <div className="stack-sm">
          <strong>Add a price alert</strong>
          <div className="form-grid">
            <label>
              <span>Symbol</span>
              <input value={symbol} placeholder="NABIL" onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
            </label>
            <label>
              <span>Condition</span>
              <select value={condition} onChange={(e) => setCondition(e.target.value as "above" | "below")}>
                <option value="above">Price at or above</option>
                <option value="below">Price at or below</option>
              </select>
            </label>
            <label>
              <span>Price (NPR)</span>
              <input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="button"
                disabled={!symbol.trim() || !(Number(price) > 0)}
                onClick={() => {
                  onChange([
                    ...rules,
                    {
                      id: crypto.randomUUID(),
                      kind: "price",
                      enabled: true,
                      symbol: symbol.trim(),
                      condition,
                      price: Number(price),
                      label: `${symbol.trim()} ${condition} ${Number(price)}`,
                    },
                  ]);
                  setSymbol("");
                  setPrice("");
                }}
              >
                Add alert
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="row">
        <button type="button" className="button button-ghost button-small" onClick={() => onChange(DEFAULT_RULES)}>
          Restore default rules
        </button>
        <span className="muted small">
          Defaults include the client's RSI 30 and RSI 50 cross alerts for all active equities.
        </span>
      </div>
    </div>
  );
}



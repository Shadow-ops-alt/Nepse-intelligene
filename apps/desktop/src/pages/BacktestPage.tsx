import { useMemo, useState } from "react";
import {
  api,
  formatCompact,
  formatNumber,
  formatPercent,
} from "../api";
import type {
  BacktestCoverageResponse,
  BacktestResult,
  BacktestRunResponse,
  BacktestStrategyKind,
} from "../types";
import {
  Badge,
  Card,
  EmptyState,
  Notice,
  Spinner,
  Stat,
  toneOf,
} from "../components/ui";

// ---------------------------------------------------------------------------
// form model
// ---------------------------------------------------------------------------

interface Draft {
  strategy: BacktestStrategyKind;
  symbols: string;
  from: string;
  to: string;
  capital: string;
  sizing: "percent" | "fixed";
  positionPercent: string;
  positionAmount: string;
  maxPositions: string;
  slippageBps: string;
  investor: "individual" | "institution";
  stopLossPercent: string;
  takeProfitPercent: string;
  fastPeriod: string;
  slowPeriod: string;
  rsiPeriod: string;
  rsiBuyBelow: string;
  rsiSellAbove: string;
  macdFast: string;
  macdSlow: string;
  macdSignal: string;
  breakoutEntry: string;
  breakoutExit: string;
}

const STRATEGIES: Array<{
  value: BacktestStrategyKind;
  label: string;
  rule: string;
}> = [
  {
    value: "smaCross",
    label: "SMA cross",
    rule: "Long while the fast SMA is above the slow SMA.",
  },
  {
    value: "emaCross",
    label: "EMA cross",
    rule: "Long while the fast EMA is above the slow EMA.",
  },
  {
    value: "rsi",
    label: "RSI threshold",
    rule: "Enter when RSI crosses up through the buy level, exit when it crosses down through the sell level.",
  },
  {
    value: "macd",
    label: "MACD cross",
    rule: "Long while the MACD line is above its signal line.",
  },
  {
    value: "breakout",
    label: "20-session breakout",
    rule: "Enter on a close above the prior N-session high, exit on a close below the prior M-session low.",
  },
  {
    value: "buyAndHold",
    label: "Buy and hold",
    rule: "Buy at the first eligible open and hold to the end of the window.",
  },
];

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function today(): string {
  return isoDay(new Date());
}

function yearsAgo(years: number): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return isoDay(date);
}

const INITIAL_DRAFT: Draft = {
  strategy: "smaCross",
  symbols: "",
  from: yearsAgo(3),
  to: today(),
  capital: "100000",
  sizing: "percent",
  positionPercent: "20",
  positionAmount: "25000",
  maxPositions: "5",
  slippageBps: "0",
  investor: "individual",
  stopLossPercent: "",
  takeProfitPercent: "",
  fastPeriod: "20",
  slowPeriod: "50",
  rsiPeriod: "14",
  rsiBuyBelow: "30",
  rsiSellAbove: "70",
  macdFast: "12",
  macdSlow: "26",
  macdSignal: "9",
  breakoutEntry: "20",
  breakoutExit: "10",
};

function numeric(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function strategyPayload(draft: Draft): Record<string, unknown> {
  const payload: Record<string, unknown> = { kind: draft.strategy };
  const put = (key: string, text: string) => {
    const value = numeric(text);
    if (value !== null) payload[key] = value;
  };
  if (draft.strategy === "smaCross" || draft.strategy === "emaCross") {
    put("fastPeriod", draft.fastPeriod);
    put("slowPeriod", draft.slowPeriod);
  } else if (draft.strategy === "rsi") {
    put("rsiPeriod", draft.rsiPeriod);
    put("rsiBuyBelow", draft.rsiBuyBelow);
    put("rsiSellAbove", draft.rsiSellAbove);
  } else if (draft.strategy === "macd") {
    put("macdFast", draft.macdFast);
    put("macdSlow", draft.macdSlow);
    put("macdSignal", draft.macdSignal);
  } else if (draft.strategy === "breakout") {
    put("breakoutEntryLookback", draft.breakoutEntry);
    put("breakoutExitLookback", draft.breakoutExit);
  }
  return payload;
}

function symbolList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

// ---------------------------------------------------------------------------
// charts
// ---------------------------------------------------------------------------

interface ChartPoint {
  date: string;
  equity: number;
  benchmark: number | null;
}

function EquityChart({ points }: { points: ChartPoint[] }) {
  const width = 760;
  const height = 280;
  const pad = { top: 16, right: 16, bottom: 26, left: 62 };

  const chart = useMemo(() => {
    const values = points.flatMap((point) =>
      point.benchmark === null
        ? [point.equity]
        : [point.equity, point.benchmark],
    );
    if (points.length < 2 || values.length === 0) return null;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (!(max > min)) {
      min -= 1;
      max += 1;
    }
    const span = max - min;
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const x = (index: number) =>
      pad.left + (points.length === 1 ? 0 : (index / (points.length - 1)) * innerWidth);
    const y = (value: number) =>
      pad.top + (1 - (value - min) / span) * innerHeight;
    const line = (
      pick: (point: ChartPoint) => number | null,
    ): string => {
      let path = "";
      let started = false;
      points.forEach((point, index) => {
        const value = pick(point);
        if (value === null) return;
        path += `${started ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
        started = true;
      });
      return path;
    };
    const ticks = Array.from({ length: 5 }, (_, index) =>
      min + (span * index) / 4,
    );
    return { min, max, x, y, equityPath: line((p) => p.equity), benchmarkPath: line((p) => p.benchmark), ticks };
  }, [points]);

  if (!chart) {
    return <EmptyState title="No equity curve">Run a backtest to draw the curve.</EmptyState>;
  }

  const labels = [points[0], points[Math.floor(points.length / 2)], points.at(-1)];

  return (
    <div className="backtest-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Equity curve against the NEPSE benchmark"
      >
        {chart.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={chart.y(tick)}
              y2={chart.y(tick)}
              className="bt-grid"
            />
            <text x={pad.left - 8} y={chart.y(tick) + 4} textAnchor="end" className="bt-axis">
              {formatCompact(tick)}
            </text>
          </g>
        ))}
        <path d={chart.benchmarkPath} className="bt-benchmark" />
        <path d={chart.equityPath} className="bt-equity" />
        {labels.map((point, index) =>
          point ? (
            <text
              key={`${point.date}-${index}`}
              x={chart.x(index === 0 ? 0 : index === 1 ? Math.floor(points.length / 2) : points.length - 1)}
              y={height - 6}
              textAnchor={index === 0 ? "start" : index === 1 ? "middle" : "end"}
              className="bt-axis"
            >
              {point.date}
            </text>
          ) : null,
        )}
      </svg>
      <div className="chart-legend">
        <span><i className="bt-swatch bt-swatch-equity" /> Strategy</span>
        {points.some((point) => point.benchmark !== null) ? (
          <span><i className="bt-swatch bt-swatch-benchmark" /> NEPSE</span>
        ) : null}
      </div>
    </div>
  );
}

function DrawdownChart({
  points,
}: {
  points: Array<{ date: string; drawdownPercent: number }>;
}) {
  const width = 760;
  const height = 160;
  const pad = { top: 12, right: 16, bottom: 22, left: 52 };
  if (points.length < 2) {
    return <EmptyState title="No drawdown">Run a backtest to draw the drawdown.</EmptyState>;
  }
  const values = points.map((point) => point.drawdownPercent);
  const min = Math.min(-1, ...values);
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const x = (index: number) =>
    pad.left + (index / (points.length - 1)) * innerWidth;
  const y = (value: number) => pad.top + (value / min) * innerHeight;
  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.drawdownPercent).toFixed(1)}`,
    )
    .join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${pad.top} L${pad.left},${pad.top} Z`;
  return (
    <div className="backtest-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Drawdown from the running peak"
      >
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top}
          y2={pad.top}
          className="bt-grid"
        />
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={y(min)}
          y2={y(min)}
          className="bt-grid"
        />
        <text x={pad.left - 8} y={pad.top + 4} textAnchor="end" className="bt-axis">
          0%
        </text>
        <text x={pad.left - 8} y={y(min) + 4} textAnchor="end" className="bt-axis">
          {formatPercent(min)}
        </text>
        <path d={area} className="bt-drawdown-area" />
        <path d={line} className="bt-drawdown" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

export function BacktestPage() {
  const [draft, setDraft] = useState<Draft>(INITIAL_DRAFT);
  const [coverage, setCoverage] = useState<BacktestCoverageResponse | null>(null);
  const [coverageFor, setCoverageFor] = useState<string | null>(null);
  const [coverageBusy, setCoverageBusy] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const update = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const symbols = useMemo(() => symbolList(draft.symbols), [draft.symbols]);
  const coverageKey = useMemo(
    () => JSON.stringify({ symbols: [...symbols].sort(), from: draft.from, to: draft.to }),
    [symbols, draft.from, draft.to],
  );
  const coverageFresh = coverage !== null && coverageFor === coverageKey;
  const eligibleSymbols = coverageFresh
    ? coverage.symbols.filter((row) => row.eligible).map((row) => row.symbol)
    : [];
  const canRun = coverageFresh && eligibleSymbols.length > 0 && !runBusy;
  const strategyInfo = STRATEGIES.find((item) => item.value === draft.strategy);
  const showMa = draft.strategy === "smaCross" || draft.strategy === "emaCross";

  const checkCoverage = async () => {
    if (symbols.length === 0) {
      setCoverageError("Enter at least one symbol.");
      return;
    }
    setCoverageBusy(true);
    setCoverageError(null);
    setResult(null);
    try {
      const query = new URLSearchParams({
        symbols: symbols.join(","),
        ...(draft.from ? { from: draft.from } : {}),
        ...(draft.to ? { to: draft.to } : {}),
      });
      const response = await api<BacktestCoverageResponse>(
        `/api/backtest/coverage?${query.toString()}`,
      );
      setCoverage(response);
      setCoverageFor(coverageKey);
    } catch (cause) {
      setCoverage(null);
      setCoverageFor(null);
      setCoverageError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCoverageBusy(false);
    }
  };

  const run = async () => {
    if (symbols.length === 0) {
      setRunError("Enter at least one symbol.");
      return;
    }
    const capital = numeric(draft.capital);
    if (capital === null || capital <= 0) {
      setRunError("Capital must be greater than zero.");
      return;
    }
    const maxPositions = numeric(draft.maxPositions);
    if (maxPositions === null || !Number.isInteger(maxPositions) || maxPositions < 1) {
      setRunError("Max positions must be a whole number of at least 1.");
      return;
    }
    const positionPercent = numeric(draft.positionPercent);
    const positionAmount = numeric(draft.positionAmount);
    if (draft.sizing === "percent" && (positionPercent === null || positionPercent <= 0 || positionPercent > 100)) {
      setRunError("Position percent must be greater than 0 and at most 100.");
      return;
    }
    if (draft.sizing === "fixed" && (positionAmount === null || positionAmount <= 0)) {
      setRunError("Position amount must be greater than zero.");
      return;
    }
    if (draft.from && draft.to && draft.from > draft.to) {
      setRunError("The start date must not be after the end date.");
      return;
    }
    setRunBusy(true);
    setRunError(null);
    try {
      const stopLossPercent = numeric(draft.stopLossPercent);
      const takeProfitPercent = numeric(draft.takeProfitPercent);
      const response = await api<BacktestRunResponse>("/api/backtest/run", {
        method: "POST",
        body: JSON.stringify({
          strategy: strategyPayload(draft),
          symbols: eligibleSymbols,
          from: draft.from,
          to: draft.to,
          capital,
          ...(draft.sizing === "percent"
            ? { positionPercent }
            : { positionAmount }),
          maxPositions,
          slippageBps: numeric(draft.slippageBps) ?? 0,
          costs: {
            investor: draft.investor,
            slippageBps: numeric(draft.slippageBps) ?? 0,
          },
          ...(stopLossPercent !== null && stopLossPercent > 0
            ? { stopLossPercent }
            : {}),
          ...(takeProfitPercent !== null && takeProfitPercent > 0
            ? { takeProfitPercent }
            : {}),
        }),
      });
      setResult(response.result);
    } catch (cause) {
      setResult(null);
      setRunError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunBusy(false);
    }
  };

  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <h1>Backtest</h1>
          <p className="muted">
            Event-driven daily simulation over the stored archive. Signals on the
            close, fills at the next open, corporate-action-adjusted history.
          </p>
        </div>
      </header>

      <Notice tone="warn">
        <strong>Hypothetical research.</strong> Every output row is DERIVED
        from raw prices and resolved actions. Prices are unofficial exchange
        data. The result is a model, not a forecast and not investment advice.
        Corporate-action coverage is shown below and a symbol is refused when
        any action affecting it is unresolved. No-lookahead guarantees cover this
        engine's own model: signals use closed bars and orders fill at the next
        open.
      </Notice>

      <Card title="Setup" subtitle={strategyInfo?.rule}>
        <div className="form-grid backtest-controls">
          <label>
            <span>Strategy</span>
            <select
              value={draft.strategy}
              onChange={(event) =>
                update({ strategy: event.target.value as BacktestStrategyKind })
              }
            >
              {STRATEGIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            <span>Symbols</span>
            <input
              value={draft.symbols}
              onChange={(event) => update({ symbols: event.target.value })}
              placeholder="NABIL, SCB, ADBL"
              spellCheck={false}
            />
          </label>
          <label>
            <span>From</span>
            <input
              type="date"
              value={draft.from}
              onChange={(event) => update({ from: event.target.value })}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              value={draft.to}
              onChange={(event) => update({ to: event.target.value })}
            />
          </label>
          <label>
            <span>Initial capital (Rs)</span>
            <input
              value={draft.capital}
              inputMode="decimal"
              onChange={(event) => update({ capital: event.target.value })}
            />
          </label>
          <label>
            <span>Sizing</span>
            <select
              value={draft.sizing}
              onChange={(event) =>
                update({ sizing: event.target.value as Draft["sizing"] })
              }
            >
              <option value="percent">Percent of equity</option>
              <option value="fixed">Fixed amount</option>
            </select>
          </label>
          {draft.sizing === "percent" ? (
            <label>
              <span>Position percent</span>
              <input
                value={draft.positionPercent}
                inputMode="decimal"
                onChange={(event) => update({ positionPercent: event.target.value })}
              />
            </label>
          ) : (
            <label>
              <span>Position amount (Rs)</span>
              <input
                value={draft.positionAmount}
                inputMode="decimal"
                onChange={(event) => update({ positionAmount: event.target.value })}
              />
            </label>
          )}
          <label>
            <span>Max positions</span>
            <input
              value={draft.maxPositions}
              inputMode="numeric"
              onChange={(event) => update({ maxPositions: event.target.value })}
            />
          </label>
          <label>
            <span>Slippage (bps)</span>
            <input
              value={draft.slippageBps}
              inputMode="decimal"
              onChange={(event) => update({ slippageBps: event.target.value })}
            />
          </label>
          <label>
            <span>Investor</span>
            <select
              value={draft.investor}
              onChange={(event) =>
                update({ investor: event.target.value as Draft["investor"] })
              }
            >
              <option value="individual">Individual</option>
              <option value="institution">Institution</option>
            </select>
          </label>
          <label>
            <span>Stop loss % (optional)</span>
            <input
              value={draft.stopLossPercent}
              inputMode="decimal"
              onChange={(event) => update({ stopLossPercent: event.target.value })}
            />
          </label>
          <label>
            <span>Take profit % (optional)</span>
            <input
              value={draft.takeProfitPercent}
              inputMode="decimal"
              onChange={(event) => update({ takeProfitPercent: event.target.value })}
            />
          </label>
          {showMa ? (
            <>
              <label>
                <span>Fast period</span>
                <input
                  value={draft.fastPeriod}
                  inputMode="numeric"
                  onChange={(event) => update({ fastPeriod: event.target.value })}
                />
              </label>
              <label>
                <span>Slow period</span>
                <input
                  value={draft.slowPeriod}
                  inputMode="numeric"
                  onChange={(event) => update({ slowPeriod: event.target.value })}
                />
              </label>
            </>
          ) : null}
          {draft.strategy === "rsi" ? (
            <>
              <label>
                <span>RSI period</span>
                <input
                  value={draft.rsiPeriod}
                  inputMode="numeric"
                  onChange={(event) => update({ rsiPeriod: event.target.value })}
                />
              </label>
              <label>
                <span>Buy below</span>
                <input
                  value={draft.rsiBuyBelow}
                  inputMode="decimal"
                  onChange={(event) => update({ rsiBuyBelow: event.target.value })}
                />
              </label>
              <label>
                <span>Sell above</span>
                <input
                  value={draft.rsiSellAbove}
                  inputMode="decimal"
                  onChange={(event) => update({ rsiSellAbove: event.target.value })}
                />
              </label>
            </>
          ) : null}
          {draft.strategy === "macd" ? (
            <>
              <label>
                <span>MACD fast</span>
                <input
                  value={draft.macdFast}
                  inputMode="numeric"
                  onChange={(event) => update({ macdFast: event.target.value })}
                />
              </label>
              <label>
                <span>MACD slow</span>
                <input
                  value={draft.macdSlow}
                  inputMode="numeric"
                  onChange={(event) => update({ macdSlow: event.target.value })}
                />
              </label>
              <label>
                <span>Signal</span>
                <input
                  value={draft.macdSignal}
                  inputMode="numeric"
                  onChange={(event) => update({ macdSignal: event.target.value })}
                />
              </label>
            </>
          ) : null}
          {draft.strategy === "breakout" ? (
            <>
              <label>
                <span>Entry lookback</span>
                <input
                  value={draft.breakoutEntry}
                  inputMode="numeric"
                  onChange={(event) => update({ breakoutEntry: event.target.value })}
                />
              </label>
              <label>
                <span>Exit lookback</span>
                <input
                  value={draft.breakoutExit}
                  inputMode="numeric"
                  onChange={(event) => update({ breakoutExit: event.target.value })}
                />
              </label>
            </>
          ) : null}
        </div>
        <div className="form-actions">
          <button type="button" className="button" onClick={() => void checkCoverage()} disabled={coverageBusy}>
            {coverageBusy ? "Checking coverage…" : "Check coverage"}
          </button>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => void run()}
            disabled={!canRun}
            title={
              coverageFresh
                ? eligibleSymbols.length > 0
                  ? "Run the backtest over the eligible symbols"
                  : "No symbol passed the coverage gate"
                : "Check coverage first"
            }
          >
            {runBusy ? "Running…" : "Run backtest"}
          </button>
          {coverageFresh ? (
            <span className="muted">
              {eligibleSymbols.length} eligible
              {coverage!.summary.ineligible > 0
                ? ` · ${coverage!.summary.ineligible} blocked and excluded`
                : ""}
            </span>
          ) : null}
        </div>
        {coverageError ? <Notice tone="error">{coverageError}</Notice> : null}
        {runError ? <Notice tone="error">{runError}</Notice> : null}
      </Card>

      <Card
        title="Coverage gate"
        subtitle="Raw candles are unofficial and unadjusted. A symbol runs only when every stored action has an ex-date and the adjusted series validates."
      >
        {coverageBusy ? (
          <Spinner label="Checking corporate-action coverage" />
        ) : !coverageFresh ? (
          <EmptyState title="Coverage not checked">
            Enter symbols and press Check coverage. The gate reports every
            resolved and unresolved action before any backtest can run.
          </EmptyState>
        ) : (
          <>
            <div className="stats-row">
              <Stat label="Symbols" value={coverage!.summary.requested} />
              <Stat label="Eligible" value={coverage!.summary.eligible} tone={coverage!.summary.eligible > 0 ? "up" : "flat"} />
              <Stat label="Blocked" value={coverage!.summary.ineligible} tone={coverage!.summary.ineligible > 0 ? "down" : "flat"} />
              <Stat label="Resolved actions" value={coverage!.summary.resolvedActions} />
              <Stat label="Unresolved actions" value={coverage!.summary.unresolvedActions} tone={coverage!.summary.unresolvedActions > 0 ? "down" : "flat"} />
              <Stat label="Sessions" value={formatNumber(coverage!.summary.sessions, 0)} />
            </div>
            {coverage!.summary.allEligible ? (
              <Notice tone="info">
                Every requested symbol has resolved corporate-action coverage and
                a validated adjusted series.
              </Notice>
            ) : (
              <Notice tone="warn">
                {coverage!.summary.ineligible} symbol
                {coverage!.summary.ineligible === 1 ? " is" : "s are"} blocked.
                The gate treats a missing corporate-action snapshot as unknown
                coverage and a percent-only dividend or a missing ex-date as
                unresolved. Run uses only the eligible symbols listed here. To
                unblock a symbol, add its real ex-date (and, for rights, the
                share ratio and issue price) to the stored corporate actions
                and re-import.
              </Notice>
            )}
            <div className="table-scroll">
              <table className="table backtest-coverage-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="right">Sessions</th>
                    <th className="right">Resolved</th>
                    <th className="right">Unresolved</th>
                    <th>Series</th>
                    <th>Status</th>
                    <th>Reasons and actions</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage!.symbols.map((row) => (
                    <tr key={row.symbol}>
                      <td className="mono">{row.symbol}</td>
                      <td className="right">{formatNumber(row.bars, 0)}</td>
                      <td className="right">{row.resolvedActions}</td>
                      <td className="right">{row.unresolvedActions}</td>
                      <td>
                        <Badge tone={row.adjustedSeriesValid ? "good" : "bad"}>
                          {row.adjustedSeriesValid ? "valid" : "invalid"}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={row.eligible ? "good" : "bad"}>
                          {row.eligible ? "eligible" : "blocked"}
                        </Badge>
                      </td>
                      <td>
                        {row.reasons.length > 0 ? (
                          <ul className="backtest-reasons">
                            {row.reasons.slice(0, 5).map((reason, index) => (
                              <li key={index}>{reason}</li>
                            ))}
                            {row.reasons.length > 5 ? (
                              <li>and {row.reasons.length - 5} more…</li>
                            ) : null}
                          </ul>
                        ) : (
                          <span className="muted">—</span>
                        )}
                        {row.actions.length > 0 ? (
                          <div className="chips backtest-actions">
                            {row.actions.slice(0, 6).map((action, index) => (
                              <span
                                key={`${action.type}-${index}`}
                                className={`chip ${action.status === "resolved" ? "" : "chip-off"}`}
                                title={`${action.reason ?? ""}${
                                  action.dateBasis === "book-closure"
                                    ? " Book-closure basis (approximate, not an exchange ex-date)."
                                    : ""
                                }`}
                              >
                                {action.type}
                                {action.exDate ? ` @ ${action.exDate}` : ""}
                                {action.dateBasis === "book-closure"
                                  ? " · book closure"
                                  : ""}
                                {action.cashPerShare !== null
                                  ? ` · Rs ${action.cashPerShare}`
                                  : ""}
                                {action.issuePrice !== null && action.ratio !== null
                                  ? ` · ${action.ratio}:1 @ ${action.issuePrice}`
                                  : ""}
                              </span>
                            ))}
                            {row.actions.length > 6 ? (
                              <span className="chip">+{row.actions.length - 6}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {result ? (
        <>
          <div className="stats-row">
            <Stat
              label="Total return"
              value={formatPercent(result.metrics.totalReturnPercent)}
              tone={toneOf(result.metrics.totalReturnPercent)}
              hint={`Final Rs ${formatNumber(result.metrics.finalEquity, 2)}`}
            />
            <Stat
              label="CAGR"
              value={result.metrics.cagrPercent === null ? "—" : formatPercent(result.metrics.cagrPercent)}
              tone={toneOf(result.metrics.cagrPercent)}
            />
            <Stat
              label="Max drawdown"
              value={formatPercent(result.metrics.maxDrawdownPercent)}
              tone="down"
            />
            <Stat label="Sharpe" value={result.metrics.sharpe === null ? "—" : formatNumber(result.metrics.sharpe, 2)} />
            <Stat label="Sortino" value={result.metrics.sortino === null ? "—" : formatNumber(result.metrics.sortino, 2)} />
            <Stat label="Win rate" value={result.metrics.winRatePercent === null ? "—" : `${formatNumber(result.metrics.winRatePercent, 2)}%`} />
            <Stat label="Profit factor" value={result.metrics.profitFactor === null ? "—" : formatNumber(result.metrics.profitFactor, 2)} />
            <Stat label="Expectancy" value={result.metrics.expectancy === null ? "—" : `Rs ${formatNumber(result.metrics.expectancy, 2)}`} />
            <Stat label="Trades" value={formatNumber(result.metrics.trades, 0)} hint={`${result.metrics.winningTrades}W / ${result.metrics.losingTrades}L`} />
            <Stat label="Exposure" value={`${formatNumber(result.metrics.exposurePercent, 2)}%`} />
            <Stat label="Turnover" value={`${formatNumber(result.metrics.turnoverPercent, 2)}%`} />
            <Stat
              label="NEPSE"
              value={result.metrics.benchmarkReturnPercent === null ? "—" : formatPercent(result.metrics.benchmarkReturnPercent)}
              tone={toneOf(result.metrics.benchmarkReturnPercent)}
            />
          </div>

          <Card
            title="Equity curve"
            subtitle={`${result.period.sessions} sessions from ${result.period.from ?? "—"} to ${result.period.to ?? "—"}; ${result.symbols.join(", ")}`}
          >
            <EquityChart points={result.equityCurve} />
          </Card>

          <div className="grid two">
            <Card title="Drawdown" subtitle="Percent below the running equity peak">
              <DrawdownChart points={result.drawdownCurve} />
            </Card>
            <Card title="Execution summary">
              <dl className="kv">
                <div><dt>Strategy</dt><dd>{result.strategy.kind}</dd></div>
                <div><dt>Initial capital</dt><dd>Rs {formatNumber(result.metrics.initialCapital, 2)}</dd></div>
                <div><dt>Final equity</dt><dd>Rs {formatNumber(result.metrics.finalEquity, 2)}</dd></div>
                <div><dt>Brokerage and fees</dt><dd>Rs {formatNumber(result.metrics.totalFees, 2)}</dd></div>
                <div><dt>Capital gains tax</dt><dd>Rs {formatNumber(result.metrics.totalCgt, 2)}</dd></div>
                <div><dt>Dividends credited</dt><dd>Rs {formatNumber(result.metrics.totalDividends, 2)}</dd></div>
                <div><dt>Sessions per year</dt><dd>{formatNumber(result.metrics.sessionsPerYear, 0)}</dd></div>
                <div><dt>Volatility</dt><dd>{result.metrics.volatilityPercent === null ? "—" : `${formatNumber(result.metrics.volatilityPercent, 2)}%`}</dd></div>
              </dl>
              {result.warnings.length > 0 ? (
                <Notice tone="warn">
                  <ul className="backtest-reasons">
                    {result.warnings.slice(0, 6).map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </Notice>
              ) : null}
            </Card>
          </div>

          <Card title="Monthly returns" subtitle="Month-end equity, chained from the initial capital">
            {result.monthlyReturns.length === 0 ? (
              <EmptyState title="No monthly returns">The run is shorter than one month.</EmptyState>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="right">Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.monthlyReturns.map((row) => (
                      <tr key={row.month}>
                        <td className="mono">{row.month}</td>
                        <td className={`right num tone-${toneOf(row.returnPercent)}`}>
                          {formatPercent(row.returnPercent)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card
            title="Trades"
            subtitle="Closed trades. A position open at the end of the window is closed at the last stored close."
            action={
              <span className="muted">
                {result.trades.length} closed trade{result.trades.length === 1 ? "" : "s"}
              </span>
            }
          >
            {result.trades.length === 0 ? (
              <EmptyState title="No trades">The strategy did not produce a completed round trip in this window.</EmptyState>
            ) : (
              <div className="table-scroll">
                <table className="table backtest-trade-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Entry</th>
                      <th className="right">Entry px</th>
                      <th>Exit</th>
                      <th className="right">Exit px</th>
                      <th className="right">Qty</th>
                      <th className="right">Net profit</th>
                      <th className="right">Return</th>
                      <th className="right">Days</th>
                      <th>Exit reason</th>
                      <th className="right">CGT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((trade, index) => (
                      <tr key={`${trade.symbol}-${trade.entryDate}-${index}`}>
                        <td className="mono">{trade.symbol}</td>
                        <td>{trade.entryDate}</td>
                        <td className="right num">{formatNumber(trade.entryPrice, 2)}</td>
                        <td>{trade.exitDate}</td>
                        <td className="right num">{formatNumber(trade.exitPrice, 2)}</td>
                        <td className="right num">{formatNumber(trade.quantity, 0)}</td>
                        <td className={`right num tone-${toneOf(trade.netProfit)}`}>
                          {formatNumber(trade.netProfit, 2)}
                        </td>
                        <td className={`right num tone-${toneOf(trade.returnPercent)}`}>
                          {formatPercent(trade.returnPercent)}
                        </td>
                        <td className="right">{trade.holdingDays}</td>
                        <td>{trade.exitReason}</td>
                        <td className="right num">{formatNumber(trade.cgt, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Adjustments used" subtitle="How each symbol's corporate actions were applied">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="right">Actions</th>
                    <th className="right">Applied</th>
                    <th className="right">Outside range</th>
                    <th className="right">Invalid</th>
                    <th className="right">Cash events</th>
                    <th>Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {result.adjustments.map((row) => (
                    <tr key={row.symbol}>
                      <td className="mono">{row.symbol}</td>
                      <td className="right">{row.actions}</td>
                      <td className="right">{row.applied}</td>
                      <td className="right">{row.outsideRange}</td>
                      <td className="right">{row.invalid}</td>
                      <td className="right">{row.cashEvents}</td>
                      <td>
                        <Badge tone={row.validationOk ? "good" : "bad"}>
                          {row.validationOk ? "valid" : "invalid"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

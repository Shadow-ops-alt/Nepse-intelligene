import { useState, type FormEvent } from "react";
import { api, formatNumber, formatPercent } from "../api";
import { useApi } from "../hooks";
import type { PortfolioResponse } from "../types";
import {
  AsOf,
  Badge,
  Card,
  ClickableRow,
  DataStateBadge,
  EmptyState,
  Spinner,
  Stat,
  formatTimestamp,
} from "../components/ui";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PortfolioPage({
  onOpenSymbol,
}: {
  onOpenSymbol: (symbol: string) => void;
}) {
  const portfolioState = useApi<PortfolioResponse>("/api/portfolio");
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState("");
  const [tradedAt, setTradedAt] = useState(today());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portfolio = portfolioState.data;
  const positions = portfolio?.positions ?? [];
  const transactions = portfolio?.transactions ?? [];
  const totals = portfolio?.totals;

  async function addTransaction(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/portfolio/transactions", {
        method: "POST",
        body: JSON.stringify({
          symbol,
          side,
          quantity: Number(quantity),
          price: Number(price),
          fees: fees === "" ? 0 : Number(fees),
          tradedAt,
          notes: notes.trim() || null,
        }),
      });
      setSymbol("");
      setQuantity("");
      setPrice("");
      setFees("");
      setNotes("");
      portfolioState.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function removeTransaction(id: number) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/portfolio/transactions/remove", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      portfolioState.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (portfolioState.loading) return <Spinner label="Loading portfolio" />;

  if (portfolioState.error) {
    return (
      <EmptyState title="Could not load the portfolio">
        {portfolioState.error}
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <div className="stats-row">
        <Stat
          label="Cost basis"
          value={formatNumber(totals?.costBasis)}
          hint="open positions"
        />
        <Stat
          label="Market value"
          value={
            totals && totals.pricedPositions > 0
              ? formatNumber(totals.marketValue)
              : "—"
          }
          hint={`${totals?.pricedPositions ?? 0} priced`}
        />
        <Stat
          label="Unrealised P&L"
          value={
            totals && totals.pricedPositions > 0
              ? formatNumber(totals.unrealizedPnl)
              : "—"
          }
          tone={
            (totals?.unrealizedPnl ?? 0) >= 0 ? "up" : "down"
          }
        />
        <Stat
          label="Realised P&L"
          value={formatNumber(totals?.realizedPnl)}
          tone={(totals?.realizedPnl ?? 0) >= 0 ? "up" : "down"}
        />
        <Stat
          label="Total P&L"
          value={formatNumber(totals?.totalPnl)}
          tone={(totals?.totalPnl ?? 0) >= 0 ? "up" : "down"}
        />
      </div>

      {(portfolio?.warnings.length ?? 0) > 0 && (
        <div className="notice">
          {(portfolio?.warnings ?? []).map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}

      {positions.length > 0 && (
        <Card
          title="Allocation"
          subtitle="Share of open positions by market value (cost basis where unpriced)"
          action={<Badge tone="info">derived</Badge>}
        >
          <Allocation
            items={positions.map((position) => ({
              symbol: position.symbol,
              value: position.marketValue ?? position.costBasis,
              priced: position.marketValue !== null,
            }))}
          />
        </Card>
      )}

      <Card
        title="Positions"
        subtitle="Weighted average cost · buy fees capitalised · sells reduce realised proceeds"
        action={
          portfolio ? (
            <DataStateBadge
              state={portfolio.dataState.state}
              classification={portfolio.dataState.classification}
            />
          ) : undefined
        }
      >
        {positions.length === 0 ? (
          <EmptyState title="No positions yet">
            Record a buy below to start tracking cost basis and P&L.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="right">Qty</th>
                  <th className="right">Avg cost</th>
                  <th className="right">Cost basis</th>
                  <th className="right">Market</th>
                  <th>Valuation</th>
                  <th className="right">Value</th>
                  <th className="right">Unrealised</th>
                  <th className="right">Realised</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <ClickableRow
                    key={position.symbol}
                    onClick={() => onOpenSymbol(position.symbol)}
                  >
                    <td>
                      <strong>{position.symbol}</strong>
                      <span className="cell-sub">
                        {position.quoteAsOf
                          ? `price ${formatTimestamp(position.quoteAsOf)}`
                          : "no stored price"}
                      </span>
                    </td>
                    <td className="right">{formatNumber(position.quantity, 2)}</td>
                    <td className="right">{formatNumber(position.averageCost)}</td>
                    <td className="right">{formatNumber(position.costBasis)}</td>
                    <td className="right">{formatNumber(position.marketPrice)}</td>
                    <td>
                      {position.valuation ? (
                        <>
                          <AsOf
                            value={position.valuation.asOf}
                            ageSeconds={position.valuation.ageSeconds}
                          />
                          <DataStateBadge
                            state={position.valuation.state}
                            classification={position.valuation.classification}
                            showClassification={false}
                          />
                        </>
                      ) : (
                        <span className="muted small">unpriced</span>
                      )}
                    </td>
                    <td className="right">{formatNumber(position.marketValue)}</td>
                    <td
                      className={`right ${
                        (position.unrealizedPnl ?? 0) >= 0 ? "tone-up" : "tone-down"
                      }`}
                    >
                      {formatNumber(position.unrealizedPnl)}
                      <span className="cell-sub">
                        {formatPercent(position.unrealizedPnlPercent)}
                      </span>
                    </td>
                    <td
                      className={`right ${
                        position.realizedPnl >= 0 ? "tone-up" : "tone-down"
                      }`}
                    >
                      {formatNumber(position.realizedPnl)}
                    </td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Record a transaction" subtitle="Stored only in your local database">
        <form className="form-grid" onSubmit={(event) => void addTransaction(event)}>
          <label>
            <span>Symbol</span>
            <input
              value={symbol}
              required
              placeholder="NABIL"
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            <span>Side</span>
            <select
              value={side}
              onChange={(event) => setSide(event.target.value as "buy" | "sell")}
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>
          <label>
            <span>Quantity</span>
            <input
              value={quantity}
              required
              inputMode="decimal"
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <label>
            <span>Price (NPR)</span>
            <input
              value={price}
              required
              inputMode="decimal"
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
          <label>
            <span>Fees (NPR)</span>
            <input
              value={fees}
              inputMode="decimal"
              placeholder="0"
              onChange={(event) => setFees(event.target.value)}
            />
          </label>
          <label>
            <span>Trade date</span>
            <input
              type="date"
              value={tradedAt}
              required
              onChange={(event) => setTradedAt(event.target.value)}
            />
          </label>
          <label className="span-2">
            <span>Notes</span>
            <input
              value={notes}
              placeholder="Optional"
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <div className="form-actions">
            <button className="button" disabled={busy}>
              {busy ? "Saving…" : "Add transaction"}
            </button>
          </div>
        </form>
        {error && <p className="form-error">{error}</p>}
        <p className="muted small">
          P&L excludes dividends, bonus shares, and corporate actions. Record
          those as separate transactions or adjust quantity and price
          explicitly.
        </p>
      </Card>

      <Card title="Ledger" subtitle={`${transactions.length} transactions`}>
        {transactions.length === 0 ? (
          <EmptyState title="The ledger is empty" />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th className="right">Qty</th>
                  <th className="right">Price</th>
                  <th className="right">Fees</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="muted">{transaction.tradedAt.slice(0, 10)}</td>
                    <td>
                      <strong>{transaction.symbol}</strong>
                    </td>
                    <td>
                      <Badge tone={transaction.side === "buy" ? "good" : "bad"}>
                        {transaction.side}
                      </Badge>
                    </td>
                    <td className="right">{formatNumber(transaction.quantity, 2)}</td>
                    <td className="right">{formatNumber(transaction.price)}</td>
                    <td className="right">{formatNumber(transaction.fees)}</td>
                    <td className="muted small">{transaction.notes ?? ""}</td>
                    <td className="right">
                      <button
                        className="button button-ghost button-small"
                        disabled={busy}
                        onClick={() => void removeTransaction(transaction.id)}
                      >
                        Delete
                      </button>
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

const ALLOCATION_COLOURS = [
  "var(--accent)",
  "var(--up)",
  "#e8890c",
  "#8b3fd9",
  "#0b9bb5",
  "var(--down)",
  "#6b7280",
  "#c2410c",
];

function Allocation({
  items,
}: {
  items: Array<{ symbol: string; value: number; priced: boolean }>;
}) {
  const positive = items.filter((item) => item.value > 0);
  const total = positive.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return <EmptyState title="Nothing to allocate" />;
  const sorted = [...positive].sort((a, b) => b.value - a.value);
  const largest = sorted[0]!;
  // Herfindahl–Hirschman concentration: 1/HHI is the "effective" position count.
  const hhi = sorted.reduce((sum, item) => sum + (item.value / total) ** 2, 0);
  return (
    <div className="stack-sm">
      <div className="breadth-bar" style={{ height: 14 }} role="img" aria-label="Allocation by position">
        {sorted.map((item, index) => (
          <span
            key={item.symbol}
            title={`${item.symbol}: ${((item.value / total) * 100).toFixed(1)}%`}
            style={{
              width: `${(item.value / total) * 100}%`,
              background: ALLOCATION_COLOURS[index % ALLOCATION_COLOURS.length],
              opacity: item.priced ? 1 : 0.45,
            }}
          />
        ))}
      </div>
      <div className="row" style={{ gap: 14 }}>
        {sorted.map((item, index) => (
          <span key={item.symbol} className="small">
            <span
              className="swatch"
              style={{
                background: ALLOCATION_COLOURS[index % ALLOCATION_COLOURS.length],
                height: 8,
                width: 8,
                borderRadius: 2,
                marginRight: 6,
              }}
            />
            <strong>{item.symbol}</strong>{" "}
            <span className="muted">
              {((item.value / total) * 100).toFixed(1)}%{item.priced ? "" : " · cost"}
            </span>
          </span>
        ))}
      </div>
      <p className="muted small">
        Largest position {largest.symbol} at{" "}
        {((largest.value / total) * 100).toFixed(1)}%. Effective number of
        positions (1 / Herfindahl index): <strong>{(1 / hhi).toFixed(1)}</strong>.
      </p>
    </div>
  );
}

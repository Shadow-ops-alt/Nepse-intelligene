import { useMemo, useState } from "react";
import { useApi } from "../hooks";
import { formatCompact, formatNumber } from "../api";
import type {
  BrokerFlow,
  BrokerFlowsResponse,
  FloorsheetResponse,
  FloorsheetTrade,
} from "../types";
import {
  Badge,
  Card,
  ClickableRow,
  DataStateBadge,
  EmptyState,
  MiniStats,
  Notice,
  Segmented,
  SortHeader,
  Spinner,
  Stat,
  Tabs,
  downloadCsv,
  useSort,
} from "../components/ui";
import { Icon } from "../components/icons";
import {
  accumulation,
  aggregateTrades,
  brokerSymbolNets,
  clearFloorsheetCache,
  compareBroker,
  netAmt,
  netQty,
  rememberDay,
  useFloorsheetWindow,
  type Accumulation,
  type BrokerSymbolNet,
  type FloorsheetAggregate,
  type SideTotals,
} from "../market/floorsheet";
import { SourceLine } from "../market/SourceLine";

type FloorsheetTab = "stocks" | "brokers" | "stock-broker" | "bulk" | "three-day" | "holding";

/** Rendered-row cap for large tables; CSV export always carries every row. */
const ROW_CAP = 200;
const CRORE = 10_000_000;
const FREE_SOURCE_URL = "https://merolagani.com/Floorsheet.aspx";

function rs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `Rs ${formatCompact(value)}`;
}

function signedTone(value: number): string {
  return value > 0 ? "tone-up" : value < 0 ? "tone-down" : "";
}

function Signed({ value, money = false }: { value: number; money?: boolean }) {
  const text = money
    ? `${value > 0 ? "+" : value < 0 ? "−" : ""}Rs ${formatCompact(Math.abs(value))}`
    : `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatNumber(Math.abs(value), 0)}`;
  return <span className={signedTone(value)}>{text}</span>;
}

function brokerSort(value: string): number | string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function CsvButton({ onClick, count }: { onClick: () => void; count: number }) {
  return (
    <button
      type="button"
      className="button button-ghost button-small"
      onClick={onClick}
      disabled={count === 0}
    >
      <Icon.Download /> CSV ({count.toLocaleString()})
    </button>
  );
}

function CapNote({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <p className="muted small" style={{ marginTop: 8 }}>
      Showing the first {shown.toLocaleString()} of {total.toLocaleString()} rows
      to keep the table fast. Export CSV for every row.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function FloorsheetPage({
  onOpenSymbol,
}: {
  onOpenSymbol: (symbol: string) => void;
}) {
  const [requestedDate, setRequestedDate] = useState<string | null>(null);
  const [tab, setTab] = useState<FloorsheetTab>("stocks");
  const [pickedSymbol, setPickedSymbol] = useState<string | null>(null);

  const floorsheetState = useApi<FloorsheetResponse>(
    requestedDate
      ? `/api/floorsheet?date=${encodeURIComponent(requestedDate)}`
      : "/api/floorsheet",
  );
  const data = floorsheetState.data;
  const currentDate = data?.date ?? null;
  const flowsState = useApi<BrokerFlowsResponse>(
    currentDate ? `/api/broker-flows?date=${encodeURIComponent(currentDate)}` : null,
  );

  const trades = useMemo<FloorsheetTrade[]>(() => data?.trades ?? [], [data]);
  const availableDates = useMemo(
    () => [...(data?.availableDates ?? [])].sort((a, b) => b.localeCompare(a)),
    [data],
  );

  const aggregate = useMemo<FloorsheetAggregate | null>(() => {
    if (!currentDate || trades.length === 0) return null;
    const result = aggregateTrades(currentDate, trades);
    // Seed the multi-day cache so window tabs do not refetch this day.
    rememberDay(currentDate, result);
    return result;
  }, [currentDate, trades]);

  const flows = flowsState.data?.date === currentDate ? flowsState.data?.flows ?? [] : [];

  const symbolOptions = useMemo(
    () =>
      aggregate
        ? [...aggregate.symbols.values()].sort((a, b) => b.amount - a.amount)
        : [],
    [aggregate],
  );
  const activeSymbol =
    pickedSymbol && aggregate?.symbols.has(pickedSymbol)
      ? pickedSymbol
      : symbolOptions[0]?.symbol ?? null;

  const pickSymbol = (symbol: string) => {
    setPickedSymbol(symbol);
    setTab("stock-broker");
  };

  const dateCount = availableDates.length;
  const oldest = availableDates.at(-1) ?? null;
  const newest = availableDates[0] ?? null;

  if (floorsheetState.loading && !data) {
    return <Spinner label="Loading the stored floorsheet (≈30k trades per day)" />;
  }

  if (floorsheetState.error) {
    return (
      <EmptyState
        title="Could not load the floorsheet"
        action={
          <button type="button" className="button" onClick={floorsheetState.reload}>
            Retry
          </button>
        }
      >
        {floorsheetState.error}
      </EmptyState>
    );
  }

  if (!data || dateCount === 0) {
    return (
      <EmptyState title="No floorsheet stored">
        <p>
          Floorsheet trades are fetched from the public floorsheet page
          automatically in the background while the app is open. The free
          source publishes only the latest trading day, so history builds up
          one trading day per update. Open the <strong>Data</strong> page to
          check status or refresh now.
        </p>
      </EmptyState>
    );
  }

  const provenance = data.provenance ?? null;

  return (
    <div className="stack">
      <div className="row-between">
        <div className="filters">
          <label>
            <span>Trading day</span>
            <select
              value={currentDate ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                if (value !== currentDate) setRequestedDate(value);
              }}
            >
              {availableDates.map((date) => (
                <option key={date} value={date}>
                  {date}
                  {date === newest ? " (latest)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button button-ghost button-small"
            style={{ marginBottom: 2 }}
            onClick={() => {
              clearFloorsheetCache();
              floorsheetState.reload();
              flowsState.reload();
            }}
          >
            Reload
          </button>
        </div>
        <div className="card-actions">
          {provenance && (
            <DataStateBadge state={provenance.state} classification={provenance.classification} />
          )}
        </div>
      </div>

      <Notice tone={dateCount < 3 ? "warn" : "info"}>
        <strong>
          {dateCount} trading day{dateCount === 1 ? "" : "s"} of floorsheet stored
        </strong>{" "}
        ({oldest === newest ? oldest : `${oldest} → ${newest}`}). The free source
        publishes only the latest trading day per fetch, so history accumulates
        one day per automatic update while the app is open on a trading day.
        Missed days cannot be back-filled from this source and are never
        interpolated.
      </Notice>

      {floorsheetState.loading ? (
        <Spinner label={`Loading ${requestedDate ?? "the latest day"}`} />
      ) : !aggregate ? (
        <EmptyState title={`No trades stored for ${currentDate ?? "this day"}`} />
      ) : (
        <>
          <div className="stats-row">
            <Stat
              label="Trading day"
              value={currentDate ?? "—"}
              badge={<Badge tone="info">EOD</Badge>}
              hint={dateCount > 1 ? `${dateCount} days stored` : "only day stored"}
            />
            <Stat
              label="Trades"
              value={aggregate.trades.toLocaleString()}
              badge={<Badge tone="warn">unverified</Badge>}
              hint={`${aggregate.symbols.size} symbols · ${aggregate.brokers.size} brokers`}
            />
            <Stat
              label="Shares traded"
              value={formatCompact(aggregate.quantity)}
              badge={<Badge tone="info">derived</Badge>}
              hint="sum of contract quantities"
            />
            <Stat
              label="Turnover"
              value={rs(aggregate.amount)}
              badge={<Badge tone="info">derived</Badge>}
              hint="sum of contract amounts"
            />
          </div>

          <Tabs<FloorsheetTab>
            label="Floorsheet views"
            value={tab}
            onChange={setTab}
            items={[
              { value: "stocks", label: "Top stocks", count: aggregate.symbols.size },
              { value: "brokers", label: "Brokers", count: aggregate.brokers.size },
              { value: "stock-broker", label: "Stock by broker" },
              { value: "bulk", label: "Bulk transactions" },
              { value: "three-day", label: "3-day top buy" },
              { value: "holding", label: "Broker holding (estimate)" },
            ]}
          />

          {tab === "stocks" && (
            <TopStocks
              aggregate={aggregate}
              date={currentDate}
              onOpenSymbol={onOpenSymbol}
              onPickSymbol={pickSymbol}
            />
          )}
          {tab === "brokers" && (
            <Brokers
              aggregate={aggregate}
              flows={flows}
              flowsLoading={flowsState.loading}
              flowsError={flowsState.error}
              date={currentDate}
              onPickSymbol={pickSymbol}
            />
          )}
          {tab === "stock-broker" && (
            <StockByBroker
              aggregate={aggregate}
              options={symbolOptions}
              symbol={activeSymbol}
              onSymbol={setPickedSymbol}
              date={currentDate}
              onOpenSymbol={onOpenSymbol}
            />
          )}
          {tab === "bulk" && (
            <BulkTransactions
              trades={trades}
              dayAmount={aggregate.amount}
              date={currentDate}
              onOpenSymbol={onOpenSymbol}
            />
          )}
          {tab === "three-day" && currentDate && (
            <ThreeDayTopBuy
              availableDates={availableDates}
              currentDate={currentDate}
              onOpenSymbol={onOpenSymbol}
              onPickSymbol={pickSymbol}
            />
          )}
          {tab === "holding" && (
            <BrokerHolding availableDates={availableDates} onOpenSymbol={onOpenSymbol} />
          )}
        </>
      )}

      <SourceLine
        source={
          provenance
            ? `${provenance.providerId} floorsheet (${provenance.sourceType})`
            : "stored floorsheet"
        }
        fetchedAt={provenance?.fetchedAt ?? null}
        asOf={provenance?.asOf ?? null}
        url={data.providerId === "free-source" ? FREE_SOURCE_URL : null}
      >
        every aggregate on this page is derived locally from stored trades
      </SourceLine>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top stocks
// ---------------------------------------------------------------------------

interface StockRow {
  symbol: string;
  trades: number;
  quantity: number;
  amount: number;
  vwap: number | null;
  high: number | null;
  low: number | null;
  share: number | null;
  buyers: number;
  sellers: number;
}

type StockKey = "symbol" | "trades" | "quantity" | "amount" | "vwap" | "share";

function TopStocks({
  aggregate,
  date,
  onOpenSymbol,
  onPickSymbol,
}: {
  aggregate: FloorsheetAggregate;
  date: string | null;
  onOpenSymbol: (symbol: string) => void;
  onPickSymbol: (symbol: string) => void;
}) {
  const [search, setSearch] = useState("");
  const rows = useMemo<StockRow[]>(
    () =>
      [...aggregate.symbols.values()].map((symbol) => {
        let buyers = 0;
        let sellers = 0;
        for (const totals of symbol.brokers.values()) {
          if (totals.buyQty > 0) buyers += 1;
          if (totals.sellQty > 0) sellers += 1;
        }
        return {
          symbol: symbol.symbol,
          trades: symbol.trades,
          quantity: symbol.quantity,
          amount: symbol.amount,
          vwap: symbol.quantity > 0 ? symbol.amount / symbol.quantity : null,
          high: Number.isFinite(symbol.high) ? symbol.high : null,
          low: Number.isFinite(symbol.low) ? symbol.low : null,
          share: aggregate.amount > 0 ? (symbol.amount / aggregate.amount) * 100 : null,
          buyers,
          sellers,
        };
      }),
    [aggregate],
  );
  const filtered = useMemo(() => {
    const needle = search.trim().toUpperCase();
    return needle ? rows.filter((row) => row.symbol.includes(needle)) : rows;
  }, [rows, search]);
  const { sorted, sort, toggle } = useSort<StockRow, StockKey>(
    filtered,
    { key: "amount", direction: "desc" },
    (row, key) => row[key],
  );
  const visible = sorted.slice(0, ROW_CAP);

  const exportRows = () =>
    downloadCsv(
      `nepse-floorsheet-stocks-${date ?? "latest"}.csv`,
      sorted.map((row) => ({
        date,
        symbol: row.symbol,
        trades: row.trades,
        quantity: row.quantity,
        amount: Math.round(row.amount * 100) / 100,
        vwap: row.vwap === null ? null : Math.round(row.vwap * 100) / 100,
        high: row.high,
        low: row.low,
        shareOfTurnoverPercent: row.share === null ? null : Math.round(row.share * 1000) / 1000,
        buyingBrokers: row.buyers,
        sellingBrokers: row.sellers,
      })),
    );

  return (
    <Card
      title="Top stocks"
      subtitle={`${date ?? ""} · trades aggregated by symbol · click a row to open the company`}
      action={
        <div className="card-actions">
          <input
            type="search"
            placeholder="Filter symbol"
            aria-label="Filter symbols"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <CsvButton onClick={exportRows} count={sorted.length} />
        </div>
      }
      footer="VWAP = Σ amount ÷ Σ quantity over the day's contracts. % of turnover is the symbol's share of the summed contract amounts. Derived from unofficial floorsheet trades."
    >
      {sorted.length === 0 ? (
        <EmptyState title="No symbol matches" />
      ) : (
        <>
          <div className="table-scroll tall">
            <table className="table">
              <thead>
                <tr>
                  <th className="rank">#</th>
                  <SortHeader label="Symbol" sortKey="symbol" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <SortHeader label="Trades" sortKey="trades" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="Quantity" sortKey="quantity" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="Amount" sortKey="amount" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="VWAP" sortKey="vwap" sort={sort} onSort={toggle} align="right" />
                  <th className="right">Low – High</th>
                  <SortHeader label="% of turnover" sortKey="share" sort={sort} onSort={toggle} align="right" />
                  <th className="right">Brokers B / S</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((row, index) => (
                  <ClickableRow key={row.symbol} onClick={() => onOpenSymbol(row.symbol)}>
                    <td className="rank">{index + 1}</td>
                    <td>
                      <strong>{row.symbol}</strong>
                    </td>
                    <td className="right">{row.trades.toLocaleString()}</td>
                    <td className="right">{formatNumber(row.quantity, 0)}</td>
                    <td className="right">{rs(row.amount)}</td>
                    <td className="right">{formatNumber(row.vwap)}</td>
                    <td className="right muted nowrap">
                      {formatNumber(row.low)} – {formatNumber(row.high)}
                    </td>
                    <td className="right">{row.share === null ? "—" : `${row.share.toFixed(2)}%`}</td>
                    <td className="right muted">
                      {row.buyers} / {row.sellers}
                    </td>
                    <td className="right">
                      <button
                        type="button"
                        className="button button-ghost button-small"
                        onClick={(event) => {
                          event.stopPropagation();
                          onPickSymbol(row.symbol);
                        }}
                      >
                        Brokers
                      </button>
                    </td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
          <CapNote shown={visible.length} total={sorted.length} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Brokers
// ---------------------------------------------------------------------------

interface BrokerRow {
  broker: string;
  buyQty: number;
  buyAmt: number;
  sellQty: number;
  sellAmt: number;
  netQty: number;
  netAmt: number;
  bought: BrokerSymbolNet[];
  sold: BrokerSymbolNet[];
}

type BrokerKey = "broker" | "buyQty" | "buyAmt" | "sellQty" | "sellAmt" | "netQty" | "netAmt";

function topSymbols(list: BrokerSymbolNet[] | undefined, n = 3) {
  if (!list) return { bought: [], sold: [] };
  return {
    bought: list.filter((item) => item.netQty > 0).slice(0, n),
    sold: list
      .filter((item) => item.netQty < 0)
      .slice(-n)
      .reverse(),
  };
}

function SymbolChips({
  items,
  onPick,
}: {
  items: BrokerSymbolNet[];
  onPick: (symbol: string) => void;
}) {
  if (items.length === 0) return <span className="muted">—</span>;
  return (
    <span className="row" style={{ gap: 4 }}>
      {items.map((item) => (
        <button
          key={item.symbol}
          type="button"
          className="toggle-chip"
          style={{ padding: "1px 7px" }}
          title={`Net ${formatNumber(item.netQty, 0)} shares · Rs ${formatCompact(item.netAmt)}`}
          onClick={(event) => {
            event.stopPropagation();
            onPick(item.symbol);
          }}
        >
          {item.symbol} {rs(Math.abs(item.netAmt)).replace("Rs ", "")}
        </button>
      ))}
    </span>
  );
}

function Brokers({
  aggregate,
  flows,
  flowsLoading,
  flowsError,
  date,
  onPickSymbol,
}: {
  aggregate: FloorsheetAggregate;
  flows: BrokerFlow[];
  flowsLoading: boolean;
  flowsError: string | null;
  date: string | null;
  onPickSymbol: (symbol: string) => void;
}) {
  const nets = useMemo(() => brokerSymbolNets(aggregate), [aggregate]);
  const fromFlows = flows.length > 0;
  const rows = useMemo<BrokerRow[]>(() => {
    const base: Array<{ broker: string; totals: SideTotals | BrokerFlow }> = fromFlows
      ? flows.map((flow) => ({ broker: String(flow.brokerId), totals: flow }))
      : [...aggregate.brokers.entries()].map(([broker, totals]) => ({ broker, totals }));
    return base.map(({ broker, totals }) => {
      const buyQty = "buyQuantity" in totals ? totals.buyQuantity : totals.buyQty;
      const buyAmt = "buyAmount" in totals ? totals.buyAmount : totals.buyAmt;
      const sellQty = "sellQuantity" in totals ? totals.sellQuantity : totals.sellQty;
      const sellAmt = "sellAmount" in totals ? totals.sellAmount : totals.sellAmt;
      const top = topSymbols(nets.get(broker));
      return {
        broker,
        buyQty,
        buyAmt,
        sellQty,
        sellAmt,
        netQty: buyQty - sellQty,
        netAmt: buyAmt - sellAmt,
        bought: top.bought,
        sold: top.sold,
      };
    });
  }, [fromFlows, flows, aggregate, nets]);

  // Cross-check the stored broker-flow totals against the trades.
  const mismatch = useMemo(() => {
    if (!fromFlows) return null;
    const flowBuy = flows.reduce((sum, flow) => sum + flow.buyAmount, 0);
    if (aggregate.amount <= 0) return null;
    const diff = Math.abs(flowBuy - aggregate.amount) / aggregate.amount;
    return diff > 0.005 ? diff * 100 : null;
  }, [fromFlows, flows, aggregate]);

  const { sorted, sort, toggle } = useSort<BrokerRow, BrokerKey>(
    rows,
    { key: "netAmt", direction: "desc" },
    (row, key) => (key === "broker" ? brokerSort(row.broker) : row[key]),
  );
  const visible = sorted.slice(0, ROW_CAP);
  const buyers = rows.filter((row) => row.netAmt > 0).length;

  const exportRows = () =>
    downloadCsv(
      `nepse-broker-flows-${date ?? "latest"}.csv`,
      sorted.map((row) => ({
        date,
        broker: row.broker,
        buyQuantity: row.buyQty,
        buyAmount: Math.round(row.buyAmt * 100) / 100,
        sellQuantity: row.sellQty,
        sellAmount: Math.round(row.sellAmt * 100) / 100,
        netQuantity: row.netQty,
        netAmount: Math.round(row.netAmt * 100) / 100,
        topBought: row.bought.map((item) => `${item.symbol}:${item.netQty}`).join(" "),
        topSold: row.sold.map((item) => `${item.symbol}:${item.netQty}`).join(" "),
        basis: fromFlows ? "stored broker-flows dataset" : "aggregated from floorsheet trades",
      })),
    );

  return (
    <Card
      title="Brokers"
      subtitle={`${rows.length} brokers on ${date ?? "—"} · ${buyers} net buyers · ${rows.length - buyers} net sellers (by amount)`}
      action={
        <div className="card-actions">
          <Badge tone={fromFlows ? "warn" : "info"}>
            {fromFlows ? "broker-flows dataset" : "aggregated from trades"}
          </Badge>
          <CsvButton onClick={exportRows} count={sorted.length} />
        </div>
      }
      footer={
        <>
          Buy/sell totals {fromFlows
            ? "come from the stored broker-flows dataset for this date"
            : flowsLoading
              ? "are aggregated from trades while the broker-flows dataset loads"
              : `are aggregated from this day's trades because no broker-flows rows are stored for ${date ?? "this date"}${flowsError ? ` (${flowsError})` : ""}`}
          . Top bought/sold symbols are always computed from the trades (net
          quantity per broker per symbol, ranked by net amount). Click a symbol
          chip to see its buyer/seller brokers.
        </>
      }
    >
      {mismatch !== null && (
        <Notice tone="warn">
          The stored broker-flows total differs from the summed trades by{" "}
          {mismatch.toFixed(2)}%. The two datasets may have been fetched at
          different times; neither is adjusted to match the other.
        </Notice>
      )}
      <div className="table-scroll tall">
        <table className="table">
          <thead>
            <tr>
              <SortHeader label="Broker" sortKey="broker" sort={sort} onSort={toggle} defaultDirection="asc" />
              <SortHeader label="Buy qty" sortKey="buyQty" sort={sort} onSort={toggle} align="right" />
              <SortHeader label="Buy amount" sortKey="buyAmt" sort={sort} onSort={toggle} align="right" />
              <SortHeader label="Sell qty" sortKey="sellQty" sort={sort} onSort={toggle} align="right" />
              <SortHeader label="Sell amount" sortKey="sellAmt" sort={sort} onSort={toggle} align="right" />
              <SortHeader label="Net qty" sortKey="netQty" sort={sort} onSort={toggle} align="right" />
              <SortHeader label="Net amount" sortKey="netAmt" sort={sort} onSort={toggle} align="right" />
              <th>Top bought (net)</th>
              <th>Top sold (net)</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.broker}>
                <td>
                  <strong className="mono">#{row.broker}</strong>
                </td>
                <td className="right">{formatNumber(row.buyQty, 0)}</td>
                <td className="right">{rs(row.buyAmt)}</td>
                <td className="right">{formatNumber(row.sellQty, 0)}</td>
                <td className="right">{rs(row.sellAmt)}</td>
                <td className="right">
                  <Signed value={row.netQty} />
                </td>
                <td className="right">
                  <Signed value={row.netAmt} money />
                </td>
                <td>
                  <SymbolChips items={row.bought} onPick={onPickSymbol} />
                </td>
                <td>
                  <SymbolChips items={row.sold} onPick={onPickSymbol} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CapNote shown={visible.length} total={sorted.length} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Stock by broker
// ---------------------------------------------------------------------------

interface SideRow {
  broker: string;
  quantity: number;
  amount: number;
  avgRate: number | null;
  share: number | null;
  trades: number;
  netQty: number;
}

type SideKey = "broker" | "quantity" | "amount" | "avgRate" | "share" | "trades" | "netQty";

function SideTable({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: SideRow[];
  tone: "up" | "down";
}) {
  const { sorted, sort, toggle } = useSort<SideRow, SideKey>(
    rows,
    { key: "quantity", direction: "desc" },
    (row, key) => (key === "broker" ? brokerSort(row.broker) : row[key]),
  );
  const visible = sorted.slice(0, ROW_CAP);
  return (
    <Card title={title} subtitle={`${rows.length} brokers`}>
      {rows.length === 0 ? (
        <EmptyState title="None" />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <SortHeader label="Broker" sortKey="broker" sort={sort} onSort={toggle} defaultDirection="asc" />
                <SortHeader label="Qty" sortKey="quantity" sort={sort} onSort={toggle} align="right" />
                <SortHeader label="Amount" sortKey="amount" sort={sort} onSort={toggle} align="right" />
                <SortHeader label="Avg rate" sortKey="avgRate" sort={sort} onSort={toggle} align="right" />
                <SortHeader label="% of qty" sortKey="share" sort={sort} onSort={toggle} align="right" />
                <SortHeader label="Trades" sortKey="trades" sort={sort} onSort={toggle} align="right" />
                <SortHeader label="Net qty" sortKey="netQty" sort={sort} onSort={toggle} align="right" title="This broker's buys minus sells in the symbol" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.broker}>
                  <td>
                    <strong className={`mono tone-${tone}`}>#{row.broker}</strong>
                  </td>
                  <td className="right">{formatNumber(row.quantity, 0)}</td>
                  <td className="right">{rs(row.amount)}</td>
                  <td className="right">{formatNumber(row.avgRate)}</td>
                  <td className="right">{row.share === null ? "—" : `${row.share.toFixed(1)}%`}</td>
                  <td className="right">{row.trades.toLocaleString()}</td>
                  <td className="right">
                    <Signed value={row.netQty} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function StockByBroker({
  aggregate,
  options,
  symbol,
  onSymbol,
  date,
  onOpenSymbol,
}: {
  aggregate: FloorsheetAggregate;
  options: Array<{ symbol: string; amount: number }>;
  symbol: string | null;
  onSymbol: (symbol: string) => void;
  date: string | null;
  onOpenSymbol: (symbol: string) => void;
}) {
  const entry = symbol ? aggregate.symbols.get(symbol) ?? null : null;
  const sides = useMemo(() => {
    if (!entry) return { buyers: [] as SideRow[], sellers: [] as SideRow[] };
    const buyers: SideRow[] = [];
    const sellers: SideRow[] = [];
    for (const [broker, totals] of entry.brokers) {
      const net = netQty(totals);
      if (totals.buyQty > 0) {
        buyers.push({
          broker,
          quantity: totals.buyQty,
          amount: totals.buyAmt,
          avgRate: totals.buyAmt / totals.buyQty,
          share: entry.quantity > 0 ? (totals.buyQty / entry.quantity) * 100 : null,
          trades: totals.buyTrades,
          netQty: net,
        });
      }
      if (totals.sellQty > 0) {
        sellers.push({
          broker,
          quantity: totals.sellQty,
          amount: totals.sellAmt,
          avgRate: totals.sellAmt / totals.sellQty,
          share: entry.quantity > 0 ? (totals.sellQty / entry.quantity) * 100 : null,
          trades: totals.sellTrades,
          netQty: net,
        });
      }
    }
    return { buyers, sellers };
  }, [entry]);

  const concentration = useMemo(() => {
    if (!entry || entry.quantity <= 0) return null;
    const top = (rows: SideRow[]) =>
      [...rows].sort((a, b) => b.quantity - a.quantity).slice(0, 5).reduce((sum, row) => sum + row.quantity, 0);
    return {
      buy: (top(sides.buyers) / entry.quantity) * 100,
      sell: (top(sides.sellers) / entry.quantity) * 100,
    };
  }, [entry, sides]);

  const exportRows = () => {
    if (!entry) return;
    downloadCsv(
      `nepse-floorsheet-${entry.symbol}-brokers-${date ?? "latest"}.csv`,
      [...entry.brokers.entries()]
        .sort((a, b) => compareBroker(a[0], b[0]))
        .map(([broker, totals]) => ({
          date,
          symbol: entry.symbol,
          broker,
          buyQuantity: totals.buyQty,
          buyAmount: Math.round(totals.buyAmt * 100) / 100,
          sellQuantity: totals.sellQty,
          sellAmount: Math.round(totals.sellAmt * 100) / 100,
          netQuantity: netQty(totals),
          netAmount: Math.round(netAmt(totals) * 100) / 100,
        })),
    );
  };

  return (
    <div className="stack">
      <Card
        title="Stock by broker"
        subtitle={`Who bought and sold one symbol on ${date ?? "—"}`}
        action={
          <div className="card-actions">
            <select
              aria-label="Symbol"
              value={symbol ?? ""}
              onChange={(event) => onSymbol(event.target.value)}
            >
              {options.map((option) => (
                <option key={option.symbol} value={option.symbol}>
                  {option.symbol} · Rs {formatCompact(option.amount)}
                </option>
              ))}
            </select>
            {entry && (
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => onOpenSymbol(entry.symbol)}
              >
                Open {entry.symbol}
              </button>
            )}
            <CsvButton onClick={exportRows} count={entry?.brokers.size ?? 0} />
          </div>
        }
        footer="Derived from unofficial floorsheet trades. Broker numbers are as published; names are not in the source. Top-5 share = quantity handled by the five largest brokers on that side ÷ total quantity."
      >
        {!entry ? (
          <EmptyState title="Pick a symbol" />
        ) : (
          <MiniStats
            items={[
              { label: "Trades", value: entry.trades.toLocaleString() },
              { label: "Quantity", value: formatNumber(entry.quantity, 0) },
              { label: "Amount", value: rs(entry.amount) },
              {
                label: "VWAP",
                value: formatNumber(entry.quantity > 0 ? entry.amount / entry.quantity : null),
                hint: `${formatNumber(Number.isFinite(entry.low) ? entry.low : null)} – ${formatNumber(Number.isFinite(entry.high) ? entry.high : null)}`,
              },
              { label: "Buying brokers", value: sides.buyers.length, hint: concentration ? `top 5: ${concentration.buy.toFixed(0)}% of qty` : undefined },
              { label: "Selling brokers", value: sides.sellers.length, hint: concentration ? `top 5: ${concentration.sell.toFixed(0)}% of qty` : undefined },
            ]}
          />
        )}
      </Card>
      {entry && (
        <div className="grid two">
          <SideTable key={`b-${entry.symbol}`} title="Buyer brokers" rows={sides.buyers} tone="up" />
          <SideTable key={`s-${entry.symbol}`} title="Seller brokers" rows={sides.sellers} tone="down" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk transactions
// ---------------------------------------------------------------------------

type TradeKey = "symbol" | "quantity" | "rate" | "amount" | "buyerBroker" | "sellerBroker";

function BulkTransactions({
  trades,
  dayAmount,
  date,
  onOpenSymbol,
}: {
  trades: FloorsheetTrade[];
  dayAmount: number;
  date: string | null;
  onOpenSymbol: (symbol: string) => void;
}) {
  const [amountCrore, setAmountCrore] = useState("1");
  const [minQty, setMinQty] = useState("10000");
  const [useAmount, setUseAmount] = useState(true);
  const [useQty, setUseQty] = useState(true);
  const [search, setSearch] = useState("");

  const amountFloor = Number(amountCrore) * CRORE;
  const qtyFloor = Number(minQty);
  const amountOk = useAmount && amountCrore.trim() !== "" && Number.isFinite(amountFloor) && amountFloor >= 0;
  const qtyOk = useQty && minQty.trim() !== "" && Number.isFinite(qtyFloor) && qtyFloor >= 0;

  const filtered = useMemo(() => {
    if (!amountOk && !qtyOk) return [];
    const needle = search.trim().toUpperCase();
    return trades.filter((trade) => {
      if (needle && !trade.symbol.includes(needle)) return false;
      return (amountOk && trade.amount >= amountFloor) || (qtyOk && trade.quantity >= qtyFloor);
    });
  }, [trades, amountOk, qtyOk, amountFloor, qtyFloor, search]);

  const { sorted, sort, toggle } = useSort<FloorsheetTrade, TradeKey>(
    filtered,
    { key: "amount", direction: "desc" },
    (trade, key) =>
      key === "buyerBroker" || key === "sellerBroker" ? brokerSort(trade[key]) : trade[key],
  );
  const visible = sorted.slice(0, ROW_CAP);
  const total = filtered.reduce((sum, trade) => sum + trade.amount, 0);
  const symbols = new Set(filtered.map((trade) => trade.symbol)).size;

  const exportRows = () =>
    downloadCsv(
      `nepse-bulk-trades-${date ?? "latest"}.csv`,
      sorted.map((trade) => ({
        date: trade.businessDate,
        contractId: trade.contractId,
        symbol: trade.symbol,
        buyerBroker: trade.buyerBroker,
        sellerBroker: trade.sellerBroker,
        quantity: trade.quantity,
        rate: trade.rate,
        amount: trade.amount,
        matchedAmountRule: amountOk && trade.amount >= amountFloor,
        matchedQuantityRule: qtyOk && trade.quantity >= qtyFloor,
      })),
    );

  return (
    <Card
      title="Bulk transactions"
      subtitle={`${filtered.length.toLocaleString()} contracts on ${date ?? "—"} · ${symbols} symbols · ${rs(total)}${dayAmount > 0 ? ` (${((total / dayAmount) * 100).toFixed(1)}% of turnover)` : ""}`}
      action={<CsvButton onClick={exportRows} count={sorted.length} />}
      footer="A contract is listed when it meets any ticked rule. 1 crore = Rs 10,000,000. Single contracts as printed in the floorsheet; a large order filled in pieces will not show here."
    >
      <div className="filters" style={{ marginBottom: 12 }}>
        <label className="checkbox">
          <input type="checkbox" checked={useAmount} onChange={(event) => setUseAmount(event.target.checked)} />
          <span>Amount ≥</span>
        </label>
        <label>
          <span>Rs crore</span>
          <input
            value={amountCrore}
            inputMode="decimal"
            disabled={!useAmount}
            onChange={(event) => setAmountCrore(event.target.value)}
          />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={useQty} onChange={(event) => setUseQty(event.target.checked)} />
          <span>Quantity ≥</span>
        </label>
        <label>
          <span>Units</span>
          <input
            value={minQty}
            inputMode="numeric"
            disabled={!useQty}
            onChange={(event) => setMinQty(event.target.value)}
          />
        </label>
        <label>
          <span>Symbol</span>
          <input value={search} placeholder="All" onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>
      {!amountOk && !qtyOk ? (
        <EmptyState title="Tick at least one rule with a valid number" />
      ) : sorted.length === 0 ? (
        <EmptyState title="No contract meets these thresholds" />
      ) : (
        <>
          <div className="table-scroll tall">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Symbol" sortKey="symbol" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <SortHeader label="Buyer" sortKey="buyerBroker" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <SortHeader label="Seller" sortKey="sellerBroker" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <SortHeader label="Quantity" sortKey="quantity" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="Rate" sortKey="rate" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="Amount" sortKey="amount" sort={sort} onSort={toggle} align="right" />
                  <th>Contract</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((trade) => (
                  <ClickableRow key={trade.contractId} onClick={() => onOpenSymbol(trade.symbol)}>
                    <td>
                      <strong>{trade.symbol}</strong>
                    </td>
                    <td className="mono">#{trade.buyerBroker}</td>
                    <td className="mono">#{trade.sellerBroker}</td>
                    <td className="right">{formatNumber(trade.quantity, 0)}</td>
                    <td className="right">{formatNumber(trade.rate)}</td>
                    <td className="right">{rs(trade.amount)}</td>
                    <td className="muted mono small">{trade.contractId}</td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
          <CapNote shown={visible.length} total={sorted.length} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Multi-day views
// ---------------------------------------------------------------------------

function WindowProgress({ loaded, total }: { loaded: number; total: number }) {
  return (
    <div className="stack-sm">
      <Spinner label={`Loading stored floorsheet days ${loaded} of ${total}`} />
      <p className="muted small">
        Loading stored days: {loaded} of {total} (each day is fetched, reduced
        to per-broker totals and discarded).
      </p>
    </div>
  );
}

type AccumulationKey =
  | "symbol"
  | "amount"
  | "topBuyNetAmt"
  | "topSellNetAmt"
  | "accumulationAmt"
  | "accumulationPercent";

interface BrokerWindowRow {
  broker: string;
  buyAmt: number;
  sellAmt: number;
  netAmt: number;
  netQty: number;
  bought: BrokerSymbolNet[];
}

type BrokerWindowKey = "broker" | "buyAmt" | "sellAmt" | "netAmt" | "netQty";

function ThreeDayTopBuy({
  availableDates,
  currentDate,
  onOpenSymbol,
  onPickSymbol,
}: {
  availableDates: string[];
  currentDate: string;
  onOpenSymbol: (symbol: string) => void;
  onPickSymbol: (symbol: string) => void;
}) {
  const windowDates = useMemo(
    () =>
      availableDates
        .filter((date) => date <= currentDate)
        .slice(0, 3)
        .sort(),
    [availableDates, currentDate],
  );
  const state = useFloorsheetWindow(windowDates);
  const [direction, setDirection] = useState<"accumulation" | "distribution">("accumulation");

  const accumulationRows = useMemo<Accumulation[]>(
    () => (state.aggregate ? accumulation(state.aggregate, 5) : []),
    [state.aggregate],
  );
  const directed = useMemo(
    () =>
      accumulationRows.filter((row) =>
        direction === "accumulation" ? row.accumulationAmt > 0 : row.accumulationAmt < 0,
      ),
    [accumulationRows, direction],
  );
  const accSort = useSort<Accumulation, AccumulationKey>(
    directed,
    { key: "accumulationAmt", direction: direction === "accumulation" ? "desc" : "asc" },
    (row, key) => (key === "symbol" ? row.symbol : row[key]),
  );

  const brokerRows = useMemo<BrokerWindowRow[]>(() => {
    if (!state.aggregate) return [];
    const nets = brokerSymbolNets(state.aggregate);
    return [...state.aggregate.brokers.entries()].map(([broker, totals]) => ({
      broker,
      buyAmt: totals.buyAmt,
      sellAmt: totals.sellAmt,
      netAmt: netAmt(totals),
      netQty: netQty(totals),
      bought: topSymbols(nets.get(broker)).bought,
    }));
  }, [state.aggregate]);
  const brokerSortState = useSort<BrokerWindowRow, BrokerWindowKey>(
    brokerRows,
    { key: "netAmt", direction: "desc" },
    (row, key) => (key === "broker" ? brokerSort(row.broker) : row[key]),
  );

  const used = windowDates.length;
  const label = `${used} stored day${used === 1 ? "" : "s"} (${windowDates.join(", ")})`;

  const exportSymbols = () =>
    downloadCsv(
      `nepse-${used}day-accumulation-${currentDate}.csv`,
      accumulationRows
        .sort((a, b) => b.accumulationAmt - a.accumulationAmt)
        .map((row) => ({
          window: windowDates.join(" "),
          symbol: row.symbol,
          quantity: row.quantity,
          amount: Math.round(row.amount),
          vwap: row.vwap === null ? null : Math.round(row.vwap * 100) / 100,
          top5BuyNetQty: row.topBuyNetQty,
          top5BuyNetAmount: Math.round(row.topBuyNetAmt),
          top5SellNetQty: row.topSellNetQty,
          top5SellNetAmount: Math.round(row.topSellNetAmt),
          accumulationQty: row.accumulationQty,
          accumulationAmount: Math.round(row.accumulationAmt),
          accumulationPercentOfQty:
            row.accumulationPercent === null ? null : Math.round(row.accumulationPercent * 100) / 100,
          topBuyer: row.topBuyer,
          topSeller: row.topSeller,
        })),
    );
  const exportBrokers = () =>
    downloadCsv(
      `nepse-${used}day-broker-net-${currentDate}.csv`,
      brokerSortState.sorted.map((row) => ({
        window: windowDates.join(" "),
        broker: row.broker,
        buyAmount: Math.round(row.buyAmt),
        sellAmount: Math.round(row.sellAmt),
        netAmount: Math.round(row.netAmt),
        netQuantity: row.netQty,
        topBought: row.bought.map((item) => `${item.symbol}:${item.netQty}`).join(" "),
      })),
    );

  return (
    <div className="stack">
      <Notice tone={used < 3 ? "warn" : "info"}>
        {used < 3 ? (
          <>
            <strong>Only {used} stored trading day{used === 1 ? "" : "s"}</strong> up to{" "}
            {currentDate}. This window uses {label}, not 3 days. Each automatic
            update while the app is open adds the latest trading day to the
            history.
          </>
        ) : (
          <>Window: {label}.</>
        )}{" "}
        <strong>Net accumulation</strong> = net amount bought by the 5 brokers
        with the largest net buy in the symbol minus net amount sold by the 5
        largest net sellers. Every trade has a buyer and a seller, so the
        market-wide net is always zero; a positive value means buying was more
        concentrated than selling. It is a description of order flow, not
        evidence of who owns the shares.
      </Notice>
      {state.loading ? (
        <WindowProgress loaded={state.loaded} total={state.total} />
      ) : state.errors.length > 0 && !state.aggregate ? (
        <EmptyState title="Could not load the window">{state.errors.join("; ")}</EmptyState>
      ) : (
        <>
          {state.errors.length > 0 && (
            <Notice tone="error">Some days failed to load and are left out: {state.errors.join("; ")}</Notice>
          )}
          <div className="grid main-side">
            <Card
              title={`Top symbols by net ${direction}`}
              subtitle={`${directed.length} symbols · ${label}`}
              action={
                <div className="card-actions">
                  <Segmented<"accumulation" | "distribution">
                    label="Direction"
                    value={direction}
                    onChange={setDirection}
                    items={[
                      { value: "accumulation", label: "Accumulation" },
                      { value: "distribution", label: "Distribution" },
                    ]}
                  />
                  <CsvButton onClick={exportSymbols} count={accumulationRows.length} />
                </div>
              }
            >
              {directed.length === 0 ? (
                <EmptyState title="No symbol in this direction" />
              ) : (
                <div className="table-scroll tall">
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="rank">#</th>
                        <SortHeader label="Symbol" sortKey="symbol" sort={accSort.sort} onSort={accSort.toggle} defaultDirection="asc" />
                        <SortHeader label="Net accum." sortKey="accumulationAmt" sort={accSort.sort} onSort={accSort.toggle} align="right" />
                        <SortHeader label="% of qty" sortKey="accumulationPercent" sort={accSort.sort} onSort={accSort.toggle} align="right" title="Net accumulation quantity ÷ total traded quantity in the window" />
                        <SortHeader label="Top-5 buy" sortKey="topBuyNetAmt" sort={accSort.sort} onSort={accSort.toggle} align="right" />
                        <SortHeader label="Top-5 sell" sortKey="topSellNetAmt" sort={accSort.sort} onSort={accSort.toggle} align="right" />
                        <SortHeader label="Turnover" sortKey="amount" sort={accSort.sort} onSort={accSort.toggle} align="right" />
                        <th>Top buyer / seller</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accSort.sorted.slice(0, 50).map((row, index) => (
                        <ClickableRow key={row.symbol} onClick={() => onOpenSymbol(row.symbol)}>
                          <td className="rank">{index + 1}</td>
                          <td>
                            <strong>{row.symbol}</strong>
                            <span className="cell-sub">
                              {row.brokersBuying} net buyers · {row.brokersSelling} net sellers
                            </span>
                          </td>
                          <td className="right">
                            <Signed value={row.accumulationAmt} money />
                          </td>
                          <td className="right">
                            {row.accumulationPercent === null ? "—" : `${row.accumulationPercent.toFixed(1)}%`}
                          </td>
                          <td className="right tone-up">{rs(row.topBuyNetAmt)}</td>
                          <td className="right tone-down">{rs(row.topSellNetAmt)}</td>
                          <td className="right">{rs(row.amount)}</td>
                          <td className="mono nowrap">
                            <button
                              type="button"
                              className="button button-ghost button-small"
                              onClick={(event) => {
                                event.stopPropagation();
                                onPickSymbol(row.symbol);
                              }}
                              title={currentDate === windowDates.at(-1) ? `Brokers in ${row.symbol} on ${currentDate}` : undefined}
                            >
                              #{row.topBuyer ?? "—"} / #{row.topSeller ?? "—"}
                            </button>
                          </td>
                        </ClickableRow>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <CapNote shown={Math.min(50, directed.length)} total={directed.length} />
            </Card>
            <Card
              title="Top brokers by net buy"
              subtitle={label}
              action={<CsvButton onClick={exportBrokers} count={brokerRows.length} />}
            >
              {brokerRows.length === 0 ? (
                <EmptyState title="No broker activity" />
              ) : (
                <div className="table-scroll tall">
                  <table className="table">
                    <thead>
                      <tr>
                        <SortHeader label="Broker" sortKey="broker" sort={brokerSortState.sort} onSort={brokerSortState.toggle} defaultDirection="asc" />
                        <SortHeader label="Net" sortKey="netAmt" sort={brokerSortState.sort} onSort={brokerSortState.toggle} align="right" />
                        <SortHeader label="Bought" sortKey="buyAmt" sort={brokerSortState.sort} onSort={brokerSortState.toggle} align="right" />
                        <th>Top net buys</th>
                      </tr>
                    </thead>
                    <tbody>
                      {brokerSortState.sorted.slice(0, ROW_CAP).map((row) => (
                        <tr key={row.broker}>
                          <td>
                            <strong className="mono">#{row.broker}</strong>
                          </td>
                          <td className="right nowrap">
                            <Signed value={row.netAmt} money />
                          </td>
                          <td className="right nowrap">{rs(row.buyAmt)}</td>
                          <td>
                            <SymbolChips items={row.bought} onPick={onOpenSymbol} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

interface HoldingRow {
  key: string;
  buyQty: number;
  sellQty: number;
  netQty: number;
  netAmt: number;
  avgBuy: number | null;
  avgSell: number | null;
}

type HoldingKey = "key" | "buyQty" | "sellQty" | "netQty" | "netAmt" | "avgBuy" | "avgSell";

function BrokerHolding({
  availableDates,
  onOpenSymbol,
}: {
  availableDates: string[];
  onOpenSymbol: (symbol: string) => void;
}) {
  const total = availableDates.length;
  const [started, setStarted] = useState(total <= 5);
  const windowDates = useMemo(() => [...availableDates].sort(), [availableDates]);
  const state = useFloorsheetWindow(started ? windowDates : null);
  const [view, setView] = useState<"symbol" | "broker">("symbol");
  const [pickedSymbol, setPickedSymbol] = useState<string | null>(null);
  const [pickedBroker, setPickedBroker] = useState<string | null>(null);

  const aggregate = state.aggregate;
  const symbolOptions = useMemo(
    () => (aggregate ? [...aggregate.symbols.values()].sort((a, b) => b.amount - a.amount) : []),
    [aggregate],
  );
  const brokerOptions = useMemo(
    () => (aggregate ? [...aggregate.brokers.keys()].sort(compareBroker) : []),
    [aggregate],
  );
  const symbol =
    pickedSymbol && aggregate?.symbols.has(pickedSymbol) ? pickedSymbol : symbolOptions[0]?.symbol ?? null;
  const broker =
    pickedBroker && aggregate?.brokers.has(pickedBroker) ? pickedBroker : brokerOptions[0] ?? null;

  const rows = useMemo<HoldingRow[]>(() => {
    if (!aggregate) return [];
    const toRow = (key: string, totals: SideTotals): HoldingRow => ({
      key,
      buyQty: totals.buyQty,
      sellQty: totals.sellQty,
      netQty: netQty(totals),
      netAmt: netAmt(totals),
      avgBuy: totals.buyQty > 0 ? totals.buyAmt / totals.buyQty : null,
      avgSell: totals.sellQty > 0 ? totals.sellAmt / totals.sellQty : null,
    });
    if (view === "symbol") {
      const entry = symbol ? aggregate.symbols.get(symbol) : undefined;
      return entry ? [...entry.brokers.entries()].map(([key, totals]) => toRow(key, totals)) : [];
    }
    const out: HoldingRow[] = [];
    if (!broker) return out;
    for (const entry of aggregate.symbols.values()) {
      const totals = entry.brokers.get(broker);
      if (totals) out.push(toRow(entry.symbol, totals));
    }
    return out;
  }, [aggregate, view, symbol, broker]);

  const { sorted, sort, toggle } = useSort<HoldingRow, HoldingKey>(
    rows,
    { key: "netQty", direction: "desc" },
    (row, key) => (key === "key" ? (view === "symbol" ? brokerSort(row.key) : row.key) : row[key]),
  );
  const visible = sorted.slice(0, ROW_CAP);
  const days = aggregate?.dates.length ?? 0;
  const disclaimer = `Net flow over ${days || total} stored day${(days || total) === 1 ? "" : "s"}, NOT actual holdings. Actual broker/CDS holdings are not published.`;

  const exportMatrix = () => {
    if (!aggregate) return;
    const out: Array<Record<string, unknown>> = [];
    for (const entry of aggregate.symbols.values()) {
      for (const [brokerId, totals] of entry.brokers) {
        const net = netQty(totals);
        if (net === 0) continue;
        out.push({
          symbol: entry.symbol,
          broker: brokerId,
          cumulativeNetQuantity: net,
          cumulativeNetAmount: Math.round(netAmt(totals)),
          buyQuantity: totals.buyQty,
          sellQuantity: totals.sellQty,
          storedDays: aggregate.dates.length,
          from: aggregate.dates[0],
          to: aggregate.dates.at(-1),
          note: "net flow over stored days, NOT actual holdings",
        });
      }
    }
    out.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)) || Number(b.cumulativeNetQuantity) - Number(a.cumulativeNetQuantity));
    downloadCsv(`nepse-broker-net-flow-${aggregate.dates[0]}-${aggregate.dates.at(-1)}.csv`, out);
  };

  return (
    <div className="stack">
      <Notice tone="warn">
        <strong>{disclaimer}</strong> Each figure is the cumulative buy minus
        sell quantity a broker printed in the stored floorsheets. It starts from
        zero on the first stored day, ignores everything before it, and cannot
        see transfers, pledges, IPO/right allotments or which client a broker
        acted for.
      </Notice>
      {!started ? (
        <EmptyState
          title={`${total} stored days to scan`}
          action={
            <button type="button" className="button" onClick={() => setStarted(true)}>
              Compute over {total} stored days
            </button>
          }
        >
          Each stored day (~30k trades) is fetched and reduced in turn. This can
          take a while for long histories.
        </EmptyState>
      ) : state.loading ? (
        <WindowProgress loaded={state.loaded} total={state.total} />
      ) : !aggregate ? (
        <EmptyState title="Could not compute">{state.errors.join("; ") || "No stored days."}</EmptyState>
      ) : (
        <Card
          title="Broker holding (estimate)"
          subtitle={`Net flow ${aggregate.dates[0]} → ${aggregate.dates.at(-1)} · ${days} stored day${days === 1 ? "" : "s"}`}
          action={
            <div className="card-actions">
              <Segmented<"symbol" | "broker">
                label="Pivot"
                value={view}
                onChange={setView}
                items={[
                  { value: "symbol", label: "By symbol" },
                  { value: "broker", label: "By broker" },
                ]}
              />
              {view === "symbol" ? (
                <select aria-label="Symbol" value={symbol ?? ""} onChange={(event) => setPickedSymbol(event.target.value)}>
                  {symbolOptions.map((option) => (
                    <option key={option.symbol} value={option.symbol}>
                      {option.symbol}
                    </option>
                  ))}
                </select>
              ) : (
                <select aria-label="Broker" value={broker ?? ""} onChange={(event) => setPickedBroker(event.target.value)}>
                  {brokerOptions.map((option) => (
                    <option key={option} value={option}>
                      Broker #{option}
                    </option>
                  ))}
                </select>
              )}
              <Badge tone="info">derived</Badge>
              <button type="button" className="button button-ghost button-small" onClick={exportMatrix}>
                <Icon.Download /> Full matrix CSV
              </button>
            </div>
          }
          footer={disclaimer}
        >
          {state.errors.length > 0 && (
            <Notice tone="error">Some days failed to load and are left out: {state.errors.join("; ")}</Notice>
          )}
          {sorted.length === 0 ? (
            <EmptyState title="No activity for this selection" />
          ) : (
            <>
              <div className="table-scroll tall">
                <table className="table">
                  <thead>
                    <tr>
                      <SortHeader
                        label={view === "symbol" ? "Broker" : "Symbol"}
                        sortKey="key"
                        sort={sort}
                        onSort={toggle}
                        defaultDirection="asc"
                      />
                      <SortHeader label="Net qty (flow)" sortKey="netQty" sort={sort} onSort={toggle} align="right" />
                      <SortHeader label="Net amount" sortKey="netAmt" sort={sort} onSort={toggle} align="right" />
                      <SortHeader label="Bought" sortKey="buyQty" sort={sort} onSort={toggle} align="right" />
                      <SortHeader label="Sold" sortKey="sellQty" sort={sort} onSort={toggle} align="right" />
                      <SortHeader label="Avg buy" sortKey="avgBuy" sort={sort} onSort={toggle} align="right" />
                      <SortHeader label="Avg sell" sortKey="avgSell" sort={sort} onSort={toggle} align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) =>
                      view === "broker" ? (
                        <ClickableRow key={row.key} onClick={() => onOpenSymbol(row.key)}>
                          <td>
                            <strong>{row.key}</strong>
                          </td>
                          <HoldingCells row={row} />
                        </ClickableRow>
                      ) : (
                        <tr key={row.key}>
                          <td>
                            <strong className="mono">#{row.key}</strong>
                          </td>
                          <HoldingCells row={row} />
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              <CapNote shown={visible.length} total={sorted.length} />
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function HoldingCells({ row }: { row: HoldingRow }) {
  return (
    <>
      <td className="right">
        <Signed value={row.netQty} />
      </td>
      <td className="right">
        <Signed value={row.netAmt} money />
      </td>
      <td className="right">{formatNumber(row.buyQty, 0)}</td>
      <td className="right">{formatNumber(row.sellQty, 0)}</td>
      <td className="right">{formatNumber(row.avgBuy)}</td>
      <td className="right">{formatNumber(row.avgSell)}</td>
    </>
  );
}

/**
 * Floorsheet aggregation. Every value here is DERIVED from stored, unofficial
 * floorsheet trades; nothing is fetched from a separate broker dataset except
 * where a page explicitly says so.
 *
 * A day of NEPSE floorsheet is ~30k trades, so aggregation runs once per
 * trade array (memoise on the array) and multi-day views reduce each day to
 * these compact maps before discarding the raw trades.
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import type { FloorsheetResponse, FloorsheetTrade } from "../types";

export interface SideTotals {
  buyQty: number;
  buyAmt: number;
  sellQty: number;
  sellAmt: number;
  buyTrades: number;
  sellTrades: number;
}

export interface SymbolAggregate {
  symbol: string;
  trades: number;
  quantity: number;
  amount: number;
  high: number;
  low: number;
  brokers: Map<string, SideTotals>;
}

export interface FloorsheetAggregate {
  /** Business dates included, oldest first. */
  dates: string[];
  trades: number;
  quantity: number;
  amount: number;
  symbols: Map<string, SymbolAggregate>;
  brokers: Map<string, SideTotals>;
}

export function emptySide(): SideTotals {
  return { buyQty: 0, buyAmt: 0, sellQty: 0, sellAmt: 0, buyTrades: 0, sellTrades: 0 };
}

function side(map: Map<string, SideTotals>, key: string): SideTotals {
  let entry = map.get(key);
  if (!entry) {
    entry = emptySide();
    map.set(key, entry);
  }
  return entry;
}

function addSide(target: SideTotals, source: SideTotals): void {
  target.buyQty += source.buyQty;
  target.buyAmt += source.buyAmt;
  target.sellQty += source.sellQty;
  target.sellAmt += source.sellAmt;
  target.buyTrades += source.buyTrades;
  target.sellTrades += source.sellTrades;
}

export function emptyAggregate(): FloorsheetAggregate {
  return { dates: [], trades: 0, quantity: 0, amount: 0, symbols: new Map(), brokers: new Map() };
}

/** One pass over a day's trades. */
export function aggregateTrades(
  date: string | null,
  trades: readonly FloorsheetTrade[],
): FloorsheetAggregate {
  const result = emptyAggregate();
  if (date) result.dates.push(date);
  for (const trade of trades) {
    const quantity = Number(trade.quantity);
    const amount = Number(trade.amount);
    const rate = Number(trade.rate);
    if (!Number.isFinite(quantity) || !Number.isFinite(amount)) continue;
    result.trades += 1;
    result.quantity += quantity;
    result.amount += amount;

    let symbol = result.symbols.get(trade.symbol);
    if (!symbol) {
      symbol = {
        symbol: trade.symbol,
        trades: 0,
        quantity: 0,
        amount: 0,
        high: -Infinity,
        low: Infinity,
        brokers: new Map(),
      };
      result.symbols.set(trade.symbol, symbol);
    }
    symbol.trades += 1;
    symbol.quantity += quantity;
    symbol.amount += amount;
    if (Number.isFinite(rate)) {
      if (rate > symbol.high) symbol.high = rate;
      if (rate < symbol.low) symbol.low = rate;
    }

    const buyer = String(trade.buyerBroker);
    const seller = String(trade.sellerBroker);
    const buyerSymbol = side(symbol.brokers, buyer);
    buyerSymbol.buyQty += quantity;
    buyerSymbol.buyAmt += amount;
    buyerSymbol.buyTrades += 1;
    const sellerSymbol = side(symbol.brokers, seller);
    sellerSymbol.sellQty += quantity;
    sellerSymbol.sellAmt += amount;
    sellerSymbol.sellTrades += 1;

    const buyerTotal = side(result.brokers, buyer);
    buyerTotal.buyQty += quantity;
    buyerTotal.buyAmt += amount;
    buyerTotal.buyTrades += 1;
    const sellerTotal = side(result.brokers, seller);
    sellerTotal.sellQty += quantity;
    sellerTotal.sellAmt += amount;
    sellerTotal.sellTrades += 1;
  }
  return result;
}

/** Adds `source` into `target` in place (used for multi-day windows). */
export function mergeInto(
  target: FloorsheetAggregate,
  source: FloorsheetAggregate,
): FloorsheetAggregate {
  for (const date of source.dates) {
    if (!target.dates.includes(date)) target.dates.push(date);
  }
  target.dates.sort();
  target.trades += source.trades;
  target.quantity += source.quantity;
  target.amount += source.amount;
  for (const [key, totals] of source.brokers) addSide(side(target.brokers, key), totals);
  for (const [key, symbol] of source.symbols) {
    let into = target.symbols.get(key);
    if (!into) {
      into = {
        symbol: key,
        trades: 0,
        quantity: 0,
        amount: 0,
        high: -Infinity,
        low: Infinity,
        brokers: new Map(),
      };
      target.symbols.set(key, into);
    }
    into.trades += symbol.trades;
    into.quantity += symbol.quantity;
    into.amount += symbol.amount;
    into.high = Math.max(into.high, symbol.high);
    into.low = Math.min(into.low, symbol.low);
    for (const [broker, totals] of symbol.brokers) addSide(side(into.brokers, broker), totals);
  }
  return target;
}

export function netQty(totals: SideTotals): number {
  return totals.buyQty - totals.sellQty;
}

export function netAmt(totals: SideTotals): number {
  return totals.buyAmt - totals.sellAmt;
}

/** Numeric-aware broker id comparison ("2" < "10"). */
export function compareBroker(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

export interface BrokerSymbolNet {
  symbol: string;
  netQty: number;
  netAmt: number;
}

/** Per broker: symbols sorted by net amount (bought first, sold last). */
export function brokerSymbolNets(
  aggregate: FloorsheetAggregate,
): Map<string, BrokerSymbolNet[]> {
  const map = new Map<string, BrokerSymbolNet[]>();
  for (const symbol of aggregate.symbols.values()) {
    for (const [broker, totals] of symbol.brokers) {
      const net = netQty(totals);
      if (net === 0) continue;
      let list = map.get(broker);
      if (!list) {
        list = [];
        map.set(broker, list);
      }
      list.push({ symbol: symbol.symbol, netQty: net, netAmt: netAmt(totals) });
    }
  }
  for (const list of map.values()) list.sort((a, b) => b.netAmt - a.netAmt);
  return map;
}

export interface Accumulation {
  symbol: string;
  quantity: number;
  amount: number;
  vwap: number | null;
  /** Net amount bought by the N brokers with the largest net buy. */
  topBuyNetAmt: number;
  topBuyNetQty: number;
  /** Net amount sold by the N brokers with the largest net sell (positive). */
  topSellNetAmt: number;
  topSellNetQty: number;
  /** topBuyNetAmt − topSellNetAmt. Positive = buying more concentrated than selling. */
  accumulationAmt: number;
  accumulationQty: number;
  /** accumulationQty as % of total traded quantity in the window. */
  accumulationPercent: number | null;
  topBuyer: string | null;
  topSeller: string | null;
  brokersBuying: number;
  brokersSelling: number;
}

/**
 * Broker concentration per symbol. Every trade has a buyer and a seller, so
 * the market-wide net per symbol is always zero; the only meaningful "net
 * accumulation" is how concentrated the net buying is versus the net selling.
 */
export function accumulation(
  aggregate: FloorsheetAggregate,
  top = 5,
): Accumulation[] {
  const out: Accumulation[] = [];
  for (const symbol of aggregate.symbols.values()) {
    const nets = [...symbol.brokers.entries()].map(([broker, totals]) => ({
      broker,
      qty: netQty(totals),
      amt: netAmt(totals),
    }));
    const buyers = nets.filter((item) => item.qty > 0).sort((a, b) => b.qty - a.qty);
    const sellers = nets.filter((item) => item.qty < 0).sort((a, b) => a.qty - b.qty);
    const topBuyers = buyers.slice(0, top);
    const topSellers = sellers.slice(0, top);
    const topBuyNetQty = topBuyers.reduce((sum, item) => sum + item.qty, 0);
    const topBuyNetAmt = topBuyers.reduce((sum, item) => sum + Math.max(0, item.amt), 0);
    const topSellNetQty = -topSellers.reduce((sum, item) => sum + item.qty, 0);
    const topSellNetAmt = -topSellers.reduce((sum, item) => sum + Math.min(0, item.amt), 0);
    const accumulationQty = topBuyNetQty - topSellNetQty;
    out.push({
      symbol: symbol.symbol,
      quantity: symbol.quantity,
      amount: symbol.amount,
      vwap: symbol.quantity > 0 ? symbol.amount / symbol.quantity : null,
      topBuyNetAmt,
      topBuyNetQty,
      topSellNetAmt,
      topSellNetQty,
      accumulationAmt: topBuyNetAmt - topSellNetAmt,
      accumulationQty,
      accumulationPercent:
        symbol.quantity > 0 ? (accumulationQty / symbol.quantity) * 100 : null,
      topBuyer: topBuyers[0]?.broker ?? null,
      topSeller: topSellers[0]?.broker ?? null,
      brokersBuying: buyers.length,
      brokersSelling: sellers.length,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Multi-day loading
// ---------------------------------------------------------------------------

/** Small per-day cache so switching tabs/dates does not refetch ~6 MB days. */
const DAY_CACHE_LIMIT = 6;
const dayCache = new Map<string, FloorsheetAggregate>();

export function rememberDay(date: string, aggregate: FloorsheetAggregate): void {
  if (dayCache.has(date)) return;
  dayCache.set(date, aggregate);
  while (dayCache.size > DAY_CACHE_LIMIT) {
    const oldest = dayCache.keys().next().value;
    if (oldest === undefined) break;
    dayCache.delete(oldest);
  }
}

export function clearFloorsheetCache(): void {
  dayCache.clear();
  windowCache.clear();
}

async function loadDay(date: string): Promise<FloorsheetAggregate> {
  const cached = dayCache.get(date);
  if (cached) return cached;
  const response = await api<FloorsheetResponse>(
    `/api/floorsheet?date=${encodeURIComponent(date)}`,
  );
  const aggregate = aggregateTrades(response.date ?? date, response.trades ?? []);
  rememberDay(date, aggregate);
  return aggregate;
}

/** Combined windows (e.g. all stored days) cached by their date list. */
const windowCache = new Map<string, FloorsheetAggregate>();

export interface WindowState {
  aggregate: FloorsheetAggregate | null;
  loaded: number;
  total: number;
  loading: boolean;
  errors: string[];
}

/**
 * Loads each date's floorsheet in turn, folds it into one aggregate and drops
 * the raw trades. Pass `null` to stay idle.
 */
export function useFloorsheetWindow(dates: readonly string[] | null): WindowState {
  const key = dates ? dates.join(",") : null;
  const [state, setState] = useState<WindowState>({
    aggregate: null,
    loaded: 0,
    total: 0,
    loading: false,
    errors: [],
  });

  useEffect(() => {
    if (!key) {
      setState({ aggregate: null, loaded: 0, total: 0, loading: false, errors: [] });
      return;
    }
    const list = key.split(",");
    const cached = windowCache.get(key);
    if (cached) {
      setState({ aggregate: cached, loaded: list.length, total: list.length, loading: false, errors: [] });
      return;
    }
    let cancelled = false;
    setState({ aggregate: null, loaded: 0, total: list.length, loading: true, errors: [] });
    (async () => {
      const combined = emptyAggregate();
      const errors: string[] = [];
      let loaded = 0;
      for (const date of list) {
        if (cancelled) return;
        try {
          const day = await loadDay(date);
          mergeInto(combined, day);
        } catch (error) {
          errors.push(`${date}: ${error instanceof Error ? error.message : String(error)}`);
        }
        loaded += 1;
        if (!cancelled) {
          setState((current) => ({ ...current, loaded, errors: [...errors] }));
        }
      }
      if (cancelled) return;
      if (errors.length === 0) {
        windowCache.set(key, combined);
        while (windowCache.size > 3) {
          const oldest = windowCache.keys().next().value;
          if (oldest === undefined) break;
          windowCache.delete(oldest);
        }
      }
      setState({ aggregate: combined, loaded, total: list.length, loading: false, errors });
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}

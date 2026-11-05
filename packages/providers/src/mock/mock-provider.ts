import {
  BaseProvider,
  type BrokerFlow,
  type Candle,
  type Company,
  type CorporateAction,
  type DataEnvelope,
  type DateRange,
  type FloorsheetTrade,
  type FundamentalsSnapshot,
  type Ipo,
  type MarketIndex,
  type MarketSummary,
  type NewsItem,
  type ProviderDescriptor,
  type ProviderHealth,
  type Quote,
  type Sector,
  type SectorPerformance,
  type Security,
} from "@stock/core";
import { eachTradingDay, normalizeNepalDateTime } from "../util/dates";

interface Profile {
  symbol: string;
  name: string;
  sector: string;
  instrumentType: string;
  base: number;
  seed: number;
}

const PROFILES: Profile[] = [
  {
    symbol: "NABIL",
    name: "Nabil Bank Limited",
    sector: "Commercial Banks",
    instrumentType: "Equity",
    base: 540,
    seed: 11,
  },
  {
    symbol: "NICA",
    name: "NIC Asia Bank Limited",
    sector: "Commercial Banks",
    instrumentType: "Equity",
    base: 720,
    seed: 23,
  },
  {
    symbol: "SCB",
    name: "Standard Chartered Bank Nepal",
    sector: "Commercial Banks",
    instrumentType: "Equity",
    base: 610,
    seed: 37,
  },
  {
    symbol: "HIDCL",
    name: "Hydroelectricity Investment and Development Company",
    sector: "Investment",
    instrumentType: "Equity",
    base: 210,
    seed: 41,
  },
  {
    symbol: "NTC",
    name: "Nepal Telecom",
    sector: "Others",
    instrumentType: "Equity",
    base: 890,
    seed: 53,
  },
  {
    symbol: "SHIVM",
    name: "Shivam Cement Limited",
    sector: "Manufacturing And Processing",
    instrumentType: "Equity",
    base: 430,
    seed: 67,
  },
];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function syntheticCandles(
  symbol: string,
  range: DateRange,
  base: number,
  seed: number,
): Candle[] {
  const random = mulberry32(seed);
  const days = eachTradingDay(range.from, range.to);
  const candles: Candle[] = [];
  let previousClose = base;

  for (const day of days) {
    const drift = (random() - 0.48) * 0.018;
    const open = round(Math.max(1, previousClose * (1 + (random() - 0.5) * 0.01)));
    const close = round(Math.max(1, open * (1 + drift)));
    const high = round(Math.max(open, close) * (1 + random() * 0.012));
    const low = round(Math.min(open, close) * (1 - random() * 0.012));
    const volume = Math.round(5_000 + random() * 250_000);
    const turnover = round(volume * ((open + close) / 2));

    candles.push({
      symbol,
      timeframe: "1day",
      timestamp: normalizeNepalDateTime(`${day} 15:00:00`),
      open,
      high,
      low,
      close,
      volume,
      turnover,
      trades: Math.round(20 + random() * 500),
      adjusted: true,
    });
    previousClose = close;
  }

  return candles;
}

export class MockProvider extends BaseProvider {
  readonly descriptor: ProviderDescriptor = {
    id: "mock",
    name: "Deterministic mock provider",
    sourceType: "mock",
    environment: "test",
    termsStatus: "verified",
    productionReady: false,
    reliability: "high",
    priority: 1_000,
    capabilities: [
      "companyList",
      "securityList",
      "sectors",
      "indices",
      "dailyOhlc",
      "intradayOhlc",
      "indexHistory",
      "liveQuotes",
      "marketSummary",
      "sectorPerformance",
      "floorsheet",
      "brokerFlows",
      "fundamentals",
      "fundamentalsHistory",
      "corporateActions",
      "ipos",
      "news",
    ],
    notes: "Synthetic data for tests and UI development only.",
    configRequired: [],
    limits: {
      maxDailyHistoryDays: 3_650,
      maxFloorsheetHistoryDays: 3_650,
    },
  };

  override async getCompanyList(): Promise<DataEnvelope<Company[]>> {
    return this.envelope(this.companies());
  }

  private companies(): Company[] {
    return PROFILES.map((profile, index) => ({
      id: String(100 + index),
      symbol: profile.symbol,
      name: profile.name,
      sector: profile.sector,
      instrumentType: profile.instrumentType,
      status: "active",
      regulatoryBody: "SEBON",
      website: `https://example.com/${profile.symbol.toLowerCase()}`,
    }));
  }

  override async getSecurityList(): Promise<DataEnvelope<Security[]>> {
    const securities: Security[] = PROFILES.map((profile, index) => ({
      id: String(100 + index),
      symbol: profile.symbol,
      name: profile.name,
      companyId: String(100 + index),
      instrumentType: profile.instrumentType,
      isPromoter: false,
      status: "active",
    }));
    return this.envelope(securities);
  }

  override async getSectors(): Promise<DataEnvelope<Sector[]>> {
    const counts = new Map<string, number>();
    for (const profile of PROFILES) {
      counts.set(profile.sector, (counts.get(profile.sector) ?? 0) + 1);
    }
    const sectors: Sector[] = [...counts.entries()].map(([name, count]) => ({
      name,
      companyCount: count,
    }));
    return this.envelope(sectors);
  }

  override async getIndices(): Promise<DataEnvelope<MarketIndex[]>> {
    const indices: MarketIndex[] = [
      { symbol: "NEPSE", name: "NEPSE Index", isSector: false },
      { symbol: "BANKING", name: "Banking SubIndex", isSector: true },
      { symbol: "HYDROPOWER", name: "HydroPower Index", isSector: true },
    ];
    return this.envelope(indices);
  }

  override async getDailyOhlc(
    symbol: string,
    range: DateRange,
  ): Promise<DataEnvelope<Candle[]>> {
    const profile = PROFILES.find((item) => item.symbol === symbol.toUpperCase());
    if (!profile) {
      throw new Error(`Mock symbol not found: ${symbol}`);
    }
    const candles = syntheticCandles(profile.symbol, range, profile.base, profile.seed);
    return this.envelope(candles, candles.at(-1)?.timestamp);
  }

  override async getIntradayOhlc(
    symbol: string,
    range: DateRange,
  ): Promise<DataEnvelope<Candle[]>> {
    const profile = PROFILES.find(
      (item) => item.symbol === symbol.toUpperCase(),
    );
    if (!profile) {
      throw new Error(`Mock symbol not found: ${symbol}`);
    }
    const day = eachTradingDay(range.from, range.to).at(-1);
    if (!day) {
      return this.envelope([], undefined);
    }

    const random = mulberry32(profile.seed + 700);
    const candles: Candle[] = [];
    let close = profile.base;
    for (let minutes = 11 * 60; minutes <= 15 * 60; minutes += 5) {
      const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
      const minute = String(minutes % 60).padStart(2, "0");
      const open = round(close);
      const next = round(Math.max(1, open * (1 + (random() - 0.5) * 0.004)));
      const high = round(Math.max(open, next) * (1 + random() * 0.0015));
      const low = round(Math.min(open, next) * (1 - random() * 0.0015));
      const volume = Math.round(100 + random() * 5_000);
      candles.push({
        symbol: profile.symbol,
        timeframe: "5min",
        timestamp: normalizeNepalDateTime(`${day} ${hour}:${minute}:00`),
        open,
        high,
        low,
        close: next,
        volume,
        turnover: round(volume * next),
        trades: Math.round(1 + random() * 40),
        adjusted: false,
      });
      close = next;
    }
    return this.envelope(candles, candles.at(-1)?.timestamp);
  }

  override async getIndexHistory(
    index: string,
    range: DateRange,
  ): Promise<DataEnvelope<Candle[]>> {
    const base =
      index.toUpperCase() === "NEPSE"
        ? 2_000
        : index.toUpperCase() === "BANKING"
          ? 1_400
          : 1_800;
    const candles = syntheticCandles(index.toUpperCase(), range, base, 101);
    return this.envelope(candles, candles.at(-1)?.timestamp);
  }

  override async getLiveQuotes(): Promise<DataEnvelope<Quote[]>> {
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const quotes: Quote[] = [];
    for (const profile of PROFILES) {
      const candles = syntheticCandles(profile.symbol, { from, to: today }, profile.base, profile.seed);
      const latest = candles.at(-1);
      const previous = candles.at(-2) ?? latest;
      if (!latest || !previous) continue;
      const change = round(latest.close - previous.close);
      quotes.push({
        symbol: profile.symbol,
        ltp: latest.close,
        change,
        changePercent: round((change / previous.close) * 100),
        open: latest.open,
        high: latest.high,
        low: latest.low,
        previousClose: previous.close,
        volume: latest.volume,
        turnover: latest.turnover ?? 0,
        trades: latest.trades,
        asOf: latest.timestamp,
      });
    }
    return this.envelope(quotes, quotes[0]?.asOf);
  }

  override async getMarketSummary(): Promise<DataEnvelope<MarketSummary>> {
    const quotes = (await this.getLiveQuotes()).data;
    const turnover = quotes.reduce((sum, quote) => sum + quote.turnover, 0);
    const volume = quotes.reduce((sum, quote) => sum + quote.volume, 0);
    const summary: MarketSummary = {
      indexName: "NEPSE",
      indexValue: 2_681.07,
      change: 12.4,
      changePercent: 0.46,
      turnover,
      sharesTraded: volume,
      transactions: quotes.reduce((sum, quote) => sum + (quote.trades ?? 0), 0),
      scripsTraded: quotes.length,
      asOf: quotes[0]?.asOf ?? new Date().toISOString(),
    };
    return this.envelope(summary, summary.asOf);
  }

  override async getSectorPerformance(): Promise<DataEnvelope<SectorPerformance[]>> {
    const quotes = (await this.getLiveQuotes()).data;
    const bySector = new Map<string, SectorPerformance>();
    for (const profile of PROFILES) {
      const quote = quotes.find((item) => item.symbol === profile.symbol);
      const existing = bySector.get(profile.sector) ?? {
        sector: profile.sector,
        changePercent: 0,
        turnover: 0,
        volume: 0,
        companies: 0,
      };
      existing.changePercent = round(
        (existing.changePercent ?? 0) + (quote?.changePercent ?? 0),
      );
      existing.turnover = (existing.turnover ?? 0) + (quote?.turnover ?? 0);
      existing.volume = (existing.volume ?? 0) + (quote?.volume ?? 0);
      existing.companies = (existing.companies ?? 0) + 1;
      bySector.set(profile.sector, existing);
    }
    return this.envelope([...bySector.values()]);
  }

  override async getFloorsheet(
    date: string,
  ): Promise<DataEnvelope<FloorsheetTrade[]>> {
    const random = mulberry32(900 + Number(date.replaceAll("-", "").slice(-4)));
    const trades: FloorsheetTrade[] = [];
    for (let index = 0; index < 250; index += 1) {
      const profile = PROFILES[Math.floor(random() * PROFILES.length)] ?? PROFILES[0]!;
      const quantity = Math.round(10 + random() * 5_000);
      const rate = round(profile.base * (0.9 + random() * 0.2));
      trades.push({
        contractId: `${date.replaceAll("-", "")}${String(index).padStart(7, "0")}`,
        businessDate: date,
        symbol: profile.symbol,
        buyerBroker: String(1 + Math.floor(random() * 50)),
        sellerBroker: String(1 + Math.floor(random() * 50)),
        quantity,
        rate,
        amount: round(quantity * rate),
        asOf: normalizeNepalDateTime(`${date} 14:59:59`),
      });
    }
    return this.envelope(trades, trades[0]?.asOf);
  }

  override async getBrokerFlows(
    date: string,
  ): Promise<DataEnvelope<BrokerFlow[]>> {
    const trades = (await this.getFloorsheet(date)).data;
    const flows = new Map<string, BrokerFlow>();
    const get = (brokerId: string): BrokerFlow => {
      const existing = flows.get(brokerId);
      if (existing) return existing;
      const created: BrokerFlow = {
        brokerId,
        businessDate: date,
        buyQuantity: 0,
        buyAmount: 0,
        sellQuantity: 0,
        sellAmount: 0,
        netQuantity: 0,
        netAmount: 0,
      };
      flows.set(brokerId, created);
      return created;
    };
    for (const trade of trades) {
      const buyer = get(trade.buyerBroker);
      buyer.buyQuantity += trade.quantity;
      buyer.buyAmount += trade.amount;
      const seller = get(trade.sellerBroker);
      seller.sellQuantity += trade.quantity;
      seller.sellAmount += trade.amount;
    }
    for (const flow of flows.values()) {
      flow.netQuantity = flow.buyQuantity - flow.sellQuantity;
      flow.netAmount = round(flow.buyAmount - flow.sellAmount);
      flow.buyAmount = round(flow.buyAmount);
      flow.sellAmount = round(flow.sellAmount);
    }
    return this.envelope([...flows.values()]);
  }

  override async getFundamentals(
    symbol: string,
  ): Promise<DataEnvelope<FundamentalsSnapshot>> {
    const profile = PROFILES.find((item) => item.symbol === symbol.toUpperCase());
    if (!profile) throw new Error(`Mock symbol not found: ${symbol}`);
    const snapshot: FundamentalsSnapshot = {
      symbol: profile.symbol,
      asOf: new Date().toISOString(),
      period: "FY2082/83-Q1",
      fiscalYear: "2082/83",
      quarter: 1,
      metrics: {
        eps: {
          metric: "EPS",
          value: round(10 + profile.seed / 3),
          unit: "currency",
          currency: "NPR",
          confidence: "estimated",
        },
        roe: {
          metric: "ROE",
          value: round(8 + (profile.seed % 10)),
          unit: "percent",
          confidence: "estimated",
        },
        roa: {
          metric: "ROA",
          value: round(1 + (profile.seed % 3) / 2),
          unit: "percent",
          confidence: "estimated",
        },
        pe: {
          metric: "P/E",
          value: round(profile.base / (10 + profile.seed / 3)),
          unit: "ratio",
          confidence: "derived",
        },
        pb: {
          metric: "P/B",
          value: round(1 + (profile.seed % 5) / 2),
          unit: "ratio",
          confidence: "derived",
        },
      },
      reportedAt: "2026-10-25",
      sourceUrl: "https://example.com/mock-fundamentals",
    };
    return this.envelope(snapshot, snapshot.asOf);
  }

  override async getFundamentalsHistory(
    symbol: string,
  ): Promise<DataEnvelope<FundamentalsSnapshot[]>> {
    const profile = PROFILES.find((item) => item.symbol === symbol.toUpperCase());
    if (!profile) throw new Error(`Mock symbol not found: ${symbol}`);
    const random = mulberry32(profile.seed + 500);
    const snapshots: FundamentalsSnapshot[] = [];
    for (let index = 0; index < 20; index += 1) {
      const year = 2082 - Math.floor(index / 4);
      const quarter = 4 - (index % 4);
      const period = `FY${year}/${String((year + 1) % 100).padStart(2, "0")}-Q${quarter}`;
      const drift = 1 + (random() - 0.45) * 0.04;
      snapshots.push({
        symbol: profile.symbol,
        asOf: new Date().toISOString(),
        period,
        fiscalYear: `FY${year}/${String((year + 1) % 100).padStart(2, "0")}`,
        quarter,
        metrics: {
          eps: {
            metric: "EPS",
            value: round((10 + profile.seed / 3) * drift),
            unit: "currency",
            currency: "NPR",
            confidence: "estimated",
          },
          roe: {
            metric: "ROE",
            value: round(8 + (profile.seed % 10) + (random() - 0.5) * 2),
            unit: "percent",
            confidence: "estimated",
          },
          roa: {
            metric: "ROA",
            value: round(1 + (profile.seed % 3) / 2 + (random() - 0.5)),
            unit: "percent",
            confidence: "estimated",
          },
          pe: {
            metric: "P/E",
            value: round((profile.base / (10 + profile.seed / 3)) * drift),
            unit: "ratio",
            confidence: "derived",
          },
          pb: {
            metric: "P/B",
            value: round(1 + (profile.seed % 5) / 2),
            unit: "ratio",
            confidence: "derived",
          },
        },
        reportedAt: `${2026 - Math.floor(index / 4)}-10-25`,
        sourceUrl: "https://example.com/mock-fundamentals",
      });
    }
    return this.envelope(snapshots, snapshots[0]?.asOf);
  }

  override async getCorporateActions(
    symbol: string,
  ): Promise<DataEnvelope<CorporateAction[]>> {
    const actions: CorporateAction[] = [
      {
        symbol: symbol.toUpperCase(),
        type: "bonus",
        ratio: "10:1",
        announcedAt: "2026-09-15",
        exDate: "2026-10-20",
        sourceUrl: "https://example.com/mock-notice",
      },
      {
        symbol: symbol.toUpperCase(),
        type: "cashDividend",
        value: 12.5,
        currency: "NPR",
        announcedAt: "2026-09-15",
        exDate: "2026-10-20",
        sourceUrl: "https://example.com/mock-notice",
      },
    ];
    return this.envelope(actions);
  }

  override async getIpos(): Promise<DataEnvelope<Ipo[]>> {
    const ipos: Ipo[] = [
      {
        id: "mock-ipo-1",
        companyName: "Example Hydropower Limited",
        symbol: "EXHPL",
        type: "ipo",
        openDate: "2026-11-10",
        closeDate: "2026-11-14",
        price: 100,
        units: 1_000_000,
        status: "upcoming",
        sourceUrl: "https://example.com/mock-ipo",
      },
    ];
    return this.envelope(ipos);
  }

  override async getNews(): Promise<DataEnvelope<NewsItem[]>> {
    const news: NewsItem[] = [
      {
        id: "mock-news-1",
        title: "Mock: Nabil Bank reports quarterly profit growth",
        url: "https://example.com/mock-news/1",
        publishedAt: new Date().toISOString(),
        source: "Mock News",
        symbols: ["NABIL"],
        summary: "Synthetic news item for UI development only.",
      },
    ];
    return this.envelope(news);
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      providerId: this.descriptor.id,
      status: "ok" as const,
      checkedAt: new Date().toISOString(),
      consecutiveFailures: 0,
      message: "mock provider is always available",
    };
  }
}

import type {
  Capability,
  DataEnvelope,
  DateRange,
  ProviderDescriptor,
  RequestOptions,
} from "./contracts/common";
import type {
  BrokerFlow,
  Candle,
  Company,
  CorporateAction,
  FloorsheetTrade,
  FundamentalsSnapshot,
  Ipo,
  MarketIndex,
  MarketSummary,
  NewsItem,
  ProviderHealth,
  Quote,
  Sector,
  SectorPerformance,
  Security,
} from "./contracts/domain";

/**
 * Every data source must implement this contract. Business logic and the UI
 * depend only on this interface, never on a concrete provider.
 *
 * Methods are optional because providers differ in capability. The provider
 * descriptor must declare exactly which capabilities it supports, and the
 * registry verifies that the corresponding method is present.
 */
export interface MarketDataProvider {
  readonly descriptor: ProviderDescriptor;

  getCompanyList?(
    options?: RequestOptions,
  ): Promise<DataEnvelope<Company[]>>;
  getSecurityList?(
    options?: RequestOptions,
  ): Promise<DataEnvelope<Security[]>>;
  getSectors?(options?: RequestOptions): Promise<DataEnvelope<Sector[]>>;
  getIndices?(options?: RequestOptions): Promise<DataEnvelope<MarketIndex[]>>;

  getDailyOhlc?(
    symbol: string,
    range: DateRange,
    options?: RequestOptions,
  ): Promise<DataEnvelope<Candle[]>>;
  getIntradayOhlc?(
    symbol: string,
    range: DateRange,
    options?: RequestOptions,
  ): Promise<DataEnvelope<Candle[]>>;
  getIndexHistory?(
    index: string,
    range: DateRange,
    options?: RequestOptions,
  ): Promise<DataEnvelope<Candle[]>>;

  getLiveQuotes?(options?: RequestOptions): Promise<DataEnvelope<Quote[]>>;
  getMarketSummary?(
    options?: RequestOptions,
  ): Promise<DataEnvelope<MarketSummary>>;
  getSectorPerformance?(
    options?: RequestOptions,
  ): Promise<DataEnvelope<SectorPerformance[]>>;

  getFloorsheet?(
    date: string,
    options?: RequestOptions,
  ): Promise<DataEnvelope<FloorsheetTrade[]>>;
  getBrokerFlows?(
    date: string,
    options?: RequestOptions,
  ): Promise<DataEnvelope<BrokerFlow[]>>;

  getFundamentals?(
    symbol: string,
    options?: RequestOptions,
  ): Promise<DataEnvelope<FundamentalsSnapshot>>;
  getFundamentalsHistory?(
    symbol: string,
    range?: DateRange,
    options?: RequestOptions,
  ): Promise<DataEnvelope<FundamentalsSnapshot[]>>;
  getCorporateActions?(
    symbol: string,
    options?: RequestOptions,
  ): Promise<DataEnvelope<CorporateAction[]>>;
  getIpos?(options?: RequestOptions): Promise<DataEnvelope<Ipo[]>>;
  getNews?(options?: RequestOptions): Promise<DataEnvelope<NewsItem[]>>;
  getMutualFundHoldings?(
    options?: RequestOptions,
  ): Promise<DataEnvelope<FundamentalsSnapshot[]>>;

  healthCheck?(): Promise<ProviderHealth>;
}

export const CAPABILITY_METHODS = {
  companyList: "getCompanyList",
  securityList: "getSecurityList",
  sectors: "getSectors",
  indices: "getIndices",
  dailyOhlc: "getDailyOhlc",
  intradayOhlc: "getIntradayOhlc",
  indexHistory: "getIndexHistory",
  liveQuotes: "getLiveQuotes",
  marketSummary: "getMarketSummary",
  sectorPerformance: "getSectorPerformance",
  floorsheet: "getFloorsheet",
  fundamentals: "getFundamentals",
  fundamentalsHistory: "getFundamentalsHistory",
  corporateActions: "getCorporateActions",
  ipos: "getIpos",
  news: "getNews",
  brokerFlows: "getBrokerFlows",
  mutualFundHoldings: "getMutualFundHoldings",
} as const satisfies Record<Capability, keyof MarketDataProvider>;

export type CapabilityMethod = (typeof CAPABILITY_METHODS)[Capability];

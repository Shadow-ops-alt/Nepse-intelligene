import type {
  DataEnvelope,
  DataClassification,
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
  Quote,
  Sector,
  SectorPerformance,
  Security,
} from "./contracts/domain";
import { createMeta } from "./freshness";
import { UnsupportedCapabilityError } from "./errors";
import type { MarketDataProvider } from "./provider";

/**
 * Convenience base class. Adapters override only the capabilities they
 * actually support; everything else fails explicitly instead of returning
 * misleading empty data.
 */
export abstract class BaseProvider implements MarketDataProvider {
  abstract readonly descriptor: ProviderDescriptor;

  protected meta(
    asOf?: string,
    warnings: string[] = [],
    cached = false,
    classification?: DataClassification,
  ) {
    return createMeta({
      descriptor: this.descriptor,
      asOf,
      warnings,
      cached,
      ...(classification ? { classification } : {}),
    });
  }

  protected envelope<T>(
    data: T,
    asOf?: string,
    warnings: string[] = [],
    classification?: DataClassification,
  ): DataEnvelope<T> {
    return {
      data,
      meta: this.meta(asOf, warnings, false, classification),
    };
  }

  protected unsupported(capability: string): never {
    throw new UnsupportedCapabilityError(capability, this.descriptor.id);
  }

  async getCompanyList(
    _options?: RequestOptions,
  ): Promise<DataEnvelope<Company[]>> {
    return this.unsupported("companyList");
  }

  async getSecurityList(
    _options?: RequestOptions,
  ): Promise<DataEnvelope<Security[]>> {
    return this.unsupported("securityList");
  }

  async getSectors(_options?: RequestOptions): Promise<DataEnvelope<Sector[]>> {
    return this.unsupported("sectors");
  }

  async getIndices(
    _options?: RequestOptions,
  ): Promise<DataEnvelope<MarketIndex[]>> {
    return this.unsupported("indices");
  }

  async getDailyOhlc(
    _symbol: string,
    _range: DateRange,
    _options?: RequestOptions,
  ): Promise<DataEnvelope<Candle[]>> {
    return this.unsupported("dailyOhlc");
  }

  async getIntradayOhlc(
    _symbol: string,
    _range: DateRange,
    _options?: RequestOptions,
  ): Promise<DataEnvelope<Candle[]>> {
    return this.unsupported("intradayOhlc");
  }

  async getIndexHistory(
    _index: string,
    _range: DateRange,
    _options?: RequestOptions,
  ): Promise<DataEnvelope<Candle[]>> {
    return this.unsupported("indexHistory");
  }

  async getLiveQuotes(
    _options?: RequestOptions,
  ): Promise<DataEnvelope<Quote[]>> {
    return this.unsupported("liveQuotes");
  }

  async getMarketSummary(
    _options?: RequestOptions,
  ): Promise<DataEnvelope<MarketSummary>> {
    return this.unsupported("marketSummary");
  }

  async getSectorPerformance(
    _options?: RequestOptions,
  ): Promise<DataEnvelope<SectorPerformance[]>> {
    return this.unsupported("sectorPerformance");
  }

  async getFloorsheet(
    _date: string,
    _options?: RequestOptions,
  ): Promise<DataEnvelope<FloorsheetTrade[]>> {
    return this.unsupported("floorsheet");
  }

  async getBrokerFlows(
    _date: string,
    _options?: RequestOptions,
  ): Promise<DataEnvelope<BrokerFlow[]>> {
    return this.unsupported("brokerFlows");
  }

  async getFundamentals(
    _symbol: string,
    _options?: RequestOptions,
  ): Promise<DataEnvelope<FundamentalsSnapshot>> {
    return this.unsupported("fundamentals");
  }

  async getFundamentalsHistory(
    _symbol: string,
    _range?: DateRange,
    _options?: RequestOptions,
  ): Promise<DataEnvelope<FundamentalsSnapshot[]>> {
    return this.unsupported("fundamentalsHistory");
  }

  async getCorporateActions(
    _symbol: string,
    _options?: RequestOptions,
  ): Promise<DataEnvelope<CorporateAction[]>> {
    return this.unsupported("corporateActions");
  }

  async getIpos(_options?: RequestOptions): Promise<DataEnvelope<Ipo[]>> {
    return this.unsupported("ipos");
  }

  async getNews(_options?: RequestOptions): Promise<DataEnvelope<NewsItem[]>> {
    return this.unsupported("news");
  }

  async getMutualFundHoldings(
    _options?: RequestOptions,
  ): Promise<DataEnvelope<FundamentalsSnapshot[]>> {
    return this.unsupported("mutualFundHoldings");
  }
}

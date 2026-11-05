import { z } from "zod";
import {
  BaseProvider,
  BrokerFlowSchema,
  CandleSchema,
  CompanySchema,
  CorporateActionSchema,
  FloorsheetTradeSchema,
  FundamentalsSnapshotSchema,
  IpoSchema,
  IndexSchema as MarketIndexSchema,
  MarketSummarySchema,
  NewsItemSchema,
  ProviderResponseError,
  QuoteSchema,
  SectorPerformanceSchema,
  SectorSchema,
  SecuritySchema,
  type DataEnvelope,
  type DateRange,
  type Environment,
  type ProviderDescriptor,
  type ProviderHealth,
  type RequestOptions,
  type TermsStatus,
} from "@stock/core";
import { fetchJson } from "../util/http";

const EnvelopeSchema = z.object({
  data: z.unknown(),
  asOf: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

export interface RestProviderPaths {
  companies: string;
  securities: string;
  sectors: string;
  indices: string;
  ohlc: string;
  intraday: string;
  indexHistory: string;
  quotes: string;
  summary: string;
  sectorPerformance: string;
  floorsheet: string;
  brokerFlows: string;
  fundamentals: string;
  fundamentalsHistory: string;
  corporateActions: string;
  ipos: string;
  news: string;
}

const DEFAULT_PATHS: RestProviderPaths = {
  companies: "/companies",
  securities: "/securities",
  sectors: "/sectors",
  indices: "/indices",
  ohlc: "/ohlc/:symbol",
  intraday: "/intraday/:symbol",
  indexHistory: "/indices/:index/ohlc",
  quotes: "/quotes",
  summary: "/market-summary",
  sectorPerformance: "/sector-performance",
  floorsheet: "/floorsheet/:date",
  brokerFlows: "/broker-flows/:date",
  fundamentals: "/fundamentals/:symbol",
  fundamentalsHistory: "/fundamentals/:symbol/history",
  corporateActions: "/corporate-actions/:symbol",
  ipos: "/ipos",
  news: "/news",
};

export interface RestProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  paths?: Partial<RestProviderPaths>;
  termsUrl?: string;
  license?: string;
  termsStatus?: TermsStatus;
  productionReady?: boolean;
  environment?: Environment;
  priority?: number;
  timeoutMs?: number;
  /** Set only after the operator has verified the data license. */
  attestLicensed?: boolean;
}

/**
 * Generic HTTP/JSON adapter for a licensed vendor. The vendor contract is
 * intentionally boring: every endpoint returns { data, asOf?, warnings? }.
 * Field mapping stays here, never in the UI or business logic.
 */
export class RestProvider extends BaseProvider {
  readonly descriptor: ProviderDescriptor;
  private readonly config: RestProviderConfig;
  private readonly paths: RestProviderPaths;

  constructor(config: RestProviderConfig) {
    super();
    this.config = config;
    this.paths = { ...DEFAULT_PATHS, ...config.paths };
    const licensed = config.attestLicensed ?? false;
    this.descriptor = {
      id: config.id,
      name: config.name,
      sourceType: "licensed",
      environment: config.environment ?? "production",
      termsStatus:
        config.termsStatus ?? (licensed ? "verified" : "unverified"),
      termsUrl: config.termsUrl,
      license: config.license,
      productionReady: config.productionReady ?? licensed,
      reliability: "high",
      priority: config.priority ?? 10,
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
      notes: "Generic licensed REST adapter; requires a vendor contract.",
      configRequired: ["LICENSED_BASE_URL", "LICENSED_API_KEY"],
    };
  }

  private url(
    template: string,
    params: Record<string, string> = {},
    query: Record<string, string | undefined> = {},
  ): string {
    let path = template;
    for (const [key, value] of Object.entries(params)) {
      path = path.replaceAll(`:${key}`, encodeURIComponent(value));
    }
    const base = this.config.baseUrl.endsWith("/")
      ? this.config.baseUrl
      : `${this.config.baseUrl}/`;
    const url = new URL(path.replace(/^\//, ""), base);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async request<S extends z.ZodTypeAny>(
    schema: S,
    path: string,
    options?: RequestOptions,
  ): Promise<DataEnvelope<z.output<S>>> {
    const body = await fetchJson<unknown>(
      path,
      {
        headers: {
          Accept: "application/json",
          ...(this.config.apiKey
            ? { Authorization: `Bearer ${this.config.apiKey}` }
            : {}),
          ...this.config.headers,
        },
        signal: options?.signal,
      },
      {
        providerId: this.descriptor.id,
        timeoutMs: options?.timeoutMs ?? this.config.timeoutMs ?? 30_000,
        signal: options?.signal,
      },
    );

    const envelope = EnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw new ProviderResponseError(
        this.descriptor.id,
        `endpoint ${path} did not return { data, asOf?, warnings? }`,
        envelope.error,
      );
    }

    const parsed = schema.safeParse(envelope.data.data);
    if (!parsed.success) {
      throw new ProviderResponseError(
        this.descriptor.id,
        `endpoint ${path} returned invalid data`,
        parsed.error,
      );
    }

    return this.envelope(
      parsed.data,
      envelope.data.asOf ?? new Date().toISOString(),
      envelope.data.warnings ?? [],
    );
  }

  override async getCompanyList(options?: RequestOptions) {
    return this.request(z.array(CompanySchema), this.url(this.paths.companies), options);
  }

  override async getSecurityList(options?: RequestOptions) {
    return this.request(z.array(SecuritySchema), this.url(this.paths.securities), options);
  }

  override async getSectors(options?: RequestOptions) {
    return this.request(z.array(SectorSchema), this.url(this.paths.sectors), options);
  }

  override async getIndices(options?: RequestOptions) {
    return this.request(z.array(MarketIndexSchema), this.url(this.paths.indices), options);
  }

  override async getDailyOhlc(
    symbol: string,
    range: DateRange,
    options?: RequestOptions,
  ) {
    return this.request(
      z.array(CandleSchema),
      this.url(this.paths.ohlc, { symbol }, { from: range.from, to: range.to }),
      options,
    );
  }

  override async getIntradayOhlc(
    symbol: string,
    range: DateRange,
    options?: RequestOptions,
  ) {
    return this.request(
      z.array(CandleSchema),
      this.url(
        this.paths.intraday,
        { symbol },
        { from: range.from, to: range.to },
      ),
      options,
    );
  }

  override async getIndexHistory(
    index: string,
    range: DateRange,
    options?: RequestOptions,
  ) {
    return this.request(
      z.array(CandleSchema),
      this.url(
        this.paths.indexHistory,
        { index },
        { from: range.from, to: range.to },
      ),
      options,
    );
  }

  override async getLiveQuotes(options?: RequestOptions) {
    return this.request(z.array(QuoteSchema), this.url(this.paths.quotes), options);
  }

  override async getMarketSummary(options?: RequestOptions) {
    return this.request(
      MarketSummarySchema,
      this.url(this.paths.summary),
      options,
    );
  }

  override async getSectorPerformance(options?: RequestOptions) {
    return this.request(
      z.array(SectorPerformanceSchema),
      this.url(this.paths.sectorPerformance),
      options,
    );
  }

  override async getFloorsheet(date: string, options?: RequestOptions) {
    return this.request(
      z.array(FloorsheetTradeSchema),
      this.url(this.paths.floorsheet, { date }),
      options,
    );
  }

  override async getBrokerFlows(date: string, options?: RequestOptions) {
    return this.request(
      z.array(BrokerFlowSchema),
      this.url(this.paths.brokerFlows, { date }),
      options,
    );
  }

  override async getFundamentals(symbol: string, options?: RequestOptions) {
    return this.request(
      FundamentalsSnapshotSchema,
      this.url(this.paths.fundamentals, { symbol }),
      options,
    );
  }

  override async getFundamentalsHistory(
    symbol: string,
    range?: DateRange,
    options?: RequestOptions,
  ) {
    return this.request(
      z.array(FundamentalsSnapshotSchema),
      this.url(
        this.paths.fundamentalsHistory,
        { symbol },
        { from: range?.from, to: range?.to },
      ),
      options,
    );
  }

  override async getCorporateActions(
    symbol: string,
    options?: RequestOptions,
  ) {
    return this.request(
      z.array(CorporateActionSchema),
      this.url(this.paths.corporateActions, { symbol }),
      options,
    );
  }

  override async getIpos(options?: RequestOptions) {
    return this.request(z.array(IpoSchema), this.url(this.paths.ipos), options);
  }

  override async getNews(options?: RequestOptions) {
    return this.request(
      z.array(NewsItemSchema),
      this.url(this.paths.news),
      options,
    );
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const started = Date.now();
      await this.request(z.array(CompanySchema), this.url(this.paths.companies));
      return {
        providerId: this.descriptor.id,
        status: "ok",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        consecutiveFailures: 0,
      };
    } catch (error) {
      return {
        providerId: this.descriptor.id,
        status: "down",
        checkedAt: new Date().toISOString(),
        consecutiveFailures: 1,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

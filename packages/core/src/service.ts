import type {
  Capability,
  DataEnvelope,
  DataMeta,
  RequestOptions,
} from "./contracts/common";
import { DataMetaSchema } from "./contracts/common";
import type { ProviderHealth } from "./contracts/domain";
import {
  AggregateProviderError,
  DataQualityError,
  MarketDataError,
  UnsupportedCapabilityError,
} from "./errors";
import { ageInSeconds, classificationFor, computeDataState, freshnessRuleFor } from "./freshness";
import type { RuntimePolicy } from "./policy";
import type { ProviderRegistry } from "./registry";
import type { MarketDataProvider } from "./provider";

interface HealthState {
  lastSuccessAt?: string;
  lastFailureAt?: string;
  consecutiveFailures: number;
  totalSuccesses: number;
  totalFailures: number;
  lastLatencyMs?: number;
  lastError?: string;
}

export class HealthTracker {
  private readonly state = new Map<string, HealthState>();

  private getOrCreate(providerId: string): HealthState {
    const existing = this.state.get(providerId);
    if (existing) return existing;
    const created: HealthState = {
      consecutiveFailures: 0,
      totalSuccesses: 0,
      totalFailures: 0,
    };
    this.state.set(providerId, created);
    return created;
  }

  recordSuccess(providerId: string, latencyMs: number): void {
    const state = this.getOrCreate(providerId);
    state.lastSuccessAt = new Date().toISOString();
    state.consecutiveFailures = 0;
    state.totalSuccesses += 1;
    state.lastLatencyMs = latencyMs;
    state.lastError = undefined;
  }

  recordFailure(providerId: string, latencyMs: number, error: Error): void {
    const state = this.getOrCreate(providerId);
    state.lastFailureAt = new Date().toISOString();
    state.consecutiveFailures += 1;
    state.totalFailures += 1;
    state.lastLatencyMs = latencyMs;
    state.lastError = error.message;
  }

  get(providerId: string): HealthState {
    return { ...this.getOrCreate(providerId) };
  }

  all(): Array<{ providerId: string; state: HealthState }> {
    return [...this.state.entries()].map(([providerId, state]) => ({
      providerId,
      state: { ...state },
    }));
  }
}

export interface MarketDataServiceOptions {
  policy: RuntimePolicy;
  now?: () => Date;
  healthTracker?: HealthTracker;
}

/**
 * The only entry point business logic should use. It selects providers by
 * declared capability and priority, enforces runtime policy, attaches source
 * metadata, and falls back to the next provider on failure.
 */
export class MarketDataService {
  private readonly registry: ProviderRegistry;
  private readonly policy: RuntimePolicy;
  private readonly now: () => Date;
  private readonly health: HealthTracker;

  constructor(
    registry: ProviderRegistry,
    options: MarketDataServiceOptions,
  ) {
    this.registry = registry;
    this.policy = options.policy;
    this.now = options.now ?? (() => new Date());
    this.health = options.healthTracker ?? new HealthTracker();
  }

  get policySnapshot(): RuntimePolicy {
    return { ...this.policy };
  }

  listProviders() {
    return this.registry.evaluations(this.policy);
  }

  healthReport(): ProviderHealth[] {
    return this.registry.list().map((descriptor) => {
      const state = this.health.get(descriptor.id);
      const checkedAt = this.now().toISOString();
      let status: ProviderHealth["status"] = "unknown";
      if (state.lastSuccessAt || state.lastFailureAt) {
        status = state.consecutiveFailures >= 3 ? "down" : "ok";
        if (
          state.lastFailureAt &&
          (!state.lastSuccessAt || state.lastFailureAt > state.lastSuccessAt)
        ) {
          status = state.consecutiveFailures >= 3 ? "down" : "degraded";
        }
      }
      return {
        providerId: descriptor.id,
        status,
        checkedAt,
        ...(state.lastLatencyMs !== undefined
          ? { latencyMs: state.lastLatencyMs }
          : {}),
        ...(state.lastSuccessAt
          ? { lastSuccessAt: state.lastSuccessAt }
          : {}),
        ...(state.lastFailureAt
          ? { lastFailureAt: state.lastFailureAt }
          : {}),
        consecutiveFailures: state.consecutiveFailures,
        ...(state.lastError ? { message: state.lastError } : {}),
      };
    });
  }

  private normalizeMeta(
    result: DataEnvelope<unknown>,
    provider: MarketDataProvider,
    capability: Capability,
  ): DataEnvelope<unknown> {
    const meta = DataMetaSchema.parse(result.meta);
    const descriptor = provider.descriptor;

    if (meta.providerId !== descriptor.id) {
      throw new DataQualityError(
        descriptor.id,
        `metadata providerId "${meta.providerId}" does not match descriptor`,
      );
    }
    if (meta.sourceType !== descriptor.sourceType) {
      throw new DataQualityError(
        descriptor.id,
        "metadata sourceType does not match descriptor",
      );
    }
    if (meta.productionReady !== descriptor.productionReady) {
      throw new DataQualityError(
        descriptor.id,
        "metadata productionReady does not match descriptor",
      );
    }
    if (
      descriptor.sourceType === "unofficial" &&
      meta.productionReady
    ) {
      throw new DataQualityError(
        descriptor.id,
        "unofficial data cannot be production-ready",
      );
    }
    if (meta.classification === "VERIFIED" && descriptor.sourceType !== "licensed") {
      throw new DataQualityError(
        descriptor.id,
        "only a licensed, independently reconciled source may be VERIFIED",
      );
    }
    if (descriptor.sourceType === "mock" && meta.classification !== "DEMO") {
      throw new DataQualityError(
        descriptor.id,
        "mock providers must be classified DEMO",
      );
    }
    if (descriptor.sourceType !== "mock" && meta.classification === "DEMO") {
      throw new DataQualityError(
        descriptor.id,
        "only a mock provider may be classified DEMO",
      );
    }

    const warnings = [...meta.warnings];
    const rule = freshnessRuleFor(capability);
    const maxAgeSeconds = this.policy.maxDataAgeSeconds ?? rule.maxAgeSeconds;
    const state = computeDataState({
      asOf: meta.asOf,
      fetchedAt: meta.fetchedAt,
      maxAgeSeconds,
      mode: rule.mode,
      now: this.now(),
    });
    const stale = state === "stale";

    if (stale) {
      const age = meta.asOf ? ageInSeconds(meta.asOf, this.now()) : null;
      warnings.push(
        age === null
          ? `data has no usable timestamp (max ${maxAgeSeconds}s for ${capability})`
          : `data is ${age}s old (max ${maxAgeSeconds}s for ${capability})`,
      );
    }

    const normalized: DataMeta = {
      ...meta,
      stale,
      state,
      classification:
        meta.classification === "UNVERIFIED" && descriptor.sourceType === "mock"
          ? classificationFor(descriptor)
          : meta.classification,
      warnings,
    };
    return { data: result.data, meta: normalized };
  }

  private async execute<T>(
    capability: Capability,
    call: (
      provider: MarketDataProvider,
      options?: RequestOptions,
    ) => Promise<DataEnvelope<T>>,
    options?: RequestOptions,
  ): Promise<DataEnvelope<T>> {
    const candidates = this.registry.forCapability(capability, this.policy);
    if (candidates.length === 0) {
      throw new UnsupportedCapabilityError(capability);
    }

    const errors: MarketDataError[] = [];

    for (const provider of candidates) {
      const started = Date.now();
      try {
        const result = await call(provider, options);
        const normalized = this.normalizeMeta(result, provider, capability);
        this.health.recordSuccess(
          provider.descriptor.id,
          Date.now() - started,
        );
        return normalized as DataEnvelope<T>;
      } catch (unknownError) {
        const error =
          unknownError instanceof MarketDataError
            ? unknownError
            : new MarketDataError(
                unknownError instanceof Error
                  ? unknownError.message
                  : String(unknownError),
                {
                  code: "PROVIDER_CALL_FAILED",
                  providerId: provider.descriptor.id,
                  retryable: true,
                  cause: unknownError,
                },
              );
        this.health.recordFailure(
          provider.descriptor.id,
          Date.now() - started,
          error,
        );
        errors.push(error);
      }
    }

    throw new AggregateProviderError(capability, errors);
  }

  getCompanyList(options?: RequestOptions) {
    return this.execute(
      "companyList",
      (provider, opts) => provider.getCompanyList!(opts),
      options,
    );
  }

  getSecurityList(options?: RequestOptions) {
    return this.execute(
      "securityList",
      (provider, opts) => provider.getSecurityList!(opts),
      options,
    );
  }

  getSectors(options?: RequestOptions) {
    return this.execute(
      "sectors",
      (provider, opts) => provider.getSectors!(opts),
      options,
    );
  }

  getIndices(options?: RequestOptions) {
    return this.execute(
      "indices",
      (provider, opts) => provider.getIndices!(opts),
      options,
    );
  }

  getDailyOhlc(
    symbol: string,
    range: { from: string; to: string },
    options?: RequestOptions,
  ) {
    return this.execute(
      "dailyOhlc",
      (provider, opts) => provider.getDailyOhlc!(symbol, range, opts),
      options,
    );
  }

  getIntradayOhlc(
    symbol: string,
    range: { from: string; to: string },
    options?: RequestOptions,
  ) {
    return this.execute(
      "intradayOhlc",
      (provider, opts) => provider.getIntradayOhlc!(symbol, range, opts),
      options,
    );
  }

  getIndexHistory(
    index: string,
    range: { from: string; to: string },
    options?: RequestOptions,
  ) {
    return this.execute(
      "indexHistory",
      (provider, opts) => provider.getIndexHistory!(index, range, opts),
      options,
    );
  }

  getLiveQuotes(options?: RequestOptions) {
    return this.execute(
      "liveQuotes",
      (provider, opts) => provider.getLiveQuotes!(opts),
      options,
    );
  }

  getMarketSummary(options?: RequestOptions) {
    return this.execute(
      "marketSummary",
      (provider, opts) => provider.getMarketSummary!(opts),
      options,
    );
  }

  getSectorPerformance(options?: RequestOptions) {
    return this.execute(
      "sectorPerformance",
      (provider, opts) => provider.getSectorPerformance!(opts),
      options,
    );
  }

  getFloorsheet(date: string, options?: RequestOptions) {
    return this.execute(
      "floorsheet",
      (provider, opts) => provider.getFloorsheet!(date, opts),
      options,
    );
  }

  getBrokerFlows(date: string, options?: RequestOptions) {
    return this.execute(
      "brokerFlows",
      (provider, opts) => provider.getBrokerFlows!(date, opts),
      options,
    );
  }

  getFundamentals(symbol: string, options?: RequestOptions) {
    return this.execute(
      "fundamentals",
      (provider, opts) => provider.getFundamentals!(symbol, opts),
      options,
    );
  }

  getFundamentalsHistory(
    symbol: string,
    range?: { from: string; to: string },
    options?: RequestOptions,
  ) {
    return this.execute(
      "fundamentalsHistory",
      (provider, opts) =>
        provider.getFundamentalsHistory!(symbol, range, opts),
      options,
    );
  }

  getCorporateActions(symbol: string, options?: RequestOptions) {
    return this.execute(
      "corporateActions",
      (provider, opts) => provider.getCorporateActions!(symbol, opts),
      options,
    );
  }

  getIpos(options?: RequestOptions) {
    return this.execute(
      "ipos",
      (provider, opts) => provider.getIpos!(opts),
      options,
    );
  }

  getNews(options?: RequestOptions) {
    return this.execute(
      "news",
      (provider, opts) => provider.getNews!(opts),
      options,
    );
  }

  getMutualFundHoldings(options?: RequestOptions) {
    return this.execute(
      "mutualFundHoldings",
      (provider, opts) => provider.getMutualFundHoldings!(opts),
      options,
    );
  }

  async checkProviderHealth(providerId: string): Promise<ProviderHealth> {
    const provider = this.registry.require(providerId);
    if (!provider.healthCheck) {
      return {
        providerId,
        status: "unknown",
        checkedAt: this.now().toISOString(),
        message: "provider does not implement healthCheck",
        consecutiveFailures: 0,
      };
    }
    try {
      const health = await provider.healthCheck();
      return health;
    } catch (error) {
      return {
        providerId,
        status: "down",
        checkedAt: this.now().toISOString(),
        consecutiveFailures: 1,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

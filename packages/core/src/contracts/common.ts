import { z } from "zod";

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const TradingDateSchema = z.iso.date();

export const SourceTypeSchema = z.enum([
  "licensed",
  "unofficial",
  "manual",
  "mock",
]);

export const EnvironmentSchema = z.enum([
  "development",
  "test",
  "staging",
  "production",
]);

export const TermsStatusSchema = z.enum([
  "verified",
  "unverified",
  "restricted",
  "prohibited",
]);

export const ReliabilitySchema = z.enum([
  "unverified",
  "low",
  "medium",
  "high",
]);

export const CapabilitySchema = z.enum([
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
  "fundamentals",
  "fundamentalsHistory",
  "corporateActions",
  "ipos",
  "news",
  "brokerFlows",
  "mutualFundHoldings",
]);

/**
 * How much trust a record has earned. These are deliberately conservative:
 * a provider response is never `VERIFIED` just because it returned HTTP 200.
 *
 * - VERIFIED: independently reconciled against an authoritative source.
 * - UNVERIFIED: retrieved from a declared source, not independently validated.
 * - DERIVED: computed from other records (e.g. sector counts, aggregates).
 * - DEMO: synthetic development/demo data. Never enters product calculations.
 * - MISSING: no usable record exists.
 */
export const DataClassificationSchema = z.enum([
  "VERIFIED",
  "UNVERIFIED",
  "DERIVED",
  "DEMO",
  "MISSING",
]);

/**
 * Freshness of a record relative to its capability.
 *
 * - live: recent enough to be treated as current.
 * - delayed: past the live window but still usable with a warning.
 * - eod: end-of-day series (daily bars, fundamentals) inside its window.
 * - stale: too old to present as current.
 * - unavailable: no record, or no timestamp to judge.
 */
export const DataStateSchema = z.enum([
  "live",
  "delayed",
  "eod",
  "stale",
  "unavailable",
]);

export type Capability = z.infer<typeof CapabilitySchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
export type TermsStatus = z.infer<typeof TermsStatusSchema>;
export type Reliability = z.infer<typeof ReliabilitySchema>;
export type DataClassification = z.infer<typeof DataClassificationSchema>;
export type DataState = z.infer<typeof DataStateSchema>;

export const DataMetaSchema = z.object({
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  sourceType: SourceTypeSchema,
  environment: EnvironmentSchema,
  termsStatus: TermsStatusSchema,
  productionReady: z.boolean(),
  reliability: ReliabilitySchema,
  fetchedAt: IsoDateTimeSchema,
  asOf: IsoDateTimeSchema.optional(),
  ageSeconds: z.number().nonnegative().optional(),
  stale: z.boolean(),
  classification: DataClassificationSchema.default("UNVERIFIED"),
  state: DataStateSchema.optional(),
  cached: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
  requestId: z.string().optional(),
});

export type DataMeta = z.infer<typeof DataMetaSchema>;

export interface DataEnvelope<T> {
  data: T;
  meta: DataMeta;
}

export const ProviderDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().min(1),
  sourceType: SourceTypeSchema,
  environment: EnvironmentSchema,
  termsStatus: TermsStatusSchema,
  termsUrl: z.url().optional(),
  license: z.string().min(1).optional(),
  productionReady: z.boolean(),
  reliability: ReliabilitySchema,
  priority: z.number().int().min(0).default(100),
  capabilities: z.array(CapabilitySchema).min(1),
  notes: z.string().optional(),
  configRequired: z.array(z.string()).default([]),
  limits: z
    .object({
      maxDailyHistoryDays: z.number().int().positive().optional(),
      maxIntradayHistoryDays: z.number().int().positive().optional(),
      maxFloorsheetHistoryDays: z.number().int().positive().optional(),
    })
    .optional(),
});

export type ProviderDescriptor = z.infer<typeof ProviderDescriptorSchema>;

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  bypassCache?: boolean;
  correlationId?: string;
}

export interface DateRange {
  from: string;
  to: string;
}

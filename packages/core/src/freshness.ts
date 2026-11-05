import type {
  Capability,
  DataClassification,
  DataMeta,
  DataState,
  ProviderDescriptor,
} from "./contracts/common";
import { DataQualityError } from "./errors";

/** Canonical NEPSE market clock: Sunday–Thursday, Asia/Kathmandu. */
export const NEPAL_TIME_ZONE = "Asia/Kathmandu";

export function ageInSeconds(
  asOf: string,
  now: Date = new Date(),
): number {
  const then = new Date(asOf).getTime();
  if (!Number.isFinite(then)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, Math.floor((now.getTime() - then) / 1000));
}

export function isStale(
  asOf: string | undefined,
  maxAgeSeconds: number | undefined,
  now: Date = new Date(),
): boolean {
  if (!asOf || maxAgeSeconds === undefined) {
    return false;
  }
  return ageInSeconds(asOf, now) > maxAgeSeconds;
}

export interface FreshnessRule {
  /** How old a record may be before it is labelled stale. */
  maxAgeSeconds: number;
  /** Live capabilities get a delayed band; daily series are EOD or stale. */
  mode: "live" | "daily";
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/**
 * Default freshness windows. These are product decisions, not vendor claims.
 * They are intentionally conservative: it is better to label data stale than
 * to imply it is live.
 */
export const CAPABILITY_FRESHNESS: Record<Capability, FreshnessRule> = {
  liveQuotes: { maxAgeSeconds: 15 * 60, mode: "live" },
  marketSummary: { maxAgeSeconds: 15 * 60, mode: "live" },
  intradayOhlc: { maxAgeSeconds: HOUR, mode: "live" },
  dailyOhlc: { maxAgeSeconds: 3 * DAY, mode: "daily" },
  indexHistory: { maxAgeSeconds: 3 * DAY, mode: "daily" },
  indices: { maxAgeSeconds: 2 * DAY, mode: "daily" },
  sectorPerformance: { maxAgeSeconds: 2 * DAY, mode: "daily" },
  companyList: { maxAgeSeconds: 30 * DAY, mode: "daily" },
  securityList: { maxAgeSeconds: 30 * DAY, mode: "daily" },
  sectors: { maxAgeSeconds: 30 * DAY, mode: "daily" },
  floorsheet: { maxAgeSeconds: 3 * DAY, mode: "daily" },
  brokerFlows: { maxAgeSeconds: 3 * DAY, mode: "daily" },
  fundamentals: { maxAgeSeconds: 120 * DAY, mode: "daily" },
  fundamentalsHistory: { maxAgeSeconds: 120 * DAY, mode: "daily" },
  corporateActions: { maxAgeSeconds: 30 * DAY, mode: "daily" },
  ipos: { maxAgeSeconds: 7 * DAY, mode: "daily" },
  news: { maxAgeSeconds: 7 * DAY, mode: "daily" },
  mutualFundHoldings: { maxAgeSeconds: 120 * DAY, mode: "daily" },
};

export function freshnessRuleFor(capability: Capability): FreshnessRule {
  return CAPABILITY_FRESHNESS[capability];
}

export function defaultMaxAgeSeconds(capability: Capability): number {
  return CAPABILITY_FRESHNESS[capability].maxAgeSeconds;
}

/**
 * Source-level classification. Only an explicit, independently reconciled
 * record may be marked VERIFIED; nothing is upgraded automatically here.
 */
export function classificationFor(
  descriptor: ProviderDescriptor,
  derived = false,
): DataClassification {
  return classificationForSourceType(descriptor.sourceType, derived);
}

export function classificationForSourceType(
  sourceType: string,
  derived = false,
): DataClassification {
  if (sourceType === "mock") return "DEMO";
  if (derived) return "DERIVED";
  return "UNVERIFIED";
}

export interface DataStateInput {
  asOf?: string | null;
  fetchedAt?: string | null;
  maxAgeSeconds: number;
  mode?: "live" | "daily";
  hasData?: boolean;
  now?: Date;
}

export function computeDataState(input: DataStateInput): DataState {
  const now = input.now ?? new Date();
  if (input.hasData === false) return "unavailable";

  const asOf = input.asOf ?? input.fetchedAt ?? undefined;
  if (!asOf) return "unavailable";

  const age = ageInSeconds(asOf, now);
  if (!Number.isFinite(age)) return "unavailable";

  const mode = input.mode ?? "live";
  if (mode === "daily") {
    return age > input.maxAgeSeconds ? "stale" : "eod";
  }

  if (age <= input.maxAgeSeconds) return "live";
  if (age <= input.maxAgeSeconds * 4) return "delayed";
  return "stale";
}

export interface MetaInput {
  descriptor: ProviderDescriptor;
  asOf?: string;
  cached?: boolean;
  warnings?: string[];
  now?: Date;
  classification?: DataClassification;
  maxAgeSeconds?: number;
  stateMode?: "live" | "daily";
  hasData?: boolean;
}

export function createMeta(input: MetaInput): DataMeta {
  const now = input.now ?? new Date();
  const warnings = [...(input.warnings ?? [])];
  const descriptor = input.descriptor;
  const classification =
    input.classification ?? classificationFor(descriptor);

  // Guardrail: scraped/unofficial data can never claim production readiness
  // or verified classification inside the data envelope.
  if (descriptor.sourceType === "unofficial" && descriptor.productionReady) {
    throw new DataQualityError(
      descriptor.id,
      "unofficial providers cannot be marked productionReady",
    );
  }
  if (classification === "VERIFIED" && descriptor.sourceType !== "licensed") {
    throw new DataQualityError(
      descriptor.id,
      "only a licensed, independently reconciled source may be VERIFIED",
    );
  }
  if (descriptor.sourceType === "mock" && classification !== "DEMO") {
    throw new DataQualityError(
      descriptor.id,
      "mock providers must be classified DEMO",
    );
  }
  if (descriptor.sourceType !== "mock" && classification === "DEMO") {
    throw new DataQualityError(
      descriptor.id,
      "only a mock provider may be classified DEMO",
    );
  }

  const age = input.asOf ? ageInSeconds(input.asOf, now) : undefined;
  const state =
    input.maxAgeSeconds !== undefined
      ? computeDataState({
          asOf: input.asOf,
          maxAgeSeconds: input.maxAgeSeconds,
          mode: input.stateMode ?? "live",
          hasData: input.hasData,
          now,
        })
      : undefined;
  const stale = state === "stale";

  if (stale) {
    warnings.push(
      `data is ${age}s old (max ${input.maxAgeSeconds}s for this capability)`,
    );
  }

  return {
    providerId: descriptor.id,
    providerName: descriptor.name,
    sourceType: descriptor.sourceType,
    environment: descriptor.environment,
    termsStatus: descriptor.termsStatus,
    productionReady: descriptor.productionReady,
    reliability: descriptor.reliability,
    fetchedAt: now.toISOString(),
    ...(input.asOf ? { asOf: input.asOf } : {}),
    ...(age !== undefined ? { ageSeconds: age } : {}),
    stale,
    classification,
    ...(state ? { state } : {}),
    cached: input.cached ?? false,
    warnings,
  };
}

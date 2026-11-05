import type {
  Environment,
  ProviderDescriptor,
} from "./contracts/common";
import { TermsRestrictionError } from "./errors";

export type DataEdition = "free" | "licensed";

export interface RuntimePolicy {
  environment: Environment;
  /**
   * "free" is a separate product edition that runs on unofficial data and is
   * clearly labelled. "licensed" is the strict edition: unofficial data is
   * never allowed in production. Defaults to "licensed" when omitted.
   */
  edition?: DataEdition;
  allowUnofficial: boolean;
  requireVerifiedTerms: boolean;
  requireProductionReady: boolean;
  maxDataAgeSeconds?: number;
}

export const DEVELOPMENT_POLICY: RuntimePolicy = {
  environment: "development",
  edition: "licensed",
  allowUnofficial: false,
  requireVerifiedTerms: false,
  requireProductionReady: false,
};

export const TEST_POLICY: RuntimePolicy = {
  environment: "test",
  edition: "licensed",
  allowUnofficial: false,
  requireVerifiedTerms: false,
  requireProductionReady: false,
};

export const PRODUCTION_POLICY: RuntimePolicy = {
  environment: "production",
  edition: "licensed",
  allowUnofficial: false,
  requireVerifiedTerms: true,
  requireProductionReady: true,
};

/**
 * Free Edition: a shipped product that runs on unofficial/free data.
 *
 * This is deliberately a different edition, not a relaxation of licensed
 * production. Data stays `productionReady=false` and the UI must show a
 * permanent provenance badge. The licensed edition keeps the strict rule.
 */
export const FREE_EDITION_POLICY: RuntimePolicy = {
  environment: "production",
  edition: "free",
  allowUnofficial: true,
  requireVerifiedTerms: false,
  requireProductionReady: false,
  maxDataAgeSeconds: 7 * 24 * 60 * 60,
};

export function policyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RuntimePolicy {
  const environment = (env.NODE_ENV ?? "development") as Environment;
  const edition: DataEdition = env.DATA_EDITION === "free" ? "free" : "licensed";
  const freeEdition = edition === "free";
  return {
    environment,
    edition,
    allowUnofficial: freeEdition || env.ALLOW_UNOFFICIAL_DATA === "true",
    requireVerifiedTerms: environment === "production" && !freeEdition,
    requireProductionReady: environment === "production" && !freeEdition,
  };
}

export interface PolicyEvaluation {
  allowed: boolean;
  reasons: string[];
}

export function evaluateProvider(
  descriptor: ProviderDescriptor,
  policy: RuntimePolicy,
): PolicyEvaluation {
  const reasons: string[] = [];
  const edition = policy.edition ?? "licensed";

  if (descriptor.termsStatus === "prohibited") {
    reasons.push("terms status is prohibited");
  }

  if (descriptor.termsStatus === "restricted") {
    reasons.push("terms status is restricted");
  }

  if (descriptor.sourceType === "unofficial") {
    if (!policy.allowUnofficial) {
      reasons.push("unofficial sources are disabled by policy");
    }
    if (policy.environment === "production" && edition !== "free") {
      reasons.push(
        "unofficial sources are never allowed in licensed production",
      );
    }
  }

  if (descriptor.sourceType === "mock" && policy.environment === "production") {
    reasons.push("mock data is not allowed in production");
  }

  if (
    policy.requireVerifiedTerms &&
    descriptor.termsStatus !== "verified"
  ) {
    reasons.push("terms must be verified");
  }

  if (policy.requireProductionReady && !descriptor.productionReady) {
    reasons.push("provider is not production-ready");
  }

  return { allowed: reasons.length === 0, reasons };
}

export function assertProviderAllowed(
  descriptor: ProviderDescriptor,
  policy: RuntimePolicy,
): void {
  const result = evaluateProvider(descriptor, policy);
  if (!result.allowed) {
    throw new TermsRestrictionError(descriptor.id, result.reasons);
  }
}

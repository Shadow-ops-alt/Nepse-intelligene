import type { Capability } from "@stock/core";
import { evaluateProvider } from "@stock/core";
import type { Check, CheckStatus } from "../types";
import { outcome } from "./helpers";

export const REQUIRED_CAPABILITIES: Capability[] = [
  "companyList",
  "securityList",
  "dailyOhlc",
  "indexHistory",
  "liveQuotes",
  "marketSummary",
  "floorsheet",
  "fundamentals",
  "fundamentalsHistory",
  "corporateActions",
  "ipos",
];

export const PREFERRED_CAPABILITIES: Capability[] = [
  "sectors",
  "indices",
  "sectorPerformance",
  "intradayOhlc",
  "brokerFlows",
  "news",
];

export const providerMetadataCheck: Check = {
  id: "provider-metadata",
  title: "Provider metadata and source classification",
  async run({ provider }) {
    const descriptor = provider.descriptor;
    const details: string[] = [
      `Provider: ${descriptor.name} (${descriptor.id})`,
      `Source type: ${descriptor.sourceType}`,
      `Terms status: ${descriptor.termsStatus}`,
      `Production ready: ${descriptor.productionReady}`,
      `Reliability: ${descriptor.reliability}`,
    ];
    let status: CheckStatus = "pass";

    if (descriptor.sourceType === "mock") {
      details.push(
        "Mock data is a deterministic test fixture, not a market data source.",
      );
      return outcome(
        "pass",
        "Mock provider metadata is valid for development and test use",
        details,
        {
          sourceType: descriptor.sourceType,
          termsStatus: descriptor.termsStatus,
          productionReady: descriptor.productionReady,
        },
      );
    }

    if (descriptor.productionReady && descriptor.termsStatus !== "verified") {
      status = "fail";
      details.push(
        "Provider claims production readiness without verified terms.",
      );
    }

    if (descriptor.termsStatus === "prohibited") {
      status = "fail";
      details.push("Terms are marked prohibited; the provider must not be used.");
    } else if (descriptor.termsStatus === "restricted") {
      status = "fail";
      details.push(
        "Terms are restricted; written permission is required before use.",
      );
    } else if (descriptor.termsStatus === "unverified") {
      status = status === "fail" ? "fail" : "warn";
      details.push(
        "Terms/licensing have not been verified. Data must not ship to production.",
      );
    }

    if (!descriptor.productionReady) {
      status = status === "fail" ? "fail" : "warn";
      details.push("Provider is not marked production-ready.");
    }

    if (
      descriptor.capabilities.includes("dailyOhlc") &&
      descriptor.limits?.maxDailyHistoryDays === undefined
    ) {
      status = status === "fail" ? "fail" : "warn";
      details.push(
        "Provider declares dailyOhlc but does not publish maxDailyHistoryDays.",
      );
    }

    if (descriptor.termsStatus === "verified" && !descriptor.termsUrl) {
      details.push("Terms are verified but no termsUrl is recorded.");
    }

    return outcome(
      status,
      status === "pass"
        ? "Provider metadata is complete and production-safe"
        : "Provider metadata is incomplete or not production-safe",
      details,
      {
        sourceType: descriptor.sourceType,
        termsStatus: descriptor.termsStatus,
        productionReady: descriptor.productionReady,
        reliability: descriptor.reliability,
        hasTermsUrl: Boolean(descriptor.termsUrl),
        hasLicense: Boolean(descriptor.license),
        maxDailyHistoryDays: descriptor.limits?.maxDailyHistoryDays ?? null,
      },
    );
  },
};

export const capabilityCoverageCheck: Check = {
  id: "capability-coverage",
  title: "Capability coverage for the MVP",
  async run({ provider }) {
    const declared = new Set(provider.descriptor.capabilities);
    const missingRequired = REQUIRED_CAPABILITIES.filter(
      (capability) => !declared.has(capability),
    );
    const missingPreferred = PREFERRED_CAPABILITIES.filter(
      (capability) => !declared.has(capability),
    );
    const details = [
      `Declared: ${[...declared].join(", ") || "none"}`,
      `Required: ${REQUIRED_CAPABILITIES.join(", ")}`,
      `Preferred: ${PREFERRED_CAPABILITIES.join(", ")}`,
    ];

    let status: CheckStatus = "pass";
    if (missingRequired.length > 0) {
      status = "fail";
      details.push(`Missing required: ${missingRequired.join(", ")}`);
    }
    if (missingPreferred.length > 0) {
      status = missingRequired.length > 0 ? "fail" : "warn";
      details.push(`Missing preferred: ${missingPreferred.join(", ")}`);
    }

    return outcome(
      status,
      missingRequired.length > 0
        ? `Missing ${missingRequired.length} required MVP capabilit${missingRequired.length === 1 ? "y" : "ies"}`
        : missingPreferred.length > 0
          ? `All required capabilities present; ${missingPreferred.length} preferred missing`
          : "All required and preferred MVP capabilities present",
      details,
      {
        declared: declared.size,
        required: REQUIRED_CAPABILITIES.length,
        preferred: PREFERRED_CAPABILITIES.length,
        missingRequired: missingRequired.length,
        missingPreferred: missingPreferred.length,
        missingRequiredList: missingRequired.join(",") || null,
        missingPreferredList: missingPreferred.join(",") || null,
      },
    );
  },
};

export const policyCheck: Check = {
  id: "runtime-policy",
  title: "Runtime policy enforcement",
  async run({ provider, policy }) {
    const evaluation = evaluateProvider(provider.descriptor, policy);
    const details = [
      `Environment: ${policy.environment}`,
      `Unofficial sources allowed: ${policy.allowUnofficial}`,
      `Require verified terms: ${policy.requireVerifiedTerms}`,
      `Require production ready: ${policy.requireProductionReady}`,
    ];
    if (evaluation.reasons.length > 0) {
      details.push(`Blocked because: ${evaluation.reasons.join("; ")}`);
    }
    return outcome(
      evaluation.allowed ? "pass" : "fail",
      evaluation.allowed
        ? "Provider is allowed by the current runtime policy"
        : "Provider is blocked by the current runtime policy",
      details,
      {
        allowed: evaluation.allowed,
        reasons: evaluation.reasons.join("; ") || null,
        environment: policy.environment,
      },
    );
  },
};

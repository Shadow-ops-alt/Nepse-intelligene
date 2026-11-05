import { describe, expect, it } from "vitest";
import {
  evaluateProvider,
  FREE_EDITION_POLICY,
  policyFromEnv,
  PRODUCTION_POLICY,
} from "./policy";
import type { RuntimePolicy } from "./policy";
import type { ProviderDescriptor } from "./contracts/common";

function descriptor(
  overrides: Partial<ProviderDescriptor> = {},
): ProviderDescriptor {
  return {
    id: "test-provider",
    name: "Test provider",
    sourceType: "licensed",
    environment: "production",
    termsStatus: "verified",
    productionReady: true,
    reliability: "high",
    priority: 10,
    capabilities: ["companyList"],
    configRequired: [],
    ...overrides,
  };
}

const devAllowsUnofficial: RuntimePolicy = {
  environment: "development",
  allowUnofficial: true,
  requireVerifiedTerms: false,
  requireProductionReady: false,
};

describe("provider policy", () => {
  it("allows a licensed, verified, production-ready provider in production", () => {
    const result = evaluateProvider(descriptor(), PRODUCTION_POLICY);
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("never allows unofficial data in production", () => {
    const result = evaluateProvider(
      descriptor({
        sourceType: "unofficial",
        termsStatus: "unverified",
        productionReady: false,
      }),
      { ...PRODUCTION_POLICY, allowUnofficial: true },
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain(
      "unofficial sources are never allowed in licensed production",
    );
  });

  it("allows unofficial data only in the explicit free edition", () => {
    const unofficial = descriptor({
      sourceType: "unofficial",
      termsStatus: "unverified",
      productionReady: false,
    });

    expect(
      evaluateProvider(unofficial, FREE_EDITION_POLICY).allowed,
    ).toBe(true);

    // The same provider is still blocked in licensed production.
    expect(
      evaluateProvider(unofficial, {
        ...PRODUCTION_POLICY,
        allowUnofficial: true,
      }).allowed,
    ).toBe(false);
  });

  it("requires an explicit development opt-in for unofficial data", () => {
    const unofficial = descriptor({
      sourceType: "unofficial",
      environment: "development",
      termsStatus: "unverified",
      productionReady: false,
    });
    expect(
      evaluateProvider(unofficial, {
        ...devAllowsUnofficial,
        allowUnofficial: false,
      }).allowed,
    ).toBe(false);
    expect(evaluateProvider(unofficial, devAllowsUnofficial).allowed).toBe(true);
  });

  it("blocks restricted terms even when production-ready is claimed", () => {
    const result = evaluateProvider(
      descriptor({ termsStatus: "restricted" }),
      PRODUCTION_POLICY,
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("terms status is restricted");
  });

  it("blocks mock providers in production", () => {
    const result = evaluateProvider(
      descriptor({
        sourceType: "mock",
        environment: "test",
        termsStatus: "verified",
        productionReady: false,
      }),
      PRODUCTION_POLICY,
    );
    expect(result.allowed).toBe(false);
  });

  it("derives the free edition from the environment", () => {
    const free = policyFromEnv({
      NODE_ENV: "production",
      DATA_EDITION: "free",
    });
    expect(free.edition).toBe("free");
    expect(free.allowUnofficial).toBe(true);
    expect(free.requireVerifiedTerms).toBe(false);
    expect(free.requireProductionReady).toBe(false);

    const licensed = policyFromEnv({ NODE_ENV: "production" });
    expect(licensed.edition).toBe("licensed");
    expect(licensed.allowUnofficial).toBe(false);
    expect(licensed.requireVerifiedTerms).toBe(true);
    expect(licensed.requireProductionReady).toBe(true);
  });
});

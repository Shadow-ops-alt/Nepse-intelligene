import { describe, expect, it } from "vitest";
import {
  classificationFor,
  computeDataState,
  createMeta,
  isStale,
} from "./freshness";
import { DataQualityError } from "./errors";
import type { ProviderDescriptor } from "./contracts/common";

const mockDescriptor: ProviderDescriptor = {
  id: "mock",
  name: "Mock",
  sourceType: "mock",
  environment: "test",
  termsStatus: "verified",
  productionReady: false,
  reliability: "high",
  priority: 100,
  capabilities: ["companyList"],
  configRequired: [],
};

describe("freshness metadata", () => {
  it("records age and fetch time", () => {
    const now = new Date("2026-11-04T10:00:00.000Z");
    const meta = createMeta({
      descriptor: mockDescriptor,
      asOf: "2026-11-04T09:59:00.000Z",
      now,
    });
    expect(meta.fetchedAt).toBe(now.toISOString());
    expect(meta.ageSeconds).toBe(60);
    expect(meta.stale).toBe(false);
  });

  it("refuses to mark unofficial data as production-ready", () => {
    expect(() =>
      createMeta({
        descriptor: {
          ...mockDescriptor,
          sourceType: "unofficial",
          productionReady: true,
        },
      }),
    ).toThrow(DataQualityError);
  });

  it("treats data older than the threshold as stale", () => {
    const now = new Date("2026-11-04T10:00:00.000Z");
    expect(isStale("2026-11-04T09:50:00.000Z", 300, now)).toBe(true);
    expect(isStale("2026-11-04T09:58:00.000Z", 300, now)).toBe(false);
  });

  it("classifies mock data as DEMO and unofficial data as UNVERIFIED", () => {
    expect(classificationFor(mockDescriptor)).toBe("DEMO");
    expect(
      classificationFor({ ...mockDescriptor, sourceType: "unofficial" }),
    ).toBe("UNVERIFIED");
    expect(
      classificationFor({ ...mockDescriptor, sourceType: "manual" }),
    ).toBe("UNVERIFIED");
    expect(classificationFor(mockDescriptor, true)).toBe("DEMO");
  });

  it("refuses to mark unofficial data VERIFIED", () => {
    expect(() =>
      createMeta({
        descriptor: {
          ...mockDescriptor,
          sourceType: "unofficial",
          productionReady: false,
        },
        classification: "VERIFIED",
      }),
    ).toThrow(/only a licensed/);
  });

  it("computes live, delayed, eod and stale states", () => {
    const now = new Date("2026-11-04T10:00:00.000Z");
    expect(
      computeDataState({
        asOf: "2026-11-04T09:58:00.000Z",
        maxAgeSeconds: 300,
        mode: "live",
        now,
      }),
    ).toBe("live");
    expect(
      computeDataState({
        asOf: "2026-11-04T09:50:00.000Z",
        maxAgeSeconds: 300,
        mode: "live",
        now,
      }),
    ).toBe("delayed");
    expect(
      computeDataState({
        asOf: "2026-11-04T08:00:00.000Z",
        maxAgeSeconds: 300,
        mode: "live",
        now,
      }),
    ).toBe("stale");
    expect(
      computeDataState({
        asOf: "2026-11-03T09:15:00.000Z",
        maxAgeSeconds: 3 * 24 * 60 * 60,
        mode: "daily",
        now,
      }),
    ).toBe("eod");
    expect(
      computeDataState({
        maxAgeSeconds: 300,
        mode: "live",
        hasData: false,
        now,
      }),
    ).toBe("unavailable");
  });

  it("attaches state and stale when a max age is supplied", () => {
    const now = new Date("2026-11-04T10:00:00.000Z");
    const meta = createMeta({
      descriptor: mockDescriptor,
      asOf: "2026-11-01T09:00:00.000Z",
      maxAgeSeconds: 24 * 60 * 60,
      stateMode: "daily",
      now,
    });
    expect(meta.state).toBe("stale");
    expect(meta.stale).toBe(true);
    expect(meta.classification).toBe("DEMO");
    expect(meta.warnings.join(" ")).toMatch(/old/);
  });
});

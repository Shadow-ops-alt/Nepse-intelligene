import { describe, expect, it } from "vitest";
import type { RuntimePolicy } from "@stock/core";
import { MockProvider } from "@stock/providers";
import { validateProvider } from "./validate";

const policy: RuntimePolicy = {
  environment: "development",
  allowUnofficial: false,
  requireVerifiedTerms: false,
  requireProductionReady: false,
};

describe("validateProvider", () => {
  it("runs the full Phase 0 check suite against the mock provider", async () => {
    const report = await validateProvider({
      provider: new MockProvider(),
      policy,
      historyYears: 5,
    });

    expect(report.policyAllowed).toBe(true);
    expect(report.summary.fail).toBe(0);
    expect(report.checks.length).toBeGreaterThanOrEqual(16);

    const history = report.checks.find(
      (check) => check.id === "daily-ohlc-history",
    );
    expect(history?.status).toBe("pass");
    expect(history?.metrics.tradingDays).toBeGreaterThan(1_200);

    const floorsheet = report.checks.find(
      (check) => check.id === "floorsheet",
    );
    expect(floorsheet?.status).toBe("pass");
    expect(floorsheet?.metrics.matchingDate).toBe(
      floorsheet?.metrics.trades,
    );
  });

  it("reports a no-go verdict when policy blocks the provider", async () => {
    const report = await validateProvider({
      provider: new MockProvider(),
      policy: {
        environment: "production",
        allowUnofficial: false,
        requireVerifiedTerms: true,
        requireProductionReady: true,
      },
    });
    expect(report.policyAllowed).toBe(false);
    expect(report.summary.verdict).toBe("no-go");
  });
});

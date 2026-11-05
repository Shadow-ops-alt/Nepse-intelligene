import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "@stock/core";
import { MockProvider } from "./mock-provider";

describe("MockProvider", () => {
  it("declares capabilities that the registry can verify", () => {
    const registry = new ProviderRegistry();
    expect(() => registry.register(new MockProvider())).not.toThrow();

    const declared = registry.list()[0]!.capabilities;
    expect(declared).toContain("dailyOhlc");
    expect(declared).toContain("indexHistory");
    expect(declared).toContain("fundamentalsHistory");
    expect(declared).toContain("floorsheet");
  });

  it("returns at least five years of deterministic daily candles", async () => {
    const provider = new MockProvider();
    const result = await provider.getDailyOhlc("NABIL", {
      from: "2021-11-04",
      to: "2026-11-04",
    });
    expect(result.data.length).toBeGreaterThan(1_200);
    expect(result.data[0]!.timestamp.slice(0, 10)).toBe("2021-11-04");
    expect(result.data.at(-1)!.timestamp.slice(0, 10)).toBe("2026-11-04");
    expect(result.meta.sourceType).toBe("mock");
    expect(result.meta.productionReady).toBe(false);
  });

  it("returns daily and intraday candles for the same symbol", async () => {
    const provider = new MockProvider();
    const daily = await provider.getDailyOhlc("NABIL", {
      from: "2026-10-01",
      to: "2026-11-04",
    });
    const intraday = await provider.getIntradayOhlc("NABIL", {
      from: "2026-11-04",
      to: "2026-11-04",
    });
    expect(daily.data[0]!.timeframe).toBe("1day");
    expect(intraday.data[0]!.timeframe).toBe("5min");
    expect(intraday.data.length).toBeGreaterThan(0);
  });
});

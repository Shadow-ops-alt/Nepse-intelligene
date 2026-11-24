import { describe, expect, it } from "vitest";
import { xirr } from "./xirr";

describe("xirr", () => {
  it("solves a simple one-year 10% return", () => {
    const rate = xirr([
      { date: "2025-01-01", amount: -1000 },
      { date: "2026-01-01", amount: 1100 },
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.1, 6);
  });

  it("solves multiple irregular flows", () => {
    // The final flow is chosen so the true rate is exactly 10%:
    // -1000 + 300/1.1^0.5 + 785.358/1.1 = 0.
    const rate = xirr([
      { date: "2025-01-01", amount: -1000 },
      { date: "2025-07-03", amount: 300 },
      { date: "2026-01-01", amount: 785.358 },
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.1, 3);
  });

  it("returns a negative rate for a loss", () => {
    const rate = xirr([
      { date: "2025-01-01", amount: -1000 },
      { date: "2026-01-01", amount: 900 },
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(-0.1, 6);
  });

  it("returns null when there is no sign change", () => {
    expect(
      xirr([
        { date: "2025-01-01", amount: 100 },
        { date: "2026-01-01", amount: 200 },
      ]),
    ).toBeNull();
    expect(
      xirr([
        { date: "2025-01-01", amount: -100 },
        { date: "2026-01-01", amount: -200 },
      ]),
    ).toBeNull();
  });

  it("returns null for an empty series", () => {
    expect(xirr([])).toBeNull();
    expect(xirr([{ date: "2025-01-01", amount: -100 }])).toBeNull();
  });

  it("returns null for an invalid date", () => {
    expect(
      xirr([
        { date: "not-a-date", amount: -100 },
        { date: "2026-01-01", amount: 110 },
      ]),
    ).toBeNull();
  });

  it("accepts ISO timestamps", () => {
    const rate = xirr([
      { date: "2025-01-01T09:15:00.000Z", amount: -1000 },
      { date: "2026-01-01T00:00:00.000Z", amount: 1100 },
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.1, 6);
  });
});

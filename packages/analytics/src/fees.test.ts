import { describe, expect, it } from "vitest";
import {
  NEPSE_FEE_SCHEDULE,
  bonusAdjustedPrice,
  bonusRightAdjustedPrice,
  breakevenSellPrice,
  brokerCommission,
  buyCost,
  capitalGainsTaxRate,
  commissionTierFor,
  dividendYield,
  resolveFeeSchedule,
  rightAdjustedPrice,
  sellProceeds,
  weightedAverageCost,
} from "./fees";

describe("brokerCommission", () => {
  it("applies the band rate to the whole amount at each tier boundary", () => {
    // ≤ 50,000 → 0.36%
    expect(brokerCommission(50_000)).toBe(180);
    // 50,001 × 0.33% = 165.0033
    expect(brokerCommission(50_001)).toBe(165);
    // ≤ 500,000 → 0.33%
    expect(brokerCommission(500_000)).toBe(1_650);
    // 500,001 × 0.31% = 1,550.0031
    expect(brokerCommission(500_001)).toBe(1_550);
    // ≤ 2,000,000 → 0.31%
    expect(brokerCommission(2_000_000)).toBe(6_200);
    // 2,000,001 × 0.27% = 5,400.0027
    expect(brokerCommission(2_000_001)).toBe(5_400);
    // ≤ 10,000,000 → 0.27%
    expect(brokerCommission(10_000_000)).toBe(27_000);
    // 10,000,001 × 0.24% = 24,000.0024
    expect(brokerCommission(10_000_001)).toBe(24_000);
  });

  it("is a flat band rate, not marginal", () => {
    // Flat: 600,000 × 0.31% = 1,860. Marginal would be 180 + 1,485 + 310 = 1,975.
    expect(brokerCommission(600_000)).toBe(1_860);
  });

  it("never charges less than the Rs 10 minimum", () => {
    expect(brokerCommission(1_000)).toBe(10); // 3.60 by rate
    expect(brokerCommission(2_777)).toBe(10); // 9.9972 by rate
    expect(brokerCommission(2_800)).toBe(10.08);
    expect(brokerCommission(0)).toBe(0);
  });

  it("reports the matched band", () => {
    expect(commissionTierFor(50_000)).toEqual({
      index: 0,
      from: 0,
      upTo: 50_000,
      ratePercent: 0.36,
    });
    expect(commissionTierFor(750_000)).toEqual({
      index: 2,
      from: 500_000,
      upTo: 2_000_000,
      ratePercent: 0.31,
    });
    expect(commissionTierFor(50_000_000)).toEqual({
      index: 4,
      from: 10_000_000,
      upTo: null,
      ratePercent: 0.24,
    });
  });

  it("takes schedule overrides", () => {
    expect(brokerCommission(1_000, { minCommission: 0 })).toBe(3.6);
    expect(
      brokerCommission(1_000, { commissionTiers: [{ upTo: null, ratePercent: 1 }] }),
    ).toBe(10);
  });

  it("rejects negative amounts", () => {
    expect(() => brokerCommission(-1)).toThrow(RangeError);
  });
});

describe("buyCost", () => {
  it("adds commission, SEBON fee and DP charge", () => {
    // 100 × 500 = 50,000 → 180 (0.36%) + 7.5 (0.015%) + 25 = 50,212.5
    expect(buyCost({ quantity: 100, price: 500 })).toEqual({
      amount: 50_000,
      commission: 180,
      commissionRatePercent: 0.36,
      minCommissionApplied: false,
      sebonFee: 7.5,
      dpCharge: 25,
      nameTransferFee: 0,
      fees: 212.5,
      total: 50_212.5,
      costPerShare: 502.13, // 502.125
    });
  });

  it("flags the minimum commission on small buys", () => {
    // 10 × 100 = 1,000 → min 10 + SEBON 0.15 + DP 25 = 1,035.15
    const result = buyCost({ quantity: 10, price: 100 });
    expect(result.commission).toBe(10);
    expect(result.minCommissionApplied).toBe(true);
    expect(result.sebonFee).toBe(0.15);
    expect(result.total).toBe(1_035.15);
  });

  it("applies the name-transfer fee only when configured", () => {
    expect(NEPSE_FEE_SCHEDULE.nameTransferFee).toBe(0);
    const result = buyCost({ quantity: 100, price: 500, schedule: { nameTransferFee: 5 } });
    expect(result.nameTransferFee).toBe(5);
    expect(result.total).toBe(50_217.5);
  });

  it("rejects a zero quantity", () => {
    expect(() => buyCost({ quantity: 0, price: 500 })).toThrow(RangeError);
  });
});

describe("sellProceeds", () => {
  const buyCostTotal = 50_212.5; // 100 @ 500

  it("computes fees, CGT and net profit for a short-term individual", () => {
    // 100 × 600 = 60,000 → commission 198 (0.33%), SEBON 9, DP 25
    // before tax 59,768; gain 9,555.5; CGT 7.5% = 716.6625
    const result = sellProceeds({
      quantity: 100,
      price: 600,
      buyCostTotal,
      holdingDays: 100,
      investor: "individual",
    });
    expect(result.amount).toBe(60_000);
    expect(result.commission).toBe(198);
    expect(result.commissionRatePercent).toBe(0.33);
    expect(result.sebonFee).toBe(9);
    expect(result.dpCharge).toBe(25);
    expect(result.fees).toBe(232);
    expect(result.receivableBeforeTax).toBe(59_768);
    expect(result.gain).toBe(9_555.5);
    expect(result.cgtRate).toBe(7.5);
    expect(result.cgt).toBe(716.66);
    expect(result.receivable).toBe(59_051.34); // 59,051.3375
    expect(result.netProfit).toBe(8_838.84); // 8,838.8375
    expect(result.returnPercent).toBeCloseTo(17.6029, 4); // 8,838.8375 / 50,212.5
  });

  it("switches the individual CGT rate at 365 days", () => {
    const at = (holdingDays: number) =>
      sellProceeds({ quantity: 100, price: 600, buyCostTotal, holdingDays, investor: "individual" });
    expect(at(364).cgtRate).toBe(7.5);
    expect(at(365).cgtRate).toBe(5);
    expect(at(365).cgt).toBe(477.78); // 9,555.5 × 5% = 477.775
    expect(capitalGainsTaxRate(364, "individual")).toBe(7.5);
    expect(capitalGainsTaxRate(365, "individual")).toBe(5);
  });

  it("charges institutions 10% regardless of holding period", () => {
    for (const holdingDays of [10, 400]) {
      const result = sellProceeds({
        quantity: 100,
        price: 600,
        buyCostTotal,
        holdingDays,
        investor: "institution",
      });
      expect(result.cgtRate).toBe(10);
      expect(result.cgt).toBe(955.55);
      expect(result.netProfit).toBe(8_599.95);
    }
  });

  it("charges no CGT on a loss", () => {
    // 100 × 400 = 40,000 → commission 144 (0.36%), SEBON 6, DP 25 → 39,825
    const result = sellProceeds({
      quantity: 100,
      price: 400,
      buyCostTotal,
      holdingDays: 30,
      investor: "individual",
    });
    expect(result.receivableBeforeTax).toBe(39_825);
    expect(result.gain).toBe(-10_387.5);
    expect(result.cgt).toBe(0);
    expect(result.receivable).toBe(39_825);
    expect(result.netProfit).toBe(-10_387.5);
    expect(result.returnPercent).toBeCloseTo(-20.6871, 4);
  });

  it("returns a null return percent for a zero cost basis", () => {
    const result = sellProceeds({
      quantity: 10,
      price: 500,
      buyCostTotal: 0,
      holdingDays: 400,
      investor: "individual",
    });
    expect(result.returnPercent).toBeNull();
  });
});

describe("breakevenSellPrice", () => {
  const base = {
    quantity: 100,
    buyCostTotal: 50_212.5,
    holdingDays: 30,
    investor: "individual" as const,
  };
  const profitAt = (price: number, input = base) =>
    sellProceeds({ ...input, price }).netProfit;

  it("finds the lowest paisa price with non-negative net profit", () => {
    // Needs 50,412 × (1 − 0.33% − 0.015%) − 25 ≥ 50,212.5 → 504.12
    const price = breakevenSellPrice(base);
    expect(price).toBe(504.12);
    expect(profitAt(price)).toBeGreaterThanOrEqual(0);
    expect(profitAt(price)).toBeLessThan(1); // within a paisa per share
    expect(profitAt(price - 0.01)).toBeLessThan(0);
  });

  it("does not depend on the CGT rate at breakeven", () => {
    expect(breakevenSellPrice({ ...base, investor: "institution" })).toBe(504.12);
    expect(breakevenSellPrice({ ...base, holdingDays: 500 })).toBe(504.12);
  });

  it("handles the upward jump at a commission band edge", () => {
    // At 500.00 the 0.36% band leaves 49,787.5; at 500.01 the 0.33% band
    // leaves 49,803.50, so a cost of 49,795 breaks even at 500.01.
    const input = { ...base, buyCostTotal: 49_795 };
    const price = breakevenSellPrice(input);
    expect(price).toBe(500.01);
    expect(profitAt(500, input)).toBeLessThan(0);
    expect(profitAt(price, input)).toBeGreaterThan(0);
  });

  it("accounts for CGT when solving for a target profit", () => {
    // Short-term: gain × 92.5% ≥ 1,000 → 514.97. Long-term: gain × 95% → 514.68.
    expect(breakevenSellPrice({ ...base, targetNetProfit: 1_000 })).toBe(514.97);
    expect(
      breakevenSellPrice({ ...base, holdingDays: 365, targetNetProfit: 1_000 }),
    ).toBe(514.68);
    expect(profitAt(514.97)).toBeGreaterThanOrEqual(1_000);
    expect(profitAt(514.96)).toBeLessThan(1_000);
  });
});

describe("weightedAverageCost", () => {
  it("averages lots with buy fees capitalised", () => {
    // 50,212.5 + (22,500 + 81 + 3.375 + 25) = 72,821.875 over 150 shares
    const result = weightedAverageCost([
      { quantity: 100, price: 500, includeFees: true },
      { quantity: 50, price: 450, includeFees: true },
    ]);
    expect(result.totalQuantity).toBe(150);
    expect(result.totalCost).toBe(72_821.88);
    expect(result.averageCost).toBe(485.48); // 485.479166…
    expect(result.lots[1]).toEqual({
      quantity: 50,
      price: 450,
      includeFees: true,
      amount: 22_500,
      fees: 109.38, // 109.375
      cost: 22_609.38,
    });
  });

  it("uses the bare price when fees are off (the default)", () => {
    const result = weightedAverageCost([
      { quantity: 100, price: 500 },
      { quantity: 50, price: 450 },
    ]);
    expect(result.totalCost).toBe(72_500);
    expect(result.averageCost).toBe(483.33);
  });

  it("mixes secondary and IPO lots", () => {
    // 50,212.5 + 1,000 = 51,212.5 over 110 shares = 465.5681…
    const result = weightedAverageCost([
      { quantity: 100, price: 500, includeFees: true },
      { quantity: 10, price: 100, includeFees: false },
    ]);
    expect(result.averageCost).toBe(465.57);
  });

  it("returns null for no shares", () => {
    expect(weightedAverageCost([]).averageCost).toBeNull();
  });
});

describe("corporate-action price adjustments", () => {
  it("adjusts for bonus shares", () => {
    expect(bonusAdjustedPrice(600, 20)).toBe(500);
    expect(bonusAdjustedPrice(1_000, 15)).toBe(869.57); // 869.565…
    expect(bonusAdjustedPrice(600, 0)).toBe(600);
  });

  it("adjusts for right shares", () => {
    expect(rightAdjustedPrice(600, 50)).toBe(433.33); // 650 / 1.5
    expect(rightAdjustedPrice(400, 30, 100)).toBe(330.77); // 430 / 1.3
    expect(rightAdjustedPrice(600, 50, 200)).toBe(466.67); // 700 / 1.5
  });

  it("adjusts for a simultaneous bonus and right issue", () => {
    expect(bonusRightAdjustedPrice(600, 10, 50)).toBe(406.25); // 650 / 1.6
    expect(bonusRightAdjustedPrice(600, 20, 0)).toBe(bonusAdjustedPrice(600, 20));
    expect(bonusRightAdjustedPrice(600, 0, 50)).toBe(rightAdjustedPrice(600, 50));
  });
});

describe("dividendYield", () => {
  it("computes cash yield and dividend taxes per share", () => {
    const result = dividendYield({ cashDividendPercent: 10, bonusPercent: 15, price: 500 });
    expect(result.cashPerShare).toBe(10);
    expect(result.cashYieldPercent).toBe(2);
    expect(result.taxOnCash).toBe(0.5);
    expect(result.bonusFaceValuePerShare).toBe(15);
    expect(result.taxOnBonus).toBe(0.75);
    expect(result.netCashPerShare).toBe(8.75);
    expect(result.netCashYieldPercent).toBe(1.75);
    expect(result.bonusSharesPerShare).toBe(0.15);
    expect(result.totals).toBeNull();
  });

  it("totals a holding", () => {
    const result = dividendYield({
      cashDividendPercent: 10,
      bonusPercent: 15,
      price: 500,
      quantity: 1_000,
    });
    expect(result.totals).toEqual({
      quantity: 1_000,
      grossCash: 10_000,
      taxOnCash: 500,
      taxOnBonus: 750,
      netCash: 8_750,
      bonusShares: 150,
    });
  });

  it("shows the bonus tax as owed when there is no cash dividend", () => {
    const result = dividendYield({ cashDividendPercent: 0, bonusPercent: 10, price: 400 });
    expect(result.taxOnBonus).toBe(0.5);
    expect(result.netCashPerShare).toBe(-0.5);
  });
});

describe("fee schedule", () => {
  it("is frozen and carries a provenance note", () => {
    expect(Object.isFrozen(NEPSE_FEE_SCHEDULE)).toBe(true);
    expect(NEPSE_FEE_SCHEDULE.verifiedAsOf).toMatch(/broker/i);
  });

  it("ignores undefined overrides", () => {
    const resolved = resolveFeeSchedule({ sebonFeePercent: undefined, dpChargePerScrip: 0 });
    expect(resolved.sebonFeePercent).toBe(0.015);
    expect(resolved.dpChargePerScrip).toBe(0);
  });
});

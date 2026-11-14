import { describe, expect, it } from "vitest";
import type { Candle } from "@stock/core";
import {
  adx,
  autoTrendlines,
  averageAbsoluteMove,
  crossEvents,
  divergences,
  ichimoku,
  marketStructure,
  obv,
  parabolicSar,
  signalEvents,
  supertrend,
  supplyDemandZones,
  supportResistanceZones,
  swingPoints,
  volumeAnalysis,
} from "./technicals";

function dayString(offset: number, start = "2025-01-01"): string {
  const base = Date.parse(`${start}T00:00:00Z`);
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

function bar(
  day: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000,
): Candle {
  return {
    symbol: "TEST",
    timeframe: "1day",
    timestamp: `${day}T15:00:00+05:45`,
    open,
    high,
    low,
    close,
    volume,
    adjusted: false,
  };
}

/** Candles whose open = close and whose high/low sit `spread` either side. */
function fromCloses(closes: number[], spread = 1, start = "2025-01-01"): Candle[] {
  return closes.map((close, index) =>
    bar(dayString(index, start), close, close + spread, close - spread, close),
  );
}

/** Piecewise-linear closes through [index, price] anchors (test data only). */
function path(points: Array<[number, number]>): number[] {
  const out: number[] = [];
  for (let k = 1; k < points.length; k += 1) {
    const [i0, p0] = points[k - 1]!;
    const [i1, p1] = points[k]!;
    for (let i = i0; i < i1; i += 1) out.push(p0 + ((p1 - p0) * (i - i0)) / (i1 - i0));
  }
  out.push(points.at(-1)![1]);
  return out;
}

function flat(length: number, price = 100, volume = 0): Candle[] {
  return Array.from({ length }, (_, index) =>
    bar(dayString(index), price, price, price, price, volume),
  );
}

describe("supertrend", () => {
  it("flips down on the decline and back up on the recovery of a V", () => {
    const closes = [
      ...Array.from({ length: 20 }, (_, i) => 100 - 2 * i), // 100 → 62
      ...Array.from({ length: 20 }, (_, i) => 64 + 2 * i), // 64 → 102
    ];
    const { value, direction } = supertrend(fromCloses(closes), 10, 3);
    expect(direction.slice(0, 9).every((d) => d === null)).toBe(true);
    expect(direction[9]).toBe(1); // close = hl2 seeds an uptrend
    expect(direction[19]).toBe(-1); // bottom of the V
    expect(direction.at(-1)).toBe(1);

    const flips = direction
      .map((d, i) => (i > 0 && d !== null && direction[i - 1] !== null && d !== direction[i - 1] ? i : -1))
      .filter((i) => i >= 0);
    expect(flips).toHaveLength(2);
    expect(flips[0]).toBeLessThan(19);
    expect(flips[1]).toBeGreaterThan(20);
    // The line sits under price in the uptrend and over it in the downtrend.
    expect(value.at(-1)!).toBeLessThan(closes.at(-1)!);
    expect(value[19]!).toBeGreaterThan(closes[19]!);
  });

  it("does not throw or flip on a flat untraded series", () => {
    const { direction } = supertrend(flat(30));
    expect(new Set(direction.slice(9))).toEqual(new Set([1]));
    expect(supertrend([]).value).toEqual([]);
  });
});

describe("ichimoku", () => {
  it("computes unshifted Donchian midpoints", () => {
    // close = i, high = i + 1, low = i − 1
    const candles = fromCloses(Array.from({ length: 12 }, (_, i) => i));
    const result = ichimoku(candles, 3, 5, 7, 5);
    expect(result.displacement).toBe(5);
    expect(result.conversion[1]).toBeNull();
    expect(result.conversion[2]).toBe(1); // (3 + −1) / 2
    expect(result.conversion[11]).toBe(10); // i − 1
    expect(result.base[3]).toBeNull();
    expect(result.base[11]).toBe(9); // i − 2
    expect(result.spanA[3]).toBeNull();
    expect(result.spanA[11]).toBe(9.5); // i − 1.5
    expect(result.spanB[5]).toBeNull();
    expect(result.spanB[11]).toBe(8); // i − 3
    expect(result.lagging[11]).toBe(11);
    expect(result.lagging).toHaveLength(12);
  });
});

describe("parabolicSar", () => {
  it("trails a rising series and flips on the first penetration", () => {
    const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 12, 11, 10];
    const sar = parabolicSar(fromCloses(closes, 0.5));
    expect(sar[0]).toBeNull();
    expect(sar[1]).toEqual({ value: 9.5, trend: 1 }); // low₀
    expect(sar[2]).toEqual({ value: 9.5, trend: 1 }); // clamped to low₀
    // EP 12.5, AF 0.04: 9.5 + 0.04 × (12.5 − 9.5)
    expect(sar[3]!.value).toBeCloseTo(9.62, 10);
    for (let i = 1; i <= 8; i += 1) {
      expect(sar[i]!.trend).toBe(1);
      expect(sar[i]!.value).toBeLessThan(closes[i]! - 0.5 + 1e-9);
    }
    // Low 11.5 trades through the SAR (≈ 13.28): reverse at the prior extreme high 18.5.
    expect(sar[9]).toEqual({ value: 18.5, trend: -1 });
    expect(sar[11]!.trend).toBe(-1);
    expect(sar[11]!.value).toBeGreaterThan(closes[11]! + 0.5);
  });

  it("never flips on untraded flat sessions", () => {
    const sar = parabolicSar(flat(20));
    expect(sar.slice(1).every((p) => p?.trend === 1 && p.value === 100)).toBe(true);
    expect(parabolicSar(flat(1))).toEqual([null]);
  });
});

describe("obv", () => {
  it("adds volume on up closes and subtracts on down closes", () => {
    const closes = [10, 11, 11, 10, 12];
    const volumes = [100, 200, 300, 400, 500];
    const candles = closes.map((c, i) => bar(dayString(i), c, c, c, c, volumes[i]));
    expect(obv(candles)).toEqual([0, 200, 200, -200, 300]);
    // Unsorted input is sorted first.
    expect(obv([...candles].reverse())).toEqual([0, 200, 200, -200, 300]);
    expect(obv([])).toEqual([]);
  });
});

describe("adx", () => {
  it("rises in a strong trend after a choppy range", () => {
    const chop = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 100 : 101));
    const trend = Array.from({ length: 40 }, (_, i) => 102 + 2 * i);
    const result = adx(fromCloses([...chop, ...trend]), 14);
    expect(result.plusDi[13]).toBeNull();
    expect(result.plusDi[14]).not.toBeNull();
    expect(result.adx[26]).toBeNull();
    expect(result.adx[27]).not.toBeNull();
    const choppy = result.adx[39]!;
    const trending = result.adx.at(-1)!;
    expect(choppy).toBeLessThan(25);
    expect(trending).toBeGreaterThan(50);
    expect(trending).toBeGreaterThan(choppy);
    expect(result.plusDi.at(-1)!).toBeGreaterThan(result.minusDi.at(-1)!);
  });

  it("is 100 for a perfectly linear uptrend and 0 for a flat series", () => {
    const up = adx(fromCloses(Array.from({ length: 40 }, (_, i) => 50 + i)), 14);
    expect(up.adx.at(-1)).toBeCloseTo(100, 8);
    expect(up.minusDi.at(-1)).toBe(0);
    const still = adx(flat(40), 14);
    expect(still.adx.at(-1)).toBe(0);
    expect(still.plusDi.at(-1)).toBe(0);
    expect(adx(flat(5)).adx.every((v) => v === null)).toBe(true);
  });
});

describe("swingPoints", () => {
  it("finds strict fractal pivots on a zig-zag", () => {
    const candles = fromCloses([1, 2, 3, 4, 3, 2, 1, 2, 3, 2, 1], 0.5);
    expect(swingPoints(candles, 2, 2)).toEqual([
      { index: 3, type: "high", price: 4.5 },
      { index: 6, type: "low", price: 0.5 },
      { index: 8, type: "high", price: 3.5 },
    ]);
  });

  it("ignores ties and unconfirmed pivots", () => {
    expect(swingPoints(fromCloses([1, 2, 3, 3, 2, 1]), 2, 2)).toEqual([]);
    // The peak at index 4 has only one session after it.
    expect(swingPoints(fromCloses([1, 2, 3, 4, 5, 4]), 2, 2)).toEqual([]);
    expect(swingPoints(flat(50))).toEqual([]);
  });
});

describe("marketStructure", () => {
  it("labels continuation breaks BOS and reversals CHoCH", () => {
    const closes = [10, 12, 11, 13, 12, 14, 13, 11, 12, 10, 13];
    const events = marketStructure(fromCloses(closes, 0.5), 1, 1);
    expect(events).toEqual([
      { index: 3, type: "BOS", direction: "bullish", level: 12.5, swingIndex: 1 },
      { index: 5, type: "BOS", direction: "bullish", level: 13.5, swingIndex: 3 },
      { index: 7, type: "CHoCH", direction: "bearish", level: 11.5, swingIndex: 4 },
      { index: 9, type: "BOS", direction: "bearish", level: 10.5, swingIndex: 7 },
      { index: 10, type: "CHoCH", direction: "bullish", level: 12.5, swingIndex: 8 },
    ]);
  });

  it("breaks each swing level only once", () => {
    // Swing high 12.5 (index 1) is broken at 3; the close at 6 is above it
    // again but no newer swing high has confirmed (13.5 is tied at 3 and 4).
    const closes = [10, 12, 11, 13, 13, 12, 13];
    const events = marketStructure(fromCloses(closes, 0.5), 1, 1);
    expect(events.filter((e) => e.direction === "bullish")).toEqual([
      { index: 3, type: "BOS", direction: "bullish", level: 12.5, swingIndex: 1 },
    ]);
  });
});

describe("divergences", () => {
  const lows = fromCloses(path([[0, 100], [5, 90], [10, 100], [15, 85], [20, 100]]), 0.5);

  it("finds a regular bullish divergence on lower price lows", () => {
    const oscillator: Array<number | null> = lows.map(() => 50);
    oscillator[5] = 20;
    oscillator[15] = 30;
    expect(divergences(lows, oscillator)).toEqual([
      { type: "regular-bullish", fromIndex: 5, toIndex: 15 },
    ]);
    // Too far apart, or a null oscillator, is skipped.
    expect(divergences(lows, oscillator, 3, 3, 5)).toEqual([]);
    oscillator[5] = null;
    expect(divergences(lows, oscillator)).toEqual([]);
  });

  it("finds a hidden bearish divergence on lower price highs", () => {
    const highs = fromCloses(path([[0, 100], [5, 110], [10, 100], [15, 105], [20, 100]]), 0.5);
    const oscillator: Array<number | null> = highs.map(() => 50);
    oscillator[5] = 60;
    oscillator[15] = 70;
    expect(divergences(highs, oscillator)).toEqual([
      { type: "hidden-bearish", fromIndex: 5, toIndex: 15 },
    ]);
  });
});

describe("supportResistanceZones", () => {
  it("clusters swing highs and lows within tolerance", () => {
    const closes = path([
      [0, 95],
      [5, 100],
      [10, 90],
      [15, 100.5],
      [20, 90.4],
      [25, 99.8],
      [30, 95],
    ]);
    const zones = supportResistanceZones(fromCloses(closes, 0));
    expect(zones).toHaveLength(2);
    expect(zones[0]).toMatchObject({ kind: "resistance", low: 99.8, high: 100.5, touches: 3, lastIndex: 25 });
    expect(zones[0]!.mid).toBeCloseTo(100.1, 8);
    expect(zones[1]).toMatchObject({ kind: "support", low: 90, high: 90.4, touches: 2, lastIndex: 20 });
    expect(zones[1]!.mid).toBeCloseTo(90.2, 8);

    // A tighter tolerance splits the resistance cluster.
    expect(supportResistanceZones(fromCloses(closes, 0), { tolerancePct: 0.1 }).length).toBeGreaterThan(2);
    expect(supportResistanceZones(fromCloses(closes, 0), { maxZones: 1 })).toHaveLength(1);
    expect(supportResistanceZones(flat(100))).toEqual([]);
  });
});

describe("supplyDemandZones", () => {
  function rangeBars(count: number, startIndex: number, mid: number): Candle[] {
    return Array.from({ length: count }, (_, i) => {
      const up = (startIndex + i) % 2 === 0;
      return bar(dayString(startIndex + i), mid, mid + 1, mid - 1, up ? mid + 0.5 : mid);
    });
  }

  it("finds a fresh demand zone and a revisited supply zone", () => {
    const candles: Candle[] = [
      ...rangeBars(20, 0, 100), // ATR ≈ 2
      bar(dayString(20), 100, 100.3, 99.9, 100.1), // base
      bar(dayString(21), 100.1, 100.3, 99.9, 100.2), // base
      bar(dayString(22), 100.2, 104.2, 100, 104), // up impulse (body 3.8)
      ...rangeBars(10, 23, 105),
      bar(dayString(33), 105, 105.2, 104.9, 105.1), // base
      bar(dayString(34), 105.1, 105.2, 101.3, 101.5), // down impulse (body 3.6)
      ...rangeBars(4, 35, 102), // lows stay above the demand zone
      bar(dayString(39), 102, 104.95, 101.5, 104.5), // trades back into supply
      ...rangeBars(3, 40, 103),
    ];
    const zones = supplyDemandZones(candles);
    expect(zones).toEqual([
      { kind: "supply", low: 104.9, high: 105.2, baseStart: 33, baseEnd: 33, impulseIndex: 34, fresh: false },
      { kind: "demand", low: 99.9, high: 100.3, baseStart: 20, baseEnd: 21, impulseIndex: 22, fresh: true },
    ]);
    expect(supplyDemandZones(candles, { maxZones: 1 })).toHaveLength(1);
    expect(supplyDemandZones(flat(60))).toEqual([]);
  });
});

describe("autoTrendlines", () => {
  it("draws a rising support and falling resistance in a triangle", () => {
    const closes = path([
      [0, 100],
      [5, 110],
      [10, 90],
      [15, 106],
      [20, 93],
      [25, 102],
      [30, 96],
      [35, 99],
    ]);
    const lines = autoTrendlines(fromCloses(closes, 0));
    expect(lines).toHaveLength(2);
    const [support, resistance] = lines;
    expect(support).toMatchObject({
      kind: "support",
      from: { index: 20, price: 93 },
      to: { index: 30, price: 96 },
      touches: 3, // the swing low at 10 (90) is on the extended line
      broken: false, // line at 35 = 97.5 < 99
    });
    expect(support!.slopePerBar).toBeCloseTo(0.3, 10);
    expect(resistance).toMatchObject({
      kind: "resistance",
      from: { index: 15, price: 106 },
      to: { index: 25, price: 102 },
      touches: 3,
      broken: true, // line at 35 = 98 < 99
    });
    expect(resistance!.slopePerBar).toBeCloseTo(-0.4, 10);
  });

  it("skips a non-rising support and reports a break", () => {
    // Rising highs → no falling resistance; lows 90, 95, 100 rising, then a drop.
    const closes = path([
      [0, 95],
      [5, 100],
      [10, 90],
      [15, 104],
      [20, 95],
      [25, 106],
      [30, 100],
      [35, 110],
      [40, 100],
    ]);
    const lines = autoTrendlines(fromCloses(closes, 0));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "support", touches: 3, broken: true }); // 100 < 105
    expect(autoTrendlines(flat(50))).toEqual([]);
  });
});

describe("crossEvents", () => {
  it("detects crosses of a constant level and skips nulls", () => {
    expect(crossEvents([1, 2, 3, 2, 1, null, 3], 2)).toEqual([
      { index: 2, direction: "up" },
      { index: 4, direction: "down" },
    ]);
  });

  it("detects crosses between two series", () => {
    expect(crossEvents([1, 3, 3, 1], [2, 2, 4, 0])).toEqual([
      { index: 1, direction: "up" },
      { index: 2, direction: "down" },
      { index: 3, direction: "up" },
    ]);
    expect(crossEvents([], 1)).toEqual([]);
  });
});

describe("volumeAnalysis", () => {
  function series(lastVolume: number): Candle[] {
    const candles = Array.from({ length: 22 }, (_, i) => bar(dayString(i), 100, 101, 99, 100, 1000));
    candles.push(bar(dayString(22), 100, 102, 100, 101, 2000));
    candles.push(bar(dayString(23), 101, 103, 101, 102, 3000));
    candles.push(bar(dayString(24), 102, 107, 102, 106, lastVolume));
    return candles;
  }

  it("measures volume, turnover and flags a volume-backed breakout", () => {
    const result = volumeAnalysis(series(4000));
    expect(result.lastVolume).toBe(4000);
    expect(result.avgVolume20).toBe(1150); // (18 × 1000 + 2000 + 3000) / 20
    expect(result.volumeRatio).toBeCloseTo(4000 / 1150, 10);
    expect(result.volume3d).toBe(9000);
    expect(result.avgVolume3dPrior).toBe(3000);
    expect(result.volume3dRatio).toBe(3);
    expect(result.volume5d).toBe(11000);
    expect(result.turnover5d).toBe(100_000 + 100_000 + 202_000 + 306_000 + 424_000);
    expect(result.priceChange3d).toBeCloseTo(6, 10);
    expect(result.upDays3).toBe(3);
    expect(result.breakout).toBe(true);
  });

  it("needs volume confirmation and uses reported turnover when present", () => {
    expect(volumeAnalysis(series(1500)).breakout).toBe(false); // < 1.5 × 1150
    const withTurnover = series(4000).map((c) => ({ ...c, turnover: 10 }));
    expect(volumeAnalysis(withTurnover).turnover5d).toBe(50);
  });

  it("returns nulls on short series without throwing", () => {
    const result = volumeAnalysis(flat(2));
    expect(result.avgVolume20).toBeNull();
    expect(result.volume3d).toBeNull();
    expect(result.priceChange3d).toBeNull();
    expect(result.breakout).toBe(false);
    expect(volumeAnalysis([]).lastVolume).toBeNull();
  });
});

describe("averageAbsoluteMove", () => {
  it("averages absolute close-to-close percent moves", () => {
    expect(averageAbsoluteMove(fromCloses([100, 110, 99, 99]), 3)).toBeCloseTo(20 / 3, 10);
    expect(averageAbsoluteMove(fromCloses([100, 110]), 3)).toBeNull();
    expect(averageAbsoluteMove(flat(30))).toBe(0);
  });
});

describe("signalEvents", () => {
  // 30 sideways sessions, a 20-session slide, then 3 sharp up days.
  const closes = [
    ...Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 100 : 100.5)),
    ...Array.from({ length: 20 }, (_, i) => 99 - i),
    81,
    84,
    87,
  ];
  const candles = fromCloses(closes, 0.5, "2025-03-01");

  it("finds an RSI cross above 30 in the recovery with a deterministic id", () => {
    const events = signalEvents(candles, 5);
    const cross = events.find((e) => e.type === "rsi-cross-30");
    expect(cross).toBeDefined();
    expect(cross!.direction).toBe("bullish");
    expect(cross!.label).toBe("RSI crossed above 30");
    expect(cross!.index).toBeGreaterThanOrEqual(candles.length - 5);
    expect(cross!.id).toBe(`rsi-cross-30:bullish:${cross!.timestamp.slice(0, 10)}`);
    expect(cross!.detail).toMatch(/RSI 14 moved from \d+\.\d{2} to \d+\.\d{2}/);

    // Same input (even unsorted) → same ids; ids are unique.
    const again = signalEvents([...candles].reverse(), 5);
    expect(again.map((e) => e.id)).toEqual(events.map((e) => e.id));
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    // Oldest first, all within the window.
    expect(events.every((e) => e.index >= candles.length - 5)).toBe(true);
    expect(events.map((e) => e.index)).toEqual([...events.map((e) => e.index)].sort((a, b) => a - b));
  });

  it("drops events older than the lookback", () => {
    const events = signalEvents(candles, 1);
    expect(events.every((e) => e.index === candles.length - 1)).toBe(true);
    expect(signalEvents(candles, 0)).toEqual([]);
  });

  it("flags a new 52-week closing high only with a full year of history", () => {
    const year = Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 5));
    year.push(120);
    const events = signalEvents(fromCloses(year, 0.5, "2024-01-01"), 1);
    expect(events.some((e) => e.type === "new-52w-high" && e.direction === "bullish")).toBe(true);
    const short = signalEvents(fromCloses(year.slice(-100), 0.5, "2024-01-01"), 1);
    expect(short.some((e) => e.type === "new-52w-high")).toBe(false);
  });

  it("stays silent and does not throw on flat or short series", () => {
    expect(signalEvents(flat(300))).toEqual([]);
    expect(signalEvents(flat(1))).toEqual([]);
    expect(signalEvents([])).toEqual([]);
  });
});

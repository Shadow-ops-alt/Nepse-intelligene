import { describe, expect, it } from "vitest";
import {
  aggregateBars,
  bollingerValues,
  buildMinuteBars,
  emaValues,
  isNptSessionDay,
  macdValues,
  rsiValues,
  sessionBars,
  smaValues,
  vwap,
  type IntradayBar,
  type IntradaySample,
} from "./intraday";

function bar(
  timestamp: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number | null,
): IntradayBar {
  return { timestamp, open, high, low, close, volume, turnover: null };
}

function sample(
  timestamp: string,
  price: number,
  cumulativeVolume: number | null = null,
  cumulativeTurnover: number | null = null,
): IntradaySample {
  return { timestamp, price, cumulativeVolume, cumulativeTurnover };
}

describe("buildMinuteBars", () => {
  it("builds one bar per traded minute with sampled high/low/close", () => {
    const bars = buildMinuteBars([
      sample("2026-11-20T05:15:05.000Z", 100, 1_000),
      sample("2026-11-20T05:15:20.000Z", 102, 1_300),
      sample("2026-11-20T05:15:50.000Z", 99, 1_500),
      sample("2026-11-20T05:16:10.000Z", 101, 1_700),
    ]);

    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({
      timestamp: "2026-11-20T05:15:00.000Z",
      open: 100,
      high: 102,
      low: 99,
      close: 99,
    });
    // The first sample only establishes the cumulative baseline.
    expect(bars[0]?.volume).toBe(500);
    expect(bars[1]).toMatchObject({
      timestamp: "2026-11-20T05:16:00.000Z",
      open: 101,
      high: 101,
      low: 101,
      close: 101,
      volume: 200,
    });
  });

  it("leaves volume null when the source gives no cumulative volume", () => {
    const bars = buildMinuteBars([
      sample("2026-11-20T05:15:05.000Z", 100),
      sample("2026-11-20T05:15:40.000Z", 101),
    ]);
    expect(bars).toHaveLength(1);
    expect(bars[0]?.volume).toBeNull();
    expect(bars[0]?.turnover).toBeNull();
  });

  it("treats a falling cumulative counter as a reset, not negative volume", () => {
    const bars = buildMinuteBars([
      sample("2026-11-20T05:15:05.000Z", 100, 1_000),
      sample("2026-11-20T05:15:20.000Z", 101, 1_200),
      sample("2026-11-20T05:15:30.000Z", 102, 50),
      sample("2026-11-20T05:15:40.000Z", 103, 80),
    ]);
    expect(bars[0]?.volume).toBe(230);
  });

  it("does not invent bars for minutes with no trades", () => {
    const bars = buildMinuteBars([
      sample("2026-11-20T05:15:05.000Z", 100),
      sample("2026-11-20T05:18:05.000Z", 105),
    ]);
    expect(bars.map((bar) => bar.timestamp)).toEqual([
      "2026-11-20T05:15:00.000Z",
      "2026-11-20T05:18:00.000Z",
    ]);
  });

  it("sorts out-of-order samples and ignores invalid prices", () => {
    const bars = buildMinuteBars([
      sample("2026-11-20T05:16:00.000Z", 101),
      sample("2026-11-20T05:15:00.000Z", 100),
      sample("2026-11-20T05:15:30.000Z", 0),
      sample("not-a-date", 50),
    ]);
    expect(bars.map((bar) => [bar.timestamp, bar.close])).toEqual([
      ["2026-11-20T05:15:00.000Z", 100],
      ["2026-11-20T05:16:00.000Z", 101],
    ]);
  });
});

describe("aggregateBars", () => {
  it("resamples 1-minute bars without filling gaps", () => {
    const bars = buildMinuteBars([
      sample("2026-11-20T05:15:05.000Z", 100, 100),
      sample("2026-11-20T05:16:10.000Z", 102, 300),
      sample("2026-11-20T05:17:10.000Z", 99, 400),
    ]);

    const twoMinute = aggregateBars(bars, 2);
    expect(twoMinute).toHaveLength(2);
    expect(twoMinute[0]).toMatchObject({
      timestamp: "2026-11-20T05:15:00.000Z",
      open: 100,
      high: 102,
      low: 100,
      close: 102,
    });
    expect(twoMinute[0]?.volume).toBe(200);
    expect(twoMinute[1]).toMatchObject({
      timestamp: "2026-11-20T05:17:00.000Z",
      open: 99,
      high: 99,
      low: 99,
      close: 99,
      volume: 100,
    });
  });

  it("aligns buckets to Nepal Time for 30-minute bars", () => {
    // 11:05 NPT and 11:35 NPT belong to different NPT half-hour buckets.
    const bars = buildMinuteBars([
      sample("2026-11-20T05:20:00.000Z", 100),
      sample("2026-11-20T05:50:00.000Z", 110),
    ]);
    const halfHourly = aggregateBars(bars, 30);
    expect(halfHourly.map((bar) => bar.timestamp)).toEqual([
      "2026-11-20T05:15:00.000Z",
      "2026-11-20T05:45:00.000Z",
    ]);
  });

  it("returns a copy for intervals of one minute or less", () => {
    const bars = buildMinuteBars([sample("2026-11-20T05:15:05.000Z", 100)]);
    const copy = aggregateBars(bars, 1);
    expect(copy).toEqual(bars);
    expect(copy).not.toBe(bars);
  });
});

describe("sessionBars", () => {
  it("combines building and resampling", () => {
    const bars = sessionBars(
      [
        sample("2026-11-20T05:15:05.000Z", 100),
        sample("2026-11-20T05:16:05.000Z", 101),
        sample("2026-11-20T05:17:05.000Z", 102),
      ],
      3,
    );
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ open: 100, close: 102 });
  });
});

describe("isNptSessionDay", () => {
  it("uses Nepal Time, not UTC", () => {
    // 18:20 UTC on 19 Nov is 00:05 NPT on 20 Nov.
    expect(isNptSessionDay("2026-11-19T18:20:00.000Z", "2026-11-20")).toBe(true);
    expect(isNptSessionDay("2026-11-19T18:20:00.000Z", "2026-11-19")).toBe(false);
  });
});

describe("vwap", () => {
  it("weights each bar by volume using (H + L + C) / 3", () => {
    const values = vwap([
      bar("2026-11-20T05:15:00.000Z", 100, 102, 99, 100, 10),
      bar("2026-11-20T05:16:00.000Z", 100, 108, 100, 106, 30),
    ]);
    // bar 1 typical = 301/3 = 100.333..., bar 2 typical = 314/3 = 104.666...
    expect(values[0]).toBeCloseTo(301 / 3, 6);
    expect(values[1]).toBeCloseTo((301 / 3 * 10 + 314 / 3 * 30) / 40, 6);
  });

  it("returns null while no volume has traded, then fills", () => {
    const values = vwap([
      bar("2026-11-20T05:15:00.000Z", 100, 100, 100, 100, null),
      bar("2026-11-20T05:16:00.000Z", 100, 100, 100, 100, 0),
      bar("2026-11-20T05:17:00.000Z", 100, 100, 100, 100, 5),
    ]);
    expect(values).toEqual([null, null, 100]);
  });

  it("holds the running VWAP across a zero-volume bar", () => {
    const values = vwap([
      bar("2026-11-20T05:15:00.000Z", 100, 100, 100, 100, 10),
      bar("2026-11-20T05:16:00.000Z", 120, 120, 120, 120, 0),
    ]);
    expect(values[1]).toBe(100);
  });

  it("resets the accumulator on a new Nepal-Time session", () => {
    const values = vwap([
      bar("2026-11-20T05:15:00.000Z", 100, 100, 100, 100, 10),
      bar("2026-11-20T05:16:00.000Z", 200, 200, 200, 200, 10),
      // Next Nepal-Time calendar day (05:15 UTC = 11:00 NPT).
      bar("2026-11-21T05:15:00.000Z", 300, 300, 300, 300, 10),
    ]);
    expect(values[0]).toBe(100);
    expect(values[1]).toBe(150);
    expect(values[2]).toBe(300);
  });

  it("is computed on resampled bars, not on the underlying 1m bars", () => {
    const minute = buildMinuteBars([
      sample("2026-11-20T05:15:05.000Z", 100, 100),
      sample("2026-11-20T05:16:10.000Z", 110, 300),
    ]);
    const twoMinute = aggregateBars(minute, 2);
    // One 2m bar: O 100, H 110, L 100, C 110, volume 200.
    expect(twoMinute).toHaveLength(1);
    expect(vwap(twoMinute)[0]).toBeCloseTo((110 + 100 + 110) / 3, 6);
  });

  it("returns an empty array for no bars", () => {
    expect(vwap([])).toEqual([]);
  });
});

describe("indicator wrappers", () => {
  it("exposes SMA, EMA and RSI with not-enough-bars nulls", () => {
    expect(smaValues([1, 2, 3], 3)).toEqual([null, null, 2]);
    expect(emaValues([1, 2, 3], 3)).toEqual([null, null, 2]);
    expect(rsiValues([1, 2, 3], 14)).toEqual([null, null, null]);
  });

  it("returns MACD and Bollinger series aligned to the input", () => {
    const closes = Array.from({ length: 40 }, (_, index) => 100 + index);
    const bands = bollingerValues(closes, 20, 2);
    const macd = macdValues(closes);
    expect(bands).toHaveLength(closes.length);
    expect(bands[18]).toBeNull();
    expect(bands[19]).not.toBeNull();
    expect(macd.macd).toHaveLength(closes.length);
    expect(macd.histogram).toHaveLength(closes.length);
  });
});

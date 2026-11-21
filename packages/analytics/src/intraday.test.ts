import { describe, expect, it } from "vitest";
import {
  aggregateBars,
  buildMinuteBars,
  isNptSessionDay,
  sessionBars,
  type IntradaySample,
} from "./intraday";

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

import type { Check } from "../types";
import {
  assessHistory,
  eachTradingDay,
  nepalToday,
  outcome,
  subtractYears,
  toDateString,
} from "./helpers";

function historyWindow(now: Date, years: number) {
  const to = nepalToday(now);
  const from = toDateString(subtractYears(new Date(`${to}T00:00:00Z`), years));
  return { from, to };
}

export const dailyHistoryCheck: Check = {
  id: "daily-ohlc-history",
  title: "Daily OHLC history (five-year requirement)",
  capabilities: ["dailyOhlc"],
  async run({ service, historyYears, sampleSymbol, requestTimeoutMs, now }) {
    const { from, to } = historyWindow(now, historyYears);
    const envelope = await service.getDailyOhlc(
      sampleSymbol,
      { from, to },
      { timeoutMs: requestTimeoutMs },
    );
    const result = assessHistory({
      label: `Daily OHLC for ${sampleSymbol}`,
      candles: envelope.data,
      from,
      to,
    });

    const expected = eachTradingDay(from, to).length;
    result.details.unshift(
      `Provider limit maxDailyHistoryDays: ${service.listProviders().find((entry) => entry.descriptor.id === envelope.meta.providerId)?.descriptor.limits?.maxDailyHistoryDays ?? "not declared"}.`,
    );
    result.details.push(
      `Required window is ${historyYears} year(s); ${expected} Sun–Thu weekdays expected before holidays.`,
    );
    result.metrics.providerId = envelope.meta.providerId;
    result.metrics.historyYears = historyYears;
    return result;
  },
};

export const indexHistoryCheck: Check = {
  id: "index-history",
  title: "NEPSE index history (five-year requirement)",
  capabilities: ["indexHistory"],
  async run({ service, historyYears, requestTimeoutMs, now, indexSymbol }) {
    const { from, to } = historyWindow(now, historyYears);

    let resolvedIndex = indexSymbol;
    if (service.listProviders().some((entry) =>
      entry.descriptor.capabilities.includes("indices"),
    )) {
      try {
        const indices = await service.getIndices({
          timeoutMs: requestTimeoutMs,
        });
        const match =
          indices.data.find(
            (index) => index.symbol.toUpperCase() === indexSymbol.toUpperCase(),
          ) ??
          indices.data.find((index) => index.symbol.toUpperCase() === "NEPSE") ??
          indices.data.find((index) => !index.isSector);
        if (match) resolvedIndex = match.symbol;
      } catch {
        // Index discovery is best-effort; the history call below is the test.
      }
    }

    const envelope = await service.getIndexHistory(
      resolvedIndex,
      { from, to },
      { timeoutMs: requestTimeoutMs },
    );
    const result = assessHistory({
      label: `Index history for ${resolvedIndex}`,
      candles: envelope.data,
      from,
      to,
    });
    result.metrics.providerId = envelope.meta.providerId;
    result.metrics.indexSymbol = resolvedIndex;
    result.metrics.historyYears = historyYears;
    return result;
  },
};

export const intradayCheck: Check = {
  id: "intraday-ohlc",
  title: "Intraday OHLC (live chart support)",
  capabilities: ["intradayOhlc"],
  async run({ service, requestTimeoutMs, now, sampleSymbol }) {
    const to = nepalToday(now);
    const from = to;
    const envelope = await service.getIntradayOhlc(
      sampleSymbol,
      { from, to },
      { timeoutMs: requestTimeoutMs },
    );
    const candles = envelope.data;
    if (candles.length === 0) {
      return outcome(
        "warn",
        `No intraday candles for ${sampleSymbol} on ${to}; chart may only work during market hours`,
        [`Requested ${from} → ${to} for ${sampleSymbol}.`],
        { rows: 0, symbol: sampleSymbol, date: to },
      );
    }
    const frames = new Set(candles.map((candle) => candle.timeframe));
    return outcome(
      "pass",
      `${candles.length} intraday candles for ${sampleSymbol}`,
      [
        `Timeframes: ${[...frames].join(", ") || "none declared"}.`,
        `Requested ${from} → ${to}.`,
      ],
      {
        rows: candles.length,
        timeframes: [...frames].join(",") || null,
        symbol: sampleSymbol,
        date: to,
      },
    );
  },
};

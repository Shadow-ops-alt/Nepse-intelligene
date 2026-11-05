import { z } from "zod";
import { MarketSummarySchema, QuoteSchema } from "@stock/core";
import type { Check, CheckStatus } from "../types";
import { outcome, round } from "./helpers";

const QuotesSchema = z.array(QuoteSchema);

export const liveQuotesCheck: Check = {
  id: "live-quotes",
  title: "Live quotes and freshness",
  capabilities: ["liveQuotes"],
  async run({ service, requestTimeoutMs }) {
    const envelope = await service.getLiveQuotes({ timeoutMs: requestTimeoutMs });
    const parsed = QuotesSchema.safeParse(envelope.data);
    if (!parsed.success) {
      return outcome(
        "fail",
        "Live quotes do not match the Quote contract",
        [parsed.error.message],
        {},
      );
    }

    const quotes = parsed.data;
    if (quotes.length === 0) {
      return outcome("fail", "Live quote feed is empty", [], { quotes: 0 });
    }

    const symbols = new Set(quotes.map((quote) => quote.symbol.toUpperCase()));
    const zeroPrices = quotes.filter((quote) => quote.ltp <= 0).length;
    const age = envelope.meta.ageSeconds;
    const turnover = quotes.reduce((sum, quote) => sum + quote.turnover, 0);
    const volume = quotes.reduce((sum, quote) => sum + quote.volume, 0);

    let status: CheckStatus = "pass";
    const details = [
      `${quotes.length} quotes, ${symbols.size} unique symbols.`,
      `Aggregate volume: ${round(volume)}; aggregate turnover: NPR ${round(turnover).toLocaleString("en-US")}.`,
    ];
    if (age !== undefined) {
      details.push(`Data age: ${age}s (as of ${envelope.meta.asOf ?? "unknown"}).`);
      if (age > 7 * 86_400) {
        status = "fail";
        details.push("Quote feed is more than seven days old.");
      } else if (age > 86_400) {
        status = "warn";
        details.push("Quote feed is more than one day old.");
      }
    }
    if (envelope.meta.stale) {
      status = status === "fail" ? "fail" : "warn";
      details.push("Envelope is flagged stale.");
    }
    if (zeroPrices > 0) {
      status = status === "fail" ? "fail" : "warn";
      details.push(`${zeroPrices} quote(s) have a non-positive last traded price.`);
    }
    if (symbols.size !== quotes.length) {
      status = status === "fail" ? "fail" : "warn";
      details.push("Duplicate symbols returned in the quote feed.");
    }
    if (envelope.meta.warnings.length > 0) {
      details.push(`Provider warnings: ${envelope.meta.warnings.join("; ")}`);
    }

    return outcome(
      status,
      `${quotes.length} live quote(s) available`,
      details,
      {
        quotes: quotes.length,
        uniqueSymbols: symbols.size,
        zeroPrices,
        ageSeconds: age ?? null,
        stale: envelope.meta.stale,
        volume: round(volume),
        turnover: round(turnover),
      },
    );
  },
};

export const marketSummaryCheck: Check = {
  id: "market-summary",
  title: "Market summary",
  capabilities: ["marketSummary"],
  async run({ service, requestTimeoutMs }) {
    const envelope = await service.getMarketSummary({
      timeoutMs: requestTimeoutMs,
    });
    const parsed = MarketSummarySchema.safeParse(envelope.data);
    if (!parsed.success) {
      return outcome(
        "fail",
        "Market summary does not match the contract",
        [parsed.error.message],
        {},
      );
    }

    const summary = parsed.data;
    const details = [
      `${summary.indexName}: ${summary.indexValue} (${summary.change >= 0 ? "+" : ""}${summary.change}, ${round(summary.changePercent)}%).`,
      `Turnover: NPR ${round(summary.turnover).toLocaleString("en-US")}; ${summary.transactions} transactions across ${summary.scripsTraded} scrips.`,
      `As of: ${summary.asOf}.`,
    ];
    let status: CheckStatus = "pass";
    if (summary.indexValue <= 0) {
      status = "fail";
    } else if (summary.transactions === 0 || summary.turnover === 0) {
      status = "warn";
      details.push("Market summary has zero turnover or transactions.");
    }
    if (envelope.meta.warnings.length > 0) {
      details.push(`Provider warnings: ${envelope.meta.warnings.join("; ")}`);
    }

    return outcome(
      status,
      `${summary.indexName} at ${summary.indexValue}`,
      details,
      {
        indexName: summary.indexName,
        indexValue: summary.indexValue,
        changePercent: round(summary.changePercent),
        turnover: round(summary.turnover),
        transactions: summary.transactions,
        scripsTraded: summary.scripsTraded,
      },
    );
  },
};

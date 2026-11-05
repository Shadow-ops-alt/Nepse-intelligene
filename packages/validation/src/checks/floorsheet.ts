import { z } from "zod";
import { FloorsheetTradeSchema } from "@stock/core";
import type { Check, CheckStatus } from "../types";
import {
  outcome,
  previousTradingDay,
  round,
  worstStatus,
} from "./helpers";

const FloorsheetSchema = z.array(FloorsheetTradeSchema);

export const floorsheetCheck: Check = {
  id: "floorsheet",
  title: "Floorsheet history and business date",
  capabilities: ["floorsheet"],
  async run({ service, requestTimeoutMs, now }) {
    const requestedDate = previousTradingDay(now);
    const envelope = await service.getFloorsheet(requestedDate, {
      timeoutMs: requestTimeoutMs,
    });
    const parsed = FloorsheetSchema.safeParse(envelope.data);
    if (!parsed.success) {
      return outcome(
        "fail",
        "Floorsheet does not match the FloorsheetTrade contract",
        [parsed.error.message],
        { requestedDate },
      );
    }

    const trades = parsed.data;
    if (trades.length === 0) {
      return outcome(
        "fail",
        `Floorsheet for ${requestedDate} is empty`,
        [
          `Requested date: ${requestedDate}.`,
          "The provider may ignore the business-date parameter or lack history.",
        ],
        { requestedDate, trades: 0 },
      );
    }

    const dates = new Set(trades.map((trade) => trade.businessDate));
    const matching = trades.filter(
      (trade) => trade.businessDate === requestedDate,
    ).length;
    const contractIds = new Set(trades.map((trade) => trade.contractId));
    const symbols = new Set(trades.map((trade) => trade.symbol));
    const turnover = trades.reduce((sum, trade) => sum + trade.amount, 0);
    const quantity = trades.reduce((sum, trade) => sum + trade.quantity, 0);
    const crossDate = trades.length - matching;

    let status: CheckStatus =
      matching === 0 ? "fail" : "pass";
    if (crossDate > 0 && matching > 0) status = worstStatus(status, "warn");
    if (contractIds.size !== trades.length) status = worstStatus(status, "warn");

    const details = [
      `Requested date: ${requestedDate}.`,
      `Returned ${trades.length} trades across date(s): ${[...dates].join(", ")}.`,
      `${matching} trade(s) match the requested business date.`,
      `${contractIds.size} unique contract IDs, ${symbols.size} symbols.`,
      `Parsed turnover: NPR ${round(turnover).toLocaleString("en-US")}.`,
    ];
    if (crossDate > 0) {
      details.push(
        "The provider returned trades for a different date. Treat date-scoped history as unverified.",
      );
    }
    if (envelope.meta.warnings.length > 0) {
      details.push(`Provider warnings: ${envelope.meta.warnings.join("; ")}`);
    }

    return outcome(
      status,
      status === "fail"
        ? `Provider ignored the requested business date (${requestedDate})`
        : `${trades.length} floorsheet trades for ${requestedDate}`,
      details,
      {
        requestedDate,
        trades: trades.length,
        matchingDate: matching,
        crossDate,
        uniqueContracts: contractIds.size,
        symbols: symbols.size,
        quantity: round(quantity),
        turnover: round(turnover),
      },
    );
  },
};

import { z } from "zod";
import { CorporateActionSchema, IpoSchema } from "@stock/core";
import type { Check, CheckStatus } from "../types";
import { outcome, worstStatus } from "./helpers";

const CorporateActionsSchema = z.array(CorporateActionSchema);
const IposSchema = z.array(IpoSchema);

export const corporateActionsCheck: Check = {
  id: "corporate-actions",
  title: "Corporate actions",
  capabilities: ["corporateActions"],
  async run({ service, sampleSymbol, requestTimeoutMs }) {
    const envelope = await service.getCorporateActions(sampleSymbol, {
      timeoutMs: requestTimeoutMs,
    });
    const parsed = CorporateActionsSchema.safeParse(envelope.data);
    if (!parsed.success) {
      return outcome(
        "fail",
        `Corporate actions for ${sampleSymbol} do not match the contract`,
        [parsed.error.message],
        { symbol: sampleSymbol },
      );
    }

    const actions = parsed.data;
    const types = new Set(actions.map((action) => action.type));
    const withExDate = actions.filter((action) => action.exDate).length;
    const withSource = actions.filter((action) => action.sourceUrl).length;

    let status: CheckStatus = "pass";
    const details = [
      `${actions.length} action(s) for ${sampleSymbol}.`,
      `Types: ${[...types].join(", ") || "none"}.`,
      `${withExDate} with an ex-date, ${withSource} with a source URL.`,
    ];
    if (actions.length === 0) {
      status = "warn";
      details.push(
        "No corporate actions returned. This may be legitimate, or the source may not cover the symbol.",
      );
    } else if (withSource < actions.length) {
      status = worstStatus(status, "warn");
      details.push("Some corporate actions have no source URL.");
    }

    return outcome(
      status,
      actions.length === 0
        ? `No corporate actions returned for ${sampleSymbol}`
        : `${actions.length} corporate action(s) for ${sampleSymbol}`,
      details,
      {
        symbol: sampleSymbol,
        actions: actions.length,
        types: [...types].join(",") || null,
        withExDate,
        withSource,
      },
    );
  },
};

export const iposCheck: Check = {
  id: "ipos",
  title: "IPO / FPO / right issue pipeline",
  capabilities: ["ipos"],
  async run({ service, requestTimeoutMs, now }) {
    const envelope = await service.getIpos({ timeoutMs: requestTimeoutMs });
    const parsed = IposSchema.safeParse(envelope.data);
    if (!parsed.success) {
      return outcome(
        "fail",
        "IPO list does not match the contract",
        [parsed.error.message],
        {},
      );
    }

    const ipos = parsed.data;
    const open = ipos.filter((ipo) => ipo.status === "open").length;
    const upcoming = ipos.filter((ipo) => ipo.status === "upcoming").length;
    const byType = new Map<string, number>();
    for (const ipo of ipos) {
      byType.set(ipo.type, (byType.get(ipo.type) ?? 0) + 1);
    }
    const details = [
      `${ipos.length} issue(s) returned.`,
      `${open} open, ${upcoming} upcoming.`,
      `Types: ${[...byType.entries()].map(([type, count]) => `${type}:${count}`).join(", ") || "none"}.`,
      `Checked at: ${now.toISOString()}.`,
    ];

    return outcome(
      ipos.length === 0 ? "warn" : "pass",
      ipos.length === 0
        ? "No IPO/right issues returned; pipeline may be empty or unsupported"
        : `${ipos.length} IPO/right issue(s) available`,
      details,
      {
        ipos: ipos.length,
        open,
        upcoming,
        types: [...byType.keys()].join(",") || null,
      },
    );
  },
};

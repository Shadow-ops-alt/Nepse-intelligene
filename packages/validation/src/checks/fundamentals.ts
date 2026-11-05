import { z } from "zod";
import { FundamentalsSnapshotSchema } from "@stock/core";
import type { Check, CheckStatus } from "../types";
import {
  nepalToday,
  outcome,
  round,
  subtractYears,
  toDateString,
  worstStatus,
} from "./helpers";

const SnapshotSchema = FundamentalsSnapshotSchema;
const SnapshotListSchema = z.array(FundamentalsSnapshotSchema);

export const fundamentalsLatestCheck: Check = {
  id: "fundamentals-latest",
  title: "Latest fundamentals snapshot",
  capabilities: ["fundamentals"],
  async run({ service, sampleSymbol, requestTimeoutMs }) {
    const envelope = await service.getFundamentals(sampleSymbol, {
      timeoutMs: requestTimeoutMs,
    });
    const parsed = SnapshotSchema.safeParse(envelope.data);
    if (!parsed.success) {
      return outcome(
        "fail",
        `Fundamentals for ${sampleSymbol} do not match the contract`,
        [parsed.error.message],
        { symbol: sampleSymbol },
      );
    }

    const snapshot = parsed.data;
    const metrics = Object.values(snapshot.metrics);
    const populated = metrics.filter((metric) => metric.value !== null);
    const confidence = new Set(metrics.map((metric) => metric.confidence));
    const unverified = metrics.filter(
      (metric) => metric.confidence === "unverified",
    ).length;
    const estimated = metrics.filter(
      (metric) => metric.confidence === "estimated",
    ).length;

    const details = [
      `Period: ${snapshot.period}${snapshot.fiscalYear ? ` (FY ${snapshot.fiscalYear})` : ""}.`,
      `${metrics.length} metric(s), ${populated.length} with a value.`,
      `Confidence levels: ${[...confidence].join(", ") || "none"}.`,
    ];
    if (snapshot.reportedAt) {
      details.push(`Reported at: ${snapshot.reportedAt}.`);
    }
    if (snapshot.sourceUrl) {
      details.push(`Source: ${snapshot.sourceUrl}`);
    }

    let status: CheckStatus = "pass";
    if (metrics.length === 0 || populated.length === 0) {
      status = "fail";
    } else if (unverified > 0 || estimated > 0) {
      status = "warn";
      details.push(
        `${unverified} unverified and ${estimated} estimated metric(s); label these in the UI.`,
      );
    }

    return outcome(
      status,
      status === "fail"
        ? `No usable fundamentals for ${sampleSymbol}`
        : `${populated.length} fundamental metric(s) for ${sampleSymbol} (${snapshot.period})`,
      details,
      {
        symbol: sampleSymbol,
        period: snapshot.period,
        metrics: metrics.length,
        populatedMetrics: populated.length,
        unverified,
        estimated,
        confidenceLevels: [...confidence].join(",") || null,
      },
    );
  },
};

export const fundamentalsHistoryCheck: Check = {
  id: "fundamentals-history",
  title: "Fundamentals history",
  capabilities: ["fundamentalsHistory"],
  async run({ service, sampleSymbol, requestTimeoutMs, historyYears, now }) {
    const to = nepalToday(now);
    const from = toDateString(
      subtractYears(new Date(`${to}T00:00:00Z`), historyYears),
    );
    const envelope = await service.getFundamentalsHistory(
      sampleSymbol,
      { from, to },
      { timeoutMs: requestTimeoutMs },
    );
    const parsed = SnapshotListSchema.safeParse(envelope.data);
    if (!parsed.success) {
      return outcome(
        "fail",
        `Fundamentals history for ${sampleSymbol} does not match the contract`,
        [parsed.error.message],
        { symbol: sampleSymbol },
      );
    }

    const snapshots = parsed.data;
    if (snapshots.length === 0) {
      return outcome(
        "fail",
        `No fundamentals history for ${sampleSymbol}`,
        [`Requested ${from} → ${to}.`],
        { symbol: sampleSymbol, periods: 0 },
      );
    }

    const periods = new Set(snapshots.map((snapshot) => snapshot.period));
    const fiscalYears = new Set(
      snapshots
        .map((snapshot) => snapshot.fiscalYear)
        .filter((year): year is string => Boolean(year)),
    );
    const withMetrics = snapshots.filter(
      (snapshot) => Object.keys(snapshot.metrics).length > 0,
    ).length;
    const latest = [...snapshots].sort((a, b) =>
      a.period.localeCompare(b.period),
    ).at(-1);

    let status: CheckStatus = "pass";
    if (periods.size < 4) {
      status = "fail";
    } else if (periods.size < 12) {
      status = worstStatus(status, "warn");
    }
    if (withMetrics < snapshots.length) {
      status = worstStatus(status, "warn");
    }

    const details = [
      `Requested ${from} → ${to}; received ${snapshots.length} snapshot(s).`,
      `${periods.size} reporting period(s) across ${fiscalYears.size} fiscal year(s).`,
      `${withMetrics} snapshot(s) contain metrics.`,
      `Latest period: ${latest?.period ?? "n/a"}.`,
    ];
    if (periods.size < 12) {
      details.push(
        "Fewer than 12 periods (three years of quarterly data); long-term fundamental trends will be weak.",
      );
    }

    return outcome(
      status,
      status === "fail"
        ? `Only ${periods.size} fundamentals period(s) available`
        : `${periods.size} fundamentals period(s) for ${sampleSymbol}`,
      details,
      {
        symbol: sampleSymbol,
        snapshots: snapshots.length,
        periods: periods.size,
        fiscalYears: fiscalYears.size,
        snapshotsWithMetrics: withMetrics,
        latestPeriod: latest?.period ?? null,
        requestedFrom: from,
        requestedTo: to,
        latestEps: round(latest?.metrics.eps?.value ?? Number.NaN) || null,
      },
    );
  },
};

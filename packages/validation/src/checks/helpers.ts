import {
  CandleSchema,
  type Candle,
} from "@stock/core";
import type { CheckOutcome, CheckStatus } from "../types";

const DAY_MS = 86_400_000;

export function outcome(
  status: CheckStatus,
  summary: string,
  details: string[] = [],
  metrics: CheckOutcome["metrics"] = {},
): CheckOutcome {
  return { status, summary, details, metrics };
}

export function statusRank(status: CheckStatus): number {
  switch (status) {
    case "fail":
      return 3;
    case "warn":
      return 2;
    case "pass":
      return 1;
    default:
      return 0;
  }
}

export function worstStatus(a: CheckStatus, b: CheckStatus): CheckStatus {
  return statusRank(a) >= statusRank(b) ? a : b;
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function subtractYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() - years);
  return result;
}

export function dayDifference(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.NaN;
  return Math.round((end - start) / DAY_MS);
}

/** Today's date in Asia/Kathmandu (NEPSE local time). */
export function nepalToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * NEPSE trades Sunday through Thursday. Public holidays are not modelled here;
 * coverage thresholds leave room for them.
 */
export function eachTradingDay(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    return [];
  }
  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    const day = new Date(cursor).getUTCDay();
    if (day >= 0 && day <= 4) {
      days.push(new Date(cursor).toISOString().slice(0, 10));
    }
  }
  return days;
}

/** Most recent trading day strictly before today (NEPSE local time). */
export function previousTradingDay(now: Date = new Date()): string {
  let cursor = Date.parse(`${nepalToday(now)}T00:00:00Z`) - DAY_MS;
  for (let guard = 0; guard < 14; guard += 1) {
    const day = new Date(cursor).getUTCDay();
    if (day >= 0 && day <= 4) {
      return new Date(cursor).toISOString().slice(0, 10);
    }
    cursor -= DAY_MS;
  }
  return new Date(cursor).toISOString().slice(0, 10);
}

export interface HistoryAssessmentOptions {
  label: string;
  candles: Candle[];
  from: string;
  to: string;
  passCoverage?: number;
  warnCoverage?: number;
  maxStartLagDays?: number;
  passLatestLagDays?: number;
  warnLatestLagDays?: number;
}

/**
 * Judges whether a candle series is actually usable as long-term history.
 * Coverage is measured against NEPSE trading days, so a source that only
 * returns the last year fails a five-year window even when its data is clean.
 */
export function assessHistory(
  options: HistoryAssessmentOptions,
): CheckOutcome {
  const {
    label,
    candles,
    from,
    to,
    passCoverage = 0.9,
    warnCoverage = 0.75,
    maxStartLagDays = 45,
    passLatestLagDays = 10,
    warnLatestLagDays = 30,
  } = options;

  const details: string[] = [
    `Requested ${label} window: ${from} → ${to}`,
  ];

  if (candles.length === 0) {
    return outcome(
      "fail",
      `${label}: provider returned no candles for the requested window`,
      details,
      { rows: 0, requestedFrom: from, requestedTo: to },
    );
  }

  let invalid = 0;
  const valid: Candle[] = [];
  for (const candle of candles) {
    const parsed = CandleSchema.safeParse(candle);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      invalid += 1;
    }
  }

  if (valid.length === 0) {
    return outcome(
      "fail",
      `${label}: every candle failed schema validation`,
      details,
      { rows: candles.length, invalid },
    );
  }

  const dates = new Set<string>();
  let outsideWindow = 0;
  let duplicateDates = 0;
  for (const candle of valid) {
    const date = candle.timestamp.slice(0, 10);
    if (date < from || date > to) {
      outsideWindow += 1;
      continue;
    }
    if (dates.has(date)) {
      duplicateDates += 1;
    }
    dates.add(date);
  }

  const sorted = [...dates].sort();
  const earliest = sorted[0];
  const latest = sorted.at(-1);
  const expected = eachTradingDay(from, to);
  const coverage = expected.length > 0 ? sorted.length / expected.length : 0;
  const missing = expected.filter((date) => !dates.has(date));

  const startLag = earliest ? dayDifference(from, earliest) : Number.NaN;
  const latestLag = latest ? dayDifference(latest, to) : Number.NaN;

  let status: CheckStatus = "pass";
  if (coverage < warnCoverage) status = "fail";
  else if (coverage < passCoverage) status = "warn";

  if (Number.isFinite(startLag) && startLag > maxStartLagDays) {
    status = "fail";
    details.push(
      `History starts ${startLag} days after the requested start (max allowed ${maxStartLagDays}).`,
    );
  }

  if (Number.isFinite(latestLag)) {
    if (latestLag > warnLatestLagDays) {
      status = "fail";
      details.push(
        `Newest candle is ${latestLag} days old (max allowed ${warnLatestLagDays}).`,
      );
    } else if (latestLag > passLatestLagDays) {
      status = worstStatus(status, "warn");
      details.push(`Newest candle is ${latestLag} days old.`);
    }
  }

  if (invalid > 0) {
    const ratio = invalid / candles.length;
    status = worstStatus(status, ratio > 0.05 ? "fail" : "warn");
    details.push(`${invalid} candle(s) failed schema validation.`);
  }
  if (outsideWindow > 0) {
    status = worstStatus(status, "warn");
    details.push(`${outsideWindow} candle(s) fell outside the requested window.`);
  }
  if (duplicateDates > 0) {
    status = worstStatus(status, "warn");
    details.push(`${duplicateDates} duplicate trading date(s) returned.`);
  }

  details.push(
    `Returned ${valid.length} valid candle(s) across ${sorted.length} distinct trading day(s).`,
  );
  details.push(
    `Coverage: ${round(coverage * 100)}% of ${expected.length} expected Sun–Thu trading days.`,
  );
  if (earliest && latest) {
    details.push(`Observed range: ${earliest} → ${latest}.`);
  }
  if (missing.length > 0) {
    details.push(
      `First missing expected day(s): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` (+${missing.length - 10} more)` : ""}.`,
    );
  }

  return outcome(
    status,
    `${label}: ${sorted.length} trading days, ${round(coverage * 100)}% coverage, ${earliest ?? "n/a"} → ${latest ?? "n/a"}`,
    details,
    {
      rows: candles.length,
      validRows: valid.length,
      invalidRows: invalid,
      tradingDays: sorted.length,
      expectedTradingDays: expected.length,
      coveragePercent: round(coverage * 100),
      earliest: earliest ?? null,
      latest: latest ?? null,
      startLagDays: Number.isFinite(startLag) ? startLag : null,
      latestLagDays: Number.isFinite(latestLag) ? latestLag : null,
      duplicateDates,
      outsideWindow,
      requestedFrom: from,
      requestedTo: to,
    },
  );
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Corporate-action adjustment for stored daily candles.
 *
 * The archive keeps raw, unadjusted exchange prices. This module turns a raw
 * series plus a list of *resolved* corporate actions (an ex-date and enough
 * parameters to compute a factor) into a continuous series, and reports the
 * fate of every action. Nothing here guesses a date or a cash amount: an
 * action that cannot be resolved is returned as unresolved, with the reason.
 *
 * Two modes exist because a backtester needs two different things:
 *
 * - `price` scales every bar before an ex-date, dividends included, so a
 *   signal engine sees one continuous return series and cannot trade the
 *   mechanical ex-date gap.
 * - `totalReturn` scales only share-count events (bonus, right, split) and
 *   leaves cash dividends untouched, exposing them as cash events instead.
 *   That is the series a total-return simulation needs when it credits the
 *   dividend to the holder.
 *
 * The output is DERIVED data. Raw rows are preserved on the result.
 */

import type { Candle } from "@stock/core";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export type CorporateActionType = "cashDividend" | "bonus" | "right" | "split";

export type AdjustmentMode = "price" | "totalReturn";

/**
 * How an action's ex-date was established. `explicit` is an
 * exchange-published ex-date. `book-closure` means an enrichment pass used a
 * book-closure date as an approximation; results may shift by one session.
 */
export type ActionDateBasis = "explicit" | "book-closure";

/**
 * A corporate action that has been resolved to an ex-date and the parameters
 * needed to compute its adjustment. `exDate` is `YYYY-MM-DD`.
 */
export interface ResolvedCorporateAction {
  /** Stable identifier used to deduplicate and report an action. */
  id: string;
  symbol: string;
  type: CorporateActionType;
  exDate: string;
  /** Where the ex-date came from. Defaults to `"explicit"`. */
  dateBasis?: ActionDateBasis;
  /** Percent of paid-up value for a cash dividend, percent for a bonus. */
  percent?: number;
  /** Bonus shares per 100 shares (10 means a 10% bonus). */
  bonusPercent?: number;
  /** Right ratio: new shares per existing share (1 means 1:1). */
  ratio?: number;
  /** Right issue price per share (Rs). */
  issuePrice?: number;
  /** Split ratio: new shares per existing share (2 means a 2-for-1 split). */
  splitRatio?: number;
  /** Cash dividend per share (Rs), after conversion from percent if needed. */
  dividendPerShare?: number;
  fiscalYear?: string;
  sourceUrl?: string;
  notes?: string;
}

/** Why one raw action could not be resolved. */
export interface UnresolvedCorporateAction {
  symbol: string;
  /** The type as stored, before normalisation; may be empty. */
  rawType: string;
  fiscalYear?: string;
  sourceUrl?: string;
  reason: string;
  /** The raw row, so a caller can show or log exactly what was rejected. */
  raw: Record<string, unknown>;
}

export interface ResolveActionOptions {
  /** Symbol to apply when a raw row does not carry one. */
  symbol?: string;
  /**
   * Paid-up (par) value used to convert a cash-dividend percent into Rs per
   * share. Only a value that is actually known should be supplied; when it is
   * absent a percent-only cash dividend stays unresolved.
   */
  parValue?: number;
}

export interface ResolvedActionSet {
  symbol: string;
  resolved: ResolvedCorporateAction[];
  unresolved: UnresolvedCorporateAction[];
}

export type ActionStatus = "applied" | "outside-range" | "invalid";

export interface ActionApplication {
  action: ResolvedCorporateAction;
  status: ActionStatus;
  /** Expected price factor applied to bars strictly before the ex-date. */
  priceFactor: number | null;
  /** Volume factor applied to bars strictly before the ex-date (1/priceFactor). */
  volumeFactor: number | null;
  /** Shares multiplier at the ex-date (bonus/right/split); 1 for a dividend. */
  shareFactor: number | null;
  /** Cash per share credited at the ex-date, for a cash dividend. */
  cashPerShare: number | null;
  /** Index of the first bar on or after the ex-date; null when outside the series. */
  exDateIndex: number | null;
  /** Raw close of the last bar strictly before the ex-date. */
  previousClose: number | null;
  /**
   * (actual ex-date close / price-factor-implied close − 1) × 100. Reported,
   * not enforced, because the market's own move on the day is not an error.
   */
  continuityResidualPercent: number | null;
  reason?: string;
}

export interface AdjustmentValidation {
  ok: boolean;
  /** Hard failures that make the adjusted series untrustworthy. */
  issues: string[];
  /** Informational findings that do not by themselves invalidate the series. */
  warnings: string[];
}

export interface CashEvent {
  symbol: string;
  actionId: string;
  exDate: string;
  perShare: number;
  exDateIndex: number;
}

export interface AdjustmentResult {
  symbol: string;
  mode: AdjustmentMode;
  /** Every row on this result is derived from raw prices and actions. */
  classification: "DERIVED";
  /** The untouched input rows, in the order given. */
  raw: Candle[];
  /** The adjusted rows in the same order as the sorted input. */
  candles: Candle[];
  actions: ActionApplication[];
  cashEvents: CashEvent[];
  validation: AdjustmentValidation;
}

export interface AdjustOptions {
  mode?: AdjustmentMode;
  symbol?: string;
  /**
   * A continuity residual above this percent (absolute) is reported as a
   * warning. Default 50; the check is never a hard failure.
   */
  maxContinuityPercent?: number;
}

// ---------------------------------------------------------------------------
// parsing helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Accept `YYYY-MM-DD` or a full ISO timestamp; return `YYYY-MM-DD` or null. */
export function normalizeExDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const day = text.slice(0, 10);
  if (!DATE_RE.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    return null;
  }
  return day;
}

function numberFrom(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[,%\s]/g, "").trim();
  if (cleaned === "") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse a ratio written as a number, `a:b`, `a/b`, or `a%`.
 * A ratio is new units per existing unit: `1:1` → 1, `50%` → 0.5.
 */
export function parseRatioValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const text = String(value).trim();
  if (text === "") return null;
  const percent = text.match(/^([0-9]*\.?[0-9]+)\s*%$/);
  if (percent?.[1]) {
    const parsed = Number(percent[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed / 100 : null;
  }
  const pair = text.match(/^([0-9]*\.?[0-9]+)\s*[:\/]\s*([0-9]*\.?[0-9]+)$/);
  if (pair?.[1] && pair[2]) {
    const left = Number(pair[1]);
    const right = Number(pair[2]);
    if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
      return null;
    }
    return left / right;
  }
  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeType(value: unknown): CorporateActionType | null {
  const text = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (text === "cashdividend" || text === "dividend" || text === "cash") {
    return "cashDividend";
  }
  if (text === "bonus" || text === "bonusshare" || text === "bonusshares") {
    return "bonus";
  }
  if (text === "right" || text === "rightshare" || text === "rights") {
    return "right";
  }
  if (text === "split" || text === "stocksplit" || text === "sharesplit") {
    return "split";
  }
  return null;
}

function textField(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

/**
 * Turn stored (raw) corporate-action rows into resolved actions.
 *
 * Only an explicit `exDate` field resolves a date. A record date, book
 * closure date or announcement date stored in any other field is deliberately
 * ignored: none of them is the ex-date, and approximating one silently would
 * make every backtest that uses the series look reliable when it is not.
 *
 * An enrichment pass may write a derived date as `exDate` and label it with
 * `dateBasis: "book-closure"`. That label is carried onto the resolved action
 * so coverage and run results can say the date is an approximation. Without a
 * label the basis is `"explicit"`.
 */
export function resolveCorporateActions(
  rawActions: readonly unknown[] | null | undefined,
  options: ResolveActionOptions = {},
): ResolvedActionSet {
  const symbol = (options.symbol ?? "").trim().toUpperCase();
  const resolved: ResolvedCorporateAction[] = [];
  const unresolved: UnresolvedCorporateAction[] = [];
  if (!Array.isArray(rawActions)) {
    return { symbol, resolved, unresolved };
  }

  rawActions.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      unresolved.push({
        symbol,
        rawType: "",
        reason: "corporate action is not an object",
        raw: {},
      });
      return;
    }
    const raw = entry as Record<string, unknown>;
    const actionSymbol =
      textField(raw.symbol)?.toUpperCase() || symbol || "";
    const rawType = String(raw.type ?? "");
    const notesFiscalYear = textField(raw.notes)
      ?.match(/FY\s*(\d{3}\s*[-/]\s*\d{3})/i)?.[1]
      ?.replace(/\s+/g, "");
    const fiscalYear = textField(raw.fiscalYear) ?? notesFiscalYear;
    const sourceUrl = textField(raw.sourceUrl);
    const base = {
      symbol: actionSymbol,
      rawType,
      ...(fiscalYear ? { fiscalYear } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      raw,
    };
    const reject = (reason: string) =>
      unresolved.push({ ...base, reason });

    const type = normalizeType(raw.type);
    if (!type) {
      reject(`unsupported corporate-action type "${rawType}"`);
      return;
    }

    const storedExDate = normalizeExDate(
      raw.exDate ?? raw.ex_date ?? raw.exdate ?? raw["ex-date"],
    );
    const recordDate = normalizeExDate(raw.recordDate ?? raw.record_date);
    if (!storedExDate) {
      reject(
        recordDate
          ? `no ex-date (only a record date, ${recordDate}, is stored; a record date is not an ex-date)`
          : "no ex-date stored; the action cannot be placed on the series",
      );
      return;
    }

    const dateBasis: ActionDateBasis =
      String(raw.dateBasis ?? "").toLowerCase() === "book-closure"
        ? "book-closure"
        : "explicit";
    const percent = numberFrom(raw.percent ?? raw.value ?? raw.ratio);
    const id = `${actionSymbol}:${type}:${fiscalYear ?? ""}:${storedExDate}:${index}`;

    if (type === "cashDividend") {
      const explicitCash =
        numberFrom(raw.dividendPerShare) ?? numberFrom(raw.cashPerShare);
      const declaredPar =
        numberFrom(raw.paidUpValue) ?? numberFrom(raw.parValue);
      const parValue =
        declaredPar !== null && declaredPar > 0
          ? declaredPar
          : Number.isFinite(options.parValue) && (options.parValue ?? 0) > 0
            ? (options.parValue as number)
            : null;
      const dividendPerShare =
        explicitCash ??
        (percent !== null && parValue !== null ? (percent / 100) * parValue : null);
      if (dividendPerShare === null || dividendPerShare <= 0) {
        reject(
          "cash dividend has no cash-per-share amount; a percent of paid-up value needs an explicit paid-up/par value",
        );
        return;
      }
      resolved.push({
        id,
        symbol: actionSymbol,
        type,
        exDate: storedExDate,
        dateBasis,
        ...(percent !== null ? { percent } : {}),
        dividendPerShare,
        ...(fiscalYear ? { fiscalYear } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(textField(raw.notes) ? { notes: textField(raw.notes)! } : {}),
      });
      return;
    }

    if (type === "bonus") {
      const bonusPercent =
        numberFrom(raw.bonusPercent) ?? percent;
      if (bonusPercent === null || bonusPercent <= 0) {
        reject("bonus percent is missing or not positive");
        return;
      }
      resolved.push({
        id,
        symbol: actionSymbol,
        type,
        exDate: storedExDate,
        dateBasis,
        percent: bonusPercent,
        bonusPercent,
        ...(fiscalYear ? { fiscalYear } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(textField(raw.notes) ? { notes: textField(raw.notes)! } : {}),
      });
      return;
    }

    if (type === "right") {
      const ratio =
        parseRatioValue(raw.ratio) ?? parseRatioValue(raw.rightRatio);
      const issuePrice =
        numberFrom(raw.issuePrice) ?? numberFrom(raw.rightPrice) ?? numberFrom(raw.price);
      if (ratio === null || issuePrice === null || issuePrice <= 0) {
        reject(
          "right issue needs both a share ratio and a positive issue price per share",
        );
        return;
      }
      resolved.push({
        id,
        symbol: actionSymbol,
        type,
        exDate: storedExDate,
        dateBasis,
        ratio,
        issuePrice,
        ...(percent !== null ? { percent } : {}),
        ...(fiscalYear ? { fiscalYear } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(textField(raw.notes) ? { notes: textField(raw.notes)! } : {}),
      });
      return;
    }

    // split
    const splitRatio =
      numberFrom(raw.splitRatio) ??
      parseRatioValue(raw.ratio) ??
      (percent !== null ? percent / 100 : null);
    if (splitRatio === null || splitRatio <= 0 || splitRatio === 1) {
      reject("split needs a ratio greater than zero and different from 1");
      return;
    }
    resolved.push({
      id,
      symbol: actionSymbol,
      type,
      exDate: storedExDate,
      dateBasis,
      splitRatio,
      ...(percent !== null ? { percent } : {}),
      ...(fiscalYear ? { fiscalYear } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(textField(raw.notes) ? { notes: textField(raw.notes)! } : {}),
    });
  });

  return { symbol, resolved, unresolved };
}

// ---------------------------------------------------------------------------
// adjustment
// ---------------------------------------------------------------------------

const MIN_PRICE_FACTOR = 1e-9;
const MAX_PRICE_FACTOR = 1e9;

function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function sortCandles(candles: readonly Candle[]): Candle[] {
  return [...candles].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Compute the price factor an action applies to bars before its ex-date.
 * Returns null and writes `reason` when the action cannot be applied.
 */
function factorForAction(
  action: ResolvedCorporateAction,
  previousClose: number | null,
  mode: AdjustmentMode,
): { priceFactor: number | null; reason?: string } {
  if (action.type === "bonus") {
    const percent = action.bonusPercent ?? action.percent;
    if (percent === null || percent === undefined || percent <= 0) {
      return { priceFactor: null, reason: "bonus percent is missing or not positive" };
    }
    return { priceFactor: 1 / (1 + percent / 100) };
  }
  if (action.type === "split") {
    const ratio = action.splitRatio;
    if (ratio === null || ratio === undefined || ratio <= 0 || ratio === 1) {
      return { priceFactor: null, reason: "split ratio must be positive and different from 1" };
    }
    return { priceFactor: 1 / ratio };
  }
  if (action.type === "right") {
    const ratio = action.ratio;
    const issuePrice = action.issuePrice;
    if (ratio === null || ratio === undefined || ratio <= 0) {
      return { priceFactor: null, reason: "right ratio is missing or not positive" };
    }
    if (issuePrice === null || issuePrice === undefined || issuePrice <= 0) {
      return { priceFactor: null, reason: "right issue price is missing or not positive" };
    }
    if (previousClose === null || previousClose <= 0) {
      return { priceFactor: null, reason: "no raw close before the ex-date" };
    }
    return {
      priceFactor:
        (previousClose + ratio * issuePrice) / ((1 + ratio) * previousClose),
    };
  }
  // cash dividend
  const cash = action.dividendPerShare;
  if (cash === null || cash === undefined || cash <= 0) {
    return { priceFactor: null, reason: "cash dividend per share is missing or not positive" };
  }
  if (mode === "totalReturn") {
    return { priceFactor: 1 };
  }
  if (previousClose === null || previousClose <= 0) {
    return { priceFactor: null, reason: "no raw close before the ex-date" };
  }
  if (cash >= previousClose) {
    return {
      priceFactor: null,
      reason: `dividend per share (${cash}) is not below the previous close (${previousClose})`,
    };
  }
  return { priceFactor: (previousClose - cash) / previousClose };
}

/**
 * Adjust a raw daily series for resolved corporate actions.
 *
 * Bars are sorted by timestamp. The factor is applied to a bar only when the
 * bar is strictly before the action's ex-date, so the ex-date bar and later
 * bars are left at their raw level.
 */
export function adjustCandles(
  input: readonly Candle[],
  actions: readonly ResolvedCorporateAction[],
  options: AdjustOptions = {},
): AdjustmentResult {
  const mode = options.mode ?? "price";
  const symbol =
    options.symbol ?? input[0]?.symbol?.toUpperCase() ?? actions[0]?.symbol ?? "";
  const candles = sortCandles(input);
  const raw = [...input];
  const dates = candles.map((candle) => dayOf(candle.timestamp));
  const issues: string[] = [];
  const warnings: string[] = [];
  const applications: ActionApplication[] = [];
  const cashEvents: CashEvent[] = [];
  const maxContinuity = options.maxContinuityPercent ?? 50;

  const applied = actions.map((action) => {
    const exDate = normalizeExDate(action.exDate);
    if (!exDate) {
      const reason = `ex-date "${action.exDate}" is not a valid YYYY-MM-DD date`;
      issues.push(`${action.type} ${action.fiscalYear ?? ""}: ${reason}`);
      applications.push({
        action,
        status: "invalid",
        priceFactor: null,
        volumeFactor: null,
        shareFactor: null,
        cashPerShare: action.dividendPerShare ?? null,
        exDateIndex: null,
        previousClose: null,
        continuityResidualPercent: null,
        reason,
      });
      return null;
    }
    const firstIndex = dates.findIndex((day) => day >= exDate);
    if (firstIndex < 0 || firstIndex === 0) {
      const where = firstIndex < 0 ? "after" : "before";
      const reason = `ex-date ${exDate} is ${where} the stored series; no bars are affected`;
      applications.push({
        action,
        status: "outside-range",
        priceFactor: null,
        volumeFactor: null,
        shareFactor: null,
        cashPerShare: action.dividendPerShare ?? null,
        exDateIndex: firstIndex < 0 ? null : firstIndex,
        previousClose: null,
        continuityResidualPercent: null,
        reason,
      });
      warnings.push(`${action.type} ${action.fiscalYear ?? ""}: ${reason}`);
      return null;
    }

    const previousClose = candles[firstIndex - 1]?.close ?? null;
    const { priceFactor, reason } = factorForAction(action, previousClose, mode);
    if (
      priceFactor === null ||
      !Number.isFinite(priceFactor) ||
      priceFactor <= MIN_PRICE_FACTOR ||
      priceFactor > MAX_PRICE_FACTOR
    ) {
      const detail = reason ?? `price factor ${priceFactor} is outside the sane range`;
      issues.push(`${action.type} ${action.fiscalYear ?? ""}: ${detail}`);
      applications.push({
        action,
        status: "invalid",
        priceFactor: null,
        volumeFactor: null,
        shareFactor: null,
        cashPerShare: action.dividendPerShare ?? null,
        exDateIndex: firstIndex,
        previousClose,
        continuityResidualPercent: null,
        reason: detail,
      });
      return null;
    }

    const shareFactor =
      action.type === "bonus"
        ? 1 + (action.bonusPercent ?? action.percent ?? 0) / 100
        : action.type === "right"
          ? 1 + (action.ratio ?? 0)
          : action.type === "split"
            ? (action.splitRatio ?? 1)
            : 1;
    const cashPerShare =
      action.type === "cashDividend" ? (action.dividendPerShare ?? null) : null;

    // Continuity is informational: the market's own move on the ex-date is
    // not an adjustment error, so a residual never fails the series by itself.
    let continuityResidualPercent: number | null = null;
    const exClose = candles[firstIndex]?.close;
    if (
      mode === "price" &&
      previousClose !== null &&
      previousClose > 0 &&
      exClose !== undefined &&
      exClose > 0
    ) {
      const expected = previousClose * priceFactor;
      if (expected > 0) {
        continuityResidualPercent = (exClose / expected - 1) * 100;
        if (Math.abs(continuityResidualPercent) > maxContinuity) {
          warnings.push(
            `${action.type} ${action.fiscalYear ?? ""}: ex-date residual ${continuityResidualPercent.toFixed(1)}% is large; check the factor and the stored prices`,
          );
        }
      }
    }

    applications.push({
      action,
      status: "applied",
      priceFactor,
      volumeFactor: 1 / priceFactor,
      shareFactor,
      cashPerShare,
      exDateIndex: firstIndex,
      previousClose,
      continuityResidualPercent,
    });
    if (action.type === "cashDividend" && cashPerShare !== null) {
      cashEvents.push({
        symbol,
        actionId: action.id,
        exDate,
        perShare: cashPerShare,
        exDateIndex: firstIndex,
      });
    }
    return { action, firstIndex, priceFactor };
  });

  // Per-index product of the factors whose ex-date starts at that index.
  const atIndex = new Array<number>(candles.length).fill(1);
  for (const entry of applied) {
    if (!entry) continue;
    atIndex[entry.firstIndex] = (atIndex[entry.firstIndex] ?? 1) * entry.priceFactor;
  }
  // suffix[i] = product of factors for actions whose ex-date is after bar i.
  const suffix = new Array<number>(candles.length).fill(1);
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const next = index + 1 < candles.length ? (suffix[index + 1] ?? 1) : 1;
    const at = index + 1 < candles.length ? (atIndex[index + 1] ?? 1) : 1;
    suffix[index] = next * at;
  }

  const adjusted = candles.map((candle, index) => {
    const factor = suffix[index] ?? 1;
    const scaled = factor !== 1;
    if (scaled) {
      const volume = candle.volume / factor;
      if (!Number.isFinite(volume) || volume < 0) {
        issues.push(
          `bar ${dayOf(candle.timestamp)}: adjusted volume ${volume} is not a valid volume`,
        );
      }
      const next: Candle = {
        ...candle,
        open: candle.open * factor,
        high: candle.high * factor,
        low: candle.low * factor,
        close: candle.close * factor,
        volume: Number.isFinite(volume) && volume >= 0 ? volume : candle.volume,
        adjusted: true,
        adjustmentFactor: factor,
      };
      if (
        !Number.isFinite(next.open) ||
        !Number.isFinite(next.high) ||
        !Number.isFinite(next.low) ||
        !Number.isFinite(next.close) ||
        next.open <= 0 ||
        next.high <= 0 ||
        next.low <= 0 ||
        next.close <= 0
      ) {
        issues.push(
          `bar ${dayOf(candle.timestamp)}: adjusted OHLC is not positive and finite`,
        );
      }
      if (
        next.high < next.low ||
        next.high < Math.max(next.open, next.close) ||
        next.low > Math.min(next.open, next.close)
      ) {
        issues.push(
          `bar ${dayOf(candle.timestamp)}: adjusted OHLC is inconsistent`,
        );
      }
      return next;
    }
    return candle;
  });

  return {
    symbol,
    mode,
    classification: "DERIVED",
    raw,
    candles: adjusted,
    actions: applications,
    cashEvents,
    validation: { ok: issues.length === 0, issues, warnings },
  };
}

/** True when every resolved action used by a series applied cleanly. */
export function adjustmentIsComplete(result: AdjustmentResult): boolean {
  return (
    result.validation.ok &&
    result.actions.every((action) => action.status !== "invalid")
  );
}

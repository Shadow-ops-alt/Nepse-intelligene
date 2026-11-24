/**
 * Annualised internal rate of return for an irregular cash-flow series.
 *
 * Dates may be `YYYY-MM-DD` or a full ISO timestamp; only the calendar date is
 * used and the year is treated as 365 days. The rate is solved with Newton's
 * method from `guess`, falling back to bisection on [-0.9999, 10]. A series
 * without both a positive and a negative flow, or one that cannot be solved,
 * returns null: this function never invents a rate.
 */

export interface XirrFlow {
  /** `YYYY-MM-DD` or an ISO timestamp. */
  date: string;
  /** Positive for money received, negative for money invested. */
  amount: number;
}

const DAY_MS = 86_400_000;
const MIN_RATE = -0.9999;
const MAX_RATE = 10;
const NEWTON_TOLERANCE = 1e-9;
const NPV_TOLERANCE = 1e-7;
const NEWTON_ITERATIONS = 100;
const BISECTION_ITERATIONS = 300;

interface DatedFlow {
  amount: number;
  /** Days from the earliest flow's calendar date. */
  days: number;
}

function dayNumber(value: string): number | null {
  const text = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(ms) ? ms / DAY_MS : null;
}

function netPresentValue(flows: DatedFlow[], rate: number): number {
  const base = 1 + rate;
  let total = 0;
  for (const flow of flows) {
    total += flow.amount / Math.pow(base, flow.days / 365);
  }
  return total;
}

function derivative(flows: DatedFlow[], rate: number): number {
  const base = 1 + rate;
  let total = 0;
  for (const flow of flows) {
    total -=
      ((flow.days / 365) * flow.amount) /
      Math.pow(base, flow.days / 365 + 1);
  }
  return total;
}

function newton(flows: DatedFlow[], guess: number): number | null {
  let rate = guess;
  for (let iteration = 0; iteration < NEWTON_ITERATIONS; iteration += 1) {
    const value = netPresentValue(flows, rate);
    const slope = derivative(flows, rate);
    if (!Number.isFinite(value) || !Number.isFinite(slope) || slope === 0) {
      return null;
    }
    const next = rate - value / slope;
    if (!Number.isFinite(next) || next <= MIN_RATE || next > MAX_RATE) {
      return null;
    }
    if (Math.abs(next - rate) < NEWTON_TOLERANCE) {
      return Math.abs(netPresentValue(flows, next)) < NPV_TOLERANCE
        ? next
        : null;
    }
    rate = next;
  }
  return Math.abs(netPresentValue(flows, rate)) < NPV_TOLERANCE ? rate : null;
}

function bisection(flows: DatedFlow[]): number | null {
  let low = MIN_RATE;
  let high = MAX_RATE;
  let lowValue = netPresentValue(flows, low);
  let highValue = netPresentValue(flows, high);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue)) return null;
  if (lowValue === 0) return low;
  if (highValue === 0) return high;
  if (lowValue * highValue > 0) return null;

  for (let iteration = 0; iteration < BISECTION_ITERATIONS; iteration += 1) {
    const mid = (low + high) / 2;
    const midValue = netPresentValue(flows, mid);
    if (!Number.isFinite(midValue)) return null;
    if (Math.abs(midValue) < NPV_TOLERANCE || high - low < 1e-12) {
      return mid;
    }
    if (lowValue * midValue <= 0) {
      high = mid;
      highValue = midValue;
    } else {
      low = mid;
      lowValue = midValue;
    }
  }
  return (low + high) / 2;
}

/**
 * Solve the annualised rate where the net present value of `flows` is zero.
 * Returns null for fewer than two usable flows, for a series that is entirely
 * positive or entirely negative, or when neither method converges.
 */
export function xirr(flows: readonly XirrFlow[], guess = 0.1): number | null {
  if (flows.length < 2) return null;

  const dated: Array<{ amount: number; day: number }> = [];
  let hasPositive = false;
  let hasNegative = false;
  for (const flow of flows) {
    if (!Number.isFinite(flow.amount) || flow.amount === 0) continue;
    const day = dayNumber(String(flow.date));
    if (day === null) return null;
    dated.push({ amount: flow.amount, day });
    if (flow.amount > 0) hasPositive = true;
    else hasNegative = true;
  }
  if (dated.length < 2 || !hasPositive || !hasNegative) return null;

  const baseDay = Math.min(...dated.map((flow) => flow.day));
  const normalized: DatedFlow[] = dated.map((flow) => ({
    amount: flow.amount,
    days: flow.day - baseDay,
  }));

  const safeGuess =
    Number.isFinite(guess) && guess > MIN_RATE && guess <= MAX_RATE
      ? guess
      : 0.1;
  return newton(normalized, safeGuess) ?? bisection(normalized);
}

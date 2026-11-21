/** Shapes returned by the local API's unofficial live endpoints. */

export interface LiveStatus {
  enabled: boolean;
  source: string;
  marketOpen: boolean | null;
  asOf: string | null;
  lastError: string | null;
  disclaimer: string;
}

export interface LiveQuote {
  symbol: string;
  securityName?: string;
  ltp: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  turnover: number | null;
  lastTradedAt: string | null;
}

export interface LiveMarket {
  enabled: boolean;
  marketOpen: boolean | null;
  asOf: string | null;
  rows: LiveQuote[];
  lastError: string | null;
}

export interface LiveIndex {
  value: number;
  change: number | null;
  changePercent: number | null;
}

export interface LiveSummary {
  enabled: boolean;
  asOf: string | null;
  index: LiveIndex | null;
  turnover: number | null;
  sharesTraded: number | null;
  transactions: number | null;
  scripsTraded: number | null;
  lastError: string | null;
}

export interface LiveDepth {
  enabled: boolean;
  asOf: string | null;
  symbol: string;
  bids: Array<{ price: number; quantity: number; orders?: number }>;
  asks: Array<{ price: number; quantity: number; orders?: number }>;
  lastError: string | null;
}

/** Chart intervals. `1D` is the stored end-of-day series. */
export type ChartTimeframe =
  | "1m"
  | "2m"
  | "3m"
  | "5m"
  | "10m"
  | "15m"
  | "30m"
  | "1h"
  | "1D";

export interface TimeframeOption {
  value: ChartTimeframe;
  label: string;
  /** Resampling width in minutes; null for the daily series. */
  minutes: number | null;
}

export const TIMEFRAME_OPTIONS: TimeframeOption[] = [
  { value: "1m", label: "1m", minutes: 1 },
  { value: "2m", label: "2m", minutes: 2 },
  { value: "3m", label: "3m", minutes: 3 },
  { value: "5m", label: "5m", minutes: 5 },
  { value: "10m", label: "10m", minutes: 10 },
  { value: "15m", label: "15m", minutes: 15 },
  { value: "30m", label: "30m", minutes: 30 },
  { value: "1h", label: "1h", minutes: 60 },
  { value: "1D", label: "1D", minutes: null },
];

export function minutesFor(timeframe: ChartTimeframe): number | null {
  return TIMEFRAME_OPTIONS.find((option) => option.value === timeframe)?.minutes ?? null;
}

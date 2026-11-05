export type DataClassification =
  | "VERIFIED"
  | "UNVERIFIED"
  | "DERIVED"
  | "DEMO"
  | "MISSING";

export type DataState = "live" | "delayed" | "eod" | "stale" | "unavailable";

export interface ProviderDescriptor {
  id: string;
  name: string;
  sourceType: "licensed" | "unofficial" | "manual" | "mock";
  environment: string;
  termsStatus: string;
  productionReady: boolean;
  reliability: string;
  priority: number;
  capabilities: string[];
  notes?: string;
}

export interface StoreSummary {
  providerId: string | null;
  companies: number;
  candles: number;
  quotes: number;
  snapshots: number;
  syncRuns: number;
  lastFetchedAt: string | null;
}

/** Provenance attached to every stored record. */
export interface Provenance {
  providerId: string;
  sourceType: string;
  termsStatus: string;
  productionReady: boolean;
  fetchedAt: string;
  asOf: string | null;
  classification: DataClassification;
  state: DataState;
  stale: boolean;
  maxAgeSeconds: number;
  ageSeconds: number | null;
}

export interface DataStateSummary {
  state: DataState;
  stale: boolean;
  total: number;
  counts: Record<DataState, number>;
  lastAsOf: string | null;
  classification?: DataClassification;
}

export interface Meta {
  edition: "free" | "licensed";
  environment: string;
  providerId: string;
  provider: ProviderDescriptor | null;
  providerError: string | null;
  policy: {
    allowUnofficial: boolean;
    requireVerifiedTerms: boolean;
    requireProductionReady: boolean;
  };
  store: StoreSummary;
  dataState: DataStateSummary & { classification: DataClassification };
}

export interface DatasetAvailability {
  capability: string;
  /** The provider can read this dataset. */
  implemented: boolean;
  /** Data for it is actually stored. */
  available: boolean;
  session: "eod" | "static" | null;
  classification: DataClassification;
  unavailableReason: string | null;
  note: string | null;
}

export interface Coverage {
  providerId: string;
  classification: DataClassification;
  /** Capabilities the provider implements — not proof that data exists. */
  available: string[];
  missing: string[];
  datasets?: DatasetAvailability[];
  store: StoreSummary;
}

export interface Company {
  id: string;
  symbol: string;
  name: string;
  sector: string;
  instrumentType: string;
  status: string;
}

export interface Candle {
  symbol: string;
  timeframe: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover?: number;
  trades?: number;
  adjusted: boolean;
  adjustmentFactor?: number;
}

export interface Quote {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  turnover: number;
  trades?: number;
  session?: "live" | "eod";
  asOf: string;
}

export interface MarketSummary {
  indexName: string;
  indexValue: number;
  change: number;
  changePercent: number;
  turnover: number;
  sharesTraded: number;
  transactions: number;
  scripsTraded: number;
  asOf: string;
}

export interface SectorPerformance {
  sector: string;
  indexValue?: number;
  changePercent?: number;
  turnover?: number;
  volume?: number;
  companies?: number;
}

export interface Analysis {
  symbol: string;
  from: string | null;
  to: string | null;
  observations: number;
  lastClose: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  rsi14: number | null;
  high52w: number | null;
  low52w: number | null;
  returnPercent: number | null;
}

export interface PortfolioTransaction {
  id: number;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fees: number;
  tradedAt: string;
  notes: string | null;
  createdAt: string;
}

export interface PortfolioPosition {
  symbol: string;
  quantity: number;
  averageCost: number;
  costBasis: number;
  marketPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
  realizedPnl: number;
  firstTradeAt: string;
  lastTradeAt: string;
  quoteAsOf: string | null;
  valuation: Provenance | null;
}

export interface PortfolioTotals {
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  pricedPositions: number;
  unpricedPositions: number;
}

export interface PortfolioResponse {
  providerId: string;
  transactions: PortfolioTransaction[];
  positions: PortfolioPosition[];
  totals: PortfolioTotals;
  warnings: string[];
  dataState: DataStateSummary;
}

export interface ScreenerRow {
  symbol: string;
  from: string | null;
  to: string | null;
  observations: number;
  lastClose: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  rsi14: number | null;
  high52w: number | null;
  low52w: number | null;
  returnPercent: number | null;
  averageVolume20: number | null;
  volumeRatio: number | null;
  distanceFromHigh52w: number | null;
  aboveSma20: boolean | null;
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
  trend: "up" | "down" | "sideways" | null;
  rsiZone: "oversold" | "neutral" | "overbought" | null;
  return1M: number | null;
  return3M: number | null;
  return1Y: number | null;
  volatility3M: number | null;
  atrPercent: number | null;
  macdHistogram: number | null;
  macdState: "bullish" | "bearish" | null;
  maxDrawdown1Y: number | null;
  position52w: number | null;
  cross: { type: "golden" | "death"; sessionsAgo: number } | null;
  patterns: Array<{
    id: string;
    name: string;
    bias: "bullish" | "bearish" | "neutral";
  }>;
  signalScore: number | null;
  signalRating:
    | "strong-bullish"
    | "bullish"
    | "neutral"
    | "bearish"
    | "strong-bearish"
    | null;
  provenance: Provenance;
}

export interface ScreenerResponse {
  providerId: string;
  generatedAt: string;
  rows: ScreenerRow[];
  dataState: DataStateSummary;
}

export interface CompaniesResponse {
  providerId: string;
  companies: Company[];
  provenance: Record<string, Provenance>;
  dataState: DataStateSummary;
}

export interface QuotesResponse {
  providerId: string;
  quotes: Quote[];
  provenance: Record<string, Provenance>;
  dataState: DataStateSummary;
}

export interface SummaryResponse {
  providerId: string;
  summary: MarketSummary | null;
  sectors: SectorPerformance[] | null;
  provenance: {
    summary: Provenance | null;
    sectors: Provenance | null;
  };
  dataState: DataStateSummary;
}

export interface IndexQuote {
  symbol: string;
  name: string;
  isSector: boolean;
  value: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  asOf: string | null;
  provenance: Provenance | null;
}

export interface IndicesResponse {
  providerId: string;
  indices: IndexQuote[];
  dataState: DataStateSummary;
}

export interface CandlesResponse {
  providerId: string;
  symbol: string;
  kind: "equity" | "index";
  candles: Candle[];
  provenance: Provenance | null;
  dataState: DataStateSummary;
}

export interface AnalysisResponse {
  providerId: string;
  symbol: string;
  analysis: Analysis | null;
  provenance: Provenance | null;
  dataState: DataStateSummary;
}

export interface ImportStatus {
  dataDir: string;
  edition: "free" | "licensed";
  canImport: boolean;
  files: Array<{
    name: string;
    required: boolean;
    exists: boolean;
    bytes: number;
  }>;
  ohlc: string[];
  indices: string[];
  ready: boolean;
  missing: string[];
  syncing: boolean;
  store: StoreSummary;
}

export interface ImportResult {
  result: {
    providerId: string;
    status: string;
    companies: number;
    equitySeries: number;
    candleRows: number;
    quotes: number;
    snapshots: number;
    written: boolean;
    failedSymbols: string[];
    warnings: string[];
    gaps: string[];
  };
  store: StoreSummary;
}

export interface ImportPreview {
  preview: ImportResult["result"];
  files: ImportStatus["files"];
  ohlc: string[];
  indices: string[];
}

export interface ImportAuditEntry {
  id: number;
  syncRunId: number | null;
  providerId: string;
  startedAt: string;
  finishedAt: string;
  status: string;
  files: string[];
  counts: Record<string, number>;
  warnings: string[];
  failedSymbols: string[];
}

export interface ImportHistory {
  providerId: string;
  entries: ImportAuditEntry[];
}

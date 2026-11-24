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

export type RefreshPhase =
  | "idle"
  | "checking"
  | "archive"
  | "bulk"
  | "details"
  | "sync"
  | "done"
  | "error";

export interface RefreshSummary {
  startedAt: string;
  finishedAt: string;
  commit: string;
  companies: number;
  candles: number;
  quotes: number;
  latestSession: string | null;
  bulkFailures: number;
  detailsFailures: number;
  warnings: number;
  /** True when the archive came from the cached checkout. */
  cached?: boolean;
  /** Plain-language note when cached data was used. */
  cacheNote?: string | null;
}

/** State of the automatic background refresh in the local API. */
export interface RefreshStatus {
  enabled: boolean;
  running: boolean;
  phase: RefreshPhase;
  reason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextCheckAt: string | null;
  consecutiveFailures: number;
  intervalMinutes: number;
  commit: string | null;
  latestSession: string | null;
  detailsEnabled: boolean;
  lastProgress: string | null;
  lastResult: RefreshSummary | null;
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
  refresh?: RefreshStatus;
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
  email?: string;
  website?: string;
  regulatoryBody?: string;
  listedAt?: string;
  marketCap?: number;
  /** Unofficial public profile fields. */
  sharesOutstanding?: number;
  paidUpValue?: number;
  totalPaidUpValue?: number;
  operationDate?: string;
  registrar?: string;
  address?: string;
  phone?: string;
  profileSource?: string;
  profileAsOf?: string;
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
  /** Calendar 7 / 14-day returns (percent); base = last close on/before the cutoff. */
  return1W?: number | null;
  return2W?: number | null;
  lastVolume?: number | null;
  /** Mean volume of the 20 sessions BEFORE the last one (averageVolume20 includes it). */
  avgVolume20?: number | null;
  volume3d?: number | null;
  volume3dRatio?: number | null;
  volume5d?: number | null;
  turnover5d?: number | null;
  priceChange3d?: number | null;
  upDays3?: number;
  volumeBreakout?: boolean;
  /** Mean absolute daily move of the last 20 sessions, percent. */
  avgAbsMove20?: number | null;
  supertrendDir?: 1 | -1 | null;
  adx14?: number | null;
  /** RSI 14 of the previous session. */
  rsiPrev?: number | null;
  /** Signal events of the last 5 sessions of this series, oldest first. */
  events?: Array<{
    id: string;
    index: number;
    timestamp: string;
    type: string;
    direction: "bullish" | "bearish" | "neutral";
    label: string;
    detail: string;
  }>;
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

export interface MetricValue {
  metric: string;
  value: number | null;
  unit: string;
  currency?: string;
  period?: string;
  fiscalYear?: string;
  quarter?: number;
  reportedAt?: string;
  source?: string;
  confidence: string;
  notes?: string;
}

export interface FundamentalsSnapshot {
  symbol: string;
  asOf: string;
  period: string;
  fiscalYear?: string;
  quarter?: number;
  metrics: Record<string, MetricValue>;
  sourceUrl?: string;
  reportedAt?: string;
}

export interface FundamentalsResponse {
  providerId: string;
  symbol: string;
  latest: FundamentalsSnapshot | null;
  history: FundamentalsSnapshot[];
  provenance: {
    latest: Provenance | null;
    history: Provenance | null;
  };
  dataState: DataStateSummary;
}

export interface FundamentalsIndexResponse {
  providerId: string;
  symbols: string[];
}

export interface CorporateAction {
  symbol: string;
  type: string;
  ratio?: string;
  value?: number;
  currency?: string;
  announcedAt?: string;
  exDate?: string;
  recordDate?: string;
  sourceUrl?: string;
  notes?: string;
}

export interface CorporateActionsResponse {
  providerId: string;
  symbol: string;
  actions: CorporateAction[];
  provenance: Provenance | null;
  dataState: DataStateSummary;
}

export interface CorporateActionsIndexResponse {
  providerId: string;
  symbols: string[];
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  source: string;
  symbols: string[];
  summary?: string;
  fetchedAt?: string;
}

export interface NewsResponse {
  providerId: string;
  news: NewsItem[];
  provenance: Provenance | null;
  dataState: DataStateSummary;
}

export interface Ipo {
  id: string;
  companyName: string;
  symbol?: string;
  type: string;
  openDate?: string;
  closeDate?: string;
  price?: number;
  units?: number;
  status: string;
  sourceUrl?: string;
  notes?: string;
}

export interface IposResponse {
  providerId: string;
  ipos: Ipo[];
  provenance: Provenance | null;
  dataState: DataStateSummary;
}

export interface FloorsheetTrade {
  contractId: string;
  businessDate: string;
  symbol: string;
  buyerBroker: string;
  sellerBroker: string;
  quantity: number;
  rate: number;
  amount: number;
  asOf?: string;
}

export interface FloorsheetResponse {
  providerId: string;
  date: string | null;
  trades: FloorsheetTrade[];
  availableDates: string[];
  provenance: Provenance | null;
  dataState: DataStateSummary;
}

export interface BrokerFlow {
  brokerId: string;
  businessDate: string;
  buyQuantity: number;
  buyAmount: number;
  sellQuantity: number;
  sellAmount: number;
  netQuantity: number;
  netAmount: number;
  symbols?: string[];
}

export interface BrokerFlowsResponse {
  providerId: string;
  date: string | null;
  flows: BrokerFlow[];
  availableDates: string[];
  provenance: Provenance | null;
  dataState: DataStateSummary;
}

export interface MutualFundNav {
  symbol: string;
  asOf: string | null;
  period: string | null;
  metrics: Record<string, MetricValue>;
}

export interface MutualFundsResponse {
  providerId: string;
  funds: MutualFundNav[];
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
    fundamentals?: number;
    corporateActions?: number;
    ipos?: number;
    news?: number;
    floorsheetTrades?: number;
    brokerFlows?: number;
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

// ---------------------------------------------------------------------------
// Trading workflow: plans, journal, reconciliation and data quality
// ---------------------------------------------------------------------------

export type TradeSide = "buy" | "sell";

export interface TradePlan {
  id: number;
  symbol: string;
  side: TradeSide;
  entry: number;
  stop: number;
  targets: number[];
  quantity: number;
  riskAmount: number | null;
  riskPercent: number | null;
  rewardRisk: number | null;
  fees: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradePlansResponse {
  plans: TradePlan[];
}

export interface TradePlanResponse {
  plan: TradePlan;
}

export interface JournalEntry {
  id: number;
  planId: number | null;
  symbol: string;
  side: TradeSide;
  paper: boolean;
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget: number | null;
  actualEntry: number | null;
  actualExit: number | null;
  quantity: number | null;
  fees: number | null;
  pnl: number | null;
  reason: string | null;
  mistakes: string | null;
  tags: string[];
  /** Stored as JSON by the API; usually a string, so the form stringifies it. */
  snapshot: unknown;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JournalResponse {
  entries: JournalEntry[];
}

export interface JournalEntryResponse {
  entry: JournalEntry;
}

export interface ReconciliationImportResult {
  imported: number;
  skipped: number;
  importId: number | null;
}

export interface ReconciliationExposure {
  symbol: string;
  marketValue: number;
  percent: number;
}

export interface ReconciliationConcentration {
  topSymbol: string | null;
  topPercent: number;
  hhi: number;
}

export interface ReconciliationImportRecord {
  id: number;
  source: string;
  importedAt: string;
  rowsCount: number;
}

export interface ReconciliationSummary {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  xirr: number | null;
  dividends: number;
  bonusShares: number;
  rightsShares: number;
  exposure: ReconciliationExposure[];
  concentration: ReconciliationConcentration;
  imports: ReconciliationImportRecord[];
}

export type CorporateLedgerKind = "dividend" | "bonus" | "right";

export interface CorporateLedgerEntry {
  id: number;
  symbol: string;
  kind: CorporateLedgerKind | string;
  exDate: string | null;
  amount: number | null;
  shares: number | null;
  notes: string | null;
  createdAt: string;
}

export interface CorporateLedgerResponse {
  entries: CorporateLedgerEntry[];
}

export type DataQualityStatus = "fresh" | "stale" | "thin" | "discrepancy" | string;

export interface DataQualitySymbol {
  symbol: string;
  /** Last stored candle close (a price, not a date). */
  lastCandle: number | null;
  /** Stored quote LTP (a price, not a date). */
  lastQuote: number | null;
  sessions: number;
  missingSessions: number;
  staleDays: number | null;
  quoteVsCandlePercent: number | null;
  status: DataQualityStatus;
}

export interface DataQualitySummary {
  symbols: number;
  fresh: number;
  stale: number;
  missingSessions: number;
  quoteDiscrepancies: number;
}

export interface DataQualityResponse {
  generatedAt: string;
  latestSession: string | null;
  summary: DataQualitySummary;
  symbols: DataQualitySymbol[];
}

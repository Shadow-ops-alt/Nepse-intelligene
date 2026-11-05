import { z } from "zod";
import { IsoDateTimeSchema, TradingDateSchema } from "./common";

export const CompanyStatusSchema = z.enum([
  "active",
  "suspended",
  "delisted",
  "unknown",
]);

export const CompanySchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string().min(1),
  sector: z.string().min(1),
  instrumentType: z.string().min(1),
  status: CompanyStatusSchema.default("unknown"),
  email: z.string().optional(),
  website: z.string().optional(),
  regulatoryBody: z.string().optional(),
  listedAt: TradingDateSchema.optional(),
  marketCap: z.number().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Company = z.infer<typeof CompanySchema>;

export const SecuritySchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string().min(1),
  companyId: z.string().optional(),
  instrumentType: z.string().min(1),
  isPromoter: z.boolean().default(false),
  status: CompanyStatusSchema.default("unknown"),
});

export type Security = z.infer<typeof SecuritySchema>;

export const SectorSchema = z.object({
  name: z.string().min(1),
  indexSymbol: z.string().optional(),
  companyCount: z.number().int().nonnegative().optional(),
  turnover: z.number().nonnegative().optional(),
  volume: z.number().nonnegative().optional(),
  changePercent: z.number().finite().optional(),
});

export type Sector = z.infer<typeof SectorSchema>;

export const IndexSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  isSector: z.boolean().default(false),
});

export type MarketIndex = z.infer<typeof IndexSchema>;

export const TimeframeSchema = z.enum([
  "1min",
  "5min",
  "15min",
  "30min",
  "1h",
  "1day",
  "1week",
  "1month",
]);

export type Timeframe = z.infer<typeof TimeframeSchema>;

export const CandleSchema = z
  .object({
    symbol: z.string().min(1),
    timeframe: TimeframeSchema,
    timestamp: IsoDateTimeSchema,
    open: z.number().finite(),
    high: z.number().finite(),
    low: z.number().finite(),
    close: z.number().finite(),
    volume: z.number().nonnegative(),
    turnover: z.number().nonnegative().optional(),
    trades: z.number().int().nonnegative().optional(),
    adjusted: z.boolean().default(false),
    adjustmentFactor: z.number().positive().optional(),
  })
  .refine(
    (c) =>
      c.high >= c.low &&
      c.high >= Math.max(c.open, c.close) &&
      c.low <= Math.min(c.open, c.close),
    { message: "OHLC values are inconsistent" },
  );

export type Candle = z.infer<typeof CandleSchema>;

export const QuoteSchema = z.object({
  symbol: z.string().min(1),
  ltp: z.number().finite(),
  change: z.number().finite(),
  changePercent: z.number().finite(),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  previousClose: z.number().finite(),
  volume: z.number().nonnegative(),
  turnover: z.number().nonnegative(),
  trades: z.number().int().nonnegative().optional(),
  /** End-of-day quote, not a live tick. */
  session: z.enum(["live", "eod"]).optional(),
  asOf: IsoDateTimeSchema,
});

export type Quote = z.infer<typeof QuoteSchema>;

export const MarketSummarySchema = z.object({
  indexName: z.string().min(1).default("NEPSE"),
  indexValue: z.number().finite(),
  change: z.number().finite(),
  changePercent: z.number().finite(),
  turnover: z.number().nonnegative(),
  sharesTraded: z.number().nonnegative(),
  transactions: z.number().int().nonnegative(),
  scripsTraded: z.number().int().nonnegative(),
  asOf: IsoDateTimeSchema,
});

export type MarketSummary = z.infer<typeof MarketSummarySchema>;

export const SectorPerformanceSchema = z.object({
  sector: z.string().min(1),
  indexValue: z.number().finite().optional(),
  changePercent: z.number().finite().optional(),
  turnover: z.number().nonnegative().optional(),
  volume: z.number().nonnegative().optional(),
  companies: z.number().int().nonnegative().optional(),
});

export type SectorPerformance = z.infer<typeof SectorPerformanceSchema>;

export const FloorsheetTradeSchema = z.object({
  contractId: z.string().min(1),
  businessDate: TradingDateSchema,
  symbol: z.string().min(1),
  buyerBroker: z.string().min(1),
  sellerBroker: z.string().min(1),
  quantity: z.number().positive(),
  rate: z.number().positive(),
  amount: z.number().nonnegative(),
  asOf: IsoDateTimeSchema.optional(),
});

export type FloorsheetTrade = z.infer<typeof FloorsheetTradeSchema>;

export const BrokerFlowSchema = z.object({
  brokerId: z.string().min(1),
  businessDate: TradingDateSchema,
  buyQuantity: z.number().nonnegative(),
  buyAmount: z.number().nonnegative(),
  sellQuantity: z.number().nonnegative(),
  sellAmount: z.number().nonnegative(),
  netQuantity: z.number().finite(),
  netAmount: z.number().finite(),
  symbols: z.array(z.string()).optional(),
});

export type BrokerFlow = z.infer<typeof BrokerFlowSchema>;

export const MetricUnitSchema = z.enum([
  "percent",
  "currency",
  "ratio",
  "shares",
  "number",
  "days",
  "unknown",
]);

export const MetricConfidenceSchema = z.enum([
  "verified",
  "reported",
  "derived",
  "estimated",
  "unverified",
]);

export const MetricValueSchema = z.object({
  metric: z.string().min(1),
  value: z.number().finite().nullable(),
  unit: MetricUnitSchema.default("unknown"),
  currency: z.string().optional(),
  period: z.string().optional(),
  fiscalYear: z.string().optional(),
  quarter: z.number().int().min(1).max(4).optional(),
  reportedAt: TradingDateSchema.optional(),
  source: z.string().optional(),
  confidence: MetricConfidenceSchema.default("unverified"),
  notes: z.string().optional(),
});

export type MetricValue = z.infer<typeof MetricValueSchema>;

export const FundamentalsSnapshotSchema = z.object({
  symbol: z.string().min(1),
  asOf: IsoDateTimeSchema,
  period: z.string().min(1),
  fiscalYear: z.string().optional(),
  quarter: z.number().int().min(1).max(4).optional(),
  metrics: z.record(z.string(), MetricValueSchema),
  sourceUrl: z.string().optional(),
  reportedAt: TradingDateSchema.optional(),
});

export type FundamentalsSnapshot = z.infer<typeof FundamentalsSnapshotSchema>;

export const CorporateActionTypeSchema = z.enum([
  "bonus",
  "right",
  "cashDividend",
  "split",
  "merger",
  "acquisition",
  "other",
]);

export const CorporateActionSchema = z.object({
  symbol: z.string().min(1),
  type: CorporateActionTypeSchema,
  ratio: z.string().optional(),
  value: z.number().optional(),
  currency: z.string().optional(),
  announcedAt: TradingDateSchema.optional(),
  exDate: TradingDateSchema.optional(),
  recordDate: TradingDateSchema.optional(),
  sourceUrl: z.string().optional(),
  notes: z.string().optional(),
});

export type CorporateAction = z.infer<typeof CorporateActionSchema>;

export const IpoTypeSchema = z.enum([
  "ipo",
  "fpo",
  "right",
  "mutualFund",
  "debenture",
]);

export const IpoStatusSchema = z.enum([
  "upcoming",
  "open",
  "closed",
  "allotment",
  "listed",
  "unknown",
]);

export const IpoSchema = z.object({
  id: z.string().min(1),
  companyName: z.string().min(1),
  symbol: z.string().optional(),
  type: IpoTypeSchema,
  openDate: TradingDateSchema.optional(),
  closeDate: TradingDateSchema.optional(),
  price: z.number().positive().optional(),
  units: z.number().positive().optional(),
  status: IpoStatusSchema.default("unknown"),
  sourceUrl: z.string().optional(),
  notes: z.string().optional(),
});

export type Ipo = z.infer<typeof IpoSchema>;

export const NewsItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().min(1),
  publishedAt: IsoDateTimeSchema,
  source: z.string().min(1),
  symbols: z.array(z.string()).default([]),
  summary: z.string().optional(),
  fetchedAt: IsoDateTimeSchema.optional(),
});

export type NewsItem = z.infer<typeof NewsItemSchema>;

export const ProviderHealthSchema = z.object({
  providerId: z.string().min(1),
  status: z.enum(["ok", "degraded", "down", "unknown"]),
  checkedAt: IsoDateTimeSchema,
  latencyMs: z.number().nonnegative().optional(),
  lastSuccessAt: IsoDateTimeSchema.optional(),
  lastFailureAt: IsoDateTimeSchema.optional(),
  consecutiveFailures: z.number().int().nonnegative().default(0),
  message: z.string().optional(),
});

export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

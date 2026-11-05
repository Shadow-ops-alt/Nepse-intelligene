import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import {
  BaseProvider,
  DataValidationError,
  ProviderResponseError,
  type BrokerFlow,
  type Candle,
  type Capability,
  type Company,
  type CorporateAction,
  type DataEnvelope,
  type DateRange,
  type Environment,
  type FloorsheetTrade,
  type FundamentalsSnapshot,
  type Ipo,
  type MarketIndex,
  type MarketSummary,
  type MetricValue,
  type NewsItem,
  type ProviderDescriptor,
  type ProviderHealth,
  type Quote,
  type Reliability,
  type Sector,
  type SectorPerformance,
  type Security,
  type SourceType,
  type TermsStatus,
} from "@stock/core";
import { normalizeNepalDateTime, normalizeTradingDate } from "../util/dates";
import { optionalNumber, toBoolean, toNumber } from "../util/numbers";
import {
  formatIssues,
  validateCompanyRows,
  validateIndexRows,
  validateOhlcRows,
  validateQuoteRows,
  validateSectorRows,
  validateSummaryRows,
  type CsvIssue,
} from "./validate";

export interface CsvProviderConfig {
  dataDir: string;
  id?: string;
  name?: string;
  /** Set true only after the operator has confirmed the data is licensed. */
  attestLicensed?: boolean;
  environment?: Environment;
  priority?: number;
  /** Defaults to "manual". Personal research mode uses "unofficial". */
  sourceType?: SourceType;
  termsStatus?: TermsStatus;
  productionReady?: boolean;
  reliability?: Reliability;
  notes?: string;
  configRequired?: string[];
  /** Defaults to the full manual-data capability set. */
  capabilities?: Capability[];
}

const DEFAULT_CAPABILITIES: Capability[] = [
  "companyList",
  "securityList",
  "sectors",
  "indices",
  "dailyOhlc",
  "indexHistory",
  "liveQuotes",
  "marketSummary",
  "sectorPerformance",
  "floorsheet",
  "brokerFlows",
  "fundamentals",
  "fundamentalsHistory",
  "corporateActions",
  "ipos",
  "news",
];

type Row = Record<string, string>;

export class CsvProvider extends BaseProvider {
  readonly descriptor: ProviderDescriptor;
  private readonly dataDir: string;

  constructor(config: CsvProviderConfig) {
    super();
    this.dataDir = config.dataDir;
    const licensed = config.attestLicensed ?? false;
    const sourceType: SourceType = config.sourceType ?? "manual";
    const unofficial = sourceType === "unofficial";
    const termsStatus: TermsStatus =
      config.termsStatus ?? (licensed ? "verified" : "unverified");
    this.descriptor = {
      id: config.id ?? "manual-csv",
      name: config.name ?? "Manual CSV provider",
      sourceType,
      environment:
        config.environment ??
        ((process.env.NODE_ENV as Environment | undefined) ?? "development"),
      termsStatus,
      // Unofficial data can never be production-ready, regardless of config.
      productionReady: unofficial ? false : (config.productionReady ?? licensed),
      reliability: config.reliability ?? "medium",
      priority: config.priority ?? 50,
      capabilities: config.capabilities ?? DEFAULT_CAPABILITIES,
      notes:
        config.notes ??
        (licensed
          ? "Operator-attested licensed manual data."
          : "Manual data not yet attested as licensed."),
      configRequired: config.configRequired ?? [
        "MANUAL_DATA_DIR",
        "MANUAL_DATA_LICENSED",
      ],
    };
  }

  private path(...parts: string[]): string {
    return join(this.dataDir, ...parts);
  }

  private readRows(filePath: string, required = true): Row[] {
    if (!existsSync(filePath)) {
      if (!required) return [];
      throw new ProviderResponseError(
        this.descriptor.id,
        `missing file: ${filePath}`,
      );
    }
    try {
      const text = readFileSync(filePath, "utf8");
      return parse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      }) as Row[];
    } catch (error) {
      throw new ProviderResponseError(
        this.descriptor.id,
        `could not parse ${filePath}`,
        error,
      );
    }
  }

  private latestIso(rows: Array<{ timestamp?: string; date?: string }>): string | undefined {
    const values = rows
      .map((row) => row.timestamp ?? row.date)
      .filter((value): value is string => Boolean(value))
      .sort();
    return values.at(-1);
  }

  private assertValid(issues: CsvIssue[]): void {
    if (issues.length === 0) return;
    throw new DataValidationError(
      this.descriptor.id,
      `${issues.length} invalid row${issues.length === 1 ? "" : "s"}: ${formatIssues(issues)}`,
    );
  }

  private mapCandle(row: Row, symbol: string): Candle {
    return {
      symbol: (row.symbol ?? symbol).toUpperCase(),
      timeframe: (row.timeframe ?? "1day") as Candle["timeframe"],
      timestamp: normalizeNepalDateTime(row.timestamp ?? `${row.date} 15:00:00`),
      open: toNumber(row.open),
      high: toNumber(row.high),
      low: toNumber(row.low),
      close: toNumber(row.close),
      volume: toNumber(row.volume),
      ...(row.turnover ? { turnover: toNumber(row.turnover) } : {}),
      ...(row.trades ? { trades: toNumber(row.trades) } : {}),
      adjusted: toBoolean(row.adjusted, false),
      ...(row.adjustmentFactor
        ? { adjustmentFactor: toNumber(row.adjustmentFactor) }
        : {}),
    };
  }

  private aggregateBrokerFlows(
    date: string,
    trades: FloorsheetTrade[],
  ): BrokerFlow[] {
    const flows = new Map<string, BrokerFlow>();
    const get = (brokerId: string): BrokerFlow => {
      const existing = flows.get(brokerId);
      if (existing) return existing;
      const created: BrokerFlow = {
        brokerId,
        businessDate: date,
        buyQuantity: 0,
        buyAmount: 0,
        sellQuantity: 0,
        sellAmount: 0,
        netQuantity: 0,
        netAmount: 0,
      };
      flows.set(brokerId, created);
      return created;
    };
    for (const trade of trades) {
      const buyer = get(trade.buyerBroker);
      buyer.buyQuantity += trade.quantity;
      buyer.buyAmount += trade.amount;
      const seller = get(trade.sellerBroker);
      seller.sellQuantity += trade.quantity;
      seller.sellAmount += trade.amount;
    }
    for (const flow of flows.values()) {
      flow.netQuantity = flow.buyQuantity - flow.sellQuantity;
      flow.netAmount = flow.buyAmount - flow.sellAmount;
    }
    return [...flows.values()];
  }

  override async getCompanyList(): Promise<DataEnvelope<Company[]>> {
    const rows = this.readRows(this.path("companies.csv"));
    this.assertValid(validateCompanyRows(rows));
    const companies: Company[] = rows.map((row) => ({
      id: row.id!,
      symbol: row.symbol!.toUpperCase(),
      name: row.name!,
      sector: row.sector!,
      instrumentType: row.instrumentType || "Equity",
      status: (row.status || "unknown") as Company["status"],
      ...(row.email ? { email: row.email } : {}),
      ...(row.website ? { website: row.website } : {}),
      ...(row.regulatoryBody ? { regulatoryBody: row.regulatoryBody } : {}),
      ...(row.listedAt
        ? { listedAt: normalizeTradingDate(row.listedAt) }
        : {}),
      ...(row.marketCap ? { marketCap: toNumber(row.marketCap) } : {}),
    }));
    return this.envelope(companies);
  }

  override async getSecurityList(): Promise<DataEnvelope<Security[]>> {
    const rows = this.readRows(this.path("securities.csv"), false);
    if (rows.length > 0) {
      return this.envelope(
        rows.map((row) => ({
          id: row.id!,
          symbol: row.symbol!.toUpperCase(),
          name: row.name!,
          ...(row.companyId ? { companyId: row.companyId } : {}),
          instrumentType: row.instrumentType || "Equity",
          isPromoter: toBoolean(row.isPromoter, false),
          status: (row.status || "unknown") as Security["status"],
        })),
      );
    }
    const companies = (await this.getCompanyList()).data;
    return this.envelope(
      companies.map((company) => ({
        id: company.id,
        symbol: company.symbol,
        name: company.name,
        companyId: company.id,
        instrumentType: company.instrumentType,
        isPromoter: false,
        status: company.status,
      })),
      undefined,
      ["securities.csv missing; security list derived from companies.csv"],
      "DERIVED",
    );
  }

  override async getSectors(): Promise<DataEnvelope<Sector[]>> {
    const companies = (await this.getCompanyList()).data;
    const counts = new Map<string, number>();
    for (const company of companies) {
      counts.set(company.sector, (counts.get(company.sector) ?? 0) + 1);
    }
    return this.envelope(
      [...counts.entries()].map(([name, companyCount]) => ({
        name,
        companyCount,
      })),
      undefined,
      ["sectors.csv missing; sector list derived from companies.csv"],
      "DERIVED",
    );
  }

  override async getIndices(): Promise<DataEnvelope<MarketIndex[]>> {
    const rows = this.readRows(this.path("indices.csv"), false);
    if (rows.length > 0) {
      this.assertValid(validateIndexRows(rows));
      return this.envelope(
        rows.map((row) => ({
          symbol: row.symbol!.toUpperCase(),
          name: row.name!,
          isSector: toBoolean(row.isSector, false),
        })),
      );
    }
    const sectors = (await this.getSectors()).data;
    return this.envelope(
      [
        { symbol: "NEPSE", name: "NEPSE Index", isSector: false },
        ...sectors.map((sector) => ({
          symbol: sector.name.toUpperCase().replaceAll(" ", "_"),
          name: sector.name,
          isSector: true,
        })),
      ],
      undefined,
      ["indices.csv missing; index list derived from company sectors"],
      "DERIVED",
    );
  }

  override async getDailyOhlc(
    symbol: string,
    range: DateRange,
  ): Promise<DataEnvelope<Candle[]>> {
    const rows = this.readRows(
      this.path("ohlc", `${symbol.toUpperCase()}.csv`),
    );
    this.assertValid(
      validateOhlcRows(rows, `ohlc/${symbol.toUpperCase()}.csv`),
    );
    const candles = rows
      .map((row) => this.mapCandle(row, symbol))
      .filter((candle) => {
        const date = candle.timestamp.slice(0, 10);
        return date >= range.from && date <= range.to;
      })
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return this.envelope(candles, candles.at(-1)?.timestamp, [
      "manual CSV data: verify corporate-action adjustment before using indicators",
    ]);
  }

  override async getIndexHistory(
    index: string,
    range: DateRange,
  ): Promise<DataEnvelope<Candle[]>> {
    const rows = this.readRows(
      this.path("indices", `${index.toUpperCase()}.csv`),
    );
    this.assertValid(
      validateOhlcRows(rows, `indices/${index.toUpperCase()}.csv`),
    );
    const candles = rows
      .map((row) => this.mapCandle(row, index))
      .filter((candle) => {
        const date = candle.timestamp.slice(0, 10);
        return date >= range.from && date <= range.to;
      })
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return this.envelope(candles, candles.at(-1)?.timestamp);
  }

  override async getLiveQuotes(): Promise<DataEnvelope<Quote[]>> {
    const rows = this.readRows(this.path("quotes.csv"), false);
    this.assertValid(validateQuoteRows(rows));
    const quotes: Quote[] = rows.map((row) => ({
      symbol: row.symbol!.toUpperCase(),
      ltp: toNumber(row.ltp),
      change: toNumber(row.change),
      changePercent: toNumber(row.changePercent),
      open: toNumber(row.open),
      high: toNumber(row.high),
      low: toNumber(row.low),
      previousClose: toNumber(row.previousClose),
      volume: toNumber(row.volume),
      turnover: toNumber(row.turnover),
      ...(row.trades ? { trades: toNumber(row.trades) } : {}),
      ...(row.session === "live" || row.session === "eod"
        ? { session: row.session }
        : {}),
      asOf: normalizeNepalDateTime(row.asOf!),
    }));
    return this.envelope(quotes, quotes[0]?.asOf);
  }

  override async getMarketSummary(): Promise<DataEnvelope<MarketSummary>> {
    const rows = this.readRows(this.path("market-summary.csv"), false);
    if (rows.length === 0) {
      throw new ProviderResponseError(
        this.descriptor.id,
        "market-summary.csv is missing or empty; market summary is unavailable (no derived index values are produced)",
      );
    }
    this.assertValid(validateSummaryRows(rows));
    const row = rows[0]!;
    if (!row.asOf) {
      throw new ProviderResponseError(
        this.descriptor.id,
        "market-summary.csv has no asOf timestamp; refusing to present the summary as current",
      );
    }
    const summary: MarketSummary = {
      indexName: row.indexName || "NEPSE",
      indexValue: toNumber(row.indexValue),
      change: toNumber(row.change),
      changePercent: toNumber(row.changePercent),
      turnover: toNumber(row.turnover),
      sharesTraded: toNumber(row.sharesTraded),
      transactions: toNumber(row.transactions),
      scripsTraded: toNumber(row.scripsTraded),
      asOf: normalizeNepalDateTime(row.asOf),
    };
    return this.envelope(summary, summary.asOf);
  }

  override async getSectorPerformance(): Promise<DataEnvelope<SectorPerformance[]>> {
    const rows = this.readRows(this.path("sector-performance.csv"), false);
    this.assertValid(validateSectorRows(rows));
    return this.envelope(
      rows.map((row) => ({
        sector: row.sector!,
        ...(row.indexValue ? { indexValue: toNumber(row.indexValue) } : {}),
        ...(row.changePercent
          ? { changePercent: toNumber(row.changePercent) }
          : {}),
        ...(row.turnover ? { turnover: toNumber(row.turnover) } : {}),
        ...(row.volume ? { volume: toNumber(row.volume) } : {}),
        ...(row.companies ? { companies: toNumber(row.companies) } : {}),
      })),
    );
  }

  override async getFloorsheet(
    date: string,
  ): Promise<DataEnvelope<FloorsheetTrade[]>> {
    const rows = this.readRows(
      this.path("floorsheet", `${normalizeTradingDate(date)}.csv`),
    );
    const trades: FloorsheetTrade[] = rows.map((row) => ({
      contractId: row.contractId!,
      businessDate: normalizeTradingDate(row.businessDate || date),
      symbol: row.symbol!.toUpperCase(),
      buyerBroker: row.buyerBroker!,
      sellerBroker: row.sellerBroker!,
      quantity: toNumber(row.quantity),
      rate: toNumber(row.rate),
      amount: toNumber(row.amount),
      ...(row.asOf ? { asOf: normalizeNepalDateTime(row.asOf) } : {}),
    }));
    return this.envelope(trades, trades[0]?.asOf);
  }

  override async getBrokerFlows(
    date: string,
  ): Promise<DataEnvelope<BrokerFlow[]>> {
    const trades = (await this.getFloorsheet(date)).data;
    return this.envelope(this.aggregateBrokerFlows(date, trades));
  }

  private buildFundamentalsSnapshots(
    symbol: string,
    rows: Row[],
  ): FundamentalsSnapshot[] {
    if (rows.length === 0) {
      throw new ProviderResponseError(
        this.descriptor.id,
        `no fundamentals for ${symbol}`,
      );
    }

    const periods = new Map<string, Row[]>();
    for (const row of rows) {
      const period = row.period || row.fiscalYear || "unknown";
      const group = periods.get(period) ?? [];
      group.push(row);
      periods.set(period, group);
    }

    return [...periods.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, periodRows]) => {
        const metrics: Record<string, MetricValue> = {};
        for (const row of periodRows) {
          metrics[row.metric!] = {
            metric: row.metric!,
            value: optionalNumber(row.value) ?? null,
            unit: (row.unit || "unknown") as MetricValue["unit"],
            ...(row.currency ? { currency: row.currency } : {}),
            ...(row.fiscalYear ? { fiscalYear: row.fiscalYear } : {}),
            ...(row.quarter ? { quarter: toNumber(row.quarter) } : {}),
            ...(row.reportedAt
              ? { reportedAt: normalizeTradingDate(row.reportedAt) }
              : {}),
            ...(row.source ? { source: row.source } : {}),
            confidence: (row.confidence ||
              "unverified") as MetricValue["confidence"],
            ...(row.notes ? { notes: row.notes } : {}),
          };
        }

        return {
          symbol: symbol.toUpperCase(),
          asOf: new Date().toISOString(),
          period,
          ...(periodRows[0]?.fiscalYear
            ? { fiscalYear: periodRows[0].fiscalYear }
            : {}),
          ...(periodRows[0]?.quarter
            ? { quarter: toNumber(periodRows[0].quarter) }
            : {}),
          metrics,
          ...(periodRows[0]?.reportedAt
            ? {
                reportedAt: normalizeTradingDate(
                  periodRows[0].reportedAt,
                ),
              }
            : {}),
        } satisfies FundamentalsSnapshot;
      });
  }

  override async getFundamentals(
    symbol: string,
  ): Promise<DataEnvelope<FundamentalsSnapshot>> {
    const rows = this.readRows(
      this.path("fundamentals", `${symbol.toUpperCase()}.csv`),
    );
    const snapshots = this.buildFundamentalsSnapshots(symbol, rows);
    const latest = snapshots.at(-1)!;
    return this.envelope(latest, latest.asOf);
  }

  override async getFundamentalsHistory(
    symbol: string,
  ): Promise<DataEnvelope<FundamentalsSnapshot[]>> {
    const rows = this.readRows(
      this.path("fundamentals", `${symbol.toUpperCase()}.csv`),
    );
    const snapshots = this.buildFundamentalsSnapshots(symbol, rows);
    return this.envelope(snapshots, snapshots.at(-1)?.asOf);
  }

  override async getCorporateActions(
    symbol: string,
  ): Promise<DataEnvelope<CorporateAction[]>> {
    const rows = this.readRows(this.path("corporate-actions.csv"), false);
    const actions: CorporateAction[] = rows
      .filter((row) => row.symbol!.toUpperCase() === symbol.toUpperCase())
      .map((row) => ({
        symbol: row.symbol!.toUpperCase(),
        type: row.type as CorporateAction["type"],
        ...(row.ratio ? { ratio: row.ratio } : {}),
        ...(row.value ? { value: toNumber(row.value) } : {}),
        ...(row.currency ? { currency: row.currency } : {}),
        ...(row.announcedAt
          ? { announcedAt: normalizeTradingDate(row.announcedAt) }
          : {}),
        ...(row.exDate ? { exDate: normalizeTradingDate(row.exDate) } : {}),
        ...(row.recordDate
          ? { recordDate: normalizeTradingDate(row.recordDate) }
          : {}),
        ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
        ...(row.notes ? { notes: row.notes } : {}),
      }));
    return this.envelope(actions);
  }

  override async getIpos(): Promise<DataEnvelope<Ipo[]>> {
    const rows = this.readRows(this.path("ipos.csv"), false);
    return this.envelope(
      rows.map((row) => ({
        id: row.id!,
        companyName: row.companyName!,
        ...(row.symbol ? { symbol: row.symbol.toUpperCase() } : {}),
        type: row.type as Ipo["type"],
        ...(row.openDate
          ? { openDate: normalizeTradingDate(row.openDate) }
          : {}),
        ...(row.closeDate
          ? { closeDate: normalizeTradingDate(row.closeDate) }
          : {}),
        ...(row.price ? { price: toNumber(row.price) } : {}),
        ...(row.units ? { units: toNumber(row.units) } : {}),
        status: (row.status || "unknown") as Ipo["status"],
        ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
        ...(row.notes ? { notes: row.notes } : {}),
      })),
    );
  }

  override async getNews(): Promise<DataEnvelope<NewsItem[]>> {
    const rows = this.readRows(this.path("news.csv"), false);
    return this.envelope(
      rows.map((row) => ({
        id: row.id!,
        title: row.title!,
        url: row.url!,
        publishedAt: normalizeNepalDateTime(row.publishedAt!),
        source: row.source!,
        symbols: (row.symbols ?? "")
          .split(/[;,]/)
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean),
        ...(row.summary ? { summary: row.summary } : {}),
      })),
    );
  }

  async healthCheck(): Promise<ProviderHealth> {
    const exists = existsSync(this.dataDir);
    return {
      providerId: this.descriptor.id,
      status: exists ? "ok" : "down",
      checkedAt: new Date().toISOString(),
      consecutiveFailures: 0,
      ...(exists ? {} : { message: `data directory missing: ${this.dataDir}` }),
    };
  }
}

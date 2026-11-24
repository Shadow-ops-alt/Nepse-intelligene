import {
  AggregateProviderError,
  DataValidationError,
  MarketDataService,
  ProviderRegistry,
  type BrokerFlow,
  type Candle,
  type Company,
  type CorporateAction,
  type DataEnvelope,
  type FloorsheetTrade,
  type FundamentalsSnapshot,
  type Ipo,
  type MarketDataProvider,
  type MarketIndex,
  type MarketSummary,
  type NewsItem,
  type Quote,
  type RuntimePolicy,
  type SectorPerformance,
} from "@stock/core";
import type { PersonalStore } from "@stock/store";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { floorsheetDates, fundamentalSymbols } from "./web/bulk";

export interface SyncOptions {
  provider: MarketDataProvider;
  policy: RuntimePolicy;
  store: PersonalStore;
  from: string;
  to: string;
  symbols?: string[];
  indexSymbol?: string;
  /** Data directory, used to discover floorsheet/fundamentals files. */
  dataDir?: string;
  /** Validate and count without writing anything (import preview). */
  dryRun?: boolean;
  /** Relative file names that were present, for the import audit. */
  files?: string[];
  onProgress?: (message: string) => void;
}

export interface SyncResult {
  providerId: string;
  status: "ok" | "partial" | "failed" | "dry-run";
  companies: number;
  equitySeries: number;
  candleRows: number;
  quotes: number;
  snapshots: number;
  fundamentals: number;
  corporateActions: number;
  ipos: number;
  news: number;
  floorsheetTrades: number;
  brokerFlows: number;
  written: boolean;
  failedSymbols: string[];
  warnings: string[];
  gaps: string[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A fresh corporate-actions import carries the raw public rows, which do not
 * have ex-dates. An enrichment pass may already have written a derived
 * `exDate`/`dateBasis` and extra bonus/right rows. Merge the import into the
 * stored snapshot instead of overwriting it, keeping those derived fields and
 * any enriched rows the source does not carry.
 */
function corporateActionMergeKey(action: Record<string, unknown>): string {
  const symbol = String(action.symbol ?? "").toUpperCase();
  const type = String(action.type ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const notes = String(action.notes ?? "");
  const year = String(
    action.fiscalYear ?? notes.match(/FY\s*(\d{3}\s*[-/]\s*\d{3})/i)?.[1] ?? "",
  ).replace(/\s+/g, "");
  const numeric = Number(action.value ?? action.percent ?? action.ratio);
  return `${symbol}|${type}|${year}|${Number.isFinite(numeric) ? numeric : ""}`;
}

export function mergeCorporateActions<T extends object>(
  existing: readonly unknown[] | undefined,
  incoming: readonly T[],
): T[] {
  if (!Array.isArray(existing) || existing.length === 0) return [...incoming];
  const previousByKey = new Map<string, Record<string, unknown>>();
  for (const entry of existing) {
    if (entry && typeof entry === "object") {
      previousByKey.set(
        corporateActionMergeKey(entry as Record<string, unknown>),
        entry as Record<string, unknown>,
      );
    }
  }
  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];
  for (const entry of incoming) {
    if (!entry || typeof entry !== "object") continue;
    const next = entry as Record<string, unknown>;
    const key = corporateActionMergeKey(next);
    const previous = previousByKey.get(key);
    seen.add(key);
    if (!previous) {
      merged.push({ ...next });
      continue;
    }
    const combined: Record<string, unknown> = { ...previous, ...next };
    for (const field of [
      "exDate",
      "dateBasis",
      "bookClosureDate",
      "dividendPerShare",
      "paidUpValue",
      "matchSource",
      "matchSourceUrl",
    ]) {
      if (next[field] === undefined && previous[field] !== undefined) {
        combined[field] = previous[field];
      }
    }
    if (
      typeof previous.notes === "string" &&
      previous.notes.includes("ex-date derived") &&
      !String(next.notes ?? "").includes("ex-date derived")
    ) {
      combined.notes = previous.notes;
    }
    merged.push(combined);
  }
  for (const [key, previous] of previousByKey) {
    if (!seen.has(key)) merged.push(previous);
  }
  return merged as unknown as T[];
}

function rethrowIfFatal(error: unknown): void {
  if (error instanceof DataValidationError) throw error;
  if (
    error instanceof AggregateProviderError &&
    error.errors.some((inner) => inner instanceof DataValidationError)
  ) {
    throw error;
  }
}

/** NEPSE moved from Sunday–Thursday to Monday–Friday on 2026-04-10. */
const WEEKDAY_CALENDAR_SWITCH = "2026-04-10";
const MAX_GAP_MESSAGES_PER_SYMBOL = 3;
const MAX_GAP_MESSAGES = 200;

function isExpectedTradingWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  const iso = date.toISOString().slice(0, 10);
  return iso >= WEEKDAY_CALENDAR_SWITCH
    ? day >= 1 && day <= 5
    : day >= 0 && day <= 4;
}

function missingTradingDays(previous: string, next: string): number {
  const start = new Date(`${previous}T00:00:00Z`);
  const end = new Date(`${next}T00:00:00Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    return 0;
  }
  let missing = 0;
  for (
    let cursor = new Date(start.getTime() + 86_400_000);
    cursor < end;
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    // Public holidays are not known here, so a gap is reported as a possible
    // gap, never filled.
    if (isExpectedTradingWeekday(cursor)) missing += 1;
  }
  return missing;
}

function detectGaps(
  symbol: string,
  candles: Candle[],
): { messages: string[]; total: number } {
  const dates = [
    ...new Set(
      candles
        .map((candle) => candle.timestamp.slice(0, 10))
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
    ),
  ].sort();
  const messages: string[] = [];
  let total = 0;
  for (let index = 1; index < dates.length; index += 1) {
    const missing = missingTradingDays(dates[index - 1]!, dates[index]!);
    if (missing > 0) {
      total += 1;
      if (messages.length < MAX_GAP_MESSAGES_PER_SYMBOL) {
        messages.push(
          `${symbol}: ${missing} possible missing trading day${missing === 1 ? "" : "s"} between ${dates[index - 1]} and ${dates[index]} (holidays unknown; no rows were filled)`,
        );
      }
    }
  }
  return { messages, total };
}

/**
 * Pull the free-source provider into the local store, one provider namespace
 * at a time.
 *
 * All provider reads and validation happen first. Writes then run inside a
 * single SQLite transaction, so a fatal error cannot leave a half-imported
 * dataset behind. Per-symbol failures are isolated and reported.
 */
export async function syncPersonalData(
  options: SyncOptions,
): Promise<SyncResult> {
  const { provider, policy, store } = options;
  const providerId = provider.descriptor.id;
  const registry = new ProviderRegistry();
  registry.register(provider);
  const service = new MarketDataService(registry, { policy });
  const dryRun = options.dryRun === true;

  const startedAt = new Date().toISOString();
  const runId = dryRun ? null : store.beginSync(providerId);
  const warnings: string[] = [];
  const failedSymbols: string[] = [];
  const gaps: string[] = [];
  let gapTotal = 0;

  const recordGaps = (symbol: string, candles: Candle[]): void => {
    const detected = detectGaps(symbol, candles);
    gapTotal += detected.total;
    for (const entry of detected.messages) {
      if (gaps.length < MAX_GAP_MESSAGES) gaps.push(entry);
    }
  };

  let companies = 0;
  let equitySeries = 0;
  let candleRows = 0;
  let quoteRows = 0;
  let snapshotRows = 0;
  let fundamentals = 0;
  let corporateActions = 0;
  let ipos = 0;
  let news = 0;
  let floorsheetTrades = 0;
  let brokerFlows = 0;

  try {
    let symbols = (options.symbols ?? []).map((symbol) =>
      symbol.trim().toUpperCase(),
    );
    let companyEnvelope: DataEnvelope<Company[]> | null = null;
    let indexEnvelope: DataEnvelope<MarketIndex[]> | null = null;
    let quotesEnvelope: DataEnvelope<Quote[]> | null = null;
    let summaryEnvelope: DataEnvelope<MarketSummary> | null = null;
    let sectorEnvelope: DataEnvelope<SectorPerformance[]> | null = null;
    const fundamentalEnvelopes: Array<{
      symbol: string;
      latest: DataEnvelope<FundamentalsSnapshot>;
      history: DataEnvelope<FundamentalsSnapshot[]>;
    }> = [];
    const corporateActionEnvelopes: Array<{
      symbol: string;
      envelope: DataEnvelope<CorporateAction[]>;
    }> = [];
    let iposEnvelope: DataEnvelope<Ipo[]> | null = null;
    let newsEnvelope: DataEnvelope<NewsItem[]> | null = null;
    const floorsheetEnvelopes: Array<{
      date: string;
      envelope: DataEnvelope<FloorsheetTrade[]>;
    }> = [];
    const brokerFlowEnvelopes: Array<{
      date: string;
      envelope: DataEnvelope<BrokerFlow[]>;
    }> = [];
    const equityEnvelopes: Array<{
      symbol: string;
      envelope: DataEnvelope<Candle[]>;
    }> = [];
    const indexCandles: Array<DataEnvelope<Candle[]>> = [];

    try {
      const envelope = await service.getCompanyList();
      companyEnvelope = envelope;
      companies = envelope.data.length;
      if (symbols.length === 0) {
        symbols = envelope.data.map((company) => company.symbol);
      }
      options.onProgress?.(`companies: ${companies}`);
    } catch (error) {
      rethrowIfFatal(error);
      if (symbols.length === 0) throw error;
      warnings.push(`company list unavailable: ${message(error)}`);
    }

    try {
      indexEnvelope = await service.getIndices();
    } catch (error) {
      rethrowIfFatal(error);
      warnings.push(`index list unavailable: ${message(error)}`);
    }

    for (const symbol of symbols) {
      try {
        const envelope = await service.getDailyOhlc(symbol, {
          from: options.from,
          to: options.to,
        });
        equityEnvelopes.push({ symbol, envelope });
        candleRows += envelope.data.length;
        equitySeries += 1;
        recordGaps(symbol, envelope.data);
        options.onProgress?.(`equity ${symbol}: ${envelope.data.length} candles`);
      } catch (error) {
        rethrowIfFatal(error);
        failedSymbols.push(symbol);
        options.onProgress?.(`equity ${symbol}: skipped (${message(error)})`);
      }
    }

    // The main index first, then every other listed index (sector
    // sub-indices) unless the caller asked for one specific index. A missing
    // sub-index file is skipped quietly; only the main index warns.
    const indexSymbol = (options.indexSymbol ?? "NEPSE").toUpperCase();
    const indexSymbols = [indexSymbol];
    if (!options.indexSymbol && indexEnvelope) {
      for (const index of indexEnvelope.data) {
        const symbol = index.symbol.toUpperCase();
        if (!indexSymbols.includes(symbol)) indexSymbols.push(symbol);
      }
    }
    for (const symbol of indexSymbols) {
      try {
        const envelope = await service.getIndexHistory(symbol, {
          from: options.from,
          to: options.to,
        });
        if (envelope.data.length === 0) continue;
        indexCandles.push(envelope);
        candleRows += envelope.data.length;
        if (symbol === indexSymbol) recordGaps(symbol, envelope.data);
        options.onProgress?.(`index ${symbol}: ${envelope.data.length} candles`);
      } catch (error) {
        rethrowIfFatal(error);
        if (symbol === indexSymbol) {
          warnings.push(`index history ${symbol} unavailable: ${message(error)}`);
        }
      }
    }

    try {
      const envelope = await service.getLiveQuotes();
      quotesEnvelope = envelope;
      quoteRows = envelope.data.length;
      options.onProgress?.(`quotes: ${quoteRows}`);
    } catch (error) {
      rethrowIfFatal(error);
      warnings.push(`quotes unavailable: ${message(error)}`);
    }

    try {
      const envelope = await service.getMarketSummary();
      summaryEnvelope = envelope;
      options.onProgress?.("market summary: available");
    } catch (error) {
      rethrowIfFatal(error);
      warnings.push(`market summary unavailable: ${message(error)}`);
    }

    try {
      sectorEnvelope = await service.getSectorPerformance();
    } catch (error) {
      rethrowIfFatal(error);
      warnings.push(`sector performance unavailable: ${message(error)}`);
    }

    // Fundamentals, corporate actions, IPOs, news, floorsheet and the broker
    // aggregates derived from it. All are optional; a missing file is skipped.
    if (options.dataDir) {
      for (const symbol of fundamentalSymbols(options.dataDir)) {
        try {
          const [latest, history] = await Promise.all([
            service.getFundamentals(symbol),
            service.getFundamentalsHistory(symbol),
          ]);
          fundamentalEnvelopes.push({ symbol, latest, history });
          fundamentals += 1;
        } catch (error) {
          if (error instanceof DataValidationError) throw error;
          warnings.push(`fundamentals ${symbol} skipped: ${message(error)}`);
        }
      }
      if (existsSync(join(options.dataDir, "corporate-actions.csv"))) {
        for (const symbol of symbols) {
          try {
            const envelope = await service.getCorporateActions(symbol);
            if (envelope.data.length > 0) {
              corporateActionEnvelopes.push({ symbol, envelope });
              corporateActions += envelope.data.length;
            }
          } catch (error) {
            if (error instanceof DataValidationError) throw error;
          }
        }
      }
      for (const date of floorsheetDates(options.dataDir)) {
        try {
          const envelope = await service.getFloorsheet(date);
          floorsheetEnvelopes.push({ date, envelope });
          floorsheetTrades += envelope.data.length;
        } catch (error) {
          if (error instanceof DataValidationError) throw error;
          warnings.push(`floorsheet ${date} skipped: ${message(error)}`);
        }
        try {
          const flows = await service.getBrokerFlows(date);
          brokerFlowEnvelopes.push({ date, envelope: flows });
          brokerFlows += flows.data.length;
        } catch (error) {
          if (error instanceof DataValidationError) throw error;
        }
      }
    }

    try {
      iposEnvelope = await service.getIpos();
      ipos = iposEnvelope.data.length;
    } catch (error) {
      rethrowIfFatal(error);
      warnings.push(`IPO pipeline unavailable: ${message(error)}`);
    }

    try {
      newsEnvelope = await service.getNews();
      news = newsEnvelope.data.length;
    } catch (error) {
      rethrowIfFatal(error);
      warnings.push(`news unavailable: ${message(error)}`);
    }

    if (gapTotal > 0) {
      warnings.push(
        `${gapTotal} possible trading-day gap${gapTotal === 1 ? "" : "s"} detected; ${gaps.length} message${gaps.length === 1 ? "" : "s"} retained (holidays unknown; nothing was filled)`,
      );
    }

    const status: SyncResult["status"] = dryRun
      ? "dry-run"
      : failedSymbols.length === 0
        ? "ok"
        : "partial";

    if (!dryRun) {
      store.runInTransaction(() => {
        if (companyEnvelope) {
          store.upsertCompanies(companyEnvelope);
        }
        if (indexEnvelope) {
          store.upsertSnapshot("indices", "all", indexEnvelope);
        }
        for (const entry of equityEnvelopes) {
          store.upsertCandles(entry.envelope, "equity");
        }
        for (const envelope of indexCandles) {
          store.upsertCandles(envelope, "index");
        }
        if (quotesEnvelope) {
          store.upsertQuotes(quotesEnvelope);
        }
        if (summaryEnvelope) {
          store.upsertSnapshot("marketSummary", "latest", summaryEnvelope);
          snapshotRows += 1;
        }
        if (sectorEnvelope && sectorEnvelope.data.length > 0) {
          store.upsertSnapshot("sectorPerformance", "latest", sectorEnvelope);
          snapshotRows += 1;
        }
        for (const entry of fundamentalEnvelopes) {
          store.upsertSnapshot("fundamentals", entry.symbol, entry.latest);
          store.upsertSnapshot("fundamentalsHistory", entry.symbol, entry.history);
          snapshotRows += 2;
        }
        for (const entry of corporateActionEnvelopes) {
          const stored = store.getSnapshotWithProvenance<unknown[]>(
            providerId,
            "corporateActions",
            entry.symbol,
          );
          store.upsertSnapshot("corporateActions", entry.symbol, {
            ...entry.envelope,
            data: mergeCorporateActions(stored?.data, entry.envelope.data),
          });
          snapshotRows += 1;
        }
        if (iposEnvelope && iposEnvelope.data.length > 0) {
          store.upsertSnapshot("ipos", "all", iposEnvelope);
          snapshotRows += 1;
        }
        if (newsEnvelope && newsEnvelope.data.length > 0) {
          store.upsertSnapshot("news", "latest", newsEnvelope);
          snapshotRows += 1;
        }
        for (const entry of floorsheetEnvelopes) {
          store.upsertSnapshot("floorsheet", entry.date, entry.envelope);
          snapshotRows += 1;
        }
        for (const entry of brokerFlowEnvelopes) {
          store.upsertSnapshot("brokerFlows", entry.date, entry.envelope);
          snapshotRows += 1;
        }
      });

      store.finishSync(
        runId!,
        failedSymbols.length === 0 ? "ok" : "partial",
        failedSymbols.length > 0
          ? `skipped: ${failedSymbols.join(", ")}`
          : undefined,
      );
    }

    const finishedAt = new Date().toISOString();
    if (!dryRun) {
      store.recordImportAudit({
        syncRunId: runId,
        providerId,
        startedAt,
        finishedAt,
        status,
        files: options.files ?? [],
        counts: {
          companies,
          equitySeries,
          candleRows,
          quotes: quoteRows,
          snapshots: snapshotRows,
          fundamentals,
          corporateActions,
          ipos,
          news,
          floorsheetTrades,
          brokerFlows,
          failedSymbols: failedSymbols.length,
          gaps: gapTotal,
        },
        warnings,
        failedSymbols,
      });
    }

    return {
      providerId,
      status,
      companies,
      equitySeries,
      candleRows,
      quotes: quoteRows,
      snapshots: snapshotRows,
      fundamentals,
      corporateActions,
      ipos,
      news,
      floorsheetTrades,
      brokerFlows,
      written: !dryRun,
      failedSymbols,
      warnings,
      gaps,
    };
  } catch (error) {
    if (runId !== null) {
      store.finishSync(runId, "failed", message(error));
      try {
        store.recordImportAudit({
          syncRunId: runId,
          providerId,
          startedAt,
          finishedAt: new Date().toISOString(),
          status: "failed",
          files: options.files ?? [],
          counts: {
            companies: 0,
            equitySeries: 0,
            candleRows: 0,
            quotes: 0,
            snapshots: 0,
          },
          warnings,
          failedSymbols,
        });
      } catch {
        // Preserve the original failure if the audit write also fails.
      }
    }
    throw error;
  }
}

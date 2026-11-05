import {
  AggregateProviderError,
  DataValidationError,
  MarketDataService,
  ProviderRegistry,
  type Candle,
  type Company,
  type DataEnvelope,
  type MarketDataProvider,
  type MarketIndex,
  type MarketSummary,
  type Quote,
  type RuntimePolicy,
  type SectorPerformance,
} from "@stock/core";
import type { PersonalStore } from "@stock/store";

export interface SyncOptions {
  provider: MarketDataProvider;
  policy: RuntimePolicy;
  store: PersonalStore;
  from: string;
  to: string;
  symbols?: string[];
  indexSymbol?: string;
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
  written: boolean;
  failedSymbols: string[];
  warnings: string[];
  gaps: string[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  try {
    let symbols = (options.symbols ?? []).map((symbol) =>
      symbol.trim().toUpperCase(),
    );
    let companyEnvelope: DataEnvelope<Company[]> | null = null;
    let indexEnvelope: DataEnvelope<MarketIndex[]> | null = null;
    let quotesEnvelope: DataEnvelope<Quote[]> | null = null;
    let summaryEnvelope: DataEnvelope<MarketSummary> | null = null;
    let sectorEnvelope: DataEnvelope<SectorPerformance[]> | null = null;
    const equityEnvelopes: Array<{
      symbol: string;
      envelope: DataEnvelope<Candle[]>;
    }> = [];
    let indexCandles: DataEnvelope<Candle[]> | null = null;

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

    const indexSymbol = (options.indexSymbol ?? "NEPSE").toUpperCase();
    try {
      const envelope = await service.getIndexHistory(indexSymbol, {
        from: options.from,
        to: options.to,
      });
      indexCandles = envelope;
      candleRows += envelope.data.length;
      recordGaps(indexSymbol, envelope.data);
      options.onProgress?.(`index ${indexSymbol}: ${envelope.data.length} candles`);
    } catch (error) {
      rethrowIfFatal(error);
      warnings.push(`index history ${indexSymbol} unavailable: ${message(error)}`);
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
        if (indexCandles) {
          store.upsertCandles(indexCandles, "index");
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

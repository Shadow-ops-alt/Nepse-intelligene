import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import {
  CompanySchema,
  DataQualityError,
  classificationForSourceType,
  type Candle,
  type Company,
  type DataClassification,
  type DataEnvelope,
  type DataMeta,
  type Quote,
} from "@stock/core";

export type SeriesKind = "equity" | "index";

export interface CandleQuery {
  providerId: string;
  kind: SeriesKind;
  symbol: string;
  timeframe?: string;
  from?: string;
  to?: string;
}

export interface IntradayQuery {
  providerId: string;
  kind: SeriesKind;
  symbol: string;
  timeframe?: string;
  session?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface StoredIntradayCandle extends Candle {
  /** Nepal-Time session date, `YYYY-MM-DD`. */
  sessionDate: string;
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

export interface NewPortfolioTransaction {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fees?: number;
  tradedAt: string;
  notes?: string | null;
  /** `csv`, `manual`, a broker name, ... Null for older/manual rows. */
  source?: string | null;
  /** Stable key from the source; reconciliation imports are idempotent on it. */
  externalId?: string | null;
  /** `trade` for ordinary transactions, or a reconciliation label. */
  kind?: string;
}

/** A transaction row including the reconciliation metadata. */
export interface ReconciliationTransaction extends PortfolioTransaction {
  source: string | null;
  externalId: string | null;
  kind: string;
}

export interface TradePlan {
  id: number;
  symbol: string;
  side: "buy" | "sell";
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

export interface TradePlanInput {
  symbol: string;
  side: "buy" | "sell";
  entry: number;
  stop: number;
  targets: number[];
  quantity: number;
  riskAmount?: number | null;
  riskPercent?: number | null;
  rewardRisk?: number | null;
  fees?: number | null;
  notes?: string | null;
}

export type TradePlanPatch = Partial<TradePlanInput>;

export interface JournalEntry {
  id: number;
  planId: number | null;
  symbol: string;
  side: "buy" | "sell";
  paper: boolean;
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget: number | null;
  actualEntry: number | null;
  actualExit: number | null;
  quantity: number | null;
  fees: number;
  pnl: number | null;
  reason: string | null;
  mistakes: string | null;
  tags: string[];
  snapshot: unknown;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JournalInput {
  planId?: number | null;
  symbol: string;
  side: "buy" | "sell";
  paper?: boolean;
  plannedEntry?: number | null;
  plannedStop?: number | null;
  plannedTarget?: number | null;
  actualEntry?: number | null;
  actualExit?: number | null;
  quantity?: number | null;
  fees?: number | null;
  pnl?: number | null;
  reason?: string | null;
  mistakes?: string | null;
  tags?: string[];
  snapshot?: unknown;
  openedAt?: string | null;
  closedAt?: string | null;
}

export type JournalPatch = Partial<JournalInput>;

export type CorporateLedgerKind = "dividend" | "bonus" | "right" | "other";

export interface CorporateLedgerEntry {
  id: number;
  symbol: string;
  kind: CorporateLedgerKind;
  exDate: string | null;
  amount: number | null;
  shares: number | null;
  notes: string | null;
  createdAt: string;
}

export interface NewCorporateLedgerEntry {
  symbol: string;
  kind: CorporateLedgerKind;
  exDate?: string | null;
  amount?: number | null;
  shares?: number | null;
  notes?: string | null;
}

export interface ReconciliationImport {
  id: number;
  source: string;
  importedAt: string;
  rowsCount: number;
  summary: Record<string, unknown> | null;
}

const SYMBOL_PATTERN = /^[A-Z0-9._-]{1,24}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:$|[T ])/;

function roundValue(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeSymbol(value: string): string {
  const symbol = String(value ?? "").trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw new Error("invalid symbol");
  }
  return symbol;
}

function isDateText(value: string): boolean {
  return (
    DATE_PATTERN.test(value) &&
    Number.isFinite(Date.parse(`${value.slice(0, 10)}T00:00:00Z`))
  );
}

function optionalNumber(
  value: number | null | undefined,
  name: string,
  { min = 0, integer = false }: { min?: number; integer?: boolean } = {},
): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`${name} must be a finite number >= ${min}`);
  }
  if (integer && !Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

interface NormalizedPlan {
  symbol: string;
  side: "buy" | "sell";
  entry: number;
  stop: number;
  targets: number[];
  quantity: number;
  riskAmount: number;
  riskPercent: number;
  rewardRisk: number;
  fees: number;
  notes: string | null;
}

function normalizePlan(input: TradePlanInput): NormalizedPlan {
  const symbol = normalizeSymbol(input.symbol);
  if (input.side !== "buy" && input.side !== "sell") {
    throw new Error("side must be buy or sell");
  }
  const entry = Number(input.entry);
  const stop = Number(input.stop);
  if (!Number.isFinite(entry) || entry <= 0) {
    throw new Error("entry must be a finite positive price");
  }
  if (!Number.isFinite(stop) || stop <= 0) {
    throw new Error("stop must be a finite positive price");
  }
  if (!Array.isArray(input.targets)) {
    throw new Error("targets must be an array of prices");
  }
  if (input.targets.length < 1 || input.targets.length > 3) {
    throw new Error("targets must contain 1 to 3 prices");
  }
  const targets = input.targets.map((target) => Number(target));
  for (const target of targets) {
    if (!Number.isFinite(target) || target <= 0) {
      throw new Error("each target must be a finite positive price");
    }
  }
  const quantity = Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive integer");
  }
  if (input.side === "buy") {
    if (!(stop < entry)) {
      throw new Error("buy stop must be below entry");
    }
    if (targets.some((target) => !(entry < target))) {
      throw new Error("buy targets must be above entry");
    }
  } else {
    if (!(stop > entry)) {
      throw new Error("sell stop must be above entry");
    }
    if (targets.some((target) => !(entry > target))) {
      throw new Error("sell targets must be below entry");
    }
  }

  const risk = Math.abs(entry - stop);
  const riskAmount =
    input.riskAmount === null || input.riskAmount === undefined
      ? risk * quantity
      : optionalNumber(input.riskAmount, "riskAmount", { min: 0 });
  const riskPercent =
    input.riskPercent === null || input.riskPercent === undefined
      ? (risk / entry) * 100
      : optionalNumber(input.riskPercent, "riskPercent", { min: 0 });
  const reward = Math.abs(targets[0]! - entry);
  const rewardRisk =
    input.rewardRisk === null || input.rewardRisk === undefined
      ? reward / risk
      : optionalNumber(input.rewardRisk, "rewardRisk", { min: 0 });
  const fees =
    input.fees === null || input.fees === undefined
      ? 0
      : optionalNumber(input.fees, "fees", { min: 0 });

  return {
    symbol,
    side: input.side,
    entry,
    stop,
    targets,
    quantity,
    riskAmount: roundValue(riskAmount!, 2),
    riskPercent: roundValue(riskPercent!, 4),
    rewardRisk: roundValue(rewardRisk!, 4),
    fees: roundValue(fees!, 2),
    notes: input.notes?.trim() || null,
  };
}

function computeJournalPnl(
  side: "buy" | "sell",
  actualEntry: number | null,
  actualExit: number | null,
  quantity: number | null,
  fees: number,
): number | null {
  // Never invent a fill: with no recorded exit there is no realised P&L.
  if (actualEntry === null || actualExit === null || quantity === null) {
    return null;
  }
  const gross =
    side === "buy"
      ? (actualExit - actualEntry) * quantity
      : (actualEntry - actualExit) * quantity;
  return roundValue(gross - fees, 2);
}

interface NormalizedJournal {
  planId: number | null;
  symbol: string;
  side: "buy" | "sell";
  paper: boolean;
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget: number | null;
  actualEntry: number | null;
  actualExit: number | null;
  quantity: number | null;
  fees: number;
  pnl: number | null;
  reason: string | null;
  mistakes: string | null;
  tags: string[];
  snapshot: string | null;
  openedAt: string;
  closedAt: string | null;
}

function normalizeJournal(input: JournalInput): NormalizedJournal {
  const symbol = normalizeSymbol(input.symbol);
  if (input.side !== "buy" && input.side !== "sell") {
    throw new Error("side must be buy or sell");
  }
  const planId =
    input.planId === null || input.planId === undefined
      ? null
      : optionalNumber(input.planId, "planId", { min: 1, integer: true });

  const plannedEntry = optionalNumber(input.plannedEntry, "plannedEntry", {
    min: 0,
  });
  const plannedStop = optionalNumber(input.plannedStop, "plannedStop", {
    min: 0,
  });
  const plannedTarget = optionalNumber(input.plannedTarget, "plannedTarget", {
    min: 0,
  });
  const actualEntry = optionalNumber(input.actualEntry, "actualEntry", {
    min: 0,
  });
  const actualExit = optionalNumber(input.actualExit, "actualExit", { min: 0 });
  const quantity =
    input.quantity === null || input.quantity === undefined
      ? null
      : optionalNumber(input.quantity, "quantity", { min: 1e-9 });
  const fees =
    input.fees === null || input.fees === undefined
      ? 0
      : optionalNumber(input.fees, "fees", { min: 0 })!;

  const pnl =
    actualExit === null
      ? null
      : input.pnl !== null && input.pnl !== undefined
        ? optionalNumber(input.pnl, "pnl", {
            min: Number.NEGATIVE_INFINITY,
          })
        : computeJournalPnl(input.side, actualEntry, actualExit, quantity, fees);

  const openedAt = input.openedAt ?? new Date().toISOString();
  if (!isDateText(openedAt)) {
    throw new Error("openedAt must be YYYY-MM-DD or an ISO timestamp");
  }
  const closedAt = input.closedAt ?? null;
  if (closedAt !== null && !isDateText(closedAt)) {
    throw new Error("closedAt must be YYYY-MM-DD or an ISO timestamp");
  }

  const rawTags = input.tags ?? [];
  if (!Array.isArray(rawTags)) {
    throw new Error("tags must be an array of strings");
  }
  const tags = rawTags.map((tag) => String(tag).trim()).filter(Boolean);

  let snapshot: string | null = null;
  if (input.snapshot !== undefined && input.snapshot !== null) {
    snapshot = JSON.stringify(input.snapshot);
  }

  return {
    planId,
    symbol,
    side: input.side,
    paper: input.paper === true,
    plannedEntry,
    plannedStop,
    plannedTarget,
    actualEntry,
    actualExit,
    quantity,
    fees,
    pnl: pnl === null ? null : roundValue(pnl, 2),
    reason: input.reason?.trim() || null,
    mistakes: input.mistakes?.trim() || null,
    tags,
    snapshot,
    openedAt,
    closedAt,
  };
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

export interface NewImportAudit {
  syncRunId?: number | null;
  providerId: string;
  startedAt: string;
  finishedAt: string;
  status: string;
  files: string[];
  counts: Record<string, number>;
  warnings: string[];
  failedSymbols: string[];
}

/** Maps a candles row to a Candle, keeping the established key order. */
function candleFromRow(row: Record<string, unknown>): Candle {
  const candle = {
    symbol: String(row.symbol),
    timeframe: String(row.timeframe) as Candle["timeframe"],
    timestamp: String(row.timestamp),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  } as Candle;
  if (row.turnover !== null) candle.turnover = Number(row.turnover);
  if (row.trades !== null) candle.trades = Number(row.trades);
  candle.adjusted = Number(row.adjusted) === 1;
  if (row.adjustment_factor !== null) {
    candle.adjustmentFactor = Number(row.adjustment_factor);
  }
  return candle;
}

/**
 * Provenance retained on every stored row. `asOf` is the source's own
 * observation time when available; `fetchedAt` is when this app retrieved it.
 */
export interface StoredProvenance {
  providerId: string;
  sourceType: string;
  termsStatus: string;
  productionReady: boolean;
  fetchedAt: string;
  asOf: string | null;
  classification: DataClassification;
}

export interface Provenanced<T> {
  data: T;
  provenance: StoredProvenance;
}

interface Provenance extends StoredProvenance {}

function provenance<T>(envelope: DataEnvelope<T>): Provenance {
  const meta: DataMeta = envelope.meta;

  // Defence in depth: even if a caller bypasses the service, unofficial data
  // must never be persisted as production-ready.
  if (meta.sourceType === "unofficial" && meta.productionReady) {
    throw new DataQualityError(
      meta.providerId,
      "unofficial data cannot be stored as production-ready",
    );
  }
  if (meta.sourceType === "mock") {
    throw new DataQualityError(
      meta.providerId,
      "demo/mock data cannot be stored in the product database",
    );
  }

  return {
    providerId: meta.providerId,
    sourceType: meta.sourceType,
    termsStatus: meta.termsStatus,
    productionReady: meta.productionReady,
    fetchedAt: meta.fetchedAt,
    asOf: meta.asOf ?? null,
    classification:
      meta.classification ?? classificationForSourceType(meta.sourceType),
  };
}

/**
 * Local SQLite store for personal research mode.
 *
 * Every row carries the provider id and provenance, and every primary key
 * includes the provider id. Two providers can therefore never overwrite or
 * blend each other's series: switching to a licensed provider creates a new
 * namespace instead of contaminating the free-source history.
 */
export class PersonalStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const applied = new Set(
      this.db
        .prepare("SELECT version FROM schema_migrations")
        .all()
        .map((row) => Number(row.version)),
    );

    if (!applied.has(1)) {
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        provider_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        sector TEXT NOT NULL,
        instrument_type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        source_type TEXT NOT NULL,
        terms_status TEXT NOT NULL,
        production_ready INTEGER NOT NULL,
        classification TEXT NOT NULL DEFAULT 'UNVERIFIED',
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, symbol)
      );

      CREATE TABLE IF NOT EXISTS candles (
        provider_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('equity', 'index')),
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        turnover REAL,
        trades INTEGER,
        adjusted INTEGER NOT NULL,
        adjustment_factor REAL,
        as_of TEXT,
        source_type TEXT NOT NULL,
        terms_status TEXT NOT NULL,
        production_ready INTEGER NOT NULL,
        classification TEXT NOT NULL DEFAULT 'UNVERIFIED',
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, kind, symbol, timeframe, timestamp)
      );

      CREATE INDEX IF NOT EXISTS idx_candles_series
        ON candles (provider_id, kind, symbol, timestamp);

      CREATE TABLE IF NOT EXISTS quotes (
        provider_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        as_of TEXT NOT NULL,
        payload TEXT NOT NULL,
        source_type TEXT NOT NULL,
        terms_status TEXT NOT NULL,
        production_ready INTEGER NOT NULL,
        classification TEXT NOT NULL DEFAULT 'UNVERIFIED',
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, symbol)
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        provider_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        natural_key TEXT NOT NULL,
        as_of TEXT,
        payload TEXT NOT NULL,
        source_type TEXT NOT NULL,
        terms_status TEXT NOT NULL,
        production_ready INTEGER NOT NULL,
        classification TEXT NOT NULL DEFAULT 'UNVERIFIED',
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, capability, natural_key)
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        detail TEXT
      );

      CREATE TABLE IF NOT EXISTS watchlist (
        symbol TEXT PRIMARY KEY,
        added_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS portfolio_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
        quantity REAL NOT NULL CHECK (quantity > 0),
        price REAL NOT NULL CHECK (price >= 0),
        fees REAL NOT NULL DEFAULT 0 CHECK (fees >= 0),
        traded_at TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_portfolio_symbol
        ON portfolio_transactions (symbol, traded_at);
      `);
      this.recordMigration(1);
    }

    if (!applied.has(2)) {
      for (const table of ["companies", "candles", "quotes", "snapshots"]) {
        const columns = new Set(
          this.db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((row) => String(row.name)),
        );
        if (!columns.has("classification")) {
          this.db.exec(
            `ALTER TABLE ${table} ADD COLUMN classification TEXT NOT NULL DEFAULT 'UNVERIFIED'`,
          );
        }
      }
      this.recordMigration(2);
    }

    if (!applied.has(3)) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS import_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sync_run_id INTEGER,
          provider_id TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT NOT NULL,
          status TEXT NOT NULL,
          files TEXT NOT NULL,
          counts TEXT NOT NULL,
          warnings TEXT NOT NULL,
          failed_symbols TEXT NOT NULL
        );
      `);
      this.recordMigration(3);
    }

    if (!applied.has(4)) {
      // Intraday bars live apart from the end-of-day `candles` table: every
      // screener, indicator and analysis pass must keep reading one daily row
      // per session, never a mixture of daily and minute bars.
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS intraday_candles (
          provider_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('equity', 'index')),
          symbol TEXT NOT NULL,
          timeframe TEXT NOT NULL,
          session_date TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          open REAL NOT NULL,
          high REAL NOT NULL,
          low REAL NOT NULL,
          close REAL NOT NULL,
          volume REAL NOT NULL DEFAULT 0,
          turnover REAL,
          trades INTEGER,
          source_type TEXT NOT NULL,
          terms_status TEXT NOT NULL,
          production_ready INTEGER NOT NULL,
          classification TEXT NOT NULL DEFAULT 'UNVERIFIED',
          fetched_at TEXT NOT NULL,
          PRIMARY KEY (provider_id, kind, symbol, timeframe, timestamp)
        );

        CREATE INDEX IF NOT EXISTS idx_intraday_series
          ON intraday_candles (provider_id, kind, symbol, session_date, timeframe);
      `);
      this.recordMigration(4);
    }

    if (!applied.has(5)) {
      // Trade plans, the trade journal, the corporate-action ledger and
      // reconciliation metadata. Portfolio columns are added only when the
      // table predates them (a fresh database creates them in one pass below).
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS trade_plans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
          entry REAL NOT NULL,
          stop REAL NOT NULL,
          targets TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          risk_amount REAL,
          risk_percent REAL,
          reward_risk REAL,
          fees REAL,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_trade_plans_symbol
          ON trade_plans (symbol, id);

        CREATE TABLE IF NOT EXISTS trade_journal (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          plan_id INTEGER,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
          paper INTEGER NOT NULL DEFAULT 0,
          planned_entry REAL,
          planned_stop REAL,
          planned_target REAL,
          actual_entry REAL,
          actual_exit REAL,
          quantity REAL,
          fees REAL NOT NULL DEFAULT 0,
          pnl REAL,
          reason TEXT,
          mistakes TEXT,
          tags TEXT NOT NULL DEFAULT '[]',
          snapshot TEXT,
          opened_at TEXT NOT NULL,
          closed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_trade_journal_symbol
          ON trade_journal (symbol, opened_at);

        CREATE TABLE IF NOT EXISTS corporate_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('dividend', 'bonus', 'right', 'other')),
          ex_date TEXT,
          amount REAL,
          shares REAL,
          notes TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_corporate_ledger_symbol
          ON corporate_ledger (symbol, ex_date);

        CREATE TABLE IF NOT EXISTS reconciliation_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          imported_at TEXT NOT NULL,
          rows_count INTEGER NOT NULL,
          summary TEXT
        );
      `);

      const portfolioColumns = new Set(
        this.db
          .prepare("PRAGMA table_info(portfolio_transactions)")
          .all()
          .map((row) => String(row.name)),
      );
      if (!portfolioColumns.has("source")) {
        this.db.exec("ALTER TABLE portfolio_transactions ADD COLUMN source TEXT");
      }
      if (!portfolioColumns.has("external_id")) {
        this.db.exec(
          "ALTER TABLE portfolio_transactions ADD COLUMN external_id TEXT",
        );
      }
      if (!portfolioColumns.has("kind")) {
        this.db.exec(
          "ALTER TABLE portfolio_transactions ADD COLUMN kind TEXT NOT NULL DEFAULT 'trade'",
        );
      }
      if (!portfolioColumns.has("notes")) {
        this.db.exec("ALTER TABLE portfolio_transactions ADD COLUMN notes TEXT");
      }
      // Idempotent reconciliation: an external id can appear only once, while
      // rows without one (manual entries) are unaffected.
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_external_id
          ON portfolio_transactions (external_id)
          WHERE external_id IS NOT NULL;
      `);

      this.recordMigration(5);
    }
  }

  private recordMigration(version: number): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      )
      .run(version, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }

  getSchemaVersion(): number {
    const row = this.db
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get();
    return Number(row?.version ?? 0);
  }

  /** Consistent point-in-time backup using SQLite's own VACUUM INTO. */
  backupTo(path: string): void {
    if (existsSync(path)) {
      throw new Error(`backup target already exists: ${path}`);
    }
    const escaped = path.replaceAll("'", "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);
  }

  upsertCompanies(envelope: DataEnvelope<Company[]>): number {
    const p = provenance(envelope);
    const statement = this.db.prepare(`
      INSERT INTO companies (
        provider_id, symbol, name, sector, instrument_type, status, payload,
        source_type, terms_status, production_ready, classification, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (provider_id, symbol) DO UPDATE SET
        name = excluded.name,
        sector = excluded.sector,
        instrument_type = excluded.instrument_type,
        status = excluded.status,
        payload = excluded.payload,
        source_type = excluded.source_type,
        terms_status = excluded.terms_status,
        production_ready = excluded.production_ready,
        classification = excluded.classification,
        fetched_at = excluded.fetched_at
    `);

    for (const company of envelope.data) {
      statement.run(
        p.providerId,
        company.symbol.toUpperCase(),
        company.name,
        company.sector,
        company.instrumentType,
        company.status,
        JSON.stringify(company),
        p.sourceType,
        p.termsStatus,
        p.productionReady ? 1 : 0,
        p.classification,
        p.fetchedAt,
      );
    }
    return envelope.data.length;
  }

  upsertCandles(
    envelope: DataEnvelope<Candle[]>,
    kind: SeriesKind,
  ): number {
    const p = provenance(envelope);
    const statement = this.db.prepare(`
      INSERT INTO candles (
        provider_id, kind, symbol, timeframe, timestamp, open, high, low,
        close, volume, turnover, trades, adjusted, adjustment_factor, as_of,
        source_type, terms_status, production_ready, classification, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (provider_id, kind, symbol, timeframe, timestamp)
      DO UPDATE SET
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume,
        turnover = excluded.turnover,
        trades = excluded.trades,
        adjusted = excluded.adjusted,
        adjustment_factor = excluded.adjustment_factor,
        as_of = excluded.as_of,
        source_type = excluded.source_type,
        terms_status = excluded.terms_status,
        production_ready = excluded.production_ready,
        classification = excluded.classification,
        fetched_at = excluded.fetched_at
    `);

    for (const candle of envelope.data) {
      statement.run(
        p.providerId,
        kind,
        candle.symbol.toUpperCase(),
        candle.timeframe,
        candle.timestamp,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
        candle.turnover ?? null,
        candle.trades ?? null,
        candle.adjusted ? 1 : 0,
        candle.adjustmentFactor ?? null,
        // Each candle's own observation time. The envelope asOf is the end of
        // the whole series, which would make every historical row look current.
        candle.timestamp,
        p.sourceType,
        p.termsStatus,
        p.productionReady ? 1 : 0,
        p.classification,
        p.fetchedAt,
      );
    }
    return envelope.data.length;
  }

  upsertQuotes(envelope: DataEnvelope<Quote[]>): number {
    const p = provenance(envelope);
    const statement = this.db.prepare(`
      INSERT INTO quotes (
        provider_id, symbol, as_of, payload, source_type, terms_status,
        production_ready, classification, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (provider_id, symbol) DO UPDATE SET
        as_of = excluded.as_of,
        payload = excluded.payload,
        source_type = excluded.source_type,
        terms_status = excluded.terms_status,
        production_ready = excluded.production_ready,
        classification = excluded.classification,
        fetched_at = excluded.fetched_at
    `);

    for (const quote of envelope.data) {
      statement.run(
        p.providerId,
        quote.symbol.toUpperCase(),
        quote.asOf,
        JSON.stringify(quote),
        p.sourceType,
        p.termsStatus,
        p.productionReady ? 1 : 0,
        p.classification,
        p.fetchedAt,
      );
    }
    return envelope.data.length;
  }

  /** Generic escape hatch for summaries, indices, fundamentals, and news. */
  upsertSnapshot<T>(
    capability: string,
    naturalKey: string,
    envelope: DataEnvelope<T>,
  ): void {
    const p = provenance(envelope);
    this.db
      .prepare(
        `
        INSERT INTO snapshots (
          provider_id, capability, natural_key, as_of, payload, source_type,
          terms_status, production_ready, classification, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (provider_id, capability, natural_key) DO UPDATE SET
          as_of = excluded.as_of,
          payload = excluded.payload,
          source_type = excluded.source_type,
          terms_status = excluded.terms_status,
          production_ready = excluded.production_ready,
          classification = excluded.classification,
          fetched_at = excluded.fetched_at
      `,
      )
      .run(
        p.providerId,
        capability,
        naturalKey,
        p.asOf,
        JSON.stringify(envelope.data),
        p.sourceType,
        p.termsStatus,
        p.productionReady ? 1 : 0,
        p.classification,
        p.fetchedAt,
      );
  }

  private provenanceFromRow(row: Record<string, unknown>): StoredProvenance {
    const sourceType = String(row.source_type);
    const stored = String(row.classification ?? "");
    const classification: DataClassification = (
      ["VERIFIED", "UNVERIFIED", "DERIVED", "DEMO", "MISSING"] as const
    ).includes(stored as DataClassification)
      ? (stored as DataClassification)
      : classificationForSourceType(sourceType);
    return {
      providerId: String(row.provider_id),
      sourceType,
      termsStatus: String(row.terms_status),
      productionReady: Number(row.production_ready) === 1,
      fetchedAt: String(row.fetched_at),
      asOf: row.as_of === null || row.as_of === undefined
        ? null
        : String(row.as_of),
      classification,
    };
  }

  getCompanies(providerId: string): Company[] {
    return this.getCompaniesWithProvenance(providerId).map((entry) => entry.data);
  }

  getCompaniesWithProvenance(providerId: string): Array<Provenanced<Company>> {
    const rows = this.db
      .prepare(
        `SELECT * FROM companies WHERE provider_id = ? ORDER BY symbol`,
      )
      .all(providerId);
    return rows.map((row) => ({
      data: CompanySchema.parse(JSON.parse(String(row.payload))),
      provenance: this.provenanceFromRow(row),
    }));
  }

  getCandles(query: CandleQuery): Candle[] {
    return this.getCandlesWithProvenance(query).map((entry) => entry.data);
  }

  getCandlesWithProvenance(
    query: CandleQuery,
  ): Array<Provenanced<Candle>> {
    const clauses = [
      "provider_id = ?",
      "kind = ?",
      "symbol = ?",
    ];
    const params: Array<string> = [
      query.providerId,
      query.kind,
      query.symbol.toUpperCase(),
    ];

    if (query.timeframe) {
      clauses.push("timeframe = ?");
      params.push(query.timeframe);
    }
    if (query.from) {
      clauses.push("substr(timestamp, 1, 10) >= ?");
      params.push(query.from);
    }
    if (query.to) {
      clauses.push("substr(timestamp, 1, 10) <= ?");
      params.push(query.to);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM candles WHERE ${clauses.join(" AND ")} ORDER BY timestamp`,
      )
      .all(...params);

    return rows.map((row) => ({
      data: candleFromRow(row),
      provenance: this.provenanceFromRow(row),
    }));
  }

  /**
   * A whole series without per-row provenance (the rows of one import share
   * it), plus the newest row's provenance. Reads only the candle columns, so
   * it is about twice as fast as getCandlesWithProvenance for bulk scans such
   * as the screener.
   */
  getCandleSeries(
    providerId: string,
    symbol: string,
    kind: SeriesKind = "equity",
    timeframe: string = "1day",
  ): { candles: Candle[]; latest: Provenanced<{ close: number; timestamp: string }> | null } {
    const candles = this.db
      .prepare(
        `SELECT symbol, timeframe, timestamp, open, high, low, close, volume,
                turnover, trades, adjusted, adjustment_factor
         FROM candles
         WHERE provider_id = ? AND kind = ? AND symbol = ? AND timeframe = ?
         ORDER BY timestamp`,
      )
      .all(providerId, kind, symbol.toUpperCase(), timeframe)
      .map(candleFromRow);
    return {
      candles,
      latest:
        candles.length > 0
          ? this.getLatestCandleWithProvenance(providerId, symbol, kind)
          : null,
    };
  }

  /** Store intraday bars; one row per (symbol, timeframe, timestamp). */
  upsertIntradayCandles(
    envelope: DataEnvelope<Candle[]>,
    kind: SeriesKind,
  ): number {
    const p = provenance(envelope);
    const statement = this.db.prepare(`
      INSERT INTO intraday_candles (
        provider_id, kind, symbol, timeframe, session_date, timestamp, open,
        high, low, close, volume, turnover, trades, source_type, terms_status,
        production_ready, classification, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (provider_id, kind, symbol, timeframe, timestamp)
      DO UPDATE SET
        session_date = excluded.session_date,
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume,
        turnover = excluded.turnover,
        trades = excluded.trades,
        source_type = excluded.source_type,
        terms_status = excluded.terms_status,
        production_ready = excluded.production_ready,
        classification = excluded.classification,
        fetched_at = excluded.fetched_at
    `);

    for (const candle of envelope.data) {
      statement.run(
        p.providerId,
        kind,
        candle.symbol.toUpperCase(),
        candle.timeframe,
        candle.timestamp.slice(0, 10),
        candle.timestamp,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
        candle.turnover ?? null,
        candle.trades ?? null,
        p.sourceType,
        p.termsStatus,
        p.productionReady ? 1 : 0,
        p.classification,
        p.fetchedAt,
      );
    }
    return envelope.data.length;
  }

  getIntradayCandles(query: IntradayQuery): StoredIntradayCandle[] {
    const clauses = [
      "provider_id = ?",
      "kind = ?",
      "symbol = ?",
    ];
    const params: Array<string | number> = [
      query.providerId,
      query.kind,
      query.symbol.toUpperCase(),
    ];
    if (query.timeframe) {
      clauses.push("timeframe = ?");
      params.push(query.timeframe);
    }
    if (query.session) {
      clauses.push("session_date = ?");
      params.push(query.session);
    }
    if (query.from) {
      clauses.push("substr(timestamp, 1, 10) >= ?");
      params.push(query.from);
    }
    if (query.to) {
      clauses.push("substr(timestamp, 1, 10) <= ?");
      params.push(query.to);
    }

    let sql = `SELECT * FROM intraday_candles
               WHERE ${clauses.join(" AND ")}
               ORDER BY timestamp`;
    if (query.limit !== undefined && Number.isFinite(query.limit)) {
      sql = `SELECT * FROM (
               SELECT * FROM intraday_candles
               WHERE ${clauses.join(" AND ")}
               ORDER BY timestamp DESC
               LIMIT ${Math.max(1, Math.floor(query.limit))}
             ) ORDER BY timestamp`;
    }

    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => ({
        ...candleFromRow(row),
        sessionDate: String(row.session_date),
      }));
  }

  /** Distinct stored intraday sessions for one series, newest first. */
  listIntradaySessions(
    providerId: string,
    kind: SeriesKind,
    symbol: string,
  ): string[] {
    return this.db
      .prepare(
        `SELECT DISTINCT session_date FROM intraday_candles
         WHERE provider_id = ? AND kind = ? AND symbol = ?
         ORDER BY session_date DESC`,
      )
      .all(providerId, kind, symbol.toUpperCase())
      .map((row) => String(row.session_date));
  }

  countIntraday(providerId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM intraday_candles WHERE provider_id = ?",
      )
      .get(providerId);
    return Number(row?.n ?? 0);
  }

  /** Newest stored intraday timestamp and import time for one series. */
  getIntradaySummary(
    providerId: string,
    kind: SeriesKind,
    symbol: string,
    timeframe?: string,
  ): { asOf: string | null; fetchedAt: string | null; count: number } {
    const row = this.db
      .prepare(
        `SELECT MAX(timestamp) AS as_of, MAX(fetched_at) AS fetched_at,
                COUNT(*) AS n
         FROM intraday_candles
         WHERE provider_id = ? AND kind = ? AND symbol = ?
           ${timeframe ? "AND timeframe = ?" : ""}`,
      )
      .get(
        ...(timeframe
          ? [providerId, kind, symbol.toUpperCase(), timeframe]
          : [providerId, kind, symbol.toUpperCase()]),
      );
    return {
      asOf: row?.as_of === null || row?.as_of === undefined ? null : String(row.as_of),
      fetchedAt:
        row?.fetched_at === null || row?.fetched_at === undefined
          ? null
          : String(row.fetched_at),
      count: Number(row?.n ?? 0),
    };
  }

  getQuotes(providerId: string): Quote[] {
    return this.getQuotesWithProvenance(providerId).map((entry) => entry.data);
  }

  getQuotesWithProvenance(providerId: string): Array<Provenanced<Quote>> {
    const rows = this.db
      .prepare(
        `SELECT * FROM quotes WHERE provider_id = ? ORDER BY symbol`,
      )
      .all(providerId);
    return rows.map((row) => ({
      data: JSON.parse(String(row.payload)) as Quote,
      provenance: this.provenanceFromRow(row),
    }));
  }

  getSymbolsWithCandles(
    providerId: string,
    kind: SeriesKind = "equity",
  ): string[] {
    return this.db
      .prepare(
        `SELECT DISTINCT symbol FROM candles
         WHERE provider_id = ? AND kind = ?
         ORDER BY symbol`,
      )
      .all(providerId, kind)
      .map((row) => String(row.symbol));
  }

  getLatestCandle(
    providerId: string,
    symbol: string,
    kind: SeriesKind = "equity",
  ): { close: number; timestamp: string } | null {
    const entry = this.getLatestCandleWithProvenance(providerId, symbol, kind);
    return entry
      ? { close: entry.data.close, timestamp: entry.data.timestamp }
      : null;
  }

  getLatestCandleWithProvenance(
    providerId: string,
    symbol: string,
    kind: SeriesKind = "equity",
  ): Provenanced<{ close: number; timestamp: string }> | null {
    const row = this.db
      .prepare(
        `SELECT * FROM candles
         WHERE provider_id = ? AND kind = ? AND symbol = ?
         ORDER BY timestamp DESC
         LIMIT 1`,
      )
      .get(providerId, kind, symbol.toUpperCase());
    return row
      ? {
          data: {
            close: Number(row.close),
            timestamp: String(row.timestamp),
          },
          provenance: this.provenanceFromRow(row),
        }
      : null;
  }

  addPortfolioTransaction(
    input: NewPortfolioTransaction,
  ): PortfolioTransaction {
    const symbol = input.symbol.trim().toUpperCase();
    if (!/^[A-Z0-9._-]{1,24}$/.test(symbol)) {
      throw new Error("invalid symbol");
    }
    if (input.side !== "buy" && input.side !== "sell") {
      throw new Error("side must be buy or sell");
    }
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new Error("quantity must be positive");
    }
    if (!Number.isFinite(input.price) || input.price < 0) {
      throw new Error("price must be zero or positive");
    }
    const fees = input.fees ?? 0;
    if (!Number.isFinite(fees) || fees < 0) {
      throw new Error("fees must be zero or positive");
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(input.tradedAt)) {
      throw new Error("tradedAt must start with YYYY-MM-DD");
    }

    const createdAt = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO portfolio_transactions (
           symbol, side, quantity, price, fees, traded_at, notes, created_at,
           source, external_id, kind
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        symbol,
        input.side,
        input.quantity,
        input.price,
        fees,
        input.tradedAt,
        input.notes?.trim() || null,
        createdAt,
        input.source?.trim() || null,
        input.externalId?.trim() || null,
        input.kind?.trim() || "trade",
      );

    return {
      id: Number(result.lastInsertRowid),
      symbol,
      side: input.side,
      quantity: input.quantity,
      price: input.price,
      fees,
      tradedAt: input.tradedAt,
      notes: input.notes?.trim() || null,
      createdAt,
    };
  }

  getPortfolioTransactions(): PortfolioTransaction[] {
    return this.db
      .prepare(
        `SELECT * FROM portfolio_transactions
         ORDER BY traded_at, id`,
      )
      .all()
      .map((row) => ({
        id: Number(row.id),
        symbol: String(row.symbol),
        side: String(row.side) as PortfolioTransaction["side"],
        quantity: Number(row.quantity),
        price: Number(row.price),
        fees: Number(row.fees),
        tradedAt: String(row.traded_at),
        notes: row.notes === null ? null : String(row.notes),
        createdAt: String(row.created_at),
      }));
  }

  removePortfolioTransaction(id: number): boolean {
    const result = this.db
      .prepare(`DELETE FROM portfolio_transactions WHERE id = ?`)
      .run(id);
    return Number(result.changes) > 0;
  }

  /** Portfolio rows plus the reconciliation metadata columns. */
  getReconciliationTransactions(): ReconciliationTransaction[] {
    return this.db
      .prepare(
        `SELECT * FROM portfolio_transactions
         ORDER BY traded_at, id`,
      )
      .all()
      .map((row) => ({
        id: Number(row.id),
        symbol: String(row.symbol),
        side: String(row.side) as PortfolioTransaction["side"],
        quantity: Number(row.quantity),
        price: Number(row.price),
        fees: Number(row.fees),
        tradedAt: String(row.traded_at),
        notes: row.notes === null ? null : String(row.notes),
        createdAt: String(row.created_at),
        source: row.source === null || row.source === undefined
          ? null
          : String(row.source),
        externalId:
          row.external_id === null || row.external_id === undefined
            ? null
            : String(row.external_id),
        kind: row.kind === null || row.kind === undefined
          ? "trade"
          : String(row.kind),
      }));
  }

  // -----------------------------------------------------------------------
  // trade plans
  // -----------------------------------------------------------------------

  private tradePlanFromRow(row: Record<string, unknown>): TradePlan {
    let targets: number[] = [];
    try {
      const parsed = JSON.parse(String(row.targets));
      if (Array.isArray(parsed)) targets = parsed.map((value) => Number(value));
    } catch {
      targets = [];
    }
    return {
      id: Number(row.id),
      symbol: String(row.symbol),
      side: String(row.side) as TradePlan["side"],
      entry: Number(row.entry),
      stop: Number(row.stop),
      targets,
      quantity: Number(row.quantity),
      riskAmount: row.risk_amount === null ? null : Number(row.risk_amount),
      riskPercent: row.risk_percent === null ? null : Number(row.risk_percent),
      rewardRisk: row.reward_risk === null ? null : Number(row.reward_risk),
      fees: row.fees === null ? null : Number(row.fees),
      notes: row.notes === null ? null : String(row.notes),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  addTradePlan(input: TradePlanInput): TradePlan {
    const plan = normalizePlan(input);
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO trade_plans (
           symbol, side, entry, stop, targets, quantity, risk_amount,
           risk_percent, reward_risk, fees, notes, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.symbol,
        plan.side,
        plan.entry,
        plan.stop,
        JSON.stringify(plan.targets),
        plan.quantity,
        plan.riskAmount,
        plan.riskPercent,
        plan.rewardRisk,
        plan.fees,
        plan.notes,
        now,
        now,
      );
    return {
      id: Number(result.lastInsertRowid),
      ...plan,
      createdAt: now,
      updatedAt: now,
    };
  }

  getTradePlans(symbol?: string): TradePlan[] {
    const rows = symbol
      ? this.db
          .prepare(
            `SELECT * FROM trade_plans WHERE symbol = ? ORDER BY created_at DESC, id DESC`,
          )
          .all(normalizeSymbol(symbol))
      : this.db
          .prepare(
            `SELECT * FROM trade_plans ORDER BY created_at DESC, id DESC`,
          )
          .all();
    return rows.map((row) => this.tradePlanFromRow(row));
  }

  getTradePlan(id: number): TradePlan | null {
    const row = this.db
      .prepare(`SELECT * FROM trade_plans WHERE id = ?`)
      .get(id);
    return row ? this.tradePlanFromRow(row) : null;
  }

  updateTradePlan(id: number, patch: TradePlanPatch): TradePlan | null {
    const existing = this.getTradePlan(id);
    if (!existing) return null;
    const touchesDerived = ["entry", "stop", "targets", "quantity"].some(
      (field) => Object.prototype.hasOwnProperty.call(patch, field),
    );
    const merged = normalizePlan({
      symbol: patch.symbol ?? existing.symbol,
      side: patch.side ?? existing.side,
      entry: patch.entry ?? existing.entry,
      stop: patch.stop ?? existing.stop,
      targets: patch.targets ?? existing.targets,
      quantity: patch.quantity ?? existing.quantity,
      riskAmount:
        patch.riskAmount !== undefined
          ? patch.riskAmount
          : touchesDerived
            ? undefined
            : existing.riskAmount,
      riskPercent:
        patch.riskPercent !== undefined
          ? patch.riskPercent
          : touchesDerived
            ? undefined
            : existing.riskPercent,
      rewardRisk:
        patch.rewardRisk !== undefined
          ? patch.rewardRisk
          : touchesDerived
            ? undefined
            : existing.rewardRisk,
      fees: patch.fees !== undefined ? patch.fees : existing.fees,
      notes: patch.notes !== undefined ? patch.notes : existing.notes,
    });
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE trade_plans SET
           symbol = ?, side = ?, entry = ?, stop = ?, targets = ?,
           quantity = ?, risk_amount = ?, risk_percent = ?, reward_risk = ?,
           fees = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        merged.symbol,
        merged.side,
        merged.entry,
        merged.stop,
        JSON.stringify(merged.targets),
        merged.quantity,
        merged.riskAmount,
        merged.riskPercent,
        merged.rewardRisk,
        merged.fees,
        merged.notes,
        updatedAt,
        id,
      );
    return this.getTradePlan(id);
  }

  removeTradePlan(id: number): boolean {
    const result = this.db
      .prepare(`DELETE FROM trade_plans WHERE id = ?`)
      .run(id);
    return Number(result.changes) > 0;
  }

  // -----------------------------------------------------------------------
  // trade journal
  // -----------------------------------------------------------------------

  private journalFromRow(row: Record<string, unknown>): JournalEntry {
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(String(row.tags));
      if (Array.isArray(parsed)) tags = parsed.map((tag) => String(tag));
    } catch {
      tags = [];
    }
    let snapshot: unknown = null;
    if (row.snapshot !== null && row.snapshot !== undefined) {
      const text = String(row.snapshot);
      try {
        snapshot = JSON.parse(text);
      } catch {
        snapshot = text;
      }
    }
    return {
      id: Number(row.id),
      planId: row.plan_id === null ? null : Number(row.plan_id),
      symbol: String(row.symbol),
      side: String(row.side) as JournalEntry["side"],
      paper: Number(row.paper) === 1,
      plannedEntry:
        row.planned_entry === null ? null : Number(row.planned_entry),
      plannedStop: row.planned_stop === null ? null : Number(row.planned_stop),
      plannedTarget:
        row.planned_target === null ? null : Number(row.planned_target),
      actualEntry: row.actual_entry === null ? null : Number(row.actual_entry),
      actualExit: row.actual_exit === null ? null : Number(row.actual_exit),
      quantity: row.quantity === null ? null : Number(row.quantity),
      fees: Number(row.fees),
      pnl: row.pnl === null ? null : Number(row.pnl),
      reason: row.reason === null ? null : String(row.reason),
      mistakes: row.mistakes === null ? null : String(row.mistakes),
      tags,
      snapshot,
      openedAt: String(row.opened_at),
      closedAt: row.closed_at === null ? null : String(row.closed_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private journalInputFromEntry(entry: JournalEntry): JournalInput {
    return {
      planId: entry.planId,
      symbol: entry.symbol,
      side: entry.side,
      paper: entry.paper,
      plannedEntry: entry.plannedEntry,
      plannedStop: entry.plannedStop,
      plannedTarget: entry.plannedTarget,
      actualEntry: entry.actualEntry,
      actualExit: entry.actualExit,
      quantity: entry.quantity,
      fees: entry.fees,
      pnl: entry.pnl,
      reason: entry.reason,
      mistakes: entry.mistakes,
      tags: entry.tags,
      snapshot: entry.snapshot,
      openedAt: entry.openedAt,
      closedAt: entry.closedAt,
    };
  }

  addJournalEntry(input: JournalInput): JournalEntry {
    const entry = normalizeJournal(input);
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO trade_journal (
           plan_id, symbol, side, paper, planned_entry, planned_stop,
           planned_target, actual_entry, actual_exit, quantity, fees, pnl,
           reason, mistakes, tags, snapshot, opened_at, closed_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.planId,
        entry.symbol,
        entry.side,
        entry.paper ? 1 : 0,
        entry.plannedEntry,
        entry.plannedStop,
        entry.plannedTarget,
        entry.actualEntry,
        entry.actualExit,
        entry.quantity,
        entry.fees,
        entry.pnl,
        entry.reason,
        entry.mistakes,
        JSON.stringify(entry.tags),
        entry.snapshot,
        entry.openedAt,
        entry.closedAt,
        now,
        now,
      );
    return this.getJournalEntry(Number(result.lastInsertRowid))!;
  }

  getJournalEntry(id: number): JournalEntry | null {
    const row = this.db
      .prepare(`SELECT * FROM trade_journal WHERE id = ?`)
      .get(id);
    return row ? this.journalFromRow(row) : null;
  }

  getJournalEntries(
    query: { symbol?: string; from?: string; to?: string } = {},
  ): JournalEntry[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (query.symbol) {
      clauses.push("symbol = ?");
      params.push(normalizeSymbol(query.symbol));
    }
    if (query.from) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(query.from)) {
        throw new Error("from must be YYYY-MM-DD");
      }
      clauses.push("substr(opened_at, 1, 10) >= ?");
      params.push(query.from);
    }
    if (query.to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
        throw new Error("to must be YYYY-MM-DD");
      }
      clauses.push("substr(opened_at, 1, 10) <= ?");
      params.push(query.to);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT * FROM trade_journal ${where}
         ORDER BY opened_at DESC, id DESC`,
      )
      .all(...params)
      .map((row) => this.journalFromRow(row));
  }

  updateJournalEntry(id: number, patch: JournalPatch): JournalEntry | null {
    const existing = this.getJournalEntry(id);
    if (!existing) return null;
    const base = this.journalInputFromEntry(existing);
    const pnlFields: Array<keyof JournalInput> = [
      "side",
      "actualEntry",
      "actualExit",
      "quantity",
      "fees",
    ];
    const touchesPnl = pnlFields.some((field) =>
      Object.prototype.hasOwnProperty.call(patch, field),
    );
    const merged: JournalInput = { ...base, ...patch };
    if (!Object.prototype.hasOwnProperty.call(patch, "pnl") && !touchesPnl) {
      // Nothing that feeds the formula changed: keep a user-supplied value.
      merged.pnl = existing.pnl;
    } else if (!Object.prototype.hasOwnProperty.call(patch, "pnl")) {
      delete merged.pnl;
    }
    const entry = normalizeJournal(merged);
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE trade_journal SET
           plan_id = ?, symbol = ?, side = ?, paper = ?, planned_entry = ?,
           planned_stop = ?, planned_target = ?, actual_entry = ?,
           actual_exit = ?, quantity = ?, fees = ?, pnl = ?, reason = ?,
           mistakes = ?, tags = ?, snapshot = ?, opened_at = ?,
           closed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        entry.planId,
        entry.symbol,
        entry.side,
        entry.paper ? 1 : 0,
        entry.plannedEntry,
        entry.plannedStop,
        entry.plannedTarget,
        entry.actualEntry,
        entry.actualExit,
        entry.quantity,
        entry.fees,
        entry.pnl,
        entry.reason,
        entry.mistakes,
        JSON.stringify(entry.tags),
        entry.snapshot,
        entry.openedAt,
        entry.closedAt,
        updatedAt,
        id,
      );
    return this.getJournalEntry(id);
  }

  removeJournalEntry(id: number): boolean {
    const result = this.db
      .prepare(`DELETE FROM trade_journal WHERE id = ?`)
      .run(id);
    return Number(result.changes) > 0;
  }

  // -----------------------------------------------------------------------
  // corporate ledger
  // -----------------------------------------------------------------------

  private corporateLedgerFromRow(
    row: Record<string, unknown>,
  ): CorporateLedgerEntry {
    return {
      id: Number(row.id),
      symbol: String(row.symbol),
      kind: String(row.kind) as CorporateLedgerKind,
      exDate: row.ex_date === null ? null : String(row.ex_date),
      amount: row.amount === null ? null : Number(row.amount),
      shares: row.shares === null ? null : Number(row.shares),
      notes: row.notes === null ? null : String(row.notes),
      createdAt: String(row.created_at),
    };
  }

  addCorporateLedgerEntry(input: NewCorporateLedgerEntry): CorporateLedgerEntry {
    const symbol = normalizeSymbol(input.symbol);
    const kinds: CorporateLedgerKind[] = ["dividend", "bonus", "right", "other"];
    if (!kinds.includes(input.kind)) {
      throw new Error("kind must be dividend, bonus, right or other");
    }
    let exDate: string | null = null;
    if (input.exDate !== null && input.exDate !== undefined) {
      const text = String(input.exDate);
      if (!isDateText(text)) {
        throw new Error("exDate must be YYYY-MM-DD or an ISO timestamp");
      }
      exDate = text;
    }
    const amount = optionalNumber(input.amount, "amount", { min: 0 });
    const shares = optionalNumber(input.shares, "shares", { min: 0 });
    const createdAt = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO corporate_ledger (
           symbol, kind, ex_date, amount, shares, notes, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        symbol,
        input.kind,
        exDate,
        amount,
        shares,
        input.notes?.trim() || null,
        createdAt,
      );
    return this.corporateLedgerFromRow(
      this.db
        .prepare(`SELECT * FROM corporate_ledger WHERE id = ?`)
        .get(Number(result.lastInsertRowid))!,
    );
  }

  getCorporateLedger(symbol?: string): CorporateLedgerEntry[] {
    const rows = symbol
      ? this.db
          .prepare(
            `SELECT * FROM corporate_ledger WHERE symbol = ?
             ORDER BY COALESCE(ex_date, created_at), id`,
          )
          .all(normalizeSymbol(symbol))
      : this.db
          .prepare(
            `SELECT * FROM corporate_ledger
             ORDER BY COALESCE(ex_date, created_at), id`,
          )
          .all();
    return rows.map((row) => this.corporateLedgerFromRow(row));
  }

  removeCorporateLedgerEntry(id: number): boolean {
    const result = this.db
      .prepare(`DELETE FROM corporate_ledger WHERE id = ?`)
      .run(id);
    return Number(result.changes) > 0;
  }

  // -----------------------------------------------------------------------
  // reconciliation
  // -----------------------------------------------------------------------

  /**
   * Import broker rows idempotently. A row with an external id that already
   * exists is skipped; rows without one are always inserted. Everything runs
   * in one transaction, and the import itself is recorded.
   */
  importReconciliation(
    source: string,
    rows: NewPortfolioTransaction[],
  ): { imported: number; skipped: number; importId: number } {
    const cleanSource = String(source ?? "").trim();
    if (!cleanSource) throw new Error("source is required");
    return this.runInTransaction(() => {
      let imported = 0;
      let skipped = 0;
      for (const row of rows) {
        const externalId = row.externalId?.trim() || null;
        if (externalId) {
          const existing = this.db
            .prepare(
              `SELECT 1 AS found FROM portfolio_transactions
               WHERE external_id = ? LIMIT 1`,
            )
            .get(externalId);
          if (existing) {
            skipped += 1;
            continue;
          }
        }
        this.addPortfolioTransaction({
          ...row,
          source: row.source?.trim() || cleanSource,
          externalId,
        });
        imported += 1;
      }
      const importId = this.recordReconciliationImport(
        cleanSource,
        rows.length,
        { imported, skipped },
      );
      return { imported, skipped, importId };
    });
  }

  private recordReconciliationImport(
    source: string,
    rowsCount: number,
    summary: Record<string, unknown>,
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO reconciliation_imports (
           source, imported_at, rows_count, summary
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(source, new Date().toISOString(), rowsCount, JSON.stringify(summary));
    return Number(result.lastInsertRowid);
  }

  listReconciliationImports(): ReconciliationImport[] {
    return this.db
      .prepare(
        `SELECT * FROM reconciliation_imports ORDER BY imported_at DESC, id DESC`,
      )
      .all()
      .map((row) => {
        let summary: Record<string, unknown> | null = null;
        if (row.summary !== null && row.summary !== undefined) {
          try {
            const parsed = JSON.parse(String(row.summary));
            summary =
              parsed && typeof parsed === "object"
                ? (parsed as Record<string, unknown>)
                : null;
          } catch {
            summary = null;
          }
        }
        return {
          id: Number(row.id),
          source: String(row.source),
          importedAt: String(row.imported_at),
          rowsCount: Number(row.rows_count),
          summary,
        };
      });
  }

  // -----------------------------------------------------------------------
  // data-quality helpers
  // -----------------------------------------------------------------------

  /**
   * The most recent `sessionLimit` trading dates for a series and every daily
   * row of those sessions. Reads only the columns the data-quality report
   * needs instead of a full candle history.
   */
  getCandleSessionIndex(
    providerId: string,
    kind: SeriesKind = "equity",
    timeframe = "1day",
    sessionLimit = 60,
  ): {
    sessions: string[];
    rows: Array<{
      symbol: string;
      session: string;
      timestamp: string;
      close: number;
    }>;
  } {
    const limit = Math.max(1, Math.floor(sessionLimit));
    const sessions = this.db
      .prepare(
        `SELECT DISTINCT substr(timestamp, 1, 10) AS session
         FROM candles
         WHERE provider_id = ? AND kind = ? AND timeframe = ?
         ORDER BY session DESC
         LIMIT ?`,
      )
      .all(providerId, kind, timeframe, limit)
      .map((row) => String(row.session))
      .reverse();
    if (sessions.length === 0) return { sessions: [], rows: [] };
    const from = sessions[0]!;
    const to = sessions[sessions.length - 1]!;
    const rows = this.db
      .prepare(
        `SELECT symbol, substr(timestamp, 1, 10) AS session, timestamp, close
         FROM candles
         WHERE provider_id = ? AND kind = ? AND timeframe = ?
           AND substr(timestamp, 1, 10) >= ?
           AND substr(timestamp, 1, 10) <= ?
         ORDER BY symbol, timestamp`,
      )
      .all(providerId, kind, timeframe, from, to)
      .map((row) => ({
        symbol: String(row.symbol),
        session: String(row.session),
        timestamp: String(row.timestamp),
        close: Number(row.close),
      }));
    return { sessions, rows };
  }

  getSnapshot<T>(providerId: string, capability: string, naturalKey: string): T | undefined {
    return this.getSnapshotWithProvenance<T>(
      providerId,
      capability,
      naturalKey,
    )?.data;
  }

  /** Number of stored rows for a capability (e.g. floorsheet days). */
  countSnapshots(providerId: string, capability: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM snapshots
         WHERE provider_id = ? AND capability = ?`,
      )
      .get(providerId, capability);
    return Number(row?.n ?? 0);
  }

  /** Natural keys for a capability, newest first where a date is the key. */
  listSnapshotKeys(providerId: string, capability: string): string[] {
    return this.db
      .prepare(
        `SELECT natural_key FROM snapshots
         WHERE provider_id = ? AND capability = ?
         ORDER BY natural_key DESC`,
      )
      .all(providerId, capability)
      .map((row) => String(row.natural_key));
  }

  /**
   * Every stored snapshot of a capability (e.g. the latest fundamentals of
   * all symbols) in one query, ordered by natural key ascending.
   */
  listSnapshotsWithProvenance<T>(
    providerId: string,
    capability: string,
  ): Array<Provenanced<T> & { naturalKey: string }> {
    return this.db
      .prepare(
        `SELECT * FROM snapshots
         WHERE provider_id = ? AND capability = ?
         ORDER BY natural_key`,
      )
      .all(providerId, capability)
      .map((row) => ({
        naturalKey: String(row.natural_key),
        data: JSON.parse(String(row.payload)) as T,
        provenance: this.provenanceFromRow(row),
      }));
  }

  getSnapshotWithProvenance<T>(
    providerId: string,
    capability: string,
    naturalKey: string,
  ): Provenanced<T> | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM snapshots
         WHERE provider_id = ? AND capability = ? AND natural_key = ?`,
      )
      .get(providerId, capability, naturalKey);
    return row
      ? {
          data: JSON.parse(String(row.payload)) as T,
          provenance: this.provenanceFromRow(row),
        }
      : undefined;
  }

  summary(providerId?: string): StoreSummary {
    const filter = providerId ? "WHERE provider_id = ?" : "";
    const params = providerId ? [providerId] : [];

    const count = (table: string): number => {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} ${filter}`)
        .get(...params);
      return Number(row?.n ?? 0);
    };

    const fetched = this.db
      .prepare(
        `SELECT MAX(fetched_at) AS latest FROM (
           SELECT provider_id, fetched_at FROM companies
           UNION ALL SELECT provider_id, fetched_at FROM candles
           UNION ALL SELECT provider_id, fetched_at FROM quotes
           UNION ALL SELECT provider_id, fetched_at FROM snapshots
         ) ${filter}`,
      )
      .get(...params);

    return {
      providerId: providerId ?? null,
      companies: count("companies"),
      candles: count("candles"),
      quotes: count("quotes"),
      snapshots: count("snapshots"),
      syncRuns: count("sync_runs"),
      lastFetchedAt: fetched?.latest ? String(fetched.latest) : null,
    };
  }

  /**
   * SQLite's `PRAGMA data_version`: it changes whenever ANOTHER connection
   * (e.g. a CLI sync) commits to the database; this connection's own writes
   * do not change it. Cheap enough to poll per request to decide whether a
   * cached derivation must re-check `summary()`.
   */
  dataVersion(): number {
    const row = this.db.prepare("PRAGMA data_version").get();
    return Number(row?.data_version ?? 0);
  }

  /**
   * The newest market timestamp actually stored, not the time of the last
   * import. A successful import of old files must not look like fresh data.
   */
  /**
   * Newest stored *price* timestamp (candles and quotes). Snapshots are left
   * out on purpose: news, IPO lists and profiles carry their fetch time, and a
   * fresh news fetch on a weekend must not make the last session look current.
   */
  latestMarketAsOf(providerId?: string): string | null {
    const filter = providerId ? "WHERE provider_id = ?" : "";
    const params = providerId ? [providerId] : [];
    const row = this.db
      .prepare(
        `SELECT MAX(as_of) AS latest FROM (
           SELECT provider_id, as_of FROM candles WHERE as_of IS NOT NULL
           UNION ALL SELECT provider_id, as_of FROM quotes WHERE as_of IS NOT NULL
         ) ${filter}`,
      )
      .get(...params);
    return row?.latest ? String(row.latest) : null;
  }

  getWatchlist(): string[] {
    return this.db
      .prepare(`SELECT symbol FROM watchlist ORDER BY symbol`)
      .all()
      .map((row) => String(row.symbol));
  }

  addToWatchlist(symbol: string): void {
    this.db
      .prepare(
        `INSERT INTO watchlist (symbol, added_at) VALUES (?, ?)
         ON CONFLICT (symbol) DO NOTHING`,
      )
      .run(symbol.toUpperCase(), new Date().toISOString());
  }

  removeFromWatchlist(symbol: string): void {
    this.db
      .prepare(`DELETE FROM watchlist WHERE symbol = ?`)
      .run(symbol.toUpperCase());
  }

  /**
   * Execute all writes atomically. Provider reads happen before this call, so
   * a failure cannot leave a half-imported symbol set behind.
   */
  runInTransaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // The transaction may already have been rolled back by SQLite.
      }
      throw error;
    }
  }

  recordImportAudit(entry: NewImportAudit): number {
    const result = this.db
      .prepare(
        `INSERT INTO import_audit (
          sync_run_id, provider_id, started_at, finished_at, status, files,
          counts, warnings, failed_symbols
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.syncRunId ?? null,
        entry.providerId,
        entry.startedAt,
        entry.finishedAt,
        entry.status,
        JSON.stringify(entry.files),
        JSON.stringify(entry.counts),
        JSON.stringify(entry.warnings),
        JSON.stringify(entry.failedSymbols),
      );
    return Number(result.lastInsertRowid);
  }

  getImportAudit(limit = 20): ImportAuditEntry[] {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    return this.db
      .prepare(
        `SELECT * FROM import_audit ORDER BY id DESC LIMIT ${safeLimit}`,
      )
      .all()
      .map((row) => ({
        id: Number(row.id),
        syncRunId:
          row.sync_run_id === null ? null : Number(row.sync_run_id),
        providerId: String(row.provider_id),
        startedAt: String(row.started_at),
        finishedAt: String(row.finished_at),
        status: String(row.status),
        files: JSON.parse(String(row.files)) as string[],
        counts: JSON.parse(String(row.counts)) as Record<string, number>,
        warnings: JSON.parse(String(row.warnings)) as string[],
        failedSymbols: JSON.parse(String(row.failed_symbols)) as string[],
      }));
  }

  beginSync(providerId: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO sync_runs (provider_id, started_at, status)
         VALUES (?, ?, 'running')`,
      )
      .run(providerId, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  finishSync(
    id: number,
    status: "ok" | "partial" | "failed",
    detail?: string,
  ): void {
    this.db
      .prepare(
        `UPDATE sync_runs
         SET finished_at = ?, status = ?, detail = ?
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), status, detail ?? null, id);
  }
}

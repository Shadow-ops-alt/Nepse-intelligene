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
      data: {
        symbol: String(row.symbol),
        timeframe: String(row.timeframe) as Candle["timeframe"],
        timestamp: String(row.timestamp),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
        ...(row.turnover === null ? {} : { turnover: Number(row.turnover) }),
        ...(row.trades === null ? {} : { trades: Number(row.trades) }),
        adjusted: Number(row.adjusted) === 1,
        ...(row.adjustment_factor === null
          ? {}
          : { adjustmentFactor: Number(row.adjustment_factor) }),
      },
      provenance: this.provenanceFromRow(row),
    }));
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
           symbol, side, quantity, price, fees, traded_at, notes, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

  getSnapshot<T>(providerId: string, capability: string, naturalKey: string): T | undefined {
    return this.getSnapshotWithProvenance<T>(
      providerId,
      capability,
      naturalKey,
    )?.data;
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
   * The newest market timestamp actually stored, not the time of the last
   * import. A successful import of old files must not look like fresh data.
   */
  latestMarketAsOf(providerId?: string): string | null {
    const filter = providerId ? "WHERE provider_id = ?" : "";
    const params = providerId ? [providerId] : [];
    const row = this.db
      .prepare(
        `SELECT MAX(as_of) AS latest FROM (
           SELECT provider_id, as_of FROM candles WHERE as_of IS NOT NULL
           UNION ALL SELECT provider_id, as_of FROM quotes WHERE as_of IS NOT NULL
           UNION ALL SELECT provider_id, as_of FROM snapshots WHERE as_of IS NOT NULL
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

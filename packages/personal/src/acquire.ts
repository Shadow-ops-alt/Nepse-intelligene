import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse } from "csv-parse/sync";

/**
 * Explicit acquisition + normalization for the public `nepal-market-data`
 * archive.
 *
 * The archive is MIT-licensed code and data, but its figures are scraped from
 * public NEPSE/ShareSansar pages. They are therefore imported as UNVERIFIED
 * free-source data, never as licensed or production-ready data.
 *
 * This module does not scrape NEPSE. It reads a public git archive that its
 * maintainer updates once per trading day, records the exact commit, and
 * converts the raw files into the canonical CSV layout the app already reads.
 */

export const NEPSE_SOURCE_ID = "binayabaral/nepal-market-data";
export const NEPSE_SOURCE_URL =
  "https://github.com/binayabaral/nepal-market-data.git";
export const NEPSE_SOURCE_LICENCE = "MIT";
export const NEPSE_SOURCE_ATTRIBUTION = [
  "binayabaral/nepal-market-data (MIT): compiled public NEPSE OHLC/index archive",
  "sharesansar.com: daily NEPSE prices and index history (upstream)",
  "Aabishkar2/nepse-data: historical NEPSE OHLC (upstream)",
];
export const NEPSE_SOURCE_DISCLAIMER =
  "Unofficial, best-effort archive assembled by automated scraping of public sources. No guarantee of accuracy, completeness, or timeliness. Not for trading decisions without independent verification against NEPSE.";

export const NORMALIZER_VERSION = "1.0.0";

const OHLC_HEADER =
  "symbol,timeframe,timestamp,date,open,high,low,close,volume,turnover,trades,adjusted,adjustmentFactor";
const COMPANY_HEADER = "id,symbol,name,sector,instrumentType,status";
const SECURITY_HEADER =
  "id,symbol,name,companyId,instrumentType,isPromoter,status";
const INDEX_HEADER = "symbol,name,isSector";
const QUOTE_HEADER =
  "symbol,ltp,change,changePercent,open,high,low,previousClose,volume,turnover,trades,session,asOf";

const INSTRUMENT_TYPES: Record<string, string> = {
  ordinary: "Equity",
  debenture: "Debenture",
  mutual_fund: "Mutual Fund",
  promoter_share: "Promoter Share",
  government_bond: "Government Bond",
};

const STATUSES: Record<string, "active" | "suspended" | "delisted" | "unknown"> =
  {
    listed: "active",
    merged: "delisted",
    suspended: "suspended",
  };

const execFileAsync = promisify(execFile);

type Row = Record<string, string>;

export interface AcquireOptions {
  /** Directory the app reads: companies.csv, ohlc/, indices/, quotes.csv. */
  outputDir: string;
  /** Git clone cache. Defaults to <outputDir>/source/.cache. */
  cacheDir?: string;
  /** Use an existing checkout instead of cloning/fetching. */
  sourceDir?: string;
  sourceUrl?: string;
  ref?: string;
  /** Ignore the fetch cache and refresh from the remote. */
  force?: boolean;
  /** Minimum minutes between remote fetches. Default 30. */
  maxAgeMinutes?: number;
  now?: Date;
}

export interface AcquireTotals {
  symbols: number;
  companies: number;
  ordinaryListed: number;
  ohlcFiles: number;
  priceRows: number;
  excludedRows: number;
  indexRows: number;
  indexExcludedRows: number;
  quotes: number;
  earliest: string | null;
  latest: string | null;
  latestSession: string | null;
}

export interface AcquireResult {
  sourceId: string;
  sourceUrl: string;
  commit: string;
  retrievedAt: string;
  cached: boolean;
  dataDir: string;
  snapshotDir: string;
  reportPath: string;
  totals: AcquireTotals;
  files: string[];
  warnings: string[];
}

interface RepoState {
  repoDir: string;
  commit: string;
  retrievedAt: string;
  cached: boolean;
}

interface MasterRow {
  symbol: string;
  name: string;
  sourceCategory: string;
  instrumentType: string;
  sector: string;
  status: string;
}

interface PriceRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  perChange: string;
}

interface ExcludedRow {
  symbol: string;
  row: number;
  date: string;
  reason: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
}

interface SeriesDiff {
  symbol: string;
  added: number;
  changed: number;
  removed: number;
  samples: string[];
}

interface ProviderHealth {
  sourceId: string;
  sourceUrl: string;
  status: "ok" | "cached" | "error";
  checkedAt: string;
  retrievedAt: string | null;
  lastSuccessAt: string | null;
  commit: string | null;
  consecutiveFailures: number;
  error?: string;
  cached?: boolean;
  totals?: AcquireTotals;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(values: Array<string | number | null | undefined>): string {
  return values.map(csvCell).join(",");
}

function readRows(path: string): Row[] {
  if (!existsSync(path)) return [];
  return parse(readFileSync(path, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  }) as Row[];
}

function text(row: Row, key: string): string {
  return (row[key] ?? "").trim();
}

function parseNumber(raw: string | undefined): number | null {
  const cleaned = (raw ?? "").trim().replaceAll(",", "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function ohlcInvariant(row: {
  open: number;
  high: number;
  low: number;
  close: number;
}): boolean {
  return (
    row.high >= row.low &&
    row.high >= Math.max(row.open, row.close) &&
    row.low <= Math.min(row.open, row.close)
  );
}

async function git(
  args: string[],
  cwd: string | undefined,
  attempts = 3,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await execFileAsync("git", args, {
        ...(cwd ? { cwd } : {}),
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
      });
      return result.stdout.trim();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await delay(1_000 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`git ${args.join(" ")} failed`);
}

async function tryGit(args: string[], cwd: string): Promise<string | null> {
  try {
    return await git(args, cwd, 1);
  } catch {
    return null;
  }
}

function sanitizePathPart(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "unversioned";
}

function healthPath(outputDir: string): string {
  return join(outputDir, "reports", "provider-health.json");
}

function readHealth(path: string): ProviderHealth | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ProviderHealth;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function prepareRepo(
  options: AcquireOptions,
  now: Date,
): Promise<RepoState> {
  const sourceUrl = options.sourceUrl ?? NEPSE_SOURCE_URL;
  const ref = options.ref ?? "main";

  if (options.sourceDir) {
    const repoDir = resolve(options.sourceDir);
    if (!existsSync(join(repoDir, "data", "reference", "nepse-symbols.csv"))) {
      throw new Error(
        `source checkout is missing data/reference/nepse-symbols.csv: ${repoDir}`,
      );
    }
    const commit =
      (await tryGit(["-C", repoDir, "rev-parse", "HEAD"], repoDir)) ??
      `unversioned-${sha256File(
        join(repoDir, "data", "reference", "nepse-symbols.csv"),
      ).slice(0, 8)}`;
    return {
      repoDir,
      commit,
      retrievedAt: now.toISOString(),
      cached: false,
    };
  }

  const cacheDir = resolve(options.cacheDir ?? join(options.outputDir, "source", ".cache"));
  const repoDir = join(cacheDir, "repo");
  const markerPath = join(cacheDir, "last-fetch.json");
  const maxAgeMs = Math.max(0, options.maxAgeMinutes ?? 30) * 60_000;

  if (!options.force && existsSync(markerPath) && existsSync(repoDir)) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
        checkedAt?: string;
        commit?: string;
        sourceUrl?: string;
        ref?: string;
      };
      const checkedAt = marker.checkedAt ? new Date(marker.checkedAt) : null;
      const age = checkedAt ? now.getTime() - checkedAt.getTime() : Infinity;
      if (
        checkedAt &&
        age >= 0 &&
        age <= maxAgeMs &&
        marker.commit &&
        marker.sourceUrl === sourceUrl &&
        marker.ref === ref
      ) {
        const head = await tryGit(
          ["-C", repoDir, "rev-parse", "HEAD"],
          repoDir,
        );
        if (head === marker.commit) {
          return {
            repoDir,
            commit: marker.commit,
            retrievedAt: checkedAt.toISOString(),
            cached: true,
          };
        }
      }
    } catch {
      // A damaged cache marker is not fatal; refresh below.
    }
  }

  mkdirSync(cacheDir, { recursive: true });

  if (existsSync(join(repoDir, ".git"))) {
    await git(
      ["-C", repoDir, "fetch", "--depth", "1", "origin", ref],
      repoDir,
    );
    await git(["-C", repoDir, "reset", "--hard", "FETCH_HEAD"], repoDir);
  } else {
    rmSync(repoDir, { recursive: true, force: true });
    await git(
      [
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "--branch",
        ref,
        sourceUrl,
        repoDir,
      ],
      undefined,
    );
  }

  const commit = await git(["-C", repoDir, "rev-parse", "HEAD"], repoDir);
  const retrievedAt = now.toISOString();
  writeJson(markerPath, {
    checkedAt: retrievedAt,
    commit,
    sourceUrl,
    ref,
  });
  return { repoDir, commit, retrievedAt, cached: false };
}

function ensureSnapshot(
  repoDir: string,
  outputDir: string,
  commit: string,
): { snapshotDir: string; masterSha: string; indexSha: string; symbolFiles: number } {
  const masterPath = join(repoDir, "data", "reference", "nepse-symbols.csv");
  const indexSource = join(repoDir, "data", "nepse", "NEPSE_INDEX.csv");
  const nepseDir = join(repoDir, "data", "nepse");
  if (!existsSync(masterPath)) {
    throw new Error(`missing symbol master: ${masterPath}`);
  }
  const masterSha = sha256File(masterPath);
  const indexSha = existsSync(indexSource) ? sha256File(indexSource) : "missing";
  const symbolFiles = existsSync(nepseDir)
    ? readdirSync(nepseDir).filter((name) => name.endsWith(".csv")).length
    : 0;

  const snapshotDir = join(
    outputDir,
    "source",
    "binayabaral",
    sanitizePathPart(commit),
  );
  const markerPath = join(snapshotDir, ".complete.json");
  if (existsSync(markerPath)) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
        masterSha?: string;
        indexSha?: string;
        symbolFiles?: number;
      };
      if (
        marker.masterSha === masterSha &&
        marker.indexSha === indexSha &&
        marker.symbolFiles === symbolFiles
      ) {
        return { snapshotDir, masterSha, indexSha, symbolFiles };
      }
    } catch {
      // Fall through and rebuild the snapshot.
    }
  }

  rmSync(snapshotDir, { recursive: true, force: true });
  mkdirSync(snapshotDir, { recursive: true });
  if (existsSync(nepseDir)) {
    cpSync(nepseDir, join(snapshotDir, "nepse"), { recursive: true });
  }
  copyFileSync(masterPath, join(snapshotDir, "nepse-symbols.csv"));
  for (const name of ["LICENSE", "README.md"]) {
    const from = join(repoDir, name);
    if (existsSync(from)) copyFileSync(from, join(snapshotDir, name));
  }
  writeJson(markerPath, {
    sourceId: NEPSE_SOURCE_ID,
    commit,
    masterSha,
    indexSha,
    symbolFiles,
    snapshotAt: new Date().toISOString(),
  });
  return { snapshotDir, masterSha, indexSha, symbolFiles };
}

function parseMaster(snapshotDir: string): MasterRow[] {
  const raw = readRows(join(snapshotDir, "nepse-symbols.csv"));
  if (raw.length === 0) {
    throw new Error("symbol master is empty");
  }
  const rows: MasterRow[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  raw.forEach((row, index) => {
    const line = index + 2;
    const symbol = text(row, "symbol").toUpperCase();
    const name = text(row, "name");
    if (!symbol) errors.push(`row ${line}: symbol is blank`);
    else if (!/^[A-Z0-9._-]{1,24}$/.test(symbol)) {
      errors.push(`row ${line}: invalid symbol ${symbol}`);
    }
    if (!name) errors.push(`row ${line}: name is blank`);
    if (symbol && seen.has(symbol)) {
      errors.push(`row ${line}: duplicate symbol ${symbol}`);
    }
    seen.add(symbol);
    rows.push({
      symbol,
      name,
      sourceCategory: text(row, "source_category"),
      instrumentType: text(row, "instrument_type") || "unknown",
      sector: text(row, "sector"),
      status: text(row, "status") || "unknown",
    });
  });
  if (errors.length > 0) {
    throw new Error(`invalid symbol master: ${errors.slice(0, 6).join("; ")}`);
  }
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

interface ParseSeriesResult {
  rows: PriceRow[];
  excluded: ExcludedRow[];
  blankVolume: number;
}

function parseSeries(
  filePath: string,
  symbol: string,
  options: { allowBlankVolume: boolean },
): ParseSeriesResult {
  const raw = readRows(filePath);
  const rows: PriceRow[] = [];
  const excluded: ExcludedRow[] = [];
  const seenDates = new Set<string>();
  let blankVolume = 0;

  raw.forEach((row, index) => {
    const line = index + 2;
    const date = text(row, "published_date");
    const rawOpen = text(row, "open");
    const rawHigh = text(row, "high");
    const rawLow = text(row, "low");
    const rawClose = text(row, "close");
    const rawVolume = text(row, "traded_quantity");
    const rawTurnover = text(row, "traded_amount");
    const base = {
      symbol,
      row: line,
      date,
      open: rawOpen,
      high: rawHigh,
      low: rawLow,
      close: rawClose,
      volume: rawVolume,
      turnover: rawTurnover,
    };
    const exclude = (reason: string) => excluded.push({ ...base, reason });

    if (!validDate(date)) {
      exclude("invalid trading date");
      return;
    }
    if (seenDates.has(date)) {
      exclude("duplicate trading date");
      return;
    }
    seenDates.add(date);

    const open = parseNumber(rawOpen);
    const high = parseNumber(rawHigh);
    const low = parseNumber(rawLow);
    const close = parseNumber(rawClose);
    if (open === null || high === null || low === null || close === null) {
      exclude("non-numeric price");
      return;
    }
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
      exclude("non-positive price");
      return;
    }
    if (!ohlcInvariant({ open, high, low, close })) {
      exclude("OHLC invariant violated");
      return;
    }

    let volume = 0;
    if (rawVolume === "") {
      blankVolume += 1;
      if (!options.allowBlankVolume) {
        exclude("volume is blank");
        return;
      }
    } else {
      const parsed = parseNumber(rawVolume);
      if (parsed === null || parsed < 0) {
        exclude("invalid volume");
        return;
      }
      volume = parsed;
    }

    let turnover = 0;
    if (rawTurnover !== "") {
      const parsed = parseNumber(rawTurnover);
      if (parsed === null || parsed < 0) {
        exclude("invalid turnover");
        return;
      }
      turnover = parsed;
    }

    rows.push({
      date,
      open,
      high,
      low,
      close,
      volume,
      turnover,
      perChange: text(row, "per_change"),
    });
  });

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { rows, excluded, blankVolume };
}

function ohlcContent(symbol: string, rows: PriceRow[]): string {
  const lines = [OHLC_HEADER];
  for (const row of rows) {
    lines.push(
      csvLine([
        symbol,
        "1day",
        `${row.date}T15:00:00+05:45`,
        row.date,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume,
        row.turnover,
        "",
        "false",
        "1.0",
      ]),
    );
  }
  return `${lines.join("\n")}\n`;
}

function existingSeries(path: string): Map<string, string> | null {
  if (!existsSync(path)) return null;
  const map = new Map<string, string>();
  for (const row of readRows(path)) {
    const date = text(row, "date") || text(row, "timestamp").slice(0, 10);
    if (!date) continue;
    map.set(
      date,
      [
        text(row, "open"),
        text(row, "high"),
        text(row, "low"),
        text(row, "close"),
        text(row, "volume"),
        text(row, "turnover"),
      ].join("|"),
    );
  }
  return map;
}

function diffSeries(
  symbol: string,
  path: string,
  rows: PriceRow[],
): SeriesDiff {
  const existing = existingSeries(path);
  if (existing === null) {
    return {
      symbol,
      added: rows.length,
      changed: 0,
      removed: 0,
      samples: [],
    };
  }
  let added = 0;
  let changed = 0;
  let removed = 0;
  const samples: string[] = [];
  const next = new Map<string, string>();
  for (const row of rows) {
    const value = [
      row.open,
      row.high,
      row.low,
      row.close,
      row.volume,
      row.turnover,
    ].join("|");
    next.set(row.date, value);
    const previous = existing.get(row.date);
    if (previous === undefined) {
      added += 1;
      if (samples.length < 10) samples.push(`${symbol} ${row.date}: added`);
    } else if (previous !== value) {
      changed += 1;
      if (samples.length < 10) {
        samples.push(`${symbol} ${row.date}: ${previous} -> ${value}`);
      }
    }
  }
  for (const date of existing.keys()) {
    if (!next.has(date)) {
      removed += 1;
      if (samples.length < 10) samples.push(`${symbol} ${date}: removed`);
    }
  }
  return { symbol, added, changed, removed, samples };
}

/**
 * Fetch (or reuse) the public archive and write the canonical CSV layout into
 * `outputDir`. Existing canonical files are replaced atomically per file, but
 * every changed/removed history row is written to a diff report first.
 */
export async function acquireNepseSource(
  options: AcquireOptions,
): Promise<AcquireResult> {
  const now = options.now ?? new Date();
  const outputDir = resolve(options.outputDir);
  const reportsDir = join(outputDir, "reports");
  const healthFile = healthPath(outputDir);
  const sourceUrl = options.sourceUrl ?? NEPSE_SOURCE_URL;
  const previousHealth = readHealth(healthFile);

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });

  try {
    const repo = await prepareRepo({ ...options, outputDir }, now);
    const snapshot = ensureSnapshot(repo.repoDir, outputDir, repo.commit);
    const master = parseMaster(snapshot.snapshotDir);
    const masterBySymbol = new Map(master.map((row) => [row.symbol, row]));

    const warnings: string[] = [];
    const exclusionReasons = new Map<string, number>();
    const exclusionsBySymbol = new Map<string, number>();
    const excludedRows: ExcludedRow[] = [];
    const series = new Map<string, PriceRow[]>();
    const filesToWrite = new Map<string, string>();
    const files: string[] = [];
    const changes: SeriesDiff[] = [];
    const instruments = new Map<string, number>();
    const statuses = new Map<string, number>();

    for (const company of master) {
      instruments.set(
        company.instrumentType,
        (instruments.get(company.instrumentType) ?? 0) + 1,
      );
      statuses.set(company.status, (statuses.get(company.status) ?? 0) + 1);
    }

    const companyLines = [COMPANY_HEADER];
    const securityLines = [SECURITY_HEADER];
    for (const company of master) {
      const instrumentType =
        INSTRUMENT_TYPES[company.instrumentType] ??
        (company.instrumentType || "Unknown");
      const status = STATUSES[company.status] ?? "unknown";
      const sector = company.sector || "Unclassified";
      companyLines.push(
        csvLine([
          company.symbol,
          company.symbol,
          company.name,
          sector,
          instrumentType,
          status,
        ]),
      );
      securityLines.push(
        csvLine([
          company.symbol,
          company.symbol,
          company.name,
          company.symbol,
          instrumentType,
          company.instrumentType === "promoter_share" ? "true" : "false",
          status,
        ]),
      );
    }
    filesToWrite.set("companies.csv", `${companyLines.join("\n")}\n`);
    filesToWrite.set("securities.csv", `${securityLines.join("\n")}\n`);
    files.push("companies.csv", "securities.csv");

    let priceRows = 0;
    let earliest: string | null = null;
    let latest: string | null = null;
    let ohlcFiles = 0;

    for (const company of master) {
      const filePath = join(
        snapshot.snapshotDir,
        "nepse",
        `${company.symbol}.csv`,
      );
      if (!existsSync(filePath)) {
        warnings.push(
          `${company.symbol}: source price file is missing; an empty history was written`,
        );
        series.set(company.symbol, []);
      } else {
        const parsed = parseSeries(filePath, company.symbol, {
          allowBlankVolume: false,
        });
        series.set(company.symbol, parsed.rows);
        for (const row of parsed.excluded) {
          excludedRows.push(row);
          exclusionReasons.set(
            row.reason,
            (exclusionReasons.get(row.reason) ?? 0) + 1,
          );
          exclusionsBySymbol.set(
            company.symbol,
            (exclusionsBySymbol.get(company.symbol) ?? 0) + 1,
          );
        }
      }
      const rows = series.get(company.symbol) ?? [];
      priceRows += rows.length;
      if (rows.length > 0) {
        ohlcFiles += 1;
        const first = rows[0]!.date;
        const last = rows.at(-1)!.date;
        if (!earliest || first < earliest) earliest = first;
        if (!latest || last > latest) latest = last;
      }
      const relative = `ohlc/${company.symbol}.csv`;
      filesToWrite.set(relative, ohlcContent(company.symbol, rows));
      files.push(relative);
      const diff = diffSeries(company.symbol, join(outputDir, relative), rows);
      if (diff.changed > 0 || diff.removed > 0) {
        changes.push(diff);
      }
    }

    // Index history. The source intentionally leaves traded_quantity blank:
    // an index has no share count. The canonical candle schema requires a
    // non-negative volume, so it is stored as 0 and labelled as not published.
    const indexSource = join(snapshot.snapshotDir, "nepse", "NEPSE_INDEX.csv");
    let indexRows: PriceRow[] = [];
    let indexExcluded = 0;
    if (existsSync(indexSource)) {
      const parsed = parseSeries(indexSource, "NEPSE", {
        allowBlankVolume: true,
      });
      indexRows = parsed.rows;
      indexExcluded = parsed.excluded.length;
      for (const row of parsed.excluded) {
        excludedRows.push(row);
        exclusionReasons.set(
          row.reason,
          (exclusionReasons.get(row.reason) ?? 0) + 1,
        );
      }
      if (parsed.blankVolume > 0) {
        warnings.push(
          `NEPSE index: ${parsed.blankVolume} rows have no published share volume; volume is stored as 0 (not applicable for an index)`,
        );
      }
      filesToWrite.set("indices/NEPSE.csv", ohlcContent("NEPSE", indexRows));
      files.push("indices/NEPSE.csv");
      const diff = diffSeries(
        "NEPSE",
        join(outputDir, "indices", "NEPSE.csv"),
        indexRows,
      );
      if (diff.changed > 0 || diff.removed > 0) {
        changes.push(diff);
      }
    } else {
      warnings.push(
        "NEPSE_INDEX.csv is missing; index history is unavailable (no index values were derived)",
      );
    }

    // Only the headline index is published. Sector sub-indices are not
    // available, so none are invented.
    filesToWrite.set(
      "indices.csv",
      `${[INDEX_HEADER, csvLine(["NEPSE", "NEPSE Index", "false"])].join("\n")}\n`,
    );
    files.push("indices.csv");

    // Quotes = latest end-of-day session for ordinary listed equities. This is
    // deliberately not labelled live. Only instruments whose latest valid row
    // is that session and which have a previous valid close are included.
    let latestSession: string | null = null;
    for (const company of master) {
      if (company.instrumentType !== "ordinary" || company.status !== "listed") {
        continue;
      }
      const rows = series.get(company.symbol) ?? [];
      const last = rows.at(-1)?.date;
      if (last && (!latestSession || last > latestSession)) {
        latestSession = last;
      }
    }

    const quoteLines = [QUOTE_HEADER];
    let quoteMismatches = 0;
    const quoteMismatchSamples: string[] = [];
    if (latestSession) {
      for (const company of master) {
        if (
          company.instrumentType !== "ordinary" ||
          company.status !== "listed"
        ) {
          continue;
        }
        const rows = series.get(company.symbol) ?? [];
        if (rows.length < 2) continue;
        const last = rows.at(-1)!;
        if (last.date !== latestSession) continue;
        const previous = rows.at(-2)!;
        if (previous.close <= 0) continue;
        const change = round(last.close - previous.close);
        const changePercent = round((change / previous.close) * 100);
        const sourceChange = parseNumber(last.perChange);
        if (
          sourceChange !== null &&
          Math.abs(sourceChange - changePercent) > 0.02
        ) {
          quoteMismatches += 1;
          if (quoteMismatchSamples.length < 5) {
            quoteMismatchSamples.push(
              `${company.symbol}: source ${sourceChange}% vs computed ${changePercent}%`,
            );
          }
        }
        quoteLines.push(
          csvLine([
            company.symbol,
            last.close,
            change,
            changePercent,
            last.open,
            last.high,
            last.low,
            previous.close,
            last.volume,
            last.turnover,
            "",
            "eod",
            `${last.date}T15:00:00+05:45`,
          ]),
        );
      }
    }
    filesToWrite.set("quotes.csv", `${quoteLines.join("\n")}\n`);
    files.push("quotes.csv");

    if (quoteMismatches > 0) {
      warnings.push(
        `${quoteMismatches} latest-session per_change values disagree with the computed previous-close change by more than 0.02 percentage points; the app stores the computed change, not the source field`,
      );
    }

    // Detect canonical files that the source no longer produces. They are
    // reported, never deleted: they may be prior valid history.
    const expectedSymbols = new Set(master.map((row) => row.symbol));
    const existingOhlcDir = join(outputDir, "ohlc");
    const orphanOhlcFiles = existsSync(existingOhlcDir)
      ? readdirSync(existingOhlcDir)
          .filter((name) => name.endsWith(".csv"))
          .filter((name) => !expectedSymbols.has(name.slice(0, -4)))
          .sort()
      : [];
    if (orphanOhlcFiles.length > 0) {
      warnings.push(
        `${orphanOhlcFiles.length} existing ohlc files are not in the current source master; they were left untouched`,
      );
    }

    // Write all canonical files through a staging directory, then rename each
    // into place. A failed run cannot leave a half-written CSV.
    const stageDir = join(
      outputDir,
      `.staging-${process.pid}-${Date.now().toString(36)}`,
    );
    try {
      for (const [relative, content] of filesToWrite) {
        const target = join(stageDir, relative);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, "utf8");
      }
      for (const relative of filesToWrite.keys()) {
        const from = join(stageDir, relative);
        const to = join(outputDir, relative);
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
      }
    } finally {
      rmSync(stageDir, { recursive: true, force: true });
    }

    const totals: AcquireTotals = {
      symbols: master.length,
      companies: master.length,
      ordinaryListed: master.filter(
        (row) => row.instrumentType === "ordinary" && row.status === "listed",
      ).length,
      ohlcFiles,
      priceRows,
      excludedRows: excludedRows.length,
      indexRows: indexRows.length,
      indexExcludedRows: indexExcluded,
      quotes: quoteLines.length - 1,
      earliest,
      latest,
      latestSession,
    };

    const changedRows = changes.reduce((sum, diff) => sum + diff.changed, 0);
    const removedRows = changes.reduce((sum, diff) => sum + diff.removed, 0);
    if (changedRows > 0 || removedRows > 0) {
      warnings.push(
        `canonical history changed: ${changedRows} row(s) changed and ${removedRows} row(s) removed versus the previous canonical files; see reports/history-changes.json`,
      );
    }

    const report = {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      source: {
        id: NEPSE_SOURCE_ID,
        url: sourceUrl,
        commit: repo.commit,
        retrievedAt: repo.retrievedAt,
        licence: NEPSE_SOURCE_LICENCE,
        classification: "UNVERIFIED",
        attribution: NEPSE_SOURCE_ATTRIBUTION,
        disclaimer: NEPSE_SOURCE_DISCLAIMER,
        snapshotDir: snapshot.snapshotDir,
        masterSha256: snapshot.masterSha,
        indexSha256: snapshot.indexSha,
        symbolFiles: snapshot.symbolFiles,
      },
      normalizer: {
        name: "nepse-source-normalizer",
        version: NORMALIZER_VERSION,
      },
      totals,
      instruments: Object.fromEntries(
        [...instruments.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
      statuses: Object.fromEntries(
        [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
      quotesBasis:
        "latest end-of-day close; not a live quote; change computed from the previous valid close",
      unavailable: {
        marketSummary:
          "transactions/scrips totals are not published by this source; market-summary.csv is not written and the UI keeps the summary unavailable",
        sectorPerformance:
          "sector sub-index values are not published by this source; sector-performance.csv is not written",
        floorsheet: "not available from this source",
        fundamentals: "not available from this source",
        corporateActions: "not available from this source",
      },
      exclusions: {
        total: excludedRows.length,
        reasons: Object.fromEntries(
          [...exclusionReasons.entries()].sort(([a], [b]) => a.localeCompare(b)),
        ),
        bySymbol: Object.fromEntries(
          [...exclusionsBySymbol.entries()].sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ),
        rowsFile: "reports/excluded-rows.csv",
      },
      quoteMismatches: {
        count: quoteMismatches,
        samples: quoteMismatchSamples,
      },
      historyChanges: {
        changedRows,
        removedRows,
        files: changes,
        note:
          changedRows + removedRows === 0
            ? "no changed or removed rows versus the previous canonical files"
            : "changed/removed rows are reported; nothing was deleted from the store",
      },
      orphanOhlcFiles,
      warnings,
      files,
    };

    writeJson(join(reportsDir, "import-report.json"), report);
    writeJson(join(outputDir, "source", "manifest.json"), report.source);
    writeJson(join(reportsDir, "history-changes.json"), report.historyChanges);

    const excludedLines = [
      "symbol,row,date,reason,open,high,low,close,volume,turnover",
    ];
    for (const row of excludedRows) {
      excludedLines.push(
        csvLine([
          row.symbol,
          row.row,
          row.date,
          row.reason,
          row.open,
          row.high,
          row.low,
          row.close,
          row.volume,
          row.turnover,
        ]),
      );
    }
    writeFileSync(
      join(reportsDir, "excluded-rows.csv"),
      `${excludedLines.join("\n")}\n`,
      "utf8",
    );

    const lastSuccessAt = now.toISOString();
    writeJson(healthFile, {
      sourceId: NEPSE_SOURCE_ID,
      sourceUrl,
      status: repo.cached ? "cached" : "ok",
      checkedAt: now.toISOString(),
      retrievedAt: repo.retrievedAt,
      lastSuccessAt,
      commit: repo.commit,
      consecutiveFailures: 0,
      cached: repo.cached,
      totals,
    } satisfies ProviderHealth);

    return {
      sourceId: NEPSE_SOURCE_ID,
      sourceUrl,
      commit: repo.commit,
      retrievedAt: repo.retrievedAt,
      cached: repo.cached,
      dataDir: outputDir,
      snapshotDir: snapshot.snapshotDir,
      reportPath: join(reportsDir, "import-report.json"),
      totals,
      files,
      warnings,
    };
  } catch (error) {
    const failure = message(error);
    writeJson(healthFile, {
      sourceId: NEPSE_SOURCE_ID,
      sourceUrl,
      status: "error",
      checkedAt: now.toISOString(),
      retrievedAt: previousHealth?.retrievedAt ?? null,
      lastSuccessAt: previousHealth?.lastSuccessAt ?? null,
      commit: previousHealth?.commit ?? null,
      consecutiveFailures: (previousHealth?.consecutiveFailures ?? 0) + 1,
      error: failure,
    } satisfies ProviderHealth);
    throw error;
  }
}

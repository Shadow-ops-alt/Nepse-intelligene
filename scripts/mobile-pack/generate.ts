#!/usr/bin/env node
/**
 * NEPSE Terminal mobile data pack generator.
 *
 * Captures the JSON the standalone Android app serves from a bundled pack:
 * end-of-day candles for every symbol, the screener/signals computed by the
 * existing API, fundamentals, corporate actions, news, IPOs and the latest
 * floorsheet.
 *
 * The script either talks to an already running API (`--api-url`) or starts
 * the existing API itself on a temporary copy of the starter database. It
 * never modifies the source packages and never writes to the app database.
 *
 * Usage:
 *   npx --yes tsx scripts/mobile-pack/generate.ts \
 *     --api-url http://127.0.0.1:4310
 *
 *   npx --yes tsx scripts/mobile-pack/generate.ts \
 *     --db /tmp/nepse-v3/personal.db --data-dir /tmp/nepse-v3/data
 *
 * Options:
 *   --api-url <url>     Use an API that is already running.
 *   --db <path>         Database to use when starting the internal API.
 *                       Default: a temporary copy of
 *                       apps/desktop/resources/personal.db.gz
 *   --data-dir <path>   Data folder for company events (optional).
 *   --out <dir>         Output directory. Default: apps/mobile/assets/pack
 *   --years <n>         Candle window in years. Default: 5
 *   --version <text>    Pack version. Default: root package.json version
 *   --zip <path>        Also write a zip of the pack, with manifest.json at
 *                       the archive root, for release upload.
 *   --keep-temp         Keep the temporary database (debugging).
 */

import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { execFileSync } from "node:child_process";

// The API source is imported directly so this script runs the exact server
// the desktop app uses, without a separate install step. tsx compiles it.
import { createApiServer } from "../../packages/api/src/app";

interface Options {
  apiUrl: string | null;
  db: string | null;
  dataDir: string | null;
  out: string;
  years: number;
  version: string;
  zip: string | null;
  keepTemp: boolean;
}

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const DEFAULT_OUT = join(ROOT, "apps/mobile/assets/pack");
const STARTER_DB = join(ROOT, "apps/desktop/resources/personal.db.gz");

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apiUrl: null,
    db: null,
    dataDir: null,
    out: DEFAULT_OUT,
    years: 5,
    version: JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
      .version,
    zip: null,
    keepTemp: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = (): string => {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${arg} needs a value`);
      }
      index += 1;
      return next;
    };
    switch (arg) {
      case "--api-url":
        options.apiUrl = value().replace(/\/+$/, "");
        break;
      case "--db":
        options.db = resolve(value());
        break;
      case "--data-dir":
        options.dataDir = resolve(value());
        break;
      case "--out":
        options.out = resolve(value());
        break;
      case "--years": {
        const years = Number(value());
        if (!Number.isFinite(years) || years <= 0) {
          throw new Error("--years must be a positive number");
        }
        options.years = years;
        break;
      }
      case "--version":
        options.version = value();
        break;
      case "--zip":
        options.zip = resolve(value());
        break;
      case "--keep-temp":
        options.keepTemp = true;
        break;
      case "--help":
      case "-h":
        console.log(readFileSync(new URL(import.meta.url).pathname, "utf8")
          .split("\n")
          .slice(1, 40)
          .join("\n"));
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }
  return options;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function bytesOf(value: string): number {
  return Buffer.byteLength(value);
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index]!, index);
      }
    })(),
  );
  await Promise.all(runners);
  return results;
}

interface ApiHandleLike {
  server: import("node:http").Server;
}

async function startInternalApi(
  options: Options,
): Promise<{ base: string; handle: ApiHandleLike; temp: string | null }> {
  let dbPath = options.db;
  let temp: string | null = null;
  if (!dbPath) {
    temp = mkdtempSync(join(tmpdir(), "nepse-pack-"));
    dbPath = join(temp, "personal.db");
    console.log(`[pack] decompressing starter database -> ${dbPath}`);
    await pipeline(
      createReadStream(STARTER_DB),
      createGunzip(),
      createWriteStream(dbPath),
    );
  }
  if (!existsSync(dbPath)) {
    throw new Error(`database not found: ${dbPath}`);
  }
  const dataDir = options.dataDir ?? join(tmpdir(), "nepse-pack-data");
  mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    DATA_EDITION: "free",
    NEPSE_LIVE: "0",
    NEPSE_AUTO_REFRESH: "0",
    PERSONAL_DATA_DIR: dataDir,
  };
  const handle = createApiServer({
    dbPath,
    dataDir,
    env,
    autoRefresh: false,
  });
  await new Promise<void>((resolveListen, reject) => {
    handle.server.once("error", reject);
    handle.server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = handle.server.address();
  if (!address || typeof address === "string") {
    throw new Error("internal API did not report a port");
  }
  return { base: `http://127.0.0.1:${address.port}`, handle, temp };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(`[pack] version ${options.version}, ${options.years} year window`);
  console.log(`[pack] output ${options.out}`);

  let base = options.apiUrl;
  let handle: ApiHandleLike | null = null;
  let temp: string | null = null;

  if (base) {
    const health = await fetch(`${base}/api/health`);
    if (!health.ok) {
      throw new Error(`API at ${base} is not healthy (${health.status})`);
    }
    console.log(`[pack] using running API at ${base}`);
  } else {
    const started = await startInternalApi(options);
    base = started.base;
    handle = started.handle;
    temp = started.temp;
    console.log(`[pack] started internal API at ${base}`);
  }

  const out = options.out;
  if (existsSync(out)) {
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(out, { recursive: true });

  const fetchOk = async (path: string): Promise<string> => {
    const response = await fetch(`${base}${path}`);
    if (!response.ok) {
      throw new Error(`GET ${path} -> ${response.status} ${response.statusText}`);
    }
    return await response.text();
  };

  const fetchOptional = async (path: string): Promise<string | null> => {
    try {
      return await fetchOk(path);
    } catch (error) {
      console.warn(`[pack] optional ${path} failed: ${String(error)}`);
      return null;
    }
  };

  const saved: Array<{ path: string; bytes: number; sha256: string }> = [];
  const save = (path: string, text: string): void => {
    writeText(join(out, path), text);
    saved.push({ path, bytes: bytesOf(text), sha256: sha256(text) });
  };

  // ---------------------------------------------------------- static API ---
  console.log("[pack] capturing API snapshots");
  const endpoints: Array<[string, string]> = [
    ["/api/meta", "api/meta.json"],
    ["/api/coverage", "api/coverage.json"],
    ["/api/companies", "api/companies.json"],
    ["/api/quotes", "api/quotes.json"],
    ["/api/summary", "api/summary.json"],
    ["/api/indices", "api/indices.json"],
    ["/api/screener", "api/screener.json"],
    ["/api/signals?lookback=5", "api/signals.json"],
    ["/api/data-quality", "api/data-quality.json"],
    ["/api/fundamentals/latest", "api/fundamentals-latest.json"],
    ["/api/news", "api/news.json"],
    ["/api/ipos", "api/ipos.json"],
    ["/api/floorsheet", "api/floorsheet.json"],
    ["/api/broker-flows", "api/broker-flows.json"],
    ["/api/mutual-funds", "api/mutual-funds.json"],
    ["/api/corporate-actions/all", "api/corporate-actions-all.json"],
    ["/api/company-events?limit=5000", "api/company-events.json"],
  ];
  for (const [endpoint, file] of endpoints) {
    const text = await fetchOptional(endpoint);
    if (text === null) continue;
    save(file, text);
    console.log(`  ${file} ${(bytesOf(text) / 1024).toFixed(0)} KB`);
  }

  const meta = JSON.parse(readFileSync(join(out, "api/meta.json"), "utf8")) as {
    providerId?: string;
    store?: { companies?: number };
  };
  const companiesPayload = JSON.parse(
    readFileSync(join(out, "api/companies.json"), "utf8"),
  ) as { companies?: Array<{ symbol?: string; status?: string }> };
  const companySymbols = [...new Set(
    (companiesPayload.companies ?? [])
      .map((company) => String(company.symbol ?? "").trim().toUpperCase())
      .filter(Boolean),
  )].sort();

  const indicesPayload = JSON.parse(
    readFileSync(join(out, "api/indices.json"), "utf8"),
  ) as { indices?: Array<{ symbol?: string; isSector?: boolean }> };
  const indexSymbols = [...new Set(
    (indicesPayload.indices ?? [])
      .map((index) => String(index.symbol ?? "").trim().toUpperCase())
      .filter(Boolean),
  )].sort();

  const dataQuality = JSON.parse(
    readFileSync(join(out, "api/data-quality.json"), "utf8"),
  ) as { latestSession?: string | null; symbols?: unknown[] };
  const latestSession = dataQuality.latestSession ?? null;

  const from = isoDate(
    new Date(Date.now() - options.years * 365.25 * 86_400_000),
  );
  console.log(
    `[pack] candles from ${from}: ${companySymbols.length} equity symbols, ` +
      `${indexSymbols.length} indices`,
  );

  // ------------------------------------------------------------- candles ---
  let candleRows = 0;
  let candleSymbols = 0;
  let candleBytes = 0;
  const equityList: string[] = [];
  await mapPool(companySymbols, 6, async (symbol, index) => {
    const text = await fetchOptional(
      `/api/candles?symbol=${encodeURIComponent(symbol)}&from=${from}`,
    );
    if (text === null) return;
    let candles: unknown[] = [];
    try {
      const parsed = JSON.parse(text) as { candles?: unknown[] };
      candles = Array.isArray(parsed.candles) ? parsed.candles : [];
    } catch {
      return;
    }
    if (candles.length === 0) return;
    const path = `candles/${symbol}.json`;
    writeText(join(out, path), text);
    saved.push({ path, bytes: bytesOf(text), sha256: sha256(text) });
    candleRows += candles.length;
    candleBytes += bytesOf(text);
    candleSymbols += 1;
    equityList.push(symbol);
    if ((index + 1) % 50 === 0) {
      console.log(
        `  candles ${index + 1}/${companySymbols.length} ` +
          `(${(candleBytes / 1024 / 1024).toFixed(1)} MB)`,
      );
    }
  });
  equityList.sort();

  const indexList: string[] = [];
  await mapPool(indexSymbols, 4, async (symbol) => {
    const text = await fetchOptional(
      `/api/candles?kind=index&symbol=${encodeURIComponent(symbol)}&from=${from}`,
    );
    if (text === null) return;
    let candles: unknown[] = [];
    try {
      candles = (JSON.parse(text) as { candles?: unknown[] }).candles ?? [];
    } catch {
      return;
    }
    if (candles.length === 0) return;
    const path = `candles-index/${symbol}.json`;
    writeText(join(out, path), text);
    saved.push({ path, bytes: bytesOf(text), sha256: sha256(text) });
    candleBytes += bytesOf(text);
    indexList.push(symbol);
  });
  indexList.sort();
  console.log(
    `[pack] candles: ${candleSymbols} symbols, ${candleRows.toLocaleString()} rows, ` +
      `${(candleBytes / 1024 / 1024).toFixed(1)} MB`,
  );

  save(
    "candles/index.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        years: options.years,
        from,
        symbols: equityList,
        indexSymbols: indexList,
      },
      null,
      2,
    ) + "\n",
  );

  // -------------------------------------------------------- fundamentals ---
  const fundamentalsIndex = await fetchOptional("/api/fundamentals");
  let fundamentalsSymbols: string[] = [];
  if (fundamentalsIndex) {
    save("api/fundamentals-index.json", fundamentalsIndex);
    try {
      fundamentalsSymbols = ((JSON.parse(fundamentalsIndex) as {
        symbols?: string[];
      }).symbols ?? [])
        .map((symbol) => symbol.toUpperCase())
        .sort();
    } catch {
      fundamentalsSymbols = [];
    }
  }
  console.log(`[pack] fundamentals: ${fundamentalsSymbols.length} symbols`);
  await mapPool(fundamentalsSymbols, 6, async (symbol) => {
    const text = await fetchOptional(
      `/api/fundamentals?symbol=${encodeURIComponent(symbol)}`,
    );
    if (text === null) return;
    const path = `fundamentals/${symbol}.json`;
    writeText(join(out, path), text);
    saved.push({ path, bytes: bytesOf(text), sha256: sha256(text) });
  });

  // ----------------------------------------------------- corporate actions --
  let corporateActionSymbols: string[] = [];
  const allActions = await fetchOptional("/api/corporate-actions/all");
  if (allActions) {
    try {
      const parsed = JSON.parse(allActions) as {
        actions?: Array<Record<string, unknown>>;
        provenance?: unknown;
        dataState?: unknown;
        providerId?: string;
      };
      const groups = new Map<string, Array<Record<string, unknown>>>();
      for (const action of parsed.actions ?? []) {
        const symbol = String(action.symbol ?? "").trim().toUpperCase();
        if (!symbol) continue;
        const list = groups.get(symbol) ?? [];
        list.push(action);
        groups.set(symbol, list);
      }
      corporateActionSymbols = [...groups.keys()].sort();
      for (const symbol of corporateActionSymbols) {
        const body = JSON.stringify({
          providerId: parsed.providerId ?? meta.providerId ?? "free-source",
          symbol,
          actions: groups.get(symbol) ?? [],
          provenance: parsed.provenance ?? null,
          dataState: parsed.dataState ?? null,
        });
        const path = `corporate-actions/${symbol}.json`;
        writeText(join(out, path), body);
        saved.push({ path, bytes: bytesOf(body), sha256: sha256(body) });
      }
    } catch (error) {
      console.warn(`[pack] could not group corporate actions: ${String(error)}`);
    }
  }
  save(
    "api/corporate-actions-index.json",
    JSON.stringify({
      providerId: meta.providerId ?? "free-source",
      symbols: corporateActionSymbols,
    }),
  );
  console.log(
    `[pack] corporate actions: ${corporateActionSymbols.length} symbols`,
  );

  // -------------------------------------------------------- company events --
  let eventSymbols: string[] = [];
  const eventsText = existsSync(join(out, "api/company-events.json"))
    ? readFileSync(join(out, "api/company-events.json"), "utf8")
    : null;
  if (eventsText) {
    try {
      const parsed = JSON.parse(eventsText) as {
        events?: Array<Record<string, unknown>>;
        types?: string[];
        total?: number;
      };
      const groups = new Map<string, Array<Record<string, unknown>>>();
      for (const event of parsed.events ?? []) {
        const symbol = String(event.symbol ?? "").trim().toUpperCase();
        if (!symbol) continue;
        const list = groups.get(symbol) ?? [];
        list.push(event);
        groups.set(symbol, list);
      }
      eventSymbols = [...groups.keys()].sort();
      for (const symbol of eventSymbols) {
        const body = JSON.stringify({
          providerId: meta.providerId ?? "free-source",
          symbol,
          types: parsed.types ?? [],
          events: groups.get(symbol) ?? [],
          total: (groups.get(symbol) ?? []).length,
          source: null,
          unavailableReason: null,
        });
        const path = `company-events/${symbol}.json`;
        writeText(join(out, path), body);
        saved.push({ path, bytes: bytesOf(body), sha256: sha256(body) });
      }
      save(
        "api/company-events-index.json",
        JSON.stringify({
          providerId: meta.providerId ?? "free-source",
          types: parsed.types ?? [],
          total: parsed.total ?? 0,
          symbols: eventSymbols,
        }),
      );
    } catch {
      // The global response is still usable.
    }
  }
  console.log(`[pack] company events: ${eventSymbols.length} symbols`);

  // -------------------------------------------------------------- analysis --
  // CompanyPage calls /api/analysis for the indicator stats. The screener has
  // already computed the same fields, so derive the response instead of making
  // one request per symbol.
  let analysisCount = 0;
  try {
    const screener = JSON.parse(
      readFileSync(join(out, "api/screener.json"), "utf8"),
    ) as {
      providerId?: string;
      rows?: Array<Record<string, unknown>>;
      dataState?: unknown;
    };
    const fields = [
      "symbol",
      "from",
      "to",
      "observations",
      "lastClose",
      "sma20",
      "sma50",
      "sma200",
      "ema20",
      "rsi14",
      "high52w",
      "low52w",
      "returnPercent",
    ];
    for (const row of screener.rows ?? []) {
      const symbol = String(row.symbol ?? "").toUpperCase();
      if (!symbol) continue;
      const analysis: Record<string, unknown> = { symbol };
      for (const field of fields.slice(1)) {
        analysis[field] = row[field] ?? null;
      }
      const body = JSON.stringify({
        providerId: screener.providerId ?? meta.providerId ?? "free-source",
        symbol,
        analysis,
        provenance: row.provenance ?? null,
        dataState: screener.dataState ?? null,
      });
      const path = `analysis/${symbol}.json`;
      writeText(join(out, path), body);
      saved.push({ path, bytes: bytesOf(body), sha256: sha256(body) });
      analysisCount += 1;
    }
  } catch (error) {
    console.warn(`[pack] could not derive analysis files: ${String(error)}`);
  }
  console.log(`[pack] analysis: ${analysisCount} symbols`);

  // -------------------------------------------------------------- manifest --
  const totalBytes = saved.reduce((sum, file) => sum + file.bytes, 0);
  const files: Record<string, { bytes: number; sha256: string }> = {};
  for (const file of [...saved].sort((a, b) => a.path.localeCompare(b.path))) {
    files[file.path] = { bytes: file.bytes, sha256: file.sha256 };
  }
  const packHash = sha256(
    Object.entries(files)
      .map(([path, entry]) => `${path}:${entry.sha256}`)
      .join("\n"),
  );

  const manifest = {
    name: "NEPSE Terminal mobile data pack",
    format: 1,
    version: options.version,
    generatedAt: new Date().toISOString(),
    years: options.years,
    from,
    latestSession,
    providerId: meta.providerId ?? "free-source",
    counts: {
      companies: companySymbols.length,
      quotes: (() => {
        try {
          return (
            JSON.parse(readFileSync(join(out, "api/quotes.json"), "utf8")) as {
              quotes?: unknown[];
            }
          ).quotes?.length ?? 0;
        } catch {
          return 0;
        }
      })(),
      indices: indexSymbols.length,
      candleSymbols,
      candles: candleRows,
      indexSeries: indexList.length,
      fundamentals: fundamentalsSymbols.length,
      corporateActionSymbols: corporateActionSymbols.length,
      eventSymbols: eventSymbols.length,
      analysis: analysisCount,
    },
    sizes: { files: Object.keys(files).length, bytes: totalBytes },
    packHash,
    files,
  };
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  writeText(join(out, "manifest.json"), manifestText);

  const totalWithManifest = totalBytes + bytesOf(manifestText);
  console.log("");
  console.log("=========================================================");
  console.log(`  data pack: ${out}`);
  console.log(`  version:   ${manifest.version}`);
  console.log(`  session:   ${manifest.latestSession ?? "unknown"}`);
  console.log(
    `  files:     ${Object.keys(files).length + 1} (${(
      totalWithManifest /
      1024 /
      1024
    ).toFixed(1)} MB uncompressed)`,
  );
  console.log(`  packHash:  ${packHash}`);
  console.log("=========================================================");

  if (options.zip) {
    mkdirSync(dirname(options.zip), { recursive: true });
    rmSync(options.zip, { force: true });
    console.log(`[pack] writing ${options.zip}`);
    execFileSync("zip", ["-q", "-9", "-r", options.zip, "."], {
      cwd: out,
      stdio: "inherit",
    });
    const zipBytes = statSync(options.zip).size;
    console.log(
      `[pack] zip ${(zipBytes / 1024 / 1024).toFixed(1)} MB ` +
        `sha256=${sha256(readFileSync(options.zip))}`,
    );
  }

  if (handle) {
    await new Promise<void>((resolveClose) => handle!.server.close(() => resolveClose()));
  }
  if (temp && !options.keepTemp) {
    rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

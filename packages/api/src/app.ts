import { createServer, type IncomingMessage, type Server } from "node:http";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { extname, resolve, sep } from "node:path";
import {
  AggregateProviderError,
  CapabilitySchema,
  classificationForSourceType,
  computeDataState,
  ageInSeconds,
  freshnessRuleFor,
  policyFromEnv,
  type Capability,
  type DataEdition,
  type DataState,
  type MarketDataProvider,
} from "@stock/core";
import { createProvider, PERSONAL_PROVIDER_ID } from "@stock/providers";
import { PersonalStore, type StoredProvenance } from "@stock/store";
import {
  analyzeCandles,
  computePortfolio,
  screenCandles,
  type TradeInput,
} from "@stock/analytics";
import { syncPersonalData } from "@stock/personal";

export interface ApiConfig {
  dbPath: string;
  dataDir: string;
  webDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ApiHandle {
  server: Server;
  store: PersonalStore;
  providerId: string;
  edition: DataEdition;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolveBody({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolveBody(
          parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : {},
        );
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

interface ProvenanceView extends StoredProvenance {
  state: DataState;
  stale: boolean;
  maxAgeSeconds: number;
  ageSeconds: number | null;
}

interface DataStateSummary {
  state: DataState;
  stale: boolean;
  total: number;
  counts: Record<DataState, number>;
  lastAsOf: string | null;
}

const STATE_RANK: Record<DataState, number> = {
  unavailable: 5,
  stale: 4,
  delayed: 3,
  eod: 2,
  live: 1,
};

/**
 * Attach a computed freshness state to stored provenance. This is the only
 * place the API decides whether a stored record is live/delayed/eod/stale.
 */
function provenanceView(
  provenance: StoredProvenance,
  capability: Capability,
  fallbackAsOf?: string | null,
): ProvenanceView {
  const rule = freshnessRuleFor(capability);
  const asOf = fallbackAsOf ?? provenance.asOf ?? provenance.fetchedAt;
  const state = computeDataState({
    asOf,
    fetchedAt: provenance.fetchedAt,
    maxAgeSeconds: rule.maxAgeSeconds,
    mode: rule.mode,
  });
  return {
    ...provenance,
    asOf,
    state,
    stale: state === "stale",
    maxAgeSeconds: rule.maxAgeSeconds,
    ageSeconds: asOf ? ageInSeconds(asOf) : null,
  };
}

/**
 * End-of-day quotes use the daily freshness window, not the 15-minute live
 * window. Otherwise a correct previous-session close would be mislabelled
 * "stale" as though a live feed had stopped.
 */
function quoteCapability(
  session: "live" | "eod" | undefined,
  edition: DataEdition | undefined,
): Capability {
  // The Free Edition has no live feed at all, so a quote is end-of-day
  // whatever its file claims. Elsewhere only an explicit "live" session gets
  // the 15-minute live window; a missing session never upgrades to live.
  if (edition === "free") return "dailyOhlc";
  return session === "live" ? "liveQuotes" : "dailyOhlc";
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isLoopback(hostWithPort: string | undefined): boolean {
  if (!hostWithPort) return false;
  const host = hostWithPort.startsWith("[")
    ? hostWithPort.slice(0, hostWithPort.indexOf("]") + 1)
    : hostWithPort.split(":")[0]!;
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

/**
 * The API is a local, single-user service. Reject requests whose Host is not
 * loopback (DNS rebinding) and state-changing requests from a foreign Origin
 * or without a JSON body type (a cross-site form or text/plain POST can be
 * sent without a CORS preflight; application/json cannot).
 */
function rejectUnsafeRequest(request: IncomingMessage): string | null {
  if (!isLoopback(request.headers.host)) {
    return "requests must be addressed to the local loopback host";
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.origin;
    if (origin && origin !== "null") {
      let originHost: string | undefined;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = undefined;
      }
      if (!isLoopback(originHost)) {
        return "cross-origin requests are not allowed";
      }
    }
    const type = String(request.headers["content-type"] ?? "").toLowerCase();
    if (!type.startsWith("application/json")) {
      return "state-changing requests must send content-type: application/json";
    }
  }
  return null;
}

function summarizeProvenance(views: ProvenanceView[]): DataStateSummary {
  const counts: Record<DataState, number> = {
    live: 0,
    delayed: 0,
    eod: 0,
    stale: 0,
    unavailable: 0,
  };
  let worst: DataState = views.length === 0 ? "unavailable" : "live";
  let lastAsOf: string | null = null;

  for (const view of views) {
    counts[view.state] += 1;
    if (STATE_RANK[view.state] > STATE_RANK[worst]) worst = view.state;
    if (view.asOf && (!lastAsOf || view.asOf > lastAsOf)) {
      lastAsOf = view.asOf;
    }
  }

  return {
    state: worst,
    stale: worst === "stale",
    total: views.length,
    counts,
    lastAsOf,
  };
}

function emptyDataState(
  classification: StoredProvenance["classification"],
): DataStateSummary & { classification: StoredProvenance["classification"] } {
  return {
    state: "unavailable",
    stale: false,
    total: 0,
    counts: { live: 0, delayed: 0, eod: 0, stale: 0, unavailable: 0 },
    lastAsOf: null,
    classification,
  };
}

function serveStatic(
  response: import("node:http").ServerResponse,
  webDir: string,
  pathname: string,
): void {
  const root = resolve(webDir);
  const requested = resolve(root, `.${pathname}`);
  if (requested !== root && !requested.startsWith(root + sep)) {
    sendJson(response, 403, { error: "forbidden" });
    return;
  }

  let filePath = requested;
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = resolve(root, "index.html");
  }
  if (!existsSync(filePath)) {
    sendJson(response, 404, { error: "not found" });
    return;
  }

  const body = readFileSync(filePath);
  response.writeHead(200, {
    "content-type":
      CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
    "cache-control": filePath.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
    "content-length": body.length,
  });
  response.end(body);
}

interface DataDirInspection {
  dataDir: string;
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
  presentFiles: string[];
}

function inspectDataDir(dataDir: string): DataDirInspection {
  const listed = (directory: string): string[] => {
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((name) => name.toLowerCase().endsWith(".csv"))
      .sort();
  };
  const fileStatus = (name: string, required: boolean) => {
    const filePath = resolve(dataDir, name);
    const exists = existsSync(filePath);
    return {
      name,
      required,
      exists,
      bytes: exists ? statSync(filePath).size : 0,
    };
  };
  const ohlc = listed(resolve(dataDir, "ohlc"));
  const indices = listed(resolve(dataDir, "indices"));
  const files = [
    fileStatus("companies.csv", true),
    fileStatus("securities.csv", false),
    fileStatus("indices.csv", false),
    fileStatus("quotes.csv", false),
    fileStatus("market-summary.csv", false),
    fileStatus("sector-performance.csv", false),
    fileStatus("corporate-actions.csv", false),
    fileStatus("ipos.csv", false),
    fileStatus("news.csv", false),
  ];
  const missing = [
    ...(existsSync(resolve(dataDir, "companies.csv"))
      ? []
      : ["companies.csv"]),
    ...(ohlc.length > 0 ? [] : ["ohlc/<SYMBOL>.csv"]),
  ];
  return {
    dataDir,
    files,
    ohlc,
    indices,
    ready: missing.length === 0,
    missing,
    presentFiles: [
      ...files.filter((file) => file.exists).map((file) => file.name),
      ...ohlc.map((name) => `ohlc/${name}`),
      ...indices.map((name) => `indices/${name}`),
    ],
  };
}

export function createApiServer(config: ApiConfig): ApiHandle {
  const env = config.env ?? process.env;
  const policy = policyFromEnv(env);
  const store = new PersonalStore(config.dbPath);

  let provider: MarketDataProvider | undefined;
  let providerError: string | undefined;
  try {
    provider = createProvider("personal", {
      ...env,
      PERSONAL_DATA_DIR: config.dataDir,
    });
  } catch (error) {
    providerError = error instanceof Error ? error.message : String(error);
  }

  const providerId = provider?.descriptor.id ?? PERSONAL_PROVIDER_ID;
  const allCapabilities = CapabilitySchema.options as Capability[];
  let syncInFlight = false;

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "127.0.0.1"}`,
      );

      if (!url.pathname.startsWith("/api/")) {
        if (config.webDir) {
          serveStatic(response, config.webDir, url.pathname);
        } else {
          sendJson(response, 404, {
            error: "web build not configured; use the Vite dev server",
          });
        }
        return;
      }

      const unsafe = rejectUnsafeRequest(request);
      if (unsafe) {
        sendJson(response, 403, { error: unsafe });
        return;
      }

      try {
        if (request.method === "GET" && url.pathname === "/api/health") {
          sendJson(response, 200, {
            ok: true,
            edition: policy.edition ?? "licensed",
            providerId,
          });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/meta") {
          const storeSummary = store.summary(providerId);
          const classification = provider
            ? classificationForSourceType(provider.descriptor.sourceType)
            : "MISSING";
          // Base the store state on the newest stored market timestamp, never
          // on the import time. Importing an old file must still look old.
          const marketAsOf = store.latestMarketAsOf(providerId);
          const dataState =
            marketAsOf === null
              ? emptyDataState(classification)
              : {
                  ...summarizeProvenance([
                    provenanceView(
                      {
                        providerId,
                        sourceType: provider?.descriptor.sourceType ?? "manual",
                        termsStatus: provider?.descriptor.termsStatus ?? "unverified",
                        productionReady: provider?.descriptor.productionReady ?? false,
                        fetchedAt: storeSummary.lastFetchedAt ?? marketAsOf,
                        asOf: marketAsOf,
                        classification,
                      },
                      "dailyOhlc",
                    ),
                  ]),
                  classification,
                };
          sendJson(response, 200, {
            edition: policy.edition ?? "licensed",
            environment: policy.environment,
            providerId,
            provider: provider?.descriptor ?? null,
            providerError: providerError ?? null,
            policy: {
              allowUnofficial: policy.allowUnofficial,
              requireVerifiedTerms: policy.requireVerifiedTerms,
              requireProductionReady: policy.requireProductionReady,
            },
            store: storeSummary,
            dataState,
          });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/coverage") {
          const available = provider?.descriptor.capabilities ?? [];
          const classification = provider
            ? classificationForSourceType(provider.descriptor.sourceType)
            : "MISSING";
          const summary = store.summary(providerId);
          const indexSymbols = store.getSymbolsWithCandles(providerId, "index");
          const marketSnapshot = store.getSnapshotWithProvenance(
            providerId,
            "marketSummary",
            "latest",
          );
          const sectorSnapshot = store.getSnapshotWithProvenance<unknown[]>(
            providerId,
            "sectorPerformance",
            "latest",
          );
          const derivedFromMaster = new Set<Capability>(["sectors", "indices"]);
          // "available" above is what the provider can read. "datasets" is what
          // is actually stored, so a capability is never mistaken for data.
          const datasets = allCapabilities.map((capability) => {
            let present = false;
            let session: "eod" | "static" | null = null;
            let note: string | null = null;
            switch (capability) {
              case "companyList":
              case "securityList":
                present = summary.companies > 0;
                session = "static";
                break;
              case "sectors":
                present = summary.companies > 0;
                session = "static";
                note = "derived from the company master";
                break;
              case "indices":
                present = indexSymbols.length > 0;
                session = "static";
                note = "derived list of stored index series";
                break;
              case "dailyOhlc":
                present = summary.candles > 0;
                session = "eod";
                break;
              case "indexHistory":
                present = indexSymbols.length > 0;
                session = "eod";
                break;
              case "liveQuotes":
                present = summary.quotes > 0;
                session = "eod";
                note = "end-of-day closes only; there is no live feed";
                break;
              case "marketSummary":
                present = Boolean(marketSnapshot);
                session = present ? "eod" : null;
                break;
              case "sectorPerformance":
                present =
                  Array.isArray(sectorSnapshot?.data) &&
                  sectorSnapshot.data.length > 0;
                session = present ? "eod" : null;
                break;
              default:
                present = false;
            }
            const implemented = available.includes(capability);
            return {
              capability,
              implemented,
              available: present,
              session,
              classification: present
                ? derivedFromMaster.has(capability)
                  ? "DERIVED"
                  : classification
                : "MISSING",
              unavailableReason: present
                ? null
                : implemented
                  ? "the provider can read this dataset, but the source does not publish it and nothing is stored"
                  : "not provided by this source",
              note,
            };
          });
          sendJson(response, 200, {
            providerId,
            classification,
            available,
            missing: allCapabilities.filter(
              (capability) => !available.includes(capability),
            ),
            datasets,
            store: summary,
          });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/companies") {
          const entries = store.getCompaniesWithProvenance(providerId);
          const views = entries.map((entry) => ({
            symbol: entry.data.symbol,
            ...provenanceView(entry.provenance, "companyList"),
          }));
          sendJson(response, 200, {
            providerId,
            companies: entries.map((entry) => entry.data),
            provenance: Object.fromEntries(
              views.map((view) => [view.symbol, view]),
            ),
            dataState: summarizeProvenance(views),
          });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/quotes") {
          const entries = store.getQuotesWithProvenance(providerId);
          const views = entries.map((entry) => ({
            symbol: entry.data.symbol,
            ...provenanceView(
              entry.provenance,
              quoteCapability(entry.data.session, policy.edition),
              entry.data.asOf,
            ),
          }));
          sendJson(response, 200, {
            providerId,
            quotes: entries.map((entry) => entry.data),
            provenance: Object.fromEntries(
              views.map((view) => [view.symbol, view]),
            ),
            dataState: summarizeProvenance(views),
          });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/indices") {
          const snapshot = store.getSnapshotWithProvenance<
            Array<{ symbol: string; name: string; isSector: boolean }>
          >(providerId, "indices", "all");
          const listed =
            snapshot?.data ??
            store.getSymbolsWithCandles(providerId, "index").map((symbol) => ({
              symbol,
              name: symbol,
              isSector: false,
            }));
          const indices = listed.map((index) => {
            const entries = store.getCandlesWithProvenance({
              providerId,
              kind: "index",
              symbol: index.symbol,
            });
            const latest = entries.at(-1);
            const previous = entries.at(-2);
            const view = latest
              ? provenanceView(
                  latest.provenance,
                  "indexHistory",
                  latest.data.timestamp,
                )
              : null;
            const value = latest?.data.close ?? null;
            const previousClose = previous?.data.close ?? null;
            const change =
              value !== null && previousClose !== null
                ? Math.round((value - previousClose) * 10_000) / 10_000
                : null;
            const changePercent =
              change !== null && previousClose !== null && previousClose !== 0
                ? Math.round((change / previousClose) * 1_000_000) / 10_000
                : null;
            return {
              ...index,
              value,
              previousClose,
              change,
              changePercent,
              asOf: latest?.data.timestamp ?? null,
              provenance: view,
            };
          });
          const views = indices
            .map((index) => index.provenance)
            .filter((view): view is ProvenanceView => view !== null);
          sendJson(response, 200, {
            providerId,
            indices,
            dataState: summarizeProvenance(views),
          });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/summary") {
          const summaryEntry = store.getSnapshotWithProvenance(
            providerId,
            "marketSummary",
            "latest",
          );
          const sectorEntry = store.getSnapshotWithProvenance<
            unknown[]
          >(providerId, "sectorPerformance", "latest");
          // An empty snapshot is not market data. Older imports may have left
          // one behind; ignore it rather than reporting a populated capability.
          const sectorData =
            Array.isArray(sectorEntry?.data) && sectorEntry.data.length > 0
              ? sectorEntry.data
              : null;
          const summaryView = summaryEntry
            ? provenanceView(summaryEntry.provenance, "marketSummary")
            : null;
          const sectorView = sectorData
            ? provenanceView(sectorEntry!.provenance, "sectorPerformance")
            : null;
          sendJson(response, 200, {
            providerId,
            summary: summaryEntry?.data ?? null,
            sectors: sectorData,
            provenance: {
              summary: summaryView,
              sectors: sectorView,
            },
            dataState: summarizeProvenance(
              [summaryView, sectorView].filter(
                (view): view is ProvenanceView => view !== null,
              ),
            ),
          });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/candles") {
          const symbol = url.searchParams.get("symbol");
          if (!symbol) {
            sendJson(response, 400, { error: "symbol is required" });
            return;
          }
          const kind =
            url.searchParams.get("kind") === "index" ? "index" : "equity";
          const namespace =
            url.searchParams.get("provider") ?? providerId;
          const entries = store.getCandlesWithProvenance({
            providerId: namespace,
            kind,
            symbol,
            ...(url.searchParams.get("from")
              ? { from: url.searchParams.get("from")! }
              : {}),
            ...(url.searchParams.get("to")
              ? { to: url.searchParams.get("to")! }
              : {}),
          });
          const latest = entries.at(-1);
          const seriesView = latest
            ? provenanceView(
                latest.provenance,
                kind === "index" ? "indexHistory" : "dailyOhlc",
                latest.data.timestamp,
              )
            : null;
          sendJson(response, 200, {
            providerId: namespace,
            symbol: symbol.toUpperCase(),
            kind,
            candles: entries.map((entry) => entry.data),
            provenance: seriesView,
            dataState: seriesView
              ? summarizeProvenance([seriesView])
              : emptyDataState(
                  provider
                    ? classificationForSourceType(provider.descriptor.sourceType)
                    : "MISSING",
                ),
          });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/analysis") {
          const symbol = url.searchParams.get("symbol");
          if (!symbol) {
            sendJson(response, 400, { error: "symbol is required" });
            return;
          }
          const namespace =
            url.searchParams.get("provider") ?? providerId;
          const entries = store.getCandlesWithProvenance({
            providerId: namespace,
            kind: "equity",
            symbol,
            ...(url.searchParams.get("from")
              ? { from: url.searchParams.get("from")! }
              : {}),
            ...(url.searchParams.get("to")
              ? { to: url.searchParams.get("to")! }
              : {}),
          });
          const candles = entries.map((entry) => entry.data);
          const latest = entries.at(-1);
          const seriesView = latest
            ? provenanceView(
                latest.provenance,
                "dailyOhlc",
                latest.data.timestamp,
              )
            : null;
          sendJson(response, 200, {
            providerId: namespace,
            symbol: symbol.toUpperCase(),
            analysis: candles.length > 0 ? analyzeCandles(candles) : null,
            provenance: seriesView,
            dataState: seriesView
              ? summarizeProvenance([seriesView])
              : emptyDataState(
                  provider
                    ? classificationForSourceType(provider.descriptor.sourceType)
                    : "MISSING",
                ),
          });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/screener") {
          const namespace =
            url.searchParams.get("provider") ?? providerId;
          const views: ProvenanceView[] = [];
          const rows = store
            .getSymbolsWithCandles(namespace)
            .map((symbol) => {
              const entries = store.getCandlesWithProvenance({
                providerId: namespace,
                kind: "equity",
                symbol,
              });
              const latest = entries.at(-1);
              if (!latest) return null;
              const view = provenanceView(
                latest.provenance,
                "dailyOhlc",
                latest.data.timestamp,
              );
              views.push(view);
              return {
                ...screenCandles(entries.map((entry) => entry.data)),
                provenance: view,
              };
            })
            .filter((row) => row !== null);
          sendJson(response, 200, {
            providerId: namespace,
            generatedAt: new Date().toISOString(),
            rows,
            dataState: summarizeProvenance(views),
          });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/portfolio") {
          const transactions = store.getPortfolioTransactions();
          const priceBySymbol = new Map(
            store
              .getQuotesWithProvenance(providerId)
              .map((entry) => [
                entry.data.symbol.toUpperCase(),
                {
                  symbol: entry.data.symbol,
                  price: entry.data.ltp,
                  asOf: entry.data.asOf,
                  view: provenanceView(
                    entry.provenance,
                    quoteCapability(entry.data.session, policy.edition),
                    entry.data.asOf,
                  ),
                },
              ]),
          );

          let candleFallbacks = 0;
          for (const symbol of new Set(
            transactions.map((transaction) => transaction.symbol),
          )) {
            if (priceBySymbol.has(symbol)) continue;
            const latest = store.getLatestCandleWithProvenance(
              providerId,
              symbol,
            );
            if (!latest) continue;
            candleFallbacks += 1;
            priceBySymbol.set(symbol, {
              symbol,
              price: latest.data.close,
              asOf: latest.data.timestamp,
              view: provenanceView(
                latest.provenance,
                "dailyOhlc",
                latest.data.timestamp,
              ),
            });
          }

          const portfolio = computePortfolio(
            transactions.map(
              (transaction): TradeInput => ({
                symbol: transaction.symbol,
                side: transaction.side,
                quantity: transaction.quantity,
                price: transaction.price,
                fees: transaction.fees,
                tradedAt: transaction.tradedAt,
              }),
            ),
            [...priceBySymbol.values()],
          );

          if (candleFallbacks > 0) {
            portfolio.warnings.push(
              `${candleFallbacks} position${candleFallbacks === 1 ? " uses" : "s use"} the latest stored daily close because no quote is stored`,
            );
          }

          const pricedViews = portfolio.positions
            .map((position) =>
              position.marketPrice === null
                ? null
                : priceBySymbol.get(position.symbol)?.view ?? null,
            )
            .filter((view): view is ProvenanceView => view !== null);
          const stalePriced = pricedViews.filter(
            (view) => view.state === "stale",
          ).length;
          if (stalePriced > 0) {
            portfolio.warnings.push(
              `${stalePriced} priced position${stalePriced === 1 ? " uses" : "s use"} stale prices; market value is not a current valuation`,
            );
          }

          sendJson(response, 200, {
            providerId,
            transactions,
            ...portfolio,
            positions: portfolio.positions.map((position) => ({
              ...position,
              valuation:
                position.marketPrice === null
                  ? null
                  : priceBySymbol.get(position.symbol)?.view ?? null,
            })),
            dataState: summarizeProvenance(pricedViews),
          });
          return;
        }

        if (
          request.method === "POST" &&
          url.pathname === "/api/portfolio/transactions"
        ) {
          const body = await readBody(request);
          const rawSide = String(body.side ?? "")
            .trim()
            .toLowerCase();
          if (rawSide !== "buy" && rawSide !== "sell") {
            sendJson(response, 400, { error: "side must be buy or sell" });
            return;
          }
          const quantity = Number(body.quantity);
          const price = Number(body.price);
          const fees = body.fees === undefined ? 0 : Number(body.fees);
          if (!Number.isFinite(quantity) || quantity <= 0) {
            sendJson(response, 400, { error: "quantity must be positive" });
            return;
          }
          if (!Number.isFinite(price) || price < 0) {
            sendJson(response, 400, { error: "price must be zero or positive" });
            return;
          }
          if (!Number.isFinite(fees) || fees < 0) {
            sendJson(response, 400, { error: "fees must be zero or positive" });
            return;
          }
          const tradedAt = String(
            body.tradedAt ?? new Date().toISOString().slice(0, 10),
          );
          if (!/^\d{4}-\d{2}-\d{2}/.test(tradedAt)) {
            sendJson(response, 400, {
              error: "tradedAt must start with YYYY-MM-DD",
            });
            return;
          }
          try {
            const transaction = store.addPortfolioTransaction({
              symbol: String(body.symbol ?? ""),
              side: rawSide,
              quantity,
              price,
              fees,
              tradedAt,
              notes:
                body.notes === undefined ? null : String(body.notes),
            });
            sendJson(response, 201, { transaction });
          } catch (error) {
            sendJson(response, 400, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }

        if (
          request.method === "POST" &&
          url.pathname === "/api/portfolio/transactions/remove"
        ) {
          const body = await readBody(request);
          const id = Number(body.id);
          if (!Number.isInteger(id) || id <= 0) {
            sendJson(response, 400, { error: "invalid transaction id" });
            return;
          }
          sendJson(response, 200, {
            removed: store.removePortfolioTransaction(id),
          });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/import/status") {
          const inspection = inspectDataDir(config.dataDir);
          sendJson(response, 200, {
            dataDir: config.dataDir,
            edition: policy.edition ?? "licensed",
            canImport: (policy.edition ?? "licensed") === "free",
            files: inspection.files,
            ohlc: inspection.ohlc,
            indices: inspection.indices,
            ready: inspection.ready,
            missing: inspection.missing,
            syncing: syncInFlight,
            store: store.summary(providerId),
          });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/import/history") {
          sendJson(response, 200, {
            providerId,
            entries: store.getImportAudit(20),
          });
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/import/preview") {
          if ((policy.edition ?? "licensed") !== "free") {
            sendJson(response, 403, {
              error: "imports are only enabled in the Free Edition (DATA_EDITION=free)",
            });
            return;
          }
          if (!provider) {
            sendJson(response, 500, {
              error: providerError ?? "free-source provider unavailable",
            });
            return;
          }
          const inspection = inspectDataDir(config.dataDir);
          if (!inspection.ready) {
            sendJson(response, 400, {
              error: `Nothing to preview. Missing ${inspection.missing.join(" and ")} in ${config.dataDir}.`,
            });
            return;
          }
          const now = new Date();
          const from =
            url.searchParams.get("from") ??
            new Date(
              Date.UTC(
                now.getUTCFullYear() - 5,
                now.getUTCMonth(),
                now.getUTCDate(),
              ),
            )
              .toISOString()
              .slice(0, 10);
          const to = url.searchParams.get("to") ?? now.toISOString().slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            sendJson(response, 400, { error: "from/to must be YYYY-MM-DD" });
            return;
          }
          try {
            const result = await syncPersonalData({
              provider,
              policy,
              store,
              from,
              to,
              dryRun: true,
              files: inspection.presentFiles,
            });
            sendJson(response, 200, {
              preview: result,
              files: inspection.files,
              ohlc: inspection.ohlc,
              indices: inspection.indices,
            });
          } catch (error) {
            const detail =
              error instanceof AggregateProviderError
                ? error.errors.map((inner) => inner.message).filter(Boolean).join("; ")
                : error instanceof Error
                  ? error.message
                  : String(error);
            sendJson(response, 400, { error: detail || "preview failed" });
          }
          return;
        }

        if (request.method === "POST" && url.pathname === "/api/import/run") {
          if ((policy.edition ?? "licensed") !== "free") {
            sendJson(response, 403, {
              error:
                "imports are only enabled in the Free Edition (DATA_EDITION=free)",
            });
            return;
          }
          if (!provider) {
            sendJson(response, 500, {
              error: providerError ?? "free-source provider unavailable",
            });
            return;
          }
          if (syncInFlight) {
            sendJson(response, 409, { error: "a sync is already running" });
            return;
          }

          const inspection = inspectDataDir(config.dataDir);
          if (!inspection.ready) {
            sendJson(response, 400, {
              error: `Nothing to import. Missing ${inspection.missing.join(" and ")} in ${config.dataDir}. Add companies.csv and at least one ohlc/<SYMBOL>.csv file, then try again.`,
            });
            return;
          }

          const body = await readBody(request);
          const now = new Date();
          const from = String(
            body.from ??
              new Date(
                Date.UTC(
                  now.getUTCFullYear() - 5,
                  now.getUTCMonth(),
                  now.getUTCDate(),
                ),
              )
                .toISOString()
                .slice(0, 10),
          );
          const to = String(body.to ?? now.toISOString().slice(0, 10));
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(to)
          ) {
            sendJson(response, 400, { error: "from/to must be YYYY-MM-DD" });
            return;
          }

          syncInFlight = true;
          try {
            const result = await syncPersonalData({
              provider,
              policy,
              store,
              from,
              to,
              files: inspection.presentFiles,
              ...(typeof body.index === "string" &&
              /^[A-Za-z0-9_-]{1,32}$/.test(body.index)
                ? { indexSymbol: body.index }
                : {}),
            });
            sendJson(response, 200, { result, store: store.summary(providerId) });
          } catch (error) {
            const detail =
              error instanceof AggregateProviderError
                ? error.errors
                    .map((inner) => inner.message)
                    .filter(Boolean)
                    .join("; ")
                : error instanceof Error
                  ? error.message
                  : String(error);
            sendJson(response, 400, {
              error: detail || "import failed",
            });
          } finally {
            syncInFlight = false;
          }
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/watchlist") {
          sendJson(response, 200, { symbols: store.getWatchlist() });
          return;
        }

        if (request.method === "POST" && url.pathname === "/api/watchlist") {
          const body = await readBody(request);
          const symbol = String(body.symbol ?? "")
            .trim()
            .toUpperCase();
          if (!/^[A-Z0-9._-]{1,24}$/.test(symbol)) {
            sendJson(response, 400, { error: "invalid symbol" });
            return;
          }
          if (body.action === "remove") {
            store.removeFromWatchlist(symbol);
          } else {
            store.addToWatchlist(symbol);
          }
          sendJson(response, 200, { symbols: store.getWatchlist() });
          return;
        }

        sendJson(response, 404, { error: "not found" });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  server.on("close", () => store.close());

  return {
    server,
    store,
    providerId,
    edition: policy.edition ?? "licensed",
  };
}

/**
 * Minimal authenticated session for nepalstock.com's internal web endpoints.
 *
 * Mirrors the request flow of nepseman-api@1.0.0 (MIT, Dipal Katuwal):
 * authenticate via /api/authenticate/prove, decode the obfuscated token with
 * NEPSE's WASM, send `Authorization: Salter <token>`, and compute the POST
 * payload id. It is written on global fetch with TLS verification left ON —
 * the package's own session module disables TLS verification for the whole
 * process on import, so it is never imported.
 *
 * Rate-consciousness lives here: a 15 s timeout per exchange (headers and
 * body), single-flight authentication, a ~45 s token lifetime, one
 * re-authentication on HTTP 401, and a session-wide exponential backoff
 * (10 s doubling, max 5 min) after a transport failure, during which no
 * request leaves the machine.
 */
import {
  calculatePayloadId,
  nepalDayOfMonth,
  type PayloadType,
  type RawTokenResponse,
  type TokenProvider,
} from "./auth";

export const NEPSE_BASE_URL = "https://www.nepalstock.com";

export const NEPSE_PATHS = {
  authenticate: "/api/authenticate/prove",
  marketOpen: "/api/nots/nepse-data/market-open",
  marketSummary: "/api/nots/market-summary/",
  nepseIndex: "/api/nots/nepse-index",
  liveMarket: "/api/nots/lives-market",
  securityList: "/api/nots/security?nonDelisted=true",
  marketDepth: "/api/nots/nepse-data/marketdepth/",
} as const;

/** The same browser-like headers nepseman-api sends; nothing more. */
export const BROWSER_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  "Cache-Control": "no-cache",
};

export const TOKEN_TTL_MS = 45_000;
export const REQUEST_TIMEOUT_MS = 15_000;
export const BACKOFF_BASE_MS = 10_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface NepseSessionOptions {
  fetchImpl: FetchLike;
  tokenProvider: TokenProvider;
  now: () => number;
  baseUrl?: string;
  tokenTtlMs?: number;
  timeoutMs?: number;
}

/** An upstream failure. `transport` failures trigger the shared backoff. */
export class LiveSourceError extends Error {
  constructor(
    message: string,
    readonly transport: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LiveSourceError";
  }
}

interface Exchange {
  status: number;
  ok: boolean;
  text: string;
}

function bodySnippet(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function endpointName(path: string): string {
  return path.split("?")[0] ?? path;
}

function refusedMessage(status: number, text: string): string | null {
  if (!/unauthori[sz]ed\s+access/i.test(text)) return null;
  return `nepalstock.com refused the request (HTTP ${status}: UNAUTHORIZED ACCESS) — it blocks some networks/regions`;
}

function httpErrorMessage(path: string, exchange: Exchange): string {
  const refused = refusedMessage(exchange.status, exchange.text);
  if (refused) return refused;
  if (exchange.status === 401 || exchange.status === 403) {
    return `nepalstock.com refused the request (HTTP ${exchange.status}) — the token was rejected or this network is blocked`;
  }
  const snippet = bodySnippet(exchange.text);
  return `nepalstock.com returned HTTP ${exchange.status} for ${endpointName(path)}${snippet ? `: ${snippet}` : ""}`;
}

function causeText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: unknown }).code;
    return typeof code === "string" && !cause.message.includes(code)
      ? `${cause.message} (${code})`
      : cause.message;
  }
  return error.message;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

export class NepseSession {
  private readonly baseUrl: string;
  private readonly tokenTtlMs: number;
  private readonly timeoutMs: number;

  private accessToken: string | null = null;
  private tokenDetails: RawTokenResponse | null = null;
  private tokenAt = 0;
  private authInFlight: Promise<void> | null = null;
  private marketOpenId: number | null = null;

  private failures = 0;
  private blockedUntil = 0;
  private lastFailure: string | null = null;

  constructor(private readonly options: NepseSessionOptions) {
    this.baseUrl = (options.baseUrl ?? NEPSE_BASE_URL).replace(/\/$/, "");
    this.tokenTtlMs = options.tokenTtlMs ?? TOKEN_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /** Milliseconds until the shared backoff allows another request (0 = now). */
  backoffRemainingMs(): number {
    return Math.max(0, this.blockedUntil - this.options.now());
  }

  /** GET an authenticated JSON endpoint. An empty body yields null. */
  async getJson(path: string): Promise<unknown> {
    return this.authorizedRequest(path, "GET");
  }

  /**
   * POST with the computed payload id `{ id }`, as nepseman-api does for
   * today-price, floorsheet and graph endpoints. The id derives from the
   * market-open id, the token salts and the day of month in Nepal.
   */
  async postJson(path: string, which: PayloadType = "general"): Promise<unknown> {
    return this.authorizedRequest(path, "POST", which);
  }

  /** `GET /api/nots/nepse-data/market-open`; remembers its id for POST payloads. */
  async marketStatus(): Promise<unknown> {
    const body = await this.getJson(NEPSE_PATHS.marketOpen);
    const id =
      body && typeof body === "object"
        ? finiteNumber((body as Record<string, unknown>).id)
        : null;
    if (id !== null) this.marketOpenId = id;
    return body;
  }

  private async authorizedRequest(
    path: string,
    method: "GET" | "POST",
    which: PayloadType = "general",
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      await this.authenticate();
      const used = this.accessToken;
      const init: RequestInit = { method, headers: this.authHeaders() };
      if (method === "POST") {
        init.body = JSON.stringify({ id: await this.payloadId(which) });
      }
      const exchange = await this.exchange(path, init);
      if (exchange.status === 401 && attempt === 0) {
        // Token expired or rejected early: re-authenticate once and retry
        // (unless a concurrent request already refreshed it).
        if (this.accessToken === used) this.accessToken = null;
        continue;
      }
      return this.parse(path, exchange);
    }
  }

  private async payloadId(which: PayloadType): Promise<number> {
    if (this.marketOpenId === null) await this.marketStatus();
    if (this.marketOpenId === null || this.tokenDetails === null) {
      throw new LiveSourceError(
        "market-open response had no id; cannot compute the POST payload",
        false,
      );
    }
    return calculatePayloadId(
      this.marketOpenId,
      this.tokenDetails,
      which,
      nepalDayOfMonth(this.options.now()),
    );
  }

  private authHeaders(): Record<string, string> {
    return {
      ...BROWSER_HEADERS,
      Authorization: `Salter ${this.accessToken ?? ""}`,
      "Content-Type": "application/json",
    };
  }

  private async authenticate(): Promise<void> {
    const fresh =
      this.accessToken !== null &&
      this.options.now() - this.tokenAt < this.tokenTtlMs;
    if (fresh) return;
    this.authInFlight ??= this.doAuthenticate().finally(() => {
      this.authInFlight = null;
    });
    await this.authInFlight;
  }

  private async doAuthenticate(): Promise<void> {
    const path = NEPSE_PATHS.authenticate;
    const body = this.parse(
      path,
      await this.exchange(path, { method: "GET", headers: { ...BROWSER_HEADERS } }),
    );
    const record =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const salts = [1, 2, 3, 4, 5].map((i) => finiteNumber(record[`salt${i}`]));
    if (
      typeof record.accessToken !== "string" ||
      record.accessToken.length === 0 ||
      salts.some((salt) => salt === null)
    ) {
      throw new LiveSourceError(
        "nepalstock.com authentication response had no token/salts (format changed?)",
        false,
      );
    }
    const raw: RawTokenResponse = {
      accessToken: record.accessToken,
      refreshToken: typeof record.refreshToken === "string" ? record.refreshToken : "",
      salt1: salts[0]!,
      salt2: salts[1]!,
      salt3: salts[2]!,
      salt4: salts[3]!,
      salt5: salts[4]!,
    };
    let accessToken: string;
    try {
      ({ accessToken } = await this.options.tokenProvider.parseTokens(raw));
    } catch (error) {
      throw new LiveSourceError(
        `could not decode the nepalstock.com token: ${error instanceof Error ? error.message : String(error)}`,
        false,
      );
    }
    this.accessToken = accessToken;
    this.tokenDetails = raw;
    this.tokenAt = this.options.now();
    this.marketOpenId = null;
  }

  /** One HTTP exchange (headers + body) under the timeout and the shared backoff. */
  private async exchange(path: string, init: RequestInit): Promise<Exchange> {
    if (this.backoffRemainingMs() > 0 && this.lastFailure) {
      // Backing off: repeat the failure without touching the network.
      throw new LiveSourceError(this.lastFailure, false);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.options.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      const text = await response.text();
      return { status: response.status, ok: response.ok, text };
    } catch (error) {
      throw this.fail(
        new LiveSourceError(
          controller.signal.aborted
            ? `nepalstock.com did not respond within ${Math.round(this.timeoutMs / 1000)} s`
            : `could not reach nepalstock.com: ${causeText(error)}`,
          true,
        ),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Classify an exchange; a 2xx JSON (or empty) body resets the backoff. */
  private parse(path: string, exchange: Exchange): unknown {
    if (!exchange.ok) {
      throw this.fail(
        new LiveSourceError(httpErrorMessage(path, exchange), true, exchange.status),
      );
    }
    // The block page can also arrive with a 2xx status.
    const refused = refusedMessage(exchange.status, exchange.text);
    if (refused) throw this.fail(new LiveSourceError(refused, true, exchange.status));
    this.succeed();
    if (!exchange.text.trim()) return null;
    try {
      return JSON.parse(exchange.text) as unknown;
    } catch {
      const snippet = bodySnippet(exchange.text);
      throw new LiveSourceError(
        `nepalstock.com returned a non-JSON response for ${endpointName(path)}${snippet ? `: ${snippet}` : ""}`,
        false,
      );
    }
  }

  private fail(error: LiveSourceError): LiveSourceError {
    if (error.transport) {
      this.failures += 1;
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** (this.failures - 1), BACKOFF_MAX_MS);
      this.blockedUntil = this.options.now() + delay;
      this.lastFailure = error.message;
    }
    return error;
  }

  private succeed(): void {
    this.failures = 0;
    this.blockedUntil = 0;
    this.lastFailure = null;
  }
}

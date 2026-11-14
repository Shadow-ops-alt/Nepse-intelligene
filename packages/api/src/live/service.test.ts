import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { calculatePayloadId, nepalDayOfMonth, type TokenProvider } from "./auth";
import {
  CLOSED_TTL_MS,
  LIVE_DISCLAIMER,
  OPEN_TTL_MS,
  createLiveService,
} from "./service";
import { NepseSession, type FetchLike } from "./session";

const PATHS = {
  auth: "/api/authenticate/prove",
  open: "/api/nots/nepse-data/market-open",
  live: "/api/nots/lives-market",
  summary: "/api/nots/market-summary/",
  index: "/api/nots/nepse-index",
  securities: "/api/nots/security",
  depth: "/api/nots/nepse-data/marketdepth/131/",
};

const REFUSED =
  "nepalstock.com refused the request (HTTP 401: UNAUTHORIZED ACCESS) — it blocks some networks/regions";

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

interface Call {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fake nepalstock.com: no network, every request recorded. */
function upstream(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    calls.push({
      path: url.pathname,
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const handler = routes[url.pathname];
    return handler ? handler(url, init) : new Response("not found", { status: 404 });
  };
  const count = (path: string) => calls.filter((call) => call.path === path).length;
  return { fetchImpl, calls, count };
}

/** Fake TokenParser: the "obfuscation" is a '#' sprinkled into the token. */
function fakeTokenProvider(seen: unknown[] = []): TokenProvider {
  return {
    parseTokens(raw) {
      seen.push(raw);
      return { accessToken: raw.accessToken.replace(/#/g, ""), refreshToken: raw.refreshToken };
    },
  };
}

function clock(start = Date.parse("2026-11-15T06:00:00Z")) {
  let time = start;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

let tokenCounter = 0;
const authRoute: Handler = () => {
  tokenCounter += 1;
  return json({
    accessToken: `tok#en-${tokenCounter}`,
    refreshToken: "refresh",
    salt1: "21780",
    salt2: 70035,
    salt3: 55491,
    salt4: 46272,
    salt5: 87289,
  });
};

const openRoute = (isOpen: "OPEN" | "CLOSE"): Handler => () =>
  json({ isOpen, asOf: "2026-11-15T11:45:00", id: 7 });

const LIVE_ROWS = [
  {
    securityId: "131",
    securityName: "Nabil Bank Limited",
    symbol: "NABIL",
    openPrice: 500,
    highPrice: 510.5,
    lowPrice: 498,
    totalTradeQuantity: 12345,
    totalTradeValue: 6172500.5,
    lastTradedPrice: 505,
    percentageChange: 1.2,
    lastUpdatedDateTime: "2026-11-15T11:44:58",
    previousClose: 499,
  },
];

function fakeResponse() {
  const captured: { status?: number; headers?: Record<string, unknown>; body?: string } = {};
  const response = {
    writeHead(status: number, headers: Record<string, unknown>) {
      captured.status = status;
      captured.headers = headers;
      return response;
    },
    end(body: string) {
      captured.body = body;
      return response;
    },
  };
  return {
    response: response as unknown as ServerResponse,
    captured,
    json: () => JSON.parse(captured.body ?? "null") as Record<string, unknown>,
  };
}

describe("authentication and token handling", () => {
  it("decodes the prove token via the injected TokenProvider and sends Salter auth", async () => {
    const seen: unknown[] = [];
    const time = clock();
    const fake = upstream({
      [PATHS.auth]: authRoute,
      [PATHS.open]: openRoute("OPEN"),
      [PATHS.live]: () => json(LIVE_ROWS),
    });
    const live = createLiveService({
      enabled: true,
      fetchImpl: fake.fetchImpl,
      now: time.now,
      tokenProvider: fakeTokenProvider(seen),
    });

    const result = await live.market();
    expect(result.lastError).toBeNull();
    expect(result.rows.map((row) => row.symbol)).toEqual(["NABIL"]);

    // Salts arrive as numbers even when NEPSE sends strings.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ salt1: 21780, salt2: 70035, salt5: 87289 });

    const [auth, ...data] = fake.calls;
    expect(auth?.path).toBe(PATHS.auth);
    expect(auth?.headers.Authorization).toBeUndefined();
    expect(auth?.headers["User-Agent"]).toMatch(/^Mozilla\/5\.0/);
    const decoded = `token-${tokenCounter}`;
    for (const call of data) {
      expect(call.headers.Authorization).toBe(`Salter ${decoded}`);
      expect(call.headers["User-Agent"]).toMatch(/Firefox/);
      expect(call.headers.Accept).toBe("application/json, text/plain, */*");
    }
  });

  it("reuses the token for ~45 s, then re-authenticates", async () => {
    const time = clock();
    const fake = upstream({
      [PATHS.auth]: authRoute,
      [PATHS.open]: openRoute("OPEN"),
      [PATHS.live]: () => json(LIVE_ROWS),
    });
    const live = createLiveService({
      enabled: true,
      fetchImpl: fake.fetchImpl,
      now: time.now,
      tokenProvider: fakeTokenProvider(),
    });
    await live.market();
    time.advance(OPEN_TTL_MS + 1);
    await live.market();
    expect(fake.count(PATHS.auth)).toBe(1);
    time.advance(45_000);
    await live.market();
    expect(fake.count(PATHS.auth)).toBe(2);
  });

  it("re-authenticates once when a data endpoint answers 401", async () => {
    const time = clock();
    let liveCalls = 0;
    const fake = upstream({
      [PATHS.auth]: authRoute,
      [PATHS.open]: openRoute("OPEN"),
      [PATHS.live]: () => {
        liveCalls += 1;
        return liveCalls === 1 ? new Response("", { status: 401 }) : json(LIVE_ROWS);
      },
    });
    const live = createLiveService({
      enabled: true,
      fetchImpl: fake.fetchImpl,
      now: time.now,
      tokenProvider: fakeTokenProvider(),
    });
    const result = await live.market();
    expect(result.lastError).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(fake.count(PATHS.auth)).toBe(2);
    expect(fake.count(PATHS.live)).toBe(2);
  });

  it("computes the POST payload id like nepseman-api", async () => {
    const time = clock(Date.parse("2026-11-14T18:30:00Z")); // already the 15th in Nepal
    const fake = upstream({
      [PATHS.auth]: authRoute,
      [PATHS.open]: openRoute("OPEN"),
      "/api/nots/nepse-data/today-price": () => json({ content: [] }),
    });
    const session = new NepseSession({
      fetchImpl: fake.fetchImpl,
      now: time.now,
      tokenProvider: fakeTokenProvider(),
    });
    await session.postJson("/api/nots/nepse-data/today-price", "sector-live");
    const post = fake.calls.find((call) => call.method === "POST");
    const salts = { salt1: 21780, salt2: 70035, salt3: 55491, salt4: 46272, salt5: 87289 };
    expect(nepalDayOfMonth(time.now())).toBe(15);
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      id: calculatePayloadId(7, salts, "sector-live", 15),
    });
    expect(post?.headers["Content-Type"]).toBe("application/json");
  });
});

describe("caching and single flight", () => {
  it("serves the cached payload for ~10 s while the market is open", async () => {
    const time = clock();
    const fake = upstream({
      [PATHS.auth]: authRoute,
      [PATHS.open]: openRoute("OPEN"),
      [PATHS.live]: () => json(LIVE_ROWS),
    });
    const live = createLiveService({
      enabled: true,
      fetchImpl: fake.fetchImpl,
      now: time.now,
      tokenProvider: fakeTokenProvider(),
    });
    await live.market();
    time.advance(OPEN_TTL_MS - 1);
    await live.market();
    expect(fake.count(PATHS.live)).toBe(1);
    time.advance(2);
    const result = await live.market();
    expect(fake.count(PATHS.live)).toBe(2);
    expect(result.marketOpen).toBe(true);
    expect(fake.count(PATHS.open)).toBe(1); // market-open is checked once a minute
  });

  it("shares one upstream request between concurrent callers", async () => {
    const time = clock();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = upstream({
      [PATHS.auth]: authRoute,
      [PATHS.open]: openRoute("OPEN"),
      [PATHS.live]: async () => {
        await gate;
        return json(LIVE_ROWS);
      },
    });
    const live = createLiveService({
      enabled: true,
      fetchImpl: fake.fetchImpl,
      now: time.now,
      tokenProvider: fakeTokenProvider(),
    });
    const pending = Promise.all([live.market(), live.market(), live.market(), live.status()]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    const results = await pending;
    expect(fake.count(PATHS.auth)).toBe(1);
    expect(fake.count(PATHS.open)).toBe(1);
    expect(fake.count(PATHS.live)).toBe(1);
    for (const result of results.slice(0, 3)) {
      expect(result).toMatchObject({ enabled: true, lastError: null });
    }
  });
});

describe("failure handling", () => {
  it("keeps the last good payload with lastError and backs off exponentially", async () => {
    const time = clock();
    let liveUp = true;
    const fake = upstream({
      [PATHS.auth]: authRoute,
      [PATHS.open]: openRoute("OPEN"),
      [PATHS.live]: () =>
        liveUp ? json(LIVE_ROWS) : new Response("<h1>Service Unavailable</h1>", { status: 503 }),
    });
    const live = createLiveService({
      enabled: true,
      fetchImpl: fake.fetchImpl,
      now: time.now,
      tokenProvider: fakeTokenProvider(),
    });
    const good = await live.market();
    expect(good.rows).toHaveLength(1);

    liveUp = false;
    time.advance(OPEN_TTL_MS + 1);
    const failed = await live.market();
    expect(failed.rows).toEqual(good.rows);
    expect(failed.fetchedAt).toBe(good.fetchedAt);
    expect(failed.lastError).toBe(
      "nepalstock.com returned HTTP 503 for /api/nots/lives-market: Service Unavailable",
    );
    expect(fake.count(PATHS.live)).toBe(2);

    // Backoff: 10 s, then 20 s; nothing leaves the machine in between.
    time.advance(5_000);
    await live.market();
    expect(fake.count(PATHS.live)).toBe(2);
    time.advance(5_001);
    await live.market();
    expect(fake.count(PATHS.live)).toBe(3);
    time.advance(15_000);
    expect((await live.market()).lastError).toContain("HTTP 503");
    expect(fake.count(PATHS.live)).toBe(3);
    time.advance(5_001);
    await live.market();
    expect(fake.count(PATHS.live)).toBe(4);

    // Recovery clears the error.
    liveUp = true;
    time.advance(40_001);
    const recovered = await live.market();
    expect(recovered.lastError).toBeNull();
    expect(fake.count(PATHS.live)).toBe(5);
  });

  it("caps the backoff at 5 minutes", async () => {
    const time = clock();
    const fake = upstream({ [PATHS.auth]: () => new Response("down", { status: 500 }) });
    const live = createLiveService({
      enabled: true,
      fetchImpl: fake.fetchImpl,
      now: time.now,
      tokenProvider: fakeTokenProvider(),
    });
    for (let i = 0; i < 12; i += 1) {
      await live.status();
      time.advance(CLOSED_TTL_MS + 1);
    }
    expect(fake.count(PATHS.auth)).toBe(12);
    await live.status();
    time.advance(CLOSED_TTL_MS - 1_000);
    await live.status();
    expect(fake.count(PATHS.auth)).toBe(13);
    time.advance(1_000);
    await live.status();
    expect(fake.count(PATHS.auth)).toBe(14);
  });

  it("reports the nepalstock.com block cleanly", async () => {
    const time = clock();
    const fake = upstream({
      [PATHS.auth]: () =>
        new Response("<html><body><h1>WARNING: UNAUTHORIZED ACCESS</h1></body></html>", {
          status: 401,
        }),
    });
    const live = createLiveService({
      enabled: true,
      fetchImpl: fake.fetchImpl,
      now: time.now,
      tokenProvider: fakeTokenProvider(),
    });
    const status = await live.status();
    expect(status).toMatchObject({ enabled: true, marketOpen: null, lastError: REFUSED });
    const market = await live.market();
    expect(market.rows).toEqual([]);
    // The second resource hits the shared backoff instead of the network.
    expect(market.lastError).toBe(REFUSED);
    expect(fake.count(PATHS.auth)).toBe(1);
  });

  it("explains network failures and timeouts", async () => {
    const refused = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:443"), { code: "ECONNREFUSED" }),
    });
    const session = new NepseSession({
      fetchImpl: async () => {
        throw refused;
      },
      now: Date.now,
      tokenProvider: fakeTokenProvider(),
    });
    await expect(session.getJson(PATHS.live)).rejects.toThrow(
      "could not reach nepalstock.com: connect ECONNREFUSED 1.2.3.4:443",
    );

    const slow = new NepseSession({
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      now: Date.now,
      tokenProvider: fakeTokenProvider(),
      timeoutMs: 20,
    });
    await expect(slow.getJson(PATHS.live)).rejects.toThrow("did not respond within");
  });
});

describe("market-closed polling", () => {
  it("dates closed-market summary figures by the session close, not the fetch", async () => {
    const time = clock();
    const fake = upstream({
      [PATHS.auth]: authRoute,
      [PATHS.open]: () => json({ isOpen: "CLOSE", asOf: "2026-11-13T15:00:00", id: 80 }),
      [PATHS.summary]: () => json([{ detail: "Total Turnover Rs:", value: 3054274725.06 }]),
      [PATHS.index]: () =>
        json([{ id: 58, index: "NEPSE Index", generatedTime: null, close: 2655.23, currentValue: 2648.89, change: -6.32, perChange: -0.23 }]),
    });
    const live = createLiveService({
      enabled: true,
      fetchImpl: fake.fetchImpl,
      now: time.now,
      tokenProvider: fakeTokenProvider(),
    });
    expect(await live.summary()).toMatchObject({
      asOf: "2026-11-13T09:15:00.000Z",
      fetchedAt: "2026-11-15T06:00:00.000Z",
      index: { value: 2648.89, change: -6.32, changePercent: -0.23 },
      turnover: 3054274725.06,
      sharesTraded: null,
      lastError: null,
    });
  });

  it("polls at most once per 5 minutes while the market is closed", async () => {
    const time = clock();
    const fake = upstream({
      [PATHS.auth]: authRoute,
      [PATHS.open]: openRoute("CLOSE"),
      [PATHS.live]: () => json([]),
    });
    const live = createLiveService({
      enabled: true,
      fetchImpl: fake.fetchImpl,
      now: time.now,
      tokenProvider: fakeTokenProvider(),
    });
    const first = await live.market();
    expect(first).toMatchObject({ enabled: true, marketOpen: false, rows: [], lastError: null });
    for (const step of [OPEN_TTL_MS + 1, 60_000, 120_000]) {
      time.advance(step);
      await live.market();
      await live.status();
    }
    expect(fake.calls).toHaveLength(3); // auth, market-open, lives-market — once
    time.advance(CLOSED_TTL_MS - (OPEN_TTL_MS + 1 + 60_000 + 120_000));
    await live.market();
    expect(fake.count(PATHS.open)).toBe(2);
    expect(fake.count(PATHS.live)).toBe(2);
  });

  it("does not retry a failed fetch sooner than 5 minutes while closed", async () => {
    const time = clock();
    let liveCalls = 0;
    const fake = upstream({
      [PATHS.auth]: authRoute,
      [PATHS.open]: openRoute("CLOSE"),
      [PATHS.live]: () => {
        liveCalls += 1;
        return liveCalls === 1 ? json(LIVE_ROWS) : new Response("", { status: 502 });
      },
    });
    const live = createLiveService({
      enabled: true,
      fetchImpl: fake.fetchImpl,
      now: time.now,
      tokenProvider: fakeTokenProvider(),
    });
    await live.market();
    time.advance(CLOSED_TTL_MS);
    expect((await live.market()).lastError).toContain("HTTP 502");
    time.advance(CLOSED_TTL_MS - 1);
    await live.market();
    expect(fake.count(PATHS.live)).toBe(2);
    time.advance(1);
    await live.market();
    expect(fake.count(PATHS.live)).toBe(3);
  });
});

describe("disabled mode", () => {
  it("NEPSE_LIVE=0 answers every route without touching the network", async () => {
    const fake = upstream({});
    const live = createLiveService({ env: { NEPSE_LIVE: "0" }, fetchImpl: fake.fetchImpl });
    expect(live.enabled).toBe(false);

    const status = fakeResponse();
    expect(await live.handle(new URL("http://127.0.0.1/api/live/status"), status.response)).toBe(true);
    expect(status.captured.status).toBe(200);
    expect(status.json()).toEqual({
      enabled: false,
      source: expect.any(String),
      marketOpen: null,
      asOf: null,
      lastError: null,
      disclaimer: LIVE_DISCLAIMER,
    });
    expect(await live.market()).toMatchObject({ enabled: false, rows: [], lastError: null });
    expect(await live.summary()).toMatchObject({ enabled: false, index: null, turnover: null });
    expect(await live.depth("NABIL")).toMatchObject({ enabled: false, bids: [], asks: [] });
    expect(fake.calls).toHaveLength(0);
  });

  it("is enabled by default", () => {
    expect(createLiveService({ env: {} }).enabled).toBe(true);
    expect(createLiveService({ env: { NEPSE_LIVE: "false" } }).enabled).toBe(false);
    expect(createLiveService({ env: { NEPSE_LIVE: "0" }, enabled: true }).enabled).toBe(true);
  });
});

describe("HTTP routes", () => {
  function service() {
    const time = clock();
    const fake = upstream({
      [PATHS.auth]: authRoute,
      [PATHS.open]: openRoute("OPEN"),
      [PATHS.live]: () => json(LIVE_ROWS),
      [PATHS.summary]: () =>
        json([
          { detail: "Total Turnover Rs:", value: 4567890123.45 },
          { detail: "Total Traded Shares", value: 12345678 },
          { detail: "Total Transactions", value: 98765 },
          { detail: "Total Scrips Traded", value: 312 },
        ]),
      [PATHS.index]: () =>
        json([
          { id: 57, index: "Sensitive Index", currentValue: 480.1 },
          { id: 58, index: "NEPSE Index", currentValue: 2701.25, change: -12.4, perChange: -0.45, generatedTime: "2026-11-15T11:45:00" },
        ]),
      [PATHS.securities]: () => json([{ id: 131, symbol: "NABIL" }]),
      [PATHS.depth]: () =>
        json({
          marketDepth: {
            buyMarketDepthList: [{ orderBookOrderPrice: 505, quantity: 100, orderCount: 3 }],
            sellMarketDepthList: [{ orderBookOrderPrice: 506, quantity: 40, orderCount: 2 }],
          },
        }),
    });
    const live = createLiveService({
      enabled: true,
      fetchImpl: fake.fetchImpl,
      now: time.now,
      tokenProvider: fakeTokenProvider(),
    });
    return { live, fake };
  }

  it("serves the market and summary shapes", async () => {
    const { live } = service();
    const market = fakeResponse();
    await live.handle(new URL("http://127.0.0.1/api/live/market"), market.response);
    expect(market.captured.headers?.["cache-control"]).toBe("no-store");
    expect(market.json()).toMatchObject({
      enabled: true,
      marketOpen: true,
      asOf: "2026-11-15T05:59:58.000Z",
      lastError: null,
      rows: [{ symbol: "NABIL", ltp: 505, change: 6, changePercent: 1.2, volume: 12345 }],
    });

    const summary = fakeResponse();
    await live.handle(new URL("http://127.0.0.1/api/live/summary"), summary.response);
    expect(summary.json()).toMatchObject({
      enabled: true,
      asOf: "2026-11-15T06:00:00.000Z",
      index: { value: 2701.25, change: -12.4, changePercent: -0.45 },
      turnover: 4567890123.45,
      sharesTraded: 12345678,
      transactions: 98765,
      scripsTraded: 312,
      lastError: null,
    });
  });

  it("serves market depth by symbol", async () => {
    const { live, fake } = service();
    const depth = fakeResponse();
    await live.handle(new URL("http://127.0.0.1/api/live/depth?symbol=nabil"), depth.response);
    expect(depth.json()).toMatchObject({
      enabled: true,
      symbol: "NABIL",
      bids: [{ price: 505, quantity: 100, orders: 3 }],
      asks: [{ price: 506, quantity: 40, orders: 2 }],
      lastError: null,
    });
    expect(fake.count(PATHS.securities)).toBe(1);

    const unknown = await live.depth("ZZZZ");
    expect(unknown).toMatchObject({ bids: [], asks: [], lastError: "ZZZZ is not in nepalstock.com's security list" });
    expect(fake.count(PATHS.securities)).toBe(1);

    const missing = fakeResponse();
    await live.handle(new URL("http://127.0.0.1/api/live/depth"), missing.response);
    expect(missing.captured.status).toBe(400);
    const invalid = fakeResponse();
    await live.handle(new URL("http://127.0.0.1/api/live/depth?symbol=../x"), invalid.response);
    expect(invalid.captured.status).toBe(400);
  });

  it("leaves other paths to the caller", async () => {
    const { live, fake } = service();
    const other = fakeResponse();
    expect(await live.handle(new URL("http://127.0.0.1/api/live/other"), other.response)).toBe(false);
    expect(await live.handle(new URL("http://127.0.0.1/api/health"), other.response)).toBe(false);
    expect(other.captured.status).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
  });
});

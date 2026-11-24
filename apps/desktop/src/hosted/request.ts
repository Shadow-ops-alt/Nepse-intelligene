import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computePortfolio,
  xirr,
  type PriceSnapshot,
  type TradeInput,
} from "@stock/analytics";
import type {
  CorporateLedgerEntry,
  DataState,
  DataStateSummary,
  JournalEntry,
  PortfolioResponse,
  PortfolioTransaction,
  ReconciliationImportResult,
  ReconciliationSummary,
  TradePlan,
} from "../types";

type Row = Record<string, unknown>;

const PERSONAL_PATHS = [
  /^\/api\/watchlist$/,
  /^\/api\/portfolio(?:\/|$)/,
  /^\/api\/trade-plans(?:\/|$)/,
  /^\/api\/journal(?:\/|$)/,
  /^\/api\/corporate-ledger(?:\/|$)/,
  /^\/api\/reconciliation(?:\/|$)/,
];

export function isHostedPath(path: string): boolean {
  const clean = path.split("?")[0] ?? path;
  return PERSONAL_PATHS.some((pattern) => pattern.test(clean));
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOr(value: unknown, fallback: number): number {
  return numberOrNull(value) ?? fallback;
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === "" ? null : text;
}

function round(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dataState(total: number, lastAsOf: string | null): DataStateSummary {
  const counts: Record<DataState, number> = {
    live: 0,
    delayed: 0,
    eod: total,
    stale: 0,
    unavailable: 0,
  };
  return {
    state: "eod",
    stale: false,
    total,
    counts,
    lastAsOf,
    classification: "UNVERIFIED",
  };
}

async function currentUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new Error("Your session has expired. Sign in again.");
  }
  return data.user.id;
}

function unwrap<T>(
  result: { data: T; error: { message: string } | null },
  fallback: string,
): T {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

async function localJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Quotes come from the local pack/API; Supabase only stores personal data. */
async function loadPrices(symbols: string[]): Promise<PriceSnapshot[]> {
  const wanted = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  const quotes = await localJson<{
    quotes?: Array<{ symbol?: string; ltp?: number; asOf?: string | null }>;
  }>("/api/quotes");
  const prices = new Map<string, PriceSnapshot>();
  for (const quote of quotes?.quotes ?? []) {
    const symbol = String(quote.symbol ?? "").toUpperCase();
    const price = numberOrNull(quote.ltp);
    if (!wanted.has(symbol) || price === null) continue;
    prices.set(symbol, { symbol, price, asOf: quote.asOf ?? null });
  }
  const missing = [...wanted].filter((symbol) => !prices.has(symbol)).slice(0, 40);
  await Promise.all(
    missing.map(async (symbol) => {
      const series = await localJson<{
        candles?: Array<{ timestamp?: string; close?: number }>;
      }>(`/api/candles?symbol=${encodeURIComponent(symbol)}`);
      const last = series?.candles?.at(-1);
      const price = numberOrNull(last?.close);
      if (price !== null) {
        prices.set(symbol, {
          symbol,
          price,
          asOf: textOrNull(last?.timestamp)?.slice(0, 10) ?? null,
        });
      }
    }),
  );
  return [...prices.values()];
}

function transactionFromRow(row: Row): PortfolioTransaction {
  return {
    id: Number(row.id),
    symbol: String(row.symbol ?? ""),
    side: row.side === "sell" ? "sell" : "buy",
    quantity: numberOr(row.quantity, 0),
    price: numberOr(row.price, 0),
    fees: numberOr(row.fees, 0),
    tradedAt: String(row.traded_at ?? ""),
    notes: textOrNull(row.notes),
    createdAt: String(row.created_at ?? ""),
  };
}

function tradeInput(transaction: PortfolioTransaction): TradeInput {
  return {
    symbol: transaction.symbol,
    side: transaction.side,
    quantity: transaction.quantity,
    price: transaction.price,
    fees: transaction.fees,
    tradedAt: transaction.tradedAt,
  };
}

async function selectTransactions(client: SupabaseClient): Promise<Row[]> {
  return unwrap(
    await client
      .from("portfolio_transactions")
      .select("*")
      .order("traded_at", { ascending: true })
      .order("id", { ascending: true }),
    "Could not load portfolio transactions.",
  ) as Row[];
}

async function portfolioResponse(client: SupabaseClient): Promise<PortfolioResponse> {
  const rows = await selectTransactions(client);
  const transactions = rows.map(transactionFromRow);
  const prices = await loadPrices(transactions.map((transaction) => transaction.symbol));
  const portfolio = computePortfolio(transactions.map(tradeInput), prices);
  const lastAsOf =
    prices
      .map((price) => price.asOf ?? null)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  return {
    providerId: "supabase",
    transactions,
    positions: portfolio.positions.map((position) => ({
      ...position,
      valuation: null,
    })),
    totals: portfolio.totals,
    warnings: portfolio.warnings,
    dataState: dataState(portfolio.positions.length, lastAsOf),
  };
}

function planFromRow(row: Row): TradePlan {
  let targets: number[] = [];
  if (Array.isArray(row.targets)) {
    targets = row.targets.map((value) => Number(value)).filter(Number.isFinite);
  } else if (typeof row.targets === "string") {
    try {
      const parsed = JSON.parse(row.targets) as unknown;
      if (Array.isArray(parsed)) {
        targets = parsed.map((value) => Number(value)).filter(Number.isFinite);
      }
    } catch {
      targets = [];
    }
  }
  return {
    id: Number(row.id),
    symbol: String(row.symbol ?? ""),
    side: row.side === "sell" ? "sell" : "buy",
    entry: numberOr(row.entry, 0),
    stop: numberOr(row.stop, 0),
    targets,
    quantity: numberOr(row.quantity, 0),
    riskAmount: numberOrNull(row.risk_amount),
    riskPercent: numberOrNull(row.risk_percent),
    rewardRisk: numberOrNull(row.reward_risk),
    fees: numberOrNull(row.fees),
    notes: textOrNull(row.notes),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function buildPlan(body: Row, existing: TradePlan | null, userId: string): Row {
  const symbol = String(body.symbol ?? existing?.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9._-]{1,24}$/.test(symbol)) throw new Error("invalid symbol");
  const side = String(body.side ?? existing?.side ?? "buy").toLowerCase();
  if (side !== "buy" && side !== "sell") throw new Error("side must be buy or sell");
  const entry = numberOrNull(body.entry) ?? existing?.entry ?? null;
  const stop = numberOrNull(body.stop) ?? existing?.stop ?? null;
  const quantity = numberOrNull(body.quantity) ?? existing?.quantity ?? null;
  if (entry === null || entry <= 0) throw new Error("entry must be positive");
  if (stop === null || stop <= 0) throw new Error("stop must be positive");
  if (quantity === null || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive integer");
  }
  const rawTargets = Array.isArray(body.targets)
    ? body.targets
    : existing?.targets ?? [];
  const targets = rawTargets
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (targets.length < 1 || targets.length > 3) {
    throw new Error("one to three targets are required");
  }
  if (side === "buy" && !(stop < entry && targets.every((target) => target > entry))) {
    throw new Error("for a buy, stop must be below entry and targets above it");
  }
  if (side === "sell" && !(stop > entry && targets.every((target) => target < entry))) {
    throw new Error("for a sell, stop must be above entry and targets below it");
  }
  const explicitRisk = Object.prototype.hasOwnProperty.call(body, "riskAmount")
    ? numberOrNull(body.riskAmount)
    : null;
  const risk = explicitRisk ?? Math.abs(entry - stop) * quantity;
  const explicitPercent = Object.prototype.hasOwnProperty.call(body, "riskPercent")
    ? numberOrNull(body.riskPercent)
    : null;
  const riskPercent =
    explicitPercent ??
    (entry > 0 && quantity > 0 ? (risk / (entry * quantity)) * 100 : null);
  const first = targets[0]!;
  const reward = (side === "buy" ? first - entry : entry - first) * quantity;
  const rewardRisk = risk > 0 ? reward / risk : null;
  return {
    user_id: userId,
    symbol,
    side,
    entry,
    stop,
    targets,
    quantity,
    risk_amount: round(risk),
    risk_percent: round(riskPercent),
    reward_risk: round(rewardRisk),
    fees: Object.prototype.hasOwnProperty.call(body, "fees")
      ? numberOrNull(body.fees)
      : existing?.fees ?? null,
    notes: Object.prototype.hasOwnProperty.call(body, "notes")
      ? textOrNull(body.notes)
      : existing?.notes ?? null,
  };
}

function journalFromRow(row: Row): JournalEntry & { snapshotUrl?: string } {
  const tags = Array.isArray(row.tags)
    ? row.tags.map((tag) => String(tag))
    : [];
  const image = textOrNull(row.snapshot_image);
  return {
    id: Number(row.id),
    planId: numberOrNull(row.plan_id),
    symbol: String(row.symbol ?? ""),
    side: row.side === "sell" ? "sell" : "buy",
    paper: row.paper === true,
    plannedEntry: numberOrNull(row.planned_entry),
    plannedStop: numberOrNull(row.planned_stop),
    plannedTarget: numberOrNull(row.planned_target),
    actualEntry: numberOrNull(row.actual_entry),
    actualExit: numberOrNull(row.actual_exit),
    quantity: numberOrNull(row.quantity),
    fees: numberOrNull(row.fees),
    pnl: numberOrNull(row.pnl),
    reason: textOrNull(row.reason),
    mistakes: textOrNull(row.mistakes),
    tags,
    snapshot: row.snapshot ?? null,
    hasSnapshot: Boolean(image),
    ...(image ? { snapshotUrl: image } : {}),
    openedAt: textOrNull(row.opened_at),
    closedAt: textOrNull(row.closed_at),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function journalPnl(
  side: string,
  entry: number | null,
  exit: number | null,
  quantity: number | null,
  fees: number | null,
): number | null {
  if (entry === null || exit === null || quantity === null) return null;
  const gross = (side === "sell" ? entry - exit : exit - entry) * quantity;
  return round(gross - (fees ?? 0));
}

function validateSnapshotImage(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("snapshotImage must be a data URL string or null");
  }
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) {
    throw new Error("snapshotImage must be a base64 PNG, JPEG or WebP data URL");
  }
  const base64 = value.slice(value.indexOf(",") + 1);
  const bytes = Math.ceil((base64.length * 3) / 4);
  if (bytes > 1.5 * 1024 * 1024) {
    throw new Error("snapshotImage is larger than 1.5 MB after decoding");
  }
  return value;
}

function journalRowFromBody(
  body: Row,
  existing: Row | null,
  userId: string,
  creating: boolean,
): Row {
  const symbol = String(body.symbol ?? existing?.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9._-]{1,24}$/.test(symbol)) throw new Error("invalid symbol");
  const side = String(body.side ?? existing?.side ?? "buy").toLowerCase();
  if (side !== "buy" && side !== "sell") throw new Error("side must be buy or sell");
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const pickNumber = (key: string, previous: unknown): number | null =>
    has(key) ? numberOrNull(body[key]) : numberOrNull(previous);
  const pickText = (key: string, previous: unknown): string | null =>
    has(key) ? textOrNull(body[key]) : textOrNull(previous);
  const actualEntry = pickNumber("actualEntry", existing?.actual_entry);
  const actualExit = pickNumber("actualExit", existing?.actual_exit);
  const quantity = pickNumber("quantity", existing?.quantity);
  const fees = pickNumber("fees", existing?.fees);
  const hasImage = has("snapshotImage");
  const image = hasImage
    ? validateSnapshotImage(body.snapshotImage)
    : textOrNull(existing?.snapshot_image);
  const snapshot =
    body.snapshot === undefined
      ? existing?.snapshot ?? null
      : typeof body.snapshot === "string"
        ? textOrNull(body.snapshot)
        : body.snapshot === null
          ? null
          : JSON.stringify(body.snapshot);
  return {
    user_id: userId,
    plan_id: pickNumber("planId", existing?.plan_id),
    symbol,
    side,
    paper: has("paper") ? body.paper === true : existing?.paper === true,
    planned_entry: pickNumber("plannedEntry", existing?.planned_entry),
    planned_stop: pickNumber("plannedStop", existing?.planned_stop),
    planned_target: pickNumber("plannedTarget", existing?.planned_target),
    actual_entry: actualEntry,
    actual_exit: actualExit,
    quantity,
    fees,
    pnl: journalPnl(side, actualEntry, actualExit, quantity, fees),
    reason: pickText("reason", existing?.reason),
    mistakes: pickText("mistakes", existing?.mistakes),
    tags: Array.isArray(body.tags)
      ? body.tags.map((tag) => String(tag))
      : Array.isArray(existing?.tags)
        ? existing.tags
        : [],
    snapshot,
    snapshot_image: image,
    opened_at: pickText("openedAt", existing?.opened_at),
    closed_at: pickText("closedAt", existing?.closed_at),
    ...(creating ? {} : {}),
  };
}

function ledgerFromRow(row: Row): CorporateLedgerEntry {
  return {
    id: Number(row.id),
    symbol: String(row.symbol ?? ""),
    kind: String(row.kind ?? "other"),
    exDate: textOrNull(row.ex_date),
    amount: numberOrNull(row.amount),
    shares: numberOrNull(row.shares),
    notes: textOrNull(row.notes),
    createdAt: String(row.created_at ?? ""),
  };
}

async function reconciliationSummary(
  client: SupabaseClient,
): Promise<ReconciliationSummary> {
  const transactions = (await selectTransactions(client)).map(transactionFromRow);
  const prices = await loadPrices(transactions.map((transaction) => transaction.symbol));
  const portfolio = computePortfolio(transactions.map(tradeInput), prices);
  const ledger = unwrap(
    await client.from("corporate_ledger").select("*"),
    "Could not load the corporate ledger.",
  ) as Row[];
  const imports = unwrap(
    await client
      .from("reconciliation_imports")
      .select("id,source,imported_at,rows_count")
      .order("imported_at", { ascending: false }),
    "Could not load reconciliation imports.",
  ) as Row[];
  const nptToday = new Date(Date.now() + 5.75 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  let dividends = 0;
  let bonusShares = 0;
  let rightsShares = 0;
  const flows: Array<{ date: string; amount: number }> = [];
  for (const transaction of transactions) {
    const gross = transaction.quantity * transaction.price;
    flows.push({
      date: transaction.tradedAt.slice(0, 10),
      amount:
        transaction.side === "buy"
          ? -(gross + transaction.fees)
          : gross - transaction.fees,
    });
  }
  for (const row of ledger) {
    const kind = String(row.kind ?? "");
    if (kind === "dividend") {
      const date = (textOrNull(row.ex_date) ?? String(row.created_at ?? "")).slice(0, 10);
      if (date && date <= nptToday) {
        const amount = numberOrNull(row.amount);
        dividends += amount ?? 0;
        if (amount !== null) flows.push({ date, amount });
      }
    } else if (kind === "bonus") {
      bonusShares += numberOrNull(row.shares) ?? 0;
    } else if (kind === "right") {
      rightsShares += numberOrNull(row.shares) ?? 0;
    }
  }
  const marketValue = portfolio.totals.marketValue;
  if (marketValue > 0) flows.push({ date: nptToday, amount: marketValue });
  const exposure = portfolio.positions
    .filter(
      (position) =>
        position.quantity > 0 &&
        position.marketValue !== null &&
        position.marketValue > 0,
    )
    .map((position) => ({
      symbol: position.symbol,
      marketValue: position.marketValue!,
      percent:
        marketValue > 0 ? (position.marketValue! / marketValue) * 100 : 0,
    }))
    .sort((a, b) => b.marketValue - a.marketValue || a.symbol.localeCompare(b.symbol));
  const top = exposure[0] ?? null;
  const hhi =
    marketValue > 0
      ? exposure.reduce(
          (sum, row) => sum + (row.marketValue / marketValue) ** 2,
          0,
        )
      : 0;
  return {
    realizedPnl: round(portfolio.totals.realizedPnl) ?? 0,
    unrealizedPnl: round(portfolio.totals.unrealizedPnl) ?? 0,
    totalPnl: round(portfolio.totals.totalPnl) ?? 0,
    xirr: xirr(flows),
    dividends: round(dividends) ?? 0,
    bonusShares: round(bonusShares, 4) ?? 0,
    rightsShares: round(rightsShares, 4) ?? 0,
    exposure: exposure.map((row) => ({
      symbol: row.symbol,
      marketValue: round(row.marketValue) ?? 0,
      percent: round(row.percent, 4) ?? 0,
    })),
    concentration: {
      topSymbol: top?.symbol ?? null,
      topPercent: round(top?.percent ?? 0, 4) ?? 0,
      hhi: round(hhi, 4) ?? 0,
    },
    imports: imports.map((row) => ({
      id: Number(row.id),
      source: String(row.source ?? ""),
      importedAt: String(row.imported_at ?? ""),
      rowsCount: Number(row.rows_count ?? 0),
    })),
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((line) => line.some((cell) => cell.trim() !== ""));
}

function parseReconciliationCsv(text: string): Row[] {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error("CSV has no data rows");
  const header = table[0]!.map((cell) => cell.trim().toLowerCase());
  const index = new Map(header.map((name, position) => [name, position]));
  for (const required of ["symbol", "side", "quantity", "price", "traded_at"]) {
    if (!index.has(required)) throw new Error(`CSV is missing the ${required} column`);
  }
  const rows: Row[] = [];
  table.slice(1).forEach((line, offset) => {
    const cell = (name: string) => {
      const position = index.get(name);
      return position === undefined ? "" : String(line[position] ?? "").trim();
    };
    const symbol = cell("symbol").toUpperCase();
    if (!symbol) return;
    const side = cell("side").toLowerCase();
    const quantity = Number(cell("quantity"));
    const price = Number(cell("price"));
    const fees = cell("fees") === "" ? 0 : Number(cell("fees"));
    const tradedAt = cell("traded_at");
    const lineNumber = offset + 2;
    if (!/^[A-Z0-9._-]{1,24}$/.test(symbol)) throw new Error(`row ${lineNumber}: invalid symbol`);
    if (side !== "buy" && side !== "sell") throw new Error(`row ${lineNumber}: side must be buy or sell`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`row ${lineNumber}: quantity must be positive`);
    if (!Number.isFinite(price) || price < 0) throw new Error(`row ${lineNumber}: price must be zero or positive`);
    if (!Number.isFinite(fees) || fees < 0) throw new Error(`row ${lineNumber}: fees must be zero or positive`);
    if (!/^\d{4}-\d{2}-\d{2}/.test(tradedAt)) throw new Error(`row ${lineNumber}: traded_at must start with YYYY-MM-DD`);
    rows.push({
      symbol,
      side,
      quantity,
      price,
      fees,
      traded_at: tradedAt,
      kind: cell("kind") || "trade",
      external_id: cell("external_id") || null,
      notes: cell("notes") || null,
      source: cell("source") || null,
    });
  });
  return rows;
}

export async function hostedRequest<T>(
  client: SupabaseClient,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const url = new URL(path, "http://hosted.local");
  const route = url.pathname;
  const body = init?.body ? (JSON.parse(String(init.body)) as Row) : {};

  if (route === "/api/watchlist") {
    if (method === "GET") {
      const rows = unwrap(
        await client.from("watchlist").select("symbol").order("symbol"),
        "Could not load the watchlist.",
      ) as Array<{ symbol: string }>;
      return { symbols: rows.map((row) => row.symbol) } as T;
    }
    if (method === "POST") {
      const userId = await currentUserId(client);
      const symbol = String(body.symbol ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9._-]{1,24}$/.test(symbol)) throw new Error("invalid symbol");
      if (body.action === "remove") {
        unwrap(
          await client.from("watchlist").delete().eq("symbol", symbol),
          "Could not remove the symbol.",
        );
      } else {
        unwrap(
          await client
            .from("watchlist")
            .upsert({ user_id: userId, symbol }, { onConflict: "user_id,symbol" }),
          "Could not add the symbol.",
        );
      }
      const rows = unwrap(
        await client.from("watchlist").select("symbol").order("symbol"),
        "Could not load the watchlist.",
      ) as Array<{ symbol: string }>;
      return { symbols: rows.map((row) => row.symbol) } as T;
    }
  }

  if (route === "/api/portfolio" && method === "GET") {
    return (await portfolioResponse(client)) as T;
  }

  if (route === "/api/portfolio/transactions" && method === "POST") {
    const userId = await currentUserId(client);
    const side = String(body.side ?? "").toLowerCase();
    const quantity = numberOrNull(body.quantity);
    const price = numberOrNull(body.price);
    const fees = numberOrNull(body.fees) ?? 0;
    const tradedAt = String(body.tradedAt ?? new Date().toISOString().slice(0, 10));
    if (side !== "buy" && side !== "sell") throw new Error("side must be buy or sell");
    if (quantity === null || quantity <= 0) throw new Error("quantity must be positive");
    if (price === null || price < 0) throw new Error("price must be zero or positive");
    if (fees < 0) throw new Error("fees must be zero or positive");
    if (!/^\d{4}-\d{2}-\d{2}/.test(tradedAt)) throw new Error("tradedAt must start with YYYY-MM-DD");
    const transaction = unwrap(
      await client
        .from("portfolio_transactions")
        .insert({
          user_id: userId,
          symbol: String(body.symbol ?? "").trim().toUpperCase(),
          side,
          quantity,
          price,
          fees,
          traded_at: tradedAt,
          notes: textOrNull(body.notes),
          kind: "trade",
        })
        .select()
        .single(),
      "Could not add the transaction.",
    ) as Row;
    return { transaction: transactionFromRow(transaction) } as T;
  }

  if (route === "/api/portfolio/transactions/remove" && method === "POST") {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("invalid transaction id");
    unwrap(
      await client.from("portfolio_transactions").delete().eq("id", id),
      "Could not remove the transaction.",
    );
    return { removed: true } as T;
  }

  if (route === "/api/trade-plans" || /^\/api\/trade-plans\/\d+$/.test(route)) {
    const idText = route.split("/").at(-1);
    const editing = idText && idText !== "trade-plans" ? Number(idText) : null;
    if (method === "GET" && editing === null) {
      let query = client.from("trade_plans").select("*").order("created_at", { ascending: false });
      const symbol = url.searchParams.get("symbol");
      if (symbol) query = query.eq("symbol", symbol.toUpperCase());
      const rows = unwrap(await query, "Could not load trade plans.") as Row[];
      return { plans: rows.map(planFromRow) } as T;
    }
    if (method === "POST" && editing === null) {
      const userId = await currentUserId(client);
      const row = buildPlan(body, null, userId);
      const plan = unwrap(
        await client.from("trade_plans").insert(row).select().single(),
        "Could not save the plan.",
      ) as Row;
      return { plan: planFromRow(plan) } as T;
    }
    if (editing !== null && method === "PATCH") {
      const userId = await currentUserId(client);
      const existing = unwrap(
        await client.from("trade_plans").select("*").eq("id", editing).single(),
        "Could not load the plan.",
      ) as Row;
      const row = buildPlan(body, planFromRow(existing), userId);
      const plan = unwrap(
        await client
          .from("trade_plans")
          .update(row)
          .eq("id", editing)
          .select()
          .single(),
        "Could not update the plan.",
      ) as Row;
      return { plan: planFromRow(plan) } as T;
    }
    if (editing !== null && method === "DELETE") {
      unwrap(
        await client.from("trade_plans").delete().eq("id", editing),
        "Could not delete the plan.",
      );
      return { deleted: true } as T;
    }
  }

  if (route === "/api/journal" || /^\/api\/journal\/\d+$/.test(route)) {
    const idText = route.split("/").at(-1);
    const editing = idText && idText !== "journal" ? Number(idText) : null;
    if (method === "GET" && editing === null) {
      const rows = unwrap(
        await client
          .from("trade_journal")
          .select("*")
          .order("opened_at", { ascending: false })
          .order("id", { ascending: false }),
        "Could not load the journal.",
      ) as Row[];
      return { entries: rows.map(journalFromRow) } as T;
    }
    if (method === "POST" && editing === null) {
      const userId = await currentUserId(client);
      const row = journalRowFromBody(body, null, userId, true);
      const entry = unwrap(
        await client.from("trade_journal").insert(row).select().single(),
        "Could not save the journal entry.",
      ) as Row;
      return { entry: journalFromRow(entry) } as T;
    }
    if (editing !== null && method === "PATCH") {
      const userId = await currentUserId(client);
      const existing = unwrap(
        await client.from("trade_journal").select("*").eq("id", editing).single(),
        "Could not load the journal entry.",
      ) as Row;
      const row = journalRowFromBody(body, existing, userId, false);
      const entry = unwrap(
        await client
          .from("trade_journal")
          .update(row)
          .eq("id", editing)
          .select()
          .single(),
        "Could not update the journal entry.",
      ) as Row;
      return { entry: journalFromRow(entry) } as T;
    }
    if (editing !== null && method === "DELETE") {
      unwrap(
        await client.from("trade_journal").delete().eq("id", editing),
        "Could not delete the journal entry.",
      );
      return { deleted: true } as T;
    }
  }

  if (route === "/api/corporate-ledger" || /^\/api\/corporate-ledger\/\d+$/.test(route)) {
    const idText = route.split("/").at(-1);
    const editing = idText && idText !== "corporate-ledger" ? Number(idText) : null;
    if (method === "GET" && editing === null) {
      const rows = unwrap(
        await client
          .from("corporate_ledger")
          .select("*")
          .order("created_at", { ascending: false }),
        "Could not load the corporate ledger.",
      ) as Row[];
      return { entries: rows.map(ledgerFromRow) } as T;
    }
    if (method === "POST" && editing === null) {
      const userId = await currentUserId(client);
      const kind = String(body.kind ?? "other").toLowerCase();
      if (!["dividend", "bonus", "right", "other"].includes(kind)) {
        throw new Error("kind must be dividend, bonus, right or other");
      }
      const entry = unwrap(
        await client
          .from("corporate_ledger")
          .insert({
            user_id: userId,
            symbol: String(body.symbol ?? "").trim().toUpperCase(),
            kind,
            ex_date: textOrNull(body.exDate),
            amount: numberOrNull(body.amount),
            shares: numberOrNull(body.shares),
            notes: textOrNull(body.notes),
          })
          .select()
          .single(),
        "Could not add the ledger entry.",
      ) as Row;
      return { entry: ledgerFromRow(entry) } as T;
    }
    if (editing !== null && method === "DELETE") {
      unwrap(
        await client.from("corporate_ledger").delete().eq("id", editing),
        "Could not delete the ledger entry.",
      );
      return { deleted: true } as T;
    }
  }

  if (route === "/api/reconciliation/summary" && method === "GET") {
    return (await reconciliationSummary(client)) as T;
  }

  if (route === "/api/reconciliation/transactions" && method === "GET") {
    const rows = await selectTransactions(client);
    return { transactions: rows.map(transactionFromRow) } as T;
  }

  if (route === "/api/reconciliation/import" && method === "POST") {
    const userId = await currentUserId(client);
    const source = String(body.source ?? "").trim();
    const csv = typeof body.csv === "string" ? body.csv : "";
    if (!source) throw new Error("source is required");
    if (csv.trim() === "") throw new Error("csv is required");
    const rows = parseReconciliationCsv(csv);
    const existing = unwrap(
      await client
        .from("portfolio_transactions")
        .select("external_id")
        .not("external_id", "is", null),
      "Could not check existing transactions.",
    ) as Array<{ external_id: string }>;
    const seen = new Set(existing.map((row) => row.external_id));
    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      const external = textOrNull(row.external_id);
      if (external && seen.has(external)) {
        skipped += 1;
        continue;
      }
      if (external) seen.add(external);
      unwrap(
        await client.from("portfolio_transactions").insert({
          user_id: userId,
          symbol: row.symbol,
          side: row.side,
          quantity: row.quantity,
          price: row.price,
          fees: row.fees,
          traded_at: row.traded_at,
          kind: row.kind ?? "trade",
          external_id: external,
          notes: row.notes,
          source,
        }),
        "Could not import a transaction.",
      );
      imported += 1;
    }
    const record = unwrap(
      await client
        .from("reconciliation_imports")
        .insert({
          user_id: userId,
          source,
          rows_count: rows.length,
          summary: { imported, skipped },
        })
        .select("id")
        .single(),
      "Could not record the import.",
    ) as { id: number };
    const result: ReconciliationImportResult = {
      imported,
      skipped,
      importId: Number(record.id),
    };
    return result as T;
  }

  throw new Error(`Hosted mode does not support ${method} ${route}`);
}

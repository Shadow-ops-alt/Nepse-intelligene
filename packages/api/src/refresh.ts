import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MarketDataProvider, RuntimePolicy } from "@stock/core";
import type { PersonalStore } from "@stock/store";
import {
  runPersonalRefresh,
  type PersonalRefreshResult,
  type RefreshPhase,
} from "@stock/personal";

/**
 * Background refresh for the packaged desktop app.
 *
 * The client should never have to run `pnpm personal:update` or copy CSV
 * files. This service checks the public archive on startup and then every
 * few hours while the app is open, imports any new end-of-day sessions, and
 * exposes its state over the local API. It is deliberately conservative:
 * one run at a time, no run while a manual import is active, exponential
 * backoff after failures, and no timer when automatic updates are disabled.
 */

export type AutoRefreshPhase = RefreshPhase | "idle" | "done" | "error";

export interface RefreshSummary {
  startedAt: string;
  finishedAt: string;
  commit: string;
  companies: number;
  candles: number;
  quotes: number;
  latestSession: string | null;
  bulkFailures: number;
  detailsFailures: number;
  warnings: number;
  /** True when the archive came from the checkout on disk, not a fresh fetch. */
  cached: boolean;
  /** Clear "using cached data" sentence when the remote could not be checked. */
  cacheNote: string | null;
}

export interface RefreshStatus {
  enabled: boolean;
  running: boolean;
  phase: AutoRefreshPhase;
  reason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextCheckAt: string | null;
  consecutiveFailures: number;
  intervalMinutes: number;
  commit: string | null;
  latestSession: string | null;
  detailsEnabled: boolean;
  lastProgress: string | null;
  lastResult: RefreshSummary | null;
}

export interface AutoRefreshOptions {
  enabled: boolean;
  dataDir: string;
  store: PersonalStore;
  provider: MarketDataProvider | null;
  policy: RuntimePolicy;
  env?: NodeJS.ProcessEnv;
  /** Minutes between successful refreshes. Default 360 (six hours). */
  intervalMinutes?: number;
  /** Delay before the first check after the API starts. Default 8 s. */
  initialDelayMs?: number;
  /** Include the slower profile/fundamentals pass. Default false. */
  details?: boolean;
  /** Called after a successful import so caches can be invalidated. */
  onChanged?: () => void;
  /** Returns true while a manual import is writing to the same store. */
  isBusy?: () => boolean;
  /** Injectable for tests. */
  runRefresh?: typeof runPersonalRefresh;
  now?: () => Date;
}

export interface AutoRefreshHandle {
  start: () => void;
  stop: () => void;
  status: () => RefreshStatus;
  runNow: (
    reason: string,
    options?: { force?: boolean; details?: boolean },
  ) => Promise<PersonalRefreshResult>;
}

interface PersistedRefresh {
  lastSuccessAt?: string | null;
  lastError?: string | null;
  finishedAt?: string | null;
  consecutiveFailures?: number;
  commit?: string | null;
  latestSession?: string | null;
  lastResult?: RefreshSummary | null;
}

const STATUS_FILE = "auto-refresh.json";
const MIN_INTERVAL_MINUTES = 15;
const MAX_BACKOFF_MINUTES = 6 * 60;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turn a low-level refresh failure into a sentence a client can act on.
 * Unknown messages are returned unchanged so the real cause is not hidden.
 */
function friendlyError(error: unknown): string {
  const raw = message(error).trim();
  if (raw === "") return "the update failed for an unknown reason";
  const lower = raw.toLowerCase();
  if (/automatic updates are disabled/.test(lower)) {
    return "automatic updates are turned off. Open the Data page to turn them on, or set NEPSE_AUTO_REFRESH=1.";
  }
  if (/already running|another import is already active/.test(lower)) {
    return "another import is already running. Wait for it to finish, then try again.";
  }
  if (
    /enotfound|eai_again|econnrefused|econnreset|etimedout|fetch failed|network|getaddrinfo/.test(
      lower,
    )
  ) {
    return "could not reach the update server. Check the internet connection; the app will retry automatically.";
  }
  if (/http 429|rate limit|too many requests/.test(lower)) {
    return "the public update server is rate limiting requests. The app will retry automatically later.";
  }
  if (/http 403/.test(lower)) {
    return "the public update server refused the request (HTTP 403). The app will retry later.";
  }
  if (/http 5\d\d/.test(lower)) {
    return "the public update server returned a server error. The app will retry automatically.";
  }
  if (/timed? ?out|timeout|aborted/.test(lower)) {
    return "the update timed out. The app will retry automatically.";
  }
  return raw;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function summarize(result: PersonalRefreshResult): RefreshSummary {
  return {
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    commit: result.commit,
    companies: result.sync.companies,
    candles: result.sync.candleRows,
    quotes: result.sync.quotes,
    latestSession: result.archive.totals.latestSession,
    bulkFailures: result.bulk?.failureCount ?? 0,
    detailsFailures: result.details?.failures.length ?? 0,
    warnings: result.warnings.length,
    cached: result.archive.cached === true,
    cacheNote:
      result.archive.cached === true
        ? (result.warnings.find((warning) => /^Using cached data/i.test(warning)) ??
          null)
        : null,
  };
}

export function createAutoRefresh(
  options: AutoRefreshOptions,
): AutoRefreshHandle {
  const env = options.env ?? process.env;
  const dataDir = options.dataDir;
  const statusPath = join(dataDir, "reports", STATUS_FILE);
  const now = options.now ?? (() => new Date());
  const intervalMinutes = Math.max(
    MIN_INTERVAL_MINUTES,
    options.intervalMinutes ??
      positiveNumber(env.NEPSE_AUTO_REFRESH_INTERVAL_MINUTES, 360),
  );
  const intervalMs = intervalMinutes * 60_000;
  const initialDelayMs = Math.max(
    0,
    options.initialDelayMs ??
      positiveNumber(env.NEPSE_AUTO_REFRESH_INITIAL_DELAY_MS, 8_000),
  );
  const detailsEnabled =
    options.details ?? env.NEPSE_AUTO_DETAILS === "1";
  const runRefresh = options.runRefresh ?? runPersonalRefresh;

  let persisted: PersistedRefresh = {};
  try {
    if (existsSync(statusPath)) {
      persisted = JSON.parse(readFileSync(statusPath, "utf8")) as PersistedRefresh;
    }
  } catch {
    // A damaged status file must not stop the app from starting.
  }

  let running = false;
  // Set by stop() so a run that finishes after the server closed cannot
  // schedule a new timer against a closed store.
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let nextCheckAt: string | null = null;
  let lastProgress: string | null = null;
  const state = {
    phase: "idle" as AutoRefreshPhase,
    reason: null as string | null,
    startedAt: null as string | null,
    finishedAt: persisted.finishedAt ?? null,
    lastSuccessAt: persisted.lastSuccessAt ?? null,
    lastError: persisted.lastError ?? null,
    consecutiveFailures: Math.max(0, persisted.consecutiveFailures ?? 0),
    commit: persisted.commit ?? null,
    latestSession: persisted.latestSession ?? null,
    lastResult: persisted.lastResult ?? null,
  };

  const persist = (): void => {
    try {
      mkdirSync(dirname(statusPath), { recursive: true });
      writeFileSync(
        statusPath,
        `${JSON.stringify(
          {
            lastSuccessAt: state.lastSuccessAt,
            lastError: state.lastError,
            finishedAt: state.finishedAt,
            consecutiveFailures: state.consecutiveFailures,
            commit: state.commit,
            latestSession: state.latestSession,
            lastResult: state.lastResult,
          } satisfies PersistedRefresh,
          null,
          2,
        )}\n`,
        "utf8",
      );
    } catch {
      // Status persistence is best effort; the live status stays in memory.
    }
  };

  const status = (): RefreshStatus => ({
    enabled: options.enabled,
    running,
    phase: state.phase,
    reason: state.reason,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    nextCheckAt,
    consecutiveFailures: state.consecutiveFailures,
    intervalMinutes,
    commit: state.commit,
    latestSession: state.latestSession,
    detailsEnabled,
    lastProgress,
    lastResult: state.lastResult,
  });

  const backoffMs = (): number =>
    Math.min(
      intervalMs,
      Math.min(
        MAX_BACKOFF_MINUTES,
        15 * 2 ** Math.min(Math.max(0, state.consecutiveFailures - 1), 5),
      ) * 60_000,
    );

  const schedule = (delayMs: number): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!options.enabled || stopped) {
      nextCheckAt = null;
      return;
    }
    const wait = Math.max(0, delayMs);
    nextCheckAt = new Date(now().getTime() + wait).toISOString();
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, wait);
    // A background refresh must never keep the API process alive by itself.
    timer.unref?.();
  };

  const dueInMs = (): number => {
    const reference =
      state.consecutiveFailures > 0 ? state.finishedAt : state.lastSuccessAt;
    if (!reference) return 0;
    const referenceMs = Date.parse(reference);
    if (!Number.isFinite(referenceMs)) return 0;
    const wait = state.consecutiveFailures > 0 ? backoffMs() : intervalMs;
    return Math.max(0, wait - (now().getTime() - referenceMs));
  };

  const runNow = async (
    reason: string,
    runOptions: { force?: boolean; details?: boolean } = {},
  ): Promise<PersonalRefreshResult> => {
    if (!options.enabled) {
      throw new Error(
        "automatic updates are disabled (set NEPSE_AUTO_REFRESH=1 to enable)",
      );
    }
    if (running) {
      throw new Error("an automatic update is already running");
    }
    if (options.isBusy?.()) {
      throw new Error("another import is already running");
    }
    if (!options.provider) {
      throw new Error("the free-source provider is unavailable");
    }

    running = true;
    state.phase = "checking";
    state.reason = reason;
    state.startedAt = now().toISOString();
    state.finishedAt = null;
    state.lastError = null;
    lastProgress = null;
    nextCheckAt = null;

    try {
      const result = await runRefresh({
        dataDir,
        store: options.store,
        provider: options.provider,
        policy: options.policy,
        ...(runOptions.force ? { force: true } : {}),
        includeDetails: runOptions.details ?? detailsEnabled,
        onPhase: (phase) => {
          state.phase = phase;
        },
        onProgress: (line) => {
          lastProgress = line;
        },
        now: now(),
      });
      state.phase = "done";
      state.finishedAt = result.finishedAt;
      state.lastSuccessAt = result.finishedAt;
      state.commit = result.commit;
      state.latestSession = result.archive.totals.latestSession;
      state.lastError = null;
      state.consecutiveFailures = 0;
      state.lastResult = summarize(result);
      lastProgress = null;
      persist();
      options.onChanged?.();
      return result;
    } catch (error) {
      state.phase = "error";
      state.finishedAt = now().toISOString();
      state.lastError = friendlyError(error);
      state.consecutiveFailures += 1;
      persist();
      throw error;
    } finally {
      running = false;
      schedule(
        state.consecutiveFailures > 0 ? backoffMs() : intervalMs,
      );
    }
  };

  const tick = async (): Promise<void> => {
    if (!options.enabled || stopped) return;
    if (running) {
      schedule(intervalMs);
      return;
    }
    if (options.isBusy?.()) {
      schedule(60_000);
      return;
    }
    const due = dueInMs();
    if (due > 0) {
      schedule(due);
      return;
    }
    try {
      await runNow("scheduled");
    } catch {
      // The status object carries the failure and the next retry time.
    }
    if (!timer) schedule(state.consecutiveFailures > 0 ? backoffMs() : intervalMs);
  };

  return {
    start: () => {
      stopped = false;
      if (!options.enabled || timer) return;
      schedule(initialDelayMs);
    },
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      nextCheckAt = null;
    },
    status,
    runNow,
  };
}

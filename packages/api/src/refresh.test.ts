import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MarketDataProvider, RuntimePolicy } from "@stock/core";
import type { PersonalStore } from "@stock/store";
import type {
  PersonalRefreshOptions,
  PersonalRefreshResult,
} from "@stock/personal";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAutoRefresh,
  type AutoRefreshHandle,
  type AutoRefreshOptions,
} from "./refresh";

const directories: string[] = [];

function temporary(): string {
  const directory = mkdtempSync(join(tmpdir(), "stock-refresh-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  vi.useRealTimers();
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

function refreshResult(
  overrides: { finishedAt?: string; latestSession?: string } = {},
): PersonalRefreshResult {
  return {
    startedAt: "2026-11-21T00:00:00.000Z",
    finishedAt: overrides.finishedAt ?? "2026-11-21T00:05:00.000Z",
    commit: "abc123def4567890",
    archive: {
      totals: { latestSession: overrides.latestSession ?? "2026-11-20" },
    },
    bulk: { failureCount: 2 },
    details: { failures: ["NABIL"] },
    sync: { companies: 471, candleRows: 481_627, quotes: 471 },
    warnings: ["one", "two"],
  } as unknown as PersonalRefreshResult;
}

function options(
  dataDir: string,
  runRefresh: AutoRefreshOptions["runRefresh"],
  overrides: Partial<AutoRefreshOptions> = {},
): AutoRefreshOptions {
  return {
    enabled: true,
    dataDir,
    store: {} as PersonalStore,
    provider: {} as MarketDataProvider,
    policy: {} as RuntimePolicy,
    intervalMinutes: 15,
    initialDelayMs: 10,
    runRefresh,
    now: () => new Date("2026-11-21T00:00:00.000Z"),
    ...overrides,
  };
}

describe("createAutoRefresh", () => {
  it("runs the refresh pipeline and records a persisted summary", async () => {
    const dataDir = temporary();
    const onChanged = vi.fn();
    const runRefresh = vi.fn(async () => refreshResult());
    const handle = createAutoRefresh(
      options(dataDir, runRefresh, { onChanged }),
    );

    const result = await handle.runNow("manual");

    expect(result.commit).toBe("abc123def4567890");
    expect(runRefresh).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);

    const status = handle.status();
    expect(status).toMatchObject({
      enabled: true,
      running: false,
      phase: "done",
      reason: "manual",
      lastSuccessAt: "2026-11-21T00:05:00.000Z",
      lastError: null,
      consecutiveFailures: 0,
      commit: "abc123def4567890",
      latestSession: "2026-11-20",
      intervalMinutes: 15,
      detailsEnabled: false,
    });
    expect(status.lastResult).toMatchObject({
      companies: 471,
      candles: 481_627,
      quotes: 471,
      latestSession: "2026-11-20",
      bulkFailures: 2,
      detailsFailures: 1,
      warnings: 2,
    });

    const file = join(dataDir, "reports", "auto-refresh.json");
    expect(existsSync(file)).toBe(true);
    const persisted = JSON.parse(readFileSync(file, "utf8")) as {
      lastSuccessAt: string;
      commit: string;
    };
    expect(persisted).toMatchObject({
      lastSuccessAt: "2026-11-21T00:05:00.000Z",
      commit: "abc123def4567890",
    });
  });

  it("records a failure, increments the counter and schedules a retry", async () => {
    const dataDir = temporary();
    const handle = createAutoRefresh(
      options(dataDir, async () => {
        throw new Error("archive unreachable");
      }),
    );

    await expect(handle.runNow("manual")).rejects.toThrow(
      "archive unreachable",
    );

    const status = handle.status();
    expect(status).toMatchObject({
      running: false,
      phase: "error",
      lastError: "archive unreachable",
      consecutiveFailures: 1,
      lastSuccessAt: null,
    });
    expect(status.nextCheckAt).toBe("2026-11-21T00:15:00.000Z");
  });

  it("keeps the last success when a later run fails", async () => {
    const dataDir = temporary();
    let fail = false;
    const handle = createAutoRefresh(
      options(dataDir, async () => {
        if (fail) throw new Error("second run failed");
        return refreshResult();
      }),
    );

    await handle.runNow("manual");
    fail = true;
    await expect(handle.runNow("manual")).rejects.toThrow("second run failed");

    const status = handle.status();
    expect(status.lastSuccessAt).toBe("2026-11-21T00:05:00.000Z");
    expect(status.lastError).toBe("second run failed");
    expect(status.consecutiveFailures).toBe(1);
    expect(status.commit).toBe("abc123def4567890");
  });

  it("refuses to run when automatic updates are disabled", async () => {
    const dataDir = temporary();
    const runRefresh = vi.fn(async () => refreshResult());
    const handle = createAutoRefresh(
      options(dataDir, runRefresh, { enabled: false }),
    );

    await expect(handle.runNow("manual")).rejects.toThrow(
      /automatic updates are disabled/,
    );
    handle.start();
    expect(handle.status().nextCheckAt).toBeNull();
    expect(runRefresh).not.toHaveBeenCalled();
  });

  it("refuses to run while another import is active", async () => {
    const dataDir = temporary();
    const handle = createAutoRefresh(
      options(dataDir, async () => refreshResult(), {
        isBusy: () => true,
      }),
    );

    await expect(handle.runNow("manual")).rejects.toThrow(
      /another import is already running/,
    );
    expect(handle.status().running).toBe(false);
  });

  it("allows only one run at a time", async () => {
    const dataDir = temporary();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    let handle: AutoRefreshHandle;
    const runRefresh = async (
      refreshOptions: PersonalRefreshOptions,
    ): Promise<PersonalRefreshResult> => {
      refreshOptions.onPhase?.("archive");
      expect(handle.status().phase).toBe("archive");
      await gate;
      return refreshResult();
    };
    handle = createAutoRefresh(options(dataDir, runRefresh));

    const first = handle.runNow("manual");
    await Promise.resolve();
    await expect(handle.runNow("manual")).rejects.toThrow(
      /already running/,
    );
    release?.();
    await first;

    expect(handle.status().phase).toBe("done");
    expect(handle.status().running).toBe(false);
  });

  it("loads the persisted status into a new instance", async () => {
    const dataDir = temporary();
    const first = createAutoRefresh(
      options(dataDir, async () => refreshResult()),
    );
    await first.runNow("manual");

    const second = createAutoRefresh(
      options(dataDir, async () => refreshResult()),
    );
    const status = second.status();
    expect(status.lastSuccessAt).toBe("2026-11-21T00:05:00.000Z");
    expect(status.commit).toBe("abc123def4567890");
    expect(status.latestSession).toBe("2026-11-20");
    expect(status.lastResult?.candles).toBe(481_627);
  });

  it("lets a manual run request the slow details pass", async () => {
    const dataDir = temporary();
    const runRefresh = vi.fn(async () => refreshResult());
    const handle = createAutoRefresh(options(dataDir, runRefresh));

    await handle.runNow("manual");
    expect(runRefresh).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeDetails: false }),
    );

    await handle.runNow("manual", { details: true });
    expect(runRefresh).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeDetails: true }),
    );
  });

  it("enforces the minimum interval and reads the details flag", () => {
    const dataDir = temporary();
    const handle = createAutoRefresh(
      options(dataDir, async () => refreshResult(), {
        intervalMinutes: 1,
        env: { NEPSE_AUTO_DETAILS: "1" },
      }),
    );
    expect(handle.status().intervalMinutes).toBe(15);
    expect(handle.status().detailsEnabled).toBe(true);
  });

  it("starts on schedule and stops cleanly", async () => {
    vi.useFakeTimers();
    const dataDir = temporary();
    const runRefresh = vi.fn(async () => refreshResult());
    const handle = createAutoRefresh(options(dataDir, runRefresh));

    handle.start();
    expect(runRefresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(9);
    expect(runRefresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runRefresh).toHaveBeenCalledTimes(1);
    expect(handle.status().phase).toBe("done");

    handle.stop();
    expect(handle.status().nextCheckAt).toBeNull();
  });
});

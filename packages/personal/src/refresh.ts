import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MarketDataProvider, RuntimePolicy } from "@stock/core";
import type { PersonalStore } from "@stock/store";
import { acquireNepseSource, type AcquireResult, type AcquireTransport } from "./acquire";
import { acquireBulkData, type BulkResult } from "./web/bulk";
import {
  acquireCompanyDetails,
  type CompanyDetailsResult,
} from "./web/company-details";
import { syncPersonalData, type SyncResult } from "./sync";
import {
  validateImportedStore,
  type ImportValidationReport,
} from "./validate-import";

/**
 * One automatic refresh = the same pipeline as `pnpm personal:update`:
 * fetch and normalize the public archive, fetch the public web datasets,
 * then import everything into the local store.
 *
 * The desktop app calls this in the background so the client never has to
 * run a command or copy CSV files. It is deliberately separate from the CLI
 * so both paths share exactly one implementation.
 */

export type RefreshPhase =
  | "checking"
  | "archive"
  | "bulk"
  | "details"
  | "sync";

export interface PersonalRefreshOptions {
  dataDir: string;
  store: PersonalStore;
  provider: MarketDataProvider;
  policy: RuntimePolicy;
  /** History start for the archive import. Default 1990-01-01. */
  from?: string;
  /** History end. Default today (UTC). */
  to?: string;
  /** Ignore HTTP/page caches and refetch every source. */
  force?: boolean;
  /** Include the slower profile/fundamentals pass. Default false. */
  includeDetails?: boolean;
  /** Reuse cached company pages younger than this. Default 7 days. */
  detailsMaxAgeMinutes?: number;
  /**
   * Archive transport. The client path is HTTPS-only because a packaged
   * desktop app cannot assume git is installed. Developers can pass "git" or
   * "auto" explicitly.
   */
  transport?: AcquireTransport;
  onPhase?: (phase: RefreshPhase) => void;
  onProgress?: (message: string) => void;
  now?: Date;
}

export interface PersonalRefreshResult {
  startedAt: string;
  finishedAt: string;
  commit: string;
  archive: AcquireResult;
  bulk: BulkResult | null;
  details: CompanyDetailsResult | null;
  sync: SyncResult;
  /** Post-import checks; null if the checks themselves could not run. */
  validation: ImportValidationReport | null;
  warnings: string[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Turn the acquisition module's "fell back to the checkout on disk" warning
 * into a sentence a client can act on. The detailed cause is kept so support
 * can still see what failed.
 */
function cachedArchiveWarning(warning: string, retrievedAt: string): string {
  const detail = warning
    .replace(/;?\s*using the cached (archive|checkout).*$/i, "")
    .trim()
    .replace(/[.;]+$/, "");
  const cachedAt = retrievedAt ? retrievedAt.slice(0, 10) : "an earlier run";
  const cause = detail.length > 0 ? ` ${detail}.` : "";
  return `Using cached data from ${cachedAt}.${cause} No new history was added; the app will retry automatically.`;
}

export async function runPersonalRefresh(
  options: PersonalRefreshOptions,
): Promise<PersonalRefreshResult> {
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  const to = options.to ?? today(now);
  const from = options.from ?? "1990-01-01";
  const warnings: string[] = [];
  const reportsDir = join(options.dataDir, "reports");

  // The archive, bulk and details passes all write reports beside the data.
  // Create the directory up front so a first run cannot fail late.
  try {
    mkdirSync(reportsDir, { recursive: true });
  } catch (error) {
    throw new Error(
      `cannot create the reports directory ${reportsDir}: ${message(error)}`,
    );
  }

  options.onPhase?.("archive");
  options.onProgress?.("fetching the public NEPSE archive");
  const archive = await acquireNepseSource({
    outputDir: options.dataDir,
    transport: options.transport ?? "http",
    ...(options.force !== undefined ? { force: options.force } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    now,
  });
  const offlineWarning = archive.warnings.find((warning) =>
    /could not check|could not refresh|using the cached (archive|checkout)/i.test(
      warning,
    ),
  );
  if (offlineWarning) {
    warnings.push(cachedArchiveWarning(offlineWarning, archive.retrievedAt));
    warnings.push(
      ...archive.warnings.filter((warning) => warning !== offlineWarning),
    );
  } else {
    warnings.push(...archive.warnings);
  }

  options.onPhase?.("bulk");
  options.onProgress?.("fetching public market, index, floorsheet and news datasets");
  let bulk: BulkResult | null = null;
  try {
    bulk = await acquireBulkData({
      dataDir: options.dataDir,
      from,
      to,
      ...(options.force !== undefined ? { force: options.force } : {}),
      now,
      onProgress: (line) => options.onProgress?.(line),
    });
    if (bulk.failureCount > 0) {
      warnings.push(
        `${bulk.failureCount} public web source request${bulk.failureCount === 1 ? "" : "s"} failed; the archive import continues and the failures are in ${bulk.reportPath}`,
      );
    }
  } catch (error) {
    warnings.push(`public web datasets unavailable: ${message(error)}`);
  }

  let details: CompanyDetailsResult | null = null;
  if (options.includeDetails) {
    options.onPhase?.("details");
    options.onProgress?.("refreshing company profiles and fundamentals");
    try {
      details = await acquireCompanyDetails({
        dataDir: options.dataDir,
        ...(options.force !== undefined ? { force: options.force } : {}),
        maxAgeMinutes: options.detailsMaxAgeMinutes ?? 10_080,
        now,
        onProgress: (line) => options.onProgress?.(line),
      });
      if (details.failures.length > 0) {
        warnings.push(
          `${details.failures.length} company detail page${details.failures.length === 1 ? "" : "s"} failed; the import continues`,
        );
      }
    } catch (error) {
      warnings.push(`company details unavailable: ${message(error)}`);
    }
  }

  options.onPhase?.("sync");
  options.onProgress?.("importing into the local database");
  const files = [
    ...archive.files,
    ...(bulk?.files ?? []),
    ...(details
      ? [details.companyFile, details.corporateActionsFile, details.companyEventsFile]
      : []),
  ];
  const uniqueFiles = [...new Set(files)];
  const sync = await syncPersonalData({
    provider: options.provider,
    policy: options.policy,
    store: options.store,
    from,
    to,
    files: uniqueFiles,
    dataDir: options.dataDir,
    onProgress: (line) => options.onProgress?.(line),
  });
  warnings.push(...sync.warnings);

  // Report-only data quality pass. It never deletes or rewrites a row: the
  // report lands beside the import and at most a few lines reach the user.
  let validation: ImportValidationReport | null = null;
  try {
    validation = validateImportedStore({
      store: options.store,
      providerId: sync.providerId,
      now,
    });
    const validationPath = join(reportsDir, "validation.json");
    writeFileSync(validationPath, `${JSON.stringify(validation, null, 2)}\n`);
    for (const issue of validation.issues.slice(0, 3)) {
      warnings.push(`Data validation: ${issue.message}`);
    }
    const remaining = validation.issues.length - 3;
    if (remaining > 0) {
      warnings.push(
        `Data validation: ${remaining} more issue${remaining === 1 ? "" : "s"} in ${validationPath}`,
      );
    }
  } catch (error) {
    warnings.push(`data validation could not run: ${message(error)}`);
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    commit: archive.commit,
    archive,
    bulk,
    details,
    sync,
    validation,
    warnings,
  };
}

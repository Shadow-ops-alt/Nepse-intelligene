#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { Command } from "commander";
import { AggregateProviderError, policyFromEnv } from "@stock/core";
import { createProvider } from "@stock/providers";
import { PersonalStore } from "@stock/store";
import { assertPersonalMode, PERSONAL_MODE_BANNER } from "./mode";
import { syncPersonalData } from "./sync";
import { analyzeCandles } from "./analysis";
import { acquireNepseSource, NEPSE_SOURCE_URL } from "./acquire";
import { acquireCompanyDetails } from "./web/company-details";
import { acquireBulkData } from "./web/bulk";

const invocationDir = process.env.INIT_CWD ?? process.cwd();

try {
  loadEnvFile(resolve(invocationDir, ".env"));
} catch {
  // .env is optional.
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function describeError(error: unknown): string {
  if (error instanceof AggregateProviderError) {
    const inner = error.errors
      .map((item) => item.message)
      .filter((message) => message.length > 0);
    return inner.length > 0 ? inner.join("; ") : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function defaultFrom(): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 5);
  return isoDate(date);
}

function openStore(dbPath: string): PersonalStore {
  const absolute = resolve(invocationDir, dbPath);
  mkdirSync(dirname(absolute), { recursive: true });
  return new PersonalStore(absolute);
}

const program = new Command();
program
  .name("personal")
  .description("Personal research mode for the NEPSE terminal")
  .version("0.1.0");

program
  .command("sync")
  .description("Load free-source files into the local SQLite store")
  .option(
    "--data-dir <path>",
    "free-source CSV directory",
    process.env.PERSONAL_DATA_DIR ?? "./data/personal",
  )
  .option(
    "--db <path>",
    "SQLite database file",
    process.env.PERSONAL_DB ?? "./data/personal.db",
  )
  .option("--from <date>", "history start date (YYYY-MM-DD)", defaultFrom())
  .option("--to <date>", "history end date (YYYY-MM-DD)", isoDate(new Date()))
  .option("--symbols <list>", "comma-separated symbols (default: all companies)")
  .option("--index <symbol>", "index symbol", "NEPSE")
  .action(async (options: Record<string, string | boolean | undefined>) => {
    try {
      assertPersonalMode(process.env);
    } catch (error) {
      console.error(describeError(error));
      process.exitCode = 1;
      return;
    }
    console.log(PERSONAL_MODE_BANNER);
    console.log("");

    const dataDir = resolve(
      invocationDir,
      String(options.dataDir ?? "./data/personal"),
    );
    const env = { ...process.env, PERSONAL_DATA_DIR: dataDir };
    const provider = createProvider("personal", env);
    const policy = policyFromEnv(process.env);
    const store = openStore(String(options.db ?? "./data/personal.db"));

    console.log(`Provider: ${provider.descriptor.name} (${provider.descriptor.id})`);
    console.log(`Source: ${provider.descriptor.sourceType}  Terms: ${provider.descriptor.termsStatus}`);
    console.log(`Data dir: ${dataDir}`);
    console.log("");

    try {
      const result = await syncPersonalData({
        provider,
        policy,
        store,
        from: String(options.from),
        to: String(options.to),
        ...(typeof options.symbols === "string" && options.symbols.length > 0
          ? { symbols: options.symbols.split(",") }
          : {}),
        indexSymbol: String(options.index ?? "NEPSE"),
        dataDir,
        onProgress: (line) => console.log(`  ${line}`),
      });

      console.log("");
      console.log(
        `Synced ${result.companies} companies, ${result.equitySeries} equity series, ${result.candleRows} candles.`,
      );
      console.log(
        `Snapshots: ${result.snapshots} (fundamentals ${result.fundamentals}, corporate actions ${result.corporateActions}, IPOs ${result.ipos}, news ${result.news}, floorsheet ${result.floorsheetTrades} trades, broker flows ${result.brokerFlows}).`,
      );
      if (result.failedSymbols.length > 0) {
        console.log(`Skipped symbols: ${result.failedSymbols.join(", ")}`);
      }
      for (const warning of result.warnings) {
        console.log(`Warning: ${warning}`);
      }
    } catch (error) {
      console.error(`Sync failed: ${describeError(error)}`);
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });

program
  .command("acquire")
  .description(
    "Fetch the public NEPSE archive and write canonical CSV files (no database write)",
  )
  .option(
    "--data-dir <path>",
    "canonical data directory",
    process.env.PERSONAL_DATA_DIR ?? "./data/personal",
  )
  .option("--cache-dir <path>", "git clone cache directory")
  .option("--source-dir <path>", "use an existing source checkout")
  .option("--source-url <url>", "source git URL", NEPSE_SOURCE_URL)
  .option("--ref <ref>", "source branch or tag", "main")
  .option("--max-age-minutes <minutes>", "reuse a fetch younger than this", "30")
  .option("--force", "ignore the fetch cache and refresh from the remote")
  .action(async (options: Record<string, string | boolean | undefined>) => {
    const dataDir = resolve(
      invocationDir,
      String(options.dataDir ?? "./data/personal"),
    );
    console.log(PERSONAL_MODE_BANNER);
    console.log("");
    try {
      const result = await acquireNepseSource({
        outputDir: dataDir,
        sourceUrl: String(options.sourceUrl ?? NEPSE_SOURCE_URL),
        ...(typeof options.cacheDir === "string" && options.cacheDir.length > 0
          ? { cacheDir: resolve(invocationDir, options.cacheDir) }
          : { cacheDir: resolve(dataDir, "source", ".cache") }),
        ...(typeof options.sourceDir === "string" && options.sourceDir.length > 0
          ? { sourceDir: resolve(invocationDir, options.sourceDir) }
          : {}),
        ref: String(options.ref ?? "main"),
        force: options.force === true,
        maxAgeMinutes: Number(options.maxAgeMinutes ?? 30),
      });
      console.log(`Source:  ${result.sourceUrl}`);
      console.log(`Commit:  ${result.commit}${result.cached ? " (cached fetch)" : ""}`);
      console.log(`Data:    ${result.dataDir}`);
      console.log(`Raw:     ${result.snapshotDir}`);
      console.log("");
      console.log(
        `Normalized ${result.totals.companies} companies, ${result.totals.priceRows} price rows across ${result.totals.ohlcFiles} series, ${result.totals.indexRows} index rows, ${result.totals.quotes} end-of-day quotes.`,
      );
      console.log(
        `Coverage: ${result.totals.earliest ?? "—"} → ${result.totals.latest ?? "—"} (latest session ${result.totals.latestSession ?? "—"})`,
      );
      console.log(
        `Excluded: ${result.totals.excludedRows} price rows, ${result.totals.indexExcludedRows} index rows (see reports/excluded-rows.csv)`,
      );
      console.log(`Report:  ${result.reportPath}`);
      for (const warning of result.warnings) {
        console.log(`Warning: ${warning}`);
      }
    } catch (error) {
      console.error(`Acquire failed: ${describeError(error)}`);
      process.exitCode = 1;
    }
  });

program
  .command("details")
  .description(
    "Fetch public company profiles, key ratios and corporate actions into canonical CSV (no database write)",
  )
  .option(
    "--data-dir <path>",
    "canonical data directory (must already contain companies.csv)",
    process.env.PERSONAL_DATA_DIR ?? "./data/personal",
  )
  .option("--symbols <list>", "comma-separated symbols (default: all active equities)")
  .option("--limit <count>", "maximum companies to fetch; 0 means all", "0")
  .option("--max-age-minutes <minutes>", "reuse a cached page younger than this", "720")
  .option("--force", "ignore the page cache and refetch every page")
  .option(
    "--no-statements",
    "skip quarterly statements and company event tabs (faster, profiles only)",
  )
  .action(async (options: Record<string, string | boolean | undefined>) => {
    const dataDir = resolve(
      invocationDir,
      String(options.dataDir ?? "./data/personal"),
    );
    console.log(PERSONAL_MODE_BANNER);
    console.log("");
    try {
      const result = await acquireCompanyDetails({
        dataDir,
        ...(typeof options.symbols === "string" && options.symbols.length > 0
          ? { symbols: options.symbols.split(",") }
          : {}),
        limit: Number(options.limit ?? 0),
        force: options.force === true,
        maxAgeMinutes: Number(options.maxAgeMinutes ?? 720),
        statements: options.statements !== false,
        onProgress: (line) => console.log(`  ${line}`),
      });
      console.log("");
      console.log(
        `Profiles: ${result.companiesWithProfile}/${result.requested} companies; fundamentals files: ${result.fundamentalsFiles}; statement files: ${result.statementFiles} (${result.statementRows} rows); new company events: ${result.companyEventRows}; new corporate-action rows: ${result.corporateActionRows}.`,
      );
      console.log(`Companies:        ${result.companyFile}`);
      console.log(`Corporate actions: ${result.corporateActionsFile}`);
      console.log(`Company events:   ${result.companyEventsFile}`);
      console.log(`Report:           ${result.reportPath}`);
      if (result.conflicts.length > 0) {
        console.log(`Conflicts reported: ${result.conflicts.length}`);
        for (const conflict of result.conflicts.slice(0, 10)) {
          console.log(
            `  ${conflict.symbol} ${conflict.field}: kept ${conflict.kept} (alternative ${conflict.alternative})`,
          );
        }
      }
      if (result.failures.length > 0) {
        console.log(`Failures: ${result.failures.length}`);
        for (const failure of result.failures.slice(0, 10)) {
          console.log(`  ${failure.symbol} ${failure.source}: ${failure.error}`);
        }
      }
      if (result.skipped.length > 0) {
        console.log(`Skipped: ${result.skipped.length}`);
        for (const entry of result.skipped.slice(0, 10)) {
          console.log(`  ${entry}`);
        }
      }
    } catch (error) {
      console.error(`Details acquisition failed: ${describeError(error)}`);
      process.exitCode = 1;
    }
  });

program
  .command("bulk")
  .description(
    "Fetch public market summary, sub-index history, prices, floorsheet, news, IPOs and mutual-fund NAVs into canonical CSV (no database write)",
  )
  .option(
    "--data-dir <path>",
    "canonical data directory",
    process.env.PERSONAL_DATA_DIR ?? "./data/personal",
  )
  .option("--from <date>", "history start date (YYYY-MM-DD); default: five years ago")
  .option("--to <date>", "history end date (YYYY-MM-DD); default: today", isoDate(new Date()))
  .option("--max-age-minutes <minutes>", "reuse a cached page younger than this", "720")
  .option("--force", "ignore the page cache and refetch every page")
  .action(async (options: Record<string, string | boolean | undefined>) => {
    const dataDir = resolve(
      invocationDir,
      String(options.dataDir ?? "./data/personal"),
    );
    console.log(PERSONAL_MODE_BANNER);
    console.log("");
    try {
      const result = await acquireBulkData({
        dataDir,
        ...(typeof options.from === "string" && options.from.length > 0
          ? { from: options.from }
          : {}),
        to: String(options.to ?? isoDate(new Date())),
        force: options.force === true,
        maxAgeMinutes: Number(options.maxAgeMinutes ?? 720),
        onProgress: (line) => console.log(`  ${line}`),
      });
      console.log("");
      console.log(
        `Indices: ${result.indices.files} files, ${result.indices.added} new rows; sectors: ${result.sectorRows}; market summary: ${result.marketSummary ? "available" : "unavailable"}.`,
      );
      console.log(
        `Prices: ${result.prices.quotes} quotes, ${result.prices.candleAdds} new candles; floorsheet: ${result.floorsheet.trades} trades (${result.floorsheet.date ?? "no date"}).`,
      );
      console.log(
        `News: ${result.news.total}; IPOs: ${result.ipos.total}; mutual-fund NAV rows: ${result.mutualFunds}.`,
      );
      console.log(`Report: ${result.reportPath}`);
      if (result.conflicts.length > 0) {
        console.log(`Conflicts reported: ${result.conflicts.length}`);
        for (const conflict of result.conflicts.slice(0, 10)) {
          console.log(
            `  ${conflict.dataset} ${conflict.key} ${conflict.field}: kept ${conflict.kept} (alternative ${conflict.alternative})`,
          );
        }
      }
      if (result.failureCount > 0) {
        console.log(`Failures: ${result.failureCount}`);
        for (const failure of result.failures.slice(0, 10)) {
          console.log(`  ${failure.dataset} ${failure.source}: ${failure.error}`);
        }
      }
      for (const entry of result.skipped.slice(0, 10)) {
        console.log(`Skipped: ${entry}`);
      }
    } catch (error) {
      console.error(`Bulk acquisition failed: ${describeError(error)}`);
      process.exitCode = 1;
    }
  });

program
  .command("update")
  .description(
    "Fetch the public NEPSE archive, normalize it, and import it into the local store",
  )
  .option(
    "--data-dir <path>",
    "canonical data directory",
    process.env.PERSONAL_DATA_DIR ?? "./data/personal",
  )
  .option(
    "--db <path>",
    "SQLite database file",
    process.env.PERSONAL_DB ?? "./data/personal.db",
  )
  .option("--cache-dir <path>", "git clone cache directory")
  .option("--source-dir <path>", "use an existing source checkout")
  .option("--source-url <url>", "source git URL", NEPSE_SOURCE_URL)
  .option("--ref <ref>", "source branch or tag", "main")
  .option("--max-age-minutes <minutes>", "reuse a fetch younger than this", "30")
  .option("--force", "ignore the fetch cache and refresh from the remote")
  .option("--from <date>", "history start date (YYYY-MM-DD)", "1990-01-01")
  .option("--to <date>", "history end date (YYYY-MM-DD)", isoDate(new Date()))
  .option("--symbols <list>", "comma-separated symbols (default: all companies)")
  .option("--index <symbol>", "index symbol", "NEPSE")
  .option("--skip-sync", "fetch and normalize only; do not write the database")
  .option("--skip-bulk", "skip the public web datasets (summary, indices, floorsheet, news, IPOs, NAVs)")
  .action(async (options: Record<string, string | boolean | undefined>) => {
    try {
      assertPersonalMode(process.env);
    } catch (error) {
      console.error(describeError(error));
      process.exitCode = 1;
      return;
    }
    console.log(PERSONAL_MODE_BANNER);
    console.log("");

    const dataDir = resolve(
      invocationDir,
      String(options.dataDir ?? "./data/personal"),
    );
    try {
      const acquired = await acquireNepseSource({
        outputDir: dataDir,
        sourceUrl: String(options.sourceUrl ?? NEPSE_SOURCE_URL),
        ...(typeof options.cacheDir === "string" && options.cacheDir.length > 0
          ? { cacheDir: resolve(invocationDir, options.cacheDir) }
          : { cacheDir: resolve(dataDir, "source", ".cache") }),
        ...(typeof options.sourceDir === "string" && options.sourceDir.length > 0
          ? { sourceDir: resolve(invocationDir, options.sourceDir) }
          : {}),
        ref: String(options.ref ?? "main"),
        force: options.force === true,
        maxAgeMinutes: Number(options.maxAgeMinutes ?? 30),
      });
      console.log(
        `Acquired ${acquired.commit}: ${acquired.totals.priceRows} price rows, ${acquired.totals.indexRows} index rows, ${acquired.totals.quotes} quotes.`,
      );
      for (const warning of acquired.warnings) {
        console.log(`Warning: ${warning}`);
      }
      if (options.skipBulk !== true) {
        console.log("");
        console.log("Public web datasets:");
        try {
          const bulk = await acquireBulkData({
            dataDir,
            from: String(options.from ?? "1990-01-01"),
            to: String(options.to ?? isoDate(new Date())),
            force: options.force === true,
            onProgress: (line) => console.log(`  ${line}`),
          });
          console.log(
            `  indices: ${bulk.indices.files} files (${bulk.indices.added} new rows); market summary: ${bulk.marketSummary ? "available" : "unavailable"}; sectors: ${bulk.sectorRows}; floorsheet: ${bulk.floorsheet.trades} trades; news: ${bulk.news.total}; IPOs: ${bulk.ipos.total}; fund NAVs: ${bulk.mutualFunds}.`,
          );
          if (bulk.failureCount > 0) {
            console.log(`  Web source failures: ${bulk.failureCount} (see reports/bulk.json)`);
          }
          for (const warning of bulk.skipped.slice(0, 5)) {
            console.log(`  Note: ${warning}`);
          }
        } catch (error) {
          console.log(`  Bulk acquisition failed (continuing with the archive): ${describeError(error)}`);
        }
      }
      if (options.skipSync === true) {
        console.log(`Normalized data: ${acquired.dataDir}`);
        return;
      }

      const env = { ...process.env, PERSONAL_DATA_DIR: dataDir };
      const provider = createProvider("personal", env);
      const policy = policyFromEnv(process.env);
      const store = openStore(String(options.db ?? "./data/personal.db"));
      console.log("");
      console.log(
        `Provider: ${provider.descriptor.name} (${provider.descriptor.id})`,
      );
      console.log(`Database: ${resolve(invocationDir, String(options.db ?? "./data/personal.db"))}`);
      console.log("");

      try {
        const result = await syncPersonalData({
          provider,
          policy,
          store,
          from: String(options.from ?? "1990-01-01"),
          to: String(options.to ?? isoDate(new Date())),
          ...(typeof options.symbols === "string" && options.symbols.length > 0
            ? { symbols: options.symbols.split(",") }
            : {}),
          indexSymbol: String(options.index ?? "NEPSE"),
          files: acquired.files,
          dataDir,
          onProgress: (line) => console.log(`  ${line}`),
        });
        console.log("");
        console.log(
          `Imported ${result.companies} companies, ${result.equitySeries} equity series, ${result.candleRows} candles, ${result.quotes} quotes.`,
        );
        console.log(
          `Snapshots: ${result.snapshots} (fundamentals ${result.fundamentals}, corporate actions ${result.corporateActions}, IPOs ${result.ipos}, news ${result.news}, floorsheet ${result.floorsheetTrades} trades, broker flows ${result.brokerFlows}).`,
        );
        if (result.failedSymbols.length > 0) {
          console.log(`Skipped symbols: ${result.failedSymbols.join(", ")}`);
        }
        for (const warning of result.warnings) {
          console.log(`Warning: ${warning}`);
        }
      } finally {
        store.close();
      }
    } catch (error) {
      console.error(`Update failed: ${describeError(error)}`);
      process.exitCode = 1;
    }
  });

program
  .command("status")
  .description("Show local store contents and provenance")
  .option(
    "--db <path>",
    "SQLite database file",
    process.env.PERSONAL_DB ?? "./data/personal.db",
  )
  .action((options: Record<string, string | boolean | undefined>) => {
    const store = openStore(
      String(options.db ?? process.env.PERSONAL_DB ?? "./data/personal.db"),
    );
    try {
      const summary = store.summary();
      console.log(PERSONAL_MODE_BANNER);
      console.log("");
      console.log(
        `Database: ${resolve(invocationDir, String(options.db ?? process.env.PERSONAL_DB ?? "./data/personal.db"))}`,
      );
      console.log(`Companies: ${summary.companies}`);
      console.log(`Candles:   ${summary.candles}`);
      console.log(`Quotes:    ${summary.quotes}`);
      console.log(`Snapshots: ${summary.snapshots}`);
      console.log(`Sync runs: ${summary.syncRuns}`);
      console.log(`Last fetch: ${summary.lastFetchedAt ?? "never"}`);
    } finally {
      store.close();
    }
  });

program
  .command("candles")
  .description("Print stored candles for one symbol (offline read)")
  .argument("<symbol>", "equity symbol")
  .option(
    "--db <path>",
    "SQLite database file",
    process.env.PERSONAL_DB ?? "./data/personal.db",
  )
  .option("--provider <id>", "provider namespace", "free-source")
  .option("--from <date>", "start date (YYYY-MM-DD)")
  .option("--to <date>", "end date (YYYY-MM-DD)")
  .option("--limit <number>", "most recent rows to print", "20")
  .action(
    (
      symbol: string,
      options: Record<string, string | boolean | undefined>,
    ) => {
      const store = openStore(
        String(
          options.db ?? process.env.PERSONAL_DB ?? "./data/personal.db",
        ),
      );
      try {
        const rows = store.getCandles({
          providerId: String(options.provider ?? "free-source"),
          kind: "equity",
          symbol,
          ...(typeof options.from === "string" ? { from: options.from } : {}),
          ...(typeof options.to === "string" ? { to: options.to } : {}),
        });
        const limit = Math.max(1, Number(options.limit ?? 20));
        const tail = rows.slice(-limit);
        if (tail.length === 0) {
          console.log(`No candles stored for ${symbol.toUpperCase()}.`);
          return;
        }
        console.log("date        open    high    low     close   volume");
        for (const candle of tail) {
          console.log(
            `${candle.timestamp.slice(0, 10)}  ${candle.open.toFixed(2).padStart(7)} ${candle.high.toFixed(2).padStart(7)} ${candle.low.toFixed(2).padStart(7)} ${candle.close.toFixed(2).padStart(7)} ${candle.volume.toString().padStart(9)}`,
          );
        }
      } finally {
        store.close();
      }
    },
  );

program
  .command("analyze")
  .description("Compute offline indicators for one stored symbol")
  .argument("<symbol>", "equity symbol")
  .option(
    "--db <path>",
    "SQLite database file",
    process.env.PERSONAL_DB ?? "./data/personal.db",
  )
  .option("--provider <id>", "provider namespace", "free-source")
  .option("--from <date>", "start date (YYYY-MM-DD)")
  .option("--to <date>", "end date (YYYY-MM-DD)")
  .option("--limit <number>", "most recent candles to analyse", "500")
  .action(
    (
      symbol: string,
      options: Record<string, string | boolean | undefined>,
    ) => {
      const store = openStore(
        String(
          options.db ?? process.env.PERSONAL_DB ?? "./data/personal.db",
        ),
      );
      try {
        const rows = store
          .getCandles({
            providerId: String(options.provider ?? "free-source"),
            kind: "equity",
            symbol,
            ...(typeof options.from === "string" ? { from: options.from } : {}),
            ...(typeof options.to === "string" ? { to: options.to } : {}),
          })
          .slice(-Math.max(1, Number(options.limit ?? 500)));

        if (rows.length === 0) {
          console.log(`No candles stored for ${symbol.toUpperCase()}.`);
          return;
        }

        const analysis = analyzeCandles(rows);
        const display = (value: number | null): string =>
          value === null ? "n/a" : value.toFixed(2);

        console.log(`${analysis.symbol}  ${analysis.from} -> ${analysis.to}`);
        console.log(`Observations: ${analysis.observations}`);
        console.log(`Last close:   ${display(analysis.lastClose)}`);
        console.log(`SMA 20/50/200: ${display(analysis.sma20)} / ${display(analysis.sma50)} / ${display(analysis.sma200)}`);
        console.log(`EMA 20:       ${display(analysis.ema20)}`);
        console.log(`RSI 14:       ${display(analysis.rsi14)}`);
        console.log(`52w high/low: ${display(analysis.high52w)} / ${display(analysis.low52w)}`);
        console.log(`Return:       ${display(analysis.returnPercent)}% (window)`);
      } finally {
        store.close();
      }
    },
  );

program
  .command("backup")
  .description("Write a consistent SQLite backup")
  .option(
    "--db <path>",
    "SQLite database file",
    process.env.PERSONAL_DB ?? "./data/personal.db",
  )
  .option("--out <path>", "backup file to create (must not exist)")
  .action((options: Record<string, string | boolean | undefined>) => {
    const dbPath = String(
      options.db ?? process.env.PERSONAL_DB ?? "./data/personal.db",
    );
    const out = String(options.out ?? "");
    if (!out) {
      console.error("backup requires --out <path>");
      process.exitCode = 1;
      return;
    }
    const store = openStore(dbPath);
    try {
      store.backupTo(resolve(invocationDir, out));
      console.log(`Backup written: ${resolve(invocationDir, out)}`);
      console.log(`Schema version: ${store.getSchemaVersion()}`);
    } catch (error) {
      console.error(`Backup failed: ${describeError(error)}`);
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });

program
  .command("restore")
  .description("Replace the local database from a backup file")
  .option(
    "--db <path>",
    "SQLite database file",
    process.env.PERSONAL_DB ?? "./data/personal.db",
  )
  .option("--from <path>", "backup file to restore")
  .option("--force", "overwrite the current database without a prompt")
  .action((options: Record<string, string | boolean | undefined>) => {
    const dbPath = resolve(
      invocationDir,
      String(options.db ?? process.env.PERSONAL_DB ?? "./data/personal.db"),
    );
    const from = options.from ? resolve(invocationDir, String(options.from)) : "";
    if (!from) {
      console.error("restore requires --from <path>");
      process.exitCode = 1;
      return;
    }
    if (!existsSync(from)) {
      console.error(`Backup not found: ${from}`);
      process.exitCode = 1;
      return;
    }
    if (existsSync(dbPath) && options.force !== true) {
      console.error(
        `Refusing to overwrite ${dbPath} without --force. Back up the current database first.`,
      );
      process.exitCode = 1;
      return;
    }
    for (const suffix of ["-wal", "-shm"]) {
      rmSync(`${dbPath}${suffix}`, { force: true });
    }
    copyFileSync(from, dbPath);
    console.log(`Restored: ${dbPath}`);
    console.log(`Source:   ${from}`);
  });

await program.parseAsync(process.argv);

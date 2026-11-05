#!/usr/bin/env node
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { Command } from "commander";
import {
  EnvironmentSchema,
  evaluateProvider,
  type Environment,
  type RuntimePolicy,
} from "@stock/core";
import {
  createProvider,
  type ProviderKind,
} from "@stock/providers";
import { validateProvider } from "./validate";
import { writeReport } from "./output";
import type { CheckResult, Phase0Report } from "./types";

const invocationDir = process.env.INIT_CWD ?? process.cwd();

try {
  loadEnvFile(resolve(invocationDir, ".env"));
} catch {
  // .env is optional.
}

const PROVIDER_KINDS: ProviderKind[] = [
  "mock",
  "csv",
  "licensed",
  "command",
  "personal",
];

function resolveEnvironment(value: string): Environment {
  const parsed = EnvironmentSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment "${value}". Expected: development, test, staging, production.`,
    );
  }
  return parsed.data;
}

function buildPolicy(
  environment: Environment,
  allowUnofficial: boolean,
): RuntimePolicy {
  const envAllows = process.env.ALLOW_UNOFFICIAL_DATA === "true";
  const requested = allowUnofficial || envAllows;
  return {
    environment,
    allowUnofficial: environment === "production" ? false : requested,
    requireVerifiedTerms: environment === "production",
    requireProductionReady: environment === "production",
  };
}

function statusLabel(status: CheckResult["status"]): string {
  switch (status) {
    case "pass":
      return "PASS";
    case "warn":
      return "WARN";
    case "fail":
      return "FAIL";
    default:
      return "SKIP";
  }
}

function printReportSummary(report: Phase0Report): void {
  console.log("");
  console.log(`Verdict: ${report.summary.verdict.toUpperCase()}`);
  console.log(
    `Checks: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail, ${report.summary.skip} skip`,
  );
}

const program = new Command();
program
  .name("phase0")
  .description("Phase 0 market-data validation harness")
  .version("0.1.0");

program
  .command("providers")
  .description("List configured providers and their policy status")
  .option("--env <environment>", "target environment", "development")
  .option("--allow-unofficial", "allow unofficial providers in the policy check")
  .action((options: { env: string; allowUnofficial?: boolean }) => {
    const environment = resolveEnvironment(options.env);
    const policy = buildPolicy(environment, options.allowUnofficial ?? false);
    console.log(`Environment: ${environment}`);
    console.log(`Unofficial allowed: ${policy.allowUnofficial}`);
    console.log("");

    for (const kind of PROVIDER_KINDS) {
      try {
        const provider = createProvider(kind, process.env);
        const descriptor = provider.descriptor;
        const evaluation = evaluateProvider(descriptor, policy);
        console.log(
          `${kind.padEnd(9)} ${evaluation.allowed ? "allowed" : "blocked"}  ${descriptor.id}  source=${descriptor.sourceType}  terms=${descriptor.termsStatus}  productionReady=${descriptor.productionReady}  caps=${descriptor.capabilities.length}`,
        );
        console.log(`          ${descriptor.name}`);
        if (evaluation.reasons.length > 0) {
          console.log(`          blocked: ${evaluation.reasons.join("; ")}`);
        }
      } catch (error) {
        console.log(
          `${kind.padEnd(9)} unavailable  ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  });

program
  .command("validate")
  .description("Run the Phase 0 data checks against one provider")
  .option(
    "--provider <kind>",
    "mock | csv | licensed | command | personal",
    "mock",
  )
  .option("--env <environment>", "target environment", "development")
  .option("--allow-unofficial", "allow unofficial providers in the policy check")
  .option("--symbol <symbol>", "sample equity symbol", "NABIL")
  .option("--index <symbol>", "index symbol for history checks", "NEPSE")
  .option("--years <number>", "history window in years", "5")
  .option("--timeout <ms>", "per-request timeout in milliseconds", "60000")
  .option("--data-dir <path>", "manual CSV data directory")
  .option("--out <dir>", "report output directory", "reports")
  .option("--json", "print the full JSON report to stdout")
  .option("--exit-zero", "always exit with status 0")
  .action(async (options: Record<string, string | boolean | undefined>) => {
    const kind = String(options.provider ?? "mock") as ProviderKind;
    if (!PROVIDER_KINDS.includes(kind)) {
      throw new Error(
        `Unknown provider "${kind}". Expected one of: ${PROVIDER_KINDS.join(", ")}.`,
      );
    }

    const environment = resolveEnvironment(String(options.env ?? "development"));
    const policy = buildPolicy(
      environment,
      options.allowUnofficial === true,
    );

    if (typeof options.dataDir === "string") {
      process.env.MANUAL_DATA_DIR = resolve(invocationDir, options.dataDir);
    }

    const historyYears = Number(options.years ?? 5);
    if (!Number.isFinite(historyYears) || historyYears <= 0) {
      throw new Error(`Invalid --years value: ${String(options.years)}`);
    }
    const requestTimeoutMs = Number(options.timeout ?? 60_000);
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new Error(`Invalid --timeout value: ${String(options.timeout)}`);
    }

    const provider = createProvider(kind, process.env);

    console.log("Phase 0 data validation");
    console.log(`Provider: ${provider.descriptor.name} (${provider.descriptor.id})`);
    console.log(
      `Source: ${provider.descriptor.sourceType}  Terms: ${provider.descriptor.termsStatus}  Production ready: ${provider.descriptor.productionReady}`,
    );
    console.log(
      `Policy: env=${policy.environment} unofficial=${policy.allowUnofficial} verifiedTerms=${policy.requireVerifiedTerms}`,
    );
    console.log("");

    const report = await validateProvider({
      provider,
      policy,
      historyYears,
      sampleSymbol: String(options.symbol ?? "NABIL"),
      indexSymbol: String(options.index ?? "NEPSE"),
      requestTimeoutMs,
      onResult: (result) => {
        console.log(
          `[${statusLabel(result.status)}] ${result.title} — ${result.summary}`,
        );
      },
    });

    const written = writeReport(
      report,
      resolve(invocationDir, String(options.out ?? "reports")),
    );
    printReportSummary(report);
    console.log(`Markdown report: ${written.markdownPath}`);
    console.log(`JSON report: ${written.jsonPath}`);

    if (options.json === true) {
      console.log("");
      console.log(JSON.stringify(report, null, 2));
    }

    if (report.summary.verdict === "no-go" && options.exitZero !== true) {
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);

import {
  evaluateProvider,
  MarketDataService,
  ProviderRegistry,
  type MarketDataProvider,
  type RuntimePolicy,
} from "@stock/core";
import type {
  Check,
  CheckContext,
  CheckResult,
  Phase0Report,
} from "./types";
import { summarize } from "./types";
import { runChecks } from "./runner";

export interface ValidateProviderOptions {
  provider: MarketDataProvider;
  policy: RuntimePolicy;
  now?: Date;
  historyYears?: number;
  sampleSymbol?: string;
  indexSymbol?: string;
  requestTimeoutMs?: number;
  checks?: Check[];
  onResult?: (result: CheckResult) => void;
}

export async function validateProvider(
  options: ValidateProviderOptions,
): Promise<Phase0Report> {
  const now = options.now ?? new Date();
  const registry = new ProviderRegistry();
  registry.register(options.provider);

  const service = new MarketDataService(registry, {
    policy: options.policy,
    now: () => now,
  });

  const policyEvaluation = evaluateProvider(
    options.provider.descriptor,
    options.policy,
  );

  const context: CheckContext = {
    provider: options.provider,
    service,
    policy: options.policy,
    now,
    historyYears: options.historyYears ?? 5,
    sampleSymbol: options.sampleSymbol ?? "NABIL",
    indexSymbol: options.indexSymbol ?? "NEPSE",
    requestTimeoutMs: options.requestTimeoutMs ?? 60_000,
  };

  const checks = await runChecks({
    context,
    ...(options.checks ? { checks: options.checks } : {}),
    ...(options.onResult ? { onResult: options.onResult } : {}),
  });

  const summary = summarize(checks);
  const report: Phase0Report = {
    generatedAt: now.toISOString(),
    provider: options.provider.descriptor,
    policy: options.policy,
    policyAllowed: policyEvaluation.allowed,
    policyReasons: policyEvaluation.reasons,
    checks,
    summary,
  };

  if (!policyEvaluation.allowed) {
    report.summary.verdict = "no-go";
  }

  return report;
}

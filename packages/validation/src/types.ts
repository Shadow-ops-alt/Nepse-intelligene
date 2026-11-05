import type {
  Capability,
  MarketDataProvider,
  MarketDataService,
  ProviderDescriptor,
  RuntimePolicy,
} from "@stock/core";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface CheckOutcome {
  status: CheckStatus;
  summary: string;
  details: string[];
  metrics: Record<string, number | string | boolean | null>;
}

export interface CheckContext {
  provider: MarketDataProvider;
  service: MarketDataService;
  policy: RuntimePolicy;
  now: Date;
  historyYears: number;
  sampleSymbol: string;
  indexSymbol: string;
  requestTimeoutMs: number;
}

export interface Check {
  id: string;
  title: string;
  /** Check is skipped when the provider does not declare all of these. */
  capabilities?: Capability[];
  run(context: CheckContext): Promise<CheckOutcome>;
}

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  summary: string;
  details: string[];
  metrics: Record<string, number | string | boolean | null>;
  startedAt: string;
  durationMs: number;
}

export interface Phase0Report {
  generatedAt: string;
  provider: ProviderDescriptor;
  policy: RuntimePolicy;
  policyAllowed: boolean;
  policyReasons: string[];
  checks: CheckResult[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    skip: number;
    verdict: "go" | "conditional" | "no-go";
  };
}

export function summarize(checks: CheckResult[]): Phase0Report["summary"] {
  const summary = {
    pass: 0,
    warn: 0,
    fail: 0,
    skip: 0,
    verdict: "go" as Phase0Report["summary"]["verdict"],
  };
  for (const check of checks) {
    summary[check.status] += 1;
  }
  summary.verdict =
    summary.fail > 0 ? "no-go" : summary.warn > 0 ? "conditional" : "go";
  return summary;
}

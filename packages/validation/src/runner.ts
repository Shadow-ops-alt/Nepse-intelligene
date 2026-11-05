import type {
  Check,
  CheckContext,
  CheckOutcome,
  CheckResult,
} from "./types";
import { DEFAULT_CHECKS } from "./checks/index";
import { errorMessage, outcome, withTimeout } from "./checks/helpers";

export interface RunChecksOptions {
  context: CheckContext;
  checks?: Check[];
  onResult?: (result: CheckResult) => void;
}

export async function runChecks({
  context,
  checks = DEFAULT_CHECKS,
  onResult,
}: RunChecksOptions): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const timeoutMs = Math.max(context.requestTimeoutMs * 2, 30_000);

  for (const check of checks) {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const missing = (check.capabilities ?? []).filter(
      (capability) =>
        !context.provider.descriptor.capabilities.includes(capability),
    );

    let result: CheckOutcome;
    if (missing.length > 0) {
      result = outcome(
        "skip",
        `Provider does not declare: ${missing.join(", ")}`,
        [`Skipped because capability is not declared: ${missing.join(", ")}.`],
        { missing: missing.join(",") },
      );
    } else {
      try {
        result = await withTimeout(check.run(context), timeoutMs, check.title);
      } catch (error) {
        result = outcome(
          "fail",
          `${check.title} failed: ${errorMessage(error)}`,
          [errorMessage(error)],
          {},
        );
      }
    }

    const entry: CheckResult = {
      id: check.id,
      title: check.title,
      status: result.status,
      summary: result.summary,
      details: result.details,
      metrics: result.metrics,
      startedAt,
      durationMs: Date.now() - started,
    };
    results.push(entry);
    onResult?.(entry);
  }

  return results;
}

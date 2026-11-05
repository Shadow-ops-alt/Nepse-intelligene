import type { Check } from "../types";
import { outcome } from "./helpers";

export const healthCheck: Check = {
  id: "provider-health",
  title: "Provider health check",
  async run({ provider, service }) {
    if (!provider.healthCheck) {
      return outcome(
        "skip",
        "Provider does not implement healthCheck",
        ["Health monitoring will need to rely on request failures."],
        {},
      );
    }

    const health = await service.checkProviderHealth(provider.descriptor.id);
    const details = [
      `Status: ${health.status}.`,
      `Checked at: ${health.checkedAt}.`,
      `Consecutive failures: ${health.consecutiveFailures}.`,
    ];
    if (health.latencyMs !== undefined) {
      details.push(`Latency: ${health.latencyMs}ms.`);
    }
    if (health.message) {
      details.push(`Message: ${health.message}`);
    }

    const status =
      health.status === "ok"
        ? "pass"
        : health.status === "degraded"
          ? "warn"
          : health.status === "down"
            ? "fail"
            : "skip";

    return outcome(status, `Provider health: ${health.status}`, details, {
      status: health.status,
      latencyMs: health.latencyMs ?? null,
      consecutiveFailures: health.consecutiveFailures,
    });
  },
};

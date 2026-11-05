import type { Phase0Report } from "./types";

function icon(status: string): string {
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

export function renderMarkdown(report: Phase0Report): string {
  const lines: string[] = [];
  lines.push("# Phase 0 Data Validation Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Provider");
  lines.push("");
  lines.push(`- ID: \`${report.provider.id}\``);
  lines.push(`- Name: ${report.provider.name}`);
  lines.push(`- Source type: ${report.provider.sourceType}`);
  lines.push(`- Terms status: ${report.provider.termsStatus}`);
  lines.push(`- Production ready: ${report.provider.productionReady}`);
  lines.push(`- Reliability: ${report.provider.reliability}`);
  lines.push(
    `- History limits: ${JSON.stringify(report.provider.limits ?? {})}`,
  );
  lines.push("");
  lines.push("## Policy");
  lines.push("");
  lines.push(`- Environment: ${report.policy.environment}`);
  lines.push(`- Allowed: ${report.policyAllowed}`);
  if (report.policyReasons.length > 0) {
    lines.push(`- Reasons: ${report.policyReasons.join("; ")}`);
  }
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push(`**${report.summary.verdict.toUpperCase()}**`);
  lines.push("");
  lines.push(
    `Pass: ${report.summary.pass} · Warn: ${report.summary.warn} · Fail: ${report.summary.fail} · Skip: ${report.summary.skip}`,
  );
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  lines.push("| Check | Status | Summary |");
  lines.push("|---|---|---|");
  for (const check of report.checks) {
    lines.push(
      `| ${check.title} | **${icon(check.status)}** | ${check.summary.replaceAll("|", "\\|")} |`,
    );
  }
  lines.push("");

  for (const check of report.checks) {
    lines.push(`### ${check.title}`);
    lines.push("");
    lines.push(`Status: **${icon(check.status)}** · ${check.durationMs}ms`);
    lines.push("");
    lines.push(check.summary);
    lines.push("");
    if (Object.keys(check.metrics).length > 0) {
      lines.push("```json");
      lines.push(JSON.stringify(check.metrics, null, 2));
      lines.push("```");
      lines.push("");
    }
    if (check.details.length > 0) {
      for (const detail of check.details) {
        lines.push(`- ${detail}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

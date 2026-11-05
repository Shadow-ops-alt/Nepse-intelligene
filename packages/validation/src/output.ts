import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Phase0Report } from "./types";
import { renderMarkdown } from "./report";

export interface WrittenReport {
  directory: string;
  markdownPath: string;
  jsonPath: string;
}

export function writeReport(
  report: Phase0Report,
  directory = "reports",
): WrittenReport {
  const target = resolve(directory);
  mkdirSync(target, { recursive: true });

  const timestamp = report.generatedAt
    .replaceAll(":", "")
    .replaceAll(".", "")
    .replace("Z", "Z");
  const safeProvider = report.provider.id.replace(/[^a-z0-9._-]/gi, "-");
  const base = `phase0-${safeProvider}-${timestamp}`;
  const markdownPath = join(target, `${base}.md`);
  const jsonPath = join(target, `${base}.json`);

  writeFileSync(markdownPath, `${renderMarkdown(report)}\n`, "utf8");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return { directory: target, markdownPath, jsonPath };
}

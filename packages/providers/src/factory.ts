import { resolve } from "node:path";
import type { Capability, Environment } from "@stock/core";
import { CommandProvider } from "./command/command-provider";
import { CsvProvider } from "./csv/csv-provider";
import { MockProvider } from "./mock/mock-provider";
import {
  createPersonalFreeProvider,
  PERSONAL_FREE_CAPABILITIES,
} from "./personal/personal-provider";
import { RestProvider } from "./rest/rest-provider";

export type ProviderKind = "mock" | "csv" | "licensed" | "command" | "personal";

const ALL_CAPABILITIES: Capability[] = [
  "companyList",
  "securityList",
  "sectors",
  "indices",
  "dailyOhlc",
  "intradayOhlc",
  "indexHistory",
  "liveQuotes",
  "marketSummary",
  "sectorPerformance",
  "floorsheet",
  "brokerFlows",
  "fundamentals",
  "fundamentalsHistory",
  "corporateActions",
  "ipos",
  "news",
  "mutualFundHoldings",
];

function shellCommand(input: string): {
  command: string;
  args: string[];
} {
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", input] };
  }
  return { command: "/bin/sh", args: ["-lc", input] };
}

function parseCapabilities(
  value: string | undefined,
  fallback: Capability[],
): Capability[] {
  if (!value) return fallback;
  const valid = new Set<Capability>(ALL_CAPABILITIES);
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is Capability => valid.has(item as Capability));
  return parsed.length > 0 ? parsed : fallback;
}

export function createProvider(
  kind: ProviderKind,
  env: NodeJS.ProcessEnv = process.env,
) {
  switch (kind) {
    case "mock":
      return new MockProvider();

    case "csv": {
      const configured = env.MANUAL_DATA_DIR ?? "./data/manual";
      const dataDir = resolve(process.env.INIT_CWD ?? process.cwd(), configured);
      return new CsvProvider({
        dataDir,
        attestLicensed: env.MANUAL_DATA_LICENSED === "true",
      });
    }

    case "licensed": {
      const baseUrl = env.LICENSED_BASE_URL;
      if (!baseUrl) {
        throw new Error(
          "LICENSED_BASE_URL is required for the licensed provider",
        );
      }
      return new RestProvider({
        id: "licensed-rest",
        name: "Licensed REST provider",
        baseUrl,
        apiKey: env.LICENSED_API_KEY,
        attestLicensed: env.LICENSED_ATTESTED === "true",
        termsUrl: env.LICENSED_TERMS_URL,
        license: env.LICENSED_LICENSE,
        environment: "production",
      });
    }

    case "command": {
      const command = env.COMMAND_PROVIDER_CMD;
      if (!command) {
        throw new Error(
          "COMMAND_PROVIDER_CMD is required for the command provider",
        );
      }
      const { command: executable, args } = shellCommand(command);
      return new CommandProvider({
        id: env.COMMAND_PROVIDER_ID ?? "external-command",
        name: env.COMMAND_PROVIDER_NAME ?? "External command provider",
        command: executable,
        args,
        timeoutMs: Number(env.COMMAND_PROVIDER_TIMEOUT_MS ?? 60_000),
        capabilities: parseCapabilities(
          env.COMMAND_PROVIDER_CAPABILITIES,
          ALL_CAPABILITIES,
        ),
        sourceType:
          (env.COMMAND_PROVIDER_SOURCE_TYPE as
            | "unofficial"
            | "licensed"
            | "manual"
            | "mock"
            | undefined) ?? "unofficial",
        termsStatus:
          (env.COMMAND_PROVIDER_TERMS_STATUS as
            | "verified"
            | "unverified"
            | "restricted"
            | "prohibited"
            | undefined) ?? "unverified",
        productionReady: false,
        reliability: "low",
      });
    }

    case "personal": {
      if (
        (env.NODE_ENV ?? "development") === "production" &&
        env.DATA_EDITION !== "free"
      ) {
        throw new Error(
          "The personal free-source provider requires DATA_EDITION=free when NODE_ENV=production.",
        );
      }
      const configured = env.PERSONAL_DATA_DIR ?? "./data/personal";
      const dataDir = resolve(env.INIT_CWD ?? process.cwd(), configured);
      return createPersonalFreeProvider({
        dataDir,
        environment:
          (env.NODE_ENV as Environment | undefined) ?? "development",
        capabilities: parseCapabilities(
          env.PERSONAL_CAPABILITIES,
          PERSONAL_FREE_CAPABILITIES,
        ),
      });
    }
  }
}

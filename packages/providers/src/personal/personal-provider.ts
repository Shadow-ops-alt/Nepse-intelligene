import type { Capability, Environment } from "@stock/core";
import { CsvProvider } from "../csv/csv-provider";

export const PERSONAL_PROVIDER_ID = "free-source";

/**
 * Capabilities that free/public sources can realistically support for a
 * single-user research prototype. Floorsheet, multi-year fundamentals,
 * intraday history, corporate-action adjustment, and delisted securities are
 * deliberately excluded: they need a licensed extract or a paid provider.
 */
export const PERSONAL_FREE_CAPABILITIES: Capability[] = [
  "companyList",
  "securityList",
  "sectors",
  "indices",
  "dailyOhlc",
  "indexHistory",
  "liveQuotes",
  "marketSummary",
  "sectorPerformance",
];

export interface PersonalProviderConfig {
  dataDir: string;
  id?: string;
  name?: string;
  environment?: Environment;
  priority?: number;
  capabilities?: Capability[];
}

/**
 * Personal research mode provider.
 *
 * It reads the same operator-supplied CSV layout as `CsvProvider`, but it is
 * permanently marked `sourceType=unofficial`, `termsStatus=unverified`, and
 * `productionReady=false`. The runtime policy therefore blocks it in
 * production, and `createMeta` rejects any attempt to relabel it.
 *
 * This is a data-plumbing adapter, not a scraper. The operator supplies the
 * files; the repository ships no vendor data.
 */
export function createPersonalFreeProvider(
  config: PersonalProviderConfig,
): CsvProvider {
  return new CsvProvider({
    dataDir: config.dataDir,
    id: config.id ?? PERSONAL_PROVIDER_ID,
    name: config.name ?? "Free-source provider",
    sourceType: "unofficial",
    termsStatus: "unverified",
    productionReady: false,
    reliability: "low",
    priority: config.priority ?? 900,
    environment: config.environment ?? "development",
    capabilities: config.capabilities ?? PERSONAL_FREE_CAPABILITIES,
    notes:
      "Free Edition. Unofficial data, terms unverified, not production-ready.",
    configRequired: ["PERSONAL_DATA_DIR", "DATA_EDITION"],
  });
}

export const PERSONAL_PROVIDER_CAPABILITIES = PERSONAL_FREE_CAPABILITIES;

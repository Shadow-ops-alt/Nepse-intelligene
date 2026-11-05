import type { Check } from "../types";
import {
  capabilityCoverageCheck,
  policyCheck,
  providerMetadataCheck,
} from "./metadata";
import { companyListCheck, securityListCheck } from "./companies";
import {
  dailyHistoryCheck,
  indexHistoryCheck,
  intradayCheck,
} from "./history";
import { floorsheetCheck } from "./floorsheet";
import {
  fundamentalsHistoryCheck,
  fundamentalsLatestCheck,
} from "./fundamentals";
import { corporateActionsCheck, iposCheck } from "./corporate-actions";
import { liveQuotesCheck, marketSummaryCheck } from "./live";
import { healthCheck } from "./health";

export const DEFAULT_CHECKS: Check[] = [
  policyCheck,
  providerMetadataCheck,
  capabilityCoverageCheck,
  companyListCheck,
  securityListCheck,
  dailyHistoryCheck,
  indexHistoryCheck,
  intradayCheck,
  floorsheetCheck,
  fundamentalsLatestCheck,
  fundamentalsHistoryCheck,
  corporateActionsCheck,
  iposCheck,
  liveQuotesCheck,
  marketSummaryCheck,
  healthCheck,
];

export * from "./helpers";
export * from "./metadata";
export * from "./companies";
export * from "./history";
export * from "./floorsheet";
export * from "./fundamentals";
export * from "./corporate-actions";
export * from "./live";
export * from "./health";

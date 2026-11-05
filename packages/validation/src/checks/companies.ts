import { z } from "zod";
import { CompanySchema, SecuritySchema } from "@stock/core";
import type { Check, CheckStatus } from "../types";
import { outcome } from "./helpers";

const CompanyListSchema = z.array(CompanySchema);
const SecurityListSchema = z.array(SecuritySchema);

export const companyListCheck: Check = {
  id: "company-list",
  title: "Company master list",
  capabilities: ["companyList"],
  async run(context) {
    const { service, requestTimeoutMs } = context;
    let { sampleSymbol } = context;
    const envelope = await service.getCompanyList({ timeoutMs: requestTimeoutMs });
    const parsed = CompanyListSchema.safeParse(envelope.data);
    if (!parsed.success) {
      return outcome(
        "fail",
        "Company list does not match the Company contract",
        [parsed.error.message],
        { rows: Array.isArray(envelope.data) ? envelope.data.length : 0 },
      );
    }

    const companies = parsed.data;
    const symbols = companies.map((company) => company.symbol.toUpperCase());
    const uniqueSymbols = new Set(symbols);
    const duplicates = symbols.filter(
      (symbol, index) => symbols.indexOf(symbol) !== index,
    );
    const missingSector = companies.filter((company) => !company.sector).length;
    const active = companies.filter((company) => company.status === "active");

    const symbolExists = uniqueSymbols.has(sampleSymbol.toUpperCase());
    if (!symbolExists && companies.length > 0) {
      const preferred =
        companies.find(
          (company) =>
            company.symbol.toUpperCase() === "NABIL" &&
            company.status === "active",
        ) ??
        active.find((company) => company.instrumentType === "Equity") ??
        companies[0];
      if (preferred) {
        sampleSymbol = preferred.symbol.toUpperCase();
        context.sampleSymbol = sampleSymbol;
      }
    }

    const details = [
      `${companies.length} companies, ${uniqueSymbols.size} unique symbols.`,
      `${active.length} marked active, ${missingSector} without a sector.`,
      `Sample symbol for downstream checks: ${sampleSymbol}.`,
    ];
    if (!symbolExists) {
      details.push(
        `Requested sample symbol is not in the list; switched to ${sampleSymbol}.`,
      );
    }
    if (duplicates.length > 0) {
      details.push(`Duplicate symbols: ${[...new Set(duplicates)].slice(0, 10).join(", ")}.`);
    }
    if (envelope.meta.warnings.length > 0) {
      details.push(`Provider warnings: ${envelope.meta.warnings.join("; ")}`);
    }

    let status: CheckStatus = "pass";
    if (companies.length === 0) status = "fail";
    else if (
      uniqueSymbols.size !== companies.length ||
      missingSector > 0 ||
      active.length === 0
    ) {
      status = "warn";
    }

    return outcome(
      status,
      status === "fail"
        ? "Company list is empty"
        : `${uniqueSymbols.size} unique companies available${status === "warn" ? " with data-quality warnings" : ""}`,
      details,
      {
        companies: companies.length,
        uniqueSymbols: uniqueSymbols.size,
        activeCompanies: active.length,
        missingSector,
        duplicateSymbols: duplicates.length,
        sampleSymbol,
      },
    );
  },
};

export const securityListCheck: Check = {
  id: "security-list",
  title: "Security master list",
  capabilities: ["securityList"],
  async run({ service, requestTimeoutMs }) {
    const envelope = await service.getSecurityList({
      timeoutMs: requestTimeoutMs,
    });
    const parsed = SecurityListSchema.safeParse(envelope.data);
    if (!parsed.success) {
      return outcome(
        "fail",
        "Security list does not match the Security contract",
        [parsed.error.message],
        { rows: Array.isArray(envelope.data) ? envelope.data.length : 0 },
      );
    }
    const securities = parsed.data;
    const unique = new Set(
      securities.map((security) => security.symbol.toUpperCase()),
    );
    const promoter = securities.filter((security) => security.isPromoter).length;
    const withoutCompany = securities.filter(
      (security) => !security.companyId,
    ).length;

    const details = [
      `${securities.length} securities, ${unique.size} unique symbols.`,
      `${promoter} promoter share entries, ${withoutCompany} without companyId.`,
    ];

    let status: CheckStatus = "pass";
    if (securities.length === 0) status = "fail";
    else if (unique.size !== securities.length || withoutCompany > 0) {
      status = "warn";
    }

    return outcome(
      status,
      status === "fail"
        ? "Security list is empty"
        : `${unique.size} unique securities available`,
      details,
      {
        securities: securities.length,
        uniqueSymbols: unique.size,
        promoterShares: promoter,
        withoutCompany,
      },
    );
  },
};

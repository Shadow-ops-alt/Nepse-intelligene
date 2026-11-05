import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRODUCTION_POLICY, evaluateProvider } from "@stock/core";
import { createProvider } from "../factory";
import {
  createPersonalFreeProvider,
  PERSONAL_FREE_CAPABILITIES,
} from "./personal-provider";

const directories: string[] = [];

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "stock-personal-"));
  directories.push(directory);
  writeFileSync(
    join(directory, "companies.csv"),
    [
      "id,symbol,name,sector,instrumentType,status",
      "131,NABIL,Nabil Bank Limited,Commercial Banks,Equity,active",
      "",
    ].join("\n"),
    "utf8",
  );
  mkdirSync(join(directory, "ohlc"), { recursive: true });
  writeFileSync(
    join(directory, "ohlc", "NABIL.csv"),
    [
      "symbol,date,open,high,low,close,volume",
      "NABIL,2026-11-02,540,548,538,545,12000",
      "NABIL,2026-11-03,547,555,545,552,42360",
      "",
    ].join("\n"),
    "utf8",
  );
  return directory;
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe("personal free-source provider", () => {
  it("is permanently unofficial and never production-ready", async () => {
    const provider = createPersonalFreeProvider({ dataDir: fixture() });
    expect(provider.descriptor.sourceType).toBe("unofficial");
    expect(provider.descriptor.termsStatus).toBe("unverified");
    expect(provider.descriptor.productionReady).toBe(false);
    expect(provider.descriptor.reliability).toBe("low");

    const evaluation = evaluateProvider(provider.descriptor, PRODUCTION_POLICY);
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reasons.join(" ")).toContain("unofficial");

    const candles = await provider.getDailyOhlc("NABIL", {
      from: "2026-11-03",
      to: "2026-11-03",
    });
    expect(candles.meta.sourceType).toBe("unofficial");
    expect(candles.meta.productionReady).toBe(false);
    expect(candles.data[0]!.close).toBe(552);
  });

  it("declares only the capabilities free sources can support", () => {
    const provider = createPersonalFreeProvider({ dataDir: fixture() });
    expect(provider.descriptor.capabilities).toEqual(
      PERSONAL_FREE_CAPABILITIES,
    );
    expect(provider.descriptor.capabilities).not.toContain("floorsheet");
    expect(provider.descriptor.capabilities).not.toContain(
      "fundamentalsHistory",
    );
  });

  it("refuses production unless the free edition is explicit", () => {
    expect(() =>
      createProvider("personal", {
        NODE_ENV: "production",
        PERSONAL_DATA_DIR: fixture(),
      }),
    ).toThrow(/DATA_EDITION=free/);

    const free = createProvider("personal", {
      NODE_ENV: "production",
      DATA_EDITION: "free",
      PERSONAL_DATA_DIR: fixture(),
    });
    expect(free.descriptor.sourceType).toBe("unofficial");
    expect(free.descriptor.productionReady).toBe(false);
  });

  it("honours a capability override from the environment", () => {
    const provider = createProvider("personal", {
      NODE_ENV: "development",
      PERSONAL_DATA_DIR: fixture(),
      PERSONAL_CAPABILITIES: "companyList,dailyOhlc,fundamentals",
    });
    expect(provider.descriptor.capabilities).toEqual([
      "companyList",
      "dailyOhlc",
      "fundamentals",
    ]);
  });
});

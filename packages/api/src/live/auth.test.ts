import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
// Deep import of the package's pure auth module only (no TLS side effects),
// used to prove the port is faithful. Never import its session/index/client.
import {
  TokenParser as PackageTokenParser,
  calculatePayloadId as packageCalculatePayloadId,
} from "nepseman-api/dist/auth.js";
import {
  calculatePayloadId,
  createWasmTokenProvider,
  nepalDayOfMonth,
  resolveWasmPath,
  type PayloadType,
  type RawTokenResponse,
} from "./auth";

const HEADER = Buffer.from('{"enc":"A128CBC-HS256","alg":"dir"}').toString("base64url");
const CLEAN = `${HEADER}..${"A".repeat(22)}.${"B".repeat(150)}.${"C".repeat(22)}`;

/** Insert a junk character at each obfuscated-string index, as NEPSE does. */
function obfuscate(clean: string, positions: number[]): string {
  let out = "";
  let source = 0;
  for (let index = 0; index < clean.length + positions.length; index += 1) {
    out += positions.includes(index) ? "#" : clean[source++];
  }
  return out;
}

/** Deterministic pseudo-random generator for the fidelity checks. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("safety guards", () => {
  it("keeps TLS verification on (the package's session module is never loaded)", () => {
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe("0");
  });

  it("only references the package's wasm file from production code", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(
        /env\s*(\.NODE_TLS_REJECT_UNAUTHORIZED|\[\s*["']NODE_TLS_REJECT_UNAUTHORIZED["']\s*\])\s*=(?!=)/,
      );
      // Module specifiers in import / import() / require / require.resolve.
      const specifiers = [
        ...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\.resolve\(\s*)["']([^"']+)["']/g),
      ].map((match) => match[1]);
      for (const specifier of specifiers.filter((name) => name?.startsWith("nepseman-api"))) {
        expect(specifier, file).toBe("nepseman-api/dist/nepse.wasm");
      }
    }
  });
});

describe("nepse.wasm resolution", () => {
  it("finds the wasm shipped in the installed nepseman-api package", () => {
    const path = resolveWasmPath({});
    expect(path.replace(/\\/g, "/")).toMatch(/nepseman-api\/dist\/nepse\.wasm$/);
  });

  it("uses NEPSE_WASM_PATH exclusively and names the missing file", () => {
    expect(() => resolveWasmPath({ NEPSE_WASM_PATH: "/nowhere/nepse.wasm" })).toThrow(
      "NEPSE_WASM_PATH points to a missing file: /nowhere/nepse.wasm",
    );
  });
});

describe("token parsing with NEPSE's WASM", () => {
  it("removes the five salt-positioned characters from both tokens", async () => {
    const raw: RawTokenResponse = {
      accessToken: obfuscate(CLEAN, [28, 42, 70, 96, 118]),
      refreshToken: obfuscate(CLEAN, [29, 41, 69, 96, 118]),
      salt1: 11111,
      salt2: 22222,
      salt3: 33333,
      salt4: 44444,
      salt5: 55555,
    };
    const parsed = await createWasmTokenProvider().parseTokens(raw);
    expect(parsed).toEqual({ accessToken: CLEAN, refreshToken: CLEAN });
    expect(Buffer.from(parsed.accessToken.split(".")[0]!, "base64url").toString()).toBe(
      '{"enc":"A128CBC-HS256","alg":"dir"}',
    );
  });

  it("matches nepseman-api's TokenParser for many salt sets", async () => {
    const reference = new PackageTokenParser();
    await reference.init(resolveWasmPath({}));
    const ported = createWasmTokenProvider();
    const next = lcg(42);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.";
    for (let round = 0; round < 25; round += 1) {
      const token = () =>
        Array.from({ length: 250 }, () => alphabet[next() % alphabet.length]).join("");
      const raw: RawTokenResponse = {
        accessToken: token(),
        refreshToken: token(),
        salt1: 10000 + (next() % 90000),
        salt2: 10000 + (next() % 90000),
        salt3: 10000 + (next() % 90000),
        salt4: 10000 + (next() % 90000),
        salt5: 10000 + (next() % 90000),
      };
      expect(await ported.parseTokens(raw)).toEqual(reference.parseTokens(raw));
    }
  });
});

describe("POST payload id", () => {
  const salts = { salt1: 21780, salt2: 70035, salt3: 55491, salt4: 46272, salt5: 87289 };

  it("matches nepseman-api's calculatePayloadId for every id and type", () => {
    // The package reads the machine's local day of month; pin it to the 14th.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 14, 12, 0, 0));
    const types: PayloadType[] = ["stock-live", "sector-live", "general"];
    for (let id = 0; id < 100; id += 1) {
      for (const which of types) {
        expect(calculatePayloadId(id, salts, which, 14)).toBe(
          packageCalculatePayloadId(id, { ...salts, accessToken: "", refreshToken: "" }, which),
        );
      }
    }
  });

  it("rejects market-open ids outside NEPSE's lookup table", () => {
    expect(() => calculatePayloadId(100, salts, "general", 14)).toThrow("unexpected market-open id");
    expect(() => calculatePayloadId(1.5, salts, "general", 14)).toThrow("unexpected market-open id");
  });

  it("uses the Nepal calendar day (UTC+05:45)", () => {
    expect(nepalDayOfMonth(Date.parse("2026-11-14T18:14:00Z"))).toBe(14);
    expect(nepalDayOfMonth(Date.parse("2026-11-14T18:15:00Z"))).toBe(15);
  });
});

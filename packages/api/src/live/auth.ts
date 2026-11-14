/**
 * NEPSE token deobfuscation and POST payload-id computation.
 *
 * Ported from nepseman-api@1.0.0 (src/auth.ts), MIT License,
 * Copyright (c) 2025 nepse_scrapper contributors (author: Dipal Katuwal,
 * https://github.com/dipalkatuwal/nepseman-api). The MIT permission notice
 * applies to the ported portions:
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the
 *   "Software"), to deal in the Software without restriction, including
 *   without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to permit
 *   persons to whom the Software is furnished to do so, subject to the
 *   following conditions: The above copyright notice and this permission
 *   notice shall be included in all copies or substantial portions of the
 *   Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * Only the pure token/payload logic is ported. The package's session module
 * is deliberately NOT used: importing it sets
 * NODE_TLS_REJECT_UNAUTHORIZED=0 for the whole process. TLS verification
 * stays on here.
 *
 * The WASM binary (NEPSE's own `nepse.wasm`, which the package ships) is read
 * from the installed package, from NEPSE_WASM_PATH, or from a copy placed
 * next to the running bundle (the Electron build copies it beside
 * electron/server.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** Lookup table extracted from the NEPSE web bundle (via nepseman-api). */
const DUMMY_DATA: readonly number[] = [
  147, 117, 239, 143, 157, 312, 161, 612, 512, 804,
  411, 527, 170, 511, 421, 667, 764, 621, 301, 106,
  133, 793, 411, 511, 312, 423, 344, 346, 653, 758,
  342, 222, 236, 811, 711, 611, 122, 447, 128, 199,
  183, 135, 489, 703, 800, 745, 152, 863, 134, 211,
  142, 564, 375, 793, 212, 153, 138, 153, 648, 611,
  151, 649, 318, 143, 117, 756, 119, 141, 717, 113,
  112, 146, 162, 660, 693, 261, 362, 354, 251, 641,
  157, 178, 631, 192, 734, 445, 192, 883, 187, 122,
  591, 731, 852, 384, 565, 596, 451, 772, 624, 691,
];

/** Body of `GET /api/authenticate/prove` (salts coerced to numbers). */
export interface RawTokenResponse {
  accessToken: string;
  refreshToken: string;
  salt1: number;
  salt2: number;
  salt3: number;
  salt4: number;
  salt5: number;
}

export interface ParsedTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Turns the obfuscated tokens from `/api/authenticate/prove` into usable
 * ones. Injectable so tests (and alternative decoders) can replace the WASM.
 */
export interface TokenProvider {
  parseTokens(raw: RawTokenResponse): ParsedTokens | Promise<ParsedTokens>;
}

export type PayloadType = "stock-live" | "sector-live" | "general";

type SaltFn = (s1: number, s2: number, s3: number, s4: number, s5: number) => number;

interface NepseWasmExports {
  cdx: SaltFn;
  rdx: SaltFn;
  bdx: SaltFn;
  ndx: SaltFn;
  mdx: SaltFn;
}

/** Candidate locations of nepse.wasm, in lookup order. */
export function wasmCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env.NEPSE_WASM_PATH?.trim();
  if (override) return [override];
  const candidates: string[] = [];
  try {
    candidates.push(
      createRequire(import.meta.url).resolve("nepseman-api/dist/nepse.wasm"),
    );
  } catch {
    // Not resolvable from here (e.g. inside the Electron bundle).
  }
  try {
    candidates.push(fileURLToPath(new URL("./nepse.wasm", import.meta.url)));
  } catch {
    // import.meta.url is not a file: URL.
  }
  return candidates;
}

/** Resolve the nepse.wasm path or throw a message naming every place tried. */
export function resolveWasmPath(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = wasmCandidates(env);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;
  const where = candidates.length > 0 ? candidates.join(", ") : "(no candidates)";
  throw new Error(
    env.NEPSE_WASM_PATH?.trim()
      ? `NEPSE_WASM_PATH points to a missing file: ${where}`
      : `nepse.wasm not found (looked in: ${where}); set NEPSE_WASM_PATH`,
  );
}

function isSaltFn(value: unknown): value is SaltFn {
  return typeof value === "function";
}

/** The slice of the WebAssembly global used here (the tsconfig has no DOM lib). */
interface WebAssemblyApi {
  compile(bytes: Uint8Array): Promise<object>;
  instantiate(module: object, imports: object): Promise<{ exports: Record<string, unknown> }>;
}

async function instantiateNepseWasm(bytes: Uint8Array): Promise<NepseWasmExports> {
  const wasm = (globalThis as unknown as { WebAssembly: WebAssemblyApi }).WebAssembly;
  const module = await wasm.compile(bytes);
  const instance = await wasm.instantiate(module, {});
  const exports = instance.exports;
  const { cdx, rdx, bdx, ndx, mdx } = exports;
  if (!isSaltFn(cdx) || !isSaltFn(rdx) || !isSaltFn(bdx) || !isSaltFn(ndx) || !isSaltFn(mdx)) {
    throw new Error("nepse.wasm does not export cdx/rdx/bdx/ndx/mdx");
  }
  return { cdx, rdx, bdx, ndx, mdx };
}

/** Remove the five characters NEPSE inserts at the salt-derived positions. */
function stripPositions(value: string, positions: readonly number[]): string {
  const [a, b, c, d, e] = positions as [number, number, number, number, number];
  return (
    value.slice(0, a) +
    value.slice(a + 1, b) +
    value.slice(b + 1, c) +
    value.slice(c + 1, d) +
    value.slice(d + 1, e) +
    value.slice(e + 1)
  );
}

/** Same slicing as nepseman-api's TokenParser.parseTokens. */
export function parseTokensWith(
  wasm: NepseWasmExports,
  raw: RawTokenResponse,
): ParsedTokens {
  const { salt1: s1, salt2: s2, salt3: s3, salt4: s4, salt5: s5 } = raw;
  const { cdx, rdx, bdx, ndx, mdx } = wasm;
  const access = [
    cdx(s1, s2, s3, s4, s5),
    rdx(s1, s2, s4, s3, s5),
    bdx(s1, s2, s4, s3, s5),
    ndx(s1, s2, s4, s3, s5),
    mdx(s1, s2, s4, s3, s5),
  ];
  const refresh = [
    cdx(s2, s1, s3, s5, s4),
    rdx(s2, s1, s3, s4, s5),
    bdx(s2, s1, s4, s3, s5),
    ndx(s2, s1, s4, s3, s5),
    mdx(s2, s1, s4, s3, s5),
  ];
  return {
    accessToken: stripPositions(raw.accessToken, access),
    refreshToken: stripPositions(raw.refreshToken, refresh),
  };
}

export interface WasmTokenProviderOptions {
  /** Explicit wasm path; otherwise NEPSE_WASM_PATH / installed package / next to bundle. */
  wasmPath?: string;
  env?: NodeJS.ProcessEnv;
}

/** Default TokenProvider: NEPSE's own WASM, loaded lazily on first use. */
export function createWasmTokenProvider(
  options: WasmTokenProviderOptions = {},
): TokenProvider {
  let ready: Promise<NepseWasmExports> | null = null;
  const load = (): Promise<NepseWasmExports> => {
    ready ??= (async () => {
      const path = options.wasmPath ?? resolveWasmPath(options.env ?? process.env);
      return instantiateNepseWasm(new Uint8Array(readFileSync(path)));
    })().catch((error: unknown) => {
      ready = null; // allow a retry (e.g. after the file is put in place)
      throw error;
    });
    return ready;
  };
  return {
    async parseTokens(raw) {
      return parseTokensWith(await load(), raw);
    },
  };
}

/** Day of month in Nepal (UTC+05:45), the calendar NEPSE's servers use. */
export function nepalDayOfMonth(nowMs: number): number {
  return new Date(nowMs + (5 * 60 + 45) * 60_000).getUTCDate();
}

/**
 * POST body id, as nepseman-api's calculatePayloadId. The package reads the
 * machine's local day of month; callers here pass the Nepal day explicitly
 * so a machine outside Nepal computes the same id as a browser in Nepal.
 */
export function calculatePayloadId(
  givenId: number,
  salts: Pick<RawTokenResponse, "salt1" | "salt2" | "salt3" | "salt4" | "salt5">,
  which: PayloadType,
  dayOfMonth: number,
): number {
  const base = DUMMY_DATA[givenId];
  if (base === undefined || !Number.isInteger(givenId)) {
    throw new Error(`unexpected market-open id ${givenId} (expected 0-${DUMMY_DATA.length - 1})`);
  }
  const payloadId = base + givenId + 2 * dayOfMonth;
  if (which === "stock-live") return payloadId;

  const list = [salts.salt1, salts.salt2, salts.salt3, salts.salt4, salts.salt5];
  const idx =
    which === "sector-live"
      ? payloadId % 10 < 4 ? 1 : 3
      : payloadId % 10 < 5 ? 3 : 1;
  return payloadId + list[idx]! * dayOfMonth - list[idx - 1]!;
}

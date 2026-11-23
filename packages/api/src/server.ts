import type { IncomingMessage } from "node:http";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { createApiServer } from "./app";

const invocationDir = process.env.INIT_CWD ?? process.cwd();

try {
  loadEnvFile(resolve(invocationDir, ".env"));
} catch {
  // .env is optional.
}

// The dev server and the packaged shell both run the Free Edition by default.
// An explicit DATA_EDITION in the environment or .env still wins.
process.env.DATA_EDITION ??= "free";

const port = Number(process.env.API_PORT ?? 4310);
const dbPath = resolve(
  invocationDir,
  process.env.PERSONAL_DB ?? "./data/personal.db",
);
const dataDir = resolve(
  invocationDir,
  process.env.PERSONAL_DATA_DIR ?? "./data/personal",
);
const webDir = resolve(invocationDir, "apps/desktop/dist");

/**
 * Private IPv4 ranges a local network can use: RFC1918, link-local and CGNAT.
 * A public address is deliberately NOT treated as a local origin.
 */
function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Non-loopback, private IPv4 addresses this machine can be reached on. */
function detectLanAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (
        entry.family === "IPv4" &&
        !entry.internal &&
        isPrivateIPv4(entry.address)
      ) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

function hostnameOf(host: string | undefined): string | null {
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

const lanMode = process.env.NEPSE_LAN === "1";
const listenHost = lanMode ? "0.0.0.0" : "127.0.0.1";
const lanAddresses = lanMode ? detectLanAddresses() : [];
const lanAddressSet = new Set(lanAddresses);

const { server, edition } = createApiServer({
  dbPath,
  dataDir,
  webDir,
  // The dev server behaves like the packaged app: keep the archive current.
  autoRefresh: process.env.NEPSE_AUTO_REFRESH !== "0",
});

if (lanMode) {
  // The API is loopback-only by design. In LAN test mode the same app is
  // served from this machine's LAN address, so requests addressed to that
  // address are treated as the local origin. Every other Host/Origin is left
  // for the API to reject, so DNS-rebinding and cross-site defaults remain.
  server.prependListener("request", (request: IncomingMessage) => {
    if (!lanAddressSet.has(hostnameOf(request.headers.host) ?? "")) return;
    request.headers.host = `127.0.0.1:${port}`;
    const origin = request.headers.origin;
    if (!origin || origin === "null") return;
    try {
      if (lanAddressSet.has(new URL(origin).hostname)) {
        request.headers.origin = `http://127.0.0.1:${port}`;
      }
    } catch {
      // A malformed Origin is left as-is for the API to reject.
    }
  });
}

server.listen(port, listenHost, () => {
  console.log(`NEPSE terminal API listening on http://${listenHost}:${port}`);
  console.log(`Edition: ${edition}`);
  console.log(`Database: ${dbPath}`);
  if (lanMode) {
    if (lanAddresses.length === 0) {
      console.log(
        "LAN mode: no private IPv4 address detected; public addresses are never trusted. Use the machine's private LAN IP.",
      );
    } else {
      for (const address of lanAddresses) {
        console.log(`LAN URL: http://${address}:${port}/`);
      }
    }
    console.log(
      "LAN mode: bound to 0.0.0.0 for the local network only. No CORS, auth or API defaults were changed.",
    );
  }
});

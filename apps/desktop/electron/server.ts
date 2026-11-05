import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createApiServer } from "@stock/api";

/**
 * Headless API entry for the Electron shell.
 *
 * It is bundled to `electron/server.mjs` and started by Electron's own Node
 * runtime (ELECTRON_RUN_AS_NODE). Keeping it in a separate process means a
 * renderer crash cannot take down the database writer, and the browser build
 * can keep using the exact same HTTP API.
 */

const userData =
  process.env.NEPSE_USER_DATA ?? join(homedir(), ".nepse-terminal");
const dbPath = process.env.PERSONAL_DB ?? join(userData, "personal.db");
const dataDir = process.env.PERSONAL_DATA_DIR ?? join(userData, "data");
const webDir =
  process.env.NEPSE_WEB_DIR ?? resolve(import.meta.dirname, "..", "dist");

// The packaged product is the Free Edition unless the operator overrides it.
process.env.DATA_EDITION ??= "free";
process.env.NODE_ENV ??= "production";

mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(dataDir, { recursive: true });

const port = Number(process.env.API_PORT ?? 4310);
const { server, edition } = createApiServer({
  dbPath,
  dataDir,
  webDir,
  env: process.env,
});

server.listen(port, "127.0.0.1", () => {
  console.log(`NEPSE Terminal API http://127.0.0.1:${port}`);
  console.log(`Edition: ${edition}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Data directory: ${dataDir}`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

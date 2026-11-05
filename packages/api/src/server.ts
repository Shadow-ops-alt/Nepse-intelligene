import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { createApiServer } from "./app";

const invocationDir = process.env.INIT_CWD ?? process.cwd();

try {
  loadEnvFile(resolve(invocationDir, ".env"));
} catch {
  // .env is optional.
}

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

const { server, edition } = createApiServer({
  dbPath,
  dataDir,
  webDir,
});

server.listen(port, "127.0.0.1", () => {
  console.log(`NEPSE terminal API listening on http://127.0.0.1:${port}`);
  console.log(`Edition: ${edition}`);
  console.log(`Database: ${dbPath}`);
});

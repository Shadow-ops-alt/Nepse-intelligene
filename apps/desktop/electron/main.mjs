import { spawn } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  promises as fsp,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { app, BrowserWindow, dialog } from "electron";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REQUIRED_TABLES = [
  "companies",
  "candles",
  "quotes",
  "snapshots",
  "watchlist",
  "portfolio_transactions",
];

/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;
/** @type {BrowserWindow | null} */
let window = null;

/** Where the compressed starter database travels with the app. */
function starterDatabasePath() {
  const override = process.env.NEPSE_STARTER_DB?.trim();
  if (override) return resolve(override);
  return app.isPackaged
    ? join(process.resourcesPath, "starter", "personal.db.gz")
    : join(__dirname, "..", "resources", "personal.db.gz");
}

/** Open the file and prove it is a usable NEPSE database. */
function inspectDatabase(path, { readOnly = true } = {}) {
  const db = new DatabaseSync(path, { readOnly });
  try {
    const check = db.prepare("PRAGMA integrity_check").get();
    const result = String(check?.integrity_check ?? "");
    if (result !== "ok") {
      throw new Error(`integrity_check returned "${result}"`);
    }
    for (const table of REQUIRED_TABLES) {
      const found = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
      if (!found) throw new Error(`missing required table "${table}"`);
    }
    const companies = Number(
      db.prepare("SELECT COUNT(*) AS n FROM companies").get()?.n ?? 0,
    );
    const candles = Number(
      db.prepare("SELECT COUNT(*) AS n FROM candles").get()?.n ?? 0,
    );
    if (companies === 0 || candles === 0) {
      throw new Error(
        `no market data (companies=${companies}, candles=${candles})`,
      );
    }
    return { companies, candles };
  } finally {
    db.close();
  }
}

/**
 * First launch installs the bundled starter database; every later launch reuses
 * the client's database untouched. A missing or broken starter is fatal on
 * purpose: the API would otherwise create an empty SQLite file and look usable.
 */
async function prepareDatabase() {
  const userData = app.getPath("userData");
  mkdirSync(userData, { recursive: true });
  const dbPath = join(userData, "personal.db");

  if (existsSync(dbPath)) {
    const stats = inspectDatabase(dbPath, { readOnly: false });
    console.log(
      `[db] using existing ${dbPath} (${stats.companies} companies, ${stats.candles} candles)`,
    );
    return dbPath;
  }

  const starter = starterDatabasePath();
  if (!existsSync(starter)) {
    throw new Error(
      `Starter database not found at ${starter}. Refusing to start with an empty database.`,
    );
  }

  const incoming = `${dbPath}.incoming`;
  rmSync(incoming, { force: true });
  try {
    if (starter.toLowerCase().endsWith(".gz")) {
      await pipeline(
        createReadStream(starter),
        createGunzip(),
        createWriteStream(incoming),
      );
    } else {
      await fsp.copyFile(starter, incoming);
    }
    const stats = inspectDatabase(incoming);
    await fsp.rename(incoming, dbPath);
    console.log(
      `[db] installed starter ${dbPath} (${stats.companies} companies, ${stats.candles} candles)`,
    );
    return dbPath;
  } catch (error) {
    rmSync(incoming, { force: true });
    throw new Error(
      `Could not install the starter database: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 4310;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url, timeoutMs = 20_000) {
  const started = Date.now();
  let lastError = "not started";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API did not become ready at ${url}: ${lastError}`);
}

function startServer(port) {
  const serverPath = join(__dirname, "server.mjs");
  serverProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      DATA_EDITION: process.env.DATA_EDITION ?? "free",
      NODE_ENV: process.env.NODE_ENV ?? "production",
      API_PORT: String(port),
      NEPSE_WEB_DIR: join(__dirname, "..", "dist"),
      NEPSE_USER_DATA: app.getPath("userData"),
      PERSONAL_DB: join(app.getPath("userData"), "personal.db"),
      PERSONAL_DATA_DIR: join(app.getPath("userData"), "data"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout?.on("data", (chunk) => {
    process.stdout.write(`[api] ${chunk}`);
  });
  serverProcess.stderr?.on("data", (chunk) => {
    process.stderr.write(`[api] ${chunk}`);
  });
  serverProcess.on("exit", (code, signal) => {
    serverProcess = null;
    if (code !== 0 && !app.isQuitting) {
      console.error(`API process exited: code=${code} signal=${signal}`);
    }
  });
}

async function createWindow() {
  const devUrl = process.env.NEPSE_DEV_URL;
  const healthUrl = devUrl
    ? `http://127.0.0.1:${process.env.NEPSE_API_PORT ?? 4310}`
    : `http://127.0.0.1:${await freePort()}`;

  if (!devUrl) {
    const port = Number(new URL(healthUrl).port);
    startServer(port);
  }

  await waitForHealth(healthUrl);
  const target = devUrl ?? `${healthUrl}/`;

  window = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: "#0b0f17",
    title: "NEPSE Terminal",
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  window.once("ready-to-show", () => window?.show());
  window.webContents.on(
    "did-fail-load",
    (_event, code, description, validatedUrl) => {
      console.error(
        `Renderer failed to load ${validatedUrl}: ${code} ${description}`,
      );
    },
  );
  window.on("closed", () => {
    window = null;
  });

  await window.loadURL(target);
}

async function startApp() {
  await prepareDatabase();
  await createWindow();
}

app.whenReady().then(startApp).catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await dialog.showMessageBox({
    type: "error",
    title: "NEPSE Terminal could not start",
    message: "The local market database could not be prepared.",
    detail: `${message}\n\nNo empty database was created and no existing database was overwritten.`,
  });
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
});

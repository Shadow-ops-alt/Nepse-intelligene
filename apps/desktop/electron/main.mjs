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
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  Tray,
} from "electron";

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
/** @type {Tray | null} */
let tray = null;

/**
 * Last-resort tray image. Electron only needs a real image for the tray; the
 * packaged app does not ship build/icon.png, so a small embedded PNG keeps the
 * tray working there as well.
 */
const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAeElEQVR42mNgQAJc/OKv6YEZsAF6WY7VEfS2HMURlBgwe9m2/xQ7YtQBlGjWPtlPWwcQ8uGoA2juAEIWEJInJpGOOoCmDvifVjbqgFEHjDpg1AFD3AGU1oZD3wGUNskG3AEU14aUtooH3AF06R0N2f7hgPaQke0EAPlss+t2TW95AAAAAElFTkSuQmCC";

/** Resolve the tray icon in dev and packaged builds, then fall back. */
function trayImage() {
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, "app", "build", "icon.png"),
        join(process.resourcesPath, "build", "icon.png"),
        join(process.resourcesPath, "icon.png"),
      ]
    : [join(__dirname, "..", "build", "icon.png")];
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) return image;
    } catch (error) {
      console.warn(`[tray] could not read ${candidate}: ${String(error)}`);
    }
  }
  const fallback = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  return fallback.isEmpty() ? null : fallback;
}

function showWindow() {
  if (!window || window.isDestroyed()) {
    void createWindow().catch((error) => {
      console.error(`Could not reopen the window: ${String(error)}`);
    });
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/**
 * Tray "Check now". The alert engine lives in the renderer, so focus the
 * window and ask it to poll immediately instead of duplicating the rules in
 * the main process.
 */
function checkNow() {
  showWindow();
  const contents = window?.webContents;
  if (!contents || contents.isDestroyed() || contents.isLoading()) return;
  void contents
    .executeJavaScript(
      'window.dispatchEvent(new Event("nepse:check-alerts"))',
      true,
    )
    .catch((error) => {
      console.warn(`[tray] check now failed: ${String(error)}`);
    });
}

/**
 * A tray keeps the renderer and the child API process alive after the window
 * is closed. Linux desktops without a status-notifier host have no tray; in
 * that case creating the Tray throws and the app keeps the previous
 * close-to-quit behaviour instead of hiding with no way back.
 */
function createTray() {
  if (tray) return;
  const image = trayImage();
  if (!image) {
    console.warn("[tray] no icon available; alerts stop when the window closes");
    return;
  }
  try {
    tray = new Tray(image);
  } catch (error) {
    console.warn(
      `[tray] unavailable on this desktop; alerts stop when the window closes: ${String(error)}`,
    );
    tray = null;
    return;
  }
  tray.setToolTip("NEPSE Terminal");
  const menu = Menu.buildFromTemplate([
    { label: "Open NEPSE Terminal", click: showWindow },
    { label: "Check now", click: checkNow },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
}

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
      // Hidden windows must keep polling so tray alerts fire on schedule.
      backgroundThrottling: false,
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
  window.on("close", (event) => {
    // Closing hides to the tray instead of quitting, so the alert engine and
    // the child API process keep running. Without a tray there is no way to
    // reopen the window, so let the close through.
    if (app.isQuitting || !tray) return;
    event.preventDefault();
    window?.hide();
  });
  window.on("closed", () => {
    window = null;
  });

  await window.loadURL(target);
}

async function startApp() {
  await prepareDatabase();
  await createWindow();
  createTray();
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
  if (window && !window.isDestroyed()) {
    showWindow();
    return;
  }
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on("window-all-closed", () => {
  // With a tray the app and its API stay alive so alerts keep firing. Without
  // a tray (some Linux desktops) there is no way back, so quit as before.
  if (!tray) app.quit();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
});

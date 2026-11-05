import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog } from "electron";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;
/** @type {BrowserWindow | null} */
let window = null;

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

app.whenReady().then(createWindow).catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await dialog.showMessageBox({
    type: "error",
    title: "NEPSE Terminal failed to start",
    message,
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

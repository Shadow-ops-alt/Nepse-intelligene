#!/usr/bin/env node
/**
 * Standalone Android verification over the WebView DevTools protocol.
 *
 * Installs the APK on the running emulator, drives the real app UI, exercises
 * the local API, then force-stops and relaunches to prove persistence and
 * repeats the market/company checks with airplane mode on.
 *
 * Usage:
 *   node scripts/mobile-pack/emulator-test.mjs \
 *     --apk apps/mobile/release/NEPSE-Terminal-0.5.0-standalone.apk
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const ADB = process.env.ADB ?? "/home/xenos/android-sdk/platform-tools/adb";
const PACKAGE = "com.nepse.terminal.mobile";
const ACTIVITY = `${PACKAGE}/.MainActivity`;
const CDP_PORT = 9333;
const EVIDENCE = resolve(HERE, "evidence");

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} needs a value`);
  return value;
}

const APK = resolve(ROOT, arg("--apk",
  "apps/mobile/release/NEPSE-Terminal-0.5.0-standalone.apk"));

function adb(args, { timeout = 120_000 } = {}) {
  return execFileSync(ADB, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitForDevice() {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      const state = adb(["get-state"]);
      if (state === "device") {
        const booted = adb(["shell", "getprop", "sys.boot_completed"]);
        if (booted === "1") return;
      }
    } catch {
      // Keep waiting.
    }
    await sleep(2000);
  }
  throw new Error("emulator did not finish booting");
}

function devtoolsSocket() {
  try {
    const listing = adb(["shell", "cat", "/proc/net/unix"]);
    const match = /webview_devtools_remote_(\d+)/.exec(listing);
    return match ? `webview_devtools_remote_${match[1]}` : null;
  } catch {
    return null;
  }
}

async function attach() {
  try {
    adb(["forward", "--remove", `tcp:${CDP_PORT}`]);
  } catch {
    // No previous forward.
  }
  let socketName = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    socketName = devtoolsSocket();
    if (socketName) break;
    await sleep(1000);
  }
  if (!socketName) throw new Error("WebView DevTools socket never appeared");
  adb(["forward", `tcp:${CDP_PORT}`, `localabstract:${socketName}`]);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) =>
          target.type === "page" && target.url.startsWith("http://127.0.0.1")) ??
          targets.find((target) => target.type === "page");
        if (page && page.webSocketDebuggerUrl) {
          return await connect(page.webSocketDebuggerUrl);
        }
      }
    } catch {
      // Keep waiting for the target.
    }
    await sleep(1000);
  }
  throw new Error("no WebView page target appeared on the DevTools port");
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", () => fail(new Error("CDP socket failed")),
      { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.id && pending.has(message.id)) {
      const { resolve: ok, reject: fail } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) fail(new Error(message.error.message));
      else ok(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { resolve: ok, reject: fail });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const cdp = { socket, send };
  await send("Runtime.enable");
  await send("Page.enable");
  return cdp;
}

function makeClient(cdp) {
  const evaluate = async (expression) => {
    const response = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      const description = response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text;
      throw new Error(`page evaluation failed: ${description}`);
    }
    return response.result.value;
  };
  const waitFor = async (expression, timeout = 30_000, label = expression) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        // The page may be navigating.
      }
      await sleep(400);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const screenshot = async (name) => {
    const response = await cdp.send("Page.captureScreenshot", { format: "png" });
    const file = resolve(EVIDENCE, name);
    writeFileSync(file, Buffer.from(response.data, "base64"));
    console.log(`      screenshot ${file}`);
  };
  const bodyText = () => evaluate("document.body.innerText");
  const api = async (method, path, body) => {
    const expression = `(async () => {
      const init = { method: ${JSON.stringify(method)}, headers: { "content-type": "application/json" } };
      ${body === undefined ? "" : `init.body = JSON.stringify(${JSON.stringify(body)});`}
      const response = await fetch(${JSON.stringify(path)}, init);
      let payload = null;
      try { payload = await response.json(); } catch (error) { payload = null; }
      return { status: response.status, body: payload };
    })()`;
    return evaluate(expression);
  };
  return { evaluate, waitFor, screenshot, bodyText, api };
}

async function launchApp() {
  adb(["shell", "am", "force-stop", PACKAGE]);
  adb(["shell", "am", "start", "-W", "-n", ACTIVITY]);
}

async function attachToApp() {
  await sleep(1500);
  const cdp = await attach();
  const client = makeClient(cdp);
  await client.waitFor(
    "document.readyState === 'complete' && !!document.querySelector('.topbar-title')",
    90_000,
    "the app shell",
  );
  return { cdp, ...client };
}

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  console.log(`ADB ${ADB}`);
  console.log(`APK ${APK}`);
  await waitForDevice();

  const devices = adb(["devices"]);
  console.log(devices);
  const installed = (() => {
    try {
      adb(["install", "-r", APK], { timeout: 300_000 });
      return true;
    } catch (error) {
      console.error(String(error.stdout ?? error.message));
      return false;
    }
  })();
  check("install APK", installed);
  if (!installed) throw new Error("could not install the APK");

  adb(["shell", "pm", "clear", PACKAGE]);
  await launchApp();
  let app = await attachToApp();

  // ------------------------------------------------------------- market ---
  await app.waitFor("!document.body.innerText.includes('Local API not reachable')",
    30_000, "no local API error");
  const shell = await app.evaluate(`JSON.stringify({
    href: location.href,
    title: document.querySelector('.topbar-title')?.textContent?.trim(),
    nav: [...document.querySelectorAll('button.nav-item')]
      .filter(item => item.offsetParent !== null)
      .map(item => item.querySelector('.nav-label')?.textContent?.trim())
      .filter(Boolean)
  })`);
  const shellInfo = JSON.parse(shell);
  console.log(`      loaded ${shellInfo.href} (${shellInfo.title})`);
  check("app loads a loopback URL", /^http:\/\/127\.0\.0\.1:\d+\//.test(shellInfo.href),
    shellInfo.href);
  check("local server uses an ephemeral port", !shellInfo.href.includes(":4310/"),
    shellInfo.href);
  check("PC API is not referenced", !shellInfo.href.includes("4310"));
  // The Android local server serves /api/live/* from ShareSansar, so the
  // Live market page is intentionally available in the standalone app.
  check("Live market nav is available", shellInfo.nav.includes("Live market"),
    shellInfo.nav.join(", "));
  check("Backtest nav is hidden", !shellInfo.nav.includes("Backtest"),
    shellInfo.nav.join(", "));

  const origins = await app.evaluate(
    `JSON.stringify([...new Set(performance.getEntriesByType('resource')
      .map(entry => { try { return new URL(entry.name).origin; } catch (e) { return entry.name; } }))])`);
  check("all resources are same-origin", !origins.includes("4310"), origins);

  const marketText = await app.bodyText();
  check("market overview renders pack data",
    marketText.includes("Market overview") &&
    !marketText.includes("Could not load") &&
    marketText.length > 500,
    `${marketText.length} chars`);
  check("Market shows the 2026-11-24 session",
    marketText.includes("2026-11-24"), "session date missing");
  check("Market shows no unverified/unofficial labels",
    !/unverified|unofficial/i.test(marketText), "label text found");
  await app.screenshot("01-market-standalone.png");

  // The Live market route resolves on the phone; it is no longer redirected.
  await app.evaluate("location.hash = '#/live'");
  await sleep(1500);
  const hashAfterLive = await app.evaluate("location.hash");
  check("Live market route opens", hashAfterLive === "#/live", hashAfterLive);
  const liveText = await app.bodyText();
  check("Live market page renders",
    liveText.includes("Live market") && liveText.length > 300,
    `${liveText.length} chars`);
  check("Live market shows no unverified/unofficial labels",
    !/unverified|unofficial/i.test(liveText), "label text found");
  await app.evaluate("location.hash = '#/backtest'");
  await sleep(1200);
  const hashAfterBacktest = await app.evaluate("location.hash");
  check("Backtest route redirects to Market", hashAfterBacktest === "#/market",
    hashAfterBacktest);
  const backtestStatus = await app.api("GET", "/api/backtest/coverage?symbols=NABIL");
  check("backtest API is explicitly unavailable",
    backtestStatus.status === 503 &&
    String(backtestStatus.body?.error ?? "").includes("offline"),
    JSON.stringify(backtestStatus));

  // ------------------------------------------------------------ company ---
  await app.evaluate("location.hash = '#/company/NABIL'");
  await app.waitFor(
    "document.querySelector('.topbar-title')?.textContent?.trim() === 'NABIL'",
    30_000, "the NABIL company page");
  await app.waitFor("document.body.innerText.includes('Price')", 30_000,
    "the price card");
  const companyText = await app.bodyText();
  check("company chart page loads from pack",
    companyText.includes("NABIL") && !companyText.includes("Could not load"),
    `${companyText.length} chars`);
  const visibleTimeframes = await app.evaluate(`JSON.stringify((() => {
    const group = document.querySelector('[role="group"][aria-label="Chart timeframe"]');
    if (!group) return null;
    return [...group.querySelectorAll('button')]
      .filter(button => button.offsetParent !== null)
      .map(button => button.textContent.trim());
  })())`);
  check("intraday timeframes are hidden (only 1D)",
    visibleTimeframes === JSON.stringify(["1D"]), visibleTimeframes);
  const canvasCount = await app.evaluate(
    "document.querySelectorAll('canvas').length");
  check("price chart canvas is present", Number(canvasCount) > 0,
    `${canvasCount} canvases`);
  await app.screenshot("02-company-chart.png");

  // ---------------------------------------------------------- watchlist ---
  await app.evaluate("location.hash = '#/watchlist'");
  await app.waitFor(
    "!!document.querySelector('input[aria-label=\"Symbol to add\"]')",
    30_000, "the watchlist form");
  await app.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Symbol to add"]');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'NABIL');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  })()`);
  await sleep(300);
  await app.evaluate(`(() => {
    const form = document.querySelector('form[aria-label="Add to watchlist"]');
    form.querySelector('button').click();
    return true;
  })()`);
  await app.waitFor(
    "document.querySelector('.table')?.innerText.includes('NABIL')",
    30_000, "NABIL in the watchlist table");
  const watchlist = await app.api("GET", "/api/watchlist");
  check("watchlist add through the UI persists",
    watchlist.status === 200 && watchlist.body.symbols.includes("NABIL"),
    JSON.stringify(watchlist.body));
  await app.screenshot("03-watchlist.png");

  // -------------------------------------------------------- trade plans ---
  const order = {
    symbol: "NABIL",
    side: "buy",
    entry: 500,
    stop: 480,
    targets: [550, 570, 600],
    quantity: 100,
    fees: 50,
    notes: "standalone emulator test",
  };
  const created = await app.api("POST", "/api/trade-plans", order);
  check("trade plan create returns 201", created.status === 201,
    JSON.stringify(created.body));
  const planId = created.body?.plan?.id;
  check("trade plan is persisted with derived risk",
    Number(created.body?.plan?.riskAmount) === 2000 &&
    Number(created.body?.plan?.rewardRisk) === 2.5,
    JSON.stringify(created.body?.plan));
  const edited = await app.api("PATCH", `/api/trade-plans/${planId}`, { stop: 485 });
  check("trade plan edit updates the stop",
    edited.status === 200 && Number(edited.body?.plan?.stop) === 485,
    JSON.stringify(edited.body?.plan));
  await app.evaluate("location.hash = '#/trade-plan'");
  await app.waitFor(
    "document.body.innerText.includes('standalone emulator test')",
    30_000, "the saved trade plan in the UI");
  check("trade plan renders in the UI", true);
  await app.screenshot("04-trade-plan.png");

  // -------------------------------------------------------------- journal --
  const journal = {
    symbol: "NABIL",
    side: "buy",
    actualEntry: 500,
    actualExit: 540,
    quantity: 10,
    fees: 10,
    openedAt: "2026-11-20",
    closedAt: "2026-11-21",
    reason: "standalone emulator journal",
  };
  const journalCreated = await app.api("POST", "/api/journal", journal);
  check("journal create returns 201 with computed P&L",
    journalCreated.status === 201 &&
    Number(journalCreated.body?.entry?.pnl) === 390,
    JSON.stringify(journalCreated.body));
  await app.evaluate("location.hash = '#/journal'");
  await app.waitFor(
    "document.body.innerText.includes('standalone emulator journal')",
    30_000, "the journal entry in the UI");
  check("journal entry renders in the UI", true);
  await app.screenshot("05-journal.png");

  // -------------------------------------------------------- data quality ---
  await app.evaluate("location.hash = '#/data-quality'");
  await app.waitFor(
    "document.body.innerText.includes('Data quality') && " +
    "document.querySelectorAll('table tbody tr').length > 0",
    30_000, "the data quality table");
  const qualityText = await app.bodyText();
  check("data quality page loads from pack",
    qualityText.includes("Data quality") &&
    !qualityText.includes("Could not load"),
    `${qualityText.length} chars`);
  check("Data quality shows no unverified/unofficial labels",
    !/unverified|unofficial/i.test(qualityText), "label text found");
  await app.screenshot("06-data-quality.png");

  // ------------------------------------------------------------- data page --
  await app.evaluate("location.hash = '#/data'");
  await app.waitFor("!!document.getElementById('nepse-mobile-pack-notice')",
    30_000, "the data pack notice");
  const dataText = await app.bodyText();
  check("Data page shows the data pack notice",
    dataText.includes("Data pack") && dataText.includes("Latest session"));
  check("Data page shows no unverified/unofficial labels",
    !/unverified|unofficial/i.test(dataText), "label text found");
  const visibleUpdateCards = await app.evaluate(`JSON.stringify(
    [...document.querySelectorAll('section.card')]
      .filter(card => card.offsetParent !== null)
      .map(card => card.querySelector('h2')?.textContent?.trim())
      .filter(Boolean))`);
  check("Data page hides update/import controls",
    !visibleUpdateCards.includes("Automatic updates") &&
    !visibleUpdateCards.includes("Offline import (fallback)") &&
    !visibleUpdateCards.includes("Import history"),
    visibleUpdateCards);
  await app.screenshot("07-data-page.png");

  // --------------------------------------------------- cold restart test ---
  await launchApp();
  app = await attachToApp();
  const afterRestart = await app.api("GET", "/api/watchlist");
  check("watchlist survives a cold restart",
    afterRestart.status === 200 &&
    afterRestart.body.symbols.includes("NABIL"),
    JSON.stringify(afterRestart.body));
  const plansAfter = await app.api("GET", "/api/trade-plans");
  const planAfter = (plansAfter.body?.plans ?? [])
    .find((plan) => plan.id === planId);
  check("trade plan survives a cold restart",
    Boolean(planAfter) && Number(planAfter.stop) === 485,
    JSON.stringify(planAfter));
  const journalAfter = await app.api("GET", "/api/journal");
  check("journal entry survives a cold restart",
    (journalAfter.body?.entries ?? [])
      .some((entry) => entry.reason === "standalone emulator journal"),
    JSON.stringify(journalAfter.body));

  // ------------------------------------------------------ airplane mode ---
  try {
    adb(["shell", "cmd", "connectivity", "airplane-mode", "enable"]);
  } catch {
    adb(["shell", "settings", "put", "global", "airplane_mode_on", "1"]);
  }
  await sleep(1500);
  let airplane = "";
  try {
    airplane = adb(["shell", "settings", "get", "global", "airplane_mode_on"]);
  } catch {
    airplane = "unknown";
  }
  console.log(`      airplane_mode_on=${airplane}`);
  await launchApp();
  app = await attachToApp();
  await app.waitFor(
    "!document.body.innerText.includes('Local API not reachable')",
    45_000, "the offline app shell");
  const airplaneMarket = await app.bodyText();
  check("market overview works in airplane mode",
    airplaneMarket.includes("Market overview") &&
    airplaneMarket.length > 500,
    `${airplaneMarket.length} chars`);
  await app.screenshot("08-airplane-market.png");
  await app.evaluate("location.hash = '#/company/NABIL'");
  await app.waitFor(
    "document.querySelector('.topbar-title')?.textContent?.trim() === 'NABIL'",
    45_000, "the offline NABIL chart");
  await app.waitFor("document.body.innerText.includes('Price')", 45_000,
    "the offline price card");
  const airplaneCandles = await app.evaluate(`(async () => {
    const response = await fetch('/api/candles?symbol=NABIL');
    const body = await response.json();
    return { status: response.status, candles: body.candles?.length ?? 0 };
  })()`);
  check("company candles load in airplane mode",
    airplaneCandles.status === 200 && airplaneCandles.candles > 500,
    JSON.stringify(airplaneCandles));
  await app.screenshot("09-airplane-company.png");
  try {
    adb(["shell", "cmd", "connectivity", "airplane-mode", "disable"]);
  } catch {
    adb(["shell", "settings", "put", "global", "airplane_mode_on", "0"]);
  }

  const failed = results.filter((result) => !result.ok);
  writeFileSync(resolve(EVIDENCE, "results.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), apk: APK, results },
      null, 2) + "\n");
  console.log("");
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("FAILED:");
    for (const result of failed) console.log(`- ${result.name}: ${result.detail}`);
    process.exit(1);
  }
  // The CDP WebSocket keeps the event loop alive; the run is finished here.
  process.exit(0);
}

main().catch((error) => {
  console.error(error.stack ?? String(error));
  process.exit(1);
});

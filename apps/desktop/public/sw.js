/*
 * NEPSE Terminal service worker.
 *
 * Navigation is network-first so a rebuilt app is picked up immediately.
 * Hashed Vite assets and the shell are cached for offline use. /api is never
 * cached: prices and the local ledger must always come from the API.
 *
 * The cache name is derived from the hashed entry script in index.html, so a
 * new build installs a new cache and activate deletes the previous one. That
 * stops old hashed assets accumulating across releases.
 */
const CACHE_PREFIX = "nepse-shell-";
const SHELL = ["/", "/index.html", "/manifest.webmanifest"];

let cacheNamePromise = null;

function cacheName() {
  cacheNamePromise ??= (async () => {
    try {
      const response = await fetch("/index.html", { cache: "no-store" });
      if (!response.ok) throw new Error("index.html unavailable");
      const html = await response.text();
      const asset = /["'](\/assets\/[^"']+\.js)["']/.exec(html)?.[1];
      if (asset) {
        return CACHE_PREFIX + asset.replace(/[^a-z0-9]/gi, "").slice(-24);
      }
    } catch {
      // Fall through to a stable name; activate will not evict other caches.
    }
    return `${CACHE_PREFIX}fallback`;
  })();
  return cacheNamePromise;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const name = await cacheName();
      const cache = await caches.open(name);
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const name = await cacheName();
      if (!name.endsWith("fallback")) {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((key) => key !== name).map((key) => caches.delete(key)),
        );
      }
      await self.clients.claim();
    })(),
  );
});

function isCacheable(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname === "/hosted-config.json") return false;
  return true;
}

async function cachedShell() {
  const cache = await caches.open(await cacheName());
  return (
    (await cache.match("/index.html")) ??
    (await cache.match("/")) ??
    Response.error()
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!isCacheable(request)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(await cacheName())
              .then((cache) => cache.put("/index.html", copy))
              .catch(() => undefined);
          }
          return response;
        } catch {
          return cachedShell();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        caches
          .open(await cacheName())
          .then((cache) => cache.put(request, copy))
          .catch(() => undefined);
      }
      return response;
    })(),
  );
});

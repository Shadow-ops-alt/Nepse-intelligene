# Mobile testing (phone and PWA)

The desktop app is a React + Vite web bundle served by the same local API that
the Electron app uses. Nothing here changes the Electron build. The phone loads
the identical web app over the LAN and the same end-of-day store.

## 1. Run the API on the LAN

By default the API binds `127.0.0.1` only. `NEPSE_LAN=1` binds `0.0.0.0` and
prints the URLs to use:

```bash
NEPSE_LAN=1 API_PORT=4310 pnpm dev:api
```

The output includes one or more lines such as:

```
LAN URL: http://192.168.1.42:4310/
```

Requests addressed to one of the machine's detected LAN IPv4 addresses are
treated as the local origin so the app's own API calls work. Every other Host
and Origin is still rejected by the existing DNS-rebinding and cross-site
checks. No CORS headers, auth rules or API defaults were relaxed. Without
`NEPSE_LAN=1` the server is unchanged and still binds `127.0.0.1`.

If the phone cannot connect, allow the port through the host firewall and
confirm both devices are on the same network. The server is for a trusted local
network only; do not expose it to the internet.

## 2. Build the web bundle

The API serves `apps/desktop/dist` when it exists. Build it first:

```bash
pnpm build:web
```

Then start the API with `NEPSE_LAN=1` as above and open the printed LAN URL on
the phone: `http://192.168.x.x:4310/`.

For live frontend development over the LAN, run the API with `NEPSE_LAN=1` and
Vite bound to all interfaces:

```bash
NEPSE_LAN=1 API_PORT=4310 pnpm dev:api
pnpm dev:web -- --host 0.0.0.0
```

Open `http://192.168.x.x:5173/` on the phone. The Vite proxy forwards `/api` to
the LAN-enabled API.

## 3. What to test on the phone

Use a viewport of 360-430 CSS pixels wide (390x844 is the reference size).

- The sidebar is a drawer opened by the menu button in the top bar. It closes
  on navigation, backdrop tap and Escape.
- No horizontal page scroll on Market, a company page (including the
  Candlestick patterns tab) and Data. Tables and the chart drawing toolbar
  scroll inside their own containers.
- The top bar, breadcrumbs, action buttons, segmented controls and cards wrap
  or stack instead of widening the page.
- Charts fill the card width and keep a usable height.
- Nothing important is hidden behind a notch or the mobile browser chrome
  (`viewport-fit=cover` and safe-area padding are applied).
- Tap targets work and charts redraw on rotation.

A quick programmatic check in the browser console:

```js
document.documentElement.scrollWidth <= window.innerWidth
```

It must be `true` on each page.

## 4. Install as a PWA

The manifest (`/manifest.webmanifest`), icons (`/icons/icon-192.png` and
`/icons/icon-512.png`) and service worker (`/sw.js`) are shipped with the web
bundle. The service worker caches the app shell and hashed assets, uses
network-first navigation, and never caches `/api` responses.

Chrome and Safari only allow service-worker registration and the install
prompt in a secure context: HTTPS or `localhost`. Opening
`http://192.168.x.x:4310/` over plain LAN HTTP loads and runs the app, but the
service worker will not register and Chrome will not offer "Install app". That
is expected, not a configuration bug. Registration is guarded and fails
silently.

Ways to exercise installability:

- On the machine running the API, open `http://localhost:4310/` after
  `pnpm build:web` and use Chrome's install icon or DevTools > Application >
  Manifest. The manifest, icons and service worker can be inspected there.
- Put the same bundle behind HTTPS later (reverse proxy or tunnel) and install
  from the phone.

There is no TLS server in this change.

## 5. Known limitations

- Plain LAN HTTP is fine for layout and functional testing, but no service
  worker, no offline shell and no install prompt without a secure context.
- The service worker is registered only in production builds, so the Vite dev
  server never registers one.
- This does not produce an Android APK. A native APK needs the Android SDK,
  a Gradle project (for example Capacitor or a Trusted Web Activity wrapper)
  and signing. That work is not part of this change; the phone experience here
  is the installable web app plus LAN testing.
- The API remains single-user and unauthenticated by design. Do not expose it
  beyond a trusted local network.

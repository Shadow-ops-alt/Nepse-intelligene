# Android APK (standalone offline app)

The Android build is a standalone offline app. The APK contains the web build
and an end-of-day data pack. At launch it starts a small HTTP server on
`127.0.0.1` with an ephemeral port, then loads the bundled web app in a
WebView. No PC, no LAN and no internet connection are required for the bundled
data.

- Package: `com.nepse.terminal.mobile`
- Label: NEPSE Terminal
- Version: 0.5.0 (versionCode 500)
- Min Android: 8.0 (API 26)
- Target Android: 15 (API 35)
- APK: `apps/mobile/release/NEPSE-Terminal-0.5.0-standalone.apk`
- Debug-signed with `apps/mobile/debug.keystore` for testing only.

The previous 0.4.0 APK was a thin LAN client that needed the PC API. It is
replaced by this standalone build.

## 1. Architecture

```
APK assets/
  web/            Vite production build of apps/desktop
  pack/           JSON data pack (candles, screener, fundamentals, ...)
  mobile/         injected shell JS/CSS
        |
        v
LocalServer (Java, 127.0.0.1:<ephemeral>)
  /            -> web assets from APK (SPA fallback to index.html)
  /assets/*    -> hashed Vite assets
  /api/*       -> pack JSON, or filesDir-backed personal data
  /mobile/*    -> injected shell
        |
        v
WebView -> http://127.0.0.1:<ephemeral>/
        |
        v
filesDir/
  local/*.json           watchlist, transactions, plans, journal, ledger
  journal-snapshots/     journal chart images
  pack/                  optional downloaded data pack (preferred over APK)
```

The server binds only to `127.0.0.1` and rejects a Host or Origin that is not a
loopback address. It has no authentication, matching the desktop app's
single-user model. Do not expose the port; it is not reachable off-device.

The web app still calls relative `/api/...` paths, so no web source changed.
A small script injected into the served `index.html` hides controls that need
the PC API and adds the data pack notice to the Data page.

## 2. Data pack

Generate the pack from the existing API. Use the running API:

```bash
npx --yes tsx scripts/mobile-pack/generate.ts \
  --api-url http://127.0.0.1:4310 \
  --years 5 \
  --version 0.5.0
```

Or let the generator start the API itself on a temporary copy of the starter
database:

```bash
npx --yes tsx scripts/mobile-pack/generate.ts \
  --db /path/to/personal.db --data-dir /path/to/data --years 5
```

Options: `--api-url`, `--db`, `--data-dir`, `--out`, `--years`, `--version`,
`--zip`, `--keep-temp`.

The recorded pack for this build:

- Output: `apps/mobile/assets/pack/`
- Files: 1506 (including `manifest.json`)
- Size: 71.8 MB uncompressed; the APK compresses it to about 9.9 MB
- Candle window: 5 years from 2021-11-24
- Latest session: 2026-11-13
- Pack hash: `42acda5fdc70436c7498c0fb98b06f419211095c14ad6a5db6d38c7b6a6da879`
- Contents: 468 companies, 335 quotes, 18 indices, 463 equity candle series
  (304,336 candles), 17 index series, 332 fundamentals files, 204 corporate
  action series, 468 derived analysis files, the latest floorsheet day, broker
  flows, news, IPOs, mutual fund NAVs and the precomputed data-quality report.

Pack layout:

```
manifest.json                  version, generatedAt, latestSession, counts,
                               per-file size and SHA-256, packHash
api/meta.json                  /api/meta
api/companies.json             /api/companies
api/quotes.json                /api/quotes
api/summary.json               /api/summary
api/indices.json               /api/indices
api/screener.json              /api/screener
api/signals.json               /api/signals (lookback 5)
api/data-quality.json          /api/data-quality
api/fundamentals-latest.json   /api/fundamentals/latest
api/fundamentals-index.json    /api/fundamentals (no symbol)
api/news.json                  /api/news
api/ipos.json                  /api/ipos
api/floorsheet.json            /api/floorsheet
api/broker-flows.json          /api/broker-flows
api/mutual-funds.json          /api/mutual-funds
api/coverage.json              /api/coverage
api/corporate-actions-all.json /api/corporate-actions/all
api/company-events.json        /api/company-events (empty in this pack)
candles/index.json             list of available candle symbols
candles/<SYMBOL>.json          /api/candles?symbol=...
candles-index/<SYMBOL>.json    /api/candles?kind=index&symbol=...
fundamentals/<SYMBOL>.json     /api/fundamentals?symbol=...
corporate-actions/<SYMBOL>.json
company-events/<SYMBOL>.json
analysis/<SYMBOL>.json         /api/analysis?symbol=... (derived from screener)
```

The generator is reproducible and prints the pack size and hash. It does not
modify the source packages or the app database.

## 3. Build

Build the web bundle first, then the APK. The build script copies
`apps/desktop/dist` into `apps/mobile/assets/web` and links `assets/` into the
APK with `aapt2 -A`.

```bash
npx --yes pnpm@12.16.1 build:web
cd apps/mobile
./build.sh
```

Requirements:

- JDK 17 or newer with `javac` (this build used Corretto 21).
- Android SDK with build-tools 35.0.0 and platform android-35.
- `python3` (used to append `classes.dex` to the APK zip).
- `keytool` from the JDK (the debug keystore is already in the repo).

The script checks that `apps/desktop/dist/index.html`, the pack manifest and
`assets/mobile/mobile.js` exist before it starts. It fails with an instruction
if one is missing.

Pipeline: `aapt2 compile` -> `aapt2 link -A assets` -> `javac` (Java 8
language level, Android bootclasspath) -> `d8` -> append `classes.dex` ->
`zipalign -p 4` -> `apksigner sign` -> verify.

Output:

```
apps/mobile/release/NEPSE-Terminal-0.5.0-standalone.apk
```

## 4. Install

```bash
adb install -r apps/mobile/release/NEPSE-Terminal-0.5.0-standalone.apk
```

Or `./build.sh --install`. No first-run server dialog appears. The app opens
`http://127.0.0.1:<port>/` automatically. The overflow menu has **Reload**,
**Data pack info** and **Check for data updates**.

## 5. What works offline

Served from the pack:

- Market overview: summary, quotes, indices, sectors, movers, news, IPOs and the
  latest floorsheet day.
- Companies and company pages: company master, 1D candles, derived indicators,
  fundamentals, corporate actions and the analysis stats.
- Screener, signals and alerts, sectors, fundamentals desk, floorsheet and
  broker flows, IPO/events/news, mutual fund NAVs and the data quality report.
- Watchlist, portfolio, calculator, trade plans, journal, reconciliation and
  the corporate ledger.

Served from `filesDir` (read/write, survives a cold restart):

| Endpoint | Methods |
| --- | --- |
| `/api/watchlist` | GET, POST add/remove |
| `/api/portfolio` | GET (computed from local transactions and pack prices) |
| `/api/portfolio/transactions` | POST |
| `/api/portfolio/transactions/remove` | POST |
| `/api/trade-plans` | GET, POST |
| `/api/trade-plans/<id>` | PATCH, DELETE |
| `/api/journal` | GET, POST |
| `/api/journal/<id>` | PATCH, DELETE |
| `/api/journal/<id>/snapshot` | GET |
| `/api/corporate-ledger` | GET, POST |
| `/api/corporate-ledger/<id>` | DELETE |
| `/api/reconciliation/import` | POST |
| `/api/reconciliation/transactions` | GET |
| `/api/reconciliation/summary` | GET (XIRR and exposure computed locally) |
| `/api/import/status`, `/api/import/history`, `/api/refresh/status` | GET, offline status only |

Hidden or explicitly unavailable:

- **Live market** is hidden from the navigation and `#/live` redirects to
  Market. `/api/live/*` and `/api/intraday` return `503
  {"error":"Not available in the offline mobile app"}`.
- **Backtest** is hidden and `#/backtest` redirects to Market.
  `/api/backtest/*` returns the same 503.
- Intraday timeframe buttons (1m through 1h) are hidden; only **1D** is shown.
- The Data page's automatic-update, offline-import and import-history cards are
  hidden. A **Data pack** card shows the version, latest session, generation
  date, source and the update instructions.
- `/api/refresh/run`, `/api/import/preview` and `/api/import/run` return the
  same 503.

## 6. Local storage

Everything lives under the app's private `filesDir`:

```
filesDir/local/watchlist.json
filesDir/local/transactions.json
filesDir/local/plans.json
filesDir/local/journal.json
filesDir/local/ledger.json
filesDir/local/reconciliation.json
filesDir/journal-snapshots/<id>.png|jpg|webp
```

Writes are atomic (write `.tmp`, fsync, rename). Journal P&L, portfolio cost
basis/realised P&L, XIRR and concentration are computed in Java using the same
formulas as `@stock/analytics`.

## 7. Data updates

The overflow menu has **Check for data updates**. It downloads a mobile pack
zip from a configurable URL, default:

```
https://github.com/Shadow-ops-alt/Nepse-intelligene/releases/latest/download/NEPSE-Terminal-0.6.0-mobile-pack.zip
```

Before installing, every file listed in the archive's `manifest.json` is
checked with SHA-256. The new pack is extracted to `filesDir/pack-next`; only a
fully verified pack replaces `filesDir/pack`. The downloaded pack is preferred
over the APK pack, and missing files fall back to the APK copy.

Status: the downloader, hash verification and install path are implemented,
but they have not been exercised end-to-end because no mobile-pack release
asset has been published yet. Without an update, the data is as fresh as the
bundled pack. The pack can also be updated by shipping a new APK. The generator
supports `--zip <path>` to produce the release archive.

## 8. Verification

Build checks:

```bash
npx --yes pnpm@12.16.1 build:web
cd apps/mobile && ./build.sh
```

The build prints `apksigner verify` output and `aapt2 dump badging`:

- `package: com.nepse.terminal.mobile`, versionCode 500, versionName 0.5.0
- minSdk 26, targetSdk 35
- `apksigner`: APK Signature Scheme v2 and v3 verified
- `zipalign -c -p 4`: verification successful

Emulator checks (`scripts/mobile-pack/emulator-test.mjs`) install the APK on an
API 34 emulator, drive the WebView over the DevTools protocol and assert
(29/29 checks passed in the recorded run):

1. The loaded URL is `http://127.0.0.1:<ephemeral>`, not port 4310.
2. Every resource is same-origin; no request reaches the PC API.
3. Market overview renders pack data.
4. Live market and Backtest are absent from the visible navigation; their
   routes redirect to Market; their APIs return 503.
5. Company page loads the 1D chart, a canvas is present, and only the 1D
   timeframe is visible.
6. Watchlist add through the UI persists in `/api/watchlist`.
7. Trade plan create and edit return the derived risk fields and render in the
   UI.
8. Journal create computes P&L (390 in the test) and renders.
9. Data quality page loads and renders a table.
10. Data page shows the data pack notice and hides the update/import cards.
11. After a force-stop and relaunch, the watchlist, trade plan and journal
    still exist.
12. With airplane mode on and a cold launch, Market and the NABIL chart still
    load from the bundled pack; `/api/candles?symbol=NABIL` returns 1149
    candles.

Evidence screenshots and `results.json` are written under
`scripts/mobile-pack/evidence/`.

The APK for this record:

```
path:   apps/mobile/release/NEPSE-Terminal-0.5.0-standalone.apk
bytes:  9,900,890
size:   9.9 MB
sha256: 6833d6dfa81f782f598b8a32ca84091997e554e8a0c28fa078567ad64150f45b
```

## 9. Limitations

- The pack is a snapshot. There is no live LTP, no intraday history and no
  background refresh.
- Backtesting and archive imports are unavailable offline and hidden.
- Only the latest floorsheet day and its broker flows are in the pack. The
  floorsheet date picker shows that one date.
- Company events are empty in this pack because the source data folder had no
  `company-events.csv`. Company pages show the normal "unavailable" state.
- Candles cover the configured window (5 years here). A longer chart range ends
  at the start of the pack window.
- Data quality is computed when the pack is generated, not on the device.
- The app is debug-signed and is not a Play Store artifact.
- The local server is unauthenticated, like the desktop app. It binds to
  loopback only.
- The service worker is served but unregistered by the mobile shell, so a new
  web build is picked up on reload instead of from an old cache.

## 10. Troubleshooting

- **"NEPSE Terminal could not start"**: the local port could not be opened.
  Relaunch the app; check `adb logcat -s NepseLocalServer`.
- **Blank page**: confirm `assets/web/index.html` is in the APK
  (`unzip -l <apk> | grep assets/web/index.html`).
- **"Data pack" says no manifest**: the APK was built without
  `assets/pack/manifest.json`. Regenerate the pack and rebuild.
- **Company events are empty**: expected when the source data folder has no
  event CSV; it is not a local-server error.
- **Update fails**: the default release asset may not exist yet. The error
  names the HTTP status or the file whose hash did not match. The existing
  bundled or downloaded pack is left untouched.
- **`adb: no devices/emulators found`**: start the emulator and check
  `adb devices`.

## Hosted Supabase mode

The same APK can sign in to a Supabase account. Put the project URL and the
publishable key in `apps/mobile/assets/mobile/hosted-config.json` (ignored by
git; see `hosted-config.example.json`). The local server serves it at
`/hosted-config.json`; the web UI then shows an email/password login and stores
watchlist, portfolio, plans, journal, corporate ledger and reconciliation in
Supabase. Market data still comes from the bundled pack.

The secret/service key must never be placed in this config or the APK. RLS
enforces ownership. The local server uses the fixed port 41731 so the Supabase
session survives a cold start. Without the config file the APK stays in the
offline local mode. See [SUPABASE.md](./SUPABASE.md).

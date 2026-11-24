# NEPSE Terminal Android APK

Standalone offline Android app for NEPSE Terminal. The APK bundles the web
build and an end-of-day data pack. At launch it starts a small HTTP server on
`127.0.0.1` with an ephemeral port and loads the bundled app in a WebView. No
PC API and no network are required.

- Package: `com.nepse.terminal.mobile`
- Version: 0.5.0 (versionCode 500)
- Min SDK: 26 (Android 8.0)
- Target SDK: 35 (Android 15)
- Permissions: `INTERNET` (used only for optional pack downloads)
- Debug-signed for testing.

## What the app does

- Starts `LocalServer` on `127.0.0.1:<ephemeral>` and loads
  `http://127.0.0.1:<port>/`.
- Serves `/assets/*`, `/icons/*`, `index.html`, `sw.js` and SPA routes from the
  bundled `assets/web` build.
- Serves `/api/*` from `assets/pack` (or `filesDir/pack` when a newer pack was
  downloaded) and from JSON files in `filesDir` for the personal tools.
- Injects `assets/mobile/mobile.js` into the shell. It hides Live market,
  Backtest and intraday timeframes, redirects their routes, and replaces the
  Data page's update controls with a data pack notice.
- Overflow menu: **Reload**, **Data pack info**, **Check for data updates**.
- System Back walks the WebView history, then exits.
- Links to any host other than `127.0.0.1` open in the system browser.

The local server binds to loopback only and rejects a non-loopback Host or
Origin. It is single-user and unauthenticated, matching the desktop app.

## Build

Prerequisites:

- JDK 17+ with `javac`. This project was built with Amazon Corretto 21.
- Android SDK build-tools 35.0.0 and platform android-35.
- `python3` (appends `classes.dex` to the APK zip).
- `keytool` from the JDK.

```bash
export ANDROID_HOME=/tmp/android-sdk
export JAVA_HOME=/tmp/jdk/amazon-corretto-21.0.13.1.2-linux-x64

# 1. Build the web app.
cd ../..
npx --yes pnpm@12.16.1 build:web

# 2. Generate the data pack (see docs/ANDROID_APK.md).
npx --yes tsx scripts/mobile-pack/generate.ts \
  --api-url http://127.0.0.1:4310 --years 5 --version 0.5.0

# 3. Build and sign.
cd apps/mobile
./build.sh
```

`build.sh` copies `apps/desktop/dist` to `assets/web`, checks that
`assets/pack/manifest.json` and `assets/mobile/mobile.js` exist, then runs:

1. `aapt2 compile --dir res`
2. `aapt2 link ... -A assets`
3. `javac -source 8 -target 8 -bootclasspath android.jar`
4. `d8 --min-api 26`
5. Append `classes.dex` to the linked APK zip
6. `zipalign -p 4`
7. `apksigner sign` with the debug keystore
8. `apksigner verify` and `aapt2 dump badging`

Output:

```
apps/mobile/release/NEPSE-Terminal-0.5.0-standalone.apk
```

The keystore is `apps/mobile/debug.keystore` (alias `androiddebugkey`,
password `android`). The APK is a debug-signed test build, not a Play Store
artifact.

### Install

```bash
adb install -r apps/mobile/release/NEPSE-Terminal-0.5.0-standalone.apk
```

Or `./build.sh --install`.

## Local storage

`filesDir/local/` holds `watchlist.json`, `transactions.json`, `plans.json`,
`journal.json`, `ledger.json` and `reconciliation.json`. Journal chart images
live in `filesDir/journal-snapshots/`. Writes are atomic.

`filesDir/pack/` holds a downloaded data pack when one passes hash
verification; it is preferred over the APK pack.

## Source layout

```
apps/mobile/
  AndroidManifest.xml
  build.sh
  assets/
    web/                 staged from apps/desktop/dist by build.sh
    pack/                generated data pack
    mobile/              injected shell JS/CSS
  src/com/nepse/terminal/mobile/
    MainActivity.java    WebView, menu, update dialog
    LocalServer.java     loopback HTTP server and API routes
    LocalStore.java      filesDir JSON storage and local analytics
    PackStore.java       pack access (APK assets or downloaded)
    PackUpdater.java     download, SHA-256 verify and install
    J.java               JSONObject with unchecked put() for responses
  res/
  release/
  build/
```

## Limitations

- The data is a snapshot: no live LTP, no intraday bars, no backtests and no
  archive imports. Those pages are hidden and their endpoints return 503.
- Only the latest floorsheet day is in the pack.
- Data freshness depends on the pack. See `docs/ANDROID_APK.md` for the update
  mechanism and its current status.
- Debug-signed. Not suitable for distribution.
- No background alerts or push notifications.

## Regenerating icons

```bash
for spec in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  d=${spec%%:*}; s=${spec##*:}
  magick apps/desktop/build/icon.png -filter Lanczos -resize ${s}x${s} \
    -strip apps/mobile/res/mipmap-$d/ic_launcher.png
done
```

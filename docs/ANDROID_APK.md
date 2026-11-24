# Android APK (thin LAN client)

The Android build is a thin WebView shell around the web app that the local API
serves. The APK does not bundle the web app. The phone loads the same PWA from
the PC over the LAN, so the two devices must be on the same network while you
use it.

- Package: `com.nepse.terminal.mobile`
- Label: NEPSE Terminal
- Version: 0.4.0
- Min Android: 8.0 (API 26)
- Target Android: 15 (API 35)
- APK: `apps/mobile/release/NEPSE-Terminal-0.4.0-android.apk`
- Build source and script: `apps/mobile/`

## 1. Run the API on the LAN

Build the web bundle once so the API has something to serve:

```bash
npx --yes pnpm@12.16.1 build:web
```

Then start the API bound to all interfaces:

```bash
NEPSE_LAN=1 API_PORT=4310 npx --yes pnpm@12.16.1 --filter @stock/api start
```

The API prints one or more LAN URLs such as:

```
LAN URL: http://192.168.100.111:4310/
```

Use the address for the network the phone is on. The default in the app is
`http://192.168.100.111:4310`; change it in the app if your PC uses a different
address or port.

Notes:

- Without `NEPSE_LAN=1` the API binds `127.0.0.1` only and the phone cannot
  reach it.
- If the API exits with `unable to open database file`, create the default data
  directory first: `mkdir -p data`. The default store is `./data/personal.db`
  relative to the repo root. `PERSONAL_DB` and `PERSONAL_DATA_DIR` override it.
- Keep both devices on the same Wi-Fi or Ethernet network. Guest Wi-Fi networks
  that isolate clients will block the connection.
- Allow TCP port 4310 through the host firewall. Examples:
  - ufw: `sudo ufw allow 4310/tcp`
  - firewalld: `sudo firewall-cmd --add-port=4310/tcp --permanent && sudo firewall-cmd --reload`
  - Windows: add an inbound rule for TCP 4310 in Windows Defender Firewall
- The server is for a trusted local network only. Do not expose it to the
  internet.
- `pnpm start` also works: it builds the web bundle and then starts the API.

## 2. Install the APK

The APK is debug-signed, so Android allows installation from `adb` without
extra steps. With the phone connected over USB and USB debugging enabled:

```bash
adb install -r apps/mobile/release/NEPSE-Terminal-0.4.0-android.apk
```

Alternatively, copy the APK to the phone and open it, allowing installs from
the file manager or browser when prompted.

To build and install in one step:

```bash
cd apps/mobile
./build.sh --install
```

## 3. First run and changing the server

On first launch the app asks for the server URL. The default is:

```
http://192.168.100.111:4310
```

Enter the LAN URL printed by the API and tap Save. The app trims trailing
slashes. `http://host:port` and `https://host` are accepted. A bare
`host:port` is treated as `http://host:port`. Empty or invalid input is
rejected and the dialog stays open.

If you tap Later, the app shows a local error page with Change server.

To change the address later, open the overflow menu in the action bar and
choose Change server. Reload is in the same menu. The address is saved in
`SharedPreferences`; the app stores nothing else.

## 4. What the app does

- Loads the API-served web app in a WebView with JavaScript, DOM storage,
  database storage and mixed content enabled.
- System Back walks the WebView history first, then leaves the app.
- Links to hosts other than the configured server open in the system browser.
  `mailto:`, `tel:`, `sms:`, `geo:` and `market:` links are handed to the
  matching app.
- If the server is unreachable, the WebView shows a local error page with
  Retry and Change server.
- Cleartext HTTP is allowed so `http://192.168.x.x:4310` works.

The web app is unchanged. Layout, charts, alerts, journal and other features
behave as they do in the mobile browser, with the same limitations described in
`docs/MOBILE.md`.

## 5. Limitations

- Thin client. It requires the PC API to be running. There is no offline data
  and no local database.
- Cleartext HTTP is for testing on a trusted LAN. The app does not add TLS.
  Use HTTPS only with a certificate Android trusts; a self-signed certificate
  fails and shows the error page.
- Debug-signed with a local debug keystore. Not suitable for the Play Store or
  public distribution.
- The API is single-user and unauthenticated by design. The app stores only the
  server URL and adds no authentication.
- Alerts run only while the web page is open. There is no push notification and
  no background sync.
- The service worker does not register over plain LAN HTTP, so there is no
  offline app shell. This matches the PWA behavior.
- No app-level download manager, file upload picker customization or native
  share sheet beyond what the WebView and the web app provide.

## 6. Build

See `apps/mobile/README.md`. The build uses `aapt2`, `javac`, `d8`,
`zipalign` and `apksigner` directly, with no Gradle.

## 7. Troubleshooting

- The app shows "Can't reach the NEPSE Terminal server":
  confirm `NEPSE_LAN=1` was set, the API is running, the printed LAN address
  matches the URL in the app, both devices are on the same subnet, and the host
  firewall allows TCP 4310.
- The app opens but pages are blank: confirm the web bundle was built
  (`npx --yes pnpm@12.16.1 build:web`) and that the API prints a LAN URL.
- A self-signed HTTPS URL fails: use plain HTTP on the trusted LAN or install a
  certificate Android trusts.
- `adb: no devices/emulators found`: enable USB debugging, accept the RSA
  fingerprint prompt on the phone, and check `adb devices`.

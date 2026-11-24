# NEPSE Terminal Android APK

Thin Android client for the local NEPSE Terminal API. The APK contains only a
WebView shell. The web app itself is served by the PC, exactly like the PWA.
There is no bundled web bundle and no offline copy.

- Package: `com.nepse.terminal.mobile`
- Version: 0.4.0 (versionCode 400)
- Min SDK: 26 (Android 8.0)
- Target SDK: 35 (Android 15)
- Permissions: `INTERNET`
- Cleartext HTTP is enabled for LAN testing.

## What the app does

- On first run it asks for the server URL. Default:
  `http://192.168.100.111:4310`
- Loads the API-served web app in a WebView with JavaScript, DOM storage and
  database storage enabled, and mixed content allowed.
- The system Back button walks the WebView history, then exits.
- Links to any host other than the configured server open in the system browser.
- If the server cannot be reached, a local error page offers Retry and Change
  server.
- The overflow menu has Reload and Change server.

Only the server URL is stored, in `SharedPreferences` under the name
`nepse_terminal`. No credentials are stored by the app.

## Build

The build uses the Android build tools directly. Gradle is not required.

### Prerequisites

- A JDK 17 or newer with `javac`. A JRE alone is not enough.
  This project was built with Amazon Corretto 21:
  `https://corretto.aws/downloads/latest/amazon-corretto-21-x64-linux-jdk.tar.gz`
- Android SDK command-line tools, plus:
  - `platform-tools`
  - `platforms;android-35`
  - `build-tools;35.0.0`
- `python3` (used to append `classes.dex` to the APK zip)
- `keytool` from the JDK (first build generates `debug.keystore`)
- Optional: ImageMagick, only if you regenerate the launcher icons

### SDK setup

```bash
export ANDROID_HOME=/tmp/android-sdk
export JAVA_HOME=/tmp/jdk/amazon-corretto-21.0.13.1.2-linux-x64

"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
  --install "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

### Build and sign

```bash
cd apps/mobile
./build.sh
```

The script runs this pipeline:

1. `aapt2 compile --dir res`
2. `aapt2 link` against `platforms/android-35/android.jar`, generating `R.java`
3. `javac -source 8 -target 8 -bootclasspath android.jar`
4. `d8 --min-api 26`
5. Append `classes.dex` to the linked APK zip
6. `zipalign -p 4`
7. `apksigner sign` with the generated debug keystore
8. Verify with `apksigner verify` and `aapt2 dump badging`

Output:

```
apps/mobile/release/NEPSE-Terminal-0.4.0-android.apk
```

The keystore is `apps/mobile/debug.keystore` with the standard Android debug
credentials (alias `androiddebugkey`, password `android`). Both the keystore and
`build/` are git-ignored. The APK is a debug-signed test build, not a Play Store
artifact.

### Install

```bash
adb install -r apps/mobile/release/NEPSE-Terminal-0.4.0-android.apk
```

Or build and install in one step:

```bash
./build.sh --install
```

The phone must be on the same network as the PC. See
`../../docs/ANDROID_APK.md` for running the API on the LAN.

## Regenerating icons

The launcher icons in `res/mipmap-*` were generated from
`apps/desktop/build/icon.png`:

```bash
for spec in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  d=${spec%%:*}; s=${spec##*:}
  magick apps/desktop/build/icon.png -filter Lanczos -resize ${s}x${s} \
    -strip apps/mobile/res/mipmap-$d/ic_launcher.png
done
```

## Layout

```
apps/mobile/
  AndroidManifest.xml
  build.sh
  debug.keystore            generated on first build, ignored
  res/
    values/strings.xml
    values/styles.xml
    values-v35/styles.xml   edge-to-edge opt-out for Android 15
    mipmap-*/ic_launcher.png
  src/com/nepse/terminal/mobile/MainActivity.java
  build/                    intermediate output, ignored
  release/                  signed APK, ignored by the root release/ rule
```

## Limitations

- Thin client. It requires the PC API. There is no offline data.
- Cleartext HTTP is for trusted LAN testing only. Do not expose the API to the
  internet.
- Debug-signed. Not suitable for distribution.
- The API is single-user and unauthenticated by design. The app does not add
  authentication.
- HTTPS works only with a certificate the Android WebView trusts. A self-signed
  certificate shows the error page.
- No background alerts and no push. Alerts run only while the web page is open,
  the same as the PWA.

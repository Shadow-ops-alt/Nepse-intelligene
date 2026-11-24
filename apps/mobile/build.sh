#!/usr/bin/env bash
#
# Build the NEPSE Terminal Android APK without Gradle.
#
# Pipeline:
#   aapt2 compile + link  ->  javac  ->  d8  ->  zipalign  ->  apksigner
#
# Requirements:
#   - A JDK with javac (17 or newer; this repo was built with Corretto 21).
#   - Android SDK build-tools 35.0.0 and platform android-35.
#     Install with:
#       sdkmanager --install "platform-tools" "platforms;android-35" "build-tools;35.0.0"
#   - python3 (only used to append classes.dex to the APK zip).
#
# Environment overrides:
#   JAVA_HOME, ANDROID_HOME, BUILD_TOOLS_VERSION, PLATFORM
#
# Usage:
#   ./build.sh            build and sign
#   ./build.sh --install  build, sign, then adb install -r
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="NEPSE-Terminal"
VERSION_NAME="0.6.0"
VERSION_CODE="600"
MIN_SDK=26
TARGET_SDK=35
BUILD_TOOLS_VERSION="${BUILD_TOOLS_VERSION:-35.0.0}"
PLATFORM="${PLATFORM:-android-35}"
DESKTOP_DIST="$ROOT/../../apps/desktop/dist"
ASSETS="$ROOT/assets"
WEB_ASSETS="$ASSETS/web"
PACK_ASSETS="$ASSETS/pack"

# ---------------------------------------------------------------- JDK ------
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/javac" ]; then
    if [ -x "/tmp/jdk/amazon-corretto-21.0.13.1.2-linux-x64/bin/javac" ]; then
        JAVA_HOME="/tmp/jdk/amazon-corretto-21.0.13.1.2-linux-x64"
    elif command -v javac >/dev/null 2>&1; then
        JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
    else
        echo "ERROR: no JDK with javac found. Set JAVA_HOME to a JDK 17+ install." >&2
        exit 1
    fi
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

# ---------------------------------------------------------------- SDK ------
if [ -z "${ANDROID_HOME:-}" ]; then
    for candidate in "${ANDROID_SDK_ROOT:-}" "$HOME/Android/Sdk" "/tmp/android-sdk"; do
        if [ -n "$candidate" ] && [ -d "$candidate/build-tools" ]; then
            ANDROID_HOME="$candidate"
            break
        fi
    done
fi
if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "$ANDROID_HOME" ]; then
    echo "ERROR: Android SDK not found. Set ANDROID_HOME." >&2
    exit 1
fi
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

BUILD_TOOLS="$ANDROID_HOME/build-tools/$BUILD_TOOLS_VERSION"
ANDROID_JAR="$ANDROID_HOME/platforms/$PLATFORM/android.jar"
AAPT2="$BUILD_TOOLS/aapt2"
D8="$BUILD_TOOLS/d8"
ZIPALIGN="$BUILD_TOOLS/zipalign"
APKSIGNER="$BUILD_TOOLS/apksigner"
ADB="$ANDROID_HOME/platform-tools/adb"

for tool in "$AAPT2" "$D8" "$ZIPALIGN" "$APKSIGNER" "$ANDROID_JAR"; do
    if [ ! -e "$tool" ]; then
        echo "ERROR: missing $tool" >&2
        echo "Install it with: sdkmanager --install \"platforms;$PLATFORM\" \"build-tools;$BUILD_TOOLS_VERSION\"" >&2
        exit 1
    fi
done
if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 is required to add classes.dex to the APK." >&2
    exit 1
fi

# -------------------------------------------------------------- paths ------
BUILD="$ROOT/build"
DIST="$ROOT/release"
APK_NAME="${APP_NAME}-${VERSION_NAME}-standalone.apk"
OUT_APK="$DIST/$APK_NAME"
KEYSTORE="$ROOT/debug.keystore"
KEY_ALIAS="androiddebugkey"
KEY_PASS="android"

rm -rf "$BUILD"
mkdir -p "$BUILD/gen" "$BUILD/classes" "$BUILD/dex" "$DIST"

# The standalone app serves the web build and the data pack from APK assets.
if [ ! -f "$DESKTOP_DIST/index.html" ]; then
    echo "ERROR: $DESKTOP_DIST/index.html is missing." >&2
    echo "Build the web app first: npx --yes pnpm@12.16.1 build:web" >&2
    exit 1
fi
if [ ! -f "$PACK_ASSETS/manifest.json" ]; then
    echo "ERROR: $PACK_ASSETS/manifest.json is missing." >&2
    echo "Generate the data pack first:" >&2
    echo "  npx --yes tsx scripts/mobile-pack/generate.ts --api-url http://127.0.0.1:4310" >&2
    exit 1
fi
if [ ! -f "$ASSETS/mobile/mobile.js" ] || [ ! -f "$ASSETS/mobile/mobile.css" ]; then
    echo "ERROR: the mobile shell assets are missing from $ASSETS/mobile." >&2
    exit 1
fi

# Optional Supabase-hosted config. The real file is gitignored and may be
# absent; aapt2 link -A bundles every file under $ASSETS, so when it exists it
# lands at assets/mobile/hosted-config.json in the APK and LocalServer serves
# it at /hosted-config.json. The verification step below asserts this.
HOSTED_CONFIG="$ASSETS/mobile/hosted-config.json"
if [ -f "$HOSTED_CONFIG" ]; then
    echo "==> hosted config: bundling assets/mobile/hosted-config.json"
else
    echo "==> hosted config: none (offline-only build)"
fi

echo "==> stage web assets"
rm -rf "$WEB_ASSETS"
mkdir -p "$WEB_ASSETS"
cp -a "$DESKTOP_DIST/." "$WEB_ASSETS/"
echo "    web:  $(du -sh "$WEB_ASSETS" | cut -f1)"
echo "    pack: $(du -sh "$PACK_ASSETS" | cut -f1)"

echo "==> Toolchain"
echo "    java:     $(javac -version 2>&1)"
echo "    aapt2:    $("$AAPT2" version 2>&1)"
echo "    d8:       $("$D8" --version 2>&1 | head -n 1)"
echo "    apksigner:$("$APKSIGNER" --version)"
echo "    sdk:      $ANDROID_HOME"
echo "    platform: $PLATFORM (min $MIN_SDK, target $TARGET_SDK)"

# ------------------------------------------------------------ resources ----
echo "==> aapt2 compile"
"$AAPT2" compile --dir "$ROOT/res" -o "$BUILD/resources.zip"

echo "==> aapt2 link"
"$AAPT2" link \
    -o "$BUILD/unsigned.apk" \
    -I "$ANDROID_JAR" \
    --manifest "$ROOT/AndroidManifest.xml" \
    --java "$BUILD/gen" \
    -A "$ASSETS" \
    --min-sdk-version "$MIN_SDK" \
    --target-sdk-version "$TARGET_SDK" \
    --version-code "$VERSION_CODE" \
    --version-name "$VERSION_NAME" \
    --replace-version \
    "$BUILD/resources.zip"

# Confirm the optional config was packaged. Absent config is a valid build.
if [ -f "$HOSTED_CONFIG" ]; then
    python3 -I - "$BUILD/unsigned.apk" <<'PY'
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as apk:
    names = set(apk.namelist())
if "assets/mobile/hosted-config.json" not in names:
    raise SystemExit("ERROR: hosted-config.json is present in assets but was not packaged")
print("    hosted config verified in APK")
PY
fi

# ------------------------------------------------------------- compile -----
echo "==> javac"
find "$ROOT/src" "$BUILD/gen" -name '*.java' -print > "$BUILD/sources.txt"
javac -source 8 -target 8 -Xlint:-options \
    -bootclasspath "$ANDROID_JAR" \
    -classpath "$ANDROID_JAR" \
    -d "$BUILD/classes" \
    @"$BUILD/sources.txt"

# ---------------------------------------------------------------- dex ------
echo "==> d8"
find "$BUILD/classes" -name '*.class' -print > "$BUILD/classlist.txt"
# shellcheck disable=SC2046
"$D8" \
    --min-api "$MIN_SDK" \
    --lib "$ANDROID_JAR" \
    --output "$BUILD/dex" \
    $(cat "$BUILD/classlist.txt")

# Add classes.dex by appending to the aapt2 zip. Appending preserves the
# compression and alignment of resources.arsc, which Android 11+ requires.
echo "==> add classes.dex"
python3 -I - "$BUILD/unsigned.apk" "$BUILD/dex/classes.dex" <<'PY'
import sys
import zipfile

apk, dex = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, "a", compression=zipfile.ZIP_DEFLATED) as zf:
    if "classes.dex" in zf.namelist():
        raise SystemExit("classes.dex already present in APK")
    zf.write(dex, "classes.dex")
PY

# ------------------------------------------------------------ align/sign ---
echo "==> zipalign"
"$ZIPALIGN" -f -p 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
    echo "==> generate debug keystore"
    keytool -genkeypair \
        -keystore "$KEYSTORE" \
        -storepass "$KEY_PASS" \
        -keypass "$KEY_PASS" \
        -alias "$KEY_ALIAS" \
        -dname "CN=Android Debug,O=Android,C=US" \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -noprompt
fi

echo "==> apksigner sign"
rm -f "$OUT_APK"
"$APKSIGNER" sign \
    --ks "$KEYSTORE" \
    --ks-key-alias "$KEY_ALIAS" \
    --ks-pass "pass:$KEY_PASS" \
    --key-pass "pass:$KEY_PASS" \
    --out "$OUT_APK" \
    "$BUILD/aligned.apk"

# --------------------------------------------------------------- verify ----
echo "==> verify"
"$APKSIGNER" verify --print-certs "$OUT_APK"
"$AAPT2" dump badging "$OUT_APK" | grep -E \
    "^(package|minSdkVersion|sdkVersion|targetSdkVersion|uses-permission|application-label|launchable-activity)" || true

echo
echo "==> APK"
ls -lh "$OUT_APK"
sha256sum "$OUT_APK"

if [ "${1:-}" = "--install" ]; then
    if [ ! -x "$ADB" ]; then
        echo "ERROR: adb not found at $ADB" >&2
        exit 1
    fi
    echo "==> adb install"
    "$ADB" install -r "$OUT_APK"
fi

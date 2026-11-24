package com.nepse.terminal.mobile;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Optional Supabase-hosted configuration.
 *
 * The real file is {@code hosted-config.json}; it is never committed. Two
 * locations are checked, in order:
 *
 *   1. {@code filesDir/hosted-config.json} (developer override, no rebuild)
 *   2. {@code assets/mobile/hosted-config.json} (bundled by build.sh)
 *
 * When neither exists the app runs in offline mode and
 * {@code GET /hosted-config.json} returns 404, so the web UI never shows a
 * login screen. Only the Supabase URL and the anon key belong here; the
 * service-role key must never ship in the app.
 */
public final class HostedConfig {

    private static final String TAG = "NepseHostedConfig";
    public static final String FILE_NAME = "hosted-config.json";
    public static final String ASSET_PATH = "mobile/" + FILE_NAME;

    private HostedConfig() {
    }

    /** Returns the raw config bytes, or null when no config is installed. */
    public static byte[] readBytes(Context context) {
        if (context == null) return null;
        Context app = context.getApplicationContext();

        File override = new File(app.getFilesDir(), FILE_NAME);
        if (override.isFile()) {
            try (InputStream input = new FileInputStream(override)) {
                return PackStore.readAll(input);
            } catch (IOException error) {
                Log.w(TAG, "could not read " + override + ": " + error.getMessage());
            }
        }
        try (InputStream input = app.getAssets().open(ASSET_PATH)) {
            return PackStore.readAll(input);
        } catch (IOException missing) {
            return null;
        }
    }

    /** Returns the config text, or null when no config is installed. */
    public static String readText(Context context) {
        byte[] bytes = readBytes(context);
        if (bytes == null) return null;
        String text = new String(bytes, StandardCharsets.UTF_8);
        // Tolerate a UTF-8 BOM from an editor.
        if (!text.isEmpty() && text.charAt(0) == '﻿') text = text.substring(1);
        return text;
    }

    /** Parses the config, or returns null when absent or invalid. */
    public static JSONObject parse(Context context) {
        String text = readText(context);
        if (text == null || text.trim().isEmpty()) return null;
        try {
            return new JSONObject(text);
        } catch (Exception error) {
            Log.w(TAG, "hosted config is not valid JSON: " + error.getMessage());
            return null;
        }
    }

    /**
     * Optional pack manifest URL. When set, "Check for data updates" reads it
     * to find the latest pack zip instead of asking for a URL.
     */
    public static String packManifestUrl(Context context) {
        JSONObject config = parse(context);
        if (config == null) return null;
        String value = config.optString("packManifestUrl", "").trim();
        return value.isEmpty() ? null : value;
    }
}

package com.nepse.terminal.mobile;

import android.content.Context;
import android.content.res.AssetManager;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Reads the data pack, preferring a downloaded pack in filesDir over the copy
 * bundled in the APK assets. The pack is read-only at runtime; updates replace
 * the downloaded directory atomically.
 */
public final class PackStore {

    private static final String ASSET_ROOT = "pack/";

    private final Context context;
    private final AssetManager assets;

    private volatile File downloadedDir;
    private volatile JSONObject manifest;
    private volatile String manifestText;

    public PackStore(Context context) {
        this.context = context.getApplicationContext();
        this.assets = context.getAssets();
        File candidate = new File(context.getFilesDir(), "pack");
        if (new File(candidate, "manifest.json").isFile()) {
            this.downloadedDir = candidate;
        }
        reloadManifest();
    }

    public synchronized void setDownloadedDir(File dir) {
        this.downloadedDir = dir;
        reloadManifest();
    }

    public synchronized void reloadManifest() {
        try {
            String text = readText("manifest.json");
            this.manifestText = text;
            this.manifest = new JSONObject(text);
        } catch (Exception error) {
            this.manifestText = null;
            this.manifest = null;
        }
    }

    public boolean hasManifest() {
        return manifest != null;
    }

    public JSONObject manifest() {
        return manifest;
    }

    public String manifestText() {
        return manifestText;
    }

    public boolean isDownloaded() {
        return downloadedDir != null;
    }

    public File downloadedDir() {
        return downloadedDir;
    }

    /** Opens a pack-relative path such as {@code api/meta.json}. */
    public InputStream open(String relative) throws IOException {
        if (!safe(relative)) {
            throw new IOException("bad pack path");
        }
        File dir = downloadedDir;
        if (dir != null) {
            File file = new File(dir, relative);
            if (file.isFile()) {
                return new BufferedInputStream(new FileInputStream(file));
            }
        }
        return assets.open(ASSET_ROOT + relative);
    }

    public boolean exists(String relative) {
        if (!safe(relative)) return false;
        File dir = downloadedDir;
        if (dir != null && new File(dir, relative).isFile()) {
            return true;
        }
        try (InputStream stream = assets.open(ASSET_ROOT + relative)) {
            return stream != null;
        } catch (IOException error) {
            return false;
        }
    }

    public byte[] readBytes(String relative) throws IOException {
        try (InputStream stream = open(relative)) {
            return readAll(stream);
        }
    }

    public String readText(String relative) throws IOException {
        return new String(readBytes(relative), StandardCharsets.UTF_8);
    }

    /** Static web assets are always read from the APK. */
    public InputStream openAsset(String path) throws IOException {
        if (!safe(path)) {
            throw new IOException("bad asset path");
        }
        return assets.open(path);
    }

    public boolean assetExists(String path) {
        if (!safe(path)) return false;
        try (InputStream stream = assets.open(path)) {
            return stream != null;
        } catch (IOException error) {
            return false;
        }
    }

    public static byte[] readAll(InputStream stream) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(16 * 1024);
        byte[] buffer = new byte[16 * 1024];
        int read;
        while ((read = stream.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    private static boolean safe(String relative) {
        if (relative == null || relative.isEmpty()) return false;
        if (relative.startsWith("/") || relative.startsWith("\\")) return false;
        if (relative.contains("..")) return false;
        if (relative.indexOf('\u0000') >= 0) return false;
        return true;
    }
}

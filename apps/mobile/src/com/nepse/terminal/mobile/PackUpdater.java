package com.nepse.terminal.mobile;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Downloads a mobile data pack zip, verifies every file against the hashes in
 * its manifest, and installs it in filesDir/pack.
 *
 * The archive must contain manifest.json at its root; every path in
 * manifest.files is checked with SHA-256 before the pack is activated. A bad
 * or partial download never replaces the current pack.
 */
public final class PackUpdater {

    private static final long MAX_ZIP_BYTES = 512L * 1024 * 1024;
    private static final long MAX_UNCOMPRESSED_BYTES = 2L * 1024 * 1024 * 1024;
    private static final int MAX_ENTRIES = 20_000;

    private PackUpdater() {
    }

    public interface Progress {
        void update(String message);
    }

    public static File downloadAndInstall(Context context, String url, Progress progress)
            throws IOException {
        if (url == null || !url.startsWith("https://") && !url.startsWith("http://")) {
            throw new IOException("Enter an http:// or https:// URL");
        }
        File cache = new File(context.getCacheDir(), "pack-update.zip");
        File next = new File(context.getFilesDir(), "pack-next");
        deleteTree(next);
        deleteTree(cache);
        try {
            progress.update("Downloading data pack");
            download(url, cache);

            progress.update("Verifying data pack");
            extract(cache, next);
            JSONObject manifest = verify(next);

            progress.update("Installing data pack");
            File target = new File(context.getFilesDir(), "pack");
            File backup = new File(context.getFilesDir(), "pack-old");
            deleteTree(backup);
            if (target.exists() && !target.renameTo(backup)) {
                throw new IOException("Could not replace the current data pack");
            }
            if (!next.renameTo(target)) {
                // Put the previous pack back before failing.
                if (backup.exists()) backup.renameTo(target);
                throw new IOException("Could not install the new data pack");
            }
            deleteTree(backup);
            progress.update("Data pack " + manifest.optString("version", "")
                    + " installed");
            return target;
        } catch (IOException error) {
            deleteTree(next);
            throw error;
        } finally {
            deleteTree(cache);
        }
    }

    private static void download(String url, File target) throws IOException {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(30_000);
            connection.setReadTimeout(120_000);
            connection.setRequestProperty("User-Agent", "NEPSE-Terminal-Android/0.5.0");
            connection.setRequestProperty("Accept", "application/zip,application/octet-stream,*/*");
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                throw new IOException("Download failed with HTTP " + status);
            }
            long declared = connection.getContentLengthLong();
            if (declared > MAX_ZIP_BYTES) {
                throw new IOException("Data pack zip is larger than 512 MB");
            }
            long total = 0;
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 OutputStreamHolder holder = new OutputStreamHolder(target)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_ZIP_BYTES) {
                        throw new IOException("Data pack zip is larger than 512 MB");
                    }
                    holder.write(buffer, 0, read);
                }
            }
            if (total == 0) {
                throw new IOException("The download was empty");
            }
            if (declared > 0 && total != declared) {
                throw new IOException("The download was truncated (" + total
                        + " of " + declared + " bytes)");
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static void extract(File zip, File target) throws IOException {
        if (!target.mkdirs() && !target.isDirectory()) {
            throw new IOException("Could not create the pack directory");
        }
        long total = 0;
        int entries = 0;
        try (ZipInputStream input = new ZipInputStream(
                new BufferedInputStream(new FileInputStream(zip)))) {
            ZipEntry entry;
            while ((entry = input.getNextEntry()) != null) {
                entries += 1;
                if (entries > MAX_ENTRIES) {
                    throw new IOException("The archive has too many entries");
                }
                String name = entry.getName().replace('\\', '/');
                if (name.isEmpty()) continue;
                if (name.startsWith("/") || name.contains("..")
                        || name.matches("^[A-Za-z]:.*")) {
                    throw new IOException("The archive contains an unsafe path");
                }
                File file = new File(target, name);
                if (entry.isDirectory()) {
                    if (!file.mkdirs() && !file.isDirectory()) {
                        throw new IOException("Could not create " + name);
                    }
                    continue;
                }
                File parent = file.getParentFile();
                if (parent != null && !parent.mkdirs() && !parent.isDirectory()) {
                    throw new IOException("Could not create " + parent.getName());
                }
                try (FileOutputStream output = new FileOutputStream(file)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        total += read;
                        if (total > MAX_UNCOMPRESSED_BYTES) {
                            throw new IOException("The data pack is larger than 2 GB");
                        }
                        output.write(buffer, 0, read);
                    }
                }
            }
        }
        if (entries == 0) {
            throw new IOException("The archive is empty");
        }
    }

    private static JSONObject verify(File root) throws IOException {
        File manifestFile = new File(root, "manifest.json");
        if (!manifestFile.isFile()) {
            throw new IOException("The archive has no manifest.json");
        }
        JSONObject manifest;
        try {
            manifest = new JSONObject(new String(
                    Files.readAllBytes(manifestFile.toPath()), StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new IOException("manifest.json is not valid JSON");
        }
        JSONObject files = manifest.optJSONObject("files");
        if (files == null || files.length() == 0) {
            throw new IOException("manifest.json lists no files");
        }
        for (String required : new String[]{"api/meta.json", "api/quotes.json",
                "api/companies.json", "candles/index.json"}) {
            if (!files.has(required)) {
                throw new IOException("manifest.json is missing " + required);
            }
        }
        int checked = 0;
        Iterator<String> keys = files.keys();
        while (keys.hasNext()) {
            String path = keys.next();
            if (path.contains("..") || path.startsWith("/")) {
                throw new IOException("manifest.json has an unsafe path");
            }
            JSONObject entry = files.optJSONObject(path);
            if (entry == null) continue;
            String expected = entry.optString("sha256", "").toLowerCase();
            if (expected.length() != 64) {
                throw new IOException("manifest.json has no hash for " + path);
            }
            File file = new File(root, path);
            if (!file.isFile()) {
                throw new IOException("The archive is missing " + path);
            }
            String actual = sha256(file);
            if (!actual.equals(expected)) {
                throw new IOException("Hash mismatch for " + path);
            }
            checked += 1;
        }
        if (checked < 4) {
            throw new IOException("The manifest verified too few files");
        }
        return manifest;
    }

    private static String sha256(File file) throws IOException {
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            MessageDigest digest;
            try {
                digest = MessageDigest.getInstance("SHA-256");
            } catch (Exception error) {
                throw new IOException("SHA-256 is unavailable");
            }
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
            StringBuilder hex = new StringBuilder(64);
            for (byte value : digest.digest()) {
                hex.append(String.format("%02x", value & 0xff));
            }
            return hex.toString();
        }
    }

    static void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteTree(child);
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private static final class OutputStreamHolder implements AutoCloseable {
        private final BufferedOutputStream stream;

        OutputStreamHolder(File file) throws IOException {
            this.stream = new BufferedOutputStream(new FileOutputStream(file));
        }

        void write(byte[] bytes, int offset, int length) throws IOException {
            stream.write(bytes, offset, length);
        }

        @Override
        public void close() throws IOException {
            stream.close();
        }
    }
}

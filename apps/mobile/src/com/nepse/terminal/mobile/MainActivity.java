package com.nepse.terminal.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.Log;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.util.Locale;

/**
 * Standalone Android shell for NEPSE Terminal.
 *
 * The web build and the data pack are inside the APK. A loopback HTTP server
 * (LocalServer) serves both, plus a filesDir-backed JSON API for the personal
 * tools, so the app works with no PC and no network.
 */
public class MainActivity extends Activity {

    private static final String TAG = "NepseMobile";
    private static final String APP_VERSION = "0.7.0";
    private static final String PREFS_NAME = "nepse_terminal_mobile";
    private static final String PREF_UPDATE_URL = "update_url";
    private static final String DEFAULT_UPDATE_URL =
            "https://github.com/Shadow-ops-alt/Nepse-intelligene/releases/latest/download/"
                    + "NEPSE-Terminal-" + APP_VERSION + "-mobile-pack.zip";
    private static final String RETRY_SCHEME = "nepse-retry";

    private static final int MENU_RELOAD = 1;
    private static final int MENU_PACK_INFO = 2;
    private static final int MENU_CHECK_UPDATES = 3;
    private static final int MENU_ENTER_PACK_URL = 4;

    private WebView webView;
    private SharedPreferences prefs;
    private PackStore packStore;
    private LocalStore localStore;
    private LocalServer server;
    private AlertDialog progressDialog;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        WebView.setWebContentsDebuggingEnabled(true);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        configureWebView();

        packStore = new PackStore(this);
        localStore = new LocalStore(this, packStore);
        server = new LocalServer(this, packStore, localStore);

        showLoadingPage();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    server.start();
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            loadLocalApp();
                        }
                    });
                } catch (final Exception error) {
                    Log.e(TAG, "could not start local server", error);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            showErrorPage("The local server could not start: "
                                    + error.getMessage());
                        }
                    });
                }
            }
        }, "nepse-server-start").start();
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setUserAgentString(settings.getUserAgentString()
                + " NEPSE-Android/" + APP_VERSION + "-standalone");

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUri(request.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
                    CharSequence description = error == null ? null : error.getDescription();
                    showErrorPage(description == null
                            ? "The local app could not be loaded."
                            : description.toString());
                }
            }
        });
    }

    private boolean handleUri(Uri uri) {
        if (uri == null) return true;
        String scheme = uri.getScheme();
        if (scheme == null) return true;
        scheme = scheme.toLowerCase(Locale.US);

        if (RETRY_SCHEME.equals(scheme)) {
            loadLocalApp();
            return true;
        }
        if ("http".equals(scheme) || "https".equals(scheme)) {
            if (isLocalHost(uri)) return false;
            openExternally(uri);
            return true;
        }
        if ("mailto".equals(scheme) || "tel".equals(scheme) || "sms".equals(scheme)
                || "geo".equals(scheme) || "market".equals(scheme)) {
            openExternally(uri);
            return true;
        }
        return true;
    }

    private boolean isLocalHost(Uri uri) {
        String host = uri.getHost();
        return host != null && (host.equalsIgnoreCase("127.0.0.1")
                || host.equalsIgnoreCase("localhost"));
    }

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
        }
    }

    private void loadLocalApp() {
        if (server == null || server.getPort() == 0) {
            showErrorPage("The local server is not running.");
            return;
        }
        String url = server.url();
        Log.i(TAG, "loading " + url);
        webView.loadUrl(url);
    }

    private void showLoadingPage() {
        String html = "<!doctype html><html><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<style>html,body{margin:0;height:100%;background:#0b0e14;color:#e6e9ef;"
                + "font-family:-apple-system,Roboto,sans-serif}body{display:flex;"
                + "align-items:center;justify-content:center}"
                + ".spinner{width:34px;height:34px;border-radius:50%;"
                + "border:3px solid #232a36;border-top-color:#2f81f7;"
                + "animation:spin 0.9s linear infinite;margin:0 auto 16px}"
                + "@keyframes spin{to{transform:rotate(360deg)}}"
                + "p{font-size:14px;color:#9aa4b2;text-align:center;margin:0}"
                + "</style></head><body><div><div class=\"spinner\"></div>"
                + "<p>Starting NEPSE Terminal</p></div></body></html>";
        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    private void showErrorPage(String detail) {
        String safeDetail = escapeHtml(detail == null ? "Unknown error" : detail);
        String html = "<!doctype html><html><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<style>html,body{margin:0;height:100%;background:#0b0e14;color:#e6e9ef;"
                + "font-family:-apple-system,Roboto,sans-serif}body{display:flex;"
                + "align-items:center;justify-content:center;padding:24px;box-sizing:border-box}"
                + ".card{max-width:420px;width:100%;text-align:center}"
                + "h1{font-size:20px;margin:0 0 10px;font-weight:600}"
                + "p{font-size:14px;line-height:1.5;color:#9aa4b2;margin:0 0 8px}"
                + "a{display:inline-block;margin-top:18px;padding:10px 18px;"
                + "border-radius:8px;background:#2f81f7;color:#fff;text-decoration:none;"
                + "font-size:14px}</style></head><body><div class=\"card\">"
                + "<h1>NEPSE Terminal could not start</h1>"
                + "<p>" + safeDetail + "</p>"
                + "<a href=\"nepse-retry://retry\">Retry</a>"
                + "</div></body></html>";
        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    private static String escapeHtml(String value) {
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    // ---------------------------------------------------------------- menu

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        MenuItem reload = menu.add(Menu.NONE, MENU_RELOAD, 1, "Reload");
        reload.setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        MenuItem info = menu.add(Menu.NONE, MENU_PACK_INFO, 2, "Data pack info");
        info.setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        MenuItem updates = menu.add(Menu.NONE, MENU_CHECK_UPDATES, 3,
                "Check for data updates");
        updates.setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        MenuItem manual = menu.add(Menu.NONE, MENU_ENTER_PACK_URL, 4,
                "Enter pack URL");
        manual.setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        switch (item.getItemId()) {
            case MENU_RELOAD:
                if (webView != null) webView.reload();
                return true;
            case MENU_PACK_INFO:
                showPackInfo();
                return true;
            case MENU_CHECK_UPDATES:
                checkForUpdates();
                return true;
            case MENU_ENTER_PACK_URL:
                showUpdateDialog();
                return true;
            default:
                return super.onOptionsItemSelected(item);
        }
    }

    private void showPackInfo() {
        JSONObject manifest = packStore == null ? null : packStore.manifest();
        if (manifest == null) {
            new AlertDialog.Builder(this)
                    .setTitle("Data pack")
                    .setMessage("No data pack manifest is available in this APK.")
                    .setPositiveButton("Close", null)
                    .show();
            return;
        }
        StringBuilder text = new StringBuilder();
        text.append("Version: ").append(manifest.optString("version", "unknown")).append('\n');
        text.append("Generated: ").append(manifest.optString("generatedAt", "unknown"))
                .append('\n');
        text.append("Latest session: ")
                .append(manifest.isNull("latestSession")
                        ? "unknown" : manifest.optString("latestSession", "")).append('\n');
        text.append("Window: ").append(manifest.optInt("years", 0)).append(" years\n");
        text.append("Source: ")
                .append(packStore.isDownloaded() ? "downloaded pack" : "bundled in APK")
                .append('\n');
        JSONObject counts = manifest.optJSONObject("counts");
        if (counts != null) {
            text.append('\n');
            text.append("Companies: ").append(counts.optInt("companies", 0)).append('\n');
            text.append("Candle series: ").append(counts.optInt("candleSymbols", 0))
                    .append('\n');
            text.append("Candles: ").append(counts.optInt("candles", 0)).append('\n');
            text.append("Indices: ").append(counts.optInt("indices", 0)).append('\n');
            text.append("Fundamentals: ").append(counts.optInt("fundamentals", 0))
                    .append('\n');
        }
        JSONObject sizes = manifest.optJSONObject("sizes");
        if (sizes != null) {
            long bytes = sizes.optLong("bytes", 0);
            text.append("\nPack size: ").append(String.format(Locale.US, "%.1f MB",
                    bytes / 1024d / 1024d));
        }
        text.append("\n\nThis pack is a snapshot. The Live market page reads "
                + "ShareSansar when the phone is online. Intraday charts and "
                + "backtesting still need the desktop app.");
        new AlertDialog.Builder(this)
                .setTitle("Data pack")
                .setMessage(text.toString())
                .setPositiveButton("Close", null)
                .show();
    }

    /**
     * Reads the optional packManifestUrl from hosted-config.json. When it is
     * set, the app resolves the latest pack zip from that manifest and reuses
     * the existing download, hash-verify and install path. Without it the
     * manual URL dialog is shown, exactly as before.
     */
    private void checkForUpdates() {
        final String manifestUrl = HostedConfig.packManifestUrl(this);
        if (manifestUrl == null) {
            showUpdateDialog();
            return;
        }
        final AlertDialog progress = new AlertDialog.Builder(this)
                .setTitle("Data pack update")
                .setMessage("Checking for a newer data pack")
                .setCancelable(false)
                .create();
        progressDialog = progress;
        progress.show();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    final PackUpdater.UpdateInfo info =
                            PackUpdater.resolveManifest(manifestUrl);
                    String current = "";
                    JSONObject manifest = packStore == null ? null : packStore.manifest();
                    if (manifest != null) current = manifest.optString("version", "");
                    final String currentVersion = current;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissProgress();
                            if (!info.version.isEmpty()
                                    && info.version.equals(currentVersion)) {
                                Toast.makeText(MainActivity.this,
                                        "Data pack is up to date (v" + currentVersion + ")",
                                        Toast.LENGTH_LONG).show();
                                return;
                            }
                            startPackUpdate(info.url);
                        }
                    });
                } catch (final Exception error) {
                    Log.e(TAG, "pack update check failed", error);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissProgress();
                            new AlertDialog.Builder(MainActivity.this)
                                    .setTitle("Update check failed")
                                    .setMessage(error.getMessage() == null
                                            ? "The pack manifest could not be read."
                                            : error.getMessage())
                                    .setPositiveButton("Close", null)
                                    .setNeutralButton("Enter a pack URL",
                                            new DialogInterface.OnClickListener() {
                                                @Override
                                                public void onClick(DialogInterface dialog,
                                                                    int which) {
                                                    showUpdateDialog();
                                                }
                                            })
                                    .show();
                        }
                    });
                }
            }
        }, "nepse-pack-check").start();
    }

    private void showUpdateDialog() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        String current = prefs.getString(PREF_UPDATE_URL, DEFAULT_UPDATE_URL);
        input.setText(current);
        input.setSelection(input.getText().length());

        new AlertDialog.Builder(this)
                .setTitle("Check for data updates")
                .setMessage("Download a mobile pack zip. Every file is checked against "
                        + "the SHA-256 hashes in its manifest before it is installed.")
                .setView(input)
                .setPositiveButton("Download", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        String url = input.getText().toString().trim();
                        if (!url.startsWith("https://") && !url.startsWith("http://")) {
                            input.setError("Enter an http:// or https:// URL");
                            return;
                        }
                        prefs.edit().putString(PREF_UPDATE_URL, url).apply();
                        startPackUpdate(url);
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void startPackUpdate(String url) {
        final AlertDialog progress = new AlertDialog.Builder(this)
                .setTitle("Data pack update")
                .setMessage("Starting")
                .setCancelable(false)
                .create();
        progressDialog = progress;
        progress.show();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    File installed = PackUpdater.downloadAndInstall(
                            MainActivity.this, url, new PackUpdater.Progress() {
                                @Override
                                public void update(final String message) {
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            if (progressDialog != null) {
                                                progressDialog.setMessage(message);
                                            }
                                        }
                                    });
                                }
                            });
                    packStore.setDownloadedDir(installed);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissProgress();
                            webView.reload();
                            Toast.makeText(MainActivity.this, "Data pack updated",
                                    Toast.LENGTH_LONG).show();
                        }
                    });
                } catch (final Exception error) {
                    Log.e(TAG, "pack update failed", error);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissProgress();
                            new AlertDialog.Builder(MainActivity.this)
                                    .setTitle("Update failed")
                                    .setMessage(error.getMessage() == null
                                            ? "The data pack could not be installed."
                                            : error.getMessage())
                                    .setPositiveButton("Close", null)
                                    .show();
                        }
                    });
                }
            }
        }, "nepse-pack-update").start();
    }

    private void dismissProgress() {
        if (progressDialog != null) {
            progressDialog.dismiss();
            progressDialog = null;
        }
    }

    // -------------------------------------------------------------- lifecycle

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        dismissProgress();
        if (server != null) server.stop();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}

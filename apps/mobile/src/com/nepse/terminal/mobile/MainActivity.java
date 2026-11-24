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

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * Thin Android shell around the NEPSE Terminal web app served by the local API.
 * The web bundle is never bundled in the APK: the WebView loads the same PWA
 * from the PC over the LAN, and the server URL is stored in SharedPreferences.
 */
public class MainActivity extends Activity {

    private static final String APP_VERSION = "0.4.0";
    private static final String PREFS_NAME = "nepse_terminal";
    private static final String PREF_SERVER_URL = "server_url";
    private static final String DEFAULT_SERVER_URL = "http://192.168.100.111:4310";
    private static final String RETRY_SCHEME = "nepse-retry";

    private static final int MENU_RELOAD = 1;
    private static final int MENU_CHANGE_SERVER = 2;

    private WebView webView;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        configureWebView();

        if (getServerUrl() == null) {
            showServerDialog(true);
        } else {
            loadServer();
        }
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
                + " NEPSE-Android/" + APP_VERSION);

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
                            ? "The server could not be reached."
                            : description.toString());
                }
            }
        });
    }

    /**
     * Returns true when the WebView must not load the URL itself.
     */
    private boolean handleUri(Uri uri) {
        if (uri == null) {
            return true;
        }

        String scheme = uri.getScheme();
        if (scheme == null) {
            return true;
        }
        scheme = scheme.toLowerCase(Locale.US);

        if (RETRY_SCHEME.equals(scheme)) {
            if ("change".equals(uri.getHost())) {
                showServerDialog(false);
            } else {
                loadServer();
            }
            return true;
        }

        if ("http".equals(scheme) || "https".equals(scheme)) {
            if (isServerHost(uri)) {
                return false;
            }
            openExternally(uri);
            return true;
        }

        // Hand off ordinary external app links; block everything else
        // (javascript:, data:, file:, intent:, content: and unknown schemes).
        if ("mailto".equals(scheme) || "tel".equals(scheme) || "sms".equals(scheme)
                || "geo".equals(scheme) || "market".equals(scheme)) {
            openExternally(uri);
            return true;
        }
        return true;
    }

    private boolean isServerHost(Uri uri) {
        String server = getServerUrl();
        if (server == null) {
            return false;
        }
        String serverHost = Uri.parse(server).getHost();
        String host = uri.getHost();
        return serverHost != null && host != null && serverHost.equalsIgnoreCase(host);
    }

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
        }
    }

    private void loadServer() {
        String server = getServerUrl();
        if (server == null) {
            showErrorPage("No server is configured.");
            return;
        }
        webView.loadUrl(server);
    }

    private String getServerUrl() {
        String value = prefs.getString(PREF_SERVER_URL, null);
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        return value;
    }

    private void showServerDialog(final boolean firstRun) {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        input.setHint(DEFAULT_SERVER_URL);
        String current = getServerUrl();
        input.setText(current == null ? DEFAULT_SERVER_URL : current);
        input.setSelection(input.getText().length());

        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle("NEPSE Terminal server")
                .setMessage("Enter the address printed by the API, for example "
                        + DEFAULT_SERVER_URL + ". The PC and phone must be on the same network.")
                .setView(input)
                .setPositiveButton("Save", null)
                .setNegativeButton(firstRun ? "Later" : "Cancel",
                        new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                if (firstRun) {
                                    showErrorPage("No server is configured.");
                                }
                            }
                        });

        final AlertDialog dialog = builder.create();
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override
            public void onShow(DialogInterface d) {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                        .setOnClickListener(new View.OnClickListener() {
                            @Override
                            public void onClick(View v) {
                                String normalized =
                                        normalizeServerUrl(input.getText().toString());
                                if (normalized == null) {
                                    input.setError("Enter an http:// or https:// address");
                                    return;
                                }
                                prefs.edit().putString(PREF_SERVER_URL, normalized).apply();
                                dialog.dismiss();
                                loadServer();
                            }
                        });
            }
        });
        dialog.setOnCancelListener(new DialogInterface.OnCancelListener() {
            @Override
            public void onCancel(DialogInterface d) {
                if (firstRun) {
                    showErrorPage("No server is configured.");
                }
            }
        });
        dialog.show();
    }

    /**
     * Accepts http://host:port or https://host, also a bare host:port (http is
     * assumed). Returns null for empty or invalid input. Trailing slashes are
     * removed.
     */
    static String normalizeServerUrl(String raw) {
        if (raw == null) {
            return null;
        }
        String value = raw.trim();
        if (value.isEmpty()) {
            return null;
        }
        if (value.indexOf(' ') >= 0 || value.indexOf('\n') >= 0 || value.indexOf('\t') >= 0) {
            return null;
        }

        String lower = value.toLowerCase(Locale.US);
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            if (lower.matches("^[a-z][a-z0-9+.-]*://.*")) {
                return null;
            }
            value = "http://" + value;
        }

        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }

        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            if (scheme == null) {
                return null;
            }
            scheme = scheme.toLowerCase(Locale.US);
            if (!"http".equals(scheme) && !"https".equals(scheme)) {
                return null;
            }
            String host = uri.getHost();
            if (host == null || host.isEmpty()) {
                return null;
            }
            int port = uri.getPort();
            if (port == 0 || port > 65535) {
                return null;
            }
            return value;
        } catch (URISyntaxException e) {
            return null;
        }
    }

    private void showErrorPage(String detail) {
        String server = getServerUrl();
        String safeServer = escapeHtml(server == null ? "not configured" : server);
        String safeDetail = escapeHtml(detail == null ? "Unknown error" : detail);

        String html = "<!doctype html><html><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>NEPSE Terminal</title><style>"
                + "html,body{margin:0;height:100%;background:#0b0e14;color:#e6e9ef;"
                + "font-family:-apple-system,Roboto,sans-serif}"
                + "body{display:flex;align-items:center;justify-content:center;"
                + "padding:24px;box-sizing:border-box}"
                + ".card{max-width:420px;width:100%;text-align:center}"
                + "h1{font-size:20px;margin:0 0 10px;font-weight:600}"
                + "p{font-size:14px;line-height:1.5;color:#9aa4b2;margin:0 0 8px}"
                + "code{display:block;background:#151a23;border:1px solid #232a36;"
                + "border-radius:8px;padding:10px;margin:14px 0;font-size:13px;"
                + "color:#c8d1de;word-break:break-all}"
                + ".actions{display:flex;justify-content:center;flex-wrap:wrap;margin-top:18px}"
                + "a{display:inline-block;padding:10px 16px;border-radius:8px;"
                + "text-decoration:none;font-size:14px;margin:4px}"
                + ".primary{background:#2f81f7;color:#fff}"
                + ".secondary{background:#1c2430;color:#c8d1de;border:1px solid #2b3442}"
                + "</style></head><body><div class=\"card\">"
                + "<h1>Can't reach the NEPSE Terminal server</h1>"
                + "<p>Make sure the PC is running the API with NEPSE_LAN=1 and that the "
                + "phone is on the same network.</p>"
                + "<code>" + safeServer + "</code>"
                + "<p>" + safeDetail + "</p>"
                + "<div class=\"actions\">"
                + "<a class=\"primary\" href=\"nepse-retry://retry\">Retry</a>"
                + "<a class=\"secondary\" href=\"nepse-retry://change\">Change server</a>"
                + "</div></div></body></html>";

        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    private static String escapeHtml(String value) {
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        MenuItem reload = menu.add(Menu.NONE, MENU_RELOAD, 1, "Reload");
        reload.setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        MenuItem change = menu.add(Menu.NONE, MENU_CHANGE_SERVER, 2, "Change server");
        change.setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int id = item.getItemId();
        if (id == MENU_RELOAD) {
            loadServer();
            return true;
        }
        if (id == MENU_CHANGE_SERVER) {
            showServerDialog(false);
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

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
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}

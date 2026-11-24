package com.nepse.terminal.mobile;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Loopback HTTP server that makes the bundled web app standalone.
 *
 * It serves the Vite build from APK assets, the precomputed data pack from
 * APK assets or filesDir, and a small JSON API backed by filesDir for the
 * personal tools. The server binds to 127.0.0.1 with an ephemeral port and
 * rejects any request whose Host or Origin is not the loopback address.
 */
public final class LocalServer {

    private static final String TAG = "NepseLocalServer";
    private static final int MAX_BODY_BYTES = 16 * 1024 * 1024;
    private static final Pattern TRADE_PLAN_ID = Pattern.compile("^/api/trade-plans/(\\d+)$");
    private static final Pattern JOURNAL_ID = Pattern.compile("^/api/journal/(\\d+)$");
    private static final Pattern JOURNAL_SNAPSHOT = Pattern.compile("^/api/journal/(\\d+)/snapshot$");
    private static final Pattern LEDGER_ID = Pattern.compile("^/api/corporate-ledger/(\\d+)$");

    private final Context context;
    private final PackStore pack;
    private final LocalStore store;
    private final ExecutorService pool = Executors.newCachedThreadPool();

    private volatile boolean running;
    private ServerSocket serverSocket;
    private int port;

    public LocalServer(Context context, PackStore pack, LocalStore store) {
        this.context = context.getApplicationContext();
        this.pack = pack;
        this.store = store;
    }

    public int getPort() {
        return port;
    }

    public String url() {
        return "http://127.0.0.1:" + port + "/";
    }

    public synchronized void start() throws IOException {
        if (running) return;
        serverSocket = new ServerSocket(0, 64, InetAddress.getByName("127.0.0.1"));
        port = serverSocket.getLocalPort();
        running = true;
        Thread accept = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop();
            }
        }, "nepse-http-accept");
        accept.setDaemon(true);
        accept.start();
        Log.i(TAG, "local server listening on " + url());
    }

    public synchronized void stop() {
        running = false;
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {
                // Closing during teardown is expected.
            }
            serverSocket = null;
        }
        pool.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket socket = serverSocket.accept();
                pool.execute(new Runnable() {
                    @Override
                    public void run() {
                        handleConnection(socket);
                    }
                });
            } catch (IOException error) {
                if (running) Log.w(TAG, "accept failed: " + error.getMessage());
            }
        }
    }

    private void handleConnection(Socket socket) {
        try (Socket client = socket) {
            client.setSoTimeout(60_000);
            client.setTcpNoDelay(true);
            InputStream input = new BufferedInputStream(client.getInputStream());
            OutputStream out = new BufferedOutputStream(client.getOutputStream());

            String requestLine = readLine(input);
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                sendJson(out, 400, errorJson("bad request line"));
                return;
            }
            String method = parts[0].toUpperCase(Locale.US);
            String target = parts[1];

            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(input)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    headers.put(line.substring(0, colon).trim().toLowerCase(Locale.US),
                            line.substring(colon + 1).trim());
                }
            }

            if (!allowedHost(headers.get("host"))) {
                sendJson(out, 403, errorJson("forbidden host"));
                return;
            }
            if (!allowedOrigin(headers.get("origin"))) {
                sendJson(out, 403, errorJson("forbidden origin"));
                return;
            }
            if (!method.equals("GET") && !method.equals("HEAD")
                    && !method.equals("POST") && !method.equals("PATCH")
                    && !method.equals("DELETE")) {
                sendJson(out, 405, errorJson("method not allowed"));
                return;
            }

            byte[] body = new byte[0];
            String contentLength = headers.get("content-length");
            if (contentLength != null) {
                long length;
                try {
                    length = Long.parseLong(contentLength);
                } catch (NumberFormatException error) {
                    sendJson(out, 400, errorJson("invalid content-length"));
                    return;
                }
                if (length < 0) {
                    sendJson(out, 400, errorJson("invalid content-length"));
                    return;
                }
                if (length > MAX_BODY_BYTES) {
                    sendJson(out, 413, errorJson("request body too large"));
                    return;
                }
                body = readN(input, (int) length);
            }

            int queryIndex = target.indexOf('?');
            String rawPath = queryIndex >= 0 ? target.substring(0, queryIndex) : target;
            String rawQuery = queryIndex >= 0 ? target.substring(queryIndex + 1) : "";
            String path = URLDecoder.decode(rawPath, "UTF-8");
            Map<String, String> query = parseQuery(rawQuery);
            boolean head = method.equals("HEAD");

            if (path.startsWith("/api/")) {
                JSONObject parsedBody = null;
                if (body.length > 0) {
                    try {
                        parsedBody = new JSONObject(new String(body, StandardCharsets.UTF_8));
                    } catch (Exception error) {
                        sendJson(out, 400, errorJson("invalid JSON body"));
                        return;
                    }
                }
                handleApi(out, method, head, path, query, parsedBody);
            } else {
                serveStatic(out, method, head, path);
            }
        } catch (SocketTimeoutException error) {
            // A stalled connection is dropped.
        } catch (Exception error) {
            Log.w(TAG, "request failed: " + error);
        }
    }

    // ---------------------------------------------------------------- routes

    private void handleApi(
            OutputStream out,
            String method,
            boolean head,
            String path,
            Map<String, String> query,
            JSONObject body
    ) throws IOException {
        String providerId = providerId();

        if (path.equals("/api/health")) {
            sendJson(out, 200, new J()
                    .put("ok", true)
                    .put("edition", "free")
                    .put("providerId", providerId)
                    .put("mobile", true)
                    .put("offline", true).toString());
            return;
        }
        if (path.equals("/api/mobile/pack-info")) {
            sendJson(out, 200, packInfo().toString());
            return;
        }
        if (path.equals("/api/meta")) {
            sendPack(out, "api/meta.json");
            return;
        }
        if (path.equals("/api/coverage")) {
            sendPack(out, "api/coverage.json");
            return;
        }
        if (path.equals("/api/companies")) {
            sendPack(out, "api/companies.json");
            return;
        }
        if (path.equals("/api/quotes")) {
            sendPack(out, "api/quotes.json");
            return;
        }
        if (path.equals("/api/indices")) {
            sendPack(out, "api/indices.json");
            return;
        }
        if (path.equals("/api/summary")) {
            sendPack(out, "api/summary.json");
            return;
        }
        if (path.equals("/api/news")) {
            sendPack(out, "api/news.json");
            return;
        }
        if (path.equals("/api/ipos")) {
            sendPack(out, "api/ipos.json");
            return;
        }
        if (path.equals("/api/mutual-funds")) {
            sendPack(out, "api/mutual-funds.json");
            return;
        }
        if (path.equals("/api/screener")) {
            sendPack(out, "api/screener.json");
            return;
        }
        if (path.equals("/api/signals")) {
            sendPack(out, "api/signals.json");
            return;
        }
        if (path.equals("/api/data-quality")) {
            sendPack(out, "api/data-quality.json");
            return;
        }
        if (path.equals("/api/fundamentals/latest")) {
            sendPack(out, "api/fundamentals-latest.json");
            return;
        }
        if (path.equals("/api/fundamentals")) {
            String symbol = upper(query.get("symbol"));
            if (symbol.isEmpty()) {
                sendPack(out, "api/fundamentals-index.json");
            } else {
                String file = "fundamentals/" + symbol + ".json";
                if (pack.exists(file)) {
                    sendPack(out, file);
                } else {
                    sendJson(out, 404, new J()
                            .put("providerId", providerId)
                            .put("symbol", symbol)
                            .put("error", "no stored fundamentals for this symbol")
                            .toString());
                }
            }
            return;
        }
        if (path.equals("/api/corporate-actions/all")) {
            sendPack(out, "api/corporate-actions-all.json");
            return;
        }
        if (path.equals("/api/corporate-actions")) {
            String symbol = upper(query.get("symbol"));
            if (symbol.isEmpty()) {
                sendPack(out, "api/corporate-actions-index.json");
            } else {
                String file = "corporate-actions/" + symbol + ".json";
                if (pack.exists(file)) {
                    sendPack(out, file);
                } else {
                    sendJson(out, 200, new J()
                            .put("providerId", providerId)
                            .put("symbol", symbol)
                            .put("actions", new JSONArray())
                            .put("provenance", JSONObject.NULL)
                            .put("dataState", emptyDataState()).toString());
                }
            }
            return;
        }
        if (path.equals("/api/company-events")) {
            String symbol = upper(query.get("symbol"));
            if (!symbol.isEmpty()) {
                String file = "company-events/" + symbol + ".json";
                if (pack.exists(file)) {
                    sendPack(out, file);
                    return;
                }
            }
            if (pack.exists("api/company-events.json")) {
                sendPack(out, "api/company-events.json");
            } else {
                sendJson(out, 200, new J()
                        .put("providerId", providerId)
                        .put("symbol", symbol.isEmpty() ? JSONObject.NULL : symbol)
                        .put("types", new JSONArray())
                        .put("events", new JSONArray())
                        .put("total", 0)
                        .put("source", JSONObject.NULL)
                        .put("unavailableReason", "No company events are in this data pack")
                        .put("dataState", emptyDataState()).toString());
            }
            return;
        }
        if (path.equals("/api/candles")) {
            String symbol = upper(query.get("symbol"));
            if (symbol.isEmpty()) {
                sendJson(out, 400, errorJson("symbol is required"));
                return;
            }
            boolean index = "index".equalsIgnoreCase(query.get("kind"));
            String file = (index ? "candles-index/" : "candles/") + symbol + ".json";
            if (pack.exists(file)) {
                sendPack(out, file);
            } else {
                sendJson(out, 200, new J()
                        .put("providerId", providerId)
                        .put("symbol", symbol)
                        .put("kind", index ? "index" : "equity")
                        .put("candles", new JSONArray())
                        .put("provenance", JSONObject.NULL)
                        .put("dataState", emptyDataState()).toString());
            }
            return;
        }
        if (path.equals("/api/analysis")) {
            String symbol = upper(query.get("symbol"));
            if (symbol.isEmpty()) {
                sendJson(out, 400, errorJson("symbol is required"));
                return;
            }
            String file = "analysis/" + symbol + ".json";
            if (pack.exists(file)) {
                sendPack(out, file);
            } else {
                sendJson(out, 200, new J()
                        .put("providerId", providerId)
                        .put("symbol", symbol)
                        .put("analysis", JSONObject.NULL)
                        .put("provenance", JSONObject.NULL)
                        .put("dataState", emptyDataState()).toString());
            }
            return;
        }
        if (path.equals("/api/floorsheet")) {
            sendPack(out, "api/floorsheet.json");
            return;
        }
        if (path.equals("/api/broker-flows")) {
            sendPack(out, "api/broker-flows.json");
            return;
        }

        // ---------------------------------------------------- read-only status
        if (path.equals("/api/import/status")) {
            sendJson(out, 200, importStatus().toString());
            return;
        }
        if (path.equals("/api/import/history")) {
            sendJson(out, 200, new J()
                    .put("providerId", providerId)
                    .put("entries", new JSONArray()).toString());
            return;
        }
        if (path.equals("/api/refresh/status")) {
            sendJson(out, 200, refreshStatus().toString());
            return;
        }

        // -------------------------------------------------- unsupported online
        if (path.startsWith("/api/live/")
                || path.startsWith("/api/backtest/")
                || path.equals("/api/intraday")
                || path.equals("/api/refresh/run")
                || path.equals("/api/import/preview")
                || path.equals("/api/import/run")) {
            sendJson(out, 503, errorJson("Not available in the offline mobile app"));
            return;
        }

        // --------------------------------------------------------- watchlist
        if (path.equals("/api/watchlist")) {
            if (method.equals("GET") || method.equals("HEAD")) {
                JSONObject response = store.watchlistResponse();
                writeJson(out, 200, response.toString(), head);
                return;
            }
            if (method.equals("POST")) {
                if (body == null) {
                    sendJson(out, 400, errorJson("invalid JSON body"));
                    return;
                }
                boolean remove = "remove".equalsIgnoreCase(body.optString("action", ""));
                JSONObject response = store.mutateWatchlist(
                        body.isNull("symbol") ? "" : String.valueOf(body.opt("symbol")), remove);
                sendJson(out, 200, response.toString());
                return;
            }
            sendJson(out, 405, errorJson("method not allowed"));
            return;
        }

        // --------------------------------------------------------- portfolio
        if (path.equals("/api/portfolio")) {
            sendJson(out, 200, store.portfolioResponse(providerId).toString());
            return;
        }
        if (path.equals("/api/portfolio/transactions")) {
            if (!method.equals("POST")) {
                sendJson(out, 405, errorJson("method not allowed"));
                return;
            }
            try {
                JSONObject response = store.addTransaction(body == null ? new J() : body);
                sendJson(out, 201, response.toString());
            } catch (IllegalArgumentException error) {
                sendJson(out, 400, errorJson(error.getMessage()));
            }
            return;
        }
        if (path.equals("/api/portfolio/transactions/remove")) {
            if (!method.equals("POST")) {
                sendJson(out, 405, errorJson("method not allowed"));
                return;
            }
            long id = body == null ? -1 : body.optLong("id", -1);
            if (id <= 0) {
                sendJson(out, 400, errorJson("invalid transaction id"));
                return;
            }
            sendJson(out, 200, store.removeTransaction(id).toString());
            return;
        }

        // -------------------------------------------------------- trade plans
        Matcher planMatch = TRADE_PLAN_ID.matcher(path);
        if (path.equals("/api/trade-plans")) {
            if (method.equals("GET") || method.equals("HEAD")) {
                JSONObject response = store.plansResponse(query.get("symbol"));
                writeJson(out, 200, response.toString(), head);
                return;
            }
            if (method.equals("POST")) {
                try {
                    sendJson(out, 201, store.addPlan(body == null ? new J() : body).toString());
                } catch (IllegalArgumentException error) {
                    sendJson(out, 400, errorJson(error.getMessage()));
                }
                return;
            }
            sendJson(out, 405, errorJson("method not allowed"));
            return;
        }
        if (planMatch.matches()) {
            long id = Long.parseLong(planMatch.group(1));
            if (method.equals("PATCH")) {
                try {
                    JSONObject response = store.updatePlan(id,
                            body == null ? new J() : body);
                    if (response == null) {
                        sendJson(out, 404, errorJson("not found"));
                    } else {
                        sendJson(out, 200, response.toString());
                    }
                } catch (IllegalArgumentException error) {
                    sendJson(out, 400, errorJson(error.getMessage()));
                }
                return;
            }
            if (method.equals("DELETE")) {
                if (store.removePlan(id)) {
                    sendJson(out, 200, new J().put("deleted", true).toString());
                } else {
                    sendJson(out, 404, errorJson("not found"));
                }
                return;
            }
            sendJson(out, 405, errorJson("method not allowed"));
            return;
        }

        // ------------------------------------------------------------- journal
        Matcher snapshotMatch = JOURNAL_SNAPSHOT.matcher(path);
        if (snapshotMatch.matches()) {
            if (!method.equals("GET") && !method.equals("HEAD")) {
                sendJson(out, 405, errorJson("method not allowed"));
                return;
            }
            LocalStore.Snapshot snapshot =
                    store.snapshot(Long.parseLong(snapshotMatch.group(1)));
            if (snapshot == null) {
                sendJson(out, 404, errorJson("not found"));
            } else {
                writeBytes(out, 200, snapshot.mime, snapshot.bytes, head, false);
            }
            return;
        }
        Matcher journalMatch = JOURNAL_ID.matcher(path);
        if (path.equals("/api/journal")) {
            if (method.equals("GET") || method.equals("HEAD")) {
                JSONObject response = store.journalResponse(
                        emptyToNull(query.get("symbol")),
                        emptyToNull(query.get("from")),
                        emptyToNull(query.get("to")));
                writeJson(out, 200, response.toString(), head);
                return;
            }
            if (method.equals("POST")) {
                try {
                    sendJson(out, 201, store.addJournalEntry(
                            body == null ? new J() : body).toString());
                } catch (IllegalArgumentException error) {
                    sendJson(out, 400, errorJson(error.getMessage()));
                }
                return;
            }
            sendJson(out, 405, errorJson("method not allowed"));
            return;
        }
        if (journalMatch.matches()) {
            long id = Long.parseLong(journalMatch.group(1));
            if (method.equals("PATCH")) {
                try {
                    JSONObject response = store.updateJournalEntry(id,
                            body == null ? new J() : body);
                    if (response == null) {
                        sendJson(out, 404, errorJson("not found"));
                    } else {
                        sendJson(out, 200, response.toString());
                    }
                } catch (IllegalArgumentException error) {
                    sendJson(out, 400, errorJson(error.getMessage()));
                }
                return;
            }
            if (method.equals("DELETE")) {
                if (store.removeJournalEntry(id)) {
                    sendJson(out, 200, new J().put("deleted", true).toString());
                } else {
                    sendJson(out, 404, errorJson("not found"));
                }
                return;
            }
            sendJson(out, 405, errorJson("method not allowed"));
            return;
        }

        // ---------------------------------------------------- corporate ledger
        if (path.equals("/api/corporate-ledger")) {
            if (method.equals("GET") || method.equals("HEAD")) {
                JSONObject response = store.ledgerResponse(emptyToNull(query.get("symbol")));
                writeJson(out, 200, response.toString(), head);
                return;
            }
            if (method.equals("POST")) {
                try {
                    sendJson(out, 201, store.addLedgerEntry(
                            body == null ? new J() : body).toString());
                } catch (IllegalArgumentException error) {
                    sendJson(out, 400, errorJson(error.getMessage()));
                }
                return;
            }
            sendJson(out, 405, errorJson("method not allowed"));
            return;
        }
        Matcher ledgerMatch = LEDGER_ID.matcher(path);
        if (ledgerMatch.matches()) {
            if (!method.equals("DELETE")) {
                sendJson(out, 405, errorJson("method not allowed"));
                return;
            }
            if (store.removeLedgerEntry(Long.parseLong(ledgerMatch.group(1)))) {
                sendJson(out, 200, new J().put("deleted", true).toString());
            } else {
                sendJson(out, 404, errorJson("not found"));
            }
            return;
        }

        // -------------------------------------------------------- reconciliation
        if (path.equals("/api/reconciliation/import")) {
            if (!method.equals("POST")) {
                sendJson(out, 405, errorJson("method not allowed"));
                return;
            }
            if (body == null) {
                sendJson(out, 400, errorJson("invalid JSON body"));
                return;
            }
            try {
                JSONObject response = store.importReconciliation(
                        body.isNull("source") ? "" : String.valueOf(body.opt("source")),
                        body.isNull("csv") ? "" : String.valueOf(body.opt("csv")));
                sendJson(out, 200, response.toString());
            } catch (IllegalArgumentException error) {
                sendJson(out, 400, errorJson(error.getMessage()));
            }
            return;
        }
        if (path.equals("/api/reconciliation/transactions")) {
            sendJson(out, 200, store.reconciliationTransactions().toString());
            return;
        }
        if (path.equals("/api/reconciliation/summary")) {
            sendJson(out, 200, store.reconciliationSummary().toString());
            return;
        }

        sendJson(out, 404, errorJson("not found"));
    }

    // ------------------------------------------------------------ pack/status

    private String providerId() {
        JSONObject manifest = pack.manifest();
        return manifest == null ? "free-source" : manifest.optString("providerId", "free-source");
    }

    private JSONObject packInfo() {
        JSONObject manifest = pack.manifest();
        if (manifest == null) {
            return new J().put("error", "No data pack manifest is available");
        }
        J info = new J();
        info.put("version", manifest.optString("version", "unknown"));
        info.put("generatedAt", manifest.optString("generatedAt", ""));
        info.put("latestSession", manifest.isNull("latestSession")
                ? JSONObject.NULL : manifest.optString("latestSession", ""));
        info.put("years", manifest.optInt("years", 0));
        info.put("counts", manifest.optJSONObject("counts"));
        info.put("sizes", manifest.optJSONObject("sizes"));
        info.put("packHash", manifest.optString("packHash", ""));
        info.put("source", pack.isDownloaded() ? "downloaded" : "bundled");
        return info;
    }

    private JSONObject importStatus() {
        JSONObject meta = readPackJson("api/meta.json");
        JSONObject storeSummary = meta == null ? null : meta.optJSONObject("store");
        String dataDir = pack.isDownloaded()
                ? "Downloaded data pack (filesDir/pack)"
                : "Bundled data pack (APK assets)";
        J response = new J();
        response.put("dataDir", dataDir);
        response.put("edition", "free");
        response.put("canImport", false);
        response.put("files", new JSONArray());
        response.put("ohlc", new JSONArray());
        response.put("indices", new JSONArray());
        response.put("ready", false);
        response.put("missing", new JSONArray());
        response.put("syncing", false);
        response.put("store", storeSummary == null ? new J() : storeSummary);
        return response;
    }

    private JSONObject refreshStatus() {
        JSONObject manifest = pack.manifest();
        J response = new J();
        response.put("enabled", false);
        response.put("running", false);
        response.put("phase", "idle");
        response.put("reason", JSONObject.NULL);
        response.put("startedAt", JSONObject.NULL);
        response.put("finishedAt", JSONObject.NULL);
        response.put("lastSuccessAt", JSONObject.NULL);
        response.put("lastError", JSONObject.NULL);
        response.put("nextCheckAt", JSONObject.NULL);
        response.put("consecutiveFailures", 0);
        response.put("intervalMinutes", 0);
        response.put("commit", JSONObject.NULL);
        response.put("latestSession", manifest == null || manifest.isNull("latestSession")
                ? JSONObject.NULL : manifest.optString("latestSession", ""));
        response.put("detailsEnabled", false);
        response.put("lastProgress", JSONObject.NULL);
        response.put("lastResult", JSONObject.NULL);
        return response;
    }

    private JSONObject emptyDataState() {
        J counts = new J();
        counts.put("live", 0);
        counts.put("delayed", 0);
        counts.put("eod", 0);
        counts.put("stale", 0);
        counts.put("unavailable", 0);
        return new J()
                .put("state", "unavailable")
                .put("stale", false)
                .put("total", 0)
                .put("counts", counts)
                .put("lastAsOf", JSONObject.NULL)
                .put("classification", "MISSING");
    }

    private JSONObject readPackJson(String relative) {
        try {
            return new JSONObject(pack.readText(relative));
        } catch (Exception error) {
            return null;
        }
    }

    // --------------------------------------------------------------- static

    private void serveStatic(OutputStream out, String method, boolean head, String path)
            throws IOException {
        if (!method.equals("GET") && !method.equals("HEAD")) {
            sendJson(out, 405, errorJson("method not allowed"));
            return;
        }
        if (path.contains("..") || path.indexOf('\u0000') >= 0) {
            sendJson(out, 403, errorJson("forbidden"));
            return;
        }

        String asset;
        if (path.equals("/") || path.isEmpty()) {
            asset = "web/index.html";
        } else if (path.startsWith("/mobile/")) {
            asset = path.substring(1);
        } else if (path.endsWith("/")) {
            asset = "web" + path + "index.html";
        } else {
            asset = "web" + path;
        }

        byte[] bytes;
        String mime;
        try {
            bytes = PackStore.readAll(pack.openAsset(asset));
            mime = mimeOf(asset, path);
        } catch (IOException missing) {
            if (asset.startsWith("web/assets/") || asset.startsWith("web/icons/")
                    || path.equals("/sw.js") || path.equals("/manifest.webmanifest")) {
                sendJson(out, 404, errorJson("not found"));
                return;
            }
            // SPA route: serve the shell.
            try {
                bytes = PackStore.readAll(pack.openAsset("web/index.html"));
            } catch (IOException error) {
                sendJson(out, 404, errorJson("web build missing from the APK"));
                return;
            }
            mime = "text/html; charset=utf-8";
            asset = "web/index.html";
        }

        if (asset.equals("web/index.html")) {
            String html = new String(bytes, StandardCharsets.UTF_8);
            html = injectMobileShell(html);
            bytes = html.getBytes(StandardCharsets.UTF_8);
            mime = "text/html; charset=utf-8";
        }
        boolean immutable = asset.startsWith("web/assets/");
        boolean revalidate = asset.endsWith("index.html")
                || asset.endsWith("manifest.webmanifest")
                || asset.endsWith("sw.js")
                || !immutable;
        writeBytes(out, 200, mime, bytes, head, !revalidate);
    }

    private static String injectMobileShell(String html) {
        String head = "<link rel=\"stylesheet\" href=\"/mobile/mobile.css\">"
                + "<script defer src=\"/mobile/mobile.js\"></script>";
        int index = html.indexOf("</head>");
        if (index >= 0) {
            return html.substring(0, index) + head + html.substring(index);
        }
        return head + html;
    }

    private static String mimeOf(String asset, String path) {
        String lower = asset.toLowerCase(Locale.US);
        if (lower.endsWith(".html")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) {
            return "text/javascript; charset=utf-8";
        }
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".json")) return "application/json; charset=utf-8";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
        return "application/octet-stream";
    }

    // ------------------------------------------------------------- responses

    private void sendPack(OutputStream out, String relative) throws IOException {
        try {
            byte[] bytes = pack.readBytes(relative);
            writeBytes(out, 200, "application/json; charset=utf-8", bytes, false, false);
        } catch (IOException error) {
            sendJson(out, 404, errorJson("pack file not found: " + relative));
        }
    }

    private void sendJson(OutputStream out, int status, String json) throws IOException {
        writeJson(out, status, json, false);
    }

    private void writeJson(OutputStream out, int status, String json, boolean head)
            throws IOException {
        writeBytes(out, status, "application/json; charset=utf-8",
                json.getBytes(StandardCharsets.UTF_8), head, false);
    }

    private void writeBytes(
            OutputStream out,
            int status,
            String contentType,
            byte[] bytes,
            boolean head,
            boolean immutable
    ) throws IOException {
        StringBuilder header = new StringBuilder();
        header.append("HTTP/1.1 ").append(status).append(' ').append(statusText(status)).append("\r\n");
        header.append("Content-Type: ").append(contentType).append("\r\n");
        header.append("Content-Length: ").append(bytes.length).append("\r\n");
        header.append("Cache-Control: ")
                .append(immutable ? "public, max-age=31536000, immutable" : "no-store")
                .append("\r\n");
        header.append("X-Content-Type-Options: nosniff\r\n");
        header.append("Referrer-Policy: no-referrer\r\n");
        header.append("Connection: close\r\n\r\n");
        out.write(header.toString().getBytes(StandardCharsets.US_ASCII));
        if (!head) out.write(bytes);
        out.flush();
    }

    private static String statusText(int status) {
        switch (status) {
            case 200: return "OK";
            case 201: return "Created";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 413: return "Payload Too Large";
            case 500: return "Internal Server Error";
            case 503: return "Service Unavailable";
            default: return "OK";
        }
    }

    private static String errorJson(String message) {
        return new J().put("error", message == null ? "error" : message).toString();
    }

    // ---------------------------------------------------------------- parsing

    private boolean allowedHost(String host) {
        if (host == null || host.isEmpty()) return true;
        String value = host.toLowerCase(Locale.US);
        int colon = value.lastIndexOf(':');
        if (colon > 0 && value.indexOf(']') < 0) {
            String maybePort = value.substring(colon + 1);
            if (maybePort.matches("\\d+")) value = value.substring(0, colon);
        }
        return value.equals("127.0.0.1") || value.equals("localhost")
                || value.equals("[::1]") || value.equals("::1");
    }

    private boolean allowedOrigin(String origin) {
        if (origin == null || origin.isEmpty() || origin.equals("null")) return true;
        String value = origin.toLowerCase(Locale.US);
        return value.startsWith("http://127.0.0.1:")
                || value.startsWith("http://localhost:")
                || value.equals("http://127.0.0.1")
                || value.equals("http://localhost");
    }

    private static Map<String, String> parseQuery(String raw) {
        Map<String, String> query = new HashMap<>();
        if (raw == null || raw.isEmpty()) return query;
        for (String pair : raw.split("&")) {
            if (pair.isEmpty()) continue;
            int equals = pair.indexOf('=');
            String key = equals >= 0 ? pair.substring(0, equals) : pair;
            String value = equals >= 0 ? pair.substring(equals + 1) : "";
            try {
                query.put(URLDecoder.decode(key, "UTF-8"),
                        URLDecoder.decode(value, "UTF-8"));
            } catch (Exception ignored) {
                // Skip a malformed parameter.
            }
        }
        return query;
    }

    private static String upper(String value) {
        return value == null ? "" : value.trim().toUpperCase(Locale.US);
    }

    private static String emptyToNull(String value) {
        return value == null || value.trim().isEmpty() ? null : value.trim();
    }

    private static String readLine(InputStream input) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream(128);
        int ch;
        boolean any = false;
        while ((ch = input.read()) != -1) {
            any = true;
            if (ch == '\n') break;
            if (ch != '\r') line.write(ch);
            if (line.size() > 16 * 1024) return null;
        }
        if (!any && line.size() == 0) return null;
        return new String(line.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static byte[] readN(InputStream input, int length) throws IOException {
        byte[] bytes = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = input.read(bytes, offset, length - offset);
            if (read < 0) break;
            offset += read;
        }
        if (offset != length) {
            byte[] truncated = new byte[offset];
            System.arraycopy(bytes, 0, truncated, 0, offset);
            return truncated;
        }
        return bytes;
    }
}

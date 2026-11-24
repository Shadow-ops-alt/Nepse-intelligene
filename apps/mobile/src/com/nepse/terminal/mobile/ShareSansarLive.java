package com.nepse.terminal.mobile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Unofficial live-market fallback: the public ShareSansar live-trading table.
 *
 * The page is server-rendered with the session time, market open/closed state,
 * the NEPSE index/turnover block and a table of every traded scrip. It is read
 * only; nothing is written to the end-of-day store. The app polls the local
 * endpoint, and this class caches one fetch for 30 seconds.
 */
final class ShareSansarLive {

    private static final String PAGE = "https://www.sharesansar.com/live-trading";
    private static final String USER_AGENT =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/131.0 Safari/537.36";
    private static final String SOURCE = "ShareSansar Live Trading (unofficial)";
    private static final String DISCLAIMER =
            "Unofficial read of ShareSansar's public live-trading table. "
                    + "Not provided or endorsed by NEPSE. Prices may be delayed or wrong, "
                    + "and are never written to the end-of-day store.";
    private static final long TTL_MS = 30_000;
    private static final long MAX_BYTES = 4 * 1024 * 1024;

    private static final Pattern AS_OF = Pattern.compile(
            "(?is)id=\"dDate\"[^>]*>(.*?)</span>");
    private static final Pattern TURNOVER = Pattern.compile(
            "(?is)<h4>\\s*NEPSE Index\\s*</h4>\\s*<p\\s+class=\"mu-price\">(.*?)</p>");
    private static final Pattern INDEX_VALUE = Pattern.compile(
            "(?is)<h4>\\s*NEPSE Index\\s*</h4>.*?<span\\s+class=\"mu-value([^\"]*)\"[^>]*>(.*?)</span>");
    private static final Pattern INDEX_PERCENT = Pattern.compile(
            "(?is)<h4>\\s*NEPSE Index\\s*</h4>.*?<span\\s+class=\"mu-percent([^\"]*)\"[^>]*>(.*?)</span>");
    private static final Pattern ROWS = Pattern.compile("(?is)<tr[^>]*>(.*?)</tr>");
    private static final Pattern CELLS = Pattern.compile("(?is)<td[^>]*>(.*?)</td>");
    private static final Pattern SYMBOL = Pattern.compile("^[A-Z0-9._-]{1,24}$");
    private static final Pattern NUMBER_ENTITY = Pattern.compile("&#(x?[0-9a-fA-F]+);");

    private static Snapshot cache;
    private static long cachedAt;

    private ShareSansarLive() {}

    static final class Row {
        String symbol;
        Double ltp;
        Double change;
        Double changePercent;
        Double open;
        Double high;
        Double low;
        Double volume;
        Double previousClose;
    }

    static final class Snapshot {
        Boolean open;
        String asOf;
        String asOfIso;
        Double indexValue;
        Double indexChange;
        Double indexPercent;
        Double turnover;
        String error;
        long fetchedAt;
        final List<Row> rows = new ArrayList<>();
    }

    static synchronized Snapshot snapshot() {
        long now = System.currentTimeMillis();
        if (cache != null && now - cachedAt < TTL_MS) return cache;
        try {
            Snapshot next = parse(fetch());
            next.fetchedAt = now;
            cache = next;
            cachedAt = now;
            return next;
        } catch (Exception error) {
            String message = "Live market refresh failed: " + error.getMessage();
            if (cache != null) {
                cache.error = message;
                cache.fetchedAt = now;
                cachedAt = now;
                return cache;
            }
            Snapshot failed = new Snapshot();
            failed.error = message;
            failed.fetchedAt = now;
            cache = failed;
            cachedAt = now;
            return failed;
        }
    }

    static JSONObject statusJson() {
        Snapshot value = snapshot();
        return new J()
                .put("enabled", true)
                .put("source", SOURCE)
                .put("marketOpen", value.open == null ? JSONObject.NULL : value.open)
                .put("asOf", value.asOfIso == null ? JSONObject.NULL : value.asOfIso)
                .put("lastError", value.error == null ? JSONObject.NULL : value.error)
                .put("disclaimer", DISCLAIMER);
    }

    static JSONObject marketJson() {
        Snapshot value = snapshot();
        JSONArray rows = new JSONArray();
        for (Row row : value.rows) {
            J quote = new J()
                    .put("symbol", row.symbol)
                    .put("ltp", nullable(row.ltp))
                    .put("previousClose", nullable(row.previousClose))
                    .put("change", nullable(row.change))
                    .put("changePercent", nullable(row.changePercent))
                    .put("open", nullable(row.open))
                    .put("high", nullable(row.high))
                    .put("low", nullable(row.low))
                    .put("volume", nullable(row.volume))
                    .put("turnover", JSONObject.NULL)
                    .put("lastTradedAt", JSONObject.NULL);
            rows.put(quote);
        }
        return new J()
                .put("enabled", true)
                .put("marketOpen", value.open == null ? JSONObject.NULL : value.open)
                .put("asOf", value.asOfIso == null ? JSONObject.NULL : value.asOfIso)
                .put("fetchedAt", Instant.ofEpochMilli(value.fetchedAt).toString())
                .put("rows", rows)
                .put("lastError", value.error == null ? JSONObject.NULL : value.error);
    }

    static JSONObject summaryJson() {
        Snapshot value = snapshot();
        JSONObject index = null;
        if (value.indexValue != null) {
            index = new J()
                    .put("value", value.indexValue)
                    .put("change", nullable(value.indexChange))
                    .put("changePercent", nullable(value.indexPercent));
        }
        return new J()
                .put("enabled", true)
                .put("asOf", value.asOfIso == null ? JSONObject.NULL : value.asOfIso)
                .put("fetchedAt", Instant.ofEpochMilli(value.fetchedAt).toString())
                .put("index", index == null ? JSONObject.NULL : index)
                .put("turnover", nullable(value.turnover))
                .put("sharesTraded", JSONObject.NULL)
                .put("transactions", JSONObject.NULL)
                .put("scripsTraded", value.rows.size())
                .put("lastError", value.error == null ? JSONObject.NULL : value.error);
    }

    static JSONObject depthJson(String symbol) {
        Snapshot value = snapshot();
        return new J()
                .put("enabled", true)
                .put("asOf", value.asOfIso == null ? JSONObject.NULL : value.asOfIso)
                .put("fetchedAt", Instant.ofEpochMilli(value.fetchedAt).toString())
                .put("symbol", symbol == null ? "" : symbol.trim().toUpperCase())
                .put("bids", new JSONArray())
                .put("asks", new JSONArray())
                .put("lastError", "Market depth is not published by ShareSansar Live Trading.");
    }

    private static Object nullable(Double value) {
        return value == null ? JSONObject.NULL : value;
    }

    private static String fetch() throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(PAGE).openConnection();
        connection.setRequestMethod("GET");
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(25_000);
        connection.setRequestProperty("user-agent", USER_AGENT);
        connection.setRequestProperty("accept", "text/html,application/xhtml+xml");
        connection.setRequestProperty("accept-language", "en-US,en;q=0.9");
        connection.setRequestProperty("accept-encoding", "identity");
        int status = connection.getResponseCode();
        if (status != 200) {
            connection.disconnect();
            throw new IOException("ShareSansar live-trading returned HTTP " + status);
        }
        try (InputStream input = new BufferedInputStream(connection.getInputStream());
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_BYTES) throw new IOException("live page is too large");
                output.write(buffer, 0, read);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            connection.disconnect();
        }
    }

    private static Snapshot parse(String html) {
        Snapshot value = new Snapshot();
        String asOf = strip(first(AS_OF, html, 1));
        if (asOf != null && asOf.matches("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}")) {
            value.asOf = asOf;
            value.asOfIso = asOf.replace(' ', 'T') + "+05:45";
        } else if (asOf != null && asOf.matches("\\d{4}-\\d{2}-\\d{2}T.*")) {
            value.asOf = asOf;
            value.asOfIso = asOf;
        }
        if (html.contains("Market Closed")) {
            value.open = false;
        } else if (html.contains("Market Open")) {
            value.open = true;
        }

        value.turnover = number(first(TURNOVER, html, 1));
        Matcher indexValue = INDEX_VALUE.matcher(html);
        if (indexValue.find()) {
            value.indexValue = number(strip(indexValue.group(2)));
        }
        Matcher indexPercent = INDEX_PERCENT.matcher(html);
        if (indexPercent.find()) {
            String classes = indexPercent.group(1) == null ? "" : indexPercent.group(1);
            Double percent = number(strip(indexPercent.group(2)));
            if (percent != null) {
                boolean negative = classes.contains("text-red")
                        || indexPercent.group(0).contains("fa-caret-down");
                value.indexPercent = negative ? -Math.abs(percent) : Math.abs(percent);
            }
        }
        if (value.indexValue != null && value.indexPercent != null
                && value.indexPercent > -100) {
            value.indexChange = value.indexValue
                    - value.indexValue / (1 + value.indexPercent / 100);
        }

        int table = html.indexOf("id=\"headFixed\"");
        if (table < 0) return value;
        int tbody = html.indexOf("<tbody", table);
        int end = tbody >= 0 ? html.indexOf("</tbody>", tbody) : -1;
        if (tbody < 0 || end < 0) {
            tbody = table;
            end = html.indexOf("</table>", table);
        }
        if (end <= tbody) return value;
        Matcher rows = ROWS.matcher(html.substring(tbody, end));
        while (rows.find()) {
            Matcher cells = CELLS.matcher(rows.group(1));
            List<String> values = new ArrayList<>();
            while (cells.find()) values.add(strip(cells.group(1)));
            if (values.size() < 10) continue;
            String symbol = values.get(1) == null ? "" : values.get(1).trim().toUpperCase();
            if (!SYMBOL.matcher(symbol).matches()) continue;
            if (!values.get(0).matches("\\d+")) continue;
            Row row = new Row();
            row.symbol = symbol;
            row.ltp = number(values.get(2));
            row.change = number(values.get(3));
            row.changePercent = number(values.get(4));
            row.open = number(values.get(5));
            row.high = number(values.get(6));
            row.low = number(values.get(7));
            row.volume = number(values.get(8));
            row.previousClose = number(values.get(9));
            if (row.ltp != null && row.previousClose != null && row.change == null) {
                row.change = row.ltp - row.previousClose;
            }
            if (row.change != null && row.previousClose != null
                    && row.previousClose > 0 && row.changePercent == null) {
                row.changePercent = (row.change / row.previousClose) * 100;
            }
            value.rows.add(row);
        }
        return value;
    }

    private static String first(Pattern pattern, String text, int group) {
        Matcher matcher = pattern.matcher(text);
        return matcher.find() ? matcher.group(group) : null;
    }

    private static Double number(String text) {
        if (text == null) return null;
        String cleaned = text.replaceAll("[,\\s%]", "").trim();
        if (cleaned.isEmpty() || cleaned.equals("-")) return null;
        try {
            return Double.parseDouble(cleaned);
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private static String strip(String html) {
        if (html == null) return null;
        String text = html.replaceAll("(?is)<[^>]*>", " ");
        text = text.replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">");
        Matcher entities = NUMBER_ENTITY.matcher(text);
        StringBuffer buffer = new StringBuffer();
        while (entities.find()) {
            String raw = entities.group(1);
            int code;
            try {
                code = raw.startsWith("x") || raw.startsWith("X")
                        ? Integer.parseInt(raw.substring(1), 16)
                        : Integer.parseInt(raw);
            } catch (NumberFormatException error) {
                code = 0;
            }
            entities.appendReplacement(buffer, code > 0 ? String.valueOf((char) code) : "");
        }
        entities.appendTail(buffer);
        return buffer.toString().replaceAll("\\s+", " ").trim();
    }
}

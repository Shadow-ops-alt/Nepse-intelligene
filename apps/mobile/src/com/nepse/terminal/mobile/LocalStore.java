package com.nepse.terminal.mobile;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Local, file-backed storage for the personal tools: watchlist, portfolio,
 * trade plans, journal, corporate ledger and reconciliation imports.
 *
 * Everything is stored as JSON in filesDir. Writes are atomic (tmp + rename)
 * so a crash never leaves a half-written file. Reads and writes are
 * synchronized because the HTTP server handles requests concurrently.
 */
public final class LocalStore {

    private static final Pattern SYMBOL = Pattern.compile("^[A-Z0-9._-]{1,24}$");
    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}(?:$|[T ])");
    private static final double DAY_MS = 86_400_000d;

    private final Context context;
    private final PackStore pack;
    private final File dir;
    private final File snapshotDir;
    private final Object lock = new Object();

    private final List<String> watchlist = new ArrayList<>();
    private final List<JSONObject> transactions = new ArrayList<>();
    private final List<JSONObject> plans = new ArrayList<>();
    private final List<JSONObject> journal = new ArrayList<>();
    private final List<JSONObject> ledger = new ArrayList<>();
    private final List<JSONObject> reconciliationImports = new ArrayList<>();

    private long nextTransactionId = 1;
    private long nextPlanId = 1;
    private long nextJournalId = 1;
    private long nextLedgerId = 1;
    private long nextImportId = 1;

    private JSONObject quoteRoot;
    private final Map<String, PriceInfo> quotes = new HashMap<>();
    private final Map<String, PriceInfo> candlePrices = new HashMap<>();

    public LocalStore(Context context, PackStore pack) {
        this.context = context.getApplicationContext();
        this.pack = pack;
        this.dir = new File(context.getFilesDir(), "local");
        this.snapshotDir = new File(context.getFilesDir(), "journal-snapshots");
        dir.mkdirs();
        snapshotDir.mkdirs();
        load();
    }

    // ------------------------------------------------------------------ load

    private void load() {
        try {
            JSONObject root = readJson("watchlist.json");
            JSONArray symbols = root == null ? null : root.optJSONArray("symbols");
            if (symbols != null) {
                for (int i = 0; i < symbols.length(); i += 1) {
                    String symbol = symbols.optString(i, "").trim().toUpperCase(Locale.US);
                    if (!symbol.isEmpty()) watchlist.add(symbol);
                }
            }
        } catch (Exception ignored) {
            // A corrupt file starts empty rather than crashing the app.
        }
        nextTransactionId = loadList("transactions.json", "transactions",
                transactions, "id", nextTransactionId);
        nextPlanId = loadList("plans.json", "plans", plans, "id", nextPlanId);
        nextJournalId = loadList("journal.json", "entries", journal, "id", nextJournalId);
        nextLedgerId = loadList("ledger.json", "entries", ledger, "id", nextLedgerId);
        nextImportId = loadList("reconciliation.json", "imports",
                reconciliationImports, "id", nextImportId);
    }

    private long loadList(
            String file,
            String arrayName,
            List<JSONObject> target,
            String idKey,
            long fallbackId
    ) {
        long next = fallbackId;
        try {
            JSONObject root = readJson(file);
            JSONArray rows = root == null ? null : root.optJSONArray(arrayName);
            long storedNext = root == null ? 0 : root.optLong("nextId", 0);
            if (rows != null) {
                for (int i = 0; i < rows.length(); i += 1) {
                    JSONObject row = rows.optJSONObject(i);
                    if (row == null) continue;
                    target.add(row);
                    next = Math.max(next, row.optLong(idKey, 0) + 1);
                }
            }
            if (storedNext > next) next = storedNext;
        } catch (Exception ignored) {
            // Ignore a corrupt file.
        }
        return next;
    }

    private JSONObject readJson(String name) throws IOException {
        File file = new File(dir, name);
        if (!file.isFile()) return null;
        byte[] bytes = Files.readAllBytes(file.toPath());
        try {
            return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        } catch (Exception error) {
            return null;
        }
    }

    private void writeJson(String name, JSONObject body) throws IOException {
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        File file = new File(dir, name);
        File tmp = new File(dir, name + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(bytes);
            out.getFD().sync();
        }
        try {
            Files.move(tmp.toPath(), file.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException error) {
            Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private void saveWatchlist() {
        try {
            JSONArray symbols = new JSONArray();
            for (String symbol : watchlist) symbols.put(symbol);
            J root = new J().put("symbols", symbols);
            writeJson("watchlist.json", root);
        } catch (IOException error) {
            // The in-memory value still applies for this session.
        }
    }

    private void saveTransactions() {
        saveList("transactions.json", "transactions", transactions, nextTransactionId);
    }

    private void savePlans() {
        saveList("plans.json", "plans", plans, nextPlanId);
    }

    private void saveJournal() {
        saveList("journal.json", "entries", journal, nextJournalId);
    }

    private void saveLedger() {
        saveList("ledger.json", "entries", ledger, nextLedgerId);
    }

    private void saveImports() {
        saveList("reconciliation.json", "imports", reconciliationImports, nextImportId);
    }

    private void saveList(String file, String arrayName, List<JSONObject> rows, long nextId) {
        try {
            JSONArray array = new JSONArray();
            for (JSONObject row : rows) array.put(row);
            J root = new J()
                    .put(arrayName, array)
                    .put("nextId", nextId);
            writeJson(file, root);
        } catch (IOException error) {
            // The in-memory value still applies for this session.
        }
    }

    // -------------------------------------------------------------- watchlist

    public JSONObject watchlistResponse() {
        synchronized (lock) {
            JSONArray symbols = new JSONArray();
            for (String symbol : watchlist) symbols.put(symbol);
            return new J().put("symbols", symbols);
        }
    }

    public JSONObject mutateWatchlist(String rawSymbol, boolean remove) {
        String symbol = normalizeSymbol(rawSymbol);
        synchronized (lock) {
            if (remove) {
                watchlist.remove(symbol);
            } else if (!watchlist.contains(symbol)) {
                watchlist.add(symbol);
            }
            saveWatchlist();
            return watchlistResponse();
        }
    }

    public List<String> watchlist() {
        synchronized (lock) {
            return new ArrayList<>(watchlist);
        }
    }

    // ------------------------------------------------------------- portfolio

    public JSONObject addTransaction(JSONObject body) {
        String symbol = normalizeSymbol(String.valueOf(body.opt("symbol") == null
                ? "" : body.opt("symbol")));
        String side = text(body, "side").toLowerCase(Locale.US);
        if (!side.equals("buy") && !side.equals("sell")) {
            throw new IllegalArgumentException("side must be buy or sell");
        }
        Double quantity = optNumber(body, "quantity");
        if (quantity == null || quantity <= 0) {
            throw new IllegalArgumentException("quantity must be positive");
        }
        Double price = optNumber(body, "price");
        if (price == null || price < 0) {
            throw new IllegalArgumentException("price must be zero or positive");
        }
        Double fees = optNumber(body, "fees");
        if (fees == null) fees = 0d;
        if (fees < 0) {
            throw new IllegalArgumentException("fees must be zero or positive");
        }
        String tradedAt = body.has("tradedAt") && !body.isNull("tradedAt")
                ? String.valueOf(body.opt("tradedAt")).trim()
                : nptDate();
        if (!tradedAt.matches("^\\d{4}-\\d{2}-\\d{2}.*")) {
            throw new IllegalArgumentException("tradedAt must start with YYYY-MM-DD");
        }
        String notes = optionalText(body, "notes");
        synchronized (lock) {
            JSONObject transaction = newTransaction(
                    symbol, side, quantity, price, fees, tradedAt, notes,
                    null, null, "trade");
            saveTransactions();
            return new J().put("transaction", transaction);
        }
    }

    private JSONObject newTransaction(
            String symbol,
            String side,
            double quantity,
            double price,
            double fees,
            String tradedAt,
            String notes,
            String source,
            String externalId,
            String kind
    ) {
        J transaction = new J();
        transaction.put("id", nextTransactionId++);
        transaction.put("symbol", symbol);
        transaction.put("side", side);
        transaction.put("quantity", quantity);
        transaction.put("price", price);
        transaction.put("fees", fees);
        transaction.put("tradedAt", tradedAt);
        transaction.put("notes", notes == null ? JSONObject.NULL : notes);
        transaction.put("createdAt", Instant.now().toString());
        transaction.put("source", source == null ? JSONObject.NULL : source);
        transaction.put("externalId", externalId == null ? JSONObject.NULL : externalId);
        transaction.put("kind", kind == null ? "trade" : kind);
        transactions.add(transaction);
        return transaction;
    }

    public JSONObject removeTransaction(long id) {
        synchronized (lock) {
            boolean removed = removeById(transactions, id);
            if (removed) saveTransactions();
            return new J().put("removed", removed);
        }
    }

    public JSONArray transactionsJson() {
        synchronized (lock) {
            JSONArray array = new JSONArray();
            for (JSONObject transaction : transactions) array.put(J.copy(transaction));
            return array;
        }
    }

    public JSONObject portfolioResponse(String providerId) {
        synchronized (lock) {
            PortfolioResult result = computePortfolio();
            J response = new J();
            response.put("providerId", providerId);
            response.put("transactions", transactionsJson());
            response.put("positions", result.positions);
            response.put("totals", result.totals);
            response.put("warnings", result.warnings);
            response.put("dataState", dataState());
            return response;
        }
    }

    private static final class WorkingPosition {
        String symbol;
        double quantity;
        double costBasis;
        double realizedPnl;
        String firstTradeAt;
        String lastTradeAt;
    }

    private static final class PortfolioResult {
        JSONArray positions = new JSONArray();
        J totals = new J();
        JSONArray warnings = new JSONArray();
    }

    private PortfolioResult computePortfolio() {
        PortfolioResult result = new PortfolioResult();
        List<JSONObject> sorted = new ArrayList<>(transactions);
        Collections.sort(sorted, new Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                int byDate = a.optString("tradedAt", "")
                        .compareTo(b.optString("tradedAt", ""));
                if (byDate != 0) return byDate;
                String sideA = a.optString("side", "");
                String sideB = b.optString("side", "");
                if (!sideA.equals(sideB)) {
                    return sideA.equals("buy") ? -1 : 1;
                }
                return Long.compare(a.optLong("id", 0), b.optLong("id", 0));
            }
        });

        Map<String, WorkingPosition> positions = new HashMap<>();
        for (JSONObject trade : sorted) {
            String symbol = trade.optString("symbol", "").trim().toUpperCase(Locale.US);
            if (symbol.isEmpty()) continue;
            Double quantity = optNumber(trade, "quantity");
            if (quantity == null || quantity <= 0) {
                result.warnings.put(symbol + ": ignored a trade with non-positive quantity");
                continue;
            }
            Double price = optNumber(trade, "price");
            if (price == null || price < 0) {
                result.warnings.put(symbol + ": ignored a trade with an invalid price");
                continue;
            }
            Double feeValue = optNumber(trade, "fees");
            double fees = feeValue == null ? 0 : Math.max(0, feeValue);
            WorkingPosition position = positions.get(symbol);
            String tradedAt = trade.optString("tradedAt", "");
            if (position == null) {
                position = new WorkingPosition();
                position.symbol = symbol;
                position.firstTradeAt = tradedAt;
                position.lastTradeAt = tradedAt;
                positions.put(symbol, position);
            }
            if (tradedAt.compareTo(position.firstTradeAt) < 0) position.firstTradeAt = tradedAt;
            if (tradedAt.compareTo(position.lastTradeAt) > 0) position.lastTradeAt = tradedAt;

            if ("buy".equals(trade.optString("side", ""))) {
                position.quantity += quantity;
                position.costBasis += quantity * price + fees;
            } else {
                double sellQuantity = Math.min(quantity, position.quantity);
                if (sellQuantity < quantity) {
                    result.warnings.put(symbol + ": sell of " + formatNumber(quantity)
                            + " exceeded the held " + formatNumber(position.quantity)
                            + "; clamped to " + formatNumber(sellQuantity));
                }
                if (sellQuantity > 0) {
                    double averageCost = position.quantity > 0
                            ? position.costBasis / position.quantity : 0;
                    position.realizedPnl += sellQuantity * price - fees
                            - sellQuantity * averageCost;
                    position.quantity -= sellQuantity;
                    position.costBasis -= sellQuantity * averageCost;
                    if (position.quantity <= 1e-9) {
                        position.quantity = 0;
                        position.costBasis = 0;
                    }
                }
            }
        }

        Map<String, PriceInfo> priceBySymbol = prices();
        int candleFallbacks = 0;
        for (WorkingPosition position : positions.values()) {
            if (!priceBySymbol.containsKey(position.symbol)) {
                PriceInfo candle = candlePrice(position.symbol);
                if (candle != null) {
                    priceBySymbol.put(position.symbol, candle);
                    candleFallbacks += 1;
                }
            }
        }

        double costBasisTotal = 0;
        double pricedCostBasis = 0;
        double marketValueTotal = 0;
        double realizedTotal = 0;
        int pricedPositions = 0;
        int unpricedPositions = 0;

        List<WorkingPosition> ordered = new ArrayList<>(positions.values());
        Collections.sort(ordered, new Comparator<WorkingPosition>() {
            @Override
            public int compare(WorkingPosition a, WorkingPosition b) {
                return a.symbol.compareTo(b.symbol);
            }
        });

        for (WorkingPosition position : ordered) {
            if (!(position.quantity > 1e-9 || position.realizedPnl != 0)) continue;
            PriceInfo price = priceBySymbol.get(position.symbol);
            Double marketPrice = price == null ? null : price.price;
            Double marketValue = marketPrice == null ? null : marketPrice * position.quantity;
            double averageCost = position.quantity > 0
                    ? position.costBasis / position.quantity : 0;
            Double unrealizedPnl = marketValue == null
                    ? null : marketValue - position.costBasis;
            Double unrealizedPnlPercent = unrealizedPnl == null || position.costBasis == 0
                    ? null : (unrealizedPnl / position.costBasis) * 100;

            if (position.quantity > 0) {
                costBasisTotal += position.costBasis;
                realizedTotal += position.realizedPnl;
                if (marketValue == null) {
                    unpricedPositions += 1;
                } else {
                    marketValueTotal += marketValue;
                    pricedCostBasis += position.costBasis;
                    pricedPositions += 1;
                }
            } else {
                realizedTotal += position.realizedPnl;
            }

            J row = new J();
            row.put("symbol", position.symbol);
            row.put("quantity", round(position.quantity, 4));
            row.put("averageCost", round(averageCost, 4));
            row.put("costBasis", round(position.costBasis, 2));
            row.put("marketPrice", marketPrice == null ? JSONObject.NULL : round(marketPrice, 2));
            row.put("marketValue", marketValue == null ? JSONObject.NULL : round(marketValue, 2));
            row.put("unrealizedPnl", unrealizedPnl == null ? JSONObject.NULL : round(unrealizedPnl, 2));
            row.put("unrealizedPnlPercent",
                    unrealizedPnlPercent == null ? JSONObject.NULL : round(unrealizedPnlPercent, 2));
            row.put("realizedPnl", round(position.realizedPnl, 2));
            row.put("firstTradeAt", position.firstTradeAt);
            row.put("lastTradeAt", position.lastTradeAt);
            row.put("quoteAsOf", price == null || price.asOf == null
                    ? JSONObject.NULL : price.asOf);
            row.put("valuation", price == null || price.provenance == null
                    ? JSONObject.NULL : price.provenance);
            result.positions.put(row);
        }

        if (unpricedPositions > 0) {
            result.warnings.put(unpricedPositions + " open position"
                    + (unpricedPositions == 1 ? " has" : "s have")
                    + " no stored quote; market value and unrealised P&L exclude them");
        }
        if (candleFallbacks > 0) {
            result.warnings.put(candleFallbacks + " position"
                    + (candleFallbacks == 1 ? " uses" : "s use")
                    + " the latest stored daily close because no quote is stored");
        }

        double unrealizedTotal = marketValueTotal - pricedCostBasis;
        result.totals.put("costBasis", round(costBasisTotal, 2));
        result.totals.put("marketValue", round(marketValueTotal, 2));
        result.totals.put("unrealizedPnl", round(unrealizedTotal, 2));
        result.totals.put("realizedPnl", round(realizedTotal, 2));
        result.totals.put("totalPnl", round(unrealizedTotal + realizedTotal, 2));
        result.totals.put("pricedPositions", pricedPositions);
        result.totals.put("unpricedPositions", unpricedPositions);
        return result;
    }

    // ---------------------------------------------------------------- prices

    private static final class PriceInfo {
        String symbol;
        Double price;
        String asOf;
        JSONObject provenance;
    }

    private Map<String, PriceInfo> prices() {
        synchronized (lock) {
            if (quoteRoot != null) return quotes;
            try {
                quoteRoot = new JSONObject(pack.readText("api/quotes.json"));
                JSONArray rows = quoteRoot.optJSONArray("quotes");
                JSONObject provenance = quoteRoot.optJSONObject("provenance");
                if (rows != null) {
                    for (int index = 0; index < rows.length(); index += 1) {
                        JSONObject row = rows.optJSONObject(index);
                        if (row == null) continue;
                        String symbol = row.optString("symbol", "")
                                .trim().toUpperCase(Locale.US);
                        if (symbol.isEmpty()) continue;
                        Double ltp = optNumber(row, "ltp");
                        if (ltp == null) continue;
                        PriceInfo info = new PriceInfo();
                        info.symbol = symbol;
                        info.price = ltp;
                        info.asOf = row.isNull("asOf") ? null : row.optString("asOf", null);
                        info.provenance = provenance == null
                                ? null : provenance.optJSONObject(symbol);
                        quotes.put(symbol, info);
                    }
                }
            } catch (Exception error) {
                quoteRoot = new J();
            }
            return quotes;
        }
    }

    private PriceInfo candlePrice(String symbol) {
        synchronized (lock) {
            if (candlePrices.containsKey(symbol)) return candlePrices.get(symbol);
            PriceInfo info = null;
            String path = "candles/" + symbol + ".json";
            if (pack.exists(path)) {
                try {
                    JSONObject root = new JSONObject(pack.readText(path));
                    JSONArray candles = root.optJSONArray("candles");
                    if (candles != null && candles.length() > 0) {
                        JSONObject last = candles.optJSONObject(candles.length() - 1);
                        Double close = last == null ? null : optNumber(last, "close");
                        if (close != null) {
                            info = new PriceInfo();
                            info.symbol = symbol;
                            info.price = close;
                            info.asOf = last.isNull("timestamp")
                                    ? null : last.optString("timestamp", null);
                            info.provenance = root.optJSONObject("provenance");
                        }
                    }
                } catch (Exception ignored) {
                    info = null;
                }
            }
            candlePrices.put(symbol, info);
            return info;
        }
    }

    private JSONObject dataState() {
        prices();
        JSONObject state = quoteRoot == null ? null : quoteRoot.optJSONObject("dataState");
        if (state != null) return state;
        return new J()
                .put("state", "eod")
                .put("stale", true)
                .put("total", 0)
                .put("counts", new J()
                        .put("live", 0).put("delayed", 0).put("eod", 0)
                        .put("stale", 0).put("unavailable", 0))
                .put("lastAsOf", JSONObject.NULL)
                .put("classification", "UNVERIFIED");
    }

    // ------------------------------------------------------------ trade plans

    public JSONObject plansResponse(String symbol) {
        synchronized (lock) {
            JSONArray rows = new JSONArray();
            String filter = symbol == null ? null : symbol.trim().toUpperCase(Locale.US);
            List<JSONObject> sorted = new ArrayList<>(plans);
            Collections.sort(sorted, new Comparator<JSONObject>() {
                @Override
                public int compare(JSONObject a, JSONObject b) {
                    int byCreated = b.optString("createdAt", "")
                            .compareTo(a.optString("createdAt", ""));
                    if (byCreated != 0) return byCreated;
                    return Long.compare(b.optLong("id", 0), a.optLong("id", 0));
                }
            });
            for (JSONObject plan : sorted) {
                if (filter != null && !filter.equals(plan.optString("symbol", ""))) continue;
                rows.put(J.copy(plan));
            }
            return new J().put("plans", rows);
        }
    }

    public JSONObject addPlan(JSONObject body) {
        synchronized (lock) {
            J plan = normalizePlan(body, null, true);
            plan.put("id", nextPlanId++);
            String now = Instant.now().toString();
            plan.put("createdAt", now);
            plan.put("updatedAt", now);
            plans.add(plan);
            savePlans();
            return new J().put("plan", J.copy(plan));
        }
    }

    public JSONObject updatePlan(long id, JSONObject body) {
        synchronized (lock) {
            JSONObject existing = findById(plans, id);
            if (existing == null) return null;
            J plan = normalizePlan(body, existing, false);
            String now = Instant.now().toString();
            plan.put("id", id);
            plan.put("createdAt", existing.optString("createdAt", now));
            plan.put("updatedAt", now);
            plans.set(plans.indexOf(existing), plan);
            savePlans();
            return new J().put("plan", J.copy(plan));
        }
    }

    public boolean removePlan(long id) {
        synchronized (lock) {
            boolean removed = removeById(plans, id);
            if (removed) savePlans();
            return removed;
        }
    }

    private J normalizePlan(JSONObject input, JSONObject existing, boolean create) {
        boolean touchesDerived = !create && (input.has("entry") || input.has("stop")
                || input.has("targets") || input.has("quantity"));
        String symbol = normalizeSymbol(input.has("symbol")
                ? String.valueOf(input.opt("symbol"))
                : existing == null ? "" : existing.optString("symbol", ""));
        String side = (input.has("side") ? String.valueOf(input.opt("side"))
                : existing == null ? "" : existing.optString("side", ""))
                .trim().toLowerCase(Locale.US);
        if (!side.equals("buy") && !side.equals("sell")) {
            throw new IllegalArgumentException("side must be buy or sell");
        }
        Double entry = input.has("entry") ? optNumber(input, "entry")
                : existing == null ? null : optNumber(existing, "entry");
        Double stop = input.has("stop") ? optNumber(input, "stop")
                : existing == null ? null : optNumber(existing, "stop");
        if (entry == null || entry <= 0) {
            throw new IllegalArgumentException("entry must be a finite positive price");
        }
        if (stop == null || stop <= 0) {
            throw new IllegalArgumentException("stop must be a finite positive price");
        }

        JSONArray targets;
        if (input.has("targets")) {
            targets = input.optJSONArray("targets");
        } else {
            targets = existing == null ? null : existing.optJSONArray("targets");
        }
        if (targets == null) {
            throw new IllegalArgumentException("targets must be an array of prices");
        }
        if (targets.length() < 1 || targets.length() > 3) {
            throw new IllegalArgumentException("targets must contain 1 to 3 prices");
        }
        JSONArray cleanTargets = new JSONArray();
        double firstTarget = 0;
        for (int index = 0; index < targets.length(); index += 1) {
            double target;
            try {
                target = Double.parseDouble(String.valueOf(targets.get(index)));
            } catch (Exception error) {
                throw new IllegalArgumentException("each target must be a finite positive price");
            }
            if (!Double.isFinite(target) || target <= 0) {
                throw new IllegalArgumentException("each target must be a finite positive price");
            }
            if (index == 0) firstTarget = target;
            cleanTargets.put(Double.valueOf(target));
        }
        Double quantity = input.has("quantity") ? optNumber(input, "quantity")
                : existing == null ? null : optNumber(existing, "quantity");
        if (quantity == null || quantity <= 0 || quantity != Math.rint(quantity)) {
            throw new IllegalArgumentException("quantity must be a positive integer");
        }
        if (side.equals("buy")) {
            if (!(stop < entry)) {
                throw new IllegalArgumentException("buy stop must be below entry");
            }
            for (int index = 0; index < cleanTargets.length(); index += 1) {
                if (!(entry < cleanTargets.optDouble(index))) {
                    throw new IllegalArgumentException("buy targets must be above entry");
                }
            }
        } else {
            if (!(stop > entry)) {
                throw new IllegalArgumentException("sell stop must be above entry");
            }
            for (int index = 0; index < cleanTargets.length(); index += 1) {
                if (!(entry > cleanTargets.optDouble(index))) {
                    throw new IllegalArgumentException("sell targets must be below entry");
                }
            }
        }

        double risk = Math.abs(entry - stop);
        Double riskAmount;
        if (input.has("riskAmount")) {
            riskAmount = optNumber(input, "riskAmount");
        } else if (create || touchesDerived) {
            riskAmount = risk * quantity;
        } else {
            riskAmount = optNumber(existing, "riskAmount");
        }
        if (riskAmount == null) riskAmount = risk * quantity;
        if (riskAmount < 0) {
            throw new IllegalArgumentException("riskAmount must be a finite number >= 0");
        }

        Double riskPercent;
        if (input.has("riskPercent")) {
            riskPercent = optNumber(input, "riskPercent");
        } else if (create || touchesDerived) {
            riskPercent = (risk / entry) * 100;
        } else {
            riskPercent = optNumber(existing, "riskPercent");
        }
        if (riskPercent == null) riskPercent = (risk / entry) * 100;
        if (riskPercent < 0) {
            throw new IllegalArgumentException("riskPercent must be a finite number >= 0");
        }

        double reward = Math.abs(firstTarget - entry);
        Double rewardRisk;
        if (input.has("rewardRisk")) {
            rewardRisk = optNumber(input, "rewardRisk");
        } else if (create || touchesDerived) {
            rewardRisk = reward / risk;
        } else {
            rewardRisk = optNumber(existing, "rewardRisk");
        }
        if (rewardRisk == null) rewardRisk = reward / risk;
        if (rewardRisk < 0) {
            throw new IllegalArgumentException("rewardRisk must be a finite number >= 0");
        }

        Double fees = input.has("fees") ? optNumber(input, "fees")
                : existing == null ? null : optNumber(existing, "fees");
        if (fees == null) fees = 0d;
        if (fees < 0) {
            throw new IllegalArgumentException("fees must be a finite number >= 0");
        }

        String notes;
        if (input.has("notes")) {
            notes = optionalText(input, "notes");
        } else {
            notes = existing == null ? null : optionalText(existing, "notes");
        }

        J plan = new J();
        plan.put("symbol", symbol);
        plan.put("side", side);
        plan.put("entry", entry);
        plan.put("stop", stop);
        plan.put("targets", cleanTargets);
        plan.put("quantity", (long) (double) quantity);
        plan.put("riskAmount", round(riskAmount, 2));
        plan.put("riskPercent", round(riskPercent, 4));
        plan.put("rewardRisk", round(rewardRisk, 4));
        plan.put("fees", round(fees, 2));
        plan.put("notes", notes == null ? JSONObject.NULL : notes);
        return plan;
    }

    // --------------------------------------------------------------- journal

    public JSONObject journalResponse(String symbol, String from, String to) {
        synchronized (lock) {
            String filter = symbol == null ? null : symbol.trim().toUpperCase(Locale.US);
            List<JSONObject> sorted = new ArrayList<>(journal);
            Collections.sort(sorted, new Comparator<JSONObject>() {
                @Override
                public int compare(JSONObject a, JSONObject b) {
                    int byOpened = b.optString("openedAt", "")
                            .compareTo(a.optString("openedAt", ""));
                    if (byOpened != 0) return byOpened;
                    return Long.compare(b.optLong("id", 0), a.optLong("id", 0));
                }
            });
            JSONArray rows = new JSONArray();
            for (JSONObject entry : sorted) {
                if (filter != null && !filter.equals(entry.optString("symbol", ""))) continue;
                String opened = entry.optString("openedAt", "");
                if (from != null && (opened.length() < 10 || opened.substring(0, 10).compareTo(from) < 0)) {
                    continue;
                }
                if (to != null && (opened.length() < 10 || opened.substring(0, 10).compareTo(to) > 0)) {
                    continue;
                }
                rows.put(publicJournal(entry));
            }
            return new J().put("entries", rows);
        }
    }

    private JSONObject publicJournal(JSONObject entry) {
        JSONObject copy = J.copy(entry);
        copy.remove("snapshotMime");
        return copy;
    }

    public JSONObject addJournalEntry(JSONObject body) {
        synchronized (lock) {
            long id = nextJournalId++;
            J entry = normalizeJournal(body, null, true, id);
            entry.put("id", id);
            String now = Instant.now().toString();
            entry.put("createdAt", now);
            entry.put("updatedAt", now);
            journal.add(entry);
            saveJournal();
            return new J().put("entry", publicJournal(entry));
        }
    }

    public JSONObject updateJournalEntry(long id, JSONObject body) {
        synchronized (lock) {
            JSONObject existing = findById(journal, id);
            if (existing == null) return null;
            J entry = normalizeJournal(body, existing, false, id);
            entry.put("id", id);
            entry.put("createdAt", existing.optString("createdAt", Instant.now().toString()));
            entry.put("updatedAt", Instant.now().toString());
            journal.set(journal.indexOf(existing), entry);
            saveJournal();
            return new J().put("entry", publicJournal(entry));
        }
    }

    public boolean removeJournalEntry(long id) {
        synchronized (lock) {
            JSONObject existing = findById(journal, id);
            if (existing == null) return false;
            journal.remove(existing);
            deleteSnapshot(id);
            saveJournal();
            return true;
        }
    }

    private J normalizeJournal(
            JSONObject input,
            JSONObject existing,
            boolean create,
            long id
    ) {
        String symbol = normalizeSymbol(input.has("symbol")
                ? String.valueOf(input.opt("symbol"))
                : existing == null ? "" : existing.optString("symbol", ""));
        String side = (input.has("side") ? String.valueOf(input.opt("side"))
                : existing == null ? "" : existing.optString("side", ""))
                .trim().toLowerCase(Locale.US);
        if (!side.equals("buy") && !side.equals("sell")) {
            throw new IllegalArgumentException("side must be buy or sell");
        }
        Long planId = null;
        if (input.has("planId") && !input.isNull("planId")) {
            Double value = optNumber(input, "planId");
            if (value == null || value < 1 || value != Math.rint(value)) {
                throw new IllegalArgumentException("planId must be a positive integer");
            }
            planId = value.longValue();
        } else if (!create && existing != null && !existing.isNull("planId")) {
            planId = existing.optLong("planId");
        }

        Double plannedEntry = mergeNumber(input, existing, "plannedEntry");
        Double plannedStop = mergeNumber(input, existing, "plannedStop");
        Double plannedTarget = mergeNumber(input, existing, "plannedTarget");
        Double actualEntry = mergeNumber(input, existing, "actualEntry");
        Double actualExit = mergeNumber(input, existing, "actualExit");
        Double quantity = mergeNumber(input, existing, "quantity");
        Double fees = mergeNumber(input, existing, "fees");
        if (fees == null) fees = 0d;
        if (fees < 0) throw new IllegalArgumentException("fees must be zero or positive");
        if (quantity != null && quantity < 1e-9) {
            throw new IllegalArgumentException("quantity must be positive");
        }

        Double pnl = null;
        if (actualExit != null) {
            if (input.has("pnl") && !input.isNull("pnl")) {
                pnl = optNumber(input, "pnl");
            }
            if (pnl == null) pnl = computeJournalPnl(side, actualEntry, actualExit, quantity, fees);
            if (pnl != null) pnl = round(pnl, 2);
        }

        String openedAt;
        if (input.has("openedAt") && !input.isNull("openedAt")) {
            openedAt = String.valueOf(input.opt("openedAt")).trim();
        } else if (create || !input.has("openedAt")) {
            openedAt = existing == null
                    ? Instant.now().toString() : existing.optString("openedAt", Instant.now().toString());
        } else {
            openedAt = Instant.now().toString();
        }
        if (!isDateText(openedAt)) {
            throw new IllegalArgumentException("openedAt must be YYYY-MM-DD or an ISO timestamp");
        }
        String closedAt = null;
        if (input.has("closedAt") && !input.isNull("closedAt")) {
            closedAt = String.valueOf(input.opt("closedAt")).trim();
            if (!isDateText(closedAt)) {
                throw new IllegalArgumentException("closedAt must be YYYY-MM-DD or an ISO timestamp");
            }
        } else if (!create && existing != null && !input.has("closedAt")) {
            closedAt = existing.isNull("closedAt") ? null : existing.optString("closedAt", null);
        }

        JSONArray tags = new JSONArray();
        if (input.has("tags") && !input.isNull("tags")) {
            JSONArray raw = input.optJSONArray("tags");
            if (raw == null) throw new IllegalArgumentException("tags must be an array of strings");
            for (int index = 0; index < raw.length(); index += 1) {
                String tag = String.valueOf(raw.opt(index)).trim();
                if (!tag.isEmpty()) tags.put(tag);
            }
        } else if (!create && existing != null && existing.optJSONArray("tags") != null) {
            tags = existing.optJSONArray("tags");
        }

        Object snapshot = JSONObject.NULL;
        if (input.has("snapshot")) {
            snapshot = input.opt("snapshot");
        } else if (!create && existing != null) {
            snapshot = existing.opt("snapshot");
        }

        boolean hasSnapshot = !create && existing != null && existing.optBoolean("hasSnapshot", false);
        String snapshotMime = !create && existing != null && !existing.isNull("snapshotMime")
                ? existing.optString("snapshotMime", null) : null;
        if (input.has("snapshotImage")) {
            if (input.isNull("snapshotImage")) {
                deleteSnapshot(id);
                hasSnapshot = false;
                snapshotMime = null;
            } else {
                String dataUrl = String.valueOf(input.opt("snapshotImage"));
                String[] decoded = validateSnapshotImage(dataUrl);
                snapshotMime = decoded[0];
                writeSnapshot(id, decoded[0], decoded[1]);
                hasSnapshot = true;
            }
        }

        J entry = new J();
        entry.put("planId", planId == null ? JSONObject.NULL : planId);
        entry.put("symbol", symbol);
        entry.put("side", side);
        entry.put("paper", input.has("paper") ? input.optBoolean("paper", false)
                : existing != null && existing.optBoolean("paper", false));
        entry.put("plannedEntry", plannedEntry == null ? JSONObject.NULL : plannedEntry);
        entry.put("plannedStop", plannedStop == null ? JSONObject.NULL : plannedStop);
        entry.put("plannedTarget", plannedTarget == null ? JSONObject.NULL : plannedTarget);
        entry.put("actualEntry", actualEntry == null ? JSONObject.NULL : actualEntry);
        entry.put("actualExit", actualExit == null ? JSONObject.NULL : actualExit);
        entry.put("quantity", quantity == null ? JSONObject.NULL : quantity);
        entry.put("fees", fees);
        entry.put("pnl", pnl == null ? JSONObject.NULL : pnl);
        entry.put("reason", nullableText(input, existing, "reason"));
        entry.put("mistakes", nullableText(input, existing, "mistakes"));
        entry.put("tags", tags);
        entry.put("snapshot", snapshot);
        entry.put("hasSnapshot", hasSnapshot);
        if (snapshotMime != null) entry.put("snapshotMime", snapshotMime);
        entry.put("openedAt", openedAt);
        entry.put("closedAt", closedAt == null ? JSONObject.NULL : closedAt);
        return entry;
    }

    private static Double computeJournalPnl(
            String side,
            Double actualEntry,
            Double actualExit,
            Double quantity,
            double fees
    ) {
        if (actualEntry == null || actualExit == null || quantity == null) return null;
        double gross = side.equals("buy")
                ? (actualExit - actualEntry) * quantity
                : (actualEntry - actualExit) * quantity;
        return round(gross - fees, 2);
    }

    private Double mergeNumber(JSONObject input, JSONObject existing, String key) {
        if (input.has(key)) return optNumber(input, key);
        return existing == null ? null : optNumber(existing, key);
    }

    private String nullableText(JSONObject input, JSONObject existing, String key) {
        if (input.has(key)) return optionalText(input, key);
        return existing == null ? null : optionalText(existing, key);
    }

    private String[] validateSnapshotImage(String value) {
        java.util.regex.Matcher matcher = Pattern.compile(
                "^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$")
                .matcher(value);
        if (!matcher.matches()) {
            throw new IllegalArgumentException(
                    "snapshotImage must be a base64 data URL of type image/png, image/jpeg or image/webp");
        }
        String mime = matcher.group(1);
        byte[] bytes;
        try {
            bytes = android.util.Base64.decode(matcher.group(2), android.util.Base64.DEFAULT);
        } catch (Exception error) {
            throw new IllegalArgumentException("snapshotImage is not valid base64");
        }
        if (bytes.length > 1.5 * 1024 * 1024) {
            throw new IllegalArgumentException("snapshotImage is larger than 1.5 MB after decoding");
        }
        return new String[]{mime, new String(bytes, StandardCharsets.ISO_8859_1)};
    }

    private void writeSnapshot(long id, String mime, String latin1) {
        String extension = mime.endsWith("jpeg") ? "jpg" : mime.endsWith("webp") ? "webp" : "png";
        File file = new File(snapshotDir, id + "." + extension);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(latin1.getBytes(StandardCharsets.ISO_8859_1));
        } catch (IOException error) {
            throw new IllegalStateException("could not store the chart snapshot");
        }
        // Remove a snapshot with a different extension from an earlier edit.
        File[] candidates = snapshotDir.listFiles();
        if (candidates != null) {
            for (File candidate : candidates) {
                String name = candidate.getName();
                if (name.startsWith(id + ".") && !name.equals(file.getName())) {
                    //noinspection ResultOfMethodCallIgnored
                    candidate.delete();
                }
            }
        }
    }

    private void deleteSnapshot(long id) {
        File[] candidates = snapshotDir.listFiles();
        if (candidates == null) return;
        for (File candidate : candidates) {
            if (candidate.getName().startsWith(id + ".")) {
                //noinspection ResultOfMethodCallIgnored
                candidate.delete();
            }
        }
    }

    public Snapshot snapshot(long id) {
        synchronized (lock) {
            File[] candidates = snapshotDir.listFiles();
            if (candidates == null) return null;
            for (File candidate : candidates) {
                if (!candidate.getName().startsWith(id + ".")) continue;
                try {
                    String mime = candidate.getName().endsWith(".jpg")
                            ? "image/jpeg" : candidate.getName().endsWith(".webp")
                            ? "image/webp" : "image/png";
                    byte[] bytes = Files.readAllBytes(candidate.toPath());
                    return new Snapshot(mime, bytes);
                } catch (IOException ignored) {
                    return null;
                }
            }
            return null;
        }
    }

    public static final class Snapshot {
        public final String mime;
        public final byte[] bytes;

        Snapshot(String mime, byte[] bytes) {
            this.mime = mime;
            this.bytes = bytes;
        }
    }

    // -------------------------------------------------------- corporate ledger

    public JSONObject ledgerResponse(String symbol) {
        synchronized (lock) {
            String filter = symbol == null ? null : symbol.trim().toUpperCase(Locale.US);
            List<JSONObject> sorted = new ArrayList<>(ledger);
            Collections.sort(sorted, new Comparator<JSONObject>() {
                @Override
                public int compare(JSONObject a, JSONObject b) {
                    int byDate = sortDate(a).compareTo(sortDate(b));
                    if (byDate != 0) return byDate;
                    return Long.compare(a.optLong("id", 0), b.optLong("id", 0));
                }
            });
            JSONArray entries = new JSONArray();
            for (JSONObject entry : sorted) {
                if (filter != null && !filter.equals(entry.optString("symbol", ""))) continue;
                entries.put(J.copy(entry));
            }
            return new J().put("entries", entries);
        }
    }

    private static String sortDate(JSONObject row) {
        if (!row.isNull("exDate")) {
            return row.optString("exDate", "");
        }
        return row.optString("createdAt", "");
    }

    public JSONObject addLedgerEntry(JSONObject body) {
        String symbol = normalizeSymbol(body.has("symbol")
                ? String.valueOf(body.opt("symbol")) : "");
        String kind = text(body, "kind").toLowerCase(Locale.US);
        if (!kind.equals("dividend") && !kind.equals("bonus")
                && !kind.equals("right") && !kind.equals("other")) {
            throw new IllegalArgumentException("kind must be dividend, bonus, right or other");
        }
        String exDate = null;
        if (body.has("exDate") && !body.isNull("exDate")) {
            exDate = String.valueOf(body.opt("exDate")).trim();
            if (!isDateText(exDate)) {
                throw new IllegalArgumentException("exDate must be YYYY-MM-DD or an ISO timestamp");
            }
        }
        Double amount = optNumber(body, "amount");
        if (amount != null && amount < 0) {
            throw new IllegalArgumentException("amount must be a finite number >= 0");
        }
        Double shares = optNumber(body, "shares");
        if (shares != null && shares < 0) {
            throw new IllegalArgumentException("shares must be a finite number >= 0");
        }
        synchronized (lock) {
            J entry = new J();
            entry.put("id", nextLedgerId++);
            entry.put("symbol", symbol);
            entry.put("kind", kind);
            entry.put("exDate", exDate == null ? JSONObject.NULL : exDate);
            entry.put("amount", amount == null ? JSONObject.NULL : amount);
            entry.put("shares", shares == null ? JSONObject.NULL : shares);
            entry.put("notes", optionalText(body, "notes") == null
                    ? JSONObject.NULL : optionalText(body, "notes"));
            entry.put("createdAt", Instant.now().toString());
            ledger.add(entry);
            saveLedger();
            return new J().put("entry", J.copy(entry));
        }
    }

    public boolean removeLedgerEntry(long id) {
        synchronized (lock) {
            boolean removed = removeById(ledger, id);
            if (removed) saveLedger();
            return removed;
        }
    }

    // -------------------------------------------------------- reconciliation

    public JSONObject importReconciliation(String source, String csv) {
        if (source == null || source.trim().isEmpty()) {
            throw new IllegalArgumentException("source is required");
        }
        if (csv == null || csv.trim().isEmpty()) {
            throw new IllegalArgumentException("csv is required");
        }
        String cleanSource = source.trim();
        List<String[]> rows = parseCsvRows(csv);
        if (rows.isEmpty()) {
            throw new IllegalArgumentException("csv has no header row");
        }
        String[] header = rows.get(0);
        for (int index = 0; index < header.length; index += 1) {
            header[index] = header[index].trim();
        }
        synchronized (lock) {
            Set<String> knownExternalIds = new HashSet<>();
            for (JSONObject transaction : transactions) {
                if (!transaction.isNull("externalId")) {
                    knownExternalIds.add(transaction.optString("externalId", ""));
                }
            }
            int imported = 0;
            int skipped = 0;
            int rowCount = 0;
            for (int rowIndex = 1; rowIndex < rows.size(); rowIndex += 1) {
                String[] row = rows.get(rowIndex);
                if (row.length == 1 && row[0].trim().isEmpty()) continue;
                Map<String, String> record = new HashMap<>();
                for (int column = 0; column < header.length; column += 1) {
                    if (!header[column].isEmpty()) {
                        record.put(header[column], column < row.length ? row[column] : "");
                    }
                }
                int line = rowIndex + 1;
                String symbol = value(record, "symbol").trim().toUpperCase(Locale.US);
                if (symbol.isEmpty()) throw new IllegalArgumentException("row " + line + ": symbol is required");
                if (!SYMBOL.matcher(symbol).matches()) {
                    throw new IllegalArgumentException("row " + line + ": invalid symbol");
                }
                String side = value(record, "side").trim().toLowerCase(Locale.US);
                if (!side.equals("buy") && !side.equals("sell")) {
                    throw new IllegalArgumentException("row " + line + ": side must be buy or sell");
                }
                Double quantity = parseNumber(value(record, "quantity"));
                if (quantity == null || quantity <= 0) {
                    throw new IllegalArgumentException("row " + line + ": quantity must be positive");
                }
                String rawPrice = value(record, "price");
                if (rawPrice.trim().isEmpty()) {
                    throw new IllegalArgumentException("row " + line + ": price is required");
                }
                Double price = parseNumber(rawPrice);
                if (price == null || price < 0) {
                    throw new IllegalArgumentException("row " + line + ": price must be zero or positive");
                }
                String tradedAt = firstValue(record, "traded_at", "tradedAt").trim();
                if (!tradedAt.matches("^\\d{4}-\\d{2}-\\d{2}.*")) {
                    throw new IllegalArgumentException("row " + line + ": traded_at must start with YYYY-MM-DD");
                }
                String rawFees = value(record, "fees");
                Double fees = rawFees.trim().isEmpty() ? 0d : parseNumber(rawFees);
                if (fees == null || fees < 0) {
                    throw new IllegalArgumentException("row " + line + ": fees must be zero or positive");
                }
                String externalId = optional(firstValue(record, "external_id", "externalId"));
                String kind = optional(value(record, "kind"));
                String notes = optional(value(record, "notes"));
                rowCount += 1;
                if (externalId != null) {
                    if (knownExternalIds.contains(externalId)) {
                        skipped += 1;
                        continue;
                    }
                    knownExternalIds.add(externalId);
                }
                newTransaction(symbol, side, quantity, price, fees, tradedAt, notes,
                        cleanSource, externalId, kind == null ? "trade" : kind);
                imported += 1;
            }
            long importId = nextImportId++;
            J record = new J();
            record.put("id", importId);
            record.put("source", cleanSource);
            record.put("importedAt", Instant.now().toString());
            record.put("rowsCount", rowCount);
            record.put("imported", imported);
            record.put("skipped", skipped);
            reconciliationImports.add(record);
            saveTransactions();
            saveImports();
            return new J()
                    .put("imported", imported)
                    .put("skipped", skipped)
                    .put("importId", importId);
        }
    }

    public JSONObject reconciliationTransactions() {
        synchronized (lock) {
            JSONArray rows = new JSONArray();
            for (JSONObject transaction : transactions) {
                rows.put(J.copy(transaction));
            }
            return new J().put("transactions", rows);
        }
    }

    public JSONObject reconciliationSummary() {
        synchronized (lock) {
            PortfolioResult portfolio = computePortfolio();
            JSONObject totals = portfolio.totals;
            double totalMarketValue = totals.optDouble("marketValue", 0);

            List<Flow> flows = new ArrayList<>();
            for (JSONObject transaction : transactions) {
                double quantity = transaction.optDouble("quantity", 0);
                double price = transaction.optDouble("price", 0);
                double fees = transaction.optDouble("fees", 0);
                double gross = quantity * price;
                double amount = "buy".equals(transaction.optString("side", ""))
                        ? -(gross + fees) : gross - fees;
                flows.add(new Flow(transaction.optString("tradedAt", "").substring(0,
                        Math.min(10, transaction.optString("tradedAt", "").length())), amount));
            }

            double dividends = 0;
            double bonusShares = 0;
            double rightsShares = 0;
            String today = nptDate();
            for (JSONObject entry : ledger) {
                String kind = entry.optString("kind", "");
                if (kind.equals("dividend")) {
                    String date = (!entry.isNull("exDate") ? entry.optString("exDate", "")
                            : entry.optString("createdAt", ""));
                    date = date.length() >= 10 ? date.substring(0, 10) : date;
                    if (date.compareTo(today) <= 0) {
                        Double amount = optNumber(entry, "amount");
                        dividends += amount == null ? 0 : amount;
                        if (amount != null) flows.add(new Flow(date, amount));
                    }
                } else if (kind.equals("bonus")) {
                    Double shares = optNumber(entry, "shares");
                    bonusShares += shares == null ? 0 : shares;
                } else if (kind.equals("right")) {
                    Double shares = optNumber(entry, "shares");
                    rightsShares += shares == null ? 0 : shares;
                }
            }
            if (totalMarketValue > 0) {
                flows.add(new Flow(today, totalMarketValue));
            }

            JSONArray exposure = new JSONArray();
            JSONArray priced = portfolio.positions;
            List<double[]> values = new ArrayList<>();
            List<String> symbols = new ArrayList<>();
            for (int index = 0; index < priced.length(); index += 1) {
                JSONObject position = priced.optJSONObject(index);
                if (position == null) continue;
                double quantity = position.optDouble("quantity", 0);
                if (!(quantity > 0)) continue;
                if (position.isNull("marketValue")) continue;
                double value = position.optDouble("marketValue", 0);
                if (!(value > 0)) continue;
                symbols.add(position.optString("symbol", ""));
                values.add(new double[]{value,
                        totalMarketValue > 0 ? (value / totalMarketValue) * 100 : 0});
            }
            List<Integer> order = new ArrayList<>();
            for (int index = 0; index < values.size(); index += 1) order.add(index);
            Collections.sort(order, new Comparator<Integer>() {
                @Override
                public int compare(Integer a, Integer b) {
                    int byValue = Double.compare(values.get(b)[0], values.get(a)[0]);
                    if (byValue != 0) return byValue;
                    return symbols.get(a).compareTo(symbols.get(b));
                }
            });
            for (int index : order) {
                J row = new J();
                row.put("symbol", symbols.get(index));
                row.put("marketValue", values.get(index)[0]);
                row.put("percent", round(values.get(index)[1], 4));
                exposure.put(row);
            }
            String topSymbol = null;
            double topPercent = 0;
            if (order.size() > 0) {
                int first = order.get(0);
                topSymbol = symbols.get(first);
                topPercent = round(values.get(first)[1], 4);
            }
            double hhi = 0;
            if (totalMarketValue > 0) {
                for (double[] value : values) {
                    double share = value[0] / totalMarketValue;
                    hhi += share * share;
                }
            }

            JSONArray importRows = new JSONArray();
            List<JSONObject> sortedImports = new ArrayList<>(reconciliationImports);
            Collections.sort(sortedImports, new Comparator<JSONObject>() {
                @Override
                public int compare(JSONObject a, JSONObject b) {
                    int byDate = b.optString("importedAt", "")
                            .compareTo(a.optString("importedAt", ""));
                    if (byDate != 0) return byDate;
                    return Long.compare(b.optLong("id", 0), a.optLong("id", 0));
                }
            });
            for (JSONObject record : sortedImports) {
                J row = new J();
                row.put("id", record.optLong("id", 0));
                row.put("source", record.optString("source", ""));
                row.put("importedAt", record.optString("importedAt", ""));
                row.put("rowsCount", record.optLong("rowsCount", 0));
                importRows.put(row);
            }

            J concentration = new J();
            concentration.put("topSymbol", topSymbol == null ? JSONObject.NULL : topSymbol);
            concentration.put("topPercent", topPercent);
            concentration.put("hhi", round(hhi, 4));

            Double rate = Xirr.solve(flows);
            J response = new J();
            response.put("realizedPnl", totals.optDouble("realizedPnl", 0));
            response.put("unrealizedPnl", totals.optDouble("unrealizedPnl", 0));
            response.put("totalPnl", totals.optDouble("totalPnl", 0));
            response.put("xirr", rate == null ? JSONObject.NULL : rate);
            response.put("dividends", round(dividends, 2));
            response.put("bonusShares", round(bonusShares, 4));
            response.put("rightsShares", round(rightsShares, 4));
            response.put("exposure", exposure);
            response.put("concentration", concentration);
            response.put("imports", importRows);
            return response;
        }
    }

    public static final class Flow {
        public final String date;
        public final double amount;

        Flow(String date, double amount) {
            this.date = date;
            this.amount = amount;
        }
    }

    // ------------------------------------------------------------------ utils

    private static boolean removeById(List<JSONObject> rows, long id) {
        for (int index = 0; index < rows.size(); index += 1) {
            if (rows.get(index).optLong("id", -1) == id) {
                rows.remove(index);
                return true;
            }
        }
        return false;
    }

    private static JSONObject findById(List<JSONObject> rows, long id) {
        for (JSONObject row : rows) {
            if (row.optLong("id", -1) == id) return row;
        }
        return null;
    }

    private static String normalizeSymbol(String raw) {
        String symbol = raw == null ? "" : raw.trim().toUpperCase(Locale.US);
        if (!SYMBOL.matcher(symbol).matches()) {
            throw new IllegalArgumentException("invalid symbol");
        }
        return symbol;
    }

    private static String text(JSONObject body, String key) {
        Object value = body.opt(key);
        return value == null || value == JSONObject.NULL ? "" : String.valueOf(value);
    }

    private static String optionalText(JSONObject body, String key) {
        if (!body.has(key) || body.isNull(key)) return null;
        String value = String.valueOf(body.opt(key)).trim();
        return value.isEmpty() ? null : value;
    }

    private static Double optNumber(JSONObject body, String key) {
        if (body == null || !body.has(key) || body.isNull(key)) return null;
        try {
            double value = Double.parseDouble(String.valueOf(body.opt(key)));
            return Double.isFinite(value) ? value : null;
        } catch (Exception error) {
            return null;
        }
    }

    private static Double parseNumber(String raw) {
        if (raw == null || raw.trim().isEmpty()) return null;
        try {
            double value = Double.parseDouble(raw.trim());
            return Double.isFinite(value) ? value : null;
        } catch (Exception error) {
            return null;
        }
    }

    private static String value(Map<String, String> record, String key) {
        String value = record.get(key);
        return value == null ? "" : value;
    }

    private static String firstValue(Map<String, String> record, String... keys) {
        for (String key : keys) {
            if (record.containsKey(key)) return value(record, key);
        }
        return "";
    }

    private static String optional(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static boolean isDateText(String value) {
        if (value == null || !DATE.matcher(value).matches()) return false;
        try {
            LocalDate.parse(value.substring(0, 10));
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    static String nptDate() {
        return LocalDate.now(ZoneOffset.ofHoursMinutes(5, 45)).toString();
    }

    static double round(double value, int decimals) {
        double factor = Math.pow(10, decimals);
        return Math.round(value * factor) / factor;
    }

    static String formatNumber(double value) {
        if (value == Math.rint(value)) return String.valueOf((long) value);
        return String.valueOf(round(value, 4));
    }

    /** RFC 4180 CSV reader, matching the API's parser. */
    static List<String[]> parseCsvRows(String input) {
        String text = input.startsWith("﻿") ? input.substring(1) : input;
        List<String[]> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        boolean fieldStart = true;
        for (int index = 0; index < text.length(); index += 1) {
            char ch = text.charAt(index);
            if (quoted) {
                if (ch == '"') {
                    if (index + 1 < text.length() && text.charAt(index + 1) == '"') {
                        field.append('"');
                        index += 1;
                    } else {
                        quoted = false;
                    }
                } else {
                    field.append(ch);
                }
                continue;
            }
            if (ch == '"' && fieldStart) {
                quoted = true;
                fieldStart = false;
                continue;
            }
            if (ch == ',') {
                row.add(field.toString());
                field.setLength(0);
                fieldStart = true;
                continue;
            }
            if (ch == '\n' || ch == '\r') {
                if (ch == '\r' && index + 1 < text.length() && text.charAt(index + 1) == '\n') {
                    index += 1;
                }
                row.add(field.toString());
                rows.add(row.toArray(new String[0]));
                row = new ArrayList<>();
                field.setLength(0);
                fieldStart = true;
                continue;
            }
            field.append(ch);
            fieldStart = false;
        }
        if (!fieldStart || field.length() > 0 || !row.isEmpty()) {
            row.add(field.toString());
            rows.add(row.toArray(new String[0]));
        }
        return rows;
    }

    /** Compound-interest solver for the reconciliation XIRR figure. */
    static final class Xirr {
        private static final double MIN_RATE = -0.9999;
        private static final double MAX_RATE = 10;
        private static final double NEWTON_TOLERANCE = 1e-9;
        private static final double NPV_TOLERANCE = 1e-7;
        private static final int NEWTON_ITERATIONS = 100;
        private static final int BISECTION_ITERATIONS = 300;

        static Double solve(List<Flow> input) {
            if (input.size() < 2) return null;
            List<double[]> dated = new ArrayList<>();
            boolean positive = false;
            boolean negative = false;
            for (Flow flow : input) {
                if (!Double.isFinite(flow.amount) || flow.amount == 0) continue;
                Double day = dayNumber(flow.date);
                if (day == null) return null;
                dated.add(new double[]{flow.amount, day});
                if (flow.amount > 0) positive = true;
                else negative = true;
            }
            if (dated.size() < 2 || !positive || !negative) return null;
            double base = dated.get(0)[1];
            for (double[] row : dated) base = Math.min(base, row[1]);
            List<double[]> normalized = new ArrayList<>();
            for (double[] row : dated) {
                normalized.add(new double[]{row[0], row[1] - base});
            }
            Double newton = newton(normalized, 0.1);
            return newton != null ? newton : bisection(normalized);
        }

        private static Double dayNumber(String value) {
            if (value == null) return null;
            String text = value.trim();
            if (text.length() < 10) return null;
            text = text.substring(0, 10);
            try {
                return (double) LocalDate.parse(text).toEpochDay();
            } catch (Exception error) {
                return null;
            }
        }

        private static double npv(List<double[]> flows, double rate) {
            double base = 1 + rate;
            double total = 0;
            for (double[] flow : flows) {
                total += flow[0] / Math.pow(base, flow[1] / 365d);
            }
            return total;
        }

        private static double derivative(List<double[]> flows, double rate) {
            double base = 1 + rate;
            double total = 0;
            for (double[] flow : flows) {
                total -= ((flow[1] / 365d) * flow[0])
                        / Math.pow(base, flow[1] / 365d + 1);
            }
            return total;
        }

        private static Double newton(List<double[]> flows, double guess) {
            double rate = guess;
            for (int iteration = 0; iteration < NEWTON_ITERATIONS; iteration += 1) {
                double value = npv(flows, rate);
                double slope = derivative(flows, rate);
                if (!Double.isFinite(value) || !Double.isFinite(slope) || slope == 0) {
                    return null;
                }
                double next = rate - value / slope;
                if (!Double.isFinite(next) || next <= MIN_RATE || next > MAX_RATE) {
                    return null;
                }
                if (Math.abs(next - rate) < NEWTON_TOLERANCE) {
                    return Math.abs(npv(flows, next)) < NPV_TOLERANCE ? next : null;
                }
                rate = next;
            }
            return Math.abs(npv(flows, rate)) < NPV_TOLERANCE ? rate : null;
        }

        private static Double bisection(List<double[]> flows) {
            double low = MIN_RATE;
            double high = MAX_RATE;
            double lowValue = npv(flows, low);
            double highValue = npv(flows, high);
            if (!Double.isFinite(lowValue) || !Double.isFinite(highValue)) return null;
            if (lowValue == 0) return low;
            if (highValue == 0) return high;
            if (lowValue * highValue > 0) return null;
            for (int iteration = 0; iteration < BISECTION_ITERATIONS; iteration += 1) {
                double mid = (low + high) / 2;
                double midValue = npv(flows, mid);
                if (!Double.isFinite(midValue)) return null;
                if (Math.abs(midValue) < NPV_TOLERANCE || high - low < 1e-12) {
                    return mid;
                }
                if (lowValue * midValue <= 0) {
                    high = mid;
                } else {
                    low = mid;
                    lowValue = midValue;
                }
            }
            return (low + high) / 2;
        }
    }
}

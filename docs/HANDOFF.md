# NEPSE Terminal — Handoff

Date: **2026-11-05**
Branch: `claude/dreamy-pasteur-k6l5hi`
Canonical references: this file, [FREE_EDITION.md](./FREE_EDITION.md), and
[DATA_SOURCES.md](./DATA_SOURCES.md). [IMPLEMENTATION_AUDIT.md](./IMPLEMENTATION_AUDIT.md)
is a historical record.

---

## 1. Data decision (please read first)

**We are not going to use official live data from NEPSE or from an MDA
(market-data) feed.** No licensed vendor, no live or intraday endpoint, and no
unofficial NEPSE API wrapper ship in this product.

**Prices come only from unofficial, public end-of-day data.** Today that is the
MIT-licensed community archive `binayabaral/nepal-market-data`, fetched
explicitly with `pnpm personal:update`, validated row by row, and stored
locally with provenance. Every row is `UNVERIFIED`, every price is an
end-of-day close, and the app says so on every screen.

**Everything else is mathematics on those closes.** Indicators, returns, risk,
candlestick patterns, breadth, sector heat, correlation and signal tallies are
computed locally from the stored OHLCV series and labelled **derived**. The
pure functions live in `packages/analytics/src/quant.ts` and are unit-tested.

### What the mathematics may and may not do

| Allowed (derived from stored EOD candles) | Not allowed (would be fabricated data) |
|---|---|
| SMA/EMA, RSI, MACD, Bollinger, stochastic, ATR | Live or intraday prices |
| Calendar returns (1W…5Y, YTD), volatility, drawdown, VaR | Floorsheet / broker flows |
| Beta and correlation vs NEPSE on common dates only | Fundamentals, EPS, P/E, book value |
| Candlestick patterns from each session's OHLC | Corporate actions, dividends, bonus/rights |
| Advance/decline breadth, % above SMA 200 | Official sector sub-indices (need cap weights) |
| Equal-weighted sector averages, labelled as such | Market transactions/scrips totals |
| Pivot levels, 52-week position, seasonality | NEPSE index share volume |

Rule of thumb: a derived number must be reproducible from rows we actually
store, and the UI must say it is derived. If an answer needs a dataset the
source does not publish, the dataset stays **unavailable** — it is never
mocked, interpolated, or "inferred".

One correction to earlier notes: the archive's NEPSE index file **does**
publish market-wide turnover (`traded_amount`). The Market page now shows it as
"Market turnover · unverified". Transactions and scrips totals are still not
published and stay unavailable.

---

## 2. What this branch changes

### Quant engine (`packages/analytics`)
- New `quant.ts`: Bollinger, MACD, ATR (Wilder), stochastic, log returns,
  sessions-per-year measured from the series (not an assumed 252),
  annualised volatility, max/current drawdown, beta and correlation on common
  dates, calendar period returns, monthly returns without bridging gaps,
  classic pivots, 20 candlestick patterns (doji family, hammer/hanging man,
  inverted hammer/shooting star, marubozu, spinning top, engulfing, harami,
  piercing/dark cloud, morning/evening star, three soldiers/crows), golden and
  death crosses, a transparent signal tally, and market/sector breadth.
- `screenCandles` rows now include 1M/3M/1Y returns, 3M volatility, ATR %,
  MACD state, 1Y max drawdown, 52-week position, recent cross, last-session
  patterns and the signal tally.
- 24 new analytics tests (9 → 33), see §5.

### UI (`apps/desktop`)
- New shell: icon sidebar (collapsible, `Ctrl B`), command palette
  (`Ctrl K` or `/`), `Alt 1–7` page shortcuts, an EOD session pill, a status
  bar, and a **"data is N days old" banner** with the exact update command.
  There is still no background fetch.
- Market: index KPI with sparkline, source-reported turnover, breadth bar,
  median change, % of active equities above SMA 200, index chart with period
  returns/volatility/drawdown, movers tabs (gainers/losers/turnover/volume) from
  the latest session only, derived sector heatmap, last-session candlestick
  signals, and a sortable market table.
- Company: chart with SMA/EMA/Bollinger overlays, volume/RSI/MACD panes,
  pattern markers and a crosshair legend; 52-week position, beta vs NEPSE,
  signal tally with every rule shown, pivot ladder, performance and risk,
  monthly seasonality heatmap, pattern history with what happened next, return
  distribution (skew, kurtosis, historical VaR), and sector peers.
- Screener: presets (uptrend, golden cross, oversold, near 52-week high, volume
  spike, MACD, bullish candle, low volatility), instrument/sector filters,
  **stale and delisted series hidden by default**, sortable columns, CSV export.
- Watchlist: sparklines, returns/risk/signal columns, correlation matrix.
- Portfolio: allocation bar with a concentration measure (1/Herfindahl).
- Companies: sortable, instrument/sector/status filters.
- Data: a dataset-availability table (stored vs merely implemented) and an
  "Updating the archive" panel.
- All market timestamps are shown in Nepal Time (15:00 NPT, not 09:15 UTC).

### Backend fixes (from the review below)
- Quotes are never labelled `live`: in the Free Edition every quote is EOD,
  and elsewhere only an explicit `session=live` gets the live window.
- The local API rejects a non-loopback `Host` (DNS rebinding), a foreign
  `Origin` on writes, and writes that are not `application/json` (cross-site
  form/text POSTs). The desktop shell and Vite dev server are unaffected.
- `body.index` on `/api/import/run` is validated (was a path-traversal risk).
- `/api/coverage` adds `datasets[]` with `implemented`, `available`,
  `session`, `classification` and `unavailableReason`, so capability can no
  longer be read as presence.
- RSI of a perfectly flat series is 50 (neutral), not 100 ("overbought").
- "52-week" high/low and window return use the trailing 365 calendar days, not
  the last 252 rows (an illiquid scrip's 252 rows can span a decade).

---

## 3. Code review findings

Severity is the reviewer's estimate. "Fixed" means fixed on this branch with a
test.

| # | Finding | Where | Severity | Status |
|---|---|---|---|---|
| H1 | `/api/coverage` reports provider capability as availability | `packages/api/src/app.ts` | High | **Fixed** (`datasets[]`) |
| H2 | A quote with no `session` can be labelled `live` | `app.ts` `quoteCapability` | High | **Fixed** |
| M6a | No Origin/Host/content-type check: any website can POST to `127.0.0.1:4310` (trades, watchlist, import) | `app.ts` | Medium | **Fixed** |
| M6b | `body.index` joined into a file path | `app.ts` → `csv-provider.ts` | Medium | **Fixed** |
| M5 | Flat series → RSI 100 / "overbought" | `analysis.ts` | Medium | **Fixed** |
| M4 | "52w" = last 252 rows, not 52 weeks | `analysis.ts` | Medium | **Fixed** |
| M1 | Old quotes linger after a scrip stops trading and can beat newer candles in portfolio valuation; `/api/quotes` mixes sessions | `sync.ts`, `store.ts`, `app.ts` portfolio | Medium | UI mitigated (movers/breadth use the latest session only); **store fix open** |
| M2 | Future-dated rows are accepted and never go stale (negative age clamps to 0) | `acquire.ts`, `freshness.ts` | Medium | Open |
| M3 | "Day change" can span several sessions after an excluded row or for illiquid scrips; the previous-close date is not exposed | `acquire.ts`, `app.ts` indices | Medium | Open (company page now shows "close D vs D-1") |
| L1 | Portfolio `totals.costBasis` includes unpriced positions but `marketValue` does not | `portfolio.ts` | Low | Open |
| L2 | Duplicate-date fallback: a date is marked seen before its row is validated | `acquire.ts` | Low | Open |
| L3 | Timestamp-string primary key can store two bars for one session from manual CSVs | `store.ts` | Low | Open (chart de-duplicates per day) |
| L4 | No pruning of rows the source retracts | `store.ts` | Low | Open — decide policy |
| L5 | Screener loads every series synchronously per request (~2.8 s on 486k candles) | `app.ts` screener | Low | Open — cache by data version |
| L6 | Electron: inherited `PERSONAL_DB`/`PERSONAL_DATA_DIR` override userData and aren't made absolute; provider and DB resolve paths differently | `electron/server.ts`, `factory.ts` | Low | Open — verify before packaging |
| L7 | Manifest records `--source-url` but the fetch can use the old origin | `acquire.ts` | Low | Open |
| L8 | `main.mjs` has no navigation / window-open guard | `electron/main.mjs` | Low | Open |
| P1 | Nothing in the API is labelled `DERIVED`; analysis/screener carry raw `UNVERIFIED` provenance | `app.ts` | Policy | UI labels derived panels; API flag open |
| P2 | NEPSE index volume stored as `0` rather than null | `acquire.ts` | Policy | Open (UI hides index volume) |
| P3 | `adjustmentFactor: 1` written for unadjusted rows | `acquire.ts` | Policy | Open |
| P4 | CSV provider invents sector "indices" when `indices.csv` is missing | `csv-provider.ts` | Policy | Open |

---

## 4. Verified data snapshot (fresh acquire in a clean environment)

| Item | Value |
|---|---|
| Source commit | `fded4eaec4dc51bff3d0f096d44cd84c7f48bc5f` (newer than the installed `6aa7198…`) |
| Latest session | **2026-11-04** (was 2026-11-03) |
| Securities | 468 (306 equity, 75 debenture, 47 mutual fund, 38 promoter share, 2 government bond; 447 listed, 21 merged) |
| Candles stored | 485,877 (479,219 equity + 6,658 NEPSE index) |
| EOD quotes | 278 |
| Excluded rows | 40,714 equity (40,701 OHLC invariant, 13 non-positive) + 70 index |
| Stale series (> 3-day window) | 107 of 468; active equities among them: CFL (2011), CMB (2019), KRBL (2024), BNL, NLO, WNLB (2026) |
| Unclassified equities | 31 (10 active: CFL, HRL, JHAPA, MKCL, NRIC, NRM, NTC, NWCL, PURE, TTL) |
| Index rows with turnover | 2,326 |

These come from a fresh `personal:update` into an empty directory, not from the
installed database at `~/.config/NEPSE Terminal`. Re-run the update there and
compare (P0-1 below).

---

## 5. Repository state on this branch

- `pnpm typecheck`: passes in all workspaces.
- `pnpm test`: passes — 87 tests across 14 files (was 62 across 13).
  analytics 9 → 33 (new `quant.test.ts`, plus flat-RSI and calendar-52-week
  cases), api 3 → 4 (guards, quote labelling, `datasets[]`), the rest
  unchanged.
- UI exercised against the real archive in Chromium: every page renders
  without console errors; palette, `Alt 1–7`, `Ctrl B`, chart toggles and tabs
  work.

---

## 6. Remaining work, prioritised

### P0 — finish the release
1. **Refresh the installed data** to `fded4ea…`:
   ```bash
   DATA_EDITION=free pnpm personal:update --force \
     --data-dir "$HOME/.config/NEPSE Terminal/data" \
     --db "$HOME/.config/NEPSE Terminal/personal.db"
   ```
   Verify commit, counts, latest session 2026-11-04, exclusion delta, no
   duplicate candles, `/api/indices` and `/api/quotes`.
2. **Rebuild and smoke-test the AppImage**
   (`pnpm --filter @stock/desktop electron:package`). Confirm it reads
   `~/.config/NEPSE Terminal`, and check L6 first.
3. **Choose an application licence** (owner decision) and add third-party
   notices for `binayabaral/nepal-market-data` (MIT), sharesansar.com and
   `Aabishkar2/nepse-data` (upstream), plus the manifest disclaimer.
4. **Release provenance**: optionally reword `bdb29f8 "first commit"`, tag
   `v0.1.0-free`, and record the data commit in the release notes.

### P1 — data integrity
5. Stale/inactive policy is now decided in the UI: stale and delisted series
   are hidden from the screener by default and labelled per row. Remaining:
   decide whether CFL/CMB/KRBL should be marked inactive in the master.
6. Sector mapping for the 10 active unclassified equities: map only from a
   cited source; otherwise keep `Unclassified` visible (current behaviour).
7. Persistent exclusion/errata log across refreshes (today only the latest
   `reports/excluded-rows.csv` exists).
8. ~~Document the `per_change` mismatch~~ — already in DATA_SOURCES.md.
9. ~~`/api/coverage` semantics~~ — fixed here.
10. Use `srijankarki07/nepse-data` only as a manual cross-check; its licence is
    unresolved, so never commit or redistribute it.
11. Fix M1–M3 in the store/acquire layer (lingering quotes, future dates,
    multi-session day change).

### P2 — engineering quality
12. Frontend tests: component tests for tables/badges/unavailable states and
    one Playwright smoke test (launch → market → company → chart → data page).
13. CI: GitHub Actions running `pnpm typecheck`, `pnpm test`, `pnpm build:web`.
14. Lint/format (ESLint + Prettier, or Biome), applied once.
15. ~~Update reminder~~ — banner and session pill added here; an OS-level
    scheduler stays opt-in.
16. Accessibility pass on the new UI (keyboard, focus, contrast in both themes).
17. Cache screener results by data version (L5).

### P3 — blocked by data availability or licensing (do not fake)
Live/intraday quotes · market transactions/scrips totals · official sector
sub-indices · floorsheet · fundamentals and statements · corporate actions,
dividends, bonus, rights · news · IPO/rights offerings · mutual-fund NAV ·
complete delisted history · NEPSE index share volume.

These are not code tasks. They stay unavailable and visibly labelled.

---

## 7. Constraints to preserve

- The Free Edition is permanently unofficial; `productionReady=false`.
- Free-source rows are `UNVERIFIED`; computed values are `DERIVED`.
- EOD data is never labelled live.
- Missing datasets stay `MISSING`/unavailable: no mock or inferred values.
- Never silently overwrite valid history or delete user data.
- Keep raw source snapshots.
- Keep attribution and disclaimers visible.
- The source repository's MIT licence does not license the underlying scraped
  NEPSE data. Treat it as unofficial and do not redistribute it.
- No aggressive scraping. Updates are explicit and rate-limit-conscious.

## 8. Highest-risk mistakes

1. Filling missing datasets with mock or "mathematically inferred" values to
   make a screen look complete. Mathematics derives from stored rows; it does
   not create rows.
2. Calling EOD quotes live, or implying real-time capability.
3. Deleting or "repairing" user data during a refresh.
4. Treating the source repository's MIT licence as a data licence.
5. Shipping the AppImage without testing the installed-data path.
6. Hiding stale series behind a green screener status.

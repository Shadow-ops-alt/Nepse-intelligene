# Free Edition and Licensed Edition

Date: **2026-11-04**
Decision: build the full product on free-source data first, with a licensed
provider as a drop-in replacement. This is a **product edition** decision, not
a relaxation of the licensed-data gate.

## Two editions, one codebase

| | Free Edition | Licensed Edition |
|---|---|---|
| Data source | Operator-supplied free/public files | Licensed vendor API/file extract |
| Runtime policy | `FREE_EDITION_POLICY` | `PRODUCTION_POLICY` |
| `sourceType` | `unofficial` | `licensed` |
| `productionReady` | `false` (always) | `true` after legal review |
| Terms | `unverified` | `verified` |
| UI badge | permanent “Free Edition / unofficial” strip | verified-source badge |
| Phase 0 gate | not a substitute for the gate | must pass before launch |
| Upgrade cost | n/a | new provider + new namespace |

Switching editions is a configuration change (`DATA_EDITION`), not a rewrite.
The licensed edition keeps the strict rule: unofficial data is never allowed in
licensed production.

## What the Free Edition ships

- Market overview: NEPSE index level and daily index history, 18 sub-indices,
  end-of-day gainers/losers/most active, breadth, % above SMA 200, a derived
  equal-weighted sector heatmap, and last-session candlestick signals. Market
  turnover, shares, transactions and scrip totals come from the latest public
  market summary when `personal:bulk` has run; otherwise they stay unavailable.
- Company profiles, displayed key ratios (EPS, P/E, book value, P/B, market
  cap), dividend/bonus/right history, the latest public floorsheet, broker
  flows derived from it, the IPO/issue pipeline, market news, and mutual-fund
  NAVs. Every one of these is marked unverified and carries its source URL,
  fetched-at time and freshness state.
- Dataset endpoints and a coverage page for floorsheet, broker flows,
  fundamentals, corporate actions, IPOs, news and mutual funds. Missing data
  stays unavailable; it is never synthesized.
- Company list and search, including 468 securities with their instrument type,
  sector (or explicit `Unclassified`), and listed/merged status.
- Daily price chart with volume.
- Offline indicators: SMA 20/50/200, EMA 20, RSI 14, MACD, Bollinger,
  stochastic, ATR, 52-week range (trailing 365 calendar days), calendar
  returns, volatility, drawdown, beta, pivots, candlestick patterns, monthly
  seasonality and return distribution.
- Watchlist stored locally in SQLite.
- Company master browser with symbol/name/sector filters.
- Global company search in the top bar (keyboard accessible).
- Data coverage page showing exactly which capabilities exist.
- Local sync from CSV files, with provenance on every row.
- Import wizard with a no-write preview, per-row validation, an import audit
  history, and a single-transaction commit that aborts on fatal errors.
- Provenance and staleness visible in the UI, including per-row state badges.
- Light (default) and dark themes, with an Auto mode that follows the OS.
- Quant screener over stored candles: presets, returns, RSI, MACD, trend,
  52-week position, volatility, drawdown, volume ratio, candlestick pattern and
  signal tally; stale and delisted series hidden by default; CSV export.
- Portfolio ledger with weighted-average cost basis, realised/unrealised P&L,
  and priced/unpriced honesty. If no quote exists, it falls back to the latest
  stored daily close and says so.
- In-app import wizard that checks the data directory, runs the sync, and
  reports per-file status.
- Packaged Electron shell that starts the local API and loads the same UI.

## Acquiring public data

The packaged app fetches public data in the background while it is open.
Normal use needs no manual import: on launch and every six hours the app
checks the public archive, imports any new end-of-day sessions, and keeps the
raw snapshot beside the data folder. Automatic updates run only while the app
is open; they stop when it closes and resume on the next launch. Every
imported row stays `UNVERIFIED`. The Data page shows the update status, the
last result and a **Check now** action, backed by `GET /api/refresh/status`
and `POST /api/refresh/run` on the local API.

Manual CSV import is an offline fallback only, for a machine that cannot reach
the public sources. The acquisition pipeline is conservative:

- record the exact source commit or URL, retrieval time, licence/terms status,
  and attribution;
- preserve the raw archive under `data/source/binayabaral/<commit>/` and every
  fetched web response as a content-addressed snapshot under `data/source/web/`;
- normalize only rows that pass the app's OHLC and date/symbol invariants and
  write every excluded row to a report;
- merge new rows without overwriting valid stored history; genuine
  disagreements are reported rather than silently resolved;
- import in the same provider namespace and report changed/removed history;
- leave the previous files and database intact when a fetch fails;
- space requests to public sites, retry transient failures with backoff, and
  cache responses within the configured age window;
- keep using the last downloaded archive, and say so, when the remote cannot be
  reached.

The developer and operator commands below run the same pipeline outside the
app. They are not needed for normal use:

```bash
DATA_EDITION=free pnpm personal:update \
  --data-dir "$HOME/.config/NEPSE Terminal/data" \
  --db "$HOME/.config/NEPSE Terminal/personal.db"

DATA_EDITION=free pnpm personal:details \
  --data-dir "$HOME/.config/NEPSE Terminal/data"

DATA_EDITION=free pnpm personal:bulk \
  --data-dir "$HOME/.config/NEPSE Terminal/data"
```

`pnpm personal:update` runs `personal:acquire` and `personal:bulk`, then
imports. `personal:details` is a separate, slower pass for per-company pages;
run `personal:sync` afterwards.

ShareSansar and Merolagani currently supply profiles, key ratios, corporate
actions, market summary, sub-indices, current-day prices and floorsheet, news,
the IPO pipeline, and mutual-fund NAVs. SEBON pages are used only as a
reference. Redistribution rights remain unverified.

See [DATA_SOURCES.md](./DATA_SOURCES.md) for the verified coverage, rejected
sources, and limitations.

## Desktop shell

The Electron shell runs the API in a child process using Electron's bundled
Node runtime, waits for `/api/health`, then loads the local URL. User data lives
under Electron's `userData` directory unless `PERSONAL_DB` /
`PERSONAL_DATA_DIR` override it.

```bash
pnpm desktop            # build web + server bundle, launch Electron
pnpm desktop:package    # electron-builder AppImage/NSIS/DMG
```

Linux output: `apps/desktop/release/NEPSE Terminal-<version>.AppImage`. The
browser build remains available with `pnpm dev` and `pnpm start`.

## Interface and themes

The renderer is a dense research terminal: an icon sidebar (collapsible with
`Ctrl B`), a command palette (`Ctrl K` or `/`) over the local company master,
`Alt 1–7` page shortcuts, an end-of-day session pill, and a status bar that
always says "End-of-day · not a live feed". Tables are sortable and use
tabular numbers; charts use lightweight-charts with indicator overlays and
study panes.

- **Light**, **Dark** and **Auto** (follows `prefers-color-scheme`).
- The choice is stored in `localStorage` and applied before the first paint, so
  the window never flashes the wrong palette.
- Status is always text plus colour; colour alone never carries meaning (every
  change has an arrow glyph, every state a text badge).
- Market timestamps are shown in Nepal Time (an EOD close reads 15:00 NPT).
- When the newest stored session is more than four days old, a banner says the
  archive is behind and points at the Data page. If automatic updates are
  enabled it also shows the next check time; nothing needs to be run by hand.

### Derived analytics

All analytics are mathematics on the stored end-of-day candles
(`packages/analytics/src/quant.ts`) and are labelled **derived** in the UI:
moving averages, RSI, MACD, Bollinger, stochastic, ATR, calendar returns,
annualised volatility (sessions per year measured from each series), drawdown,
beta/correlation against NEPSE on common dates only, candlestick patterns,
pivots, seasonality, return distribution, breadth and an equal-weighted sector
heatmap. They never stand in for a dataset the source does not publish. See
[HANDOFF.md](./HANDOFF.md) for the allowed/not-allowed table.

Every price-bearing view shows an `as of` timestamp and a data-state badge
(`Live`, `Delayed`, `EOD`, `Stale`, `Unavailable`) plus a classification badge
when the data is not `VERIFIED`. The same rule applies to the market overview,
company pages, company list, screener, portfolio valuations, watchlist, and the
data page.

## Data states and classification

Every stored record is classified as one of `VERIFIED`, `UNVERIFIED`,
`DERIVED`, `DEMO`, or `MISSING`, and given a freshness state derived from the
capability's maximum age:

| State | Meaning |
|---|---|
| `live` | Within the live window for that capability |
| `delayed` | Older than live, still inside the delay window |
| `eod` | End-of-day data, current for its trading date |
| `stale` | Older than the capability's freshness window |
| `unavailable` | No record exists |

Free-source rows are permanently `UNVERIFIED`; index lists and sector lists
derived from the company master are `DERIVED`. Missing data is `MISSING` and is
never replaced with an invented value. A stale price is still shown, but it is
labelled and excluded from any claim of a current valuation.

The store-level state in the header is computed from the newest stored market
timestamp, not from the time of the last import. Importing an old file cannot
make old data look current.

## Import, audit, and backup

The import pipeline is deliberately conservative:

1. **Preview** (`GET /api/import/preview`) validates files and reports counts,
   warnings, and possible trading-day gaps without writing anything.
2. **Run** (`POST /api/import/run`) re-reads and validates, then writes in one
   transaction. A fatal validation error aborts before any write.
3. **Audit** (`GET /api/import/history`) records each run with status, files,
   counts, warnings, and failed symbols.
4. **Backup** uses SQLite `VACUUM INTO`, so it is consistent while the app is
   open:

```bash
pnpm personal:backup --out backup.db
pnpm personal:restore --from backup.db --force
```

The store applies schema migrations on open and exposes the schema version.
Demo or mock rows are rejected at the `PersonalStore` boundary, so they can
never enter the product database.

## Live market (unofficial, on by default)

Since 2026-11-14 the Free Edition shows unofficial live LTP, market summary,
NEPSE index and market depth from nepalstock.com's internal endpoints, using
the token method of the MIT-licensed `nepseman-api` package. Since 2026-11-24
it falls back to the public ShareSansar live-trading table when those endpoints
are blocked; market depth and intraday remain nepalstock-only. This is a product
owner decision; NEPSE has not authorised it and may block it. The service:

- polls only while a client asks: every 10 s while the market is open, at most
  every 5 minutes otherwise, with single-flight requests and backoff;
- keeps TLS verification on and ships `nepse.wasm` next to the Electron server;
- labels every value `LIVE · unofficial` and never writes it to the
  end-of-day store, so charts, signals and history stay archive-based;
- is disabled with `NEPSE_LIVE=0`; the licensed edition enables it only when
  unofficial data is explicitly allowed.

## What it deliberately cannot do

These are gated by capability, not hidden behind empty arrays:

- Verified multi-year fundamentals history and audited valuation screens. The
  public pages expose only the latest displayed ratios and selected periods.
- Historical floorsheet and broker-flow analytics. Only the latest public
  trading day is available from the free pages.
- Corporate-action-adjusted returns.
- A guaranteed delisted/suspended history. The public archive happens to carry
  21 merged symbols, which are imported and marked `delisted`, but there is no
  complete delisting record; backtests can still be survivorship-biased.
- Historical intraday prices (live prices are available unofficially, see above).
- Mutual-fund portfolio holdings (published as PDFs only).
- Redistribution rights for the scraped public pages.

If a paid provider later supplies these, the same UI can enable them without a
data-layer rewrite.

## Legal and quality posture

The Free Edition is a **local, single-user product**. It ships no vendor data,
no reverse-engineered session flow, no authentication bypass and no WASM token
generator. It does contain acquisition helpers for public HTML pages and JSON
endpoints, which the packaged app runs automatically while it is open.

- The operator supplies the files, or lets the app fetch the public pages
  automatically, and is responsible for the right to use the resulting data.
- The public pages' terms and redistribution rights are unverified. Treat the
  output as research input, not as a redistributable dataset.
- Do not redistribute raw market data or a database that contains it.
- Free sources can be wrong, partial, revised, or withdrawn.
- `productionReady=false` is deliberate and permanent for this edition.
- Derived analytics are research output, not investment advice.

The application contains explicit acquisition helpers for public HTML/JSON
pages, but no reverse-engineered session flow, no WASM token generator, no
authentication bypass and no bundled vendor data. The researched unofficial
NEPSE wrapper has no licence grant and relies on an undocumented access path; it
is not part of this repository and must not be shipped without written
permission. If you have a source whose terms allow use, implement it as a
provider adapter; the product does not need to change.

## Configuration

Free Edition:

```bash
NODE_ENV=production
DATA_EDITION=free
PERSONAL_DATA_DIR=./data/personal
PERSONAL_DB=./data/personal.db
# Automatic updates are on by default in the packaged app. Set 0 to disable.
NEPSE_AUTO_REFRESH=1
# Minutes between successful checks (default 360, minimum 15).
NEPSE_AUTO_REFRESH_INTERVAL_MINUTES=360
# Delay before the first check after startup, in milliseconds (default 8000).
NEPSE_AUTO_REFRESH_INITIAL_DELAY_MS=8000
# Include the slow profile and fundamentals pass (default off).
NEPSE_AUTO_DETAILS=0
```

Licensed Edition:

```bash
NODE_ENV=production
DATA_EDITION=licensed
LICENSED_BASE_URL=https://vendor.example/api
LICENSED_API_KEY=...
LICENSED_ATTESTED=true
LICENSED_TERMS_URL=https://vendor.example/terms
LICENSED_LICENSE="Commercial redistribution + derived analytics"
```

`policyFromEnv()` maps `DATA_EDITION=free` to `FREE_EDITION_POLICY`. Omitting it
keeps the strict licensed policy.

## Architecture

```
apps/desktop        React renderer (Vite); Electron shell later
packages/api        Local HTTP API over the store and provider registry
packages/store      SQLite, provenance on every row, provider-namespaced keys
packages/providers  free-source, manual CSV, licensed REST, command, mock
packages/analytics  Pure offline indicators
packages/personal   Import/sync CLI used by the Free Edition
packages/validation Phase 0 gate, unchanged
```

## Product honesty rules

1. Never show a price without its source and timestamp.
2. Never claim `productionReady` for unofficial data.
3. Never silently fill a missing capability with an empty table.
4. Never mix free and licensed rows in one series.
5. Flag unadjusted prices next to long-window indicators.
6. Keep the Free Edition strip visible; do not hide the data quality.
7. If `market-summary.csv` is missing, daily market totals are reported as
   unavailable. They are never synthesised from quotes or another file. The
   NEPSE index level may still be shown from genuine `indices/NEPSE.csv`
   history, which is a separate dataset and is labelled end-of-day.

## Upgrade path

1. Implement/configure the licensed provider (`RestProvider` already exists).
2. Register it with a new `id` and real terms metadata.
3. Sync into its own namespace; existing free history is untouched.
4. Compare on the overlap window using the trial protocol.
5. Flip `DATA_EDITION` and provider priority.
6. Re-run `pnpm phase0:validate --provider licensed --env production`.

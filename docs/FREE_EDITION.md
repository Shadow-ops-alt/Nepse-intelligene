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

- Market overview: NEPSE index level and daily index history, end-of-day
  gainers/losers/most active, breadth, % above SMA 200, a derived
  equal-weighted sector heatmap, and last-session candlestick signals. Market
  turnover is shown when the archive's index file reports it (unverified);
  shares/transactions/scrips totals stay unavailable unless a genuine
  `market-summary.csv` is supplied.
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

## Acquiring the public archive

The Free Edition ships no market data and does not fetch in the background. An
operator can explicitly fetch the MIT-licensed public archive and import it:

```bash
DATA_EDITION=free pnpm personal:update \
  --data-dir "$HOME/.config/NEPSE Terminal/data" \
  --db "$HOME/.config/NEPSE Terminal/personal.db"
```

`pnpm personal:acquire` fetches and normalizes only. The command:

- records the exact source commit, retrieval time, licence, and attribution;
- preserves the raw archive under `data/source/binayabaral/<commit>/`;
- normalizes only rows that pass the app's OHLC invariants and writes every
  excluded row to `reports/excluded-rows.csv`;
- writes no `market-summary.csv`, `sector-performance.csv`, floorsheet, or
  fundamentals file when the source does not publish those fields;
- imports in the same provider namespace and reports changed/removed history;
- leaves the previous files and database intact when a fetch fails.

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
- When the newest stored session is more than four days old, a banner shows the
  exact `personal:update` command. Nothing is fetched in the background.

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

## What it deliberately cannot do

These are gated by capability, not hidden behind empty arrays:

- Five-year fundamentals history and valuation screens.
- Historical floorsheet and broker-flow analytics.
- Corporate-action-adjusted returns.
- A guaranteed delisted/suspended history. The public archive happens to carry
  21 merged symbols, which are imported and marked `delisted`, but there is no
  complete delisting record; backtests can still be survivorship-biased.
- Historical intraday.
- News and filings unless the operator supplies a legitimate file.

If a paid provider later supplies these, the same UI can enable them without a
data-layer rewrite.

## Legal and quality posture

The Free Edition is a **local, single-user product**. It does not bundle a
scraper, a reverse-engineered session flow, a WASM token generator, or vendor
data.

- The operator supplies the files, or explicitly runs the public-archive
  command, and is responsible for the right to use the resulting data.
- Do not redistribute raw market data or a database that contains it.
- Free sources can be wrong, partial, revised, or withdrawn.
- `productionReady=false` is deliberate and permanent for this edition.
- Derived analytics are research output, not investment advice.

The application itself does not bundle a scraper, a reverse-engineered session
flow, a WASM token generator, or vendor data. The researched unofficial NEPSE
wrapper has no licence grant and relies on an undocumented access path; it is
not part of this repository and must not be shipped without written permission.
If you have a source whose terms allow use, implement it as a provider adapter;
the product does not need to change.

## Configuration

Free Edition:

```bash
NODE_ENV=production
DATA_EDITION=free
PERSONAL_DATA_DIR=./data/personal
PERSONAL_DB=./data/personal.db
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

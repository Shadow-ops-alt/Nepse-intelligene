# Free-Source Data Path

This is the data path used by the shipped **Free Edition**. It is a single-user,
local workflow: operator-supplied files in, local SQLite out. It keeps the
licensed provider as a drop-in replacement, so a later upgrade is a provider
change rather than a rewrite.

The licensed edition and its Phase 0 gate are unchanged. The Free Edition is a
separate product edition, not a substitute for a licensed data agreement. See
[FREE_EDITION.md](FREE_EDITION.md).

## What it is

- A first-class `MarketDataProvider` implementation (`free-source`) that reads
  the same CSV layout as `CsvProvider`.
- Permanently labelled `sourceType=unofficial`, `termsStatus=unverified`,
  `productionReady=false`, `reliability=low`.
- Allowed in production only when `DATA_EDITION=free` selects
  `FREE_EDITION_POLICY`. The licensed policy still blocks it.
- Offline after import: charts, indicators, screener, watchlist, and portfolio
  read the local store without a network call.
- Acquisition helpers for public pages: the desktop app runs them in the
  background on launch and every six hours while it is open. `personal:details`
  reads company profiles and key ratios from ShareSansar and Merolagani, and
  `personal:bulk` reads the public market summary, sub-indices, current-day
  prices and floorsheet, news, the IPO pipeline, and mutual-fund NAVs. Both
  write canonical CSV and raw source snapshots; they never write the database
  directly. The operator can also run them by hand from the commands below.

## What it is not

- **Not** a licensed feed or an official NEPSE product. The helper commands
  read public web pages whose terms and redistribution rights are unverified.
  You supply the files or run the helpers; you are responsible for your right
  to use and redistribute the result.
- **Not** a complete history. Only the latest public floorsheet day, the latest
  displayed key ratios, and the displayed corporate-action history are
  available. Missing values are reported, never filled.
- **Not** a licensed data feed. Prices may be partial, revised, or unadjusted.
- **Not** redistributable as a dataset. Do not publish a database containing
  unofficial data.
- **Not** a source of corporate-action adjustment. Free price files generally
  omit adjustment factors, so long-window returns are flagged.
- **Not** investment advice.

## Hard rules

1. `DATA_EDITION=free` is required to run this provider in production.
   `ALLOW_UNOFFICIAL_DATA=true` remains an explicit development opt-in.
2. The licensed edition (`DATA_EDITION` unset or `licensed`) never accepts this
   provider in production.
3. Every stored market row carries the provider id and provenance. Primary keys
   include `provider_id`, so free and licensed series cannot overwrite or blend.
4. The UI and analytics read only from `@stock/core` contracts and the local
   store, never from a concrete provider.
5. No source mixing in one series. A licensed sync creates a new namespace.
6. `productionReady=false` is permanent for this edition.

## Supported capabilities

The default capability set covers what the public sources actually publish:

| Capability | Free-source realism |
|---|---|
| `companyList`, `securityList` | Good, including public profile fields when fetched |
| `sectors`, `indices` | Good |
| `dailyOhlc` | Good where a public daily series exists |
| `indexHistory` | Good; one insurance sub-index has no rows |
| `liveQuotes`, `marketSummary`, `sectorPerformance` | Snapshot only; current-day end-of-day values, not a tick feed |
| `floorsheet` | Latest trading day only; contract-level rows |
| `brokerFlows` | Derived from the stored floorsheet only |
| `fundamentals`, `fundamentalsHistory` | Latest displayed key ratios and the periods the public page shows; not audited statements |
| `corporateActions` | Dividend, bonus and right history as displayed; no price adjustment |
| `ipos` | ShareSansar upcoming/past issue list |
| `news` | Latest market-wide headlines with links to the publisher |
| `intradayOhlc` history | **Excluded** — no free historical intraday source |
| `mutualFundHoldings` | **Excluded** — only published as PDFs |
| delisted securities | **Excluded** |

You can narrow the file-backed capability set with `PERSONAL_CAPABILITIES`,
for example:

```bash
PERSONAL_CAPABILITIES=companyList,dailyOhlc,fundamentals,corporateActions
```

Changing the capability list does not change the provenance: the data stays
unofficial.

## Data layout

Use `data/personal/` with the format documented in
[MANUAL_DATA.md](MANUAL_DATA.md). Minimum for a useful run:

```
data/personal/
  companies.csv
  ohlc/<SYMBOL>.csv
  indices/<INDEX>.csv        optional
  quotes.csv                 optional
  market-summary.csv         optional (summary shown as unavailable if absent)
  sector-performance.csv     optional
  fundamentals/<SYMBOL>.csv  optional (company ratios and mutual-fund NAVs)
  corporate-actions.csv      optional
  floorsheet/<DATE>.csv      optional
  news.csv                   optional
  ipos.csv                   optional
  source/                    raw source snapshots and fetch manifest
```

`data/personal/` and `data/*.db` are git-ignored. Never commit vendor data or
raw source snapshots.

A missing `market-summary.csv` does not produce a synthetic index. The summary
is reported unavailable, and the rest of the market page still works.

## Commands

Normal use needs no manual import. The packaged desktop app checks the public
archive on launch and every six hours while it is open, imports new end-of-day
sessions, and keeps the raw snapshots. Manual CSV import is an offline fallback
only. The commands below are the developer and operator interface to the same
pipeline.

```bash
cp .env.example .env
# In .env: DATA_EDITION=free

# Fetch the public archive and the public web datasets, then import everything.
pnpm personal:update \
  --data-dir ./data/personal \
  --db ./data/personal.db \
  --from 1990-01-01 \
  --to 2026-11-14

# Optional: fetch company profiles, key ratios and corporate actions.
pnpm personal:details --data-dir ./data/personal

# Optional: refresh only the public web datasets.
pnpm personal:bulk --data-dir ./data/personal

# Import whatever is on disk without fetching.
pnpm personal:sync \
  --data-dir ./data/personal \
  --db ./data/personal.db \
  --from 2021-11-04 \
  --to 2026-11-14

pnpm personal:status
pnpm personal:candles NABIL --limit 20
pnpm personal:analyze NABIL
```

`personal:update` runs the archive import and `personal:bulk`; run
`personal:details` afterwards and then `personal:sync` to import the profiles
and corporate actions. `personal:details` is the slow step: it spaces requests
to the public sites and can take 10–25 minutes for all active equities.

The packaged app performs the same pipeline automatically, so the client never
runs these commands. A failed web pass never stops the archive import, and a
failed details pass never fails the refresh. If the remote archive cannot be
checked, the app keeps using the last downloaded copy and reports that it is
using cached data until the next successful check.

The same import is available in the UI's **Data → Import wizard**, including a
file checklist, a preview that writes nothing, and the import history.

The import is validated and atomic:

- Every file is checked row by row before any write. The error names the file,
  row, column, value, and reason.
- A fatal validation error aborts the whole run; nothing is written.
- A valid run is written in a single transaction, so a crash cannot leave half
  an import behind.
- A per-symbol problem is reported and skipped rather than silently dropped.
- Each run is recorded in `import_audit` (status, files, counts, warnings,
  failed symbols) and `sync_runs`.

The sync is per-symbol resilient: a missing OHLC file is reported and skipped
instead of aborting the run. Possible missing trading days are reported as gap
candidates; no holiday calendar is assumed and no row is filled.

Back up and restore the local database with:

```bash
pnpm personal:backup --out backup.db
pnpm personal:restore --from backup.db --force
```

You can still run the Phase 0 harness against this provider:

```bash
pnpm phase0:validate --provider personal --allow-unofficial
```

Expect capability-coverage failures for intraday history, mutual-fund holdings
and delisted securities. That is correct: this data path cannot satisfy the
licensed Release 1 gate, and the stored floorsheet/fundamentals coverage is not
equivalent to a licensed history.

## Local storage

`@stock/store` uses Node's built-in `node:sqlite` (no native build step).
Tables: `companies`, `candles`, `quotes`, `snapshots`, `sync_runs`,
`watchlist`, `portfolio_transactions`, `import_audit`.

The schema is migrated on open (versions 1–3) and `getSchemaVersion()` reports
the current version for diagnostics. Demo and mock rows are rejected at the
store boundary.

Provenance is duplicated onto every market row:

```sql
SELECT provider_id, kind, symbol, COUNT(*) AS n,
       source_type, terms_status, production_ready
FROM candles
GROUP BY provider_id, kind, symbol;
```

Inspect it directly:

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); \
const db=new DatabaseSync('./data/personal.db'); \
console.log(db.prepare('SELECT provider_id,source_type,terms_status,production_ready,COUNT(*) n FROM candles GROUP BY 1,2,3,4').all())"
```

The portfolio ledger is local-only and never leaves the machine. It is not
tagged with a provider namespace, because it is operator input rather than
market data.

## Upgrade path to a paid provider

The upgrade is a new factory branch and a new namespace, not a rewrite.

1. **Keep the interface.** Business logic and the UI stay on
   `MarketDataProvider`, `MarketDataService`, and the local API.
2. **Implement or configure the licensed provider.** `RestProvider` already
   exists for the standard `{ data, asOf, warnings }` JSON contract.
3. **Register it with a new `id`** (for example `licensed-vendor-x`) and the
   real `termsStatus`, `productionReady`, and `priority`.
4. **Sync into its own namespace.** The store keys everything by `provider_id`,
   so the free history remains separate and auditable.
5. **Compare on the overlap.** Run the trial protocol for the shared window and
   record differences before switching.
6. **Flip the default provider and `DATA_EDITION`.** Keep `free-source` at
   lower priority or remove it; no analytics code changes.
7. **Re-run Phase 0.** A licensed provider must pass
   `pnpm phase0:validate --provider licensed --env production`.

Because `sourceType` and `productionReady` live in the descriptor, the UI can
show a persistent provenance badge without knowing which vendor is active.

## Exit criteria: leaving the free edition

The licensed edition is ready when all of these are true:

- A provider supplies the mandatory Release 1 datasets with **written** usage
  and redistribution rights.
- The provider passes the Phase 0 gate for the agreed history window.
- Corporate-action adjustment factors and a corrections/errata path exist.
- Legal review confirms the product may distribute derived analytics.
- The licensed namespace has been synced and compared on the overlap window.

Until then, keep `docs/PHASE0_FINDINGS.md`'s verdict at **NO-GO** for licensed
production.

## Known limitations

- Free sources can change, break, or disappear without notice.
- Published files may be partial, revised, or inconsistent across symbols.
- No reliable correction feed; re-sync replaces rows for the same
  `(provider, kind, symbol, timeframe, timestamp)` key.
- Derived indicators inherit every input error.
- Portfolio P&L excludes dividends, bonus shares, and other corporate actions.
- Nothing here is investment advice.

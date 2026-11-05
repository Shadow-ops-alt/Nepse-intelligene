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

## What it is not

- **Not** a scraper. The repository ships no vendor data and no scraping code.
  You supply the files; you are responsible for your right to use them.
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

The default capability set is deliberately narrow:

| Capability | Free-source realism |
|---|---|
| `companyList`, `securityList` | Good, if you maintain the list |
| `sectors`, `indices` | Good |
| `dailyOhlc` | Good where a public daily series exists |
| `indexHistory` | Good |
| `liveQuotes`, `marketSummary`, `sectorPerformance` | Snapshot only; not a reliable tick feed |
| `floorsheet` | **Excluded** — needs history and corrections |
| `fundamentalsHistory` | **Excluded** — five-year statements are a licensed decision |
| `corporateActions` / adjustment factors | **Excluded** — required for honest total returns |
| `intradayOhlc` history | **Excluded** |
| delisted securities | **Excluded** |

You can opt into extra file-backed capabilities with `PERSONAL_CAPABILITIES`,
for example:

```bash
PERSONAL_CAPABILITIES=companyList,dailyOhlc,fundamentals,corporateActions
```

Opting in does not change the provenance: the data stays unofficial.

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
```

`data/personal/` and `data/*.db` are git-ignored. Never commit vendor data.

A missing `market-summary.csv` does not produce a synthetic index. The summary
is reported unavailable, and the rest of the market page still works.

## Commands

```bash
cp .env.example .env
# In .env: DATA_EDITION=free

pnpm personal:sync \
  --data-dir ./data/personal \
  --db ./data/personal.db \
  --from 2021-11-04 \
  --to 2026-11-03

pnpm personal:status
pnpm personal:candles NABIL --limit 20
pnpm personal:analyze NABIL
```

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

Expect capability-coverage failures for floorsheet and fundamentals history.
That is correct: this data path cannot satisfy the licensed Release 1 gate.

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

# Architecture

## Non-negotiables

1. Business logic and UI depend on `MarketDataProvider` only. No concrete
   provider, scraper, vendor SDK, or vendor field name may leak upward.
2. Every payload carries provenance: provider, source type, terms status,
   production readiness, reliability, fetch time, `asOf`, age, and staleness.
3. Unofficial data can never be marked `productionReady`. The **Licensed
   Edition** blocks it in production. The **Free Edition** is a separate,
   explicitly labelled edition with its own policy (`FREE_EDITION_POLICY`).
4. A licensed provider is replaced by registering another implementation of the
   same interface. No business logic or React component changes.
5. Phase 0 data validation must pass before the **Licensed Edition** ships. The
   Free Edition is a different product decision and never claims to satisfy the
   licensed-data gate.

## Layers

```
apps/desktop                 Electron main + React/Vite renderer + local API child
        │
        ▼
packages/api                 local HTTP API for the renderer
        │
        ▼
packages/core                contracts, policy, registry, service, metadata
        │
        ├── packages/providers   mock | manual CSV | free-source | licensed REST | command
        ├── packages/store       provenance-aware local SQLite cache
        ├── packages/analytics   pure offline indicators, screener, portfolio P&L
        ├── packages/personal    free-source import/sync CLI + automatic refresh pipeline
        └── packages/validation  Phase 0 checks, reports, CLI
```

### `@stock/core`

- `contracts/common.ts` — capability, source, terms, reliability, metadata,
  descriptor, request options, date range.
- `contracts/domain.ts` — company, security, candle, quote, summary,
  floorsheet, broker flow, fundamentals, corporate action, IPO, news, health.
- `provider.ts` — the `MarketDataProvider` interface and capability→method map.
- `base-provider.ts` — explicit `UnsupportedCapabilityError` for methods a
  provider does not implement. No silent empty arrays.
- `registry.ts` — registration, duplicate protection, capability-method
  verification, priority ordering, policy-filtered lookup.
- `policy.ts` — development/test/production rules. Production requires verified
  terms and production readiness, and always rejects unofficial/mock sources.
- `service.ts` — the only entry point for business logic. Selects providers by
  capability and priority, enforces policy, normalizes metadata, tracks health,
  and falls back to the next provider.
- `freshness.ts` — age/staleness calculation and provenance enforcement.

### `@stock/providers`

- `MockProvider` — deterministic synthetic data for tests and UI development.
- `CsvProvider` — operator-supplied manual data. It is `productionReady` only
  when the operator explicitly attests that the data is licensed.
- `PersonalFreeProvider` — the Free Edition adapter for locally supplied
  free/public files. It is permanently `sourceType=unofficial`,
  `termsStatus=unverified`, `productionReady=false`, and declares only the
  capabilities free sources can realistically support. It runs in production
  only when `DATA_EDITION=free`. See [FREE_EDITION.md](FREE_EDITION.md).
- `RestProvider` — generic HTTP/JSON adapter for a licensed vendor. The vendor
  contract is deliberately boring: `{ data, asOf?, warnings? }` per endpoint.
- `CommandProvider` — development/validation bridge to an external command. It
  defaults to `sourceType=unofficial`, `termsStatus=unverified`,
  `productionReady=false`, so production policy always blocks it.

No scraper, WASM token generator, or unlicensed dataset is stored in this
repository. An operator who is permitted to use an external tool can point
`CommandProvider` at it locally.

### `@stock/validation`

Runs a fixed set of data checks against one provider and writes a Markdown +
JSON report. It is intentionally separate from the app so it can run in CI and
during vendor evaluation.

### `@stock/api`, `@stock/store`, `@stock/analytics`, `@stock/desktop`

- `@stock/store` persists companies, candles, quotes, snapshots, sync runs,
  watchlists, and the portfolio ledger. Every market row carries a provider
  namespace and provenance; free and licensed rows cannot blend.
- `@stock/analytics` is pure and offline. It computes SMA/EMA/RSI, 52-week
  ranges, screener rollups, and weighted-average portfolio P&L. It never calls
  a provider and never writes to the store.
- `@stock/api` is a small `node:http` server bound to `127.0.0.1`. Endpoints:
  `/api/health`, `/api/meta`, `/api/coverage`, `/api/companies`, `/api/quotes`,
  `/api/summary`, `/api/candles`, `/api/analysis`, `/api/screener`,
  `/api/portfolio`, `/api/portfolio/transactions`, `/api/watchlist`,
  `/api/import/status`, `/api/import/preview`, `/api/import/history`,
  `/api/import/run`, `/api/refresh/status`, and `/api/refresh/run`. It also
  serves the built renderer.
- `@stock/desktop` is the React/Vite renderer plus the Electron shell. Electron
  starts a bundled copy of the API in a child process, waits for `/api/health`,
  then loads the local URL. No renderer code imports Node or SQLite directly.

## Request flow

```
UI / business logic
    → MarketDataService.getDailyOhlc(symbol, range)
        → registry.forCapability("dailyOhlc", policy)
            → provider A (priority 10)
                → returns { data, meta }
            → policy + metadata validation
            → health record
        → if A fails: provider B, then C
    → normalized { data, meta }
```

The service rejects metadata whose `providerId`, `sourceType`, or
`productionReady` does not match the registered descriptor. Unofficial data
claiming production readiness is a hard error.

## Source metadata

Every response includes:

```ts
{
  data: T,
  meta: {
    providerId, providerName, sourceType, environment,
    termsStatus, productionReady, reliability,
    fetchedAt, asOf, ageSeconds, stale, cached,
    classification, state, maxAgeSeconds,
    warnings, requestId?
  }
}
```

`sourceType` is one of `licensed | unofficial | manual | mock`. `termsStatus`
is one of `verified | unverified | restricted | prohibited`. `classification`
is `VERIFIED | UNVERIFIED | DERIVED | DEMO | MISSING`, and `state` is
`live | delayed | eod | stale | unavailable`. The service validates that the
classification and state are consistent with the provider descriptor and the
capability's freshness window. The UI must render provenance and staleness next
to prices, never as a hidden tooltip.

## Provider descriptor

A provider declares exactly what it can do:

```ts
{
  id: "licensed-vendor-x",
  name: "Vendor X",
  sourceType: "licensed",
  environment: "production",
  termsStatus: "verified",
  termsUrl: "https://vendor.example/terms",
  license: "Commercial redistribution + derived analytics",
  productionReady: true,
  reliability: "high",
  priority: 10,
  capabilities: ["dailyOhlc", "indexHistory", "..."],
  limits: { maxDailyHistoryDays: 3650 },
  configRequired: ["LICENSED_BASE_URL", "LICENSED_API_KEY"]
}
```

`ProviderRegistry` refuses to register a provider that declares a capability
without implementing the mapped method.

## Runtime policy

| Environment / edition | Unofficial | Mock | Verified terms | Production ready |
|---|---|---|---|---|
| development | only with `ALLOW_UNOFFICIAL_DATA=true` | allowed | not required | not required |
| test | only with opt-in | allowed | not required | not required |
| staging | only with opt-in | allowed | not required | not required |
| production (licensed) | never | never | required | required |
| production (free edition) | allowed, permanently labelled | never | not required | not required |

`DATA_EDITION=free` selects `FREE_EDITION_POLICY`. It is a separate product
edition, not a bypass of licensed production. Omitting it keeps the strict
licensed policy, where `ALLOW_UNOFFICIAL_DATA` is ignored in production.

## Command provider contract

The external command is started per request. It reads one JSON object from
stdin and writes one JSON object to stdout.

Request:

```json
{ "action": "dailyOhlc", "params": { "symbol": "NABIL", "from": "2021-11-04", "to": "2026-11-04" } }
```

Success:

```json
{ "ok": true, "data": [], "asOf": "2026-11-04T09:15:00.000Z", "warnings": [] }
```

Failure:

```json
{ "ok": false, "error": "rate limited", "code": "RATE_LIMIT", "retryable": true }
```

Actions: `companyList`, `securityList`, `sectors`, `indices`, `dailyOhlc`,
`intradayOhlc`, `indexHistory`, `liveQuotes`, `marketSummary`,
`sectorPerformance`, `floorsheet`, `brokerFlows`, `fundamentals`,
`fundamentalsHistory`, `corporateActions`, `ipos`, `news`, `health`.

The response `data` must match the domain contract in `@stock/core`. It is
validated with Zod before it reaches the service.

## CSV provider layout

```
data/manual/
  companies.csv
  securities.csv              optional
  indices.csv                 optional
  quotes.csv                  optional
  market-summary.csv          optional (summary unavailable if absent)
  sector-performance.csv      optional
  corporate-actions.csv       optional
  ipos.csv                    optional
  news.csv                    optional
  ohlc/<SYMBOL>.csv
  indices/<INDEX>.csv
  floorsheet/<YYYY-MM-DD>.csv
  fundamentals/<SYMBOL>.csv
```

`MANUAL_DATA_LICENSED=true` is an operator attestation. Do not set it for data
whose license you have not verified. CSV data is `sourceType=manual`; it is not
treated as verified market data by default.

## Local store and the upgrade boundary

`@stock/store` is a local SQLite cache built on Node's built-in `node:sqlite`.
Every table carries `provider_id`, `source_type`, `terms_status`,
`production_ready`, and `fetched_at`, and every primary key includes
`provider_id`.

That is the upgrade boundary: switching from a free-source provider to a
licensed one creates a new namespace. It never overwrites, blends, or silently
"upgrades" the free history. Overlapping windows can be compared side by side
and the licensed namespace becomes the default only after it passes the gate.

`@stock/personal` is the only market-data writer in the Free Edition. It runs
when `DATA_EDITION=free`, or in development with `ALLOW_UNOFFICIAL_DATA=true`.
The licensed edition never uses it.

### Automatic refresh service

The packaged app never asks the client to run a command. `packages/personal`
exports `runPersonalRefresh`, one pipeline shared by the CLI and the desktop
app. `packages/api/src/refresh.ts` schedules it:

1. **archive**: fetch the public `binayabaral/nepal-market-data` tarball over
   HTTPS (git is not required), validate it, and keep the raw snapshot.
2. **bulk**: fetch the public market summary, sub-indices, current-day prices,
   floorsheet, news, IPO pipeline and mutual-fund NAVs.
3. **details**: optional slow pass for company profiles, key ratios,
   corporate actions and events.
4. **sync**: validate and import everything into the local store in the same
   provider namespace.

The service runs on launch and every six hours while the app is open, one run
at a time. It never runs while a manual import is active, backs off after
failures, and stops when the app closes. A failed bulk or details pass still
imports the archive; a failed details pass never fails the refresh. If the
remote archive cannot be checked, the previous checkout is reused and the
refresh result carries a clear "using cached data" note. Imported rows stay
`UNVERIFIED` and the raw archive and web responses are preserved.

Configuration: `NEPSE_AUTO_REFRESH` (`0` disables),
`NEPSE_AUTO_REFRESH_INTERVAL_MINUTES` (default 360, minimum 15),
`NEPSE_AUTO_REFRESH_INITIAL_DELAY_MS` (default 8000), and `NEPSE_AUTO_DETAILS`
(`1` includes the slow pass, default off).

State endpoints:

- `GET /api/refresh/status`: enabled/running flag, phase, progress, last
  success, human-readable last error, next check time, consecutive failures,
  interval, commit, latest session, and the last run summary (counts, warnings,
  cached flag and cache note).
- `POST /api/refresh/run`: starts a run and returns `202` immediately. The
  body may set `{ "force": true }` to ignore caches and `{ "details": true }`
  to include the slow company-profile, fundamentals and company-events pass.
  A run is refused with `409` while another import is active, and with `403`
  outside the Free Edition.

The store also provides the data-integrity machinery the UI relies on:

- Schema migrations applied on open, with `getSchemaVersion()` for diagnostics.
- `import_audit` rows for every import run (status, files, counts, warnings,
  failed symbols), exposed at `/api/import/history`.
- `backupTo()` using `VACUUM INTO`, exposed through
  `pnpm personal:backup` / `pnpm personal:restore`.
- A write boundary that rejects `DEMO`/mock rows, so demo data cannot enter the
  product database even by accident.
- Provenance reads that attach provider, source type, terms, `fetchedAt`,
  `asOf`, classification, freshness state, and age to each returned record.

## Adding a licensed provider

1. Implement `MarketDataProvider` (or extend `BaseProvider`).
2. Return `DataEnvelope<T>` with correct `meta` for every method.
3. Declare only implemented capabilities.
4. Set `sourceType=licensed`, real `termsStatus`, and `productionReady=true`
   only after legal review.
5. Register it in the factory/registry.
6. Add a `RestProvider` config if the vendor exposes the standard JSON shape.
7. Run `pnpm phase0:validate --provider licensed --env production`.
8. Keep the old provider registered as a lower-priority fallback.

No frontend or business-logic change is allowed to be part of that migration.

## Non-goals for the licensed Phase 0

- No licensed production UI or launch before the gate passes.
- No licensed business logic built on unverified data.
- No scraping or redistribution of data whose terms are unknown.
- No “best effort” empty arrays that hide missing capabilities.

The Free Edition ships separately, with its own permanent provenance badge and
its own honest capability limits. See [FREE_EDITION.md](FREE_EDITION.md).

## Personal research endpoints

Schema migration version 5 adds trade plans, the trade journal, the corporate
ledger and reconciliation imports. It also adds `source`, `external_id`, `kind`
and `notes` to `portfolio_transactions` and a unique index on `external_id`
where it is not null, so reconciliation is idempotent. The migration is
idempotent and preserves existing rows.

All new routes accept and return camelCase JSON. Validation failures return
`400` with `{ "error": "..." }`.

### Trade plans

`trade_plans` stores a symbol, side, entry, stop, one to three targets, quantity
and optional risk/fee figures. `riskAmount`, `riskPercent` and `rewardRisk` are
computed from the levels when the caller does not supply them.

- `GET /api/trade-plans?symbol=`: `{ "plans": TradePlan[] }`
- `POST /api/trade-plans`: `201 { "plan": TradePlan }`
- `PATCH /api/trade-plans/:id`: `{ "plan": TradePlan }`
- `DELETE /api/trade-plans/:id`: `{ "deleted": true }`

A `TradePlan` is `{ id, symbol, side, entry, stop, targets, quantity,
riskAmount, riskPercent, rewardRisk, fees, notes, createdAt, updatedAt }`.
Buys require `stop < entry < every target`; sells require
`stop > entry > every target`.

### Trade journal

`trade_journal` records planned and actual levels, paper trades, tags, a JSON
snapshot, reasons and mistakes. `pnl` is `(actualExit - actualEntry) * quantity
- fees` for a buy and the reverse for a sell. It may be supplied explicitly for
a closed trade. With `actualExit` null the P&L stays null: no fill is invented.

- `GET /api/journal?symbol=&from=&to=`: `{ "entries": JournalEntry[] }`, newest
  first by `openedAt`
- `POST /api/journal`: `201 { "entry": JournalEntry }`
- `PATCH /api/journal/:id`: `{ "entry": JournalEntry }`
- `DELETE /api/journal/:id`: `{ "deleted": true }`

`from`/`to` are `YYYY-MM-DD` and filter on `openedAt`.

### Reconciliation and corporate ledger

- `POST /api/reconciliation/import`: body `{ "source": string, "csv": string }`.
  Required columns are `symbol`, `side`, `quantity`, `price`, `traded_at`;
  optional columns are `fees`, `kind`, `external_id` and `notes`. Rows with an
  `external_id` already stored are skipped. The response is
  `{ imported, skipped, importId }`.
- `GET /api/reconciliation/transactions`: `{ "transactions": Transaction[] }`
  where each row adds `source`, `externalId` and `kind` to the portfolio shape.
- `GET /api/corporate-ledger?symbol=`: `{ "entries": CorporateLedgerEntry[] }`
- `POST /api/corporate-ledger`: `201 { "entry": CorporateLedgerEntry }` with
  `{ symbol, kind: dividend|bonus|right|other, exDate, amount, shares, notes }`
- `DELETE /api/corporate-ledger/:id`: `{ "deleted": true }`
- `GET /api/reconciliation/summary`:
  `{ realizedPnl, unrealizedPnl, totalPnl, xirr, dividends, bonusShares,
  rightsShares, exposure, concentration, imports }`.
  `exposure` is `[{ symbol, marketValue, percent }]`; `concentration` is
  `{ topSymbol, topPercent, hhi }` where `hhi` is the sum of squared market-share
  fractions (0 to 1). `imports` is
  `[{ id, source, importedAt, rowsCount }]`.

`xirr` is the annualised decimal return (0.1 means 10%). Cash flows are buys
negative, sells and dividends positive, with the current market value as a final
positive flow dated today. It is null when no rate can be solved.

Corporate ledger rows are informational: bonus and right share counts are
reported but are not automatically applied to portfolio quantities or cost
basis. Dividends feed XIRR only; they are not added to realised P&L.

### Data quality

- `GET /api/data-quality` returns
  `{ generatedAt, latestSession, summary, symbols }` where `summary` is
  `{ symbols, fresh, stale, missingSessions, quoteDiscrepancies }` and each
  symbol row is `{ symbol, lastCandle, lastQuote, sessions, missingSessions,
  staleDays, quoteVsCandlePercent, status }`.

`staleDays` is measured from the latest stored session, never wall-clock time.
`missingSessions` counts trading dates among the last 60 stored sessions where
at least 60% of active symbols have a candle but this symbol does not.
`quoteVsCandlePercent` is `(ltp - close) / close * 100`; an absolute value of
0.5 or more is a `discrepancy`. Status is one of `fresh`, `stale`, `thin`
(fewer than 20 stored sessions) or `discrepancy`, and rows are sorted worst
status first.

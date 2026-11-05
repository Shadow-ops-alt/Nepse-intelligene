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
        ├── packages/personal    free-source import/sync CLI
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
  `/api/import/status`, `/api/import/preview`, `/api/import/history`, and
  `/api/import/run`. It also serves the built renderer.
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

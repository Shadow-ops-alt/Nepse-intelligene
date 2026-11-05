# NEPSE Stock Terminal

A desktop stock-market terminal for Nepal (NEPSE), built around a
provider-independent market-data layer.

> **Status: Free Edition product shell + Phase 0 data validation.**
> The provider-independent data layer, local SQLite store, analysis engine, and
> React product shell are built. The shipped **Free Edition** runs on
> operator-supplied free data behind a permanent provenance badge. The
> **Licensed Edition** remains blocked until licensed data and written
> permissions exist. See [docs/FREE_EDITION.md](docs/FREE_EDITION.md) and
> [docs/PHASE0_FINDINGS.md](docs/PHASE0_FINDINGS.md).

## Principles

- One `MarketDataProvider` interface. Adapters are replaceable.
- Every response carries source, timestamp, freshness, reliability, and terms
  metadata.
- Unofficial data is never marked `productionReady`. The licensed edition
  blocks it in production; the free edition runs it as a clearly labelled
  separate edition.
- No provider-specific field names leak into business logic or the UI.
- The licensed edition does not ship until data availability, licensing, and
  accuracy pass the Phase 0 gate.

## Repository

```
apps/desktop           React product shell (Vite) + Electron shell
packages/core          provider contract, policy, registry, service, metadata
packages/providers     mock, manual CSV, free-source, licensed REST, command
packages/store         provenance-aware local SQLite store (node:sqlite)
packages/analytics     pure offline indicators
packages/api           local HTTP API for the desktop shell
packages/personal      import/sync CLI used by the Free Edition
packages/validation    Phase 0 checks, reports, CLI
docs/                  architecture, data sources, findings, feature map
```

## Quick start

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm phase0:validate --provider mock
```

The last command writes a Markdown and JSON report to `reports/`.

Run the product locally:

```bash
cp .env.example .env          # DATA_EDITION=free
# Optional: explicitly fetch and import the public MIT-licensed NEPSE archive.
DATA_EDITION=free pnpm personal:update \
  --data-dir ./data/personal --db ./data/personal.db
# Or import operator-supplied CSV files.
pnpm personal:sync --data-dir ./data/personal --db ./data/personal.db
pnpm dev                      # API on :4310, web on :5173
```

Build and serve the product from the local API:

```bash
pnpm start                    # builds the web app, serves it on :4310
```

Run it as a desktop app:

```bash
pnpm desktop                  # builds web + API bundle, launches Electron
pnpm desktop:package          # AppImage (Linux), NSIS (Windows), DMG (macOS)
```

The Electron shell starts the API in a child process, waits for
`/api/health`, then loads the local UI. Its database and data directory live
under Electron's `userData` folder unless overridden. Linux packaging produces
`apps/desktop/release/NEPSE Terminal-<version>.AppImage`.

Free Edition screens: Market overview (breadth, derived sector heatmap,
movers, candlestick signals), company page (indicator chart with RSI/MACD
panes, quant profile, signal tally, pivots, seasonality, patterns, return
distribution), quant screener, watchlist with correlation matrix, portfolio
ledger/P&L with allocation, company browser, data/coverage, and settings.
`Ctrl K` opens the command palette. Light, dark and Auto themes are included.

**Data policy:** no official or live NEPSE/market-data feed is used. Prices are
unofficial end-of-day closes; every other number is mathematics on those
closes, labelled *derived*. See [docs/HANDOFF.md](docs/HANDOFF.md).

Personal/free-source utilities:

```bash
pnpm personal:acquire
pnpm personal:update
pnpm personal:status
pnpm personal:candles NABIL
pnpm personal:analyze NABIL
pnpm personal:backup --out backup.db
pnpm personal:restore --from backup.db --force
pnpm phase0:validate --provider personal --allow-unofficial
```

Useful commands:

```bash
pnpm phase0:providers
pnpm phase0:validate --provider csv --data-dir ./data/manual
pnpm phase0:validate --provider licensed --env production
```

## Documentation

- [Handoff, data decision and review](docs/HANDOFF.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Free Edition and Licensed Edition](docs/FREE_EDITION.md)
- [Desktop shell](docs/DESKTOP.md)
- [Data sources and licensing](docs/DATA_SOURCES.md)
- [Phase 0 gate](docs/PHASE0.md)
- [Phase 0 findings](docs/PHASE0_FINDINGS.md)
- [Feature map](docs/FEATURES.md)
- [Manual CSV format](docs/MANUAL_DATA.md)
- [Personal research mode](docs/PERSONAL_MODE.md)
- [Release 1 data requirements](docs/RELEASE1_DATA_REQUIREMENTS.md)
- [Provider RFQ](docs/PROVIDER_RFQ.md)
- [Provider trial protocol](docs/PROVIDER_TRIAL_PROTOCOL.md)
- [Provider decision matrix](docs/PROVIDER_DECISION_MATRIX.md)

## Environment

```bash
cp .env.example .env
```

`ALLOW_UNOFFICIAL_DATA=true` is a development-only opt-in. The shipped Free
Edition uses `DATA_EDITION=free`, which enables the free-source provider and
keeps `productionReady=false`. Leave `DATA_EDITION` unset (or `licensed`) for
the strict licensed edition. `MANUAL_DATA_LICENSED=true` is a legal attestation;
do not set it without confirming the data licence.

`PERSONAL_DATA_DIR` / `PERSONAL_DB` configure the free-source store.

## Licence

No market data is vendored in this repository. Each provider’s terms apply.
The application code licence is not chosen yet.

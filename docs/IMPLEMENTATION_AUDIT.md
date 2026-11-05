# Implementation Audit — Free Edition

> **Historical record.** For the current state, read
> [HANDOFF.md](./HANDOFF.md), [FREE_EDITION.md](./FREE_EDITION.md) and
> [DATA_SOURCES.md](./DATA_SOURCES.md).

Date: **2026-11-04**
Auditor: implementation review of the repository as committed on disk.
Status: **Milestone 1 deliverable.** No product code was changed for this audit.
The Phase 0 licensed-production verdict remains **NO-GO** and is out of scope
here.

> **Post-audit update (2026-11-04).** This document records the baseline audit.
> The Milestone 1 corrections it recommends were then implemented: data-state
> classification and freshness, removal of the synthetic index summary,
> provenance on read, row-level validation with an atomic import, import audit
> history, schema migrations, backup/restore, and the light/dark UI redesign.
> Where this audit describes a defect, read it as “before the fix”. The
> remaining honest gaps are listed at the end of `docs/FREE_EDITION.md`.

## 1. Method

Reviewed, in this order:

- repository layout, workspace configuration, `.env.example`, README;
- all 15 documents in `docs/`;
- `packages/core` contracts, policy, freshness, registry, service, errors;
- every provider adapter (`mock`, `csv`, `personal/free-source`, `rest`,
  `command`) and the provider factory;
- `packages/store` schema and query layer;
- `packages/analytics` indicators, screener and portfolio maths;
- `packages/personal` sync and CLIs;
- `packages/validation` checks, runner, report and CLI;
- `packages/api` HTTP surface;
- every React page, component, hook and the stylesheet;
- the Electron main process and generated server bundle;
- all test files.

Baseline commands run on 2026-11-04:

| Command | Result |
|---|---|
| `pnpm typecheck` | **pass** (all 8 workspaces) |
| `pnpm test` | **pass — 45 tests in 7 workspaces** |
| `git status` | every file is **untracked**; there are no commits |

The test count is 45: core 10, analytics 9, providers 9, store 7, personal 6,
validation 2, api 2. There is no frontend test runner and no Electron test.

## 2. Architecture as built

```
apps/desktop (React 19 + Vite 8)         electron/main.mjs
        │ hash routes                           │ spawns
        ▼                                       ▼
packages/api (node:http, ~630 lines)     electron/server.mjs (esbuild bundle
        │                                       of electron/server.ts + api)
        ├── packages/providers → free-source provider (CSV)
        ├── packages/analytics → SMA/EMA/RSI, screener, portfolio
        ├── packages/personal  → sync CSV → SQLite
        └── packages/store     → node:sqlite, provider-namespaced tables

packages/core: MarketDataProvider, registry, policy, service, freshness
packages/validation: Phase 0 harness (separate from the product runtime)
```

The layering is sound and should be preserved. UI code has no vendor-specific
branching; every read goes through the provider contract or the local store.

## 3. What genuinely works

Verified by reading the implementation and by the existing tests:

- Provider contract, registry, policy and metadata envelope exist and are
  enforced (`unofficial` can never be `productionReady`).
- Free-source provider is permanently `sourceType=unofficial`,
  `termsStatus=unverified`, `productionReady=false`, `reliability=low`.
- SQLite primary keys include `provider_id`, so free and licensed series can
  coexist without overwriting each other. Covered by `store.test.ts`.
- CSV import works for companies, OHLC, indices, quotes, market summary and
  sector performance; per-symbol failures are isolated.
- Daily chart, SMA 20/50/200, EMA 20, RSI 14, 52-week range, window return.
- Screener over stored candles with trend, RSI zone, SMA and volume filters.
- Watchlist add/remove, persisted locally.
- Portfolio ledger with weighted-average cost basis, realised/unrealised P&L,
  explicit unpriced-position warning, and latest-daily-close fallback notice.
- Import status endpoint distinguishes `ready`/`missing` and the wizard
  disables the run button with a helpful message.
- Electron shell launches the API, waits for `/api/health`, and loads the UI.
- AppImage produced previously and launches.

## 4. Findings

Severity is about **data integrity and user trust** first, then function, then
polish. File references are to the current tree.

### P0 — data-integrity and trust defects

**A1. Staleness is hardcoded to false and never computed.**
`createMeta()` always writes `stale: false` (`packages/core/src/freshness.ts:66`).
`isStale()` exists but is not called anywhere. `DataMeta` advertises
`ageSeconds` and `stale`, so every envelope claims “not stale” regardless of
age. The UI therefore cannot honestly label delayed/EOD/stale data.

**A2. The market summary is fabricated when the summary file is absent.**
`getMarketSummary()` (`packages/providers/src/csv/csv-provider.ts:344`) reads
`market-summary.csv`; if it does not exist it derives a summary from quotes and
sets:

- `indexValue: 0`
- `change: 0`
- `changePercent: 0`
- `asOf: quotes[0]?.asOf ?? new Date().toISOString()`

With no quotes at all this yields a “NEPSE 0.00, 0.00%” snapshot stamped with
the current time. That is invented index data presented as a real observation.
It also happens with a legitimate quotes file, where the derived turnover and
volume are acceptable aggregates but the index zeros are not. The envelope adds
a warning, but warnings are dropped before the UI (see A4). This directly
violates the “never fabricate” rule.

**A3. Derived metadata is presented as primary data without a warning.**
`getSecurityList()` silently synthesises securities from companies
(`csv-provider.ts:224-252`) and `getIndices()` silently invents a `NEPSE` index
plus one index per sector when `indices.csv` is missing
(`csv-provider.ts:267-286`). No warnings are attached, and the UI cannot tell
`VERIFIED` from `DERIVED`. `getSectors()` derives sector counts from companies
(line 254) — acceptable, but it also goes unlabelled.

**A4. Provenance is discarded on read.**
The store persists `source_type`, `terms_status`, `production_ready`,
`fetched_at` and `as_of` on every row, but the read methods return only the
payload/domain object:

- `getQuotes()` selects `payload` only (`packages/store/src/store.ts:426`);
- `getSnapshot()` selects `payload` only (`store.ts:549`);
- `getCandles()`, `getCompanies()` likewise drop the provenance columns.

The API then returns bare arrays plus a `providerId` string
(`packages/api/src/app.ts:210-256`). `/api/analysis` and `/api/screener` drop
even the envelope warnings. Result: the renderer cannot display the source,
retrieval time, classification or stale state of anything it shows. This
contradicts `docs/FREE_EDITION.md` (“Provenance and staleness visible in the
UI”) and is the root cause of several UI findings below.

**A5. Import is not a validated, atomic pipeline.**
The wizard posts to `/api/import/run`, which calls `syncPersonalData()`. That
function upserts each entity/series as it goes
(`packages/personal/src/sync.ts`). There is no preview, column mapping, row
validation report, duplicate report, OHLC-invariant check, gap report, or
rollback. A failure part-way leaves already-written companies/candles in place
and records the run as `partial`. The requirement “rollback on failed imports”
is not met. The import “history” is only `sync_runs` (id, timestamps, status,
detail); it stores no counts, file hashes, row errors, or validation results.

**A6. No schema migrations or schema version.**
`PersonalStore.migrate()` is a single `CREATE TABLE IF NOT EXISTS` block
(`store.ts:104-201`). There is no `schema_version` / migration table, no
additive migration path, and no backup/restore command. Any future column will
require a manual database edit. The requirement “support database migrations”
is unmet.

**A7. CSV parsing is not schema-validated and uses unsafe assertions.**
`CsvProvider` casts `csv-parse` output to `Row` and then uses `row.symbol!`,
`row.id!`, `row.name!`, `row.asOf!` throughout
(`packages/providers/src/csv/csv-provider.ts`, e.g. 204-220, 325-340, 368).
There is no Zod schema per file. A missing required column becomes `undefined`
inside a domain object; numeric parsing throws a bare `Error` from
`toNumber()` rather than a structured, row-addressed import error. Duplicate
rows are silently collapsed by the SQLite primary key (last write wins) with no
report.

**A8. Demo isolation is not enforced at the product boundary.**
The mock provider still exists and is selectable through the factory and the
Phase 0 harness. The runtime API hardcodes `personal`, which is good, but:

- the store guard only rejects `unofficial + productionReady`
  (`store.ts:69`), not `mock` rows;
- `/api/candles`, `/api/analysis` and `/api/screener` accept an arbitrary
  `provider` query parameter and will read any namespace that happens to be in
  the database (`app.ts:247`, `282`, `304`);
- there is no test proving that a `mock` namespace can never enter portfolio,
  screener or market calculations.

The architecture intends isolation, but the boundary is convention, not a
proven invariant.

**A9. No data-state model in the UI.**
The requirement asks the interface to distinguish live / delayed / EOD / stale
/ unverified / demo / unavailable. The UI only has a Free Edition strip and a
provider `sourceType`/`termsStatus` line in the top bar. Charts, quotes,
summaries and portfolio valuations have no per-value state badge, no `asOf`,
and no missing-period indication. `Badge` tones are visual only; there is no
shared `DataState` type.

### P1 — functional gaps against the directive

| Area | State | Evidence |
|---|---|---|
| Indicators | Only SMA, EMA, RSI | `packages/analytics/src/analysis.ts` |
| MACD, Bollinger, ATR, ADX, Supertrend, Ichimoku, OBV, VWAP, PSAR | **not implemented** | same |
| Candlestick chart | Implemented, with volume | `PriceChart.tsx` |
| Timeframes | Daily only | provider and UI |
| Trendlines / drawing / support-resistance | **not implemented** | no code |
| Stock comparison | **not implemented** | no route/page |
| Company search | **not implemented** (doc claims it) | no search component; only screener text filter |
| Company master browse | **not implemented** (no list page) | company names only appear next to quotes |
| Fundamentals (EPS, P/E, P/B, ROE, ROA, revenue, paid-up, book value) | provider can parse CSV, but **sync never imports it and no UI exists** | `sync.ts` imports companies/candles/quotes/summaries/sectors only |
| Corporate actions / IPO / news | provider can parse CSV, **not synced, no UI** | same |
| Floorsheet / broker flows | provider can parse CSV, **not synced, no UI** | same |
| Index history | synced for `NEPSE` only, **no UI** | `sync.ts` |
| Market breadth, most active, 52-week high/low lists | **not implemented** | `MarketPage` has only top gainers/losers and one table |
| Alerts | **not implemented** | no code |
| Screeners | RSI/SMA/volume only; no MACD/EMA crossover, 52-week breakout, fundamentals | `portfolio.ts:259` |
| Portfolio allocation / dividends / XIRR | **not implemented** | `portfolio.ts` |
| Broker analytics, SMC/BOS/CHoCH, backtesting, risk/reward | **not implemented** (and correctly data-blocked) | no code |
| Settings page / data-source management | **not implemented** | no route |
| Backup / restore | **not implemented** | no CLI/API |
| Import preview / mapping / rollback | **not implemented** | A5 |
| Global error boundary | **not implemented** | React tree only |
| Search / command palette | **not implemented** | — |

### P2 — correctness, API and polish defects

**B1. Market gainers/losers overlap when fewer than 10 quotes exist.**
`MarketPage.tsx` takes `slice(0,5)` and `slice(-5).reverse()`. With 6 quotes,
one symbol appears in both lists. It should split the sorted list or show a
single ranked table.

**B2. Weak quote data can produce misleading ordering.**
`changePercent` is used directly for sorting and colouring. `toNumber()` will
throw on malformed values during import, but an empty quotes file yields `[]`;
missing `changePercent` is not possible after import, yet a NaN from a manually
edited payload would sort unpredictably. Defensive finite checks belong in the
domain mapping.

**B3. API routes are a single unvalidated if-chain.**
`packages/api/src/app.ts` is ~630 lines with no request schema, no route table,
no structured error codes and no logging. Query parameters (`provider`, `from`,
`to`, `kind`) are used raw. A malformed date or symbol reaches the store. This
is maintainable at the current size but will slow Milestones 3–8.

**B4. `readBody` errors become generic 500s.**
The 64 KB limit rejects with `Error`, caught by the outer handler as `500`.
Oversized or invalid JSON should be `413`/`400`.

**B5. Static file serving falls back to `index.html` for missing assets.**
`serveStatic()` returns the SPA shell for a missing `.js` file, producing a
confusing MIME/parse error instead of `404`.

**B6. Watchlist accepts symbols that are not in the instrument master.**
`/api/watchlist` validates shape only. A typo becomes a permanent,
never-priced entry. It should warn or reject against the known universe, while
still allowing pre-import use if explicitly confirmed.

**B7. Portfolio valuation ignores freshness.**
`/api/portfolio` uses the latest quote or latest daily close without an age
check or stale flag. The fallback count is reported, but an 18-month-old close
still produces a “current” market value. This must become a labelled valuation
state (A1/A4).

**B8. Date handling is mixed.**
`DataPage.defaultFrom()` uses UTC date arithmetic; the rest of the code has a
Nepal-aware `nepalToday()`. Around midnight in Kathmandu the default window can
be off by one day. `defaultFrom` also does not skip weekends/holidays.

**B9. Empty `quotes.csv` silently means “no live data”.**
`getLiveQuotes()` returns `[]` rather than a distinguishable “file missing”
condition. The UI renders “No quotes yet”, which is honest, but the import
report cannot say whether the file was absent or empty. The same applies to
`sector-performance.csv`. Capability availability and file presence are
conflated.

**B10. Index history has no product surface.**
It is imported but only used as a namespace row; no chart, no benchmark, no
relative-strength calculation.

**B11. `apps/desktop/electron/server.mjs` is a 954 KB generated bundle.**
It is correctly gitignored and rebuilt by the package script. Not a defect, but
the build output should never be hand-edited; note it in `DESKTOP.md`.

**B12. No initial git commit.**
Every file is untracked. This makes review, rollback and regression comparison
impossible. A baseline commit is a Milestone 1 prerequisite.

## 5. Duplicated or conflicting implementations

1. **Docs vs product.** `docs/FREE_EDITION.md` claims “company list and
   search”, “provenance and staleness visible in the UI”, and an import wizard
   that reports per-file status. Only the third is partly true (file presence,
   not per-file errors). `docs/FEATURES.md` still marks indicators and the
   screener as “Blocked” while the Free Edition ships SMA/EMA/RSI and a
   screener. These are not code duplicates, but they are conflicting product
   statements that must be reconciled.
2. **Two “personal” concepts.** `packages/personal` is the sync/mode package;
   `PERSONAL_PROVIDER_ID` is `"free-source"`; docs call the path “personal
   research mode” and the product “Free Edition”. The names are stable enough
   to keep, but the audit recommends one vocabulary in UI text: **Free
   Edition**, **free-source provider**, **local CSV import**.
3. **Provider capability claims vs file requirements.** The free-source
   descriptor declares `liveQuotes`, `marketSummary`, `sectorPerformance` and
   `indices`; all of these have optional files and derived fallbacks. Capability
   therefore means “may return something”, not “has real data”. This must be
   split into declared capability, file presence, and record classification.
4. **Generated Electron server.** `electron/server.ts` is the source;
   `electron/server.mjs` is generated and gitignored. No action beyond
   documentation.
5. **`getSecurityList` and `getIndices` both derive from companies.** They
   duplicate the company read and should share one labelled derivation helper
   so the warning/classification is consistent.

## 6. Mock, demo and fallback inventory

| Mechanism | Where | Risk | Required action |
|---|---|---|---|
| `MockProvider` | `packages/providers/src/mock/mock-provider.ts` | Selectable through factory/Phase 0; rows could be stored in a shared DB | Keep for tests/Phase 0 only; block `mock` rows in `PersonalStore` and prove it with a test |
| Market summary derived from quotes | `csv-provider.ts:344` | Fabricated index zero and “now” timestamp | Return `null`/explicit unavailable unless a real summary row exists; aggregate only turnover/volume/trades with a `DERIVED` classification |
| `getIndices` synthetic NEPSE/sector list | `csv-provider.ts:267` | Synthetic instrument metadata presented as real | Mark `DERIVED` and warn, or require `indices.csv` |
| `getSecurityList` from companies | `csv-provider.ts:224` | Derived securities presented as real | Mark `DERIVED` and warn |
| `getSectors` from companies | `csv-provider.ts:254` | Derived counts | Mark `DERIVED`; acceptable |
| Portfolio latest-close fallback | `app.ts:337-360` | Old close becomes “current” value | Add `valuationState` + age; never label current without freshness |
| Provider fallback in `MarketDataService` | `packages/core/src/service.ts` | Need to verify no silent cross-provider fallback exists | Audit confirms registry selection is explicit; document the rule and add a test |
| Empty optional CSVs | `csv-provider.ts` | Missing vs empty indistinguishable | Report file presence separately from record count |

## 7. UI audit

The current UI is a dark-only “sci-fi” dashboard:

- `styles.css:2` sets `color-scheme: dark`; `styles.css:31` uses a blue/purple
  radial gradient on `body`; `styles.css:89` uses a purple/blue gradient on the
  brand mark.
- Colours are hardcoded in the chart (`PriceChart.tsx:21-37`): grey text,
  white-alpha grid, blue crosshair, fixed red/green volume. The chart cannot
  follow a light theme.
- No theme toggle, no `prefers-color-scheme` support, no persistence.
- Layout is a fixed 232 px sidebar with five items; there is no company list,
  search, settings or help.
- Density is inconsistent: stat cards, cards, tables and chips each have their
  own spacing language.
- There is no data-state legend; “snapshot” is the only badge, and it is
  decorative.
- Badges carry meaning only by colour; there is no icon/text distinction for
  unverified/stale/unavailable.
- Focus states exist for inputs but not for nav/table rows; table rows are
  clickable `<tr>` without keyboard access.
- Contrast is acceptable on the dark theme but the muted text is close to the
  panel background.
- Empty states are inconsistent: some are cards, some are bare `EmptyState`,
  some are plain text.
- The Free Edition strip is always warm amber; it competes with warnings and
  does not state the actual age of the data.
- No loading skeleton; every page swaps to a centred “Loading…” text.
- No error boundary: a render error blanks the app.

The redesign should replace the gradient skin with a neutral, professional
financial UI and add **light and dark modes** without changing the data layer.
The plan is in §9.

## 8. Documentation that must be corrected

- `docs/FREE_EDITION.md`: remove “company list and search” until search exists;
  change “provenance and staleness visible in the UI” to describe what is
  actually shown; describe the import wizard as file-presence + run, not
  per-file validation.
- `docs/FEATURES.md`: reconcile the Free Edition shipped indicators/screener
  with the “Blocked” labels (the licensed gate and the Free Edition are
  different products).
- `docs/ARCHITECTURE.md`: add the missing-record/derived-record classification
  and the “no silent derivation” rule.
- `docs/DESKTOP.md`: note that `electron/server.mjs` is generated.
- `docs/MANUAL_DATA.md`: align optional-file semantics with A5/A9.

## 9. Proposed Milestone 1 corrections

These are the only code changes proposed before data-source work. Each item
has an acceptance test. Nothing here weakens the Phase 0 gate, adds a scraper,
or contacts a vendor.

### M1.1 — Data-state and provenance foundation (P0)

1. Add an explicit `DataClassification` type:
   `VERIFIED | UNVERIFIED | DERIVED | DEMO | MISSING`.
2. Replace the hardcoded `stale: false` with computed staleness against a
   per-capability max age; keep `ageSeconds` and add `state`
   (`live | delayed | eod | stale | unavailable`).
3. Persist and return provenance from every store read: `fetchedAt`, `asOf`,
   `sourceType`, `termsStatus`, `productionReady`, `classification`, `stale`.
   Add read models rather than changing domain objects in place where possible.
4. Add an API-level `dataState` block to `/api/meta`, `/api/quotes`,
   `/api/summary`, `/api/candles`, `/api/analysis`, `/api/screener` and
   `/api/portfolio`.
5. Tests: stale computation, provenance round-trip, portfolio stale valuation,
   demo/mock rejection.

### M1.2 — Remove fabricated and unlabelled derivations (P0)

1. `getMarketSummary()` must not invent index values. If
   `market-summary.csv` is absent, return an explicit unavailable result (or a
   `DERIVED` aggregate that contains only turnover/volume/trades and has
   `indexValue: null`), never zero-and-now.
2. Mark `getIndices`/`getSecurityList`/`getSectors` derivations `DERIVED` with
   warnings, or require their files.
3. UI renders `MISSING`/`DERIVED` explicitly instead of `—` or zero.
4. Tests: missing summary file, missing indices file, malformed row, derived
   classification.

### M1.3 — Import pipeline hardening (P0)

1. Add Zod schemas per CSV file and row-addressed errors
   (`file`, `row`, `column`, `value`, `reason`).
2. Validate OHLC invariants (`low <= open/close <= high`, non-negative volume,
   valid date) and duplicate timestamps before writing.
3. Import into a transaction (or staging tables) and roll back on fatal error.
4. Record an import audit row: file hashes, row counts, rejected rows,
   warnings, provider, timestamps, status.
5. Add a preview/dry-run endpoint that returns counts and the first N rejected
   rows without writing.
6. Add duplicate/gap reporting; gaps are reported, never filled.
7. Tests: invalid row, invariant violation, duplicate, rollback, audit row.

### M1.4 — Schema migrations and backup (P1)

1. Add `schema_migrations` and versioned migrations; migrate the existing DB
   in place.
2. Add `backup`/`restore` CLI or API using SQLite's backup mechanism.
3. Tests: migration from an empty and a v1 database; backup round-trip.

### M1.5 — UI redesign with light/dark modes (P1)

Detailed in §10. This is a UI-only change: no data semantics change.

### M1.6 — Product-surface corrections (P1, only if approved)

1. Global search / company list page using the existing company master.
2. Consistent data-state badges on every value.
3. Settings page for theme, data directory, and provider status.
4. Error boundary and keyboard-accessible table rows.

### Explicitly out of scope for Milestone 1

- Any licensed provider contact, trial, purchase or terms acceptance.
- Any scraper or unofficial live API integration.
- MACD/Bollinger/ATR/ADX/Supertrend/Ichimoku/OBV/VWAP/PSAR (Milestone 5).
- Fundamentals/corporate-action UI until the import path is trustworthy
  (Milestone 6).
- Alerts and advanced analytics (Milestones 7–9).
- Any change to the Phase 0 verdict.

## 10. UI redesign proposal

### Goals

- Neutral, professional financial terminal, not a sci-fi dashboard.
- **White mode** and **black mode**, both first-class, with a visible toggle.
- Data state is always legible: source, as-of, freshness, classification.
- Dense but calm: tables and numbers first, decoration last.

### Visual language

- Remove the radial body gradient, the purple brand gradient and the translucent
  blurred sidebar.
- Flat surfaces, 1 px borders, 6–8 px radii, no glow, no backdrop-filter.
- One accent (a restrained blue) plus semantic up/down/warn colours.
- System font stack; tabular numerals for all numeric columns.
- 8 px spacing scale; 32/24/16 px page rhythm.

### Theme tokens

Define tokens once and switch with `data-theme="light|dark"` on `<html>`:

```
--bg, --surface, --surface-2, --border, --border-strong
--text, --text-muted, --text-subtle
--accent, --accent-soft
--up, --up-soft, --down, --down-soft
--warn, --warn-soft, --info, --info-soft
--radius, --shadow
```

Light: near-white page (`#f7f8fa`), white cards, grey borders, near-black text.
Dark: near-black page (`#0f1115`), `#171a20` cards, subtle borders, off-white
text. Both keep the same hues for up/down/warn so meaning does not change.

### Theme behaviour

- Toggle in the top bar (`Light` / `Dark`, or a sun/moon icon with an accessible
  label).
- Initial value: stored preference → `prefers-color-scheme` → light.
- Persist in `localStorage`; apply before first paint to avoid a flash.
- Chart reads the resolved theme and re-renders colours on change.
- No third-party theme dependency.

### Layout

- Left rail 220–240 px: brand, five primary destinations, a compact data-state
  footer (edition, provider, last import).
- Top bar: page title, global search (company), theme toggle, data-state chip.
- Content: 12-column grid capped at ~1440 px; tables full width.
- On narrow windows, the rail collapses to a horizontal bar (existing
  breakpoint can be retained).

### Components

- `DataStateBadge`: icon + text for `Live`, `Delayed`, `EOD`, `Stale`,
  `Unverified`, `Derived`, `Demo`, `Missing`; never colour alone.
- `Stat`: label, value, unit, as-of and state.
- `Table`: sticky header, right-aligned numerics, keyboard-activatable rows,
  empty and error rows.
- `Notice`: info/warn/error variants used for unadjusted prices, stale data and
  missing files.
- `EmptyState`: one pattern with a title, explanation and one primary action.
- `Skeleton`: replaces centred “Loading…” text.

### Screen priorities

1. **Market** — index/state header, breadth (if data exists), ranked table,
   sectors, honest empty states.
2. **Company** — header with sector/listing, chart with theme-aware colours,
   indicator strip, freshness line, “data limitations” notice.
3. **Screener** — filter bar, result table with per-row as-of/state, saved-view
   placeholder only if implemented.
4. **Portfolio** — totals with priced/unpriced split, holdings with valuation
   state, transaction ledger.
5. **Watchlist** — table with state and last update.
6. **Data** — provider card, capability table, import wizard, import history,
   “what this edition cannot do”.

### Accessibility

- Visible focus rings for nav, buttons and table rows.
- `aria-pressed` on the theme toggle; `aria-current` on nav.
- Minimum 4.5:1 contrast for body text in both themes.
- No meaning conveyed by colour alone.
- Respect reduced motion.

### Acceptance criteria

- Toggle switches the entire app and chart in one click, persists across
  restarts, and has no flash of the wrong theme.
- No gradient or glow remains.
- Every displayed number has a source/state path (even if the state is
  `MISSING`).
- Typecheck, 45+ tests, production build and packaged app still pass.

## 11. Open decisions before coding

1. **Data acquisition ownership conflict.** The directive says the assistant
   should own acquisition, but the standing constraints forbid contacting
   vendors, creating accounts, accepting terms, or scraping prohibited
   sources. Free data therefore remains operator-supplied CSV until the owner
   explicitly authorises a specific source and its terms. This audit does not
   resolve that conflict; it records it.
2. **Approval of the Milestone 1 scope in §9.** In particular, whether to do
   M1.1–M1.4 (data integrity) before the UI redesign, or the UI redesign first.
   Recommended order: M1.1 → M1.2 → M1.3 → M1.4 → M1.5 → M1.6, because the UI
   must render real data states rather than decorate fabricated ones.
3. **Theme default.** Recommended: light by default, dark available, with
   system preference respected on first run.
4. **Initial commit.** Recommended: create a baseline commit of the current
   tree before any code change, so the audit and every later milestone are
   reviewable.

## 12. Bottom line

The repository is a credible, well-layered Free Edition prototype with a real
provider abstraction, a provider-namespaced SQLite store, working import,
charts, indicators, screener and portfolio maths. It is **not yet** the
finished product described in the directive.

The blocking issues are not missing screens; they are trust issues:

- stale data is always labelled fresh;
- a missing summary file produces a zero-valued “current” index;
- provenance is thrown away on read;
- imports are neither validated nor atomic;
- the UI does not show data state at all and is dark-only.

Fix those first, then build features on top. The licensed production gate
remains **NO-GO**.

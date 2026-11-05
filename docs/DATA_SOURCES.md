# Data Sources and Licensing

Last probed: **2026-11-04** (Asia/Kathmandu). Results are observations, not a
license or a guarantee. Re-run `pnpm phase0:validate` against the current
provider before relying on any row.

The document has two parts. The **verified public archive** section below is the
only acquisition path the shipped Free Edition uses. The **unofficial NEPSE
endpoint** analysis is the original Phase 0 probe and remains the reference for
why the live/unofficial path is not shipped.

## Verified public archive (Free Edition primary source)

### 1. `binayabaral/nepal-market-data` — installed

| | |
|---|---|
| URL | https://github.com/binayabaral/nepal-market-data |
| Raw data | `data/nepse/<SYMBOL>.csv`, `data/nepse/NEPSE_INDEX.csv`, `data/reference/nepse-symbols.csv` |
| Maintainer | Binaya Baral |
| Licence | MIT (`LICENSE` in the repository) |
| Verified commit | `6aa7198118272b2c48090a4dbbedb1b3c5c10fe9` |
| Update schedule | Daily NEPSE scrape at 15:00 Nepal time, Monday–Friday; weekly reconciliation |
| Retrieved | 2026-11-04 |
| Coverage | 468 symbols; 478,867 valid daily price rows, 1995-07-20 → 2026-11-03; 6,657 valid NEPSE index rows, 1997-07-20 → 2026-11-03 |
| Price fields | `published_date,open,high,low,close,per_change,traded_quantity,traded_amount,status` |
| Master fields | `symbol,name,source_category,instrument_type,sector,status` |

What it provides:

- **P0 company/security master** — 468 rows split into 306 ordinary equities,
  75 debentures, 47 mutual funds, 38 promoter shares, and 2 government bonds;
  447 listed and 21 merged.
- **P0 historical EOD prices** — one row per traded session per symbol, raw and
  unadjusted.
- **P0 latest available prices** — the 2026-11-03 session is present for 348
  instruments; 279 ordinary listed equities have a previous valid close and
  therefore a computable day change. `quotes.csv` marks these rows
  `session=eod`; the API labels them `eod`, never `live`, and computes the
  change from the previous valid close rather than trusting the source field.
- **P1 NEPSE index history** — open/high/low/close, percent change, and market
  turnover. `traded_quantity` is deliberately blank because an index has no
  share count; the app stores volume as `0` and labels it as not published.
  The Market page shows the latest index `traded_amount` as "Market turnover ·
  unverified"; it is source-reported, not summed from quotes.
- **P1 sector classification** — the master's `sector` column, with blanks
  preserved as `Unclassified` rather than guessed.

Provenance and limitations:

- The MIT licence covers the repository. The figures are compiled by scraping
  public ShareSansar/NEPSE pages; the repository's own disclaimer calls the
  dataset unofficial and best-effort. It is therefore imported as
  `UNVERIFIED`, never `VERIFIED`, and never production-ready.
- Prices are **not adjusted** for bonus shares, rights, or splits.
- Missing dates are real gaps (weekends, holidays, or a scrip that did not
  trade), not forward-filled values.
- The archive contains malformed OHLC rows. The normalizer applies the same
  invariant as the app validator and excludes any row where
  `high < max(open, close)`, `low > min(open, close)`, `high < low`, a price is
  non-positive, or a value is non-numeric. **40,708 rows were excluded** in the
  verified commit (40,638 equity + 70 index) and listed row-by-row in
  `reports/excluded-rows.csv`. Nothing is repaired or interpolated.
  A fresh acquire of commit `fded4ea` on 2026-11-05 (latest session
  2026-11-04) excluded 40,714 equity rows (40,701 OHLC invariant, 13
  non-positive) + 70 index rows.
- The master leaves **193 sectors blank** (mostly debentures, funds, promoter
  shares, and merged shells). Ten ordinary listed names are also blank in the
  source (CFL, HRL, JHAPA, MKCL, NRIC, NRM, NTC, NWCL, PURE, TTL); they are
  kept and labelled `Unclassified`.
- The source `per_change` field is unreliable historically: 26,781 of 478,399
  historical rows disagree with the previous-valid-close change by more than
  0.02 percentage points. The latest session had zero mismatches. The app stores
  the **computed** change, never the source field.
- No daily market-wide transactions/scrips totals, sector sub-indices,
  floorsheet, fundamentals, or corporate-action history.

Acquisition command:

```bash
DATA_EDITION=free pnpm personal:update \
  --data-dir "$HOME/.config/NEPSE Terminal/data" \
  --db "$HOME/.config/NEPSE Terminal/personal.db"
```

`pnpm personal:acquire` performs the same fetch and normalization without
writing the database. Both commands reuse a local clone for 30 minutes by
default, record every attempt in `data/reports/provider-health.json`, and never
delete the database or previously valid rows when a refresh fails.

### 2. `srijankarki07/nepse-data` — cross-check only, not installed

| | |
|---|---|
| URL | https://github.com/srijankarki07/nepse-data |
| Licence | Code is MIT, but the README does **not** grant a data licence |
| Verified coverage | 3,617 sessions, 2011-03-20 → 2026-11-03 |
| Fields | `date,symbol,open,high,low,close,volume,turnover` |
| Index history | Only from 2026-10-07; cannot reconstruct older index levels |
| Upstream | Scraped from ShareSansar |

This archive is genuine and useful for spot-checking prices, but it was not
installed: its data licence is unresolved, it has no sector master, and its
index history is too short for the market overview. The npm package
`srijankarki07/nepse-client` is a client for this archive, not a data source of
its own.

### 3. Sources rejected or not used

| Source | Result |
|---|---|
| `dakoirala/tarka-trading` | The repository no longer resolves (HTTP 404). |
| `tarkacwm/tarkatool` / `TarkaTradingTool` | Unrelated TQQQ/US-market tooling, not NEPSE data. |
| `Aabishkar2/nepse-data` | Historical NEPSE data without a licence; it is an upstream source credited by the primary archive. Not imported directly. |
| `Shubhamnpk/yonepse` | Live/dashboard project; no verified historical archive or data licence. |
| `surajrimal07/NepseAPI-Unofficial` | Unofficial live API; terms and stability not suitable for a shipped Free Edition. |
| `prabinbessie/scrapPy` | A scraper, not an archive; would require running live scraping. |
| `shawinCreates/Nepse-Market-Data` | Scraped ShareSansar archive; licence/provenance not established. |
| Paid/licensed vendors | Not contracted; the licensed provider remains a drop-in upgrade path. |

### 4. Datasets installed by the Free Edition

| Dataset | Priority | Installed? | Canonical file |
|---|---|---|---|
| Company/security master | P0 | Yes, 468 rows | `companies.csv`, `securities.csv` |
| Historical EOD prices | P0 | Yes, 478,867 rows, 468 series | `ohlc/<SYMBOL>.csv` |
| Latest available prices | P0 | Yes, 279 end-of-day quotes | `quotes.csv` |
| NEPSE index history | P1 | Yes, 6,657 rows | `indices/NEPSE.csv`, `indices.csv` |
| Sector classification | P1 | Yes, partial (source blanks preserved) | `companies.csv` |
| Daily market statistics | P1 | No — transactions/scrips totals not published | not written |
| Sector/sub-indices | P1 | No — sector index values not published | not written |
| Floorsheet | P2 | No | unavailable |
| Fundamentals | P2 | No | unavailable |
| Corporate actions | P2 | No | unavailable |

The absence of `market-summary.csv` and `sector-performance.csv` is deliberate.
The UI keeps those datasets unavailable rather than deriving them from quotes or
inventing values. The NEPSE index level is shown from real stored index candles,
which is a different dataset from the unavailable market-wide summary.

### 5. Update, caching, and failure behaviour

- `pnpm personal:update` is the only update entry point; the app never fetches
  in the background.
- The source is a public git repository. A shallow clone/fetch is used, not a
  REST loop.
- Fetches are cached for 30 minutes by default (`--max-age-minutes`).
- Git network operations retry three times with 1 s, 2 s, and 4 s backoff.
- A failed fetch leaves the previous canonical files and database untouched and
  records the failure plus a consecutive-failure count in
  `reports/provider-health.json`.
- Import is idempotent: candles are keyed by provider, kind, symbol, timeframe,
  and timestamp; companies by provider and symbol; quotes by provider and
  symbol.
- Every normalization writes `reports/import-report.json`,
  `reports/excluded-rows.csv`, and `reports/history-changes.json`. Changed or
  removed historical rows are reported, never silently rewritten.
- Raw source files are preserved under `data/source/binayabaral/<commit>/` with
  a manifest containing the URL, commit, retrieval time, licence, attribution,
  and hashes of the symbol master and index file.

### 6. Attribution

- `binayabaral/nepal-market-data` (MIT), the compiled public archive.
- `sharesansar.com`, the daily NEPSE price and index publisher used upstream.
- `Aabishkar2/nepse-data`, the historical OHLC source credited upstream.

Do not redistribute the raw data or a database containing it. The Free Edition
is a local, single-user research tool, not a data-redistribution product.

## Status summary

| Data need | Unofficial NEPSE endpoint | Observed behaviour | Phase 0 status |
|---|---|---|---|
| Company master | `GET /api/nots/company/list` | Works. Full active company list with symbol, sector, instrument type. | Free Edition only; not licensed |
| Security master | `GET /api/nots/security?nonDelisted=true` | Works. Includes non-delisted securities. | Free Edition only; not licensed |
| Live quotes | `GET /api/nots/lives-market` | Works. ~194 symbols with OHLC, LTP, volume, turnover, previous close. | Free Edition only; not licensed |
| Market summary | `GET /api/nots/market-summary/` | Works. Turnover, shares, transactions, scrips. | Free Edition only; not licensed |
| Daily OHLC, recent | `GET /api/nots/market/history/security/{id}?startDate=&endDate=&size=500` | ~194 recent trading days returned. | Free Edition/recent charts only |
| Daily OHLC, 5 years | Same endpoint | 2024 and 2023 windows returned zero rows. The endpoint appears to retain only the most recent ~9–12 months. | **FAIL** |
| Index intraday | `POST /api/nots/graph/index/{id}` | 60-second points for roughly the current 30 minutes. Date query parameters ignored. | Usable for a live intraday chart only |
| Index daily history | `POST /api/nots/market/graphdata/daily/{id}` | Returned an empty array during the probe. | **FAIL** |
| Floorsheet, current day | `POST /api/nots/nepse-data/floorsheet` | Works for the current day. | Usable for live/current-day analytics only |
| Floorsheet, historical | Same endpoint with `businessDate=` | Parameter ignored; always returned the current day’s trades. | **FAIL** |
| Company snapshot | `POST /api/nots/security/{id}` | Works for a current security snapshot. | Free Edition only; not licensed |
| Fundamentals | Not exposed by the probed wrapper/library | No verified endpoint for EPS, ROE, P/E, book value, etc. | **BLOCKED** |
| Fundamentals history | Not exposed | No quarterly/annual history. | **BLOCKED** |
| Corporate actions / dividends | Not exposed | No verified bonus/right/cash-dividend history. | **BLOCKED** |
| IPO / FPO / rights / lock-in | Not exposed | No verified pipeline or allotment data. | **BLOCKED** |
| Mutual fund NAV / holdings | Not exposed | No verified source. | **BLOCKED** |
| News / filings | Not exposed | No verified source. | **BLOCKED** |
| Broker flows | Derivable from floorsheet | Only current-day floorsheet is available. | Blocked for history |
| Delisted / suspended history | Not covered by the live wrapper | Needed for survivorship-bias-free backtests. | **BLOCKED** |

## Authentication and access

The shipped Free Edition makes **no** runtime call to NEPSE or ShareSansar. Its
only acquisition path is the explicit `pnpm personal:update` command, which reads
the public git archive described above. The unofficial endpoint analysis in this
section is retained because it explains why that path remains blocked for
production.

The unofficial wrapper obtains a Nepali stock-exchange session token through
`/api/authenticate/prove`, a bundled WebAssembly helper, and a `Salter`
authorization header. The probe confirmed the flow works today, but it is an
undocumented, reverse-engineered access path. It can break without notice and
may not be permitted by the site’s terms.

This repository does **not** include the wrapper, the WASM file, or any
credentials. `CommandProvider` can call an operator-supplied tool locally for
development/validation, but that provider is always
`sourceType=unofficial`, `termsStatus=unverified`, `productionReady=false`, and
is blocked by production policy.

## Licensing findings

| Source | License / terms | Finding |
|---|---|---|
| `binayabaral/nepal-market-data` | MIT `LICENSE` | The repository is MIT. The scraped figures are still labelled unofficial by the maintainer, so the Free Edition imports them as `UNVERIFIED` and never production-ready. |
| `srijankarki07/nepse-data` | MIT code; no data grant | Cross-check only. Not installed, because the data licence is unresolved. |
| `basic-bgnr/NepseUnofficialApi` | No `LICENSE` file; README has no license or commercial-use grant | **Unverified / no permission granted.** Do not redistribute or ship. |
| Nepal Stock Exchange website/API | Public website terms not reviewed for automated access or redistribution | **Unverified.** Written permission is required before production use. |
| MeroShare | Account-authenticated investor portal | User’s own account data only; no redistribution. Not a market-data vendor. |
| NepseAlpha / Sharehub / Chukul / similar | Third-party sites; terms vary | **Unverified.** Each needs a terms review and, where required, a commercial agreement. |
| Licensed vendor (to be selected) | Commercial contract | **Required** for production. |

The key legal questions are not only “can I read the page?” but:

- May the data be stored persistently?
- May derived analytics (indicators, screeners, scores, heatmaps) be produced?
- May it be displayed to end users, including paying clients?
- May it be redistributed or sublicensed?
- Is historical data included, and for how long?
- Are corporate-action-adjusted prices included?
- What is the SLA, rate limit, and correction process?

## What a licensed provider must supply

> **Phase 0.5 scope note (2026-11-04).** The list below is the original
> full-scope requirement. It is now classified into Release 1 mandatory,
> conditional, Release 2, Release 3, and optional in
> `docs/RELEASE1_DATA_REQUIREMENTS.md`. In particular, historical floorsheet
> (3), full five-year statements (4), mutual funds (7), news (8), and delisted
> securities (9) are **not all Release 1 mandatory by default**. See the scope
> reduction register before treating any of them as a launch blocker. The Phase
> 0 gate is unchanged.

1. **Five years or more of daily OHLCV** for all listed equities, including
   adjusted and unadjusted series.
2. **Five years of index history** (NEPSE and sector sub-indices).
3. **Historical floorsheet** with contract-level trades and broker IDs.
4. **Fundamentals history** (quarterly and annual), with reported date and
   restatement flags.
5. **Corporate actions**: bonus, rights, cash dividends, splits, mergers, with
   announcement, ex-date, record date, and adjustment factor.
6. **IPO/FPO/right/debenture/mutual-fund issue pipeline** and allotment data.
7. **Mutual fund NAV and portfolio holdings**, if those features are in scope.
8. **News/filings** with timestamps and source attribution.
9. **Delisted and suspended securities** so backtests do not suffer from
   survivorship bias.
10. **Correction/errata feed** and a documented freshness SLA.
11. **Written redistribution and derived-analytics rights** for the product’s
    actual distribution model.

If a vendor cannot supply (1), (2), a date-scoped floorsheet, five-year core
metric history, and corporate actions with adjustment factors, the product
cannot meet the Release 1 requirement. Historical floorsheet depth, full
statements, delisted history, and historical intraday are separate decisions
(C1–C4). If no vendor can supply the full list, the full-scope product cannot be
built as specified; a clearly labelled “recent-data only” edition is a
different product decision. See `docs/RELEASE1_DATA_REQUIREMENTS.md`.

## Data-quality rules

- Never treat scraped/unofficial data as verified.
- Never silently mix providers in one series without recording the source
  switch in metadata.
- Never compute indicators across a corporate action without adjusting prices
  or flagging that they are unadjusted.
- Never show a price without its `asOf` and freshness.
- Never hide a missing capability behind an empty array.
- Keep raw snapshots out of git; `data/raw/`, `data/cache/`, and `data/private/`
  are ignored.

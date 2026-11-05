# Phase 0 Findings

Date: **2026-11-04**
Scope: live probes of the unofficial Nepali stock-exchange API, source/licence
review, and construction of the provider-independent validation harness.

## Verdict

**NO-GO for production.**

The architecture is ready and the validation gate works, but the available
unofficial source cannot satisfy the agreed five-year data requirement, and no
production licence has been verified. Production UI, portfolio logic, and
backtests must not be built on this data.

Continued development using the mock provider or operator-supplied licensed CSV
is safe. The production gate remains closed.

## Evidence

| Probe | Result |
|---|---|
| `GET /api/nots/company/list` | 200. Returned the active company list with symbol, sector, instrument type. |
| `GET /api/nots/security?nonDelisted=true` | 200. Returned the non-delisted security list. |
| `GET /api/nots/lives-market` | 200. Returned ~194 live quotes with OHLC, LTP, volume, turnover, previous close, and timestamp. |
| `GET /api/nots/market-summary/` | 200. Turnover, shares, transactions, and scrips. |
| `GET /api/nots/market/history/security/131?startDate=2026-01-01&endDate=2026-11-04` | 200. 194 rows, ending 2026-11-03. |
| Same endpoint, `2025-01-01` → `2025-12-31` | 200. Only the trailing 39 rows (2025-11-04 → 2025-12-31). |
| Same endpoint, `2024` and `2023` windows | 200 with `totalElements: 0`. |
| `POST /api/nots/graph/index/58` | 200. 32 points at 60-second intervals; roughly the current 30 minutes. |
| Same endpoint with `startDate`/`endDate` | Date parameters ignored; same intraday points. |
| `POST /api/nots/market/graphdata/daily/58` | 200 with an empty array. |
| `POST /api/nots/nepse-data/floorsheet` | 200 for the current day. |
| Same endpoint with `businessDate=2025-11-03`, `2026-01-15`, `2026-10-30` | `businessDate` ignored; content was always 2026-11-04. |
| `POST /api/nots/security/131` | 200. Current security snapshot. |
| `GET /api/nots/nepse-data/market-open` | 200. `{ isOpen: "OPEN", asOf, id }`. |
| Fundamentals / dividends / corporate actions / IPO / lock-in / mutual funds | No verified endpoint in the probed wrapper or site surface. |
| Wrapper repository licence | No `LICENSE` file; README contains no licence or commercial-use grant. |

## Blockers

### B1 — Five-year daily OHLC is unavailable

The history endpoint behaves like “most recent N rows up to the end date”, not
“rows inside the requested range”. A 2026 window returned about nine months; a
2025 window returned about two months; 2024 and 2023 returned nothing.

Impact: no five-year charts, no long-term technical analysis, no backtests, no
multi-cycle comparisons. This alone fails the product requirement.

### B2 — Index daily history is unavailable

The index graph endpoint returns intraday 60-second points and ignores date
parameters. The daily index endpoint returned an empty array.

Impact: the market dashboard can show a live intraday sparkline, but not a
five-year NEPSE or sector index chart.

### B3 — Historical floorsheet is unavailable

The floorsheet endpoint ignores `businessDate` and always returns the current
day.

Impact: no historical broker accumulation/distribution, no broker
concentration trends, no historical block-deal analysis, no date-scoped
floorsheet reports.

### B4 — Fundamentals and corporate actions are missing

There is no verified source for EPS, ROE, ROA, P/E, book value, dividend
history, bonus/right issues, or quarterly history. There is no verified IPO,
rights, allotment, or lock-in feed.

Impact: company research, valuation, dividend-adjusted returns, IPO analysis,
and fundamental screening cannot be built to a trustworthy standard.

### B5 — Licensing and redistribution are unverified

The unofficial wrapper has no licence file and no commercial-use grant. The
exchange website terms were not verified for automated access, persistent
storage, derived analytics, or redistribution.

Impact: even the data that *is* technically available cannot be shipped to
clients without written permission or a commercial agreement.

### B6 — Survivorship bias and delisted history

The live wrapper focuses on non-delisted securities. Historical delisted and
suspended securities are not covered.

Impact: long-term backtests and “what happened to this company?” research would
be systematically biased.

## Secondary risks

- The authentication flow depends on an undocumented token/WASM mechanism that
  can change without notice.
- NEPSE holidays are not modelled; coverage thresholds allow for them, but a
  production calendar must be sourced and verified.
- Live quote timestamps are local-time strings without an explicit offset; the
  adapter normalizes them to Asia/Kathmandu (+05:45), but the source’s clock and
  timezone semantics need vendor confirmation.
- Official close vs. last-traded price needs clarification before using prices
  for valuation or P&L.

## What was built anyway

The Phase 0 harness is complete and provider-independent:

- `MarketDataProvider` contract with capability declarations.
- Policy enforcement that blocks unofficial/mock data in production.
- Provenance on every response: source, terms, reliability, `asOf`, age, stale.
- Mock, manual CSV, licensed REST, and external-command adapters.
- Validation checks for metadata, capabilities, company/security masters,
  five-year OHLC, index history, floorsheet date integrity, fundamentals and
  history, corporate actions, IPOs, live quotes, market summary, and health.
- Markdown + JSON reports and a CLI that exits non-zero on `no-go`.
- Unit tests for policy, freshness, provider contracts, and the validation
  orchestration.

The harness already encodes the five-year failure: an unofficial provider that
returns only recent data will fail `daily-ohlc-history` and `index-history`
rather than silently producing a one-year product.

## Gate limitations (added 2026-11-04)

The Phase 0 harness is necessary but not sufficient for Release 1. The current
checks:

- require only **four fundamentals periods** to pass (warn below twelve), so a
  gate `go` does not prove five years of financial history;
- test only the **previous trading day’s floorsheet**, not 60+ sessions of
  history;
- treat empty **corporate actions** and **IPOs** as warnings, not failures;
- have **no checks** for sector history, trading calendar, adjustment factors,
  delisted securities, news, broker flows, or mutual funds;
- measure history coverage against **Sun–Thu weekdays without holidays**, which
  can understate coverage for a complete provider if NEPSE trades fewer than
  roughly 235 sessions/year;
- require verified terms in production but do **not** inspect whether the
  contract permits local storage, offline use, or derived analytics.

Release 1 acceptance is defined in `docs/RELEASE1_DATA_REQUIREMENTS.md` and
`docs/PROVIDER_TRIAL_PROTOCOL.md`. Do not treat a gate `go` as proof that
Release 1 data is complete, and do not relax the gate to make a provider pass.

## Recommended next steps

1. **Prepare, do not send, the standardised RFQ.** Use
   `docs/PROVIDER_RFQ.md` for both MDP and ShareHub. Provider contact requires
   explicit project-owner approval; no provider has been contacted.
2. **Price the Release 1 dataset, then the options.** Use
   `docs/RELEASE1_DATA_REQUIREMENTS.md` for the mandatory R1 scope and the
   separate C1–C4 decisions (historical floorsheet, full statements, delisted
   history, historical intraday). Require line-item pricing and written
   redistribution/derived-analytics rights.
3. **Keep unofficial data out of production.** If it is used at all, use it
   through `CommandProvider` in development with `ALLOW_UNOFFICIAL_DATA=true`,
   and never merge it into a production database.
4. **Use manual CSV for a paid historical extract.** If a vendor supplies a
   one-time file, load it through `CsvProvider` with
   `MANUAL_DATA_LICENSED=true` only after legal confirmation.
5. **Re-run the gate.** `pnpm phase0:validate --provider licensed --env production`
   must produce `go` before production development starts.
6. **Decide the fallback explicitly.** If no licensed source can be secured,
   the product scope must change to a clearly labelled recent-data edition, or
   the project should not proceed as specified.

## Reproduction

The manual probes were run against the live site on 2026-11-04. They are not
part of the test suite because they depend on an unlicensed, unstable access
path. The provider harness itself is reproducible:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm phase0:validate --provider mock
```

Attach the resulting `reports/phase0-*.json` to any decision to change the
verdict.

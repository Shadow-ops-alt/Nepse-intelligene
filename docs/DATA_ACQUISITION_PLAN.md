# Data Acquisition Plan

Date: **2026-11-04**
Phase: **0.5 — Data Provider Investigation**
Status: planning only. No provider was contacted, no trial was started, no
subscription was purchased, and no production data was acquired.

This plan describes how to obtain and verify the data required by the product
without weakening the Phase 0 validation gate. The gate and the
`NO-GO for production` verdict in `docs/PHASE0_FINDINGS.md` remain in force.

> **Phase 0.5 addendum (2026-11-04).** The canonical Release 1 scope is now
> `docs/RELEASE1_DATA_REQUIREMENTS.md`; the standardised RFQ is
> `docs/PROVIDER_RFQ.md`; trial execution is
> `docs/PROVIDER_TRIAL_PROTOCOL.md`; the evidence comparison is
> `docs/PROVIDER_DECISION_MATRIX.md`. This plan remains the acquisition
> strategy. Where this document and the new documents differ, the new
> documents govern scope, RFQ wording, and trial acceptance. The Phase 0 gate
> is unchanged.

## 1. Purpose

The product needs ten categories of NEPSE data:

1. Five years of daily OHLCV.
2. Intraday prices.
3. Historical NEPSE index data.
4. Sector-wise data.
5. Company fundamentals.
6. Five-year financial history.
7. Floorsheet data.
8. Corporate actions.
9. IPO information.
10. Company news.

These ten categories are the original full-scope framing. They are **not all
Release 1 mandatory**; the formal classification is in
`docs/RELEASE1_DATA_REQUIREMENTS.md`. The provider comparison in
`docs/PROVIDER_COMPARISON.md` found that no single source is verified to deliver
all ten with acceptable rights. This plan defines:

- which source is authoritative for each category;
- which acquisition option to pursue first;
- how to validate a trial before committing;
- how to store provenance and corrections;
- what to do if a provider fails.

## 2. Planning assumptions

These are planning assumptions, not verified facts:

- The application is for **personal, single-user use** on a desktop.
- Data will be stored locally in SQLite and will not be resold.
- A paid subscription is acceptable **if** the price and terms are reasonable
  and the trial passes. No budget has been approved.
- The product must still support a future switch to a different provider
  without changing business logic or the frontend.
- Unofficial data remains development/validation only and is blocked in
  production by policy.
- NEPSE trades Sunday–Thursday, timezone Asia/Kathmandu (+05:45).

If any assumption is wrong, the recommendation must be revisited before a
purchase.

## 3. Decision summary

### Recommended path

**Evaluate MDP (Source Code) first as a single full-stack licence, with official
NEPSE/SEBON/CDSC sources as the verification layer. Keep ShareHub Professional
as the documented fallback and second market-data source.**

This is the only path that currently claims all hard categories, especially
historical floorsheet and multi-year financial reports. It is also the least
documented path, so it must be proven by trial before selection. This is an
**evaluation order, not a selection**. Under the recommended R1 scope
(C1-B/C2-B), historical floorsheet and full statements are R2 options, not R1
launch blockers; MDP’s R1 case then depends on its market-data and core metric
history as well as its written terms.

### Fallback path

**ShareHub Professional for market data + five-year core metric history (or
official NEPSE report PDFs for full statements, in R2) + SEBON/CDSC for issue
and lock-in data.**

This path is more transparent and easier to integrate, but it does not solve
historical floorsheet or a fully structured five-year statement history by
itself.

### Not acceptable

- Scraping NEPSE, MeroShare, NepseAlpha, or ShareSansar in production.
- Using yonepse, Aabishkar2, or Mendeley as the production feed.
- Buying a subscription before a trial and written terms.
- Treating a vendor's “NEPSE-licensed” claim as a redistribution grant.

## 4. Source-of-truth map

`Primary` is the intended production source. `Verification` is the source used
to check the primary. A primary source may be replaced later if the provider
contract changes, but the verification rule stays.

| Data domain | Primary candidate | Verification / fallback | Acquisition mode | Phase 0 check |
|---|---|---|---|---|
| Company and security master | ShareHub or MDP | NEPSE company list; CDSC registered companies | REST | `company-master`, `security-master` |
| Daily OHLCV, 5 years | ShareHub Professional (documented 5Y/ALL) or MDP | NEPSE website history; yonepse/Aabishkar2 for spot checks only | REST backfill | `daily-ohlc-history` |
| Live quotes | ShareHub or MDP | NEPSE live page; second feed during validation | REST polling | `live-quotes` |
| Intraday history | MDP if trial proves minute candles; otherwise not in scope | NEPSE intraday index only | REST or none | `index-intraday` (live only) |
| NEPSE index, 5 years | ShareHub or MDP | NEPSE official index history; Mendeley 2004–2024 close-only | REST backfill | `index-history` |
| Sector indices and sector performance | ShareHub or MDP | NEPSE sub-indices; ShareSansar/NepseAlpha screenshots | REST | `sector-data` |
| Current fundamentals | ShareHub or MDP | Company filings; NEPSE company pages | REST | `fundamentals` |
| Five-year financial statements | MDP if report coverage is proven; otherwise NEPSE PDFs + company filings | SEBON prospectuses; company annual reports; ShareSansar/NepseAlpha report pages | REST + PDF extraction | `fundamentals-history` |
| Floorsheet, current day | NEPSE official or MDP | ShareSansar current floorsheet | REST or manual file | `floorsheet-current` |
| Floorsheet, historical | MDP (claim) or NEPSE archive if available | yonepse archive for spot checks only | REST backfill | `floorsheet-history` |
| Corporate actions | MDP (claim) or ShareHub dividends/offerings + NEPSE/SEBON notices | CDSC lock-in; company notices; NepseAlpha/ShareSansar | REST + manual verification | `corporate-actions` |
| IPO / FPO / rights / lock-in | SEBON + CDSC for truth; ShareHub/MDP for convenience | MeroShare current issues; company prospectuses | Public files + REST | `ipos` |
| News and announcements | NEPSE disclosures or ShareHub announcements | ShareSansar/NepseAlpha news pages | REST + link-out | `news` |
| Trading calendar / holidays | NEPSE official | ShareHub holidays endpoint | REST + manual review | `calendar` |

## 5. Option analysis

### Option A — MDP full-stack (recommended to evaluate first)

**Scope:** market data, five-year OHLCV, index history, sectors, fundamentals,
financial reports, historical floorsheet, corporate actions, mutual funds.

**Pros**

- Only candidate claiming every hard category.
- Potentially one contract, one auth scheme, one support relationship.
- Public documentation lists the exact modules needed, including historical
  floorsheet and financial reports.
- An independent integrator confirms it pays for MDP and receives ticks,
  candle history, fundamentals, floorsheet, and news.

**Cons**

- Public docs stop at the section index; request/response schemas are missing.
- Base URL is a UAT host; no production host is published.
- No public pricing, terms, SLA, or historical-depth guarantee.
- “5–10 years” and “NEPSE-licensed” are vendor claims, not verified facts.
- A single vendor creates concentration risk, even with an adapter layer.
- Mutual fund coverage may be unnecessary for the MVP and may increase cost.

**Exit criteria before selection**

- Written quote for the required modules.
- Written personal-use, storage, derived-analytics, and redistribution terms.
- Production base URL and complete endpoint schemas.
- Trial passes `docs/PROVIDER_TRIAL_PROTOCOL.md` (the authoritative protocol;
  section 7 here is retained as the original proposal).
- NEPSE reseller status is current and covers the intended use.

### Option B — ShareHub + official filings (fallback)

**Scope:** ShareHub Professional for market data, index, sectors, ratios,
dividends, announcements, and public offerings; official PDFs/company filings
for statements; SEBON/CDSC for issue and lock-in truth.

**Pros**

- Best public API documentation of any candidate.
- Clear auth, token refresh, IP allow-list, rate-limit headers, and test mode.
- Explicit 5Y and ALL price-history options.
- Explicit 5Y/ALL index-history options for NEPSE, sensitive, float, and sector
  indices.
- Simpler to trial and integrate.
- Official documents provide a trustworthy audit trail.

**Cons**

- No documented floorsheet.
- No documented multi-year financial statements; only latest ratios.
- No documented adjusted-price factors.
- No public pricing or data-reuse terms.
- Historical depth must still be proven by trial.
- The statement pipeline requires PDF extraction and human review.

**Exit criteria before selection**

- Written quote and terms.
- Trial confirms 5Y/ALL for at least ten symbols across sectors and at least six
  indices (NEPSE, sensitive, float, plus three sector indices).
- Written confirmation on floorsheet, statements, and adjusted prices, even if
  the answer is “not available.”
- Official-document pipeline is staffed and repeatable.

### Option C — official/manual only (no paid API)

**Scope:** NEPSE website, SEBON files, CDSC lists, company reports, research
datasets for validation.

**Pros**

- Lowest direct cost.
- Highest documentary authority.
- No vendor lock-in.

**Cons**

- No stable API, rate limits, or bulk export.
- Five-year OHLCV and historical floorsheet are not reliably extractable.
- Manual effort is high and error-prone.
- Reuse/redistribution rights are unclear.
- Cannot pass the Phase 0 gate as specified.

**Verdict:** acceptable for validation and document collection, not for the
production data path.

## 6. Phased execution plan

### Step 0 — Freeze scope and data contract

Before contacting anyone:

- Confirm the MVP data domains and which are “must have” versus “nice to have.”
- Decide whether **historical floorsheet** is a launch requirement or a later
  feature. This single decision determines whether MDP is mandatory.
- Decide whether **five-year full statements** are required, or whether
  five-year ratio history is sufficient.
- Freeze the provider contract fields: symbol, date, open, high, low, close,
  volume, turnover, trades, adjusted flag, adjustment factor, source, asOf,
  fetchedAt, terms status.
- Keep the existing `MarketDataProvider` contract and policy. No business logic
  or frontend work starts here.

**Output:** a signed-off scope note. No provider contact yet.

### Step 1 — Prepare the request for quote

Prepare one requirements document covering:

- personal, single-user desktop use;
- local SQLite storage;
- derived analytics and charts;
- no resale, no public redistribution;
- five years of daily OHLCV for all listed equities;
- five years of NEPSE and sector index history;
- current fundamentals and five years of statements;
- current and historical floorsheet (state the required years);
- corporate actions with adjustment factors;
- IPO/FPO/right/lock-in coverage;
- delisted/suspended history;
- correction/errata process and SLA;
- rate limits, overage, and production base URL;
- permission to store and parse report PDFs.

**Output:** a reusable RFQ. Sending it requires explicit owner approval.

### Step 2 — Obtain written quotes and terms

Request written quotes from:

1. MDP / Source Code — full-stack and module-by-module.
2. ShareHub — Professional, plus any floorsheet/statement add-on.

Ask each vendor to confirm, in writing:

- the exact historical depth by dataset;
- whether prices are adjusted, and how factors are supplied;
- whether historical floorsheet is included and for how many years;
- whether delisted/suspended securities are included;
- whether report PDFs may be stored and parsed;
- the definition of permitted use and redistribution;
- the production base URL, versioning, and deprecation policy;
- the correction process for bad ticks, missing days, and restatements.

**Output:** a comparison of written offers, not marketing pages.

### Step 3 — Run a bounded trial

Do not backfill the full universe first. Use a representative sample:

- **Equities:** 10 symbols across banking, hydropower, insurance, microfinance,
  manufacturing, hotels, and “other.”
- **Indices:** NEPSE, sensitive, float, and at least three sector indices.
- **Period:** the trailing five years ending on the last complete trading day
  before the trial (for a trial starting 2026-11-04: **2021-11-04 → 2026-11-03**),
  plus the most recent 60 sessions for floorsheet if historical floorsheet is in
  scope. A `2019-01-01 → present` request is an **optional depth stress probe**,
  not the five-year acceptance window. See
  `docs/PROVIDER_TRIAL_PROTOCOL.md` §3 for the correction.
- **Statements:** five companies with continuous listing and at least five
  annual reports.
- **Corporate actions:** at least five companies with bonus, right, and cash
  dividends in the period.
- **Live:** one full trading session.

Store every raw response unchanged, with URL, headers, timestamp, and a content
hash. Do not normalize in place.

**Output:** a trial corpus and a provider evidence pack.

### Step 4 — Validate against official sources

Run the acceptance protocol in `docs/PROVIDER_TRIAL_PROTOCOL.md` (section 7
here is the original proposal and is superseded where they differ). Every
failure is recorded with the exact query, response, and expected value. Do not
“fix” a vendor series by silently splicing another source.

**Output:** pass/fail report per dataset, plus a list of corrections or
clarifications sent back to the vendor.

### Step 5 — Reconcile and load through the existing adapters

- If the vendor supplies a one-time historical extract, load it through
  `CsvProvider` with `MANUAL_DATA_LICENSED=true` only after written confirmation.
- If the vendor supplies a REST API, use `LicensedRestProvider`.
- Record source, terms, reliability, `asOf`, fetchedAt, and adjustment metadata
  on every record.
- Keep raw snapshots in `data/raw/` (gitignored) and normalized tables in
  SQLite.
- Do not merge vendor and unofficial data in one series. If a source switch is
  unavoidable, record it explicitly in metadata.

**Output:** a reproducible ingestion run and a data lineage report.

### Step 6 — Re-run the Phase 0 gate

Run the existing gate against the licensed provider in production mode:

```bash
pnpm phase0:validate --provider licensed --env production
```

The gate must produce `go`. A `conditional` result is not sufficient for
production UI or portfolio logic. Attach the report and the trial evidence to
the decision.

**Output:** go/no-go decision with evidence.

## 7. Acceptance protocol

These thresholds are retained as the original proposal. The authoritative
thresholds, rationale, and error taxonomy are now in
`docs/PROVIDER_TRIAL_PROTOCOL.md` §7–§8. Where they differ, the protocol governs.
In particular, the 2019 window in §6 step 3 is not an acceptance window, and the
Phase 0 gate is not modified by either document.

### 7.1 Five-year daily OHLCV

- At least **1,100 trading days** per sampled symbol over five years (roughly
  220 sessions/year).
- No unexplained gap longer than **5 consecutive trading days**.
- At least **95%** coverage against the official trading calendar.
- OHLC invariants: `low <= open <= high`, `low <= close <= high`,
  `volume >= 0`, `turnover >= 0`.
- Zero-price or zero-volume rows are explained (suspension, no trade, holiday).
- Close prices reconcile to official NEPSE closes on at least 20 random dates.
- Adjusted and unadjusted series are both available or the adjustment method is
  documented and reproducible.

### 7.2 Index history

- NEPSE index: at least **1,100 daily points** over five years.
- At least **3 sector indices**: same period and coverage threshold.
- Cross-check 20 random dates against NEPSE's official index page.
- Cross-check the long history against the Mendeley close-only series where the
  dates overlap; explain differences.
- Intraday index points, if offered, are timestamped and session-bounded.

### 7.3 Floorsheet

- **60 consecutive trading sessions** of historical floorsheet.
- `businessDate` / trade date is honored on every request; no current-day
  fallback.
- Broker IDs, contract IDs, symbol, quantity, rate, and amount present.
- No duplicate contract IDs within a session.
- Daily floorsheet turnover reconciles to the official daily turnover within
  **0.5%** (or the vendor's documented exclusion rule, such as sub-10-share
  trades).
- At least 20 random trades reconcile to the official NEPSE floorsheet.

### 7.4 Fundamentals and financial statements

- **20 quarters** and **5 annual periods** for at least five companies.
- Reported date, fiscal period, statement type, and restatement flag present.
- Balance sheet balances within **0.1% or one reporting unit, whichever is
  larger** (assets = liabilities + equity), as refined in
  `docs/PROVIDER_TRIAL_PROTOCOL.md` §7.2.
- Net profit and EPS reconcile to the official PDF for at least five company-
  years.
- Missing values are explicit, not zero-filled.
- Restatements are versioned; the old value is not overwritten.

### 7.5 Corporate actions

- At least five companies with bonus, right, and cash dividends in the period.
- Announcement date, book-close/record date, ex-date, and adjustment factor
  present.
- Price series adjusted consistently across the ex-date.
- A known bonus/right event reconciles to the official notice.
- Mergers, splits, and symbol changes are either covered or explicitly marked
  out of scope.

### 7.6 IPO / FPO / rights / lock-in

- At least 20 issues from SEBON/CDSC cross-checked against the provider.
- Status, type, investor category, open/close dates, and allotment data present
  where applicable.
- Lock-in notices reconcile to CDSC PDFs for at least five companies.
- No invented issue dates or prices.

### 7.7 Live data

- One full trading session observed.
- Quote freshness within **60 seconds** during the session.
- No stale quote older than **5 minutes** without a stale flag.
- Live OHLC and previous close are internally consistent.
- End-of-day close reconciles to the official close.

### 7.8 Provenance and policy

- Every record has `source`, `termsStatus`, `reliability`, `asOf`, `fetchedAt`.
- Every raw response is stored with a hash.
- The production policy blocks `unofficial`, `mock`, and `unverified` sources.
- No data from yonepse/Aabishkar2/Mendeley/NepseAlpha/ShareSansar is present in
  the production database.
- A source switch is recorded, not hidden.

## 8. Data storage and lineage

### Raw layer

- Store the original response or file unchanged.
- Include request URL, query, headers, HTTP status, fetch time, and SHA-256 hash.
- Keep raw files out of git (`data/raw/` is ignored).
- Retain enough history to reproduce a normalized row.

### Normalized layer

- One row per security per trading day per source.
- Adjusted and unadjusted prices are separate fields or separate series.
- Store `adjustmentFactor`, `adjustmentDate`, and `adjustmentReason`.
- Store `reportedDate` and `periodEnd` separately for fundamentals.
- Never overwrite a restatement; add a new version and mark the old one
  superseded.

### Document layer

- Store company report PDFs, SEBON prospectuses, CDSC lock-in notices, and NEPSE
  notices with URL, hash, and retrieval date.
- Extracted tables carry a `parserVersion` and a `reviewStatus`
  (`unreviewed`, `approved`, `rejected`).
- A human approves any extracted figure used in production analytics.

### Provenance rules

- Never show a price without `asOf` and freshness.
- Never mix sources in one series without a recorded source switch.
- Never compute indicators across a corporate action without adjusted prices or
  an explicit unadjusted warning.
- Never hide a missing capability behind an empty array.

## 9. Operating cadence

| Job | Timing (Asia/Kathmandu) | Notes |
|---|---|---|
| Live quotes | Every 20–60s during trading hours | Respect vendor rate limits; back off on 429. |
| End-of-day OHLCV | After market close, ~16:00–17:00 | Reconcile to official close. |
| Floorsheet | After publication, ~16:00–17:00 | Current day; backfill history separately. |
| Index and sector | After close | Same cadence as OHLCV. |
| Corporate actions | Daily | Check NEPSE/SEBON/CDSC notices. |
| Financial reports | Weekly, and on announcement | Extract, review, version. |
| IPO/right/lock-in | Daily during issue windows | Cross-check SEBON and CDSC. |
| Full reconciliation | Monthly | Random samples against official sources. |
| Provider health | Every run | Record latency, errors, stale flags. |

NEPSE holidays and unscheduled closures must be modelled explicitly. Do not
infer a holiday from an empty response.

## 10. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| MDP cannot provide written terms or production docs | Medium | High | Treat ShareHub + official filings as the fallback; do not pay before terms. |
| ShareHub 5Y/ALL returns a shorter window | Medium | High | Trial on 10 symbols and at least six indices (NEPSE, sensitive, float, plus three sectors) before purchase; fail the gate if short. |
| No provider has five-year statements | High | High | Build a PDF extraction + human review pipeline; scope the first release to five years for a subset if necessary. |
| Historical floorsheet is unavailable or too expensive | Medium | High | Decide whether it is launch-critical; otherwise defer broker-history features. |
| Vendor “adjusted” prices are wrong | Medium | High | Recompute adjustment factors from official corporate actions and reconcile. |
| Delisted history is missing | High | Medium | Disclose survivorship bias; limit backtests to the current universe until solved. |
| Rate limits block a full backfill | Medium | Medium | Batch, cache, and backfill over days; ask for a higher limit or a bulk extract. |
| Vendor changes API or base URL | Medium | Medium | Keep the adapter boundary; record version; monitor deprecations. |
| Licence forbids local storage or derived analytics | Medium | High | Get written permission before purchase; otherwise use a different provider or scope. |
| Official PDFs are inconsistent or scanned | High | Medium | Human review, parser versioning, and a “missing” state. |
| Unofficial data leaks into production | Low | High | Policy enforcement and tests already block it; keep it that way. |
| Price or terms change after trial | Medium | Medium | Buy only after a written quote with a validity period. |

## 11. Cost and procurement

No public price was found for ShareHub or MDP. NepseAlpha and ShareSansar are
paid, but their exact prices were not verified from the live pages during this
review. No budget can be set responsibly yet.

Request quotes for these line items separately so the mandatory cost is visible:

1. Base market-data subscription (live + EOD).
2. Five-year historical backfill.
3. Historical floorsheet.
4. Financial statements / fundamentals history.
5. Corporate actions and adjustment factors.
6. IPO/right/lock-in module.
7. Additional users or redistribution rights.
8. Overage/rate-limit tier.
9. Support/SLA.

Do not accept a bundled “all-in” price without a line-item breakdown. Do not
pay for mutual fund data unless it is in the MVP.

## 12. Decision points for the project owner

These require an explicit decision before provider contact or purchase:

1. **Historical floorsheet:** launch requirement, later feature, or out of
   scope?
2. **Five-year statements:** full statements, ratio history, or documents only?
3. **Budget ceiling:** what is acceptable per year for a personal app?
4. **Distribution:** strictly personal, family use, or public?
5. **Intraday history:** required, or is live intraday plus EOD enough?
6. **Delisted history:** required for backtests, or can the first release
   disclose survivorship bias?
7. **News:** display/link only, or store and redistribute?
8. **Provider contact:** approve sending the RFQ to MDP and ShareHub.

These map to the formal decision records C1–C8 in
`docs/RELEASE1_DATA_REQUIREMENTS.md` §5 and the ten owner decisions in §12 of
that document. The release document is authoritative if the wording differs.

Until these are answered, the correct action is to stay on mock/CSV data and
keep the production gate closed.

## 13. Immediate next actions

1. **Owner decision:** answer the eight questions in section 12. This is the
   blocking input.
2. **Use the standardised RFQ:** send the identical `docs/PROVIDER_RFQ.md` to
   both providers, but only after owner approval. Do not send it yet.
3. **Prepare the trial corpus plan:** 10 symbols, 3+ indices, 60 floorsheet
   sessions (if C1), 5 companies, and the trailing five-year window
   (2021-11-04 → 2026-11-03 for a 2026-11-04 trial). A 2019 request is an
   optional depth probe, not the acceptance window.
4. **Prepare the official-document checklist:** NEPSE report PDFs, SEBON public
   issue files, CDSC lock-in notices, company annual reports.
5. **On approval only:** request written quotes and trial access from MDP and
   ShareHub.
6. **On trial only:** run `docs/PROVIDER_TRIAL_PROTOCOL.md` (section 7 here is
   the original proposal).
7. **Only after a pass:** load through the licensed adapter and re-run
   `pnpm phase0:validate --provider licensed --env production`.

## 14. Phase 0 gate remains unchanged

This plan does not authorize production work. The gate still requires:

- five years of daily OHLCV;
- five years of index history;
- historical floorsheet with date integrity;
- fundamentals and history;
- corporate actions;
- IPOs;
- live quotes and market summary;
- metadata, provenance, and policy compliance.

`pnpm phase0:validate --provider licensed --env production` must return `go`
before any production UI, portfolio logic, or backtest is built.

If no licensed source can pass the gate:

- reduce the product scope to a clearly labelled recent-data edition, or
- stop the project as specified.

Either choice is a product decision, not a data-provider workaround.

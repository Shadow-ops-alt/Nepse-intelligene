# Provider Trial Protocol

Date: **2026-11-04**
Status: **ready to execute only after project-owner approval.** No provider has
been contacted, no trial account has been created, and no trial data exists.
This protocol does not change the Phase 0 gate or the NO-GO verdict.

Related documents:

- `docs/RELEASE1_DATA_REQUIREMENTS.md` — what R1 must contain.
- `docs/PROVIDER_RFQ.md` — the written questions the trial verifies.
- `docs/PROVIDER_DECISION_MATRIX.md` — how trial results feed the decision.
- `docs/PHASE0.md` — the unchanged validation gate.
- `docs/PHASE0_FINDINGS.md` — Phase 0 evidence.

## 1. Purpose and scope

This protocol defines a bounded, repeatable trial for **MDP** and **ShareHub**
using **identical test datasets**. It answers four questions:

1. Does the provider actually supply the R1 dataset at the required depth?
2. Is the data correct against authoritative sources?
3. Are the differences errors, missing data, documented exclusions, or
   methodology differences?
4. Do the written terms permit the intended personal, single-user,
   local-SQLite, offline, derived-analytics use?

The trial **supplements** the Phase 0 gate. It does not replace it, weaken it,
or authorise production. A trial pass is necessary but not sufficient for R1.

## 2. Preconditions

Do not start until all are true:

- the project owner has approved provider contact and trial access;
- the owner has signed the C1–C4 scope decisions in
  `docs/RELEASE1_DATA_REQUIREMENTS.md` §5;
- written RFQ answers, draft terms, and samples have been received;
- legal review has confirmed that trial storage and evaluation are permitted;
- a local, access-controlled trial workspace exists outside production;
- the provider has supplied production or test credentials and documented rate
  limits;
- the trial corpus in §4 is frozen and hashed before the first request.

No purchase, auto-renewal, or production import is allowed during the trial.

## 3. Trial clock and windows — correction of the 2019 inconsistency

### 3.1 Definitions

- **T** = the last complete NEPSE trading day before the trial start.
- **W5** = the trailing five-year acceptance window:
  **T minus five years plus one day → T**.
- **W7** = the optional depth stress window: **2019-01-01 → T**.
- **W60** = the 60 consecutive trading sessions ending at T, used only if C1
  (historical floorsheet) is in scope.
- **LIVE** = one full NEPSE trading session after approval.

### 3.2 Example for a trial starting 2026-11-04

| Window | Dates | Sun–Thu weekdays | Purpose |
|---|---|---|---|
| **W5** | **2021-11-04 → 2026-11-03** | **1,304** | Five-year acceptance window. All five-year thresholds apply here. |
| **W7** | 2019-01-01 → 2026-11-03 | 2,046 | Optional depth stress probe. Not an acceptance window. |
| **W60** | 60 sessions ending 2026-11-03 | 60 sessions | Historical-floorsheet test if C1-A. |
| **LIVE** | next full trading session | 1 session | Live quote/summary test. |

### 3.3 Correction

The earlier plan proposed “2019-01-01 to the latest complete trading day” as the
trial period while also requiring five years and 1,100 trading days. That was
inconsistent:

- 2019-01-01 → 2026-11-03 is about 7.8 years and 2,046 Sun–Thu weekdays;
- 1,100 days is about **53.8%** of that window, roughly 3.5 years of sessions;
- a provider could therefore miss two years of the 2019 window and still exceed
  1,100 days.

**The acceptance window is W5.** W7 is a separate, optional depth probe:

- W7 is requested for NEPSE and three sampled equities only;
- W7 results are recorded as “depth evidence,” not pass/fail for the five-year
  requirement;
- if the owner decides that 2019–present is a real requirement, the requirement
  must be renamed (approximately 7.5–8 years) and the threshold derived from the
  official calendar (roughly 1,750–1,850 sessions), not reused from W5.

### 3.4 Date rules

- Use Asia/Kathmandu (+05:45) for all market dates.
- A “trading day” is an official NEPSE session, not every Sun–Thu weekday.
- Do not infer a holiday from an empty response. Use the official calendar (D03)
  and record the source.
- If T is a holiday or the market is closed, move T back to the previous official
  session.
- Record the exact request and response dates for every test.
- The Phase 0 gate computes its window through “today” in Asia/Kathmandu, which
  may include an incomplete session. The trial uses the last **complete** trading
  day. The one-day difference is intentional and does not change the threshold;
  record both dates in the report.

## 4. Identical test corpus for both providers

The same symbols, indices, dates, and request parameters must be used for MDP
and ShareHub. Any substitution must be applied to **both** providers and
recorded.

### 4.1 Equities (10 primary + reserves)

The symbols below are **provisional**. Before the first request, confirm each
symbol’s listing status and five-year continuity against the provider’s company
master and the official NEPSE list. If a symbol is not continuously listed,
replace it with a reserve from the same sector and re-run both providers.

| Sector | Primary | Reserves |
|---|---|---|
| Commercial bank | NABIL, SCB, ADBL | NICA, EBL |
| Hydropower | NHPC, API | SHPC, UPPER |
| Life insurance | NLIC | SICL |
| Non-life insurance | HGI | NIL |
| Microfinance | NUBL | GMFIL |
| Manufacturing | UNL | SHIVM |
| Hotel/tourism | SHL | — |

Select 10 primary symbols with at least one from each sector. If a sector has no
continuously listed symbol for W5, record the exclusion and use a second symbol
from the nearest sector; apply the same change to both providers.

### 4.2 Indices

Request W5 history for:

- NEPSE;
- NEPSE Sensitive;
- NEPSE Float (or the provider’s float index);
- Banking;
- Hydropower;
- Insurance;
- one additional sector if available (for example, Manufacturing).

If an index is unavailable, record it and substitute the closest published
sector index for both providers.

### 4.3 Fundamentals and statements

- **D10 core metrics:** 5 companies with continuous listing and five years of
  filings: NABIL, SCB, NLIC, UNL, and one hydropower company (NHPC or API).
- **C2 full statements:** the same 5 companies, five audited fiscal years, plus
  20 quarters where available.
- If a company changed its fiscal year or merged, record it and substitute a
  comparable company for both providers.

### 4.4 Corporate actions

Select at least five companies/events from W5 covering:

- at least one bonus issue;
- at least one right issue;
- at least one cash dividend;
- at least one split or merger if one exists in the sample;
- at least one event with a nontrivial adjustment factor.

Use official NEPSE/SEBON/company notices as the truth source. Record the exact
notice URL/PDF and date.

### 4.5 IPO/FPO/right/debenture issues

- 20 issues from W5, cross-checked against SEBON and CDSC.
- Include at least 5 IPO, 5 FPO/right, and 5 debt/other if available.
- Include current/open/upcoming issues as well as closed/allotted history.
- If fewer than 20 exist in W5, use all available and state the count.

### 4.6 Floorsheet

- **R1 current-day:** T (or the most recent session if T is a holiday).
- **C1 historical:** W60 (60 consecutive sessions ending T).
- If C1 is deferred, still test 5 recent sessions to prove the date parameter is
  honoured; do not claim historical coverage.

### 4.7 Delisted and intraday (conditional)

- **C3 delisted:** 5 delisted/suspended securities from the official NEPSE
  archive, including at least one symbol change and one merger.
- **C4 historical intraday:** one liquid symbol, 20 consecutive sessions, all
  available intervals; one index if offered.

### 4.8 Live session

Observe one full trading session:

- pre-open/open (if available);
- at least every 5 minutes during the session;
- the close and the first EOD publication;
- one forced reconnect/backoff test.

### 4.9 Corpus freeze

Before the first request, write a corpus manifest with:

- provider name;
- trial ID and start date;
- every symbol/index/date range;
- every request URL/parameter set;
- expected row counts;
- SHA-256 of the manifest.

Both providers must receive the same manifest (provider-specific auth removed).

## 5. Evidence capture and chain of custody

For every request, store:

- provider, trial ID, test ID;
- exact URL, path, query, and headers (redact secrets);
- HTTP status, response headers, rate-limit headers;
- request time and response time;
- raw response body, unchanged;
- SHA-256 of the raw body;
- pagination cursor/sequence;
- retry/backoff history.

Rules:

- Store raw responses **before** normalisation. Never edit a raw response.
- Keep a separate normalised copy; record the adapter/parser version.
- Use an immutable trial directory: `data/trial/<provider>/<trial-id>/raw/`.
- Keep the corpus out of git.
- Record every substitution and every failed request.
- Do not merge provider data with unofficial data in the same series.
- Do not publish trial data.

## 6. Test suite

Each test returns **PASS**, **PASS WITH EXCEPTIONS**, **FAIL**, or **NOT TESTED**.
“PASS WITH EXCEPTIONS” requires a documented exclusion or a methodology
difference accepted under §8.

| ID | Test | Method | Pass criteria | Gate link | Failure severity |
|---|---|---|---|---|---|
| **T0** | Metadata, contract, policy | Inspect descriptor, terms, `sourceType`, `termsStatus`, `productionReady`, capabilities, limits; run the policy check | No false production claim; terms status truthfully `verified` only with written terms; every declared capability has a method; no unofficial/mock source | `provider-metadata`, `runtime-policy`, `capability-coverage` | S1 |
| **T1** | Company/security master | Fetch full master; compare counts and 20 sampled symbols to official NEPSE; check duplicates, sectors, instrument types, status, orphan securities | ≥99% of official active symbols present; zero duplicates; 100% of sampled symbols resolve to a company; delisted flag correct where claimed | `company-list`, `security-list` | S1 for missing master; S2 for field gaps |
| **T2** | Trading calendar | Fetch calendar for W5 plus 12 months forward; compare 12 months to official NEPSE holidays/closures | 100% match for sampled sessions; no holiday inferred from an empty response; forward calendar available or explicitly not offered | No gate check | S1 for wrong sessions; S2 for no forward calendar |
| **T3** | Daily OHLCV, W5 | Request 10 symbols for W5; check row count, dates, duplicates, OHLC invariants, gaps, coverage; reconcile 20 random closes to official NEPSE | ≥95% official sessions per liquid symbol; ≥1,100 rows per symbol; no unexplained gap >5 sessions; 100% OHLC invariants; zero duplicates; ≥19/20 closes within tolerance | `daily-ohlc-history` | S1 for <75% or no five-year window; S2 for 75–95% |
| **T4** | Index history, W5 | Request NEPSE, Sensitive, Float for W5; reconcile 20 dates to official NEPSE index page | ≥95% official sessions; ≥1,100 points; zero duplicate dates; ≥19/20 values within tolerance | `index-history` | S1 |
| **T5** | Sector indices, W5 | Request 3+ sector indices for W5; check coverage and membership snapshot | Same coverage as T4 for 3+ sectors; current membership documented; reclassification method stated | No gate check | S2 |
| **T6** | Live quotes and summary | Observe one full session; sample every 5 minutes; compare close to official; check arithmetic and stale flags | ≥95% of samples ≤60s old; no >5-minute stale quote without flag; EOD close reconciles; summary turnover/transactions consistent | `live-quotes`, `market-summary` | S1 for stale/incorrect close; S2 for summary mismatch |
| **T7** | Corporate actions | Fetch W5 actions for 10 symbols; compare 5+ events to official notices; check dates, type, ratio/amount, source | 100% of sampled events match official notice; no invented dates; source URL/ID present | `corporate-actions` | S1 for wrong event dates; S2 for missing source |
| **T8** | Adjustment factors | Recompute factors for 5 events from official notices; compare to provider adjusted series/factors; check continuity across ex-date | All 5 factors reproducible within 0.1%; adjusted series continuous; unadjusted series retained | No explicit gate check | S1 for wrong factor; S2 for undocumented method |
| **T9** | Current fundamentals | Fetch latest snapshot for 10 symbols; compare 5 companies to official reports; check definitions and confidence labels | ≥5 companies reconcile; no zero-filled missing values; period/reported date present | `fundamentals-latest` | S1 for systematically wrong values; S2 for field gaps |
| **T10** | Core fundamentals history | Fetch W5 history for 5 companies; count periods; check 20Q/5A, labels, restatements; reconcile 5 company-years | 20 quarters and 5 annual periods for ≥5 companies; ≥5 company-years reconcile; missing explicit; restatements versioned | `fundamentals-history` (**gate gap**) | S1 for <4 periods or no history; S2 for 4–19 quarters |
| **T10b** | Full statements (C2) | Fetch BS/IS/CF for 5 companies, 5 years; check balance sheet, net profit, EPS, cash flow; compare to audited PDFs | Assets = liabilities + equity within max(0.1%, one reporting unit); net profit/EPS reconcile for 5 company-years; restatements versioned | No gate check | S1 for systemic errors; S2 for isolated |
| **T11** | Current-day floorsheet | Fetch T; check business date, contract IDs, broker IDs, fields; reconcile turnover and 20 trades to official NEPSE | 100% of rows on requested date; zero duplicate contract IDs; turnover within 0.5% or documented exclusion; ≥19/20 trades match | `floorsheet` | S1 for wrong date or missing broker IDs |
| **T12** | Historical floorsheet (C1) | Fetch W60; check date scoping, coverage, duplicates, turnover; compare 20 trades across 5 sessions | 60/60 sessions returned; date honoured 100%; turnover within 0.5% or documented exclusion; no duplicate contracts | No gate depth check | S1 for current-day fallback; S2 for gaps |
| **T13** | IPO/FPO/right pipeline | Fetch current + historical issues; compare 20 to SEBON/CDSC; check status, dates, price, type | ≥20 issues; 100% status/date match; no invented data | `ipos` (**empty is warning**) | S1 for wrong status/dates; S2 for missing history |
| **T13b** | Allotment/lock-in (C8) | Compare 5 allotment results and 5 lock-in notices to CDSC | 100% match; source URL present | No gate check | S2 |
| **T14** | Delisted/suspended (C3) | Fetch 5 delisted/suspended securities; check listing/delisting dates, last price, symbol history | 5/5 present with dates and reason; historical prices available | No gate check | S1 if claimed and missing; S2 if partial |
| **T15** | Historical intraday (C4) | Fetch 20 sessions for one symbol; check interval, timestamps, session bounds, coverage | 20/20 sessions; timestamps session-bounded; no duplicate bars; interval documented | `intraday-ohlc` (warning only) | S2 |
| **T16** | News (optional) | Fetch 20 announcements; compare to official; check storage/display rights | 20/20 correct; licence permits intended display | `news` (preferred only) | S3 |
| **T17** | Mutual funds (optional) | Fetch 5 funds' NAV/holdings; compare to official | 5/5 correct; depth stated | `mutualFundHoldings` (not required) | S3 |
| **T18** | Rate limits and reliability | Run a controlled polling/backfill load; observe 429/backoff, latency, errors, reconnect | No unexpected 429 under documented limits; backoff works; error codes documented; no data corruption on retry | Provider health | S1 for blocking limits; S2 for instability |
| **T19** | Persistence, offline, provenance | Store corpus in local SQLite; disconnect network; read charts/analytics; verify provenance and raw hashes | 100% of synced data readable offline; provenance on every record; raw hash matches; no silent overwrite | No gate check | S1 for data loss; S2 for missing provenance |

### 6.1 Test sequencing

1. T0 before any data request.
2. T1/T2 to freeze the universe and calendar.
3. T3–T5 for history.
4. T7/T8 before adjusted-return analysis.
5. T9/T10 before fundamental analysis.
6. T11/T12 for floorsheet.
7. T6 on a live session.
8. T13–T17 as scoped.
9. T18/T19 after the data tests, using the stored corpus.

### 6.2 Sampling rules

- Use a deterministic random seed recorded in the manifest.
- Stratify by sector and liquidity.
- For “20 random dates,” include at least 5 dates with known corporate actions
  and 5 dates near month/quarter boundaries.
- If any sampled date fails, expand the sample to 50 dates before deciding.
- Do not choose dates after seeing provider output.

## 7. Thresholds and rationale

This section reviews every numerical acceptance threshold. Thresholds marked
**gate** are enforced by the existing Phase 0 harness and are not changed by
this document. Thresholds marked **trial** are stricter or additional.

### 7.1 History coverage

| Threshold | Source | Rationale | Failure treatment |
|---|---|---|---|
| **Five years = trailing 60 months** | Gate + trial | Matches the product promise and the gate’s `historyWindow`. Prevents the 2019–present ambiguity. | Wrong window = S1 |
| **≥1,100 trading days per sampled symbol** | Trial | 220 sessions/year × 5. NEPSE typically trades roughly 225–245 sessions/year (planning assumption; verify with the official calendar), so 1,100 is a conservative floor, not a target. It catches a provider that returns only 3–4 years. | <1,100 = FAIL for that symbol |
| **≥95% of official sessions** | Trial | Allows ~1 in 20 sessions for suspensions, closures, or corrections. Liquid symbols should be near 100%; illiquid symbols are assessed separately. | <95% = S2; <75% = S1 |
| **No unexplained gap >5 consecutive sessions** | Trial | Normal holiday clusters can create 2–4 day gaps. A 5+ session gap suggests a missing block. Suspensions are excluded only if the status is documented. | Unexplained gap = S2 |
| **≥90% of Sun–Thu weekdays** | **Gate** | A holiday-agnostic proxy. It is intentionally conservative but can be too strict if NEPSE’s official session count is below ~235/year. Do not change the gate in this task; flag the calibration to the owner if it fails a complete provider. | <90% = warn; <75% = fail |
| **Start lag ≤45 days** | **Gate** | Allows holidays and listing delays. The trial tightens this to **10 sessions** for liquid symbols. | >45 days = gate fail; >10 sessions = trial S2 |
| **Latest lag ≤10 days / ≤30 days** | **Gate** | 10 days covers weekends/holidays; 30 days is the fail boundary. The trial requires the latest data to be ≤5 sessions old for liquid symbols during an active market. | >30 days = fail; >5 sessions = S2 |
| **≥1,100 index points** | Trial | Same five-year logic as equities. Index data should have no suspension excuse. | <1,100 = FAIL |
| **At least 3 sector indices** | Trial | Banking, hydropower, and insurance are large, distinct sectors; a third sector reduces the chance of a single-index artifact. | Missing = S2 |
| **20 random close/index dates** | Trial | A practical spot check for systematic shifts. It is not statistical proof; any failure expands the sample to 50. | ≥1 mismatch = investigate; ≥3 = S1 |
| **20 random floorsheet trades** | Trial | Catches broker/contract/amount mismatches without a full manual reconciliation. | Any mismatch triggers full-day review |
| **60 consecutive floorsheet sessions** | Trial (C1) | About three months, enough to test date scoping, corrections, and broker patterns. It is not a five-year history guarantee; if C1-A requires five years, add multi-year spot checks. | <60/60 = S2; current-day fallback = S1 |
| **0.5% floorsheet turnover tolerance** | Trial | Covers rounding and documented odd-lot/sub-10-share exclusions. If the vendor excludes a class, the expected difference must be recomputed and disclosed. | >0.5% unexplained = S2 |
| **One full live session** | Trial | Captures open/close, rate limits, reconnects, and EOD reconciliation. | Missing = S1 for live capability |
| **60-second quote freshness** | Trial | About 3× ShareHub’s documented ~20s cadence and 4× MDP’s claimed ~15s. Allows jitter and clock skew without hiding staleness. If the vendor’s documented cadence is slower, use 2× cadence but never >60s without a visible delay label. | >60s = S2; >5 min = S1 |
| **5-minute stale flag** | Trial | Distinguishes a transient delay from a stale feed. The UI must show the flag. | Missing flag = S1 |
| **7-day live-quote gate** | **Gate** | Only proves the feed is alive, not fresh. It is not a product freshness threshold. | >7 days = gate fail |

### 7.2 Fundamentals and statements

| Threshold | Source | Rationale | Failure treatment |
|---|---|---|---|
| **20 quarters + 5 annual periods** | Trial (D10) | Five years of quarterly and annual data. Quarterly data is needed for trend analysis; annual alone hides seasonality. | <4 periods = S1; 4–19 quarters = S2 |
| **≥5 companies** | Trial | Cross-sector sample; detects systematic definitions and extraction errors. It is not a statistical sample of the whole market. | <5 = S2 |
| **≥5 company-years reconciled** | Trial | Balances effort against coverage; catches systemic net-profit/EPS errors. | Any material mismatch = S1/S2 |
| **Balance sheet within max(0.1%, one reporting unit)** | Trial | 0.1% is tight but can be impossible with rounded NPR millions. Using the larger of 0.1% or one reported unit avoids false failures. | Beyond tolerance = S2 |
| **4 periods to pass the gate** | **Gate** | One year of quarterly data. It is a gate minimum, **not** five-year compliance. | <4 = gate fail; 4–11 = gate warn |
| **12 periods to avoid a gate warning** | **Gate** | Three years of quarterly data. Still not five years. | <12 = gate warn |

### 7.3 Corporate actions and issues

| Threshold | Source | Rationale | Failure treatment |
|---|---|---|---|
| **≥5 companies with bonus, right, cash** | Trial | Covers the three event types that most affect adjusted returns. | Missing a type = S2 |
| **100% of sampled events match official notice** | Trial | Corporate-action errors corrupt every adjusted return. There is no acceptable error rate for the sampled events. | Any wrong date/factor = S1 |
| **Factor reproducible within 0.1%** | Trial | Allows rounding in published ratios. A larger difference means the method differs. | >0.1% = S2; undisclosed method = S1 |
| **≥20 issues cross-checked** | Trial | Enough to detect status/date/type errors across IPO, FPO/right, and debt. | <20 available = record actual; wrong status = S1 |
| **≥5 lock-in notices (R2)** | Trial | CDSC notices are the authority; five detects systematic mapping errors. | Missing = S2 |

### 7.4 Delisted and intraday (conditional)

| Threshold | Source | Rationale | Failure treatment |
|---|---|---|---|
| **5 delisted/suspended securities** | Trial (C3) | Includes at least one symbol change and one merger; five detects whether coverage is real. | Missing = S1 if C3-A |
| **20 intraday sessions** | Trial (C4) | Enough to test session bounds, intervals, and gaps without a large backfill. | Missing = S2 |

### 7.5 Why these thresholds are not “precision”

These are **screening thresholds**, not statistical guarantees. They are chosen
to catch the failure modes that would invalidate the product:

- a one-year feed presented as five years;
- a current-day floorsheet presented as history;
- latest ratios presented as five-year fundamentals;
- dividends presented as adjustment factors;
- live quotes presented as real-time when they are days old;
- a vendor claim presented as a licence.

Any threshold can be tightened after the first trial if it fails to catch a
real defect. It must not be loosened merely to make a provider pass.

## 8. Error taxonomy and classification

Every discrepancy must be classified before it is counted. The goal is to
separate **provider errors** from **missing data**, **documented exclusions**,
**methodology differences**, and **our integration defects**.

### 8.1 Categories

| Category | Code | Definition | Example | Counts as provider failure? |
|---|---|---|---|---|
| **Data error** | E | A value contradicts the authoritative source beyond tolerance, or violates an invariant. | Close is 5% off official; low > high; duplicate contract ID; wrong business date. | Yes |
| **Missing data** | M | An expected record is absent with no documented exclusion or status explanation. | A normal trading session has no row; a quarter is missing; a broker ID is always null. | Yes |
| **Documented exclusion** | X | The provider or authority explicitly excludes a class of data. | Odd lots excluded; suspended securities not traded; auction trades reported elsewhere. | No, if written and accepted; may be a scope gap |
| **Methodology difference** | D | Both values can be correct under different definitions. | Close vs LTP; adjusted vs unadjusted; consolidated vs standalone; fiscal-period labels; rounding; free-float vs full-cap index. | No, if documented and reproducible; otherwise S2 until clarified |
| **Integration defect** | I | Our adapter, parser, cache, or query caused the discrepancy. | Wrong symbol mapping; date off by one; pagination not followed. | No; fix our code |
| **Unknown** | U | Cannot be resolved with available evidence. | Vendor does not answer; official source unavailable. | Counts against confidence; may block |

### 8.2 Severity

| Severity | Meaning | Examples | Effect |
|---|---|---|---|
| **S1 — blocking** | Invalidates a mandatory R1 dataset, the licence, or the gate. | No five-year history; current-day floorsheet returned for a historical date; no written storage/derived-analytics right; no production endpoint; wrong mandatory dataset. | Trial FAIL; no production |
| **S2 — major** | Material quality/coverage defect in a mandatory dataset that can be remediated. | 5–25% missing sessions; isolated statement errors; factor method undocumented; stale live data; no sector membership history. | Conditional; remediation plan required |
| **S3 — minor** | Field gaps, formatting, metadata, or non-blocking omissions. | Missing optional field; inconsistent labels; no source URL on one event. | Conditional with fix list |
| **S4 — observation** | Documentation/UX issue with no data impact. | Confusing docs; slow support response. | Record only |

### 8.3 Decision tree

For each discrepancy:

1. **Is the item required by R1?** If no, record it; it is not a trial failure
   (but may be a scope/R2 note).
2. **Is there an authoritative value?** If no, classify **U** and request
   clarification; do not guess.
3. **Is the difference explained by units, timezone, date convention, rounding,
   adjustment, consolidation, or index methodology?** If yes and documented,
   classify **D**.
4. **Does the provider document an exclusion?** If yes, classify **X**; assess
   whether the exclusion is acceptable for R1 and record the coverage impact.
5. **Did our adapter cause it?** Check raw response against parsed output. If
   yes, classify **I** and fix our code; do not count against the vendor.
6. **Is the expected record absent?** If yes, classify **M**.
7. **Otherwise, the value contradicts the authority beyond tolerance:** classify
   **E**.
8. Assign severity **S1–S4** and attach the raw request/response, expected value,
   source, and date.

### 8.4 Specific examples

| Situation | Correct classification | Reasoning |
|---|---|---|
| A requested historical date returns today’s floorsheet | **E-DATE, S1** | The provider ignores the date parameter; the dataset is unusable for history. |
| A holiday has no row | **X or D** | The market was closed; not missing data. Use the official calendar. |
| A suspended stock has no trades for 80 sessions | **X** | If the suspension is documented; otherwise **M**. |
| Adjusted close differs by the bonus ratio | **D** | If the vendor documents adjustment and the factor is correct. |
| Adjusted close differs after the ex-date with no method | **E or U, S2** | The vendor must document or correct it. |
| Close differs by NPR 0.01 | **D (rounding)** | Within tolerance and likely rounding. |
| Close differs by 1% on 10% of dates | **E, S2** | Systematic error beyond rounding. |
| EPS differs because the vendor uses a different share count | **D** if documented; **E** if not | Methodology vs error. |
| Net profit differs because of a restatement | **D** if the old/new versions are retained; **E** if silently overwritten | Versioning is part of the contract. |
| Missing values are filled with zero | **E, S2** | Zero is a valid number and misleads analysis. |
| Duplicate contract ID in one session | **E, S2** | Double-counted turnover. |
| Broker ID is null on every trade | **E, S1/S2** | The dataset cannot support broker analytics. |
| Index history is close-only when OHLC was promised | **M or D** | Scope/definition issue; record and decide. |
| The API returns an empty array for an unsupported capability | **E, S1** | The architecture forbids hiding missing capabilities; declare unsupported instead. |
| A file is paginated and we only read page 1 | **I** | Our integration defect; fix and re-test. |

### 8.5 Counting rules

- Count errors per dataset, not per row, for the verdict; retain row-level
  details in the evidence pack.
- A single S1 in a mandatory dataset fails the trial.
- One to three S2 issues in mandatory datasets may make the trial
  **CONDITIONAL** with a remediation plan. More than three S2 issues, or any
  unresolved S2 after the remediation window, makes the trial **FAIL**.
- Documented exclusions are listed separately and do not count as errors, but
  they must be accepted by the owner and disclosed in the product.
- Methodology differences are listed separately; if they affect comparability,
  the product must label them.

## 9. Reconciliation sources and method

### 9.1 Source hierarchy

1. **NEPSE official** — prices, indices, floorsheet, market summary, company
   reports, disclosures.
2. **SEBON** — IPO/FPO/right/debenture approvals, prospectuses, public-issue
   data.
3. **CDSC** — current issues, IPO results, lock-in notices, ISIN/company
   registration.
4. **Company filings** — audited annual reports, quarterly filings,
   restatements.
5. **Provider documentation and sample data** — for schema and methodology, not
   for truth.
6. **Secondary research sites/datasets** — corroboration only; never the sole
   truth source.

### 9.2 Method

- Reconcile values, not just row counts.
- For prices, compare date, close, and volume; a matching close with a missing
  volume is still a defect.
- For indices, compare date and close/value; record methodology differences.
- For floorsheet, compare contract ID, symbol, brokers, quantity, rate, amount,
  and business date.
- For statements, compare period, statement type, line item, unit, and
  restatement status.
- For corporate actions, compare event type, announcement date, book-close/
  record date, ex-date, ratio/amount, and factor.
- For IPOs, compare type, status, open/close dates, price, units, and investor
  category.
- Record the exact official URL/PDF, retrieval date, and page/row.
- Use a second provider only as corroboration; do not treat agreement between
  two vendors as proof.

### 9.3 Sampling

- Use a recorded random seed.
- Stratify by sector, liquidity, and event type.
- Include known corporate actions, holidays, suspensions, and restatements.
- Expand the sample when a failure appears; do not cherry-pick passing dates.
- Keep the sample identical for both providers.

## 10. Verdict rules

### 10.1 Per-test verdict

| Verdict | Meaning |
|---|---|
| **PASS** | Meets the threshold, no material discrepancy. |
| **PASS WITH EXCEPTIONS** | Meets the threshold after accepting documented exclusions or methodology differences; exceptions are listed. |
| **FAIL** | Misses the threshold, has an S1, or has unresolved S2 beyond the remediation window. |
| **NOT TESTED** | Dataset/capability not offered, not in scope, or access unavailable. |

### 10.2 Overall trial verdict

| Verdict | Criteria | What it authorises |
|---|---|---|
| **TRIAL PASS** | All mandatory R1 tests PASS or PASS WITH EXCEPTIONS; zero open S1; zero open S2; written terms verified; gate `go`; owner/legal sign-off. | Proceed to production integration planning, not automatic production. |
| **TRIAL CONDITIONAL** | No S1; ≤3 S2 with a written remediation plan; no mandatory dataset below its hard floor; terms acceptable; gate `go` or a path to `go`. | Remediation only; no production until closed. |
| **TRIAL FAIL** | Any S1; more than three S2; a mandatory dataset missing or below its hard floor; rights unacceptable; policy block; gate `no-go` with no remediation path. | Stop; re-scope or select another provider. |

### 10.3 Relationship to the Phase 0 gate

- The gate is run separately with the licensed provider in production mode.
- **Gate `go` + trial PASS** = R1 data ready, subject to legal/owner sign-off.
- **Gate `go` + trial CONDITIONAL** = not ready; fix the S2 items.
- **Gate `conditional` + trial PASS** = not ready; the gate warnings must be
  resolved or explicitly accepted by the owner with a documented rationale.
- **Gate `no-go`** = not ready, regardless of trial results.

A trial PASS must never be used to override a gate failure. A gate `go` must
never be used to override a trial failure.

## 11. Reporting template

Produce one report per provider, plus a side-by-side comparison.

### 11.1 Report structure

1. **Header** — provider, trial ID, dates, corpus hash, reviewer, status.
2. **Executive summary** — verdict, S1/S2 counts, datasets passed/failed.
3. **Corpus** — symbols, indices, date windows, request counts, substitutions.
4. **Per-test results** — T0–T19 table with status, metrics, evidence links.
5. **Error log** — ID, category, severity, dataset, expected, actual, source,
   raw evidence, status.
6. **Documented exclusions** — list and coverage impact.
7. **Methodology differences** — list and product labelling needed.
8. **Open questions** — vendor clarifications still required.
9. **Terms/legal summary** — what the written terms permit/prohibit.
10. **Verdict** — trial verdict and reasons.
11. **Evidence index** — raw files, hashes, request logs, reconciliation sheets.

### 11.2 Required metrics

- rows returned vs expected, by dataset;
- distinct dates/sessions, first/last date, coverage %;
- duplicate count, invalid-row count;
- reconciliation matches / sample size;
- error counts by category/severity;
- rate-limit hits and retries;
- latency/freshness percentiles for live data.

### 11.3 Side-by-side comparison

Use the same corpus and the same test IDs. Do not compare a provider’s best
sample with another provider’s worst. If a dataset is unavailable for one
provider, mark **NOT TESTED**, not zero.

## 12. Post-trial data handling

- Keep trial data in an access-controlled quarantine, not the production
  database.
- Do not import trial data into production. Re-fetch under the production
  licence after selection.
- Delete raw trial data when required by the provider’s trial terms; retain only
  the evidence pack (hashes, metrics, excerpts) that the terms permit.
- Record deletion date and method.
- If the provider becomes the production source, verify that the production
  licence covers the historical data and the intended use before backfilling.
- Never merge trial data with unofficial data.

## 13. Prohibited actions during the trial

- Do not scrape provider websites or bypass authentication.
- Do not exceed documented rate limits or share credentials.
- Do not use unofficial data as a substitute for a missing trial dataset.
- Do not publish trial data or provider confidential information.
- Do not modify raw responses.
- Do not buy a subscription or accept auto-renewal as part of the trial.
- Do not start production UI, portfolio, or backtesting work based on trial
  results.

## 14. Trial checklist

### Before the first request

- [ ] Owner approved contact and trial.
- [ ] C1–C4 decisions signed.
- [ ] RFQ answers and draft terms received.
- [ ] Legal review of trial storage/use complete.
- [ ] Corpus manifest frozen and hashed.
- [ ] Credentials stored outside the repo.
- [ ] Trial workspace and raw-data directory created.
- [ ] Rate-limit and backoff plan documented.

### During the trial

- [ ] T0 metadata/policy.
- [ ] T1 masters; T2 calendar.
- [ ] T3 daily OHLCV; T4 index; T5 sectors.
- [ ] T6 live session.
- [ ] T7 corporate actions; T8 factors.
- [ ] T9 current fundamentals; T10 history; T10b statements if C2.
- [ ] T11 current floorsheet; T12 history if C1.
- [ ] T13 IPO pipeline; T13b allotment/lock-in if C8.
- [ ] T14 delisted if C3; T15 intraday if C4.
- [ ] T16 news / T17 mutual funds if in scope.
- [ ] T18 rate limits; T19 persistence/offline.
- [ ] Every error classified and evidenced.
- [ ] Every exclusion/methodology difference documented.

### Before the verdict

- [ ] Raw corpus complete and hashed.
- [ ] Reconciliation sheets attached.
- [ ] Error log reviewed by a second person.
- [ ] Terms/legal summary complete.
- [ ] Gate run separately.
- [ ] Report signed and dated.
- [ ] No production import performed.

The Phase 0 verdict remains **NO-GO for production** until a licensed provider
passes both the gate and this trial with written rights.

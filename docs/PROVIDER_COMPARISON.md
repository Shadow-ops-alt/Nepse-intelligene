# NEPSE Data Provider Comparison

Date: **2026-11-04**
Phase: **0.5 — Data Provider Investigation**
Status: research only. No provider account was created, no trial was used, no
subscription was purchased, and no provider was contacted.

This document compares the sources that could supply the data required by the
product. It does **not** change the Phase 0 validation gate or the
`NO-GO for production` verdict in `docs/PHASE0_FINDINGS.md`.

> **Phase 0.5 addendum (2026-11-04).** This document records research evidence.
> The canonical Release 1 scope is
> `docs/RELEASE1_DATA_REQUIREMENTS.md`, the standardised RFQ is
> `docs/PROVIDER_RFQ.md`, trial execution is
> `docs/PROVIDER_TRIAL_PROTOCOL.md`, and the evidence-only comparison is
> `docs/PROVIDER_DECISION_MATRIX.md`. “Recommended to evaluate first” is an
> evaluation order, **not** a selection and not a GO. The decision matrix
> separates verified facts from vendor claims and records that neither
> provider is R1-ready today.

## How to read the evidence

Every material statement is labelled with one of these evidence levels:

| Label | Meaning |
|---|---|
| **Verified** | Seen directly in public documentation, a public page, a public file, or a public repository on 2026-11-04. |
| **Vendor claim** | The provider says it, but the claim was not independently verified and is not a contractual commitment. |
| **Inference** | A conclusion drawn from verified facts, clearly marked as such. Not a licence or a guarantee. |
| **Unverified** | A lead, search snippet, or secondary report that could not be confirmed at the source. Do not budget or build from it. |
| **Not found** | A capability or term was not present in the public material reviewed. Absence of documentation is not proof that the capability does not exist. |

Prices, endpoints, and licensing permissions are **not** inferred from marketing
copy. Where a provider does not publish a price or a right, this document says
so.

## Bottom line

**No single provider is verified to supply all ten required data categories
with acceptable commercial terms.**

- **ShareHub** is the most developer-ready licensed candidate: public API
  documentation, explicit authentication, rate limits, and a documented 5-year
  and all-time OHLCV/index history option. It does **not** document floorsheet
  data or multi-year financial statements.
- **MDP by Source Code** is the only candidate that publicly claims the full
  stack, including historical floorsheet, quarterly/annual financial reports,
  corporate actions, and mutual funds. Its public documentation is incomplete,
  its API base URL is a UAT host, and it publishes neither pricing nor API terms.
- **Official sources** (NEPSE, SEBON, CDSC/MeroShare, company filings) are
  authoritative for documents and issue/lock-in data, but none exposes a public
  self-serve market-data API with published reuse rights.
- **NepseAlpha, ShareSansar, yonepse, Aabishkar2, and Mendeley** are useful for
  manual research, cross-checks, or development fixtures. They are not verified
  production feeds.

**Multiple providers are required.** At minimum, a licensed market-data API
must be paired with official filings/issue sources for financial statements,
corporate-action truth, IPO/right/lock-in data, and verification. If historical
floorsheet is mandatory, MDP or an official NEPSE archive is required; ShareHub
alone cannot satisfy it.

## Coverage matrix

Legend:

- **Yes** — documented or publicly available for the stated use.
- **Partial** — some data is available, but depth, structure, or coverage is
  limited.
- **Claim** — vendor claims it; not independently verified.
- **No** — documented as absent, or clearly outside the product.
- **Unknown** — not documented in the public material reviewed.

`Web` means the data can be viewed/downloaded by a human on the public website,
not that an API or reuse licence exists.

| Requirement | NEPSE official | SEBON | CDSC / MeroShare | ShareHub API | MDP API | NepseAlpha | ShareSansar / SS Pro | Research datasets |
|---|---|---|---|---|---|---|---|---|
| 5 years daily OHLCV | Unknown (web history exists; depth not published) | No | No | **Yes** (5Y and ALL documented; trial required) | **Claim** (5–10 years claimed) | Partial (web export, adjusted/unadjusted; 5-year depth not published) | Partial (web/SS Pro; 5-year depth not published) | Yes (Aabishkar2 back to 1995; not licensed for production) |
| Intraday prices | Yes (live licensed feed; public site is delayed/limited) | No | No | **Yes** (live, ~20s refresh) | **Claim** (real-time; ~15s per independent integrator) | Yes (live web) | Yes (live web/SS Pro) | yonepse has live snapshots; not a production feed |
| Historical NEPSE index | Unknown (web charts; bulk depth not published) | No | No | **Yes** (1W–5Y–ALL, NEPSE/sensitive/float/sector; trial required) | **Claim** (index historical data) | Partial (index history web; depth not published) | Partial (index history web; 20-year summary claim) | Mendeley: 20 years close-only; yonepse: index history |
| Sector data | Yes (indices/sub-indices on web) | No | No | **Yes** (sector performance + sector index charts) | **Claim** (indices and sub-indices) | Yes (web) | Yes (web/SS Pro) | yonepse sector indices |
| Company fundamentals (current) | Partial (company pages; ratios not a clean API) | No | No | **Yes** (EPS, P/E, book value, P/B, yield, net profit, market cap) | **Claim** (financial ratios) | Yes (web) | Yes (web/SS Pro) | yonepse company financials (scraped) |
| 5-year financial history | Partial (company report PDFs; depth varies) | Partial (submission status, prospectuses; not structured statements) | No | **No** (latest ratios only) | **Claim** (quarterly/annual reports; depth not published) | Partial (web reports/audited annual reports; depth varies) | Partial (5 quarters / 5-year charts; not full statements) | Aabishkar2: OHLCV only; no statements |
| Floorsheet | Yes (current day on web; historical depth unknown) | No | No | **No** (not in public package/endpoint docs) | **Claim** (live + historical) | Partial (current/historical web; not documented as API) | Partial (current web; historical depth unknown) | yonepse: daily archive (~2.5 GB); unofficial |
| Corporate actions | Partial (book-close, disclosures, news) | **Yes** (bonus registered, rights/FPO/IPO approvals, public issue data) | Partial (lock-in notices only) | **Partial** (dividends, public offerings, announcements; no structured adjustment factors) | **Claim** (dividends, rights, auctions, AGM/SGM, M&A) | Partial (proposed dividend, right, AGM web) | Partial (proposed dividend, AGM, right, merger web) | yonepse dividends; scraped |
| IPO information | Partial (news/notices) | **Yes** (IPO/FPO/right/debenture approvals and pipelines; public issue XLSX) | **Yes** (current issue list, IPO result, MeroShare) | **Yes** (public offerings endpoint with type/status/for) | **Claim** (IPO/FPO, rights, bonds, auctions) | Partial (web) | Partial (web) | yonepse IPOs; unofficial |
| Company news | Yes (company news/disclosures/notices) | Partial (regulatory notices/press releases) | No | **Partial** (announcements feed; not general news) | **Claim** (news via API per independent integrator; not in MDP docs nav) | Partial (news web) | Partial (news web) | yonepse notices/disclosures |

## Provider profiles

### 1. Nepal Stock Exchange (NEPSE) — official exchange

**What it is.** The exchange and the primary source of prices, indices,
floorsheet, company disclosures, and listed-company reports.

**Verified facts.**

- Public site: `https://www.nepalstock.com.np/`.
- The public web application exposes company pages, company reports, floorsheet,
  market data, news, notices, and disclosures. The application bundle references
  routes and endpoints for company details, company news, reports, floorsheet,
  market graph data, and report categories.
- Company reports are served as files/PDFs; for example, an interim financial
  statement PDF is served from the site's `fetchFiles` endpoint.
- No public developer API, public rate card, or public data-licence page was
  found.
- The site is a JavaScript application; direct HTML fetches return only the
  application shell. The data surface is not documented as a public API.

**Access and commercial terms.**

- **Not found:** public API documentation, pricing, rate limits, SLA, or a
  self-serve signup.
- **Inference:** commercial use, persistent storage, derived analytics, and
  redistribution require a written agreement with NEPSE or an authorised
  reseller. This is consistent with the existence of NEPSE's reseller channel,
  but the exact terms are not public.
- A NEPSE “data directory” referenced in secondary posts could not be verified
  from NEPSE's own site during this review.

**Missing / uncertain.**

- Bulk 5-year OHLCV extraction and its exact depth.
- Historical floorsheet depth.
- Structured fundamentals history (reports are documents, not a normalized
  time series).
- Delisted/suspended security history.
- Published redistribution rights.
- Published update frequency and correction process for API consumers.

**Role.** Authoritative verification source and the likely upstream licensor.
Do not build an automated production ingestion path against the public website.

---

### 2. Securities Board of Nepal (SEBON) — regulator

**What it is.** The securities regulator. It publishes issue approvals,
prospectuses, public-issue statistics, and regulatory notices.

**Verified facts.**

- Public site: `https://www.sebon.gov.np/`.
- Public sections include IPO approved/pipeline, FPO approved/pipeline, right
  share approved/pipeline, debenture approved/pipeline, bonus share registered,
  mutual fund schemes, securities registered, promoter share converted, and
  public issues data.
- Public issues data is published as spreadsheet files by fiscal year. On
  2026-11-04 the latest was “Public Issues Data till FY 2082/83” (XLSX), with
  earlier years back to FY 2074/75.
- Prospectuses are published as web pages/PDFs.
- “Annual Report Submission Status of Listed Companies 2081/82” is published as
  a PDF. This is a compliance status list, not the statements themselves.

**Access and commercial terms.**

- Public web pages and files; no API.
- **Not found:** explicit reuse, redistribution, or commercial-use licence for
  the published files.
- **Inference:** government/regulator publications may be reusable with
  attribution, but this must be confirmed before redistribution. Do not assume
  a blanket open licence.

**Missing.**

- No normalized company-by-company financial statement database.
- No market prices or floorsheet.
- No API, rate limits, or update SLA.

**Role.** Authoritative source for IPO/FPO/right/debenture approvals, public
issue history, prospectuses, and issue statistics. Use for verification and
manual/structured extraction, not as the primary market-data feed.

---

### 3. CDSC and MeroShare — depository and investor portal

**What it is.** CDS and Clearing Limited operates the central depository,
MeroShare, and the IPO result portal.

**Verified facts.**

- CDSC site: `https://cdsc.com.np/`.
- Public pages include current issue list (`/ipolist`), IPO result portal
  (`https://iporesult.cdsc.com.np/`), lock-in period notices (`/lockin`), ISIN
  and scrip, registered companies, and RTA/DP lists.
- Lock-in notices are published as dated PDFs per company; the list is current
  and historical.
- MeroShare (`https://meroshare.cdsc.com.np/`) is an account-authenticated
  investor portal.
- No public API documentation was found.

**Access and commercial terms.**

- Public lists can be viewed without an account.
- MeroShare data is account-scoped investor data, not a market-data feed.
- **Not found:** API, pricing, rate limits, or redistribution rights.
- **Inference:** automated access to MeroShare or bulk extraction of investor
  data is not appropriate without written permission. Use CDSC's public lists
  for issue/lock-in data.

**Missing.**

- No market prices, index history, or fundamentals.
- No documented API.
- No structured historical lock-in dataset; notices are PDFs.

**Role.** Authoritative for current issues, IPO results, lock-in notices, and
ISIN/company registration. Manual or carefully permissioned ingestion only.

---

### 4. ShareHub NEPSE Data API — licensed commercial candidate

**What it is.** A JSON REST API from ShareHub Nepal, documented publicly at
`https://sharehubnepal.com/data/nepse-data-documentation/`.

**Verified facts.**

- Base URL: `https://sharehubnepal.com/data/api/v1/nepse-data`.
- Authentication: email/password login, Bearer access token valid 30 minutes,
  refresh token valid 30 days. Server IPs must be allow-listed.
- Test mode: `X-DataApi-Test: true`, limited to 10 requests/minute and 500/day.
- Rate limits are licence-specific and reported in `X-RateLimit-*` headers;
  HTTP 429 includes `Retry-After`.
- Live market data refreshes about every 20 seconds during trading hours and
  every 5 minutes when the market is closed.
- **Package 1 — Essential:** live market, live stock prices, sector performance,
  company information.
- **Package 2 — Professional:** index charts (1W, 1M, 3M, 6M, 1Y, 5Y, ALL) for
  NEPSE/sensitive/float/sector indices; movers; full stock table with OHLCV and
  fundamentals; 52-week/all-time highs and lows; company profile; financial
  ratios; **all-time daily OHLCV per stock from listing**; announcements;
  dividends; holidays; public offerings; heatmap; index contribution;
  price-volume.
- Endpoints are documented with parameters and response examples for the
  package services.
- Public offerings support types such as IPO, FPO, right, mutual fund, bond or
  debenture, and preference shares, with status and investor category filters.
- Announcement categories include financials, IPO/FPO update, right shares,
  auction, AGM/SGM, corporate announcement, dividend, and other.

**What is not documented.**

- **Floorsheet:** no floorsheet endpoint or package entry was found. Do not
  assume it exists.
- **Multi-year financial statements:** only latest financial ratios and the
  full stock table's latest fundamentals are documented. No balance sheet,
  income statement, cash-flow statement, or quarterly history is documented.
- **Corporate-action adjustment factors:** dividends and offerings are listed,
  but adjusted-price series and bonus/right adjustment factors are not
  documented.
- **Delisted/suspended history:** not mentioned.
- **Mutual fund NAV/holdings:** not documented.
- **News:** announcements only, not a general company-news feed.

**Commercial terms and pricing.**

- **Not found:** public pricing. The documentation says access is obtained by
  contacting ShareHub for a Data API account and licence. `GET /data/pricing`
  returned 404.
- **Not found:** public commercial-use, redistribution, sublicensing, or
  derived-analytics terms. The public terms page did not contain a data-reuse
  grant.
- The vendor claims the API is “the same feed” that powers ShareHub's website
  and apps. That is a vendor claim, not an independent licence confirmation.

**Verification still required.**

- A trial must confirm that `time=5Y` and `time=ALL` actually return five years
  (or full listing history) for multiple symbols, not just a recent window.
- Confirm whether prices are adjusted for bonus/right issues and whether
  adjustment factors are available.
- Confirm whether floorsheet, financial statements, or delisted history can be
  added to a licence even though they are not in the public package tables.
- Obtain written terms for personal use, storage, derived analytics, and any
  redistribution.

**Role.** Best-documented market-data candidate and the preferred fallback if
MDP cannot be contracted or fails validation.

---

### 5. MDP / Market Data Provider — Source Code Pvt. Ltd.

**What it is.** A commercial NEPSE data API marketed as “Market Data Provider”
(MDP), operated by Source Code Pvt. Ltd. Site:
`https://data.smartwealthpro.com/`.

**Vendor claims (not independently verified).**

- “Official NEPSE-Licensed Data Provider.”
- Real-time stock prices, indices, sub-indices, market summary, top gainers and
  losers.
- Live and historical floorsheet, including buyer/seller IDs and trade time.
- “Years” of historical stock and index data, with date-range queries.
- Company profiles, board/management, ownership structure.
- Quarterly and annual financial reports, balance sheet, income statement,
  NRB-format ratios, and official financial report PDFs.
- Corporate actions: dividends, IPOs/FPOs, rights, auctions, AGM/SGM, mergers and
  acquisitions.
- Mutual fund profiles, NAV statements, holdings, and income statements.
- REST API, API-key authentication, rate limiting, IP whitelisting, 99.9%
  uptime claim, and custom packages.
- Source Code's product page/search description claims **5–10 years** of
  historical data.
- Source Code's public social posts claim it renewed a **Market Data Reseller
  Agreement** with NEPSE.

**Verified facts.**

- Public site and documentation exist.
- Documentation base URL is `https://uat.sourcecode.com.np` — a UAT host, not a
  documented production host.
- Required headers: `ApiKey`, `ApiSecret`, `AccessId`, `ApiVersion`,
  `Content-Type`.
- Documentation navigation lists market status, indices, sub-indices, stock
  live, today price, floorsheet, IPO/FPO, dividend, right shares, bonds and
  debentures, auction, merger and acquisition, AGM/SGM, financial reports,
  financial ratios, company profile, listed companies, mutual fund profile,
  stock holdings, NAV statement, and income statement.
- The public documentation shows only the introduction, authentication headers,
  and a section index. Endpoint request/response schemas and examples are not
  published on the page reviewed.
- `GET /pricing` redirects to the home page. There is no public price list; the
  site uses a “Get a Quote” form.
- No public API terms, SLA, or redistribution grant was located.
- An independent third-party integrator (NChartPro) states that it pays for the
  MDP API, receives ticks about every 15 seconds, and gets candle history,
  fundamentals, floorsheet, and news through it. This corroborates that MDP
  operates a paid feed, but it is not a vendor contract or a coverage guarantee.

**Assessment.**

MDP is the only candidate whose public marketing claims every hard category:
historical floorsheet, multi-year financial reports, corporate actions, and
mutual funds. It is therefore the most promising **single-provider** option.
However, the gap between the claim and the public documentation is large:
no production base URL, no endpoint schemas, no pricing, no terms, and no
independent verification of historical depth.

**Role.** Primary evaluation candidate for a full-stack licence. Do not select
it without a trial and written terms.

---

### 6. NepseAlpha — research and data-download site

**What it is.** A NEPSE information site with price history, adjusted/unadjusted
exports, financial reports, audited annual reports, indices, floorsheet, and
news. Site: `https://nepsealpha.com/`.

**Verified facts.**

- Public price-history pages show daily OHLCV and state that data are book-close
  adjusted.
- The “NEPSE Data” page offers daily/weekly/monthly history, date-range or
  specific-date filters, and **unadjusted/adjusted** price types for symbols and
  indices.
- Financial reports and audited annual reports are published as web pages/PDFs.
- Public pages include current/historical-looking price tables, indices,
  floorsheet, dividends, rights, AGM, and IPO sections.
- No public API documentation was found.
- A services page exists and advertises paid plans. The live page was blocked by
  a bot challenge during this review, so the exact price is **unverified** and is
  not used in any budget.

**Access and commercial terms.**

- Paid subscription for some services; account login required.
- **Not found:** API, rate limits, commercial-use grant, or redistribution
  rights.
- Secondary reports state NepseAlpha prohibits scraping. Treat automated
  extraction as prohibited unless written permission is obtained.

**Missing.**

- No documented API.
- No documented data-licence terms.
- Historical depth per symbol/index is not published as a contract.
- Fundamentals history is report-by-report, not a normalized API.

**Role.** Manual research, cross-checking, and adjusted-price reference. Not a
production feed without a written agreement.

---

### 7. ShareSansar / SS Pro — research and analytics platform

**What it is.** A long-running NEPSE news and data site with a paid analytics
product, SS Pro. Site: `https://www.sharesansar.com/`.

**Verified facts.**

- Public sections include market overview, live trading, floorsheet, AGM/SGM,
  proposed dividend, sectorwise prices, indices/sub-indices, datewise indices,
  index history, IPO/FPO result and news, listed companies, mutual funds and
  NAVs, debentures, promoter lock-in, mergers, suspended companies, and more.
- SS Pro is a paid web application. Payment is via eSewa/Khalti or bank deposit;
  pricing is shown on the package/payment page, not in the public text reviewed.
- SS Pro features include:
  - a stock screener and fundamental ratios;
  - portfolio tracking;
  - 20+ alert types;
  - mutual fund NAV/holdings analytics;
  - live charting;
  - broker analysis;
  - “exclusive data” on NEPSE and the economy since FY 2057/58;
  - company tearsheets;
  - **quarterly reports for the last 5 quarters** and **5-year metric charts**.
- The public terms page is primarily a disclaimer and privacy policy. It does
  **not** grant reuse, redistribution, or commercial exploitation rights.

**Missing.**

- No public API.
- No documented rate limits or SLA.
- No structured 5-year full financial statements; the 5-quarter/5-year views
  are analytics, not a raw statement export.
- No redistribution grant.

**Role.** Manual research and validation. Useful for checking corporate actions,
financial history, and index history against a licensed feed. Not a production
API.

---

### 8. Research and development datasets

These are useful for fixtures, validation, and exploratory analysis. They are
not production market-data licences.

#### yonepse

- Repository: `https://github.com/Shubhamnpk/yonepse`.
- MIT licence for the repository.
- Static JSON API on GitHub Pages/raw GitHub.
- Data includes live snapshots, LTP history, indices, sector indices, floorsheet
  daily archive, company profiles/financials, IPOs, dividends, notices, and
  disclosures.
- Sources listed by the project include NEPSE official API, Merolagani,
  ShareSansar, ShareHub, and a separate NEPSE open-data project.
- Update cadence: hourly during market hours for market data; daily after close
  for company/IPO/dividend data; floorsheet after close.
- **Not a licensed redistributor.** MIT covers the repository's code/data as
  published, not the exchange's underlying rights. Use for development and
  cross-checks only.

#### Aabishkar2/nepse-data

- Repository: `https://github.com/Aabishkar2/nepse-data`.
- MIT licence.
- One CSV per company, about 370 companies, history back to 1995.
- Columns: published date, open, high, low, close, percent change, traded
  quantity, traded amount, derived status.
- Updated almost daily by GitHub Actions.
- Scraped historical data. **Research/validation only**; no exchange
  redistribution licence.

#### Mendeley — NEPSE Index Daily Closing Prices

- Dataset: `https://data.mendeley.com/datasets/v669ck9xjw`.
- CC BY 4.0.
- NEPSE index closing prices, April 2004 to April 2024, one row per trading day.
- Only date and close; no OHLC, volume, or intraday.
- Sourced from NEPSE and Nepal Rastra Bank; static academic dataset.
- Useful for long-history index validation. Not a production feed.

#### Other leads not shortlisted

- `nepsetty.kokomo.workers.dev` (ShareBazaar unofficial API claim): no public
  licence, SLA, or data-rights documentation found. Do not use.
- Kaggle NEPSE datasets: licences vary and were not verified. Do not use
  without a licence review.

## Technical and commercial comparison

| Provider | API | Auth | Public price | Historical depth | Update frequency | Rate limits | Commercial / redistribution |
|---|---|---|---|---|---|---|---|
| NEPSE official | No public API docs | Unknown / contract | Not published | Website history; bulk depth not published | Real-time licensed feed; public site | Unknown | Written agreement required (inference); no public terms |
| SEBON | No | None for public pages | Free to view | Public issue data by FY; prospectuses | As published | N/A | Reuse rights not stated; verify before redistribution |
| CDSC / MeroShare | No public API docs | Public lists; MeroShare account | Free to view | Lock-in notices and current issues | As published | N/A | Investor portal terms; no redistribution grant found |
| ShareHub | Yes, REST/JSON | Email/password → Bearer; IP allow-list | Not published | 5Y and ALL documented; trial required | ~20s live; ~5 min closed | Licence-specific; test 10/min, 500/day | No public data-reuse terms; contract required |
| MDP | Yes, REST/JSON | ApiKey, ApiSecret, AccessId, ApiVersion | Not published; quote only | “5–10 years” claim; not verified | Real-time claim; ~15s per integrator | Claimed, no numbers | Claims NEPSE-licensed reseller; no public terms |
| NepseAlpha | No public API docs | Account for paid features | Paid plans; exact price unverified | Web history; not contracted | Live web | Unknown | No public reuse grant; scraping reportedly prohibited |
| ShareSansar / SS Pro | No public API | Account / SS Pro login | Paid SS Pro; price on package page | 5-quarter/5-year analytics; 20-year summaries claimed | Live web / daily | Unknown | No reuse grant; copyrighted |
| yonepse | Static JSON | None | Free | Variable; includes floorsheet archive | Hourly / daily | GitHub/static hosting | MIT repo; no exchange redistribution rights |
| Aabishkar2 | Static CSV | None | Free | Back to 1995 for ~370 companies | Daily | N/A | MIT repo; no exchange redistribution rights |
| Mendeley | Static file | None | Free | 20 years NEPSE close | Static | N/A | CC BY 4.0; attribution required; research use |

## The hard gaps

### G1 — Five years of daily OHLCV

Only ShareHub explicitly documents a 5Y option and an ALL/from-listing option.
MDP claims 5–10 years. Official NEPSE history exists on the website, but bulk
depth and reuse rights are not published. NepseAlpha and ShareSansar show long
history but do not offer a documented API or reuse grant.

**Status:** ShareHub is the best-documented candidate; still requires a trial.

### G2 — Five years of financial statements

No provider has a verified, structured five-year statement history.

- MDP claims quarterly/annual reports and PDFs, but depth and schema are not
  published.
- ShareHub documents only the latest ratios.
- NEPSE hosts report PDFs, but they are documents, not a normalized time series.
- ShareSansar's SS Pro shows five quarters and five-year charts, not a raw
  statement export.
- NepseAlpha publishes reports and audited annual reports, but coverage varies
  by company and there is no API.

**Status:** This remains the hardest gap. Expect a document-extraction pipeline
plus manual verification, even with a paid API.

### G3 — Historical floorsheet

Only MDP publicly claims historical floorsheet. NEPSE's public site exposes
current-day floorsheet; historical depth is not documented. ShareHub does not
document floorsheet at all. yonepse has an unofficial archive.

**Status:** If historical broker analytics are required, MDP or an official
NEPSE archive is mandatory. Otherwise, scope must be reduced to current-day
floorsheet.

### G4 — Corporate-action-adjusted prices

NepseAlpha exposes adjusted and unadjusted exports. ShareHub documents dividends
and offerings but not adjustment factors. MDP claims corporate actions but does
not publish adjustment semantics. NEPSE publishes book-close/disclosure data,
but not a ready adjustment factor.

**Status:** Adjustment logic may have to be built and verified in-house. Do not
assume any vendor's “adjusted” series is correct without reconciliation.

### G5 — Delisted and suspended history

No provider documents delisted-security history. This creates survivorship bias
in long-term backtests.

**Status:** Open. Either source it from NEPSE/official archives or explicitly
limit backtests to the current listed universe and disclose the bias.

### G6 — Intraday history

Providers document live intraday prices, not historical intraday bars. MDP may
have minute candles per one integrator, but this is not in its public docs.

**Status:** Treat historical intraday as unverified. The product can ship live
intraday plus EOD history without it.

### G7 — News

NEPSE, ShareHub announcements, NepseAlpha, and ShareSansar all publish news or
announcements. None documents a licensed news-redistribution API.

**Status:** Treat news as a display/link feature or negotiate a separate right.
Do not store and redistribute news content by default.

## Multiple-provider conclusion

A single provider is **not** sufficient today:

1. **Market data + index + sectors + current fundamentals:** ShareHub is the
   best-documented candidate; MDP is the broader but less documented candidate.
2. **Five-year financial statements:** official NEPSE report PDFs and company
   filings are required, with extraction and verification. MDP may reduce the
   manual work if its report coverage is real.
3. **Historical floorsheet:** MDP or official NEPSE; otherwise drop the feature.
4. **IPO/right/lock-in:** SEBON and CDSC are authoritative; ShareHub/MDP can
   provide convenience coverage.
5. **Verification:** official NEPSE/SEBON/CDSC documents are the source of truth
   for prices, issue data, and corporate actions.

Even if MDP passes a trial, a second official-document layer is still required
for verification and for documents the API does not expose.

## Recommended combination

### Primary recommendation — evaluate MDP first, with official verification

For a **personal, single-user NEPSE application** that must cover all ten
categories, the most practical combination is:

> **Scope note.** This is the full-scope option. Under the recommended R1 scope
> (C1-B/C2-B/C3-B/C4-B in `docs/RELEASE1_DATA_REQUIREMENTS.md`), historical
> floorsheet, full financial statements, delisted history, and historical
> intraday move to R2/R3. This is an evaluation order, not a selection or a GO.

1. **MDP (Source Code)** as the single licensed API for market data, historical
   floorsheet, financial reports, corporate actions, and mutual funds.
2. **NEPSE / SEBON / CDSC / company filings** as the authoritative verification
   layer and for documents not exposed by MDP.
3. **ShareHub Professional** as the fallback or second market-data source if MDP
   fails the trial or cannot offer acceptable written terms.

Why this order:

- MDP is the only candidate that claims every hard category, especially
  historical floorsheet and multi-year financial reports.
- A single API reduces integration and reconciliation work.
- Official sources remain necessary for trust, corrections, and documents.
- ShareHub is the best-documented fallback and can serve as a second price/index
  source during validation.

**Conditions before selecting MDP:**

- Written quote and written personal-use/storage/derived-analytics terms.
- A production base URL and complete endpoint schemas.
- A trial that proves five years of OHLCV, five years of statements, historical
  floorsheet, and corporate-action adjustment semantics.
- Confirmation that the NEPSE reseller claim is current and covers the intended
  use.

### Fallback recommendation — ShareHub + official filings

If MDP is too expensive, too opaque, or fails the trial:

1. **ShareHub Professional** for OHLCV, index history, sectors, current
   fundamentals, dividends, announcements, and public offerings.
2. **NEPSE report PDFs + company filings** for five-year financial statements,
   extracted into a versioned internal dataset.
3. **SEBON + CDSC** for IPO/right/lock-in verification.
4. **NEPSE current-day floorsheet** for live broker analytics; defer or drop
   historical floorsheet unless a separate archive is licensed.

This combination is more transparent and likely easier to integrate, but it
does **not** satisfy historical floorsheet or a fully structured five-year
statement history without additional work.

### Not recommended

- Relying on NepseAlpha, ShareSansar, yonepse, Aabishkar2, or Mendeley as the
  production feed.
- Scraping NEPSE or MeroShare in production.
- Purchasing a subscription before a trial and written terms.
- Treating a vendor's “NEPSE-licensed” marketing as a redistribution grant.

## Open questions for the provider conversation

Do not send these until the project owner approves provider contact. The
canonical, standardised version of these questions is `docs/PROVIDER_RFQ.md`;
use that document, not this list, for actual correspondence. This list is kept
as a research summary.

1. Is a personal, single-user, non-commercial desktop application permitted?
2. May data be stored persistently on the user's machine?
3. May derived analytics (indicators, screeners, scores, charts) be produced and
   displayed?
4. May data be redistributed to family members or the public? If not, how is
   “personal use” defined?
5. Does the price include five years of history, or is history an add-on?
6. Is historical floorsheet included, and for how many years?
7. Are prices adjusted for bonus/right issues? Are adjustment factors provided?
8. Are delisted and suspended securities included?
9. What is the correction/errata process and SLA?
10. May report PDFs be stored and parsed into a local structured database?
11. What are the exact rate limits and overage charges?
12. Is there a production base URL and a stable API versioning policy?

## Sources reviewed

- NEPSE: `https://www.nepalstock.com.np/` (public web application; routes and
  report/fetch endpoints referenced in the public bundle).
- SEBON: `https://www.sebon.gov.np/`; public issues data, IPO/right/debenture
  sections, annual report submission status.
- CDSC: `https://cdsc.com.np/`; `/ipolist`, `/lockin`, IPO result portal,
  MeroShare.
- ShareHub: `https://sharehubnepal.com/data/nepse-data-documentation/`;
  `https://sharehubnepal.com/terms-and-conditions`.
- MDP: `https://data.smartwealthpro.com/`, `/features`, `/documentation`,
  `/about`, `/quote`, `/pricing` (redirects home), `/terms` (redirects home).
- Source Code: `https://sourcecode.com.np/product/mdp` (product description and
  search-indexed 5–10 year claim).
- NepseAlpha: `https://nepsealpha.com/nepse-data`,
  `https://nepsealpha.com/financials-reports`, `/our-services` (blocked by bot
  challenge during review).
- ShareSansar: `https://www.sharesansar.com/sspro`,
  `https://www.sharesansar.com/terms-and-conditions`,
  `https://www.sharesansar.com/index-history-data`.
- yonepse: `https://github.com/Shubhamnpk/yonepse`.
- Aabishkar2: `https://github.com/Aabishkar2/nepse-data`.
- Mendeley: `https://data.mendeley.com/datasets/v669ck9xjw`.
- NChartPro data-source documentation:
  `https://nchartpro.com/help/document/start/data-sources` (independent
  integrator statement about MDP).

## What this document does not do

- It does not purchase, subscribe, or contact any provider.
- It does not confirm any vendor's licence or price.
- It does not change the Phase 0 gate.
- It does not authorize production use of any source listed here.

The Phase 0 verdict remains **NO-GO for production** until a licensed source
passes the gate with real data and written terms.

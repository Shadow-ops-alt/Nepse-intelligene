# Provider Request for Quote (RFQ)

Date: **2026-11-04**
Status: **DRAFT — DO NOT SEND.** This RFQ has not been sent to any provider. No
account has been created, no trial has been requested, and no subscription has
been purchased. Sending it requires explicit project-owner approval.

This is the **single standardised RFQ** for both MDP (Source Code) and ShareHub.
The same questions, datasets, and depth requirements must be sent to both so the
decision matrix compares like with like. Vendor-specific facts (for example,
MDP’s UAT base URL or ShareHub’s IP allow-list) are prompts for evidence, not
different requirements.

Related documents:

- `docs/RELEASE1_DATA_REQUIREMENTS.md` — canonical R1/R2/R3 scope.
- `docs/PROVIDER_TRIAL_PROTOCOL.md` — how the answers will be tested.
- `docs/PROVIDER_DECISION_MATRIX.md` — how the answers will be scored.
- `docs/PROVIDER_COMPARISON.md` — public research evidence.

## How to use this RFQ

1. The project owner approves provider contact.
2. Send the **same** RFQ to each provider, with only the provider name and
   account details changed.
3. Require written answers to every question. “See website” or a marketing link
   is not an answer.
4. Each answer must state the **contractual** position, the **technical** reality,
   and any **limitation**. If the answer is “not available,” say so explicitly.
5. Ask the provider to mark anything that is a roadmap item, a beta feature, or
   a vendor claim rather than a current committed capability.
6. Do not accept a bundled “all-in” price without the line-item breakdown in
   §F.
7. Do not start a trial until the written terms in §B, §H, and §F are received.
8. Attach the evidence listed in §J. Sample responses are part of the quote.

## Response rules

- Answer in the same numbering as this document.
- For each item, provide: **Answer**, **Contract/terms reference**, **Evidence
  (doc/sample)**, **Limitation or exception**.
- State the date and version of the answer.
- Distinguish “included in the base licence,” “available as a paid add-on,”
  “roadmap,” and “not available.”
- If a question does not apply, write “N/A” and explain why.
- Do not include customer data or credentials in the response.

## A. Intended use and distribution

| ID | Question |
|---|---|
| **A-01** | Describe, in your own words, the intended use you are quoting for: a **personal, single-user desktop application** installed on one person’s computer, used for that person’s own investment research. |
| **A-02** | Does your licence permit this exact use? Quote the clause or state that no clause permits it. |
| **A-03** | Is the licence per person, per device, per household, or per organisation? How many devices may one user install the app on? |
| **A-04** | May the user’s family/household members view the app on the same device? If not, how do you define “personal use”? |
| **A-05** | May the application be distributed (including free distribution) to other users, each with their own subscription and credentials? If not, is the licence limited to the project owner’s own use? |
| **A-06** | May the user use the data for personal investment research, including comparing companies and tracking a personal portfolio? |
| **A-07** | May the application display data to the user only, with no public web display, server-side redistribution, or API resale? |
| **A-08** | May the user export data (CSV/Excel/PDF) for personal use? Any volume or frequency limit? |
| **A-09** | May the user share screenshots or small excerpts? If yes, what attribution is required? |
| **A-10** | Confirm whether the licence prohibits resale, sublicensing, service-bureau use, or providing the data as a public API. |
| **A-11** | May the application cache data locally and operate offline for already-synced data? |
| **A-12** | Are there geographic restrictions (for example, Nepal-only use or Nepal-only data storage)? |

## B. Storage, offline use, and derived analytics

| ID | Question |
|---|---|
| **B-01** | May the application store data **persistently** in a local SQLite database on the user’s device? |
| **B-02** | May raw API responses and normalised tables both be stored? |
| **B-03** | How long may historical data be retained after the subscription ends? |
| **B-04** | Must stored data be deleted on termination? By what date, and what evidence must the user provide? |
| **B-05** | May local backups include the stored data? Must backups be encrypted? |
| **B-06** | May the application continue to display already-stored data offline after the subscription ends? For how long? |
| **B-07** | May the application compute and store derived analytics: SMA, EMA, RSI, MACD, Bollinger Bands, returns, volatility, drawdown, relative strength, screeners, scores, heatmaps, portfolio P&L, and alerts? List any prohibited derived output. |
| **B-08** | May derived analytics be displayed to the user, stored locally, and exported? |
| **B-09** | May the application create charts, heatmaps, and reports from the data? |
| **B-10** | May the application combine your data with the user’s own portfolio transactions, official filings, and/or another licensed source? If yes, what attribution/source-switch rules apply? |
| **B-11** | May derived data be retained after termination even if raw data must be deleted? |
| **B-12** | Does your licence claim ownership of derived data? If so, what rights do we retain? |
| **B-13** | May the data be used to train machine-learning models? (R1 does not require this; answer for future scope.) |
| **B-14** | May the data be used for local backtesting? Any restriction on displaying backtest results? |
| **B-15** | Must delayed data be labelled as delayed? What exact label and delay must be shown? |
| **B-16** | What attribution, logo, or copyright notice is required? Give the exact wording and placement. |
| **B-17** | Are there display restrictions on index values, sector data, or exchange-derived statistics? |
| **B-18** | May index constituent or sector membership data be stored and displayed? |
| **B-19** | Is there any audit, reporting, or usage-log obligation for a personal single-user licence? |
| **B-20** | Confirm that written permission covers all R1 uses in `docs/RELEASE1_DATA_REQUIREMENTS.md`. If not, list every exception. |

## C. Technical access, endpoint, and rate limits

| ID | Question |
|---|---|
| **C-01** | What is the **production** base URL? If only a UAT/sandbox URL exists, state the production availability date. |
| **C-02** | Is the API REST/JSON? Provide an OpenAPI/Swagger/Postman collection or equivalent schema. |
| **C-03** | What authentication method is used? Can each end user have their own credentials, or is a shared organisation key required? |
| **C-04** | Can a **desktop application** authenticate directly with your API, or must all requests go through a server you control? |
| **C-05** | What are the access-token and refresh-token lifetimes? How should a desktop app handle expiry and clock skew? |
| **C-06** | Is an **IP allow-list** required? If yes, how does a single-user desktop app work on a dynamic residential IP? Can the allow-list be disabled or scoped per user? |
| **C-07** | State the exact rate limits: requests per minute, per hour, per day, burst limit, per-endpoint limits, and whether limits differ by package. |
| **C-08** | Are rate-limit headers returned (`X-RateLimit-*`, `Retry-After`)? What is the expected backoff on HTTP 429? |
| **C-09** | Is there a test mode or sandbox? What are its limits, data coverage, and cost? |
| **C-10** | How is the API versioned (URL path, header, or both)? What is the deprecation notice period for breaking changes? |
| **C-11** | What is the maximum page size? How does pagination work? |
| **C-12** | Is there a bulk historical export endpoint or file delivery option? If yes, what format and cost? |
| **C-13** | What timestamp/timezone conventions are used? Are timestamps ISO 8601 with offset? |
| **C-14** | What are the error codes and retry semantics for transient failures, invalid symbols, and permission errors? |
| **C-15** | What uptime/SLA do you commit to? Provide the measurement method and exclusions. |
| **C-16** | What are the maintenance windows and incident-notification process? Is there a public status page? |
| **C-17** | What is the update cadence for each dataset: live quotes, EOD OHLCV, index, floorsheet, fundamentals, corporate actions, IPOs? |
| **C-18** | Are historical backfills allowed through the API? Any separate backfill quota or approval? |
| **C-19** | What is the maximum number of concurrent connections or requests per user? |
| **C-20** | Do you support streaming/webhooks? If yes, describe the protocol, reconnect behaviour, and cost. |
| **C-21** | Are there CORS, user-agent, or client-fingerprint restrictions that affect a packaged Electron app? |
| **C-22** | What is your guidance for storing API credentials on a user’s device? Do you provide per-user keys that can be revoked? |
| **C-23** | Where are requests logged, and for how long? Can the user opt out of request logging? |
| **C-24** | Is there a data-residency requirement for stored data? |

## D. Data requirements

Answer each item with fields, depth, coverage, and limitations. The R1 IDs in
brackets map to `docs/RELEASE1_DATA_REQUIREMENTS.md`.

### D1. Masters, calendar, and identifiers

| ID | Question |
|---|---|
| **D-01** | [D01] List the company-master fields. Include symbol, name, sector, instrument type, listing date, status, company ID, and any aliases. |
| **D-02** | [D01] Does the master include delisted and suspended companies? If yes, since when? |
| **D-03** | [D02] List the security-master fields. Include symbol, company, instrument type (equity, promoter, mutual fund, bond/debenture), ISIN, status, and listed shares. |
| **D-04** | [D02] How are symbol changes, mergers, and demergers represented? Is historical symbol mapping provided? |
| **D-05** | [D03] Provide the trading calendar: session dates, holidays, special closures, market open/close, and timezone. How far back and forward does it go? |
| **D-06** | [D03] How are unscheduled closures and half-days communicated? |
| **D-07** | [D02] How are securities that are listed but not traded, or suspended, represented? |
| **D-08** | [D01/D02] What identifiers are stable across time (company ID, ISIN, symbol)? Which can change? |

### D2. Daily prices, indices, and sectors

| ID | Question |
|---|---|
| **D-09** | [D04] List the daily OHLCV fields, units, and precision. Include previous close, volume, turnover, trades, and percentage change if available. |
| **D-10** | [D04] What is the earliest date per symbol? Is five years available for **all** listed equities, or only a subset? Provide a coverage matrix by symbol/year. |
| **D-11** | [D04] Does a date-range request return exactly the requested window, or “the most recent N rows up to the end date”? State the exact semantics. |
| **D-12** | [D04] How are missing sessions, suspensions, and holidays represented: absent rows, nulls, zero volume, or repeated closes? |
| **D-13** | [D04] Are duplicate rows possible? How are they prevented or identified? |
| **D-14** | [D05] Do you provide an **adjusted** price series? If yes, what is adjusted (bonus, right, cash dividend, split) and what is the methodology? |
| **D-15** | [D05] If you do not provide adjusted prices, do you provide **adjustment factors** with event date, reason, ratio/amount, and source? |
| **D-16** | [D05] Are unadjusted prices also available and clearly separated from adjusted prices? |
| **D-17** | [D05] How do you handle mergers, demergers, symbol changes, and capital reductions in the price series? |
| **D-18** | [D06] List the index-history fields and available indices. Is NEPSE index history available for five years? |
| **D-19** | [D06] Is index history OHLC or close-only? What is the update cadence? |
| **D-20** | [D07] Which sector and sub-indices are available? Provide five-year history for at least three representative sectors. |
| **D-21** | [D07] Is sector membership history available, or only the current classification? How are reclassifications handled? |
| **D-22** | [D06/D07] What is the index methodology (free-float, full market cap, price-weighted)? Are historical methodology changes documented? |

### D3. Live data

| ID | Question |
|---|---|
| **D-23** | [D08] List the live-quote fields and the exact timestamp semantics (exchange time, provider time, receipt time). |
| **D-24** | [D08] What is the update cadence during trading hours and when the market is closed? Is the data real-time, delayed, or snapshot? |
| **D-25** | [D08] Is there a market-status endpoint (open/closed/pre-open/holiday)? |
| **D-26** | [D08] List the market-summary fields and define turnover, volume, transactions, and scrips traded. |
| **D-27** | [D08] How do you define “close” versus “last traded price”? Which should be used for valuation and P&L? |
| **D-28** | [D08] Are auction, block, odd-lot, and negotiated trades included in live quotes and summary? If not, where are they reported? |

### D4. Fundamentals and financial statements

| ID | Question |
|---|---|
| **D-29** | [D09] List the current-fundamentals fields, definitions, units, and fiscal-period conventions. |
| **D-30** | [D09] Are values reported, derived, or estimated? How is confidence/quality labelled? |
| **D-31** | [D09] How are negative, zero, and missing values represented? Confirm that missing is never silently zero-filled. |
| **D-32** | [D10] Is **five years of quarterly and annual core metrics** available for all listed companies, or only a subset? Provide a coverage matrix. |
| **D-33** | [D10] Confirm the minimum period count: 20 quarters and 5 annual periods. If not available, state the exact maximum. |
| **D-34** | [D10] Are reported date, period end, fiscal year, statement type, consolidation basis, and restatement flag provided for each period? |
| **D-35** | [D10] How are restatements handled? Is the old value retained and versioned? |
| **D-36** | [C2] Are full balance sheet, income statement, and cash-flow statements available? For how many years and companies? |
| **D-37** | [C2] Are statements consolidated or standalone? Can both be requested? |
| **D-38** | [C2] Are the original report PDFs available, and may they be stored and parsed locally? |
| **D-39** | [C2] Is XBRL or a structured statement schema available? If not, what is the machine-readable format? |
| **D-40** | [D10] How are banks, insurers, hydropower companies, and manufacturing companies handled differently in the ratio definitions? |

### D5. Corporate actions and issues

| ID | Question |
|---|---|
| **D-41** | [D11] List the corporate-action types you cover: bonus, right, cash dividend, split, merger, demerger, symbol change, capital reduction, other. |
| **D-42** | [D11] For each type, list the dates provided: announcement, book close, record, ex-date, payment, effective date. |
| **D-43** | [D11] Is the adjustment factor provided directly, or must it be computed? Provide the formula and a worked example. |
| **D-44** | [D11] How are fractional shares, rounding, and multiple events in the same period handled? |
| **D-45** | [D11] Are corporate actions sourced from NEPSE, SEBON, company filings, or a secondary source? Provide source URLs/IDs. |
| **D-46** | [D12] List the IPO/FPO/right/debenture fields and statuses. Does the feed include historical issues as well as the current pipeline? |
| **D-47** | [D12] How far back does issue history go? Provide at least 20 issues for cross-checking. |
| **D-48** | [D12] Are allotment results, oversubscription, and investor-category data available? (R2) |
| **D-49** | [D12] Is lock-in data available? From which source? (R2) |
| **D-50** | [D11/D12] How are corrections to issue dates, prices, or allotment data handled? |

### D6. Floorsheet and broker data

| ID | Question |
|---|---|
| **D-51** | [D13] List the floorsheet fields. Include business date, contract ID, symbol, buyer broker, seller broker, quantity, rate, amount, and trade time. |
| **D-52** | [D13] Does a historical `businessDate` request return that date’s trades, or the current day? State the exact semantics. |
| **D-53** | [D13/C1] What is the historical floorsheet depth? Is five years available? Provide a coverage matrix by year. |
| **D-54** | [D13] Are broker IDs and names provided? Are they stable over time? |
| **D-55** | [D13] Are odd-lot, block, auction, and negotiated trades included? If excluded, state the rule and the expected turnover difference. |
| **D-56** | [D13] How are cancelled or corrected trades represented? Is there a revision feed? |
| **D-57** | [C7] Do you provide aggregated broker flows or concentration metrics, or only raw floorsheet? |

### D7. Delisted, intraday, news, and funds

| ID | Question |
|---|---|
| **D-58** | [C3] Are delisted and suspended securities covered? Provide listing date, delisting date, reason, last traded price, and symbol history. |
| **D-59** | [C3] Is historical index membership available for delisted constituents? |
| **D-60** | [C4] Is historical intraday data available? State intervals (1m/5m/15m/1h), depth, and symbols. |
| **D-61** | [C4] Is intraday data available for indices as well as equities? |
| **D-62** | [C5] Are news/announcements available? May they be stored and displayed, or only linked? |
| **D-63** | [C6] Are mutual fund NAV, holdings, and income statements available? What depth? |
| **D-64** | [C9] Is ownership/shareholding history available (promoter/public, board/management)? |
| **D-65** | [D04–D13] Provide a single **dataset × year × coverage** matrix for all R1 datasets, including known gaps and exclusions. |

## E. Data quality, corrections, and SLA

| ID | Question |
|---|---|
| **E-01** | What is your process for correcting bad ticks, wrong OHLC values, missing sessions, and duplicate records? |
| **E-02** | How are corrections notified to customers (feed flag, changelog, email, status page)? |
| **E-03** | What is the committed correction time for a confirmed data error (for example, same day, next business day, five business days)? |
| **E-04** | How are restatements handled for financial statements and corporate actions? Is history versioned? |
| **E-05** | Publish your known-exclusions list: odd lots, block trades, suspended securities, delisted securities, auction trades, certain instruments, certain years. |
| **E-06** | Do you provide a coverage report that lets a customer verify expected sessions versus delivered sessions? |
| **E-07** | How do you notify customers of incidents, outages, and delayed feeds? What is the target notification time? |
| **E-08** | Describe your internal data validation/QA. Do you reconcile against NEPSE/SEBON/CDSC? How often? |
| **E-09** | What is your historical revision policy? Can a previously delivered value change without a version flag? |
| **E-10** | What freshness/latency SLA do you commit to for live quotes and EOD data? |
| **E-11** | How is uptime measured, and what are the exclusions? |
| **E-12** | What support is included for data discrepancies? Is there a named data-quality contact? |
| **E-13** | What is the escalation path for a blocking data error during market hours? |
| **E-14** | Do you provide root-cause reports for material incidents? |
| **E-15** | Do you provide audit logs or delivery manifests for historical backfills? |

## F. Pricing and commercial terms

State currency, taxes, and whether each line is one-time or recurring. Do not
provide a single bundled price without the breakdown.

| ID | Question |
|---|---|
| **F-01** | What currency are prices quoted in? Are taxes (including VAT) included? |
| **F-02** | Price for the R1 base package for one personal single-user desktop licence. |
| **F-03** | Price for five-year daily OHLCV history. Is it included or an add-on? |
| **F-04** | Price for five-year NEPSE and sector index history. |
| **F-05** | Price for five-year core fundamentals history (20 quarters / 5 annual periods). |
| **F-06** | Price for full five-year financial statements, if available. |
| **F-07** | Price for current-day floorsheet. |
| **F-08** | Price for historical floorsheet, per year and for five years. |
| **F-09** | Price for corporate actions and adjustment factors. |
| **F-10** | Price for IPO/FPO/right/debenture pipeline and history. |
| **F-11** | Price for delisted/suspended history. |
| **F-12** | Price for historical intraday data, if available. |
| **F-13** | Price for news/announcements, if available. |
| **F-14** | Price for mutual fund NAV/holdings, if available. |
| **F-15** | Is the licence per user, per device, or per organisation? What is the cost for a second device? |
| **F-16** | What is the minimum contract term? Is auto-renewal required? |
| **F-17** | What is the price-change notice period, and is there a renewal price cap? |
| **F-18** | What are the overage charges if a rate limit is exceeded? |
| **F-19** | What is the refund/cancellation policy? |
| **F-20** | What is the total first-year cost for the recommended R1 scope, itemised? |
| **F-21** | What is the cost of a 60-session historical-floorsheet evaluation add-on? |
| **F-22** | Is there a paid or free trial? What does it include, and does it auto-convert? |
| **F-23** | Are there separate fees for bulk historical export, onboarding, or support? |
| **F-24** | What is the price validity period for this quote? |

## G. Trial terms

| ID | Question |
|---|---|
| **G-01** | What is the trial duration? |
| **G-02** | What datasets and historical depth are available during the trial? |
| **G-03** | What are the trial rate limits? Are they the same as production? |
| **G-04** | Is the trial free? If not, what is the cost? |
| **G-05** | Does the trial use production data or a sandbox/test dataset? |
| **G-06** | May trial data be stored locally for evaluation? Must it be deleted afterwards? By when? |
| **G-07** | May we publish a non-public evaluation report internally, including sample metrics and error counts? |
| **G-08** | Confirm that the trial does not automatically convert into a paid subscription. |
| **G-09** | Provide the written trial terms, including data-use and confidentiality restrictions. |
| **G-10** | How is trial access granted: keys, account, IP allow-list, or a hosted sandbox? |
| **G-11** | What support is available during the trial? |
| **G-12** | Can the trial be extended if a dataset is delayed? |

## H. Licensing, termination, and legal

| ID | Question |
|---|---|
| **H-01** | What is the contract term? |
| **H-02** | May either party terminate for convenience? With how much notice? |
| **H-03** | What constitutes termination for breach, and what cure period applies? |
| **H-04** | On termination, may the user retain historical data for offline reference? For how long? |
| **H-05** | Must the user delete data, and what proof is required? |
| **H-06** | Is transition assistance provided if the user switches providers? |
| **H-07** | What notice is required for price changes or material terms changes? |
| **H-08** | What happens on a change of control, insolvency, or sale of the provider? |
| **H-09** | Are subcontractors, cloud hosts, or upstream data vendors used? Who are they? |
| **H-10** | What confidentiality obligations apply to the user’s data and usage? |
| **H-11** | What liability cap and indemnity apply to data errors or third-party claims? |
| **H-12** | What governing law and venue apply? |
| **H-13** | What dispute-resolution process applies? |
| **H-14** | What audit rights does the provider have over a personal desktop user? |
| **H-15** | Who owns the data, the database schema, and derived analytics? |
| **H-16** | Warrant that you have the right to license every dataset in this RFQ for the intended use. |
| **H-17** | If you claim NEPSE reseller/licensed status, provide current written evidence and the scope of that authorization. |
| **H-18** | How will you indemnify the user against third-party claims arising from your data? |
| **H-19** | Do you maintain professional liability/cyber insurance? |
| **H-20** | State the order of precedence between this RFQ, the quote, the terms, and any online policy. |

## I. Support

| ID | Question |
|---|---|
| **I-01** | What support channels are available (email, ticket, phone, chat)? |
| **I-02** | What are the support hours and timezone? |
| **I-03** | What are the target response and resolution times for P1/P2/P3 issues? |
| **I-04** | Who is the named technical and commercial contact? |
| **I-05** | What is the escalation path for a production outage or blocking data error? |
| **I-06** | Is there a public status page or incident feed? |
| **I-07** | What documentation is provided (API reference, data dictionary, examples, changelog)? |
| **I-08** | Is onboarding assistance included? How many hours? |
| **I-09** | How are incidents and planned maintenance communicated? |
| **I-10** | What language is support provided in? |

## J. Required attachments and evidence

Ask the provider to attach these to the quote. A quote without samples is
incomplete.

| ID | Attachment |
|---|---|
| **J-01** | OpenAPI/Swagger/Postman collection or equivalent endpoint schema. |
| **J-02** | Data dictionary for every R1 dataset (fields, types, units, null rules). |
| **J-03** | Sample response for every R1 endpoint. |
| **J-04** | Historical coverage matrix: dataset × year × symbol/index coverage. |
| **J-05** | Sample five-year OHLCV for at least three symbols, including a corporate action. |
| **J-06** | Sample five-year index and sector-index history. |
| **J-07** | Sample current fundamentals and 20 quarters / 5 annual periods for one company. |
| **J-08** | Sample corporate actions with adjustment factors and source notices. |
| **J-09** | Sample current and historical floorsheet, including broker IDs. |
| **J-10** | Sample IPO/FPO/right/debenture pipeline and history. |
| **J-11** | Sample delisted/suspended record, if offered. |
| **J-12** | Sample intraday bars, if offered. |
| **J-13** | Draft licence/terms and data-use policy. |
| **J-14** | NEPSE reseller/licence evidence, if claimed. |
| **J-15** | SLA, support policy, and status-page details. |
| **J-16** | Trial terms and access instructions. |
| **J-17** | Price quote with line items and validity period. |
| **J-18** | Security/privacy documentation for credential handling and request logs. |

## Response template

Ask the provider to return this table plus the attachments.

| ID | Answer | Contract/terms clause | Evidence/sample | Limitation/exception |
|---|---|---|---|---|
| A-01 | | | | |
| … | | | | |

## R1 mapping for evaluation

The decision matrix uses these mappings; the provider does not need to fill them
in, but the answers must cover them.

| R1 ID | Required dataset | RFQ questions | Trial test |
|---|---|---|---|
| D01 | Company master | D-01, D-02, D-07, D-08 | T1 |
| D02 | Security master | D-03, D-04, D-07, D-08 | T1 |
| D03 | Trading calendar | D-05, D-06 | T2 |
| D04 | Daily OHLCV | D-09–D-13, D-65 | T3 |
| D05 | Corporate-action adjustment | D-14–D-17, D-41–D-45 | T8 |
| D06 | NEPSE index history | D-18, D-19, D-22 | T4 |
| D07 | Sector index history | D-20–D-22 | T5 |
| D08 | Live quotes and summary | D-23–D-28 | T6 |
| D09 | Current fundamentals | D-29–D-31, D-40 | T9 |
| D10 | Core fundamentals history | D-32–D-35, D-40 | T10 |
| D11 | Corporate actions | D-41–D-45 | T7 |
| D12 | IPO/FPO/right pipeline | D-46–D-50 | T13 |
| D13 | Current-day floorsheet | D-51–D-56 | T11 |
| D14 | Provenance and corrections | E-01–E-15, C-23 | T0/T19 |
| D15 | Local persistence/offline | B-01–B-06 | T19 |
| D16 | Quality/SLA | E-01–E-15 | T18 |
| D17 | Written usage rights | A-01–A-12, B-01–B-20, H-01–H-20 | Legal review |
| C1 | Historical floorsheet | D-53, D-55, D-56, F-08, F-21 | T12 |
| C2 | Full statements | D-36–D-39, F-06 | T10b |
| C3 | Delisted history | D-58, D-59, F-11 | T14 |
| C4 | Historical intraday | D-60, D-61, F-12 | T15 |

## What this RFQ does not do

- It does not contact, trial, or purchase from any provider.
- It does not authorise production use of any dataset.
- It does not change the Phase 0 gate or the NO-GO verdict.
- It does not select a provider or declare a release GO.

The Phase 0 verdict remains **NO-GO for production** until a licensed provider
passes the gate and the trial with written rights.

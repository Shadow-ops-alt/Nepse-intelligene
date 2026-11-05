# Release 1 Data Requirements

Date: **2026-11-04**
Status: **planning only.** No provider has been contacted, no trial has been
used, no subscription has been purchased, and no production data has been
acquired. The Phase 0 verdict remains **NO-GO for production**.

This document is the canonical Release 1 data scope. It supplements the Phase 0
gate in `docs/PHASE0.md`; it does **not** replace or weaken it. Where this
document and the gate differ:

- the **gate** governs whether production work is authorised;
- this document governs what “Release 1 data complete” means;
- both must pass before Release 1 production work starts.

Related documents:

- `docs/PHASE0.md` — the unchanged validation gate and thresholds.
- `docs/PHASE0_FINDINGS.md` — Phase 0 evidence and NO-GO verdict.
- `docs/PROVIDER_COMPARISON.md` — provider research evidence.
- `docs/PROVIDER_RFQ.md` — the standardised request for quote.
- `docs/PROVIDER_TRIAL_PROTOCOL.md` — trial corpus, tests, thresholds, and
  error taxonomy.
- `docs/PROVIDER_DECISION_MATRIX.md` — evidence-only provider comparison.
- `docs/PERSONAL_MODE.md` — free-source data path used by the Free Edition. It
  is a de-risking and delivery tool for that edition and does **not** reduce,
  defer, or satisfy any Release 1 licensed requirement.

## 1. Purpose

The Phase 0.5 research described “ten data categories” without saying which
were launch-critical, which were later releases, and which were optional. That
made it impossible to price a provider, compare MDP and ShareHub fairly, or tell
whether a scope reduction was a product decision or a hidden omission.

This document fixes that by:

1. defining Release 1, Release 2, Release 3, and optional datasets;
2. keeping every previously stated requirement visible;
3. recording every proposed scope reduction and its product implication;
4. treating historical floorsheet, five-year financial statements, delisted
   securities, and historical intraday data as four separate owner decisions;
5. separating what the Phase 0 harness actually enforces from what Release 1
   actually needs.

## 2. Definitions

| Term | Meaning |
|---|---|
| **Release 1 (R1)** | The first production release: a personal, single-user desktop analysis terminal for the current listed universe, with five years of EOD history, fundamental trends, current-day floorsheet, watchlists/portfolio, and visible provenance. |
| **Release 2 (R2)** | Depth and trust release: historical floorsheet, full financial statements, delisted/suspended history, broker analytics, IPO allotment/lock-in, licensed news storage. |
| **Release 3 (R3)** | Specialist release: historical intraday bars, mutual fund NAV/holdings, ownership history, advanced/backtest features that need the above. |
| **Optional** | Useful but not a production dependency. May be a link-out, a local-only feature, or a paid add-on. |
| **Mandatory R1** | Must be licensed and pass the trial before R1 production. Missing it blocks R1. |
| **Conditional R1** | A scope decision the project owner must make before the RFQ is sent. This document states a recommendation, not a decision. |
| **Gate-enforced** | The Phase 0 harness has a check that can fail the provider. A gate pass does not imply full R1 coverage. |
| **Trial-enforced** | The acceptance test in `docs/PROVIDER_TRIAL_PROTOCOL.md`; stricter than the gate where stated. |

Evidence labels used here follow `docs/PROVIDER_COMPARISON.md`:
**Verified**, **Vendor claim**, **Inference**, **Unverified**, **Not found**.

“Five years” in this document means **a trailing 60-month window ending on the
last complete trading day before the production cut-off or trial start**. It
does **not** mean “2019 to present.” The five-year window for a trial starting
2026-11-04 is **2021-11-04 → 2026-11-03**. A 2019 request is an optional depth
stress probe, not the acceptance window. See
`docs/PROVIDER_TRIAL_PROTOCOL.md` §3.

## 3. Release definitions

### Release 1 — current-universe analysis terminal

R1 must support:

- market overview: NEPSE index, sector indices, market summary, gainers/losers,
  heatmap;
- company research: five-year EOD chart, core technical indicators, current
  fundamentals, five-year core fundamental trends;
- corporate-action-aware returns (bonus/right/cash/split);
- current-day floorsheet and simple broker totals;
- watchlists, local portfolio ledger, cost basis, and P&L;
- provenance, freshness, and correction status on every price;
- local SQLite storage and offline reading of already-synced data.

R1 does **not** promise full financial statements, historical floorsheet,
delisted-universe backtests, or historical intraday bars. Those are explicit
decisions in §5.

### Release 2 — depth and trust

R2 may add:

- historical floorsheet and broker concentration/accumulation analytics;
- full five-year balance sheet, income statement, and cash-flow statements;
- delisted and suspended security history, enabling survivorship-bias-aware
  research;
- IPO allotment/results and lock-in tracking;
- licensed news storage and search;
- ownership/shareholding history;
- peer comparison and fundamental screener depth.

### Release 3 — specialist and heavy-history features

R3 may add:

- historical intraday bars and replay;
- mutual fund NAV/holdings and fund overlap;
- index constituent history and reclassification history;
- advanced backtesting across the full delisted universe;
- ML/feature-store work.

### Optional

Link-out news, screenshot/PDF export, calendar export, alert delivery channels,
and other conveniences may ship without being R1 data dependencies.

## 4. Mandatory Release 1 datasets

These are the recommended R1 hard requirements. “Gate” shows what the current
Phase 0 harness actually checks; a blank or partial gate entry is a known gap,
not permission to skip the requirement.

| ID | Dataset | Minimum content | Required depth / coverage | Acceptance (trial) | Gate coverage | Current provider evidence |
|---|---|---|---|---|---|---|
| **D01** | Company master | Symbol, name, sector, instrument type, listing date, status, company ID | Current master plus five years of status changes where available | 100% of sampled symbols resolve; no duplicate symbols; sector present | `company-list` (pass/fail) | ShareHub documented; MDP claim; NEPSE official |
| **D02** | Security master | Symbol, company, instrument type (equity, promoter, fund, bond/debenture), ISIN, status, listed shares | Current master; historical symbol changes where available | No orphan securities; all sampled symbols resolve to a company | `security-list` (pass/fail) | MDP claim; ShareHub partial (full stock table, instrument types not explicit); CDSC/ISIN |
| **D03** | Trading calendar | Session dates, holidays, special closures, market open/close, Asia/Kathmandu timezone | Five years historical plus at least 12 months forward | Exact match to official NEPSE calendar for sampled years; no holiday inferred from an empty response | **No dedicated gate check** | ShareHub holidays documented; MDP market-status claim; NEPSE official |
| **D04** | Daily OHLCV, unadjusted | Date, open, high, low, close, previous close, volume, turnover, trades, symbol, source | Trailing five years; all listed equities; at least 1,100 sessions per liquid symbol | ≥95% of official sessions for liquid sample; no unexplained gap >5 consecutive sessions; OHLC invariants; 20-date close reconciliation; no duplicate dates | `daily-ohlc-history` (≥90% of Sun–Thu weekdays; start lag ≤45 days; latest lag ≤10/30 days) | ShareHub 5Y/ALL documented; MDP 5–10 years claimed; NEPSE web depth unknown |
| **D05** | Corporate-action adjustment | Adjusted OHLC **or** reproducible adjustment factors with event date, reason, ratio/amount, source | Same five years; every bonus, right, cash dividend, split, merger, symbol change affecting sampled symbols | ≥5 events reproduce from official notices; adjusted series continuous across ex-date; unadjusted series retained | **No explicit adjustment-factor check**; `corporate-actions` only | ShareHub lists dividends/offerings but not factors; MDP claims corporate actions; NepseAlpha adjusted web is not a licensed feed |
| **D06** | NEPSE index history | Date, open/high/low/close or close, index name, source | Five years daily | ≥95% of official sessions; at least 1,100 points; 20-date reconciliation | `index-history` (five-year window) | ShareHub 1W–5Y–ALL documented; MDP claim; official depth unpublished |
| **D07** | Sector index history | Sector index OHLC/close, sector name, membership snapshot | Five years daily; at least three representative sectors | Same coverage as D06 for 3+ sectors; membership snapshot recorded | **No sector-history check**; `sectors`/`indices` are only preferred capabilities | ShareHub sector performance and sector index charts documented; MDP claim; NEPSE official |
| **D08** | Live quotes and market summary | LTP, OHLC, previous close, volume, turnover, timestamp, market status; index value, turnover, transactions, scrips | Live during session; one full session observed | Freshness ≤60s during session; no >5-minute stale quote without flag; EOD close reconciles; summary arithmetic consistent | `live-quotes` (>7 days fail, >1 day warn), `market-summary` | ShareHub ~20s documented; MDP ~15s claimed/independent integrator; NEPSE licensed live feed |
| **D09** | Current fundamentals | EPS, ROE, ROA, P/E, P/B, book value, net profit, market cap, dividend yield, fiscal period, reported date, source | Latest reported period | ≥5 companies reconcile to official reports; confidence labels present; no zero-filled missing values | `fundamentals-latest` (fail if no usable metrics; warn if unverified/estimated) | ShareHub latest ratios documented; MDP claim; official PDFs |
| **D10** | Fundamentals history, core metrics | EPS, ROE, ROA, net profit, book value, and derived valuation inputs by period | **20 quarters and 5 annual periods** for all listed companies with filings; trial samples five | 20Q/5A for ≥5 companies; period labels and restatement flags; ≥5 company-years reconcile; missing values explicit | `fundamentals-history` (**passes at 4 periods**, warns below 12) — **gate gap** | MDP quarterly/annual claim; ShareHub latest ratios only (not documented); official PDFs |
| **D11** | Corporate actions | Type (bonus, right, cash, split, merger, symbol change), announcement date, book-close/record date, ex-date, ratio/amount, factor, source URL | Five years; all listed equities | ≥5 companies covering bonus, right, and cash; 100% of sampled events reconcile; no invented dates | `corporate-actions` (empty = **warning**, no depth check) — **gate gap** | ShareHub dividends/offerings/announcements (partial, no factors); MDP claim; NEPSE/SEBON official |
| **D12** | IPO/FPO/right/debenture pipeline | Issue type, company, status, open/close dates, price, units, investor category, source | Current pipeline plus five years of historical status | ≥20 issues cross-checked against SEBON/CDSC; status and dates correct | `ipos` (empty = **warning**) — **gate gap** | ShareHub public offerings documented; MDP claim; SEBON/CDSC authoritative |
| **D13** | Current-day floorsheet | Business date, contract ID, symbol, buyer broker, seller broker, quantity, rate, amount, trade time | Current or previous session in R1; historical depth is decision C1 | Date honoured 100%; no duplicate contract IDs; turnover within 0.5% or documented exclusion; 20 trades reconcile | `floorsheet` (previous trading day; empty/wrong date fail; **no history depth**) | ShareHub **not documented**; MDP live/historical claim; NEPSE current-day official; unofficial current-day only |
| **D14** | Provenance and corrections | Source, terms status, reliability, `asOf`, `fetchedAt`, raw hash, adjustment flag, restatement version, correction log | Every record and every raw response | 100% of records carry provenance; raw response reproducible; corrections versioned; no silent overwrite | `provider-metadata`, `runtime-policy` (partial; not per-record completeness) | Harness exists; vendor correction/SLA evidence unknown for both |
| **D15** | Local persistence and offline use | SQLite schema for raw and normalised data, offline reads, export with provenance | Full R1 history on device | Offline analysis works without network; no data loss; provenance retained; export reproducible | **No gate check** | Architecture supports it; licence permission unknown for both |
| **D16** | Quality, SLA, and errata | Freshness, correction process, restatement handling, incident notification, deprecation policy | Written policy covering R1 datasets | Written SLA and correction process; trial exercises at least one correction; no silent revisions | Partial (`provider-metadata`, live freshness) | **Not found** for both |
| **D17** | Written usage rights | Personal single-user use, local persistent storage, offline display, derived analytics, export, no redistribution, termination/retention | Covers every R1 dataset and the desktop distribution model | Written terms reviewed by legal; `termsStatus=verified`; no conflicting restriction | `runtime-policy` requires verified terms in production but does **not** inspect contract scope | **Not found** for both; a vendor “NEPSE-licensed” claim is not a grant |

## 5. Conditional Release 1 decisions

These four decisions were previously mixed into the general requirement list.
They are now separate. Each needs an explicit owner decision before the RFQ is
sent. The recommendation is a default, not a decision.

### C1 — Historical floorsheet

**Previous requirement.** `docs/DATA_SOURCES.md` item 3 requires historical
floorsheet with contract-level trades and broker IDs. `docs/DATA_ACQUISITION_PLAN.md`
category 7 and `docs/FEATURES.md` features 42–46 assume it. `docs/PHASE0_FINDINGS.md`
blocker B3 records that the unofficial source cannot satisfy it.

**Options.**

| Option | Meaning | Consequence |
|---|---|---|
| **C1-A** | R1 mandatory, five years | R1 includes historical broker analytics; MDP (claim) or an official NEPSE archive becomes mandatory; ShareHub alone is not viable. |
| **C1-B (recommended)** | R1 current-day only; historical floorsheet is R2 | R1 keeps D13 (current/previous session). Features 42–46 move to R2. Procurement can price 60 sessions as an option without making it a launch blocker. |
| **C1-C** | Out of scope | Removes broker-history features entirely. This is a larger product reduction than C1-B and must be stated in the product positioning. |

**Recommendation: C1-B.** Keep current-day floorsheet, defer historical depth to
R2, and request a priced 60-session option so the cost is known.

**Implications of C1-B.**

- No historical broker accumulation/distribution, broker concentration trends,
  block-deal history, or date-scoped floorsheet reports in R1.
- MDP’s strongest differentiator is not needed for R1, which materially reduces
  the case for accepting MDP’s documentation risk.
- The Phase 0 gate still requires a date-scoped `floorsheet` capability. C1-B
  does **not** remove that gate requirement; it only limits depth.
- If the owner later restores C1-A, the RFQ must be re-issued with five-year
  floorsheet as a mandatory line item and MDP becomes a stronger candidate.

**Gate interaction.** The gate tests only the previous trading day. Historical
depth is trial-enforced, not gate-enforced.

**Owner decision:** ☐ C1-A ☐ C1-B (recommended) ☐ C1-C

### C2 — Five-year financial statements

**Previous requirement.** `docs/DATA_SOURCES.md` item 4 requires fundamentals
history; `docs/DATA_ACQUISITION_PLAN.md` category 6 calls it “five-year financial
history”; `docs/PROVIDER_COMPARISON.md` gap G2 calls it “five years of financial
statements.” These are not the same thing.

**Options.**

| Option | Meaning | Consequence |
|---|---|---|
| **C2-A** | R1 mandatory full statements: balance sheet, income statement, cash flow, five years | R1 supports full statement analysis and export. No provider has verified this; MDP claims it; otherwise a PDF extraction and human-review pipeline is required in R1. |
| **C2-B (recommended)** | R1 mandatory **core metric history** (D10: 20 quarters / 5 annual periods); full statements are R2 | R1 supports EPS/ROE/ROA/net-profit/book-value trends and screening, but not full balance-sheet or cash-flow analysis. |
| **C2-C** | R1 latest fundamentals only; all history is R2 | Weakens the “long-term fundamental comparison” promise and leaves the P0 feature “fundamentals history and trends” unimplemented. |

**Recommendation: C2-B.** Keep five-year core metric history in R1; move full
statements to R2. This is a real reduction from “five-year financial statements”
and is recorded as such.

**Implications of C2-B.**

- No full balance sheet, income statement, cash-flow statement, or statement
  export in R1.
- No restatement-level analysis beyond the core metrics’ restatement flags.
- Fundamental trends, valuation history, and screening remain possible.
- **This is still a hard R1 gap:** ShareHub documents latest ratios only; MDP
  claims quarterly/annual reports without depth or schema. If neither can supply
  D10, R1 needs an official-PDF extraction pipeline or is blocked.
- The Phase 0 gate requires a `fundamentalsHistory` capability but passes with
  only four periods. A gate `go` must not be read as C2-B compliance.

**Owner decision:** ☐ C2-A ☐ C2-B (recommended) ☐ C2-C

### C3 — Delisted and suspended securities

**Previous requirement.** `docs/DATA_SOURCES.md` item 9, `docs/PHASE0_FINDINGS.md`
blocker B6, and `docs/PROVIDER_COMPARISON.md` gap G5 require delisted history so
backtests are not survivorship-biased.

**Options.**

| Option | Meaning | Consequence |
|---|---|---|
| **C3-A** | R1 mandatory delisted/suspended history | R1 backtests and “what happened to this company?” research are unbiased. No provider documents this; an official NEPSE archive is required. |
| **C3-B (recommended)** | R2, with explicit survivorship-bias disclosure in R1 | R1 research and backtests are limited to the current listed universe and must say so in the UI and documentation. |
| **C3-C** | Out of scope permanently | Removes delisted research as a product goal; long-term backtests remain biased. |

**Recommendation: C3-B.** Disclose the bias in R1, solve it in R2 only if
backtesting remains a product goal.

**Implications of C3-B.**

- No unbiased long-term backtests in R1.
- No delisted-company pages, delisting-event history, or historical index
  membership analysis.
- Current-universe screens and charts are still valid if the bias is disclosed.
- Neither provider documents delisted coverage; even C3-A would require a new
  official source and legal review.

**Gate interaction.** The gate does not test delisted coverage at all.

**Owner decision:** ☐ C3-A ☐ C3-B (recommended) ☐ C3-C

### C4 — Historical intraday data

**Previous requirement.** `docs/DATA_ACQUISITION_PLAN.md` category 2 and
`docs/PROVIDER_COMPARISON.md` gap G6 mention historical intraday; `docs/FEATURES.md`
feature 10 is a P1 intraday chart. The product needs live intraday, not
necessarily historical intraday bars.

**Options.**

| Option | Meaning | Consequence |
|---|---|---|
| **C4-A** | R1 mandatory historical intraday (e.g., 1-minute bars, five years) | Enables intraday backtests/replay; no provider documents it; MDP’s minute-candle claim is unverified and comes from an integrator, not vendor docs. |
| **C4-B (recommended)** | R1 live intraday chart + EOD history; historical intraday is R3 | R1 shows live intraday and long-term EOD; no historical intraday backtests. |
| **C4-C** | No intraday at all | Removes the live intraday chart; simpler but weaker market overview. |

**Recommendation: C4-B.** Keep live intraday as a display feature; defer
historical intraday bars.

**Implications of C4-B.**

- No intraday replay, intraday VWAP history, or intraday backtests in R1.
- Live intraday quality depends on the vendor’s polling cadence and the app’s
  local sampling; it is not a historical dataset.
- The gate treats `intradayOhlc` as preferred and can warn/skip; it is not an R1
  hard gate.

**Owner decision:** ☐ C4-A ☐ C4-B (recommended) ☐ C4-C

### C5–C8 — Smaller scope decisions

| ID | Decision | Recommendation | Implication |
|---|---|---|---|
| **C5** | News | R2; R1 link-out to official NEPSE/company pages only | No stored/redistributed news content in R1; avoids a separate content licence. |
| **C6** | Mutual funds / NAV / holdings | R3 or optional | Removes fund features 51–53 from R1; no impact on the equity terminal. |
| **C7** | Broker flows / concentration | R2, dependent on C1 | R1 may show simple current-day broker totals from D13; no historical flow analytics. |
| **C8** | IPO allotment / lock-in tracker | R2; R1 keeps the issue pipeline (D12) | R1 shows current/past issues, not allotment results or lock-in tracking. |
| **C9** | Ownership/shareholding history | R2/R3 | No promoter/public holding history in R1. |
| **C10** | Full-text search / export | Optional/local | Local feature, not a data-provider requirement. |

## 6. Release 2 datasets

These are deferred, not deleted. R2 work starts only after R1 is in production
and the owner has approved the additional licence cost and trial scope.

| ID | Dataset | Why deferred | Prerequisite | Acceptance reference |
|---|---|---|---|---|
| **R2-D01** | Historical floorsheet | Cost/coverage unknown; not needed for R1 current-day analytics | C1 decision; MDP or official archive | Trial T12 (60 sessions minimum) |
| **R2-D02** | Full financial statements | Hardest provider gap; PDF extraction/human review required | C2 decision; MDP or official PDFs | Trial T10b |
| **R2-D03** | Delisted/suspended history | No provider documents it | C3 decision; NEPSE official archive | Trial T14 |
| **R2-D04** | Broker flows/concentration | Derived from historical floorsheet | R2-D01 | Trial T12 |
| **R2-D05** | IPO allotment/results | Separate SEBON/CDSC source; not needed for pipeline display | C8 decision | Trial T13b |
| **R2-D06** | Lock-in tracking | CDSC notices are PDFs; manual/structured ingestion | C8 decision | Trial T13b |
| **R2-D07** | News storage/search | Separate content licence; R1 uses link-out | C5 decision | Trial T16 |
| **R2-D08** | Ownership/shareholding history | Not required for R1 fundamentals | C9 decision | Trial T17 |
| **R2-D09** | Peer comparison depth | Needs R2-D02 and consistent sector mapping | R2-D01/D02 | Product acceptance |
| **R2-D10** | Backtesting across delisted universe | Needs R2-D03 | R2-D03 | Product acceptance |

## 7. Release 3 and optional datasets

| ID | Dataset/feature | Classification | Notes |
|---|---|---|---|
| **R3-D01** | Historical intraday bars | R3 | C4-B recommendation; live intraday remains R1 display. |
| **R3-D02** | Intraday replay/backtest | R3 | Depends on R3-D01. |
| **R3-D03** | Mutual fund NAV/history | R3 | C6 recommendation. |
| **R3-D04** | Mutual fund holdings/overlap | R3 | Needs fund portfolio disclosures. |
| **R3-D05** | Index constituent history | R3 | Needed for unbiased historical index analysis. |
| **R3-D06** | Ownership/board/management history | R3 | MDP claims some; unverified. |
| **R3-D07** | Analyst estimates / alternative data | Optional | Not in current product promise. |
| **OPT-01** | News link-out | Optional | No storage/redistribution; official links only. |
| **OPT-02** | CSV/PDF export with provenance | Optional/local | Local feature; licence must permit export. |
| **OPT-03** | Alert delivery (email/Telegram) | Optional/local | Not a data dependency. |
| **OPT-04** | Calendar export | Optional/local | Uses D03. |
| **OPT-05** | Screenshots/share cards | Optional/local | Licence/attribution review required. |

## 8. Scope reduction register

This register keeps every previously stated requirement visible. “Reduction”
means the item is no longer an R1 hard requirement; it does **not** mean the
requirement was deleted from the product.

### 8.1 From `docs/DATA_SOURCES.md` §“What a licensed provider must supply”

| ID | Previous requirement | Previous intent | New classification | Reduction? | Implication |
|---|---|---|---|---|---|
| S01 | Five years of adjusted and unadjusted daily OHLCV for all listed equities | R1 market history | **R1 mandatory (D04 + D05)** | No | Unadjusted is mandatory; adjusted series or reproducible factors are mandatory. Vendor-adjusted series is not accepted without reconciliation. |
| S02 | Five years of NEPSE and sector index history | R1 market overview | **R1 mandatory (D06 + D07)** | No | At least three sector indices, not only NEPSE. |
| S03 | Historical floorsheet with contract-level trades and broker IDs | R1 broker analytics | **Conditional C1; R1 D13 current-day; historical R2** | **Yes, if C1-B** | No historical broker analytics in R1. Gate still requires a date-scoped floorsheet capability. |
| S04 | Fundamentals history (quarterly and annual) with reported date and restatement flags | R1 fundamental trends | **R1 mandatory core metrics (D10); full statements R2** | **Partial, if C2-B** | Five-year core metric trends remain; full statements do not. |
| S05 | Corporate actions with announcement, ex-date, record date, adjustment factor | R1 adjusted returns | **R1 mandatory (D11 + D05)** | No | Factor or reproducible method required; a list of dividends alone is insufficient. |
| S06 | IPO/FPO/right/debenture/mutual-fund pipeline and allotment data | R1 issue awareness | **R1 pipeline (D12); allotment/lock-in R2; mutual funds R3** | **Partial** | R1 shows issues, not allotment/lock-in or fund data. |
| S07 | Mutual fund NAV and portfolio holdings | R1 fund features | **R3/optional (R3-D03/D04)** | **Yes** | No fund features in R1. |
| S08 | News/filings with timestamps and source attribution | R1 research | **R2/optional; R1 link-out only (C5)** | **Yes** | No stored/redistributed news in R1; official filings remain a verification source. |
| S09 | Delisted and suspended securities | Unbiased backtests | **Conditional C3; R2** | **Yes, if C3-B** | R1 discloses survivorship bias; no delisted pages/backtests. |
| S10 | Correction/errata feed and documented freshness SLA | Data trust | **R1 mandatory (D14 + D16)** | No | Written process required; “we fix it when reported” is not sufficient. |
| S11 | Written redistribution and derived-analytics rights | Legal production use | **R1 mandatory (D17)** | No | Personal single-user use still needs storage, offline, and derived-analytics permission. |

### 8.2 From `docs/DATA_ACQUISITION_PLAN.md` §1 “ten categories”

| ID | Previous requirement | Previous intent | New classification | Reduction? | Implication |
|---|---|---|---|---|---|
| S12 | Five years of daily OHLCV | R1 | **R1 mandatory (D04)** | No | — |
| S13 | Intraday prices | R1 live chart | **R1 live display; historical R3 (C4-B)** | **Partial** | Live intraday remains; historical bars do not. |
| S14 | Historical NEPSE index data | R1 | **R1 mandatory (D06)** | No | — |
| S15 | Sector-wise data | R1 | **R1 mandatory (D07)** | No | At least three sectors. |
| S16 | Company fundamentals | R1 | **R1 mandatory (D09)** | No | — |
| S17 | Five-year financial history | R1 | **R1 core metrics (D10); full statements R2 (C2-B)** | **Partial** | Five-year ratio/metric trends remain; full statements do not. |
| S18 | Floorsheet data | R1 | **R1 current-day (D13); historical R2 (C1-B)** | **Partial** | Current-day only unless C1-A. |
| S19 | Corporate actions | R1 | **R1 mandatory (D11 + D05)** | No | — |
| S20 | IPO information | R1 | **R1 pipeline (D12); allotment/lock-in R2** | **Partial** | — |
| S21 | Company news | R1 | **R2/optional (C5)** | **Yes** | R1 link-out only. |

### 8.3 Additional requirements found in the plan and feature map

| ID | Previous requirement | Previous intent | New classification | Reduction? | Implication |
|---|---|---|---|---|---|
| S22 | Trading calendar / holidays | Data operations | **R1 mandatory (D03)** | No | Gate has no check; trial T2 covers it. |
| S23 | Broker flows | R1/P1 broker analytics | **R2 (C7)** | **Yes** | Current-day simple totals only in R1. |
| S24 | Delisted/suspended history | Backtests | **R2 (C3-B)** | **Yes** | Bias disclosed in R1. |
| S25 | Historical intraday | R1/P1 chart | **R3 (C4-B)** | **Yes** | Live intraday only in R1. |
| S26 | Mutual fund NAV/holdings | P2 | **R3/optional (C6)** | **Yes** | Not R1. |
| S27 | Five-year price chart and indicators (features 14, 16) | P0 | **R1 (D04)** | No | Data requirement unchanged; implementation still gated. |
| S28 | Fundamentals snapshot and history (features 18, 19) | P0 | **R1 (D09 + D10)** | **Partial** | Snapshot + core metric history; full statements R2. |
| S29 | Corporate-action-adjusted returns (feature 23) | P1 | **R1 data (D05 + D11); UI later** | No | Data required; feature may ship after R1 launch. |
| S30 | Current-day floorsheet (feature 41) | P0 | **R1 (D13)** | No | Historical features 42–46 move to R2. |
| S31 | Historical floorsheet/broker features (42–46) | P1/P2 | **R2 (C1-B/C7)** | **Yes** | — |
| S32 | IPO calendar (47) | P1 | **R1 (D12)** | No | Allotment/lock-in (49–50) move to R2. |
| S33 | Mutual fund features (51–53) | P2 | **R3 (C6)** | **Yes** | — |
| S34 | News and filings (25) | P1 | **R2/optional (C5)** | **Yes** | Link-out in R1. |
| S35 | Promoter/public shareholding (24) | P2 | **R2/R3 (C9)** | **Yes** | — |
| S36 | Market breadth (feature 9) | P1 | **R1 derived from D04** | No | Can be computed from OHLCV; no extra feed. |
| S37 | 52-week highs/lows (feature 11) | P1 | **R1 derived from D04** | No | One year is a subset of five-year history. |
| S38 | Export with provenance (feature 58) | P2 | **Optional/local** | No | Licence must permit export (D17). |

## 9. What the Phase 0 gate does and does not enforce

The gate is necessary but not sufficient. These gaps are why the trial protocol
exists.

| Gate check | What it actually enforces | Gap versus R1 | R1 response |
|---|---|---|---|
| `daily-ohlc-history` | Five-year window; ≥90% of Sun–Thu weekdays; start lag ≤45 days; latest lag ≤10/30 days | No official calendar; one sample symbol; no all-universe coverage; 90% of a 261-day/year proxy can fail a complete provider if NEPSE trades fewer than ~235 sessions/year | D03 calendar + D04; trial T3 uses official sessions and 10 symbols |
| `index-history` | Five-year window for one resolved index | No sector indices; no membership history | D06 + D07; trial T4/T5 |
| `floorsheet` | Previous trading day is honoured; empty/wrong date fails | No historical depth; no turnover reconciliation; no broker-field completeness | D13 for R1; C1/T12 if historical |
| `fundamentals-latest` | At least one populated metric; unverified/estimated warns | No minimum metric set; no reconciliation | D09; trial T9 |
| `fundamentals-history` | Fails below 4 periods; warns below 12 periods | **Four quarters is one year, not five years** | D10 requires 20 quarters / 5 annual periods; trial T10 |
| `corporate-actions` | Returns an array; empty is only a warning | No five-year depth; no adjustment-factor check; no event reconciliation | D11 + D05; trial T7/T8 |
| `ipos` | Returns an array; empty is only a warning | No historical depth; no status/date reconciliation | D12; trial T13 |
| `intraday-ohlc` | One current-day sample; no candles is a warning | No historical intraday | C4; not an R1 hard gate |
| `live-quotes` | Feed populated; not older than 7 days | Product needs seconds-level freshness during a session | D08; trial T6 |
| `market-summary` | Parses and has a positive index value | No reconciliation to official turnover/transactions | D08; trial T6 |
| `company-list`, `security-list` | Non-empty, structurally valid, no duplicates | No all-universe reconciliation; no delisted coverage | D01/D02; trial T1 |
| `provider-metadata`, `runtime-policy` | Terms/source classification and production policy | Does not inspect the actual contract scope (storage, offline, derived analytics) | D14/D17; legal review |
| **No check** | Sector history, calendar, adjustment factors, delisted, news, broker flows, mutual funds, local persistence, correction SLA | These are either R1 requirements or explicitly deferred | D03/D05/D07/D14/D16; C1–C4 |

**Important:** a gate `go` means the harness found no failures and no warnings
for the checks it runs. It does **not** mean R1 data is complete, licensed for
the intended use, or free of survivorship bias.

## 10. Review findings that drive this scope

These are the inconsistencies and unsupported assumptions found while reviewing
the Phase 0 and Phase 0.5 documents.

1. **Five-year requirement versus 2019 trial period.** The gate and
   `DATA_ACQUISITION_PLAN.md` §7 use a five-year window, but §6 step 3 proposed
   “2019-01-01 to the latest complete trading day” (about 7.8 years). The
   `1,100 trading days` threshold is a five-year threshold; applying it to a
   7.8-year window would hide a two-year gap. Corrected in
   `PROVIDER_TRIAL_PROTOCOL.md` §3: the acceptance window is the trailing five
   years (2021-11-04 → 2026-11-03 for a 2026-11-04 trial); 2019 is an optional
   stress probe.
2. **The gate does not enforce five-year fundamentals history.** It passes at
   four periods (one year). The documents treated five-year statements as
   mandatory. R1 now separates core metric history (D10, 20Q/5A) from full
   statements (C2/R2), and the trial protocol enforces D10.
3. **The gate does not enforce historical floorsheet.** It tests only the
   previous trading day. The documents treated historical floorsheet as a
   blocker. R1 now keeps current-day floorsheet (D13) and makes historical depth
   a separate decision (C1).
4. **Empty corporate actions and IPOs are warnings, not failures.** The
   capability is required, but a provider can be `conditional` with no data.
   R1 requires five years of corporate actions and 20 issues, enforced by trial.
5. **Several “Phase 0 checks” do not exist.** `DATA_ACQUISITION_PLAN.md` §4 lists
   `sector-data`, `news`, and `calendar` as Phase 0 checks, but the harness has
   no such checks. R1 adds D03 and D07 and removes news from R1.
6. **Coverage is measured against Sun–Thu weekdays, not the official calendar.**
   The denominator is 1,304 weekdays for five years. 90% is 1,174 sessions. If
   NEPSE’s official session count is lower than ~235/year, a complete provider
   can fail. This is a gate calibration risk. The task does not authorise a gate
   change; the trial protocol uses the official calendar and flags the conflict
   to the owner.
7. **“Adjusted and unadjusted” was assumed available.** No provider documents a
   reproducible adjustment-factor API. R1 requires either adjusted data or
   factors/methodology, and the trial recomputes factors from official notices.
8. **“Five-year financial statements” and “five-year ratio history” were used
   interchangeably.** They are different products and different provider
   requirements. C2 makes the choice explicit.
9. **The previous recommendation to “evaluate MDP first” was being read as
   “select MDP first.”** Evaluation order is not a selection. On verified public
   evidence, ShareHub is more documented; on gate-shaped claims, MDP is broader.
   Neither is R1-ready. See `PROVIDER_DECISION_MATRIX.md`.
10. **ShareHub is documented but not gate-complete.** Public docs do not
    document `floorsheet`, `fundamentalsHistory`, or a full `securityList`, all
    of which the gate requires. It needs written add-ons or a composite provider.
11. **The gate’s live-quote threshold (7 days) is not a product freshness
    threshold.** R1 needs seconds-level freshness during a session. The trial
    protocol uses 60 seconds and a 5-minute stale flag.
12. **Requirements were duplicated across four documents.** `DATA_SOURCES.md`,
    `DATA_ACQUISITION_PLAN.md`, `PROVIDER_COMPARISON.md`, and `FEATURES.md` each
    restated all or part of the requirement set. This document is the canonical
    R1 scope; the others now cross-reference it.

## 11. Release 1 data readiness criteria

R1 data is ready only when **all** of these are true:

1. Every mandatory dataset D01–D17 is supplied by a licensed provider (or a
   documented composite) with the required depth.
2. The provider has written terms covering personal single-user use, local
   persistent storage, offline display, derived analytics, export, and
   termination/retention (D17).
3. The trial in `docs/PROVIDER_TRIAL_PROTOCOL.md` returns **PASS** for all
   mandatory tests, with zero open S1 issues and an accepted list of documented
   exclusions.
4. The Phase 0 gate returns `go` for the licensed provider in production mode.
   A `conditional` gate result is not sufficient for R1.
5. The owner has signed the C1–C4 decisions and the budget.
6. Legal review confirms the contract matches the RFQ answers and does not
   prohibit the desktop/offline/derived-analytics model.
7. The data lineage, raw-snapshot, correction, and restatement design is
   approved.
8. No unofficial, mock, or unverified data is present in the production
   database.

A gate `go` alone, a trial `PASS` alone, or a signed contract alone is **not**
sufficient.

## 12. Owner decisions required before the RFQ is sent

| # | Decision | Recommendation | Blocks RFQ? |
|---|---|---|---|
| 1 | C1 historical floorsheet | C1-B: current-day R1, historical R2, price a 60-session option | Yes |
| 2 | C2 financial statements | C2-B: core metric history R1, full statements R2 | Yes |
| 3 | C3 delisted securities | C3-B: R2, disclose bias in R1 | Yes |
| 4 | C4 historical intraday | C4-B: live intraday R1, historical R3 | Yes |
| 5 | Budget ceiling | Not set; require line-item quotes | Yes |
| 6 | Distribution | Personal single-user only; no resale/public redistribution | Yes |
| 7 | News | Link-out only in R1 | No, but confirm |
| 8 | Mutual funds | R3/optional | No, but confirm |
| 9 | Provider contact | Approve sending the identical RFQ to MDP and ShareHub | Yes |
| 10 | Trial execution | Approve trial accounts, data storage, and legal review | After RFQ |

Until these are answered, the correct action is to stay on mock/CSV data and
keep the production gate closed.

## 13. What this document does not do

- It does not contact, trial, or purchase from any provider.
- It does not change the Phase 0 gate, its thresholds, or its verdict.
- It does not authorise production UI, portfolio, or backtesting work.
- It does not declare any provider selected or any release GO.
- It does not remove a requirement; reductions are recorded in §8.

The Phase 0 verdict remains **NO-GO for production** until a licensed provider
passes both the gate and the trial with written rights.

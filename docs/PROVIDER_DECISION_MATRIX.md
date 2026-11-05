# Provider Decision Matrix

Date: **2026-11-04**
Status: **pre-RFQ, pre-trial, evidence only.** No provider has been contacted, no
account has been created, no trial has been run, and no subscription has been
purchased. **No provider is selected. The Phase 0 verdict remains NO-GO for
production.**

This matrix compares **MDP (Source Code)** and **ShareHub** on verifiable
evidence. It deliberately separates:

- what is **verified** in public documentation or public files;
- what is a **vendor claim**;
- what is an **inference**;
- what is **not found**;
- what can only be decided by the **trial**.

Marketing claims do not score as capability. A missing public document is
“not found,” not proof that the capability does not exist — but it cannot be
planned or budgeted as available.

Related documents:

- `docs/RELEASE1_DATA_REQUIREMENTS.md` — R1/R2/R3 scope.
- `docs/PROVIDER_RFQ.md` — the questions that must be answered.
- `docs/PROVIDER_TRIAL_PROTOCOL.md` — how answers are tested.
- `docs/PROVIDER_COMPARISON.md` — public research evidence.

## 1. Decision question

The question is **not** “which vendor has the best marketing?” It is:

> Which provider — alone or as a documented composite — can supply every
> mandatory R1 dataset at the required depth, with written rights for a
> personal single-user desktop app that stores data locally, works offline, and
> computes derived analytics, and can pass the unchanged Phase 0 gate?

If the answer is “none yet,” the correct decision is **NO-GO**, not a
best-effort selection.

## 2. Evidence rules

### 2.1 Labels

| Label | Meaning |
|---|---|
| **Verified** | Seen directly in public documentation, a public page, a public file, or a public repository on 2026-11-04. |
| **Vendor claim** | The provider says it, but it is not independently verified and is not a contractual commitment. |
| **Inference** | A conclusion drawn from verified facts; not a licence or guarantee. |
| **Unverified** | A lead or secondary report that could not be confirmed at the source. |
| **Not found** | The capability/term was absent from the public material reviewed. |
| **Trial result** | Verified by executing `docs/PROVIDER_TRIAL_PROTOCOL.md`. |

### 2.2 Evidence maturity levels

Use these levels instead of false numeric scores:

| Level | Meaning |
|---|---|
| **E0** | Not found — no public evidence. |
| **E1** | Vendor claim only — marketing or a secondary mention. |
| **E2** | Public docs name the capability/endpoint, but no schema or sample. |
| **E3** | Public docs include parameters, schema, or examples. |
| **E4** | Trial-verified against an authoritative source. |
| **E5** | Contract-verified for the intended use. |

Pre-RFQ, the highest possible level is **E3**. E4/E5 require a trial and a
written contract. A provider can be E3 on documentation and still fail E4/E5.

### 2.3 Rules

- Do not score a claim as verified because it appears on a features page.
- Do not score “not found” as “no”; score it as “not available for planning.”
- Do not compare a verified sample from one provider with a claim from another.
- Do not average away a hard-gate failure with strengths elsewhere.
- Do not treat a vendor’s “NEPSE-licensed” statement as a redistribution grant.

## 3. Decision framework

### 3.1 Stage 1 — hard gates

A provider that fails any hard gate cannot be selected, regardless of score.

| ID | Hard gate | Evidence required |
|---|---|---|
| **H1** | Written terms permit personal single-user use, local persistent storage, offline display, and derived analytics. | Signed terms/quote; legal review (D17). |
| **H2** | Production base URL, versioning, and deprecation policy. | Production docs; not a UAT host (C-01, C-10). |
| **H3** | Five years of daily OHLCV is actually delivered. | Trial T3 / E4. |
| **H4** | Five years of NEPSE index history is actually delivered. | Trial T4 / E4. |
| **H5** | Corporate actions with reproducible adjustment factors are delivered. | Trial T7/T8 / E4. |
| **H6** | Five years of core fundamentals history (20Q/5A) is actually delivered. | Trial T10 / E4. |
| **H7** | Date-scoped floorsheet is delivered for the requested business date. | Trial T11 / E4. |
| **H8** | A provider with all gate-required capabilities is available (or a documented composite). | Capability coverage check. |
| **H9** | If “NEPSE-licensed reseller” is claimed, current written authorization is provided. | H-17 / J-14. |
| **H10** | The licence permits a desktop app on a dynamic residential IP, or provides a workable per-user alternative. | C-06 / H1. |

### 3.2 Stage 2 — mandatory R1 coverage

After the hard gates, compare D01–D17. A missing mandatory dataset is a failure,
not a low score.

### 3.3 Stage 3 — commercial and legal

Price, line-item transparency, termination, retention, support, and SLA.

### 3.4 Stage 4 — operational risk

Documentation quality, integration effort, single-vendor concentration, UAT
dependence, correction process, and support.

**No weighted score is calculated before the hard gates pass.** A weighted score
would let a cheap, well-documented provider hide a missing mandatory dataset.

## 4. Mandatory R1 coverage matrix

“Level” is the evidence maturity from §2.2. A row is not “passed” until E4/E5.

| R1 ID | Requirement | MDP evidence | MDP level | ShareHub evidence | ShareHub level | Gate / verification | Evidence still needed |
|---|---|---|---|---|---|---|---|
| **D01** | Company master | Docs navigation lists “listed companies”; no schema published | **E2** | Company information/profile documented | **E3** | `company-list` | Sample master + 20-symbol reconciliation |
| **D02** | Security master | “Listed companies” claim; instrument detail not published | **E2** | Full stock table exists; instrument types/ISIN not explicit | **E2** | `security-list` | Security schema + instrument-type coverage |
| **D03** | Trading calendar | Market-status module claimed; holiday calendar not documented | **E1/E2** | Holidays endpoint documented | **E3** | No gate check | Forward calendar + official match |
| **D04** | Daily OHLCV, 5y | “5–10 years” vendor claim; no depth proof | **E1** | 5Y and ALL OHLCV documented | **E3** | `daily-ohlc-history` | Trial T3 on 10 symbols |
| **D05** | Adjustment factors | Corporate actions claimed; no factor semantics or schema | **E1** | Dividends/offerings listed; no adjustment factors documented | **E1/E2** | No explicit gate check | Worked factors on 5 events |
| **D06** | NEPSE index history, 5y | Index historical data claimed | **E1** | 1W–5Y–ALL index charts documented | **E3** | `index-history` | Trial T4 on NEPSE/Sensitive/Float |
| **D07** | Sector index history, 5y | Indices/sub-indices claimed | **E1** | Sector performance + sector index charts documented | **E3** | No gate check | Trial T5 on 3+ sectors |
| **D08** | Live quotes + summary | Real-time claim; ~15s per independent integrator | **E1** | ~20s live refresh documented; full stock table | **E3** | `live-quotes`, `market-summary` | Full-session observation |
| **D09** | Current fundamentals | Financial ratios claimed | **E1** | EPS/P/E/book value/P/B/yield/net profit/market cap documented | **E3** | `fundamentals-latest` | Trial T9 on 5 companies |
| **D10** | Core fundamentals history, 5y | Quarterly/annual reports claimed; depth/schema not published | **E1** | **Latest ratios only; no multi-year history documented** | **E0** | `fundamentals-history` (gate gap) | 20Q/5A sample + trial T10 |
| **D11** | Corporate actions, 5y | Dividends, rights, auctions, AGM/SGM, M&A claimed | **E1** | Dividends, announcements, public offerings documented; not a full CA history | **E2/E3 partial** | `corporate-actions` | 5-year event list + source reconciliation |
| **D12** | IPO/FPO/right pipeline | IPO/FPO/rights/bonds/auctions claimed | **E1** | Public offerings endpoint with type/status/for documented | **E3** | `ipos` | 20-issue history + status check |
| **D13** | Current-day floorsheet | Live + historical floorsheet claimed | **E1** | **No floorsheet endpoint or package entry found** | **E0** | `floorsheet` (required) | Written confirmation + sample |
| **D14** | Provenance/corrections | No public correction/errata process found | **E0** | No public correction/errata process found | **E0** | Partial metadata | Written correction/SLA |
| **D15** | Local persistence/offline | No public storage/offline grant found | **E0** | No public storage/offline grant found | **E0** | No gate check | Written terms |
| **D16** | Quality/SLA | 99.9% uptime claim; correction process not published | **E1/E0** | No public SLA/correction process found | **E0** | Partial | Written SLA + incident process |
| **D17** | Written usage rights | No public API terms or data-reuse grant found | **E0** | No public data-reuse/redistribution terms found | **E0** | `runtime-policy` requires verified terms | Signed terms + legal review |

### 4.1 What the matrix says

- **ShareHub** has the strongest **verified public documentation** for market
  data, index/sector history, live data, current fundamentals, dividends,
  announcements, and public offerings.
- **ShareHub does not document** floorsheet, multi-year fundamentals history, a
  full security master, adjustment factors, delisted history, or data-reuse
  terms. Those are not minor gaps; several are gate-required capabilities.
- **MDP** claims the broadest coverage, including floorsheet and multi-year
  reports, but almost every material claim is **E1** and its public docs stop at
  the section index. Its documentation host is UAT, and it publishes no
  production URL, pricing, or terms.
- **Neither provider is E4/E5 on any mandatory R1 dataset.** Neither is R1-ready.

## 5. Conditional decisions matrix

These are the four separate decisions from
`docs/RELEASE1_DATA_REQUIREMENTS.md` §5.

| Decision | If R1 includes it | MDP evidence | ShareHub evidence | Consequence |
|---|---|---|---|---|
| **C1 — Historical floorsheet** | R1 needs historical broker analytics | **E1** claim; live/historical floorsheet listed | **E0** no floorsheet documented | MDP becomes the only claimant; ShareHub alone is not viable. If C1-B, current-day only and R2 for history. |
| **C2 — Full financial statements** | R1 needs BS/IS/CF, 5 years | **E1** quarterly/annual reports claimed; no schema/depth | **E0** latest ratios only | MDP or an official-PDF extraction pipeline is required. If C2-B, R1 uses core metric history (D10), which ShareHub also lacks. |
| **C3 — Delisted securities** | R1 needs survivorship-bias-free backtests | **E0** not documented | **E0** not documented | Neither is viable; official NEPSE archive required. If C3-B, disclose bias and defer. |
| **C4 — Historical intraday** | R1 needs historical bars | **E1** minute candles per an independent integrator, not MDP docs | **E0** live only documented | Neither is verified. If C4-B, live intraday only and R3 for history. |

### 5.1 Gate interaction (critical)

The Phase 0 gate requires these capabilities:

`companyList`, `securityList`, `dailyOhlc`, `indexHistory`, `liveQuotes`,
`marketSummary`, `floorsheet`, `fundamentals`, `fundamentalsHistory`,
`corporateActions`, `ipos`.

Consequences:

- A ShareHub-only provider descriptor **as publicly documented** fails
  `capability-coverage` because `floorsheet` and `fundamentalsHistory` are
  missing, and `securityList` is not clearly documented.
- MDP **claims** all eleven, but the claims are E1 and must be proven.
- Deferring historical floorsheet (C1-B) does **not** remove the gate’s
  `floorsheet` capability requirement; it only limits depth. ShareHub still needs
  at least a current-day floorsheet add-on.
- Deferring full statements (C2-B) does **not** remove the gate’s
  `fundamentalsHistory` requirement; ShareHub still needs a history add-on.
- Removing either capability entirely would require an explicit gate change.
  This task does **not** authorise one.

## 6. Technical and commercial matrix

| Criterion | MDP evidence | MDP level | ShareHub evidence | ShareHub level | Why it matters |
|---|---|---|---|---|---|
| **API style** | REST/JSON | **E2** | REST/JSON | **E3** | Integration effort |
| **Authentication** | Headers `ApiKey`, `ApiSecret`, `AccessId`, `ApiVersion` | **E2** | Email/password → Bearer access token (30 min), refresh token (30 days) | **E3** | Desktop credential model |
| **Per-user credentials** | Not documented | **E0** | Account-based; likely per user | **E2** | A desktop app must not embed a shared secret |
| **IP allow-list** | IP whitelisting claimed | **E1** | Server IPs must be allow-listed | **E3** | A dynamic residential IP may break a desktop app; must be resolved in writing |
| **Rate limits** | Claimed; no numbers published | **E1** | Licence-specific `X-RateLimit-*`; test 10/min, 500/day; 429 + `Retry-After` | **E3** | Backfill and live polling feasibility |
| **Test mode** | UAT host `https://uat.sourcecode.com.np` | **E2** | `X-DataApi-Test: true`; 10/min, 500/day | **E3** | Trial feasibility |
| **Production base URL** | **Not published; UAT only** | **E0** | Documented base URL | **E3** | Hard gate H2 |
| **Versioning** | `ApiVersion` header; policy unknown | **E2** | Versioned path `/v1`; deprecation policy not stated | **E3/E2** | Breaking-change risk |
| **Endpoint schemas** | Docs stop at introduction/auth/section index | **E2** | Parameters and response examples for package services | **E3** | Integration effort and trial design |
| **Bulk historical export** | Not documented | **E0** | Not documented | **E0** | Full-universe backfill feasibility |
| **Pagination** | Not documented | **E0** | Not documented in reviewed material | **E0** | Large history requests |
| **Uptime/SLA** | 99.9% claim | **E1** | Not published | **E0** | Production reliability |
| **Support** | Not published | **E0** | Not published | **E0** | Incident response |
| **Pricing** | No public price; “Get a Quote” form | **E0** | No public price; contact for account | **E0** | Budget approval |
| **Data-reuse terms** | No public API terms/reuse grant | **E0** | No public data-reuse/redistribution grant | **E0** | Hard gate H1 |
| **Trial terms** | Not published | **E0** | Test mode documented; trial terms not published | **E2** | Trial execution |
| **Termination/retention** | Not published | **E0** | Not published | **E0** | Offline/history rights |
| **NEPSE authorization** | “Official NEPSE-Licensed Data Provider” and reseller agreement claims | **E1** | Not claimed in reviewed material | **E0** | Hard gate H9 |
| **Independent corroboration** | NChartPro states it pays for MDP and receives ticks/history/fundamentals/floorsheet/news | **E1** | Widely used public data site; API described as same feed as website | **E1** | Not a licence |

### 6.1 Technical red flags

1. **MDP has no published production host.** A UAT base URL is not a production
   commitment. This is a hard-gate failure until resolved.
2. **Both providers may require IP allow-listing.** A single-user desktop app on
   a dynamic residential IP cannot guarantee a static server IP. The RFQ must
   resolve whether the allow-list can be disabled, scoped per user, or replaced
   by another control. If not, the desktop distribution model is incompatible.
3. **MDP publishes no endpoint schemas.** Integration and trial design would be
   speculative.
4. **Both publish no pricing or data-reuse terms.** No budget or legal decision
   can be made from public material.
5. **ShareHub’s test mode is small** (10/min, 500/day). A five-year, 10-symbol
   trial must be planned within that limit or a higher trial quota must be
   requested.
6. **A shared API secret must never be embedded in a desktop app.** The RFQ asks
   for per-user keys and revocation; if the vendor only supports an organisation
   key, the architecture needs a user-owned credential model.

## 7. Evidence readiness scorecard

This is not a capability score. It shows how much of the R1 decision can be made
from public evidence today.

| Dimension | MDP | ShareHub | Interpretation |
|---|---|---|---|
| **Market-data documentation** | E2 | **E3** | ShareHub is testable now; MDP needs schemas. |
| **Historical depth evidence** | E1 | **E3** | ShareHub documents 5Y/ALL; MDP claims 5–10 years. |
| **Floorsheet evidence** | E1 | **E0** | MDP claims; ShareHub does not document. |
| **Financial-statement evidence** | E1 | **E0** | MDP claims; ShareHub latest ratios only. |
| **Adjustment-factor evidence** | E1 | **E1/E2** | Neither publishes reproducible factors. |
| **Delisted evidence** | E0 | **E0** | Neither documents it. |
| **Production endpoint evidence** | **E0** | **E3** | MDP UAT only; ShareHub documents a base URL. |
| **Commercial/legal evidence** | **E0** | **E0** | Neither publishes price or reuse terms. |
| **Overall pre-RFQ maturity** | **Low** | **Medium** | ShareHub is easier to verify; MDP has broader unverified claims. |

### 7.1 Gate capability scorecard (as publicly documented)

| Gate-required capability | MDP | ShareHub |
|---|---|---|
| `companyList` | Claim | **Documented** |
| `securityList` | Claim | **Not documented** |
| `dailyOhlc` | Claim | **Documented** (5Y/ALL) |
| `indexHistory` | Claim | **Documented** (1W–5Y–ALL) |
| `liveQuotes` | Claim | **Documented** (~20s) |
| `marketSummary` | Claim | **Partial** |
| `floorsheet` | Claim | **Not documented** |
| `fundamentals` | Claim | **Documented** (latest ratios) |
| `fundamentalsHistory` | Claim | **Not documented** |
| `corporateActions` | Claim | **Partial** (dividends/offerings/announcements) |
| `ipos` | Claim | **Documented** (public offerings) |

**Count, as documented:** ShareHub has 6 clear, 2 partial, and 3 missing
gate-required capabilities. MDP has 11 claims and 0 independently verified
capabilities.

This is the central finding: **MDP is gate-shaped but unverified; ShareHub is
well-documented but not gate-complete.** Neither can be selected today.

## 8. Provisional assessment

### 8.1 MDP (Source Code)

**Verified public facts.** Public site and docs exist; docs base URL is a UAT
host; auth headers are documented; the documentation navigation lists market
status, indices, sub-indices, stock live, today price, floorsheet, IPO/FPO,
dividend, rights, bonds/debentures, auctions, M&A, AGM/SGM, financial reports,
ratios, company profile, listed companies, mutual funds, holdings, NAV, and
income statements. No endpoint schemas, production URL, pricing, or terms are
published.

**Vendor claims.** NEPSE-licensed reseller; real-time data; 5–10 years of
history; live and historical floorsheet; quarterly/annual financial reports;
corporate actions; mutual funds; 99.9% uptime; rate limiting; IP whitelisting.
An independent integrator corroborates a paid feed with ~15s ticks, candle
history, fundamentals, floorsheet, and news, but that is not a vendor contract.

**Assessment.** MDP is the only candidate whose **claims** cover every hard
category, especially historical floorsheet and multi-year financial reports. It
is therefore the highest-upside option **if** the claims are true and the terms
are acceptable. It is also the highest-verification-risk option: no production
host, no schemas, no pricing, no terms, and no independent depth proof.

**What must be true before MDP can be selected.**

1. Production base URL and complete endpoint schemas.
2. Written quote with line items and a validity period.
3. Written personal-use, local storage, offline, derived-analytics, export, and
   termination/retention terms.
4. Current written NEPSE reseller authorization covering the intended use.
5. Trial proof of five-year OHLCV, five-year core fundamentals, historical
   floorsheet, corporate actions/factors, and index/sector history.
6. A workable per-user auth/IP model for a desktop app.

### 8.2 ShareHub

**Verified public facts.** Documented base URL; email/password → Bearer auth;
30-minute access token and 30-day refresh token; IP allow-list; licence-specific
rate limits with headers; test mode; ~20s live refresh; Package 1 (live market,
stock prices, sector performance, company information); Package 2 (index charts
1W–5Y–ALL, movers, full stock table with OHLCV and fundamentals, 52-week/all-time
highs/lows, company profile, ratios, all-time daily OHLCV, announcements,
dividends, holidays, public offerings, heatmap, index contribution,
price-volume); public offerings with type/status/investor category; announcement
categories.

**Documented gaps.** No floorsheet endpoint or package entry; only latest
financial ratios, no multi-year statements or quarterly history; no
corporate-action adjustment factors; no delisted/suspended history; no mutual
fund NAV/holdings; no general news feed; no public pricing; no public data-reuse
or redistribution terms.

**Assessment.** ShareHub is the **lowest-execution-risk market-data candidate**
and the easiest to trial. On current public evidence it is **not gate-complete**:
`floorsheet`, `fundamentalsHistory`, and a clear `securityList` are missing, and
`corporateActions` is only partial. It could become viable if it confirms
written add-ons for those capabilities and acceptable rights.

**What must be true before ShareHub can be selected.**

1. Written confirmation that floorsheet can be licensed (at least current-day).
2. Written confirmation that five-year core fundamentals history can be
   licensed, or an accepted official-PDF pipeline for D10.
3. A complete security master with instrument types/ISIN.
4. Written adjustment-factor method or an accepted in-house computation from
   official notices.
5. A workable IP allow-list/auth model for a desktop app.
6. Written personal-use/storage/offline/derived-analytics terms.
7. Written price and trial terms.

### 8.3 Official sources (NEPSE, SEBON, CDSC, company filings)

These are **authoritative verification sources**, not a primary API:

- NEPSE: prices, indices, floorsheet, reports, disclosures; no public developer
  API, pricing, or reuse licence found.
- SEBON: issue approvals, prospectuses, public-issue XLSX; no API or reuse grant.
- CDSC: current issues, IPO results, lock-in notices, ISIN; no market-data API.
- Company filings: audited statements and restatements; documents, not a
  normalised feed.

They remain necessary even if MDP or ShareHub is selected. They cannot replace
the primary feed for R1.

### 8.4 Composite provider option

A documented composite could combine:

- ShareHub (market data, index/sector, live, current fundamentals, IPOs);
- an official/NEPSE or MDP source for floorsheet;
- an official-PDF pipeline or MDP for five-year fundamentals;
- official sources for verification.

This is **not free**: it requires a composite adapter, per-source provenance,
source-switch rules, and a gate strategy. The Phase 0 harness currently
validates one provider descriptor; a composite must be explicitly designed and
validated, not assembled silently. The RFQ asks both vendors the same questions
so a composite is a deliberate fallback, not an accident.

## 9. Decision scenarios

| Scenario | Trigger | Decision |
|---|---|---|
| **S-A — ShareHub add-ons confirmed** | ShareHub confirms floorsheet, five-year core fundamentals, security master, adjustment method, desktop auth, and acceptable written terms | ShareHub becomes the leading R1 candidate; run trial T1–T19; MDP remains a second source/benchmark. |
| **S-B — MDP proves the stack** | MDP supplies production docs, schemas, samples, written terms, NEPSE authorization, and passes the trial | MDP becomes the leading R1 candidate; still use official sources for verification. |
| **S-C — Neither is viable** | Both fail a hard gate or the trial | No R1 provider. Options: (a) reduce scope and explicitly revisit the gate, (b) fund an official-document pipeline, (c) stop the project as specified. Not a silent workaround. |
| **S-D — Composite is required** | One vendor is strong on market data and the other/official source is strong on floorsheet/fundamentals | Design a composite provider, validate it against the gate, and get written rights for each component. |
| **S-E — Terms fail** | Either vendor refuses local persistent storage, offline display, or derived analytics | Disqualify that vendor regardless of data quality. A technically perfect feed with unusable rights is not a candidate. |

## 10. Kill criteria

Disqualify a provider immediately if any of these is true:

1. No written permission for local persistent storage or offline display.
2. No written permission for derived analytics (indicators, screeners, charts,
   portfolio P&L).
3. No production base URL or no stable versioning/deprecation policy.
4. Five-year OHLCV cannot be demonstrated on the identical trial corpus.
5. NEPSE index/sector history cannot be demonstrated.
6. Date-scoped floorsheet is not available and cannot be added in writing (the
   gate requires the capability).
7. Five-year core fundamentals history is not available and no accepted
   official-PDF pipeline exists (the gate requires the capability).
8. The licence only works with a static server IP and cannot support a
   single-user desktop app.
9. The vendor claims NEPSE authorization but cannot provide current written
   evidence.
10. The vendor requires embedding a shared secret in the desktop app.
11. The vendor refuses a trial or written quote.
12. The vendor’s data contains a systematic S1 error that it will not correct.

## 11. What would change this matrix

- Written RFQ answers (updates E1/E2 → E3/E5).
- Trial results (E3 → E4).
- Signed terms and legal review (E4 → E5).
- A production endpoint from MDP.
- A floorsheet/fundamentals add-on from ShareHub.
- A price that changes the cost/benefit, but **not** a hard-gate failure.
- An official NEPSE archive licence that solves C1/C3.

Update this matrix only with evidence IDs and dates. Do not update it from a
sales call or a marketing page.

## 12. Current recommendation

**No provider is selected. The Phase 0 verdict remains NO-GO for production.**

The evidence supports a **parallel evaluation**, not a winner:

1. **Start both evaluations in parallel** with the identical RFQ.
2. **Use ShareHub as the first market-data trial** because its documentation is
   testable and covers most R1 market-data needs.
3. **Use MDP as the first gate-completeness evidence request** because it is the
   only candidate claiming floorsheet, multi-year fundamentals, and the full
   stack.
4. **Ask both the specific add-on questions**: ShareHub’s missing gate
   capabilities and MDP’s missing production/schema/terms evidence.
5. **Run the identical trial corpus** in
   `docs/PROVIDER_TRIAL_PROTOCOL.md`.
6. **Do not pay, do not import trial data into production, and do not start
   production UI/portfolio/backtesting work.**

If only one evaluation can start first, start ShareHub: it produces testable
market-data evidence sooner. MDP’s claims cannot be scored until it supplies a
production endpoint and schemas.

The earlier “evaluate MDP first” recommendation in
`docs/PROVIDER_COMPARISON.md` is an **evaluation order**, not a selection. On
verified public evidence, ShareHub is the lower-risk market-data candidate; on
claimed coverage, MDP is the higher-upside but higher-risk candidate. The trial
decides.

## 13. Exact next action required from the project owner

Before any provider contact:

1. Sign the C1–C4 decisions in `docs/RELEASE1_DATA_REQUIREMENTS.md` §5.
2. Approve a budget range or require line-item quotes first.
3. Confirm the distribution model is personal single-user only.
4. Approve sending the identical `docs/PROVIDER_RFQ.md` to MDP and ShareHub.
5. Approve the trial corpus and legal review of trial data storage.

Until then, the project stays on mock/CSV data and the production gate stays
closed.

## 14. Sources and evidence log

Public evidence reviewed on 2026-11-04:

- NEPSE: `https://www.nepalstock.com.np/` (public web application; no public
  developer API, pricing, or reuse licence found).
- SEBON: `https://www.sebon.gov.np/` (issue approvals, prospectuses,
  public-issue XLSX; no API/reuse grant found).
- CDSC: `https://cdsc.com.np/` (`/ipolist`, `/lockin`, IPO result portal,
  MeroShare; no market-data API).
- ShareHub: `https://sharehubnepal.com/data/nepse-data-documentation/`;
  `https://sharehubnepal.com/terms-and-conditions`.
- MDP: `https://data.smartwealthpro.com/`, `/features`, `/documentation`,
  `/about`, `/quote`; `/pricing` and `/terms` redirect home.
- Source Code: `https://sourcecode.com.np/product/mdp`.
- NChartPro data-source note: `https://nchartpro.com/help/document/start/data-sources`.
- `docs/PROVIDER_COMPARISON.md` for the full research notes and evidence labels.

This matrix does not purchase, contact, trial, or authorise production use of any
provider. The Phase 0 verdict remains **NO-GO for production** until a licensed
provider passes both the gate and the trial with written rights.

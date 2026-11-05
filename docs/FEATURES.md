# Feature Map and Data Dependencies

This is the working feature map for the desktop terminal. It exists to keep the
product honest: every feature is tied to a capability, and no feature moves to
production until its capability passes Phase 0.

> **Phase 0.5 scope note (2026-11-04).** Dataset release classification and
> scope reductions are defined in `docs/RELEASE1_DATA_REQUIREMENTS.md`. A
> feature marked P1/P2 here is **not** automatically a Release 1 data
> requirement. In particular, historical floorsheet, full financial statements,
> delisted history, and historical intraday are separate owner decisions; see
> the scope reduction register before procurement.

> **Free Edition shipped (2026-11-04).** The product now ships as an explicitly
> labelled Free Edition on operator-supplied free data. Implemented: market
> overview, company chart + indicators, technical screener, watchlist,
> portfolio ledger/cost basis/P&L, import wizard, and an Electron shell. It is a
> separate edition with its own policy, not a substitute for the licensed Phase
> 0 gate. See [FREE_EDITION.md](FREE_EDITION.md). The Phase 0 statuses below
> still describe the licensed edition and are unchanged.

> **Personal research mode (2026-11-04).** `docs/PERSONAL_MODE.md` defines the
> single-user prototype that syncs locally supplied free/public data into
> SQLite. It can exercise market overview, price charts, indicators, local
> watchlists/portfolio when the operator supplies the data. It does **not**
> unlock fundamentals history, floorsheet history, corporate-action adjustment,
> delisted securities, or historical intraday, and it changes no Phase 0 status
> below.

Priority: **P0** = MVP, **P1** = next, **P2** = later.

## Market overview

| # | Feature | Priority | Capability | Phase 0 status |
|---|---|---|---|---|
| 1 | NEPSE index live value and change | P0 | `marketSummary`, `liveQuotes` | Recent only |
| 2 | Sector sub-index live values | P0 | `sectorPerformance` | Recent only |
| 3 | Market summary (turnover, volume, trades, scrips) | P0 | `marketSummary` | Recent only |
| 4 | Top gainers | P0 | `liveQuotes` | Recent only |
| 5 | Top losers | P0 | `liveQuotes` | Recent only |
| 6 | Most active by turnover | P0 | `liveQuotes` | Recent only |
| 7 | Most active by volume | P1 | `liveQuotes` | Recent only |
| 8 | Sector heatmap | P0 | `sectorPerformance` | Recent only |
| 9 | Market breadth (advances/declines/unchanged) | P1 | `liveQuotes` | Recent only |
| 10 | Intraday NEPSE chart | P1 | `intradayOhlc`, `indexHistory` | Intraday only |
| 11 | 52-week highs/lows | P1 | `dailyOhlc` | **Blocked** (needs 1y+) |
| 12 | Market calendar and holidays | P1 | manual/licensed calendar | **Blocked** |

## Company research

| # | Feature | Priority | Capability | Phase 0 status |
|---|---|---|---|---|
| 13 | Company profile and sector | P0 | `companyList` | Recent only |
| 14 | Five-year price chart | P0 | `dailyOhlc` | **Blocked** |
| 15 | Candlestick pattern detection | P2 | `dailyOhlc` | **Blocked** |
| 16 | Technical indicators (SMA, EMA, RSI, MACD, Bollinger) | P0 | `dailyOhlc` | **Blocked** |
| 17 | Volume and turnover analysis | P1 | `dailyOhlc`, `floorsheet` | **Blocked** for history |
| 18 | Fundamentals snapshot (EPS, ROE, ROA, P/E, P/B) | P0 | `fundamentals` | **Blocked** |
| 19 | Fundamentals history and trends | P0 | `fundamentalsHistory` | **Blocked** |
| 20 | Valuation and peer comparison | P1 | `fundamentals`, `liveQuotes` | **Blocked** |
| 21 | Dividend history and yield | P1 | `corporateActions` | **Blocked** |
| 22 | Bonus/rights history | P1 | `corporateActions` | **Blocked** |
| 23 | Corporate-action-adjusted returns | P1 | `dailyOhlc`, `corporateActions` | **Blocked** |
| 24 | Promoter/public shareholding | P2 | licensed ownership data | **Blocked** |
| 25 | News and filings | P1 | `news` | **Blocked** |
| 26 | Company event calendar | P2 | `corporateActions`, `ipos` | **Blocked** |

## Screening, watchlists, alerts

| # | Feature | Priority | Capability | Phase 0 status |
|---|---|---|---|---|
| 27 | Fundamental screener | P1 | `fundamentals`, `fundamentalsHistory` | **Blocked** |
| 28 | Technical screener | P2 | `dailyOhlc` | **Blocked** in licensed Phase 0 · shipped in Free Edition on imported data |
| 29 | Custom watchlists | P0 | local + `liveQuotes` | Shipped in Free Edition |
| 30 | Price and volume alerts | P1 | `liveQuotes` | Recent only |
| 31 | Breakout/breakdown alerts | P2 | `dailyOhlc` | **Blocked** |
| 32 | Relative strength ranking | P2 | `dailyOhlc`, `indexHistory` | **Blocked** |

## Portfolio

| # | Feature | Priority | Capability | Phase 0 status |
|---|---|---|---|---|
| 33 | Holdings and transaction ledger | P0 | local data | Shipped in Free Edition |
| 34 | Cost basis and unrealised/realised P&L | P0 | local + `liveQuotes` | Shipped in Free Edition (priced positions only) |
| 35 | XIRR and time-weighted returns | P1 | local + `dailyOhlc` | **Blocked** for history |
| 36 | Allocation and sector exposure | P1 | local + `companyList` | Can build later |
| 37 | Volatility, drawdown, beta | P2 | local + `dailyOhlc`, `indexHistory` | **Blocked** |
| 38 | Dividend income tracking | P2 | local + `corporateActions` | **Blocked** |
| 39 | Portfolio news and event feed | P2 | `news`, `corporateActions` | **Blocked** |
| 40 | Nepal-specific charges/tax estimate | P2 | static rules + local | Can build later |

## Floorsheet and broker analytics

| # | Feature | Priority | Capability | Phase 0 status |
|---|---|---|---|---|
| 41 | Live/current-day floorsheet | P0 | `floorsheet` | Recent only |
| 42 | Historical floorsheet browser | P1 | `floorsheet` | **Blocked** |
| 43 | Broker buy/sell flows | P1 | `brokerFlows` | **Blocked** for history |
| 44 | Broker concentration | P2 | `brokerFlows` | **Blocked** |
| 45 | Accumulation/distribution signals | P2 | `floorsheet` history | **Blocked** |
| 46 | Block/bulk deal detection | P2 | `floorsheet` history | **Blocked** |

## IPO, rights, and mutual funds

| # | Feature | Priority | Capability | Phase 0 status |
|---|---|---|---|---|
| 47 | IPO/FPO/right issue calendar | P1 | `ipos` | **Blocked** |
| 48 | Issue detail and company comparison | P2 | `ipos`, `fundamentals` | **Blocked** |
| 49 | Allotment/result tracker | P2 | licensed IPO data | **Blocked** |
| 50 | Lock-in tracker | P2 | licensed IPO/ownership data | **Blocked** |
| 51 | Mutual fund NAV tracker | P2 | licensed NAV data | **Blocked** |
| 52 | Mutual fund holdings and overlap | P2 | `mutualFundHoldings` | **Blocked** |
| 53 | Fund returns and comparison | P2 | licensed NAV history | **Blocked** |

## Data trust and operations

| # | Feature | Priority | Capability | Phase 0 status |
|---|---|---|---|---|
| 54 | Source/provenance badge on every price | P0 | metadata | Ready |
| 55 | Freshness and staleness indicator | P0 | metadata | Ready |
| 56 | Provider health dashboard | P1 | `healthCheck` | Ready |
| 57 | Data correction/errata log | P1 | local + vendor corrections | Design needed |
| 58 | Export with provenance | P2 | local | Design needed |

## Free Edition slice (shipped)

The shipped Free Edition product is:

1. Market overview: index, sectors, summary, gainers/losers.
2. Company master browser plus global symbol/name search.
3. Company profile with the imported daily chart and core indicators.
4. Technical screener over stored candles.
5. Watchlist.
6. Portfolio ledger, weighted-average cost basis, realised/unrealised P&L.
7. Import wizard with no-write preview, row-level validation, audit history,
   and CLI sync, with provenance and freshness visible.
8. Light (default) and dark themes, with Auto following the OS preference.
9. Electron desktop shell over the same local HTTP API.

Every priced view carries an `as of` timestamp and a data-state badge. Missing
data is shown as missing; a missing index summary is never synthesised.

It does not include fundamentals, historical floorsheet, corporate-action
adjustment, or delisted history. Those remain licensed-edition work.

## MVP slice (after the licensed data gate)

The smallest serious product is:

1. Market overview: NEPSE, sectors, summary, gainers/losers, heatmap.
2. Company profile with a five-year chart and core indicators.
3. Fundamentals snapshot plus multi-year history.
4. Watchlists and price alerts.
5. Portfolio ledger, cost basis, P&L, allocation.
6. Current-day floorsheet.
7. Provenance and freshness visible everywhere.

Features 14, 16, 18, 19, and 35 are the reason a licensed five-year source is
non-negotiable. Without it, the product is a recent-data dashboard, not the
analysis terminal that was specified.

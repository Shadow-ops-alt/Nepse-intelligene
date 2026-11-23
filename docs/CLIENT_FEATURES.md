# Client feature checklist

Status of every feature the client asked for (2026-11-14), where it lives in
the app, and what limits it. "Derived" means computed by the app from stored
data; "unofficial" means read from public pages or NEPSE's internal web
endpoints without a licence. Nothing is mocked: a feature whose data the
sources do not publish is shown as unavailable with the reason.

Legend: ✅ done · 🟡 partial (works, with a stated data limit) · ⛔ blocked by data

## Charts and drawing

| Feature | Status | Where | Notes |
|---|---|---|---|
| NEPSE chart (zoom fixed) | ✅ | Market → NEPSE Index | Wheel/pinch/drag zoom now persists; "Reset zoom" and axis double-click reset it. Cause was the chart being rebuilt on every mouse move. |
| Drawing tools like TradingView | ✅ | Company and index charts | Trend line, ray, extended line, horizontal line/ray, vertical line, cross line, rectangle/zone, ellipse, triangle, parallel channel, Fib retracement, Fib extension, Fib channel, pitchfork, arrow, polyline, freehand brush, measure, text; colours, magnet snap, undo (Ctrl Z), delete, hide, clear. Saved per symbol. |
| SMA / EMA | ✅ | Chart → Indicators | SMA 20/50/200, EMA 9/20/21. |
| Ichimoku | ✅ | Chart → Indicators | Conversion, base, spans (plotted 26 ahead within stored range), lagging span. |
| OBV, Bollinger bands | ✅ | Chart → Indicators | OBV in its own pane. |
| ADX, Parabolic SAR | ✅ | Chart → Indicators | ADX with +DI/−DI and a 25 guide; PSAR dots coloured by trend. |
| Supertrend | ✅ | Chart → Indicators | (10, 3), coloured by direction. |
| RSI, MACD | ✅ | Chart → panes | RSI with 30/50/70 guides. |

## Technical signals and screens

| Feature | Status | Where | Notes |
|---|---|---|---|
| Candlestick signal (name) | ✅ | Market, Company (markers + history), Screener | 26 named patterns with prior-trend context. The Company → Candlestick patterns tab groups every pattern by one, two or three candles, shows a diagram and description for each, and marks the ones seen in the last 120 sessions. |
| Multi-candle pattern zones | ✅ | Company chart → Pattern zones | Shades the two or three candles that together form each detected engulfing, harami, tweezer, star or three-candle pattern (most recent 12). The chart legend also reports the span beside each marker. |
| Support zone / resistance zone | ✅ | Chart → Auto analysis → S/R zones | Clustered swing highs/lows within 1.5%, with touch counts. |
| Trend line area (support, resistance) | ✅ | Chart → Auto analysis → Auto trendlines | Rising support / falling resistance from the last two swing pivots; broken lines dashed. Manual trend lines via drawing tools. |
| Swing high / swing low | ✅ | Chart → Auto analysis | 5/5 fractal pivots. |
| Market structure (BOS, CHoCH, fractals) | ✅ | Chart → Auto analysis; Signals | Close through the last confirmed swing; first break in a trend is BOS, a break against it is CHoCH. |
| Divergence signals | ✅ | Chart → Auto analysis; Signals | Regular and hidden RSI divergences. |
| Supply & demand zones | ✅ | Chart → Auto analysis | Tight base followed by a ≥1.5×ATR impulse; fresh vs tested. |
| Volume breakout | ✅ | Screener preset, Signals, alert rule | Close above the prior 20-session high on ≥1.5× average volume. |
| Company breakout and volume | ✅ | Screener (breakout, volume spike, 3-day volume) | |
| 3-day volume analysis | ✅ | Screener "3d vol ×", preset "3-day volume ×1.5" | Last 3 sessions vs the prior average 3-session volume, plus 3-day price change and up-days. |
| Indicator buy/sell | ✅ | Company → Signal tally; Screener "Signal" | Transparent bullish/bearish count of standard rules; labelled as not advice. |
| RSI 30–50 stocks + alert on crossing 30 and 50 | ✅ | Signals & alerts → RSI 30–50 zone; alert rules | Both cross alerts are on by default for all active equities, with desktop notifications. |
| MACD cross stocks | ✅ | Screener preset, Signals, alert rule | |
| EMA cross stocks | ✅ | Screener preset, Signals, alert rule | EMA 9 / EMA 21. |
| Supertrend cross stocks | ✅ | Screener preset, Signals, alert rule | |
| 52-week high / low | ✅ | Screener presets, Signals, Company range bar | Trailing 365 calendar days (no longer "last 252 rows"). |
| Up trend / down trend / sideways | ✅ | Screener presets | SMA 20/50/200 stacking. |
| Trending stocks (1 and 2 weeks) | ✅ | Screener presets "Trending 1W/2W" | Calendar 7/14-day returns with volume confirmation. |
| Volatile stocks 2% / 3% | ✅ | Screener presets | Average absolute daily move over 20 sessions. |
| Low / mid / high / large cap | 🟡 | Screener "Market cap" | Percentile classes (Large top 10%, High next 20%, Mid next 30%, Low bottom 40%). Needs company profiles (`personal:details`) for shares outstanding/market cap. |

## Alerts and assistant

| Feature | Status | Where | Notes |
|---|---|---|---|
| Stock alerts (smart assistant) | ✅ | Signals & alerts | Rule-based smart brief (market, holdings, watchlist, confluence of signals, RSI recoveries, breakouts, 52-week extremes), alert inbox with unread badge and desktop notifications, editable rules, price alerts (live LTP when available). Deterministic rules — no prediction. |

## Live market

| Feature | Status | Where | Notes |
|---|---|---|---|
| Live market view / live LTP | ✅ (unofficial) | Live market | nepalstock.com internal endpoints via the nepseman-api token method; product-owner decision, on by default. Labelled LIVE · unofficial, never stored as history. Verified: 334/334 last-session LTPs equal the archive closes. |
| Market depth | 🟡 | Live market → Depth | Wired; field mapping unconfirmed until a trading session. |
| Intraday candles (1m–1h, current session) | ✅ (session-only) | Company → Price, Market → NEPSE index | Built locally from live snapshots sampled while the app is open: 1m, 2m, 3m, 5m, 10m, 15m, 30m, 1h. No historical backfill — bars exist only from when the chart was first opened. Labelled UNVERIFIED, never written to EOD history; `1D` remains the stored end-of-day series. |

## Fundamentals and company data

| Feature | Status | Where | Notes |
|---|---|---|---|
| Fundamental desk | ✅ | Fundamentals (Alt 5) | Screen all companies: EPS, P/E, book value, P/B, ROE, ROA, NPL, diluted EPS, dividend/bonus %, market cap and cap class; presets (value, quality, high dividend, banks NPL<2%); CSV export. Key ratios from Merolagani, quarterly statement from ShareSansar; derived values marked "d". |
| Company financial detail | 🟡 | Company → Company detail | Profile, displayed ratios and quarterly figures as published; not full audited statements. |
| All-fundamentals compare desk | ✅ | Fundamentals → Screen all / Sector medians | Sector medians show how many companies each covers. |
| Manual compare of two companies (EPS, ROE, ROA, P/E, P/B, NPL, diluted EPS) | ✅ | Fundamentals → Compare | 2–4 companies side by side, best value starred by direction, period history, 5-year dividends and price returns. ROE/ROA/NPL/diluted EPS come from the latest quarterly statement (mainly banks and financials); "—" where a company does not publish them. |
| Monthly / yearly report (5 years) | 🟡 | Company → Seasonality; Fundamentals → Compare | Monthly and yearly price returns over 5+ years (derived). Audited 5-year financial reports are not published. |
| More company information | 🟡 | Company → Company detail | Every profile field the sources publish (shares, paid-up, market cap, listing/operation dates, registrar, contacts), dividends/rights, events, news, floorsheet. |
| Full financial statements (ROE, ROA, NPL, diluted EPS) | 🟡 | Company → Company detail → Fundamentals | The latest quarterly statement as displayed (balance sheet, P&L and key metrics incl. ROE, ROA, NPL, diluted EPS) is stored and shown; multi-year audited statements and cash-flow statements are not published. Note: Merolagani EPS can be part-year (quarter), which inflates P/E — the page shows the period. |
| Audited 5-year fundamentals | ⛔ | — | Not published by the free sources. |

## Sectors, floorsheet and brokers

| Feature | Status | Where | Notes |
|---|---|---|---|
| Sector name / sector company names | ✅ | Sectors; Companies | |
| Sector volume, 1-week volume by sector | ✅ | Sectors | Sum of members' last 5 sessions. |
| 1-week volume by stock | ✅ | Sectors | |
| Broker buy/sell (stock bought by brokers) | 🟡 | Floorsheet → Brokers / Stock by broker | From the stored floorsheet days only. |
| Broker holdings | ⛔ (estimate shown) | Floorsheet → Broker holding (estimate) | Actual broker/CDS holdings are not published; the app shows net flow over stored days, labelled as an estimate. |
| Bulk transactions | ✅ | Floorsheet → Bulk transactions | Trades ≥ Rs 1 crore (adjustable) or ≥ 10,000 units. |
| 3-day top buy stocks | 🟡 | Floorsheet → 3-day top buy | The free page publishes only the latest day; history accumulates when `personal:bulk` runs each trading day. The page states how many days were used. |

## Events, IPO and news

| Feature | Status | Where | Notes |
|---|---|---|---|
| Upcoming IPO / FPO / right / auction | ✅ | Events | From the ShareSansar issue pipeline (203 issues). |
| Right share history, dividends, AGM | ✅ | Events; Company → Dividends & rights | |
| Lock-in periods | 🟡 | Events → Lock-in | Compiled from announcements; no dedicated published dataset. |
| Merger & acquisition | 🟡 | Events → Mergers & acquisitions | Compiled from announcements, news and merged/delisted securities; not a complete M&A history. |
| High dividend stocks (5 years) | 🟡 | Fundamentals presets; Company dividends | Uses the dividend history the pages display. |
| Mutual-fund investment stocks | ⛔ | — | Fund portfolio holdings are published only as PDFs; fund NAVs are available. |
| NEPSE news (company) | ✅ | Events → News; Company → Events & news | Market headlines and company news/announcements with links. |

## Tools

| Feature | Status | Where | Notes |
|---|---|---|---|
| Share calculator | ✅ | Calculator | Buy cost, sell proceeds with CGT, breakeven, WACC, bonus/right adjusted price, dividend yield and tax. Rates editable; confirm current SEBON/broker rates before relying on them. |

## Keeping the client's work low

- One update command refreshes everything; the app reminds when data is older than four days.
- Alerts arrive as desktop notifications; the smart brief summarises a session on one page.
- Screener presets turn each requested screen into one click; every table exports to CSV.
- Every number shows its source, as-of time and whether it is unofficial or derived.

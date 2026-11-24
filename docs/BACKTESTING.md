# Backtesting

The backtester replays stored end-of-day candles through a small strategy
engine and reports hypothetical performance. It runs only behind a corporate
action coverage gate, because the archive stores raw, unadjusted exchange
prices and the corporate-action snapshots usually do not carry an ex-date.

Read every number as **DERIVED** research over unofficial data. It is not
investment advice.

## Coverage gate

`GET /api/backtest/coverage?symbols=NABIL,SCB&from=2024-01-01&to=2026-01-01`
reports, per symbol:

- the stored session count and first/last date in the requested window;
- how many stored corporate actions were resolved and how many were not;
- whether a corporate-action snapshot exists at all;
- whether the adjusted series validates;
- every blocking reason, in plain language.

`POST /api/backtest/run` recomputes the same gate and returns HTTP 400 when any
requested symbol is ineligible. A symbol is eligible only when all of these
hold:

1. A `corporateActions` snapshot is stored for the symbol. A missing snapshot
   means **unknown coverage**, not "no actions": the app cannot prove the
   series is action-free.
2. Every stored action resolves to an explicit ex-date and enough parameters to
   compute its adjustment.
3. At least two sessions exist in the requested window.
4. The adjusted series validates (factors finite and positive, adjusted prices
   positive, adjusted OHLC consistent).

An empty corporate-action list is resolved coverage: the source explicitly
returned no actions. A missing list is not.

## Adjustment rules

Actions are resolved only from an explicit `exDate` field. A record date, book
closure date or announcement date is never treated as an ex-date. This is
deliberate: an approximated ex-date makes a wrong backtest look reliable.

| Action | Resolved inputs | Price factor before ex-date | Share effect at ex-date | Cash effect |
| --- | --- | --- | --- | --- |
| Bonus | ex-date + bonus percent | `1 / (1 + percent/100)` | shares × `(1 + percent/100)` | none |
| Split | ex-date + ratio (new per old) | `1 / ratio` | shares × `ratio` | none |
| Right | ex-date + ratio + issue price | `(prevClose + ratio × issuePrice) / ((1 + ratio) × prevClose)` | shares × `(1 + ratio)` | −`ratio × issuePrice × oldShares` |
| Cash dividend | ex-date + cash per share | `(prevClose − dividendPerShare) / prevClose` | none | +`dividendPerShare × shares`, less withholding tax |

- Volume before an ex-date is multiplied by `1 / priceFactor`, so turnover
  stays comparable.
- A cash dividend that is stored only as a percent of paid-up value is converted
  to Rs per share **only** when a paid-up/par value is actually known (the
  stored company profile supplies it when present). Otherwise it is unresolved.
- A right without both a ratio and an issue price is unresolved.
- A split without a ratio other than 1 is unresolved.
- The adjusted rows are DERIVED and marked `adjusted: true` with an
  `adjustmentFactor`. The raw rows are kept unchanged on the result.
- Validation reports the ex-date continuity residual (actual close versus the
  factor-implied close) as a warning. The market's own move on the ex-date is
  not an adjustment error, so a residual never fails the series by itself.

## Engine assumptions

- **Signals on the close, fills at the next open.** A signal computed from bar
  `i` can only execute at the open of bar `i + 1`. Nothing in the engine reads a
  future bar.
- **Adjusted signals, raw execution.** Indicators read the price-continuous
  series (all actions adjusted). Fills, fees, CGT and position accounting use
  the raw exchange price, so a bonus or split cannot create a false signal and
  cannot create an artificial equity jump.
- **Positions receive actions.** Bonus and split multiply the share count at the
  ex-date. A right is assumed to be exercised: shares multiply and the
  subscription cost is debited from cash (a shortfall is reported as a negative
  cash balance). A cash dividend is credited to cash on the ex-date, net of the
  fee schedule's dividend withholding rate.
- **Cost basis.** A bonus or split leaves the position's total cost basis
  unchanged, so the tax model spreads the original cost over more shares. A
  right increases the cost basis by the subscription amount actually paid.
- **Costs.** Buys use `buyCost`; sells use `sellProceeds` with capital gains tax
  based on the holding period and investor type. DP charge, SEBON fee and
  broker commission follow the fee schedule. Slippage is applied against the
  trader in basis points.
- **Sizing.** Percent-of-equity or fixed amount, capped by available cash and by
  `maxPositions`. Fractions of a share after a corporate action are kept; the
  engine does not round them.
- **Calendar.** Dates are the union of the requested symbols' stored sessions.
  A symbol suspended on a date is marked at its last stored close. Weekdays with
  no stored candle are not treated as zero-return days and are not bridged.
- **End of test.** Open positions are closed at the last stored close by
  default, with the same fees and CGT, so trade statistics are complete.
- **Benchmark.** NEPSE index closes (`kind = "index"`), normalised to the
  initial capital from the first common date. If the index series is missing,
  the benchmark is null rather than fabricated.
- **Multiple symbols** are processed in symbol order on each date. This is
  deterministic; it is not a claim that the order is optimal.
- **Strategy state** is recomputed from the adjusted close series on every bar.
  RSI and breakout strategies are stateful (enter on a cross, exit on an
  opposite cross); SMA/EMA, MACD and buy-and-hold are level-based.

### Supported strategies

- `smaCross` / `emaCross`: long while fast average > slow average.
- `rsi`: long after RSI crosses up through the buy level; flat after it crosses
  down through the sell level.
- `macd`: long while the MACD line is above its signal line.
- `breakout`: long on a close above the prior N-session high; flat on a close
  below the prior M-session low.
- `buyAndHold`: long from the first eligible open.

Optional stop-loss and take-profit levels are checked intraday against the raw
bar. On an ex-date the levels are scaled by the action's price factor, so a
split, bonus, right or dividend cannot trigger a stop (or a target) through the
mechanical price change alone. If both would trigger on the same bar and the
open does not resolve it, the stop is assumed first (the conservative choice).

## Metrics

Total return, CAGR, maximum drawdown (negative percent), Sharpe, Sortino,
annualised volatility, win rate, profit factor, expectancy, trade count,
exposure, turnover, fees, CGT, dividends and the NEPSE benchmark return. The
daily equity curve, drawdown curve and month-over-month returns are returned
alongside every trade.

Sessions per year are inferred from the equity curve's own span, not assumed to
be 252. Sharpe and Sortino divide by the sample deviation of daily returns;
they are null when fewer than two returns exist or the deviation is zero.

## Limits

- `GET /api/backtest/coverage` accepts at most 50 symbols per request.
- `POST /api/backtest/run` accepts at most 25 symbols, 8,000 sessions per
  symbol and 100,000 sessions in total. Larger requests return a clear 400.
- Coverage and the run are computed synchronously. Coverage is cached by the
  store's data version, so a re-sync or import invalidates it automatically.
- The engine is a daily model. It does not replay intraday bars, order-book
  depth, circuit breakers, T+2 settlement or liquidity.
- The universe is whatever is stored. Delisted and suspended symbols that are
  absent from the archive are absent here too, so survivorship bias remains.
- Fees, CGT and the dividend withholding rate come from the fee schedule. They
  are commonly published values, not a live broker quote.
- The model does not levy the 5% bonus face-value tax when bonus shares are
  credited; it applies CGT when the shares are sold. Add that charge yourself
  if your tax position requires it.
- The adjusted series is only as good as the stored ex-dates. A wrong ex-date
  silently produces a wrong adjusted series; the continuity residual is shown
  but is not proof of correctness.

## Improving coverage

The starter archive has corporate-action snapshots with no ex-dates, so most
symbols are blocked. Coverage improves only by adding real ex-date data:

1. Fill the `exDate` column of `data/corporate-actions.csv` from an official
   source (NEPSE book-closure / corporate-action notices) and re-import. The CSV
   provider reads that column and passes it through to the snapshot.
2. Add the explicit cash amount per share (`dividendPerShare`) where it is
   known, or a paid-up/par value so a percent can be converted.
3. For rights, record the share ratio and the issue price per share.
4. Re-run `GET /api/backtest/coverage`. A symbol moves from blocked to eligible
   only when every one of its actions is resolved and the series validates.

Do not estimate an ex-date to make a symbol eligible. The gate is the product
feature: a refused symbol is an honest answer, and a backtest over guessed dates
is worse than no backtest.

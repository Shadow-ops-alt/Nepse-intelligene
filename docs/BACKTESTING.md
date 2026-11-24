# Backtesting and paper trading

There is no backtester in this project, and this document does not describe one
to build. It records the gate that must stay closed until the data underneath
it is trustworthy, plus what is supported today.

## The gate

Backtesting is blocked until both conditions are true:

1. **Corporate-action-adjusted history exists.** Prices must be adjusted for
   splits, bonus shares and cash dividends in a documented, reproducible way.
   The store currently keeps raw exchange prices and a corporate-action list;
   it does not build an adjusted series.
2. **Data-quality checks are trustworthy.** The automatic import runs
   report-only checks (`reports/validation.json`). Until those checks are clean
   on a representative history, any equity curve built on the raw rows is
   measuring data errors as much as strategy.

Until then, do not add a backtest runner, optimizer or strategy simulator. A
backtester over unadjusted, partially missing data produces confident numbers
that are wrong, which is worse than no backtester.

## Checklist before any backtester is written

- [ ] Adjusted history for every equity series, with the adjustment method
      recorded per row (`adjusted` / `adjustment_factor` are already in the
      schema but are not populated from corporate actions).
- [ ] Corporate actions parsed and reconciled against price discontinuities,
      including splits, bonus issues and cash dividends.
- [ ] Validation report clean, or every remaining issue understood and
      documented: no duplicates, no OHLC breaks, no unexplained quote/close
      disagreement, no unexpected missing sessions.
- [ ] A trading calendar that knows NEPSE holidays. Today the gap detector only
      knows weekdays and explicitly reports holidays as unknown.
- [ ] Survivorship-bias-free universe: delisted and suspended symbols included
      in the historical universe, not only today's active list.
- [ ] Explicit handling of the intraday gap: NEPSE does not publish intraday
      history, so intraday strategies cannot be backtested from stored data at
      all.
- [ ] Point-in-time fundamentals if any fundamental factor is used. Snapshots
      currently describe the latest fetch, not the state at a historical date.
- [ ] Costs modelled: brokerage, SEBON/regulatory fees, capital gains and the
      T+2 settlement delay that the journal already encodes.
- [ ] A frozen fixture window with known answers, so the harness is tested
      before it is trusted.

## Current limitations

- **No adjusted history.** Raw close-to-close returns jump on ex-dates and
  overstate or understate returns around corporate actions.
- **Unofficial prices.** The archive and the live feed are unofficial. They can
  lag, miss trades, or disagree with the exchange.
- **Unknown holidays.** Missing trading days are reported as possible gaps, not
  filled. A backtest must not silently treat a holiday as a zero-return day.
- **Intraday history does not exist.** The intraday chart records bars only
  while the app is open. There is no historical intraday series to replay.
- **Snapshots are latest-only.** Fundamentals, indices, news and IPO lists are
  stored as the latest payload, not as point-in-time history.
- **Validation is report-only.** The refresh never deletes or repairs a row.
  That is deliberate, and it means bad rows can reach any consumer until the
  underlying source is fixed.

## Paper trading is supported today

Paper trades do not need the gate because they do not replay history. They are
recorded through the journal's `paper` flag, owned by the journal UI. A paper
trade is an explicit user decision with a timestamp; it is not a simulated
strategy. See the journal page and `docs/FEATURES.md` for how the flag is
stored. Keep the distinction clear: one recorded paper trade is a note, a
backtest is a claim about a strategy, and only the latter needs the gate above.

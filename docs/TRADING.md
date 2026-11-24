# Trading workflow

Four personal-workflow pages sit under **Personal** in the desktop app:

- **Trade plan** (`#/trade-plan`)
- **Journal** (`#/journal`)
- **Reconciliation** (`#/reconciliation`)
- **Data quality** (`#/data-quality`)

Everything is stored in the local database behind the local API. The pages send
relative `/api/...` requests; there is no remote service and no new dependency.

## Trade plan

Plan a NEPSE equity trade before it is placed.

- Symbol (with a native company suggestion list from `/api/companies`), side,
  entry, stop, up to three targets, quantity, and a risk amount or a risk
  percent of account capital.
- Risk per trade is `|entry − stop| × quantity`. Reward/risk is shown for each
  target. In percent mode the percentage is of the account capital entered and
  is used to suggest a position size; the API may store its own stop-distance
  percent when no percent is supplied.
- Costs use the bundled `@stock/analytics` fee schedule: `buyCost()` for a buy,
  `sellProceeds()` for each target. That covers broker commission, the SEBON
  fee, the DP charge, capital gains tax and net profit. CGT follows the holding
  period entered in the form (the individual short- or long-term rate).
- A sell plan has no known purchase cost in this tool, so the planned entry is
  used as the reference cost basis and the net figure is labelled "net vs
  entry". It is an estimate, not a realised P&L.
- Plans are saved with `POST /api/trade-plans`, changed with
  `PATCH /api/trade-plans/:id`, listed with `GET /api/trade-plans?symbol=` and
  removed with `DELETE /api/trade-plans/:id`.

### Prepare order and the broker limitation

The prepare-order panel is a **plain-text order sheet** with a copy button and a
link to `https://tms.nepse.com.np/` that opens in a new tab with
`rel="noopener noreferrer"`.

There is no broker connection, no broker API call, no order routing and no
stored broker credentials. The app does not place, modify or cancel orders.
Paste the copied summary into your broker terminal or NEPSE TMS yourself, and
confirm the symbol, side, quantity, price and stop before submitting.

## Journal

Record both paper and real trades.

- A journal entry can link to a saved plan. Selecting a plan fills the symbol,
  side, planned entry/stop/target and quantity.
- Fields: symbol, side, paper flag, planned entry/stop/target, actual
  entry/exit, quantity, fees, reason, mistakes, tags and a short snapshot note.
- P&L is computed only when an actual exit exists. When `actualExit` is null the
  entry stays **pending** and shows no P&L or R, even if the API happens to
  carry a number. A pending trade is still counted in the trade total but is
  excluded from wins, losses, win rate and average R.
- R multiple is realised P&L divided by planned risk
  (`|planned entry − planned stop| × quantity`).
- Filters: symbol and month (sent to `GET /api/journal?symbol=&from=&to=`), plus
  tag and paper/real, which are filtered in the browser.
- The monthly review card shows trades, closed trades, wins, losses, win rate,
  net P&L and average R for the current filter.
- Writes use `POST /api/journal`, `PATCH /api/journal/:id` and
  `DELETE /api/journal/:id`.

### Chart snapshots

A company chart can be attached to a journal entry without leaving the app.

- On a company page, the **Snap** button in the chart toolbar captures the
  rendered candles and the drawing overlay as one image. The capture is
  downscaled to at most 1280 px wide and exported as JPEG at quality 0.82.
- The image is handed to the journal through `sessionStorage`, never uploaded
  to a third party. The journal page reads the pending image once, prefills the
  symbol, shows a preview with a **Remove** button, and clears the storage key.
- Saving sends the data URL as `snapshotImage` with `POST /api/journal` or
  `PATCH /api/journal/:id`. Omitting the field keeps an existing image, sending
  `null` removes it, and a data URL replaces it.
- Images are stored in the local SQLite database. The API accepts PNG, JPEG or
  WebP base64 data URLs up to 1.5 MB decoded; anything larger or malformed is
  rejected. Journal list responses expose only `hasSnapshot`, never the image.
- `GET /api/journal/:id/snapshot` returns the raw bytes with the correct image
  content type and `cache-control: no-store`. The journal table shows a small
  lazy thumbnail that opens the full image in a new tab.
- The snapshot is a picture of the chart and its drawings. It is not investment
  advice, a recommendation or a forecast.

## Reconciliation

Bring broker or CDSC history together with the local ledger.

- The CSV file is read in the browser and its text is posted as
  `{ source, csv }` to `/api/reconciliation/import`. The result shows imported
  and skipped rows. A row the importer cannot parse fails the whole import
  (nothing is guessed); a skipped row is one whose `external_id` was already
  stored.
- `GET /api/reconciliation/summary` supplies realised, unrealised and total
  P&L, XIRR, dividends, bonus and rights shares, exposure by symbol and weight,
  concentration (top symbol, top percent, HHI and 1/HHI effective positions),
  and recent imports.
- XIRR is returned as a fraction (`0.12` is shown as `12.00%`). A null XIRR
  is shown as **"Not enough cash flows"**, never as 0.
- The corporate ledger lists dividend, bonus and rights events from
  `GET /api/corporate-ledger`, adds them with `POST /api/corporate-ledger` and
  removes them with `DELETE /api/corporate-ledger/:id`.

### Reconciliation assumptions

- The importer decides which rows are valid. The UI only reports the counts the
  API returns.
- Exposure weights are shares of priced market value supplied by the API; the
  UI sorts them but does not recompute them.
- HHI is the sum of squared weights. Effective positions is `1 / HHI`.
- Bonus and rights are **events**. Recording one does not silently change
  portfolio quantities or cost basis. When the shares are credited, record the
  resulting quantity explicitly (for example as a portfolio transaction) so the
  change is visible and reversible.
- Dividends shown in the summary come from the imported/recorded data; this
  page does not fetch or invent corporate actions from the market archive.

## Data quality

`GET /api/data-quality` returns a per-symbol assessment. The page shows summary
counts and a table with last candle, last quote, sessions, stale days, missing
sessions, quote-versus-candle percent and status.

- Statuses are **fresh**, **stale**, **thin** and **discrepancy**. The filter
  shows all rows or one status; search narrows by symbol.
- Rows are sorted worst first: discrepancy, then stale, then thin, then fresh;
  within a status, more stale days and larger quote differences come first.
- Missing sessions count recent market sessions (stored sessions where at least
  60% of symbols traded) with no candle for the symbol, so a newly listed
  symbol also shows the sessions before it listed. Exchange holidays are not
  known, so a holiday can be counted as a gap. The figure is a prompt to
  inspect, not a verdict.
- Quote versus candle compares the stored end-of-day quote with the last candle
  close. It flags a source mismatch; it does not decide which value is correct.
- Data remains **UNVERIFIED**. This page never fills, adjusts or corrects a
  series.

## API contract used

All payloads are camelCase JSON.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/trade-plans?symbol=` | — | `{ plans }` |
| POST | `/api/trade-plans` | plan | `{ plan }` |
| PATCH | `/api/trade-plans/:id` | plan | `{ plan }` |
| DELETE | `/api/trade-plans/:id` | — | `{ deleted }` |
| GET | `/api/journal?symbol=&from=&to=` | — | `{ entries }` |
| POST | `/api/journal` | entry | `{ entry }` |
| PATCH | `/api/journal/:id` | entry | `{ entry }` |
| DELETE | `/api/journal/:id` | — | `{ deleted }` |
| GET | `/api/journal/:id/snapshot` | — | raw image bytes (`image/png`, `image/jpeg` or `image/webp`) |
| POST | `/api/reconciliation/import` | `{ source, csv }` | `{ imported, skipped, importId }` |
| GET | `/api/reconciliation/summary` | — | summary object |
| GET | `/api/corporate-ledger?symbol=` | — | `{ entries }` |
| POST | `/api/corporate-ledger` | entry | `{ entry }` |
| DELETE | `/api/corporate-ledger/:id` | — | `{ deleted }` |
| GET | `/api/data-quality` | — | `{ generatedAt, latestSession, summary, symbols }` |

The pages are written against this contract. If the local API is not available,
each page shows its own empty or error state; no sample data is injected.

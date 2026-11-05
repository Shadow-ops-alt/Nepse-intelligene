# Manual / Licensed CSV Format

`CsvProvider` reads an operator-supplied directory. It is designed for a
purchased historical extract, a manually reconciled dataset, or a vendor that
delivers files instead of an API.

```bash
MANUAL_DATA_DIR=./data/manual
MANUAL_DATA_LICENSED=false
```

Set `MANUAL_DATA_LICENSED=true` **only after** the licence has been reviewed.
That flag changes the descriptor to `termsStatus=verified`,
`productionReady=true`, and is therefore an explicit legal attestation. The
provider does not verify the claim.

All files are UTF-8 CSV with a header row. Timestamps without an offset are
interpreted as Asia/Kathmandu (+05:45). Trading dates use `YYYY-MM-DD`.

## Required files

### `companies.csv`

```csv
id,symbol,name,sector,instrumentType,status,email,website,regulatoryBody,listedAt,marketCap
131,NABIL,Nabil Bank Limited,Commercial Banks,Equity,active,company.affairs@nabilbank.com,www.nabilbank.com,Nepal Rastra Bank,1985-01-01,150000000000
```

Required: `id`, `symbol`, `name`, `sector`. Optional: `instrumentType`
(default `Equity`), `status` (`active|suspended|delisted|unknown`), `email`,
`website`, `regulatoryBody`, `listedAt`, `marketCap`.

## Optional master data

### `securities.csv`

```csv
id,symbol,name,companyId,instrumentType,isPromoter,status
131,NABIL,Nabil Bank Limited,131,Equity,false,active
```

If absent, securities are derived from `companies.csv`.

### `indices.csv`

```csv
symbol,name,isSector
NEPSE,NEPSE Index,false
BANKING,Banking SubIndex,true
```

If absent, NEPSE plus one index per sector is derived.

## Price history

### `ohlc/<SYMBOL>.csv`

```csv
symbol,timeframe,timestamp,date,open,high,low,close,volume,turnover,trades,adjusted,adjustmentFactor
NABIL,1day,2026-11-03T09:15:00Z,2026-11-03,547,555,545,552,42360,23333426.4,309,true,1.0
```

- `timestamp` is preferred. If missing, `date` is read as 15:00 Nepal time.
- `timeframe` defaults to `1day`.
- Required: `open`, `high`, `low`, `close`, `volume`.
- `adjusted` defaults to `false`. If prices are adjusted, set `true` and
  record `adjustmentFactor` where known.
- The provider filters by the requested `from`/`to` dates.

### `indices/<INDEX>.csv`

Same columns as `ohlc`, with the index symbol in `symbol`.

An index has no share count. If the source leaves index volume blank, write
`volume` as `0` and keep the real turnover in `turnover`; `0` here means "not
published / not applicable", not an observed zero-share session. The app's
market overview shows this index history separately from the unavailable
market-wide summary totals.

## Live / current-day files

### `quotes.csv`

```csv
symbol,ltp,change,changePercent,open,high,low,previousClose,volume,turnover,trades,session,asOf
NABIL,554,2,0.36,553,555,552.5,552,1142,631566,42,eod,2026-11-04T11:10:00.785032
```

`ltp` is the last traded/available price. `session` is optional: use `live`
for a live feed and `eod` for an end-of-day close. If omitted, the app assumes
the quote is live and applies the 15-minute freshness window, so set `session`
when the row is a close. An `eod` quote is labelled `eod`, not `stale`, until it
is older than the daily window. The UI never presents a delayed or end-of-day
close as a live price.

### `market-summary.csv`

```csv
indexName,indexValue,change,changePercent,turnover,sharesTraded,transactions,scripsTraded,asOf
NEPSE,2681.07,12.4,0.46,309505402.9,710004,3039,195,2026-11-04T11:10:00
```

If absent, the market summary is **unavailable**. It is never synthesised from
`quotes.csv` or any other file, because a derived index value would not be the
real NEPSE index. The UI shows the summary as unavailable and keeps the rest of
the page.

### `sector-performance.csv`

```csv
sector,indexValue,changePercent,turnover,volume,companies
Commercial Banks,1450.2,0.31,120000000,450000,20
```

## Floorsheet

### `floorsheet/<YYYY-MM-DD>.csv`

```csv
contractId,businessDate,symbol,buyerBroker,sellerBroker,quantity,rate,amount,asOf
2026110405001267,2026-11-04,SIGS2,58,42,120,9.66,1159.2,2026-11-04T11:08:59
```

The requested date selects the file. Every row should have the same
`businessDate`. `getBrokerFlows` is derived by aggregating this file.

## Fundamentals

### `fundamentals/<SYMBOL>.csv`

One row per metric per period:

```csv
period,fiscalYear,quarter,metric,value,unit,currency,reportedAt,source,confidence,notes
FY2082/83-Q1,2082/83,1,EPS,21.4,currency,NPR,2026-10-25,Vendor X,reported,
FY2082/83-Q1,2082/83,1,ROE,14.2,percent,,2026-10-25,Vendor X,reported,
FY2082/83-Q1,2082/83,1,P/E,25.8,ratio,,2026-10-25,Vendor X,derived,Price / annualised EPS
```

- `period` groups rows into a snapshot.
- `unit`: `percent|currency|ratio|shares|number|days|unknown`.
- `confidence`: `verified|reported|derived|estimated|unverified`.
- History is the sorted set of periods in this file.

## Corporate actions

### `corporate-actions.csv`

```csv
symbol,type,ratio,value,currency,announcedAt,exDate,recordDate,sourceUrl,notes
NABIL,bonus,10:1,,,,2026-09-15,2026-10-20,https://example.com/notice,10% bonus
NABIL,cashDividend,,12.5,NPR,2026-09-15,2026-10-20,2026-10-20,https://example.com/notice,
```

`type`: `bonus|right|cashDividend|split|merger|acquisition|other`.

## Issues

### `ipos.csv`

```csv
id,companyName,symbol,type,openDate,closeDate,price,units,status,sourceUrl,notes
2026-001,Example Hydropower Limited,EXHPL,ipo,2026-11-10,2026-11-14,100,1000000,upcoming,https://example.com/ipo,
```

`type`: `ipo|fpo|right|mutualFund|debenture`.
`status`: `upcoming|open|closed|allotment|listed|unknown`.

## News

### `news.csv`

```csv
id,title,url,publishedAt,source,symbols,summary
n-1,Nabil Bank reports quarterly profit growth,https://example.com/news/1,2026-11-04T08:30:00+05:45,Vendor News,NABIL,Quarterly update.
```

`symbols` is a comma- or semicolon-separated list.

## Validation

Every import runs row-level checks before anything is written. The validator
reports the file, 1-based data row, column, offending value, and reason. It
never repairs, interpolates, or silently drops a row.

What is checked:

- `companies.csv`: required `id`, `symbol`, `name`, `sector`; symbol format;
  duplicate symbols.
- `ohlc/<SYMBOL>.csv`: required date, OHLC and volume; finite, non-negative
  numbers; duplicate trading dates; `high` not below `low`/open/close; `low`
  not above open/close.
- `quotes.csv`: required symbol and `asOf`; finite numbers; duplicate symbols.
- `market-summary.csv` and `sector-performance.csv`: required fields and
  numeric/date formats.

The import has two phases:

1. **Preview** (`GET /api/import/preview`, or `pnpm personal:sync --dry-run`)
   validates and reports counts, warnings, and gap candidates. No writes.
2. **Run** (`POST /api/import/run`) re-validates, then writes in one
   transaction. A fatal validation error aborts before the first write. A
   partial run is recorded in `import_audit` with failed symbols and warnings.

Gap detection reports possible missing trading days between stored sessions. It
does not know the exchange holiday calendar, so it never fills a gap.

```bash
MANUAL_DATA_DIR=./data/manual \
MANUAL_DATA_LICENSED=false \
pnpm phase0:validate --provider csv --data-dir ./data/manual
```

Keep the original vendor files and a checksum/manifest. Do not edit a licensed
extract in place without recording the transformation; the provenance chain
must survive into the production database.

## Backup and restore

```bash
pnpm personal:backup --out backup.db
pnpm personal:restore --from backup.db --force
```

Backups use SQLite `VACUUM INTO`, so they are consistent even while the app is
running. Restore requires `--force` and replaces the current database; take a
backup first.

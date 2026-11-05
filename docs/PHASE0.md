# Phase 0: Data Validation Gate

Phase 0 answers one question: **is there enough accurate, licensed, long-term
market data to build the licensed product we promised?** No licensed production
UI or analytics work starts until this gate is resolved.

> The shipped **Free Edition** is a separate product decision on unofficial
> data. It does not satisfy, weaken, or bypass this gate. See
> [FREE_EDITION.md](FREE_EDITION.md).

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test

# smoke-test the harness with deterministic synthetic data
pnpm phase0:validate --provider mock

# list providers and whether policy allows them
pnpm phase0:providers

# manual CSV adapter (dev data only unless attested)
pnpm phase0:validate --provider csv --data-dir ./data/manual

# licensed REST adapter (requires a contract and credentials)
pnpm phase0:validate --provider licensed --env production

# operator-supplied external command (development/validation only)
ALLOW_UNOFFICIAL_DATA=true pnpm phase0:validate --provider command
```

Reports are written to `reports/phase0-<provider>-<timestamp>.md` and `.json`.
The directory is gitignored.

Exit code is `1` when the verdict is `no-go`; use `--exit-zero` to override.

## Checks

| Check | What it proves | Fail condition |
|---|---|---|
| Runtime policy | Provider is allowed in the target environment | Blocked by terms/source policy |
| Provider metadata | Terms, readiness, reliability, history limits are declared | Missing/invalid or unsafe claims |
| Capability coverage | MVP capabilities exist | Any required capability missing |
| Company master | Symbols, sectors, status, no duplicates | Empty or structurally invalid |
| Security master | Securities resolve to companies | Empty or structurally invalid |
| Daily OHLC history | Five years of daily candles | Starts too late or coverage < 75% |
| Index history | Five years of NEPSE/index candles | Starts too late or coverage < 75% |
| Intraday OHLC | Live chart source | Missing (warning) |
| Floorsheet | Requested business date is honoured | Empty or wrong date |
| Latest fundamentals | Metrics with confidence labels | No usable metrics |
| Fundamentals history | Multi-period history | Fewer than 4 periods |
| Corporate actions | Bonus/right/dividend data | Empty is a warning |
| IPO pipeline | IPO/FPO/right data | Empty is a warning |
| Live quotes | Feed is populated and fresh | Empty, invalid, or > 7 days old |
| Market summary | Index/turnover/transactions parse | Invalid |
| Provider health | Health endpoint responds | Down |

## History thresholds

The five-year requirement is a hard gate.

- Coverage is measured against **Sunday–Thursday** trading days. Public
  holidays are not modelled; thresholds leave room for them.
- **PASS:** ≥ 90% coverage, first candle within 45 days of the requested start,
  newest candle within 10 days.
- **WARN:** 75–90% coverage, or newest candle 10–30 days old.
- **FAIL:** < 75% coverage, first candle more than 45 days late, no data, or
  newest candle more than 30 days old.

A provider that only returns the last year fails even if every row is clean.
That is intentional: a one-year window cannot support five-year charts,
backtests, or long-term fundamental comparisons.

## Verdict semantics

| Verdict | Meaning |
|---|---|
| `go` | No failures and no warnings. Safe to start production work with this provider. |
| `conditional` | No failures but warnings. Can continue development; production requires resolving warnings. |
| `no-go` | At least one failure, or policy blocks the provider. Do not start production work. |

The mock provider is expected to produce `conditional` when it warns that its
fundamental metrics are synthetic/estimated. That is the harness working
correctly, not a data-source success.

## Policy configuration

```env
ALLOW_UNOFFICIAL_DATA=false
NODE_ENV=development
MANUAL_DATA_DIR=./data/manual
MANUAL_DATA_LICENSED=false
LICENSED_BASE_URL=
LICENSED_API_KEY=
COMMAND_PROVIDER_CMD=
```

`ALLOW_UNOFFICIAL_DATA=true` is required to validate an unofficial provider in
development. It is ignored in production. `MANUAL_DATA_LICENSED=true` is an
operator attestation that the manual data is licensed; do not set it casually.

## CI usage

Run the mock provider suite on every commit:

```bash
pnpm typecheck
pnpm test
pnpm phase0:validate --provider mock
```

Run a real provider only in a controlled job with credentials and explicit
policy. Store the JSON report as an artifact so a future release can prove what
data was verified and when.

## Adding a check

1. Add `src/checks/<name>.ts` exporting a `Check`.
2. Declare `capabilities` so the runner skips it cleanly when unsupported.
3. Return `outcome(status, summary, details, metrics)`.
4. Register it in `src/checks/index.ts`.
5. Add a test. Do not weaken thresholds to make a bad provider pass.

# Alerts

Alerts are a local, rule-based watch over the stored market data. They are not
server-side jobs, not push notifications, and not trading advice. The rules,
seen state and notification preference are per viewer and live in the browser's
`localStorage`.

## How alerts work

The renderer polls the local API every five minutes:

- `/api/signals?lookback=5` supplies the end-of-day technical signals that the
  API computes from stored candles (RSI crosses, MACD, EMA, Supertrend, SAR,
  breakouts, structure changes, 52-week extremes).
- `/api/watchlist`, `/api/portfolio`, `/api/companies` define rule scope.
- `/api/quotes` is the end-of-day fallback for price rules.
- `/api/live/market` supplies the unofficial live LTP when the live service
  responds. Price rules then use the live value; otherwise they use the last
  end-of-day close.

`matchAlerts` in `apps/desktop/src/alerts.ts` evaluates each enabled rule and
produces `TriggeredAlert` rows. A rule can be:

- a signal rule (type, direction, scope: watchlist, portfolio, both, or all
  active equities), or
- a price rule (`SYMBOL` at or above / at or below a price).

New alerts are de-duplicated by key and notified once. Desktop notifications
are requested through the browser Notification API and can be turned off on the
Alerts page. The first run after clearing storage records the backlog silently
instead of firing a notification burst.

### Portfolio events

A third alert kind covers corporate actions without turning them into signal or
price rules. The engine reads `GET /api/corporate-ledger` and, for symbols in the
watchlist or portfolio, raises one alert per ledger entry when the ex-date is:

- today,
- within the next seven days, or
- up to three days overdue.

The title is explicit, for example `NABIL dividend ex-date 2026-12-01`, and the
detail carries the amount, share count and notes when the ledger row has them.
Events are deduplicated by ledger entry id, so an entry fires once. An empty
ledger, a failed request or a missing route silently produces no portfolio-event
alerts; every other alert keeps working. On the Alerts page they appear in their
own "Portfolio events" table and use the same desktop notification preference.

The rules are deterministic. The "Smart brief" on the same page only ranks what
the stored data already contains; nothing is predicted.

## Desktop: alerts survive closing the window

In the Electron app the main window does not quit when it is closed. Closing it
hides the window to the system tray and keeps both the renderer and the child
API process alive:

- `webPreferences.backgroundThrottling` is `false`, so the renderer's five
  minute timer keeps running while the window is hidden.
- The tray menu has three actions:
  - **Open NEPSE Terminal** shows and focuses the window.
  - **Check now** shows the window and asks the renderer to poll immediately.
  - **Quit** sets a quitting flag, stops the API child process and really exits.
- Closing the window while the tray exists never stops the alert engine.

The tray icon is resolved from `build/icon.png` in development. A packaged
Linux build does not ship that file, so the app falls back to an embedded image.

### Tray limit

Some Linux desktops have no status-notifier host. Electron then cannot create a
tray icon. The app warns on the console and keeps the old behaviour: closing
the window quits, because hiding with no tray would leave no way back. On those
desktops alerts stop when the window closes.

Other ways alerts stop:

- **Quit** from the tray menu (or the OS quit action).
- The machine sleeping, shutting down, or the app being force-killed.
- Signing out of the desktop session.

## Mobile and PWA

On a phone the app is the free web/PWA build served by the same local API. There
is no background execution:

- Alerts run only while the page is open in a browser tab or the installed PWA.
- Closing the tab or the PWA stops the timer. Nothing is delivered in the
  background.
- There is no APK in this project. A native Android build needs the Android SDK,
  a Gradle wrapper project and signing.
- Over plain LAN HTTP (`http://192.168.x.x:4310/`) the service worker cannot
  register, so the app cannot be installed as a PWA from that origin. Use
  `localhost` or HTTPS to exercise installability.

See `docs/MOBILE.md` for the mobile test checklist.

## Prices are unofficial

The live feed and every price rule that uses it are unofficial. NEPSE does not
publish an official free API. Alert output can lag the market, miss trades, or
disagree with the exchange. Use it as a research aid, not as an execution
signal.

## Data quality

Automatic refreshes run report-only validation after import. The report is
`reports/validation.json` under the personal data directory. It flags duplicate
candles, OHLC invariant breaks, quote-versus-close discrepancies, symbols
missing from the latest session, and empty or partial archives. The refresh
never deletes or repairs a row because of it. See `docs/BACKTESTING.md` for why
that matters before trusting any historical result.

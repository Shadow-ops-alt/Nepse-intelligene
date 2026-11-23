# Desktop Shell

The product runs in two shapes from the same code:

- **Browser shape:** Vite dev server plus the local API (`pnpm dev`), or the
  built renderer served by the API (`pnpm start`).
- **Desktop shape:** an Electron window that starts the same API as a child
  process and loads the built renderer.

Neither shape embeds SQLite or Node in the renderer. The renderer only speaks
HTTP to `127.0.0.1`.

## Commands

```bash
pnpm desktop            # build web + bundle API, launch Electron
pnpm desktop:package    # build installers with electron-builder
```

Inside `apps/desktop`:

```bash
pnpm electron:server    # bundle electron/server.ts -> electron/server.mjs
pnpm electron:start     # install binary if needed, build, bundle, launch
pnpm electron:dev       # load http://127.0.0.1:5173; run `pnpm dev` first
```

`pnpm desktop` runs `install-electron`, which downloads the Electron binary on
a fresh checkout. The web build still works without the binary.

## Process model

```
Electron main (electron/main.mjs)
  ├─ picks a free localhost port
  ├─ spawns electron/server.mjs with ELECTRON_RUN_AS_NODE=1
  │    └─ @stock/api + @stock/store (SQLite) + free-source provider
  ├─ waits for GET /api/health
  └─ BrowserWindow.loadURL(http://127.0.0.1:<port>/)
```

The API child is bundled with esbuild so the packaged app does not need
TypeScript, tsx, or a system Node installation. `asar` is disabled so the
child can read `dist/` and `server.mjs` normally.

## Where user data lives

Electron passes `app.getPath("userData")` to the API as `NEPSE_USER_DATA`.

| Platform | Default |
|---|---|
| Linux | `~/.config/NEPSE Terminal/` |
| macOS | `~/Library/Application Support/NEPSE Terminal/` |
| Windows | `%APPDATA%\NEPSE Terminal\` |

Inside that directory:

```
personal.db      SQLite database (WAL mode)
data/            canonical CSV files written by automatic updates
data/reports/    import, bulk, details, provider-health and auto-refresh reports
data/source/     raw archive and content-addressed web page snapshots
```

Override with `PERSONAL_DB` and `PERSONAL_DATA_DIR`. `DATA_EDITION` defaults to
`free` in the packaged app; set it to `licensed` only with a licensed provider
configured.

## Automatic updates

The packaged app never asks the client to run a command or import CSV files.
On launch and every six hours while the window is open, it runs the same
pipeline as `pnpm personal:update`: download the public archive over HTTPS
(no git required), fetch the public web datasets, validate every row, and
import new end-of-day sessions into the local database. Watchlists, portfolios
and notes are never touched. Imported rows stay `UNVERIFIED`, and the raw
archive and web snapshots are kept under `data/source/`.

- Updates run only while the app is open. They stop when it closes and resume
  on the next launch.
- One run at a time. A run waits while a manual import is writing to the same
  store.
- A failed web or details pass still imports the archive. A failed details pass
  never fails the main refresh.
- After repeated failures the app backs off before retrying.
- If the remote archive cannot be checked, the app keeps using the last
  downloaded copy and reports that it is using cached data.

Configuration (defaults shown):

```bash
NEPSE_AUTO_REFRESH=1                          # 0 disables background checks
NEPSE_AUTO_REFRESH_INTERVAL_MINUTES=360       # minimum 15
NEPSE_AUTO_REFRESH_INITIAL_DELAY_MS=8000      # delay before the first check
NEPSE_AUTO_DETAILS=0                          # 1 adds the slow profile pass
```

The local API exposes the updater at `GET /api/refresh/status` and
`POST /api/refresh/run` (returns `202` and runs in the background). The Data
page uses these endpoints to show progress, the last result, the next check
time and a **Check now** button. **Fetch company profiles** starts a one-off
run with the slower details pass, so a client can load company profiles,
fundamentals and company events without setting an environment variable.

Manual CSV import remains available in the Data page as an offline fallback.

## Interface

The renderer is a flat, dense desktop UI with two complete themes.

- **Light** is the default. Dark is available from the top bar or Settings.
- **Auto** follows the OS `prefers-color-scheme` and reacts to changes.
- The preference is stored in `localStorage` and applied before first paint.
- Data state (`Live`, `Delayed`, `EOD`, `Stale`, `Unavailable`) and
  classification are shown as text badges, never colour alone.
- Global search matches stored symbols and names; it never calls the network.
- A render error shows a recoverable panel. The local database is untouched.

## Backup

The packaged app writes to the same SQLite file described above. Back it up
from a terminal with:

```bash
pnpm personal:backup --out ~/nepse-backup.db
pnpm personal:restore --from ~/nepse-backup.db --force
```

`VACUUM INTO` produces a consistent copy while the app is open. Restore
replaces the database, so close the app or stop the API child first.

## Packaging notes

`apps/desktop/package.json` contains the `electron-builder` configuration:

- Linux: AppImage
- Windows: NSIS
- macOS: DMG

Build on the target operating system, or use CI matrix jobs. Code signing is
not configured. Distribution must keep the Free Edition provenance strip and
must not bundle market data unless the operator has the right to redistribute
it.

## Troubleshooting

- **Electron binary missing:** run
  `pnpm --filter @stock/desktop exec install-electron`.
- **Blank window:** check the API child logs; the main process prefixes them
  with `[api]`.
- **Port already in use:** the desktop shell chooses a free port automatically.
  The browser shape still uses `API_PORT` (default `4310`).
- **Database locked:** close other API processes before launching Electron.
  The store uses WAL, but two writers on the same file are not supported.

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
data/            operator-supplied CSV files and the import wizard target
```

Override with `PERSONAL_DB` and `PERSONAL_DATA_DIR`. `DATA_EDITION` defaults to
`free` in the packaged app; set it to `licensed` only with a licensed provider
configured.

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

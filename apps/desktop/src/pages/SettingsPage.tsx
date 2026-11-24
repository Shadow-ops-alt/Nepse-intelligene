import { useTheme, type ThemeMode } from "../theme";
import { useApi } from "../hooks";
import { useHostedAuth } from "../hosted/auth";
import type { ImportStatus, Meta } from "../types";
import {
  AsOf,
  Badge,
  Card,
  DataStateBadge,
  EmptyState,
  Spinner,
  Stat,
} from "../components/ui";

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; hint: string }> = [
  { value: "light", label: "Light", hint: "White surfaces, dark text" },
  { value: "dark", label: "Dark", hint: "Black surfaces, light text" },
  {
    value: "system",
    label: "Auto",
    hint: "Follow the operating-system preference",
  },
];

export function SettingsPage({
  meta,
  onOpenData,
}: {
  meta: Meta;
  onOpenData: () => void;
}) {
  const { mode, resolved, setMode } = useTheme();
  const auth = useHostedAuth();
  const importState = useApi<ImportStatus>("/api/import/status");
  const dataDir = importState.data?.dataDir;

  return (
    <div className="stack">
      <div className="stats-row">
        <Stat label="Edition" value={meta.edition === "free" ? "Free" : "Licensed"} />
        <Stat
          label="Theme"
          value={mode === "system" ? `Auto (${resolved})` : resolved}
        />
        <Stat label="Provider" value={meta.providerId} />
        <Stat
          label="Store state"
          value={
            <DataStateBadge
              state={meta.dataState.state}
              classification={meta.dataState.classification}
            />
          }
          hint={<AsOf value={meta.dataState.lastAsOf} />}
        />
      </div>

      {auth.hosted && auth.session && (
        <Card
          title="Account"
          subtitle="Watchlist, portfolio, plans and journal are stored in your Supabase account"
          action={<Badge tone="good">cloud</Badge>}
        >
          <div className="kv">
            <div>
              <span>Email</span>
              <strong>{auth.session.user.email ?? "—"}</strong>
            </div>
            <div>
              <span>User id</span>
              <strong className="muted small">{auth.session.user.id.slice(0, 8)}…</strong>
            </div>
          </div>
          <div className="form-actions">
            <button
              className="button button-ghost"
              type="button"
              onClick={() => void auth.signOut()}
            >
              Sign out
            </button>
          </div>
        </Card>
      )}

      <Card
        title="Appearance"
        subtitle="The choice is stored locally and applied before first paint"
      >
        <div className="theme-options">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`theme-option ${
                mode === option.value ? "theme-option-active" : ""
              }`}
              aria-pressed={mode === option.value}
              onClick={() => setMode(option.value)}
            >
              <span className={`theme-swatch theme-swatch-${option.value}`} />
              <strong>{option.label}</strong>
              <span className="muted small">{option.hint}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card
        title="Data source"
        subtitle="Free Edition reads operator-supplied CSV files only"
        action={
          <button className="button" onClick={onOpenData}>
            Open Data page
          </button>
        }
      >
        <div className="kv">
          <div>
            <span>Provider</span>
            <strong>{meta.provider?.name ?? meta.providerId}</strong>
          </div>
          <div>
            <span>Source type</span>
            <Badge tone="warn">{meta.provider?.sourceType ?? "unknown"}</Badge>
          </div>
          <div>
            <span>Terms</span>
            <Badge tone="warn">{meta.provider?.termsStatus ?? "unknown"}</Badge>
          </div>
          <div>
            <span>Production ready</span>
            <Badge tone="bad">
              {meta.provider?.productionReady ? "yes" : "no"}
            </Badge>
          </div>
          <div>
            <span>Companies</span>
            <strong>{meta.store.companies}</strong>
          </div>
          <div>
            <span>Candles</span>
            <strong>{meta.store.candles}</strong>
          </div>
          <div>
            <span>Quotes</span>
            <strong>{meta.store.quotes}</strong>
          </div>
          <div>
            <span>Data directory</span>
            <code>
              {importState.loading
                ? "loading…"
                : (dataDir ?? "unavailable")}
            </code>
          </div>
        </div>
        {importState.error && (
          <p className="muted small">
            Data directory unavailable: {importState.error}
          </p>
        )}
        <p className="muted small">
          Automatic updates fetch public market data in the background on launch
          and every six hours while the app is open. Manual CSV import is an
          offline fallback on the Data page.
        </p>
      </Card>

      <Card
        title="Local storage & backup"
        subtitle="One SQLite database on this machine; nothing leaves the device"
      >
        <p className="muted">
          The database stores companies, candles, quotes, snapshots, the
          watchlist, the portfolio ledger and import audits. Demo or mock rows
          are rejected at the store boundary.
        </p>
        <p className="muted small">
          Backups use SQLite’s own <code>VACUUM INTO</code>, so they are
          consistent even while the app is open. Restore replaces the current
          database; back it up first. Developer backup and restore commands are
          on the Data page.
        </p>
      </Card>

      <Card title="Editions and limits" subtitle="Why this build is not licensed production">
        <ul className="limits">
          <li>
            The Free Edition is a separate product edition running on
            unofficial, operator-supplied data.
          </li>
          <li>
            The licensed edition remains blocked until a licensed provider,
            written permissions and verified history exist.
          </li>
          <li>
            No scraper, unofficial live API wrapper, or vendor term acceptance
            is included.
          </li>
          <li>
            Free-source data is unadjusted for corporate actions and may be
            stale; every value carries a state badge.
          </li>
        </ul>
      </Card>

      {importState.loading && <Spinner label="Reading local data directory" />}
      {!importState.loading && !dataDir && (
        <EmptyState title="Data directory not reported">
          Open the Data page to inspect the local import folder.
        </EmptyState>
      )}
    </div>
  );
}

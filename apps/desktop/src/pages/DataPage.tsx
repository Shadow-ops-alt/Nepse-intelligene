import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  describeAge,
  formatCheckTime,
  nptDate,
  refreshPhaseLabel,
  sessionAgeDays,
  UPDATE_COMMAND,
} from "../lib";
import { useApi, useRefreshStatus } from "../hooks";
import type {
  Coverage,
  ImportHistory,
  ImportPreview,
  ImportResult,
  ImportStatus,
  Meta,
} from "../types";
import {
  AsOf,
  Badge,
  Card,
  DataStateBadge,
  EmptyState,
  Notice,
  Spinner,
  Stat,
  type BadgeTone,
} from "../components/ui";

const CAPABILITY_LABELS: Record<string, string> = {
  companyList: "Company master",
  securityList: "Security master",
  sectors: "Sectors",
  indices: "Indices",
  dailyOhlc: "Daily OHLC",
  intradayOhlc: "Intraday OHLC",
  indexHistory: "Index history",
  liveQuotes: "Quotes (end-of-day closes)",
  marketSummary: "Market summary",
  sectorPerformance: "Sector performance",
  floorsheet: "Floorsheet",
  brokerFlows: "Broker flows",
  fundamentals: "Fundamentals",
  fundamentalsHistory: "Fundamentals history",
  corporateActions: "Corporate actions",
  ipos: "IPO pipeline",
  news: "News",
  mutualFundHoldings: "Mutual fund holdings",
};

function isoToday(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function defaultFrom(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  local.setFullYear(local.getFullYear() - 5);
  return local.toISOString().slice(0, 10);
}

function statusTone(status: string): BadgeTone {
  if (status === "ok") return "good";
  if (status === "partial") return "warn";
  if (status === "failed") return "bad";
  return "info";
}

export function DataPage({
  meta,
  onDataChanged,
}: {
  meta: Meta | null;
  onDataChanged?: () => void;
}) {
  const coverageState = useApi<Coverage>("/api/coverage");
  const importState = useApi<ImportStatus>("/api/import/status");
  const historyState = useApi<ImportHistory>("/api/import/history");
  const refreshState = useRefreshStatus();
  const refresh = refreshState.data;
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(isoToday);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // A later automatic success clears a stale manual-retry error.
  useEffect(() => {
    if (refresh?.lastSuccessAt) setRefreshError(null);
  }, [refresh?.lastSuccessAt]);

  // Reload the coverage and import tables when a background import finishes,
  // so this page does not keep showing the previous session until a reload.
  const lastSuccessRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const next = refresh?.lastSuccessAt ?? null;
    if (lastSuccessRef.current === undefined) {
      lastSuccessRef.current = next;
      return;
    }
    if (next && next !== lastSuccessRef.current) {
      coverageState.reload();
      importState.reload();
      historyState.reload();
    }
    lastSuccessRef.current = next;
  }, [
    refresh?.lastSuccessAt,
    coverageState.reload,
    importState.reload,
    historyState.reload,
  ]);

  const importStatus = importState.data;
  const history = historyState.data?.entries ?? [];

  async function copyPath() {
    if (!importStatus) return;
    try {
      await navigator.clipboard.writeText(importStatus.dataDir);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function triggerRefresh(force: boolean, details = false) {
    setTriggering(true);
    setRefreshError(null);
    try {
      await api("/api/refresh/run", {
        method: "POST",
        body: JSON.stringify({
          ...(force ? { force: true } : {}),
          ...(details ? { details: true } : {}),
        }),
      });
      refreshState.reload();
    } catch (cause) {
      setRefreshError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTriggering(false);
    }
  }

  async function runPreview() {
    setPreviewing(true);
    setError(null);
    setPreview(null);
    try {
      const response = await api<ImportPreview>(
        `/api/import/preview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      setPreview(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPreviewing(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await api<ImportResult>("/api/import/run", {
        method: "POST",
        body: JSON.stringify({ from, to }),
      });
      setResult(response);
      importState.reload();
      historyState.reload();
      onDataChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      historyState.reload();
    } finally {
      setBusy(false);
    }
  }

  if (!meta) {
    return <Spinner label="Loading data status" />;
  }

  const coverage = coverageState.data;

  return (
    <div className="stack">
      <div className="stats-row">
        <Stat
          label="Edition"
          value={meta.edition === "free" ? "Free" : "Licensed"}
        />
        <Stat label="Companies" value={meta.store.companies.toLocaleString()} />
        <Stat label="Candles" value={meta.store.candles.toLocaleString()} />
        <Stat label="Quotes" value={meta.store.quotes.toLocaleString()} hint="end-of-day closes" />
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

      <Card
        title="Automatic updates"
        subtitle="The app checks the public archive itself while it is open"
        action={
          refresh ? (
            <Badge
              tone={
                !refresh.enabled
                  ? "neutral"
                  : refresh.running
                    ? "info"
                    : refresh.lastError
                      ? "warn"
                      : "good"
              }
            >
              {!refresh.enabled
                ? "off"
                : refresh.running
                  ? "updating"
                  : refresh.lastError
                    ? "retrying"
                    : "on"}
            </Badge>
          ) : undefined
        }
      >
        {refreshState.loading && !refresh ? (
          <Spinner label="Reading update status" />
        ) : !refresh ? (
          <EmptyState title="Update status unavailable">
            {refreshState.error ?? "Check the local API."}
          </EmptyState>
        ) : (
          <>
            <p className="muted">
              On launch and every{" "}
              {refresh.intervalMinutes >= 60
                ? `${Math.round(refresh.intervalMinutes / 60)} hours`
                : `${refresh.intervalMinutes} minutes`}
              , the app checks the public archive for new end-of-day sessions,
              imports them into this database and keeps the raw snapshot. Your
              watchlist, portfolio and notes are never touched. The archive is
              unofficial, so imported rows stay labelled UNVERIFIED.
            </p>

            {refresh.running ? (
              <Notice tone="info">
                <strong>Updating:</strong> {refreshPhaseLabel(refresh.phase)}
                {refresh.lastProgress ? ` · ${refresh.lastProgress}` : "…"}
              </Notice>
            ) : refresh.lastError ? (
              <Notice tone="warn">
                <strong>Last automatic update failed.</strong>{" "}
                {refresh.lastError}
                {refresh.nextCheckAt && (
                  <> Next retry around {formatCheckTime(refresh.nextCheckAt)}.</>
                )}
              </Notice>
            ) : null}

            {!refresh.running &&
              !refresh.lastError &&
              refresh.lastResult?.cacheNote && (
                <Notice tone="info">{refresh.lastResult.cacheNote}</Notice>
              )}

            <div className="kv">
              <div>
                <span>Status</span>
                <strong>
                  {!refresh.enabled
                    ? "disabled"
                    : refresh.running
                      ? refreshPhaseLabel(refresh.phase)
                      : refresh.lastError
                        ? "waiting to retry"
                        : refresh.lastSuccessAt
                          ? "up to date"
                          : "waiting for first check"}
                </strong>
              </div>
              <div>
                <span>Last success</span>
                <strong>
                  {refresh.lastSuccessAt
                    ? refresh.lastSuccessAt.slice(0, 16).replace("T", " ")
                    : "not yet"}
                </strong>
              </div>
              <div>
                <span>Next check</span>
                <strong>
                  {refresh.enabled
                    ? formatCheckTime(refresh.nextCheckAt)
                    : "off"}
                </strong>
              </div>
              <div>
                <span>Latest session</span>
                <strong>
                  {refresh.latestSession ??
                    nptDate(meta.dataState.lastAsOf) ??
                    "—"}
                </strong>
              </div>
              <div>
                <span>Archive commit</span>
                <code>
                  {refresh.commit ? refresh.commit.slice(0, 10) : "—"}
                </code>
              </div>
              <div>
                <span>Profiles and fundamentals</span>
                <strong>
                  {refresh.detailsEnabled ? "included" : "not included"}
                </strong>
              </div>
            </div>

            {refresh.lastResult && (
              <p className="muted small">
                Last run imported{" "}
                {refresh.lastResult.companies.toLocaleString()} companies,{" "}
                {refresh.lastResult.candles.toLocaleString()} candles and{" "}
                {refresh.lastResult.quotes.toLocaleString()} quotes from session{" "}
                {refresh.lastResult.latestSession ?? "—"}
                {refresh.lastResult.warnings > 0
                  ? ` with ${refresh.lastResult.warnings} warning${
                      refresh.lastResult.warnings === 1 ? "" : "s"
                    }`
                  : ""}
                .
              </p>
            )}

            <div className="form-actions">
              <button
                className="button"
                disabled={!refresh.enabled || refresh.running || triggering}
                onClick={() => void triggerRefresh(false)}
              >
                {triggering || refresh.running
                  ? "Checking…"
                  : "Check for updates"}
              </button>
              <button
                className="button button-ghost"
                disabled={!refresh.enabled || refresh.running || triggering}
                onClick={() => void triggerRefresh(true)}
                title="Download the archive again even when the archive commit has not changed"
              >
                Re-download archive
              </button>
              <button
                className="button button-ghost"
                disabled={!refresh.enabled || refresh.running || triggering}
                onClick={() => void triggerRefresh(false, true)}
                title="Also fetch company profiles, fundamentals and company events from the public pages. This slower pass can take 10 to 25 minutes and keeps running in the background."
              >
                Fetch company profiles
              </button>
            </div>

            {refreshError && <p className="form-error">{refreshError}</p>}

            {!refresh.enabled && (
              <Notice tone="warn">
                {meta.edition === "free" ? (
                  <>
                    Automatic updates are off. Set{" "}
                    <code>NEPSE_AUTO_REFRESH=1</code> before launching the app to
                    turn them back on, or use the offline import below.
                  </>
                ) : (
                  <>
                    Automatic updates run in the Free Edition. This build is
                    running the Licensed edition, so background updates are off.
                    Use the offline import below, or launch a Free Edition build.
                  </>
                )}
              </Notice>
            )}

            <p className="muted small">
              Price history, index history, quotes, the latest floorsheet,
              corporate actions, news and IPOs refresh on every automatic run.
              Company profiles, fundamentals and company events use the slower
              details pass: use <strong>Fetch company profiles</strong> for a
              one-off run, or set <code>NEPSE_AUTO_DETAILS=1</code> to include
              it in every automatic check.
            </p>
          </>
        )}
      </Card>

      <Card
        title="Provider"
        subtitle="The product reads only the provider contract, never a vendor SDK"
        action={
          meta.provider ? (
            <DataStateBadge
              state={meta.dataState.state}
              classification={meta.dataState.classification}
              showClassification={false}
            />
          ) : undefined
        }
      >
        {meta.provider ? (
          <div className="kv">
            <div>
              <span>Name</span>
              <strong>{meta.provider.name}</strong>
            </div>
            <div>
              <span>Id</span>
              <code>{meta.provider.id}</code>
            </div>
            <div>
              <span>Source</span>
              <Badge tone="warn">{meta.provider.sourceType}</Badge>
            </div>
            <div>
              <span>Terms</span>
              <Badge tone="warn">{meta.provider.termsStatus}</Badge>
            </div>
            <div>
              <span>Classification</span>
              <Badge
                tone={
                  meta.dataState.classification === "VERIFIED" ? "good" : "warn"
                }
              >
                {meta.dataState.classification}
              </Badge>
            </div>
            <div>
              <span>Production ready</span>
              <Badge tone="bad">
                {meta.provider.productionReady ? "yes" : "no"}
              </Badge>
            </div>
            <div>
              <span>Reliability</span>
              <strong>{meta.provider.reliability}</strong>
            </div>
          </div>
        ) : (
          <EmptyState title="No provider configured">
            {meta.providerError ?? "Check your environment."}
          </EmptyState>
        )}
      </Card>

      <Card
        title="Dataset availability"
        subtitle="What is actually stored, separate from what the provider could read"
        action={
          coverage ? (
            <Badge tone="warn">{coverage.classification}</Badge>
          ) : undefined
        }
        footer={
          <>
            A capability the provider implements is not proof that data exists:
            this source publishes company profiles, displayed key ratios,
            corporate actions, the latest floorsheet, news, the IPO pipeline and
            mutual-fund NAVs, all labelled unverified. It publishes no free
            intraday history and no mutual-fund portfolio holdings, so those stay
            unavailable and are never filled with mock or inferred values.
            Indicators, breadth and sector heat elsewhere in the app are labelled{" "}
            <em>derived</em> mathematics on the stored end-of-day closes.
          </>
        }
      >
        {coverageState.loading ? (
          <Spinner />
        ) : !coverage ? (
          <EmptyState title="Coverage unavailable" />
        ) : coverage.datasets ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th>Stored</th>
                  <th>Session</th>
                  <th>Classification</th>
                  <th>Provider reads it</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {[...coverage.datasets]
                  .sort((a, b) => Number(b.available) - Number(a.available))
                  .map((dataset) => (
                    <tr key={dataset.capability}>
                      <td>
                        <strong>
                          {CAPABILITY_LABELS[dataset.capability] ?? dataset.capability}
                        </strong>
                      </td>
                      <td>
                        <Badge tone={dataset.available ? "good" : "neutral"}>
                          {dataset.available ? "available" : "unavailable"}
                        </Badge>
                      </td>
                      <td className="muted">
                        {dataset.session === "eod"
                          ? "end-of-day"
                          : dataset.session === "static"
                            ? "reference"
                            : "—"}
                      </td>
                      <td>
                        <Badge
                          tone={
                            dataset.classification === "DERIVED"
                              ? "info"
                              : dataset.classification === "MISSING"
                                ? "neutral"
                                : "warn"
                          }
                        >
                          {dataset.classification}
                        </Badge>
                      </td>
                      <td className="muted">{dataset.implemented ? "yes" : "no"}</td>
                      <td className="muted small">
                        {dataset.note ?? dataset.unavailableReason ?? ""}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="chips">
            {[...coverage.available, ...coverage.missing].map((capability) => {
              const available = coverage.available.includes(capability);
              return (
                <span
                  key={capability}
                  className={`chip ${available ? "chip-on" : "chip-off"}`}
                  title={
                    available
                      ? "Implemented by this provider; check the data panels for actual availability"
                      : "Not implemented by this provider"
                  }
                >
                  {CAPABILITY_LABELS[capability] ?? capability}
                </span>
              );
            })}
          </div>
        )}
      </Card>

      <Card
        title="Offline import (fallback)"
        subtitle="Only for CSV files you supply yourself; automatic updates cover normal use"
        action={
          <div className="card-actions">
            <Badge tone={importStatus?.canImport ? "good" : "warn"}>
              {importStatus?.canImport ? "free edition" : "import disabled"}
            </Badge>
            <button
              className="button button-ghost button-small"
              onClick={importState.reload}
            >
              Refresh
            </button>
          </div>
        }
      >
        {importState.loading ? (
          <Spinner label="Reading data directory" />
        ) : !importStatus ? (
          <EmptyState title="Import status unavailable">
            {importState.error ?? "Check the local API."}
          </EmptyState>
        ) : (
          <>
            <p className="muted">
              Automatic updates keep the database current from the public
              archive. Use this wizard only when you are offline or need to
              import operator-supplied CSVs. Put the files below in this folder
              and preview or run the import. Minimum useful set:{" "}
              <code>companies.csv</code> plus{" "}
              <code>ohlc/&lt;SYMBOL&gt;.csv</code>.
            </p>

            {!importStatus.ready && (
              <Notice tone="warn">
                Still missing:{" "}
                {importStatus.missing.map((item) => (
                  <code key={item}>{item}</code>
                ))}
                . Add those files to <code>{importStatus.dataDir}</code>, press{" "}
                <strong>Refresh</strong>, then run the import.
              </Notice>
            )}

            <div className="kv">
              <div>
                <span>Data directory</span>
                <code>{importStatus.dataDir}</code>
                <button
                  className="button button-ghost button-small"
                  onClick={() => void copyPath()}
                >
                  {copied ? "Copied" : "Copy path"}
                </button>
              </div>
              <div>
                <span>OHLC files</span>
                <strong>{importStatus.ohlc.length}</strong>
              </div>
              <div>
                <span>Index files</span>
                <strong>{importStatus.indices.length}</strong>
              </div>
              <div>
                <span>Last import</span>
                <strong>
                  {meta.store.lastFetchedAt
                    ? meta.store.lastFetchedAt.slice(0, 16).replace("T", " ")
                    : "never"}
                </strong>
              </div>
            </div>

            <div className="file-list">
              {importStatus.files.map((file) => (
                <div className="file-row" key={file.name}>
                  <span>
                    <code>{file.name}</code>
                    {file.required && <span className="req">required</span>}
                  </span>
                  <Badge
                    tone={
                      file.exists ? "good" : file.required ? "bad" : "neutral"
                    }
                  >
                    {file.exists
                      ? `${(file.bytes / 1024).toFixed(1)} KB`
                      : file.required
                        ? "missing"
                        : "optional"}
                  </Badge>
                </div>
              ))}
            </div>

            <p className="muted small">
              OHLC files detected:{" "}
              {importStatus.ohlc.length > 0
                ? importStatus.ohlc
                    .map((name) => name.replace(/\.csv$/i, ""))
                    .slice(0, 12)
                    .join(", ") +
                  (importStatus.ohlc.length > 12 ? " …" : "")
                : "none yet"}
            </p>

            <div className="form-grid import-run">
              <label>
                <span>History from</span>
                <input
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label>
                <span>History to</span>
                <input
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
              <div className="form-actions">
                <button
                  className="button button-ghost"
                  disabled={
                    busy ||
                    previewing ||
                    !importStatus.canImport ||
                    !importStatus.ready
                  }
                  onClick={() => void runPreview()}
                >
                  {previewing ? "Validating…" : "Preview (no writes)"}
                </button>
                <button
                  className="button"
                  disabled={
                    busy ||
                    previewing ||
                    !importStatus.canImport ||
                    !importStatus.ready
                  }
                  onClick={() => void runImport()}
                >
                  {busy ? "Importing…" : "Run import"}
                </button>
              </div>
            </div>

            <p className="muted small">
              Offline fallback only. Automatic updates are the normal path. This
              import reads files already in the folder above and never touches
              your watchlist, portfolio or notes.
            </p>

            {error && <p className="form-error">{error}</p>}

            {preview && (
              <Notice tone="info">
                <strong>Preview — nothing written.</strong>{" "}
                {preview.preview.companies} companies,{" "}
                {preview.preview.equitySeries} equity series,{" "}
                {preview.preview.candleRows} candles,{" "}
                {preview.preview.quotes} quotes.
                {preview.preview.gaps.length > 0 && (
                  <>
                    {" "}
                    {preview.preview.gaps.length} possible trading-day gap
                    {preview.preview.gaps.length === 1 ? "" : "s"} detected
                    (holidays unknown; nothing is filled).
                  </>
                )}
                {preview.preview.warnings.length > 0 && (
                  <ul className="limits">
                    {preview.preview.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </Notice>
            )}

            {result && (
              <Notice tone={result.result.status === "ok" ? "info" : "warn"}>
                Imported {result.result.companies} companies,{" "}
                {result.result.equitySeries} equity series,{" "}
                {result.result.candleRows} candles, {result.result.quotes}{" "}
                quotes.
                {result.result.failedSymbols.length > 0 && (
                  <> Skipped: {result.result.failedSymbols.join(", ")}.</>
                )}
                {result.result.gaps.length > 0 && (
                  <>
                    {" "}
                    {result.result.gaps.length} possible gap
                    {result.result.gaps.length === 1 ? "" : "s"} reported.
                  </>
                )}
                {result.result.warnings.length > 0 && (
                  <ul className="limits">
                    {result.result.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </Notice>
            )}
          </>
        )}
      </Card>

      <Card
        title="Import history"
        subtitle="Every run is logged with counts, warnings and failed symbols"
        action={
          <button
            className="button button-ghost button-small"
            onClick={historyState.reload}
          >
            Refresh
          </button>
        }
      >
        {historyState.loading ? (
          <Spinner label="Loading import history" />
        ) : history.length === 0 ? (
          <EmptyState title="No imports recorded yet" />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Status</th>
                  <th className="right">Companies</th>
                  <th className="right">Candles</th>
                  <th className="right">Quotes</th>
                  <th className="right">Failed</th>
                  <th>Warnings</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td className="muted">
                      {entry.startedAt.slice(0, 16).replace("T", " ")}
                    </td>
                    <td>
                      <Badge tone={statusTone(entry.status)}>
                        {entry.status}
                      </Badge>
                    </td>
                    <td className="right">
                      {entry.counts.companies ?? 0}
                    </td>
                    <td className="right">
                      {entry.counts.candleRows ?? 0}
                    </td>
                    <td className="right">{entry.counts.quotes ?? 0}</td>
                    <td className="right">
                      {entry.counts.failedSymbols ?? 0}
                    </td>
                    <td className="muted small">
                      {entry.warnings.length === 0
                        ? "—"
                        : `${entry.warnings.length} warning${entry.warnings.length === 1 ? "" : "s"}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Updating the archive"
        subtitle="Automatic by default; the manual pipeline remains for operators"
      >
        <p className="muted">
          The Free Edition reads an unofficial, community-maintained end-of-day
          archive. The app fetches it on launch and every few hours, keeps the
          raw snapshot, validates every row, and imports into the same namespace
          without deleting your watchlist or portfolio. If the archive has not
          changed, the check exits without downloading it again.
        </p>
        <p className="muted small">
          Last stored session: <strong>{nptDate(meta.dataState.lastAsOf) ?? "—"}</strong>{" "}
          ({describeAge(sessionAgeDays(meta.dataState.lastAsOf))}).
        </p>
        <details className="card-footer">
          <summary>Developer and operator commands</summary>
          <div className="card-footer-body">
            <p className="muted small">
              The desktop app uses the same pipeline as this command. Run it
              from the repository when you need a one-off refresh outside the
              app:
            </p>
            <div className="code-block">
              <div>{UPDATE_COMMAND}</div>
            </div>
            <p className="muted small">
              Other operator commands:
            </p>
            <div className="code-block">
              <div>pnpm personal:sync --data-dir {importStatus?.dataDir ?? "<data directory>"}</div>
              <div>pnpm personal:backup --out backup.db</div>
              <div>pnpm personal:restore --from backup.db --force</div>
            </div>
            <p className="muted small">
              Set <code>NEPSE_AUTO_REFRESH=0</code> to disable background checks,{" "}
              <code>NEPSE_AUTO_REFRESH_INTERVAL_MINUTES</code> to change the
              interval (minimum 15), and <code>NEPSE_AUTO_DETAILS=1</code> to
              include the slow company-profile and fundamentals pass.
            </p>
          </div>
        </details>
      </Card>

      <Card title="What the free edition cannot do" subtitle="Honest limits">
        <ul className="limits">
          <li>
            No verified multi-year fundamentals history; key ratios are the
            latest values the public pages display, not audited statements.
          </li>
          <li>
            No historical floorsheet or broker-flow archive: only the latest
            public trading day is stored, and broker flows are derived from it.
          </li>
          <li>
            No historical intraday archive: session-only intraday candles can be
            built from live snapshots while the app is open, but there is no
            free historical intraday history.
          </li>
          <li>
            No mutual-fund portfolio holdings; only the published NAV series.
          </li>
          <li>
            No corporate-action adjustment; long-window indicators are flagged.
          </li>
          <li>
            No delisted-securities history, so backtests are
            survivorship-biased.
          </li>
          <li>Free sources can change or disappear without notice.</li>
          <li>
            Redistribution rights for the public web sources are unverified; do
            not publish a database containing this data.
          </li>
        </ul>
        <p className="muted small">
          Switching to a licensed provider creates a new namespace in the same
          database. Existing free-source history is never overwritten.
        </p>
      </Card>
    </div>
  );
}

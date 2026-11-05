import { useState } from "react";
import { api } from "../api";
import { describeAge, nptDate, sessionAgeDays, UPDATE_COMMAND } from "../lib";
import { useApi } from "../hooks";
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
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(isoToday);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
            this source publishes no floorsheet, fundamentals, corporate actions,
            live quotes or sector sub-indices, so those stay unavailable and are
            never filled with mock or inferred values. Indicators, breadth and
            sector heat elsewhere in the app are labelled{" "}
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
        title="Import wizard"
        subtitle="The Free Edition reads operator-supplied CSV files from the local data directory"
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
              The app does not download data in the background. Put the CSV
              files below in this folder and preview or run the import. On the
              command line,{" "}
              <code>pnpm personal:update</code> explicitly fetches the public
              MIT-licensed archive and imports it. Minimum useful set:{" "}
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
              Prefer the CLI?{" "}
              <code>pnpm personal:sync --data-dir {importStatus.dataDir}</code>
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
        subtitle="There is no background fetch; refresh explicitly when you want newer sessions"
      >
        <p className="muted">
          The Free Edition reads an unofficial, community-maintained end-of-day
          archive. Updating re-fetches it, keeps the raw snapshot, validates
          every row, and imports into the same namespace without deleting your
          watchlist or portfolio.
        </p>
        <div className="code-block">
          <div>{UPDATE_COMMAND}</div>
        </div>
        <p className="muted small">
          Last stored session: <strong>{nptDate(meta.dataState.lastAsOf) ?? "—"}</strong>{" "}
          ({describeAge(sessionAgeDays(meta.dataState.lastAsOf))}).
        </p>
      </Card>

      <Card title="What the free edition cannot do" subtitle="Honest limits">
        <ul className="limits">
          <li>No five-year fundamentals history or valuation screens.</li>
          <li>No historical floorsheet or broker-flow analytics.</li>
          <li>
            No market-wide transactions/scrips totals or official sector
            sub-indices. Market turnover is shown only because the archive’s
            NEPSE index file reports it; the sector heatmap is an
            equal-weighted average, clearly labelled derived.
          </li>
          <li>No live or intraday prices: every price is an end-of-day close.</li>
          <li>
            No corporate-action adjustment; long-window indicators are flagged.
          </li>
          <li>
            No delisted-securities history, so backtests are
            survivorship-biased.
          </li>
          <li>Free sources can change or disappear without notice.</li>
        </ul>
        <p className="muted small">
          Switching to a licensed provider creates a new namespace in the same
          database. Existing free-source history is never overwritten.
        </p>
      </Card>
    </div>
  );
}

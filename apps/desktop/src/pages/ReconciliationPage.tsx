import { useMemo, useState, type FormEvent } from "react";
import { api, formatNumber } from "../api";
import { useApi } from "../hooks";
import type {
  CorporateLedgerEntry,
  CorporateLedgerResponse,
  ReconciliationImportResult,
  ReconciliationSummary,
} from "../types";
import {
  Badge,
  Card,
  EmptyState,
  MiniStats,
  Notice,
  Spinner,
  Stat,
  toneOf,
} from "../components/ui";

function parseNumber(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "—";
}

/**
 * XIRR is returned by the local API as a fraction (0.12 means 12%). Null means
 * the cash flows cannot be annualised (too short, no sign change, or outside
 * the solver range), so it is shown as text, never as 0.
 */
function xirrPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return value * 100;
}

export function ReconciliationPage() {
  const summaryState = useApi<ReconciliationSummary>("/api/reconciliation/summary");

  const [source, setSource] = useState("CDSC");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [importResult, setImportResult] = useState<ReconciliationImportResult | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [ledgerSymbol, setLedgerSymbol] = useState("");
  const ledgerPath = useMemo(() => {
    const symbol = ledgerSymbol.trim().toUpperCase();
    return symbol
      ? `/api/corporate-ledger?symbol=${encodeURIComponent(symbol)}`
      : "/api/corporate-ledger";
  }, [ledgerSymbol]);
  const ledgerState = useApi<CorporateLedgerResponse>(ledgerPath);

  const [ledgerSymbolInput, setLedgerSymbolInput] = useState("");
  const [kind, setKind] = useState<"dividend" | "bonus" | "right">("dividend");
  const [exDate, setExDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState("");
  const [notes, setNotes] = useState("");
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  const summary = summaryState.data;
  const exposure = summary?.exposure ?? [];
  const imports = summary?.imports ?? [];
  const ledgerEntries = ledgerState.data?.entries ?? [];
  const concentration = summary?.concentration;

  const exposureRows = useMemo(
    () => [...exposure].sort((a, b) => b.percent - a.percent),
    [exposure],
  );

  const xirr = xirrPercent(summary?.xirr);
  const effectivePositions =
    concentration && concentration.hhi > 0 ? 1 / concentration.hhi : null;

  async function runImport(event: FormEvent) {
    event.preventDefault();
    setImportError(null);
    setImportResult(null);
    if (!file) {
      setImportError("Choose a broker or CDSC CSV file first.");
      return;
    }
    setImporting(true);
    try {
      const csv = await file.text();
      const result = await api<ReconciliationImportResult>(
        "/api/reconciliation/import",
        {
          method: "POST",
          body: JSON.stringify({
            source: source.trim() || "broker",
            csv,
          }),
        },
      );
      setImportResult(result);
      setFile(null);
      setFileKey((value) => value + 1);
      summaryState.reload();
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(false);
    }
  }

  async function addLedgerEntry(event: FormEvent) {
    event.preventDefault();
    setLedgerError(null);
    const symbol = ledgerSymbolInput.trim().toUpperCase();
    if (!symbol) {
      setLedgerError("Enter a symbol.");
      return;
    }
    setLedgerBusy(true);
    try {
      await api("/api/corporate-ledger", {
        method: "POST",
        body: JSON.stringify({
          symbol,
          kind,
          exDate: exDate || null,
          amount: parseNumber(amount),
          shares: parseNumber(shares),
          notes: notes.trim() || null,
        }),
      });
      setAmount("");
      setShares("");
      setNotes("");
      ledgerState.reload();
      summaryState.reload();
    } catch (cause) {
      setLedgerError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLedgerBusy(false);
    }
  }

  async function deleteLedgerEntry(id: number) {
    setLedgerBusy(true);
    setLedgerError(null);
    try {
      await api(`/api/corporate-ledger/${id}`, { method: "DELETE" });
      ledgerState.reload();
      summaryState.reload();
    } catch (cause) {
      setLedgerError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLedgerBusy(false);
    }
  }

  if (summaryState.loading && !summary) {
    return <Spinner label="Loading reconciliation summary" />;
  }

  if (summaryState.error && !summary) {
    return (
      <EmptyState title="Could not load the reconciliation summary">
        {summaryState.error}
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <Notice>
        Reconciliation reads a broker or CDSC CSV in the browser and posts its
        text to the local API. Nothing is uploaded to a remote service. Figures
        are only as good as the exported file; check the period and columns
        before importing.
      </Notice>

      <div className="stats-row">
        <Stat
          label="Realised P&L"
          value={formatNumber(summary?.realizedPnl)}
          tone={toneOf(summary?.realizedPnl ?? null)}
        />
        <Stat
          label="Unrealised P&L"
          value={formatNumber(summary?.unrealizedPnl)}
          tone={toneOf(summary?.unrealizedPnl ?? null)}
        />
        <Stat
          label="Total P&L"
          value={formatNumber(summary?.totalPnl)}
          tone={toneOf(summary?.totalPnl ?? null)}
        />
        <Stat
          label="XIRR"
          value={
            xirr === null ? (
              <span className="stat-text">Not available</span>
            ) : (
              `${formatNumber(xirr)}%`
            )
          }
          hint={
            xirr === null
              ? "needs a longer cash-flow history or no solution"
              : "annualised"
          }
        />
        <Stat
          label="Dividends received"
          value={formatNumber(summary?.dividends)}
          hint={`${formatNumber(summary?.bonusShares, 0)} bonus · ${formatNumber(
            summary?.rightsShares,
            0,
          )} rights`}
        />
      </div>

      <div className="grid two">
        <Card
          title="Import a broker / CDSC CSV"
          subtitle="The file is read locally and sent as text to /api/reconciliation/import"
        >
          <form className="stack" onSubmit={(event) => void runImport(event)}>
            <div className="form-grid">
              <label>
                <span>Source</span>
                <input
                  value={source}
                  autoComplete="off"
                  placeholder="CDSC or broker name"
                  onChange={(event) => setSource(event.target.value)}
                />
              </label>
              <label>
                <span>CSV file</span>
                <input
                  key={fileKey}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) =>
                    setFile(event.target.files?.[0] ?? null)
                  }
                />
                {file && (
                  <span className="cell-sub">
                    {file.name} · {(file.size / 1024).toFixed(1)} KB
                  </span>
                )}
              </label>
            </div>
            <div className="form-actions">
              <button className="button" type="submit" disabled={importing || !file}>
                {importing ? "Importing…" : "Import CSV"}
              </button>
              <button
                type="button"
                className="button button-ghost"
                disabled={importing}
                onClick={() => {
                  setFile(null);
                  setFileKey((value) => value + 1);
                  setImportResult(null);
                  setImportError(null);
                }}
              >
                Clear
              </button>
            </div>
            {importError && <p className="form-error">{importError}</p>}
            {importResult && (
              <Notice tone="info">
                Imported <strong>{importResult.imported}</strong> row
                {importResult.imported === 1 ? "" : "s"} and skipped{" "}
                <strong>{importResult.skipped}</strong>.
                {importResult.importId !== null && (
                  <> Import #{importResult.importId}.</>
                )}
              </Notice>
            )}
            <p className="muted small">
              Expected columns: <code>symbol</code>, <code>side</code>,{" "}
              <code>quantity</code>, <code>price</code>,{" "}
              <code>traded_at</code> and optional <code>fees</code>. A row the
              importer cannot parse fails the whole import, so fix the layout
              and retry; nothing is guessed. A skipped count above zero means
              the row&apos;s <code>external_id</code> was already imported.
            </p>
          </form>
        </Card>

        <Card
          title="Concentration"
          subtitle="Share of priced exposure by market value"
          action={
            summary ? <Badge tone="info">derived</Badge> : undefined
          }
        >
          {concentration ? (
            <>
              <MiniStats
                items={[
                  {
                    label: "Top symbol",
                    value: concentration.topSymbol ?? "—",
                    hint: `${formatNumber(concentration.topPercent)}%`,
                  },
                  {
                    label: "Top weight",
                    value: `${formatNumber(concentration.topPercent)}%`,
                  },
                  {
                    label: "HHI",
                    value: formatNumber(concentration.hhi, 4),
                    hint: "sum of squared weights",
                  },
                  {
                    label: "Effective positions",
                    value:
                      effectivePositions === null
                        ? "—"
                        : formatNumber(effectivePositions, 1),
                    hint: "1 ÷ HHI",
                  },
                ]}
              />
              <p className="muted small">
                A higher HHI means more concentration. The effective position
                count is the number of equally sized holdings that would give the
                same concentration.
              </p>
            </>
          ) : (
            <EmptyState title="No exposure yet">
              Import a holdings file or record transactions to see
              concentration.
            </EmptyState>
          )}
        </Card>
      </div>

      <Card
        title="Exposure"
        subtitle={`${exposureRows.length} priced position${
          exposureRows.length === 1 ? "" : "s"
        }`}
        action={
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={summaryState.reload}
          >
            Refresh
          </button>
        }
      >
        {exposureRows.length === 0 ? (
          <EmptyState title="No exposure to show" />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="right">Market value</th>
                  <th className="right">Weight</th>
                </tr>
              </thead>
              <tbody>
                {exposureRows.map((row) => (
                  <tr key={row.symbol}>
                    <td>
                      <strong>{row.symbol}</strong>
                    </td>
                    <td className="right">{formatNumber(row.marketValue)}</td>
                    <td className="right">{formatNumber(row.percent)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Recent imports"
        subtitle="What the reconciliation ledger last received"
      >
        {imports.length === 0 ? (
          <EmptyState title="No imports recorded" />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Imported at</th>
                  <th className="right">Rows</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.source}</td>
                    <td className="muted small">{formatDate(entry.importedAt)}</td>
                    <td className="right">{formatNumber(entry.rowsCount, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Corporate ledger"
        subtitle="Dividends, bonus shares and rights recorded as events"
        action={
          <div className="card-actions">
            <input
              type="search"
              placeholder="Filter symbol"
              aria-label="Filter corporate ledger by symbol"
              value={ledgerSymbol}
              onChange={(event) => setLedgerSymbol(event.target.value.toUpperCase())}
            />
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={ledgerState.reload}
            >
              Refresh
            </button>
          </div>
        }
        footer={
          <>
            Bonus and right entries are recorded as events. They do not silently
            change share quantities in the portfolio. When the shares are
            actually credited, record the resulting quantity explicitly so the
            cost basis stays under your control.
          </>
        }
      >
        <form className="stack" onSubmit={(event) => void addLedgerEntry(event)}>
          <div className="form-grid">
            <label>
              <span>Symbol</span>
              <input
                value={ledgerSymbolInput}
                required
                autoComplete="off"
                placeholder="NABIL"
                onChange={(event) =>
                  setLedgerSymbolInput(event.target.value.toUpperCase())
                }
              />
            </label>
            <label>
              <span>Kind</span>
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as "dividend" | "bonus" | "right")
                }
              >
                <option value="dividend">Cash dividend</option>
                <option value="bonus">Bonus shares</option>
                <option value="right">Rights</option>
              </select>
            </label>
            <label>
              <span>Ex date</span>
              <input
                type="date"
                value={exDate}
                onChange={(event) => setExDate(event.target.value)}
              />
            </label>
            <label>
              <span>Amount (NPR, optional)</span>
              <input
                value={amount}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label>
              <span>Shares (optional)</span>
              <input
                value={shares}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => setShares(event.target.value)}
              />
            </label>
            <label className="span-full">
              <span>Notes</span>
              <input
                value={notes}
                autoComplete="off"
                placeholder="Optional"
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
          </div>
          {ledgerError && <p className="form-error">{ledgerError}</p>}
          <div className="form-actions">
            <button className="button" type="submit" disabled={ledgerBusy}>
              {ledgerBusy ? "Saving…" : "Add ledger entry"}
            </button>
          </div>
        </form>

        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Kind</th>
                <th>Ex date</th>
                <th className="right">Amount</th>
                <th className="right">Shares</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ledgerState.loading && !ledgerState.data ? (
                <tr>
                  <td colSpan={7}>
                    <Spinner label="Loading corporate ledger" />
                  </td>
                </tr>
              ) : ledgerState.error ? (
                <tr>
                  <td colSpan={7} className="form-error">
                    {ledgerState.error}
                  </td>
                </tr>
              ) : ledgerEntries.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <span className="muted small">
                      No corporate events recorded.
                    </span>
                  </td>
                </tr>
              ) : (
                ledgerEntries.map((entry: CorporateLedgerEntry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.symbol}</strong>
                    </td>
                    <td>
                      <Badge
                        tone={
                          entry.kind === "dividend"
                            ? "good"
                            : entry.kind === "bonus"
                              ? "info"
                              : "warn"
                        }
                      >
                        {entry.kind}
                      </Badge>
                    </td>
                    <td className="muted small">{formatDate(entry.exDate)}</td>
                    <td className="right">{formatNumber(entry.amount)}</td>
                    <td className="right">{formatNumber(entry.shares, 2)}</td>
                    <td className="muted small">{entry.notes ?? ""}</td>
                    <td className="right">
                      <button
                        type="button"
                        className="button button-ghost button-small"
                        disabled={ledgerBusy}
                        onClick={() => void deleteLedgerEntry(entry.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Bonus and rights are events, not silent quantity edits: record the
          shares when they are credited so the ledger change is explicit.
        </p>
      </Card>
    </div>
  );
}

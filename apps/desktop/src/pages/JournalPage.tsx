import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, formatNumber } from "../api";
import { useApi } from "../hooks";
import type {
  JournalEntry,
  JournalResponse,
  TradePlan,
  TradePlansResponse,
  TradeSide,
} from "../types";
import {
  Badge,
  Card,
  EmptyState,
  MiniStats,
  Notice,
  Segmented,
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

/** Inclusive first and last calendar day of a `YYYY-MM` month input. */
function monthBounds(month: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1] ?? "");
  const mon = Number(match[2] ?? "");
  if (!Number.isInteger(year) || !Number.isInteger(mon) || mon < 1 || mon > 12) {
    return null;
  }
  const lastDay = new Date(year, mon, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function monthOf(entry: JournalEntry): string {
  const value = entry.openedAt ?? entry.createdAt;
  return value ? value.slice(0, 7) : "";
}

function formatDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "—";
}

function tagsOf(entry: JournalEntry): string[] {
  return Array.isArray(entry.tags) ? entry.tags : [];
}

/** Realised P&L. A null exit is always pending, whatever the API stored. */
function entryPnl(entry: JournalEntry): number | null {
  if (entry.actualExit === null || entry.actualExit === undefined) return null;
  if (entry.pnl !== null && entry.pnl !== undefined) return entry.pnl;
  if (
    entry.actualEntry === null ||
    entry.actualEntry === undefined ||
    entry.quantity === null ||
    entry.quantity === undefined
  ) {
    return null;
  }
  const gross =
    (entry.side === "buy"
      ? entry.actualExit - entry.actualEntry
      : entry.actualEntry - entry.actualExit) * entry.quantity;
  return gross - (entry.fees ?? 0);
}

/** R multiple against the planned per-share risk. */
function entryR(entry: JournalEntry, pnl: number | null): number | null {
  if (
    pnl === null ||
    entry.plannedEntry === null ||
    entry.plannedEntry === undefined ||
    entry.plannedStop === null ||
    entry.plannedStop === undefined ||
    entry.quantity === null ||
    entry.quantity === undefined
  ) {
    return null;
  }
  const plannedRisk =
    Math.abs(entry.plannedEntry - entry.plannedStop) * entry.quantity;
  return plannedRisk > 0 ? pnl / plannedRisk : null;
}

interface Draft {
  planId: string;
  symbol: string;
  side: TradeSide;
  paper: boolean;
  plannedEntry: string;
  plannedStop: string;
  plannedTarget: string;
  actualEntry: string;
  actualExit: string;
  quantity: string;
  fees: string;
  reason: string;
  mistakes: string;
  tags: string;
  snapshot: string;
  openedAt: string;
  closedAt: string;
}

/** Written by the company page when the user clicks "Snap". */
const PENDING_SNAPSHOT_KEY = "nepse.journal.pendingSnapshot";

interface PendingSnapshot {
  symbol?: string;
  image?: string;
  capturedAt?: string;
}

function emptyDraft(): Draft {
  return {
    planId: "",
    symbol: "",
    side: "buy",
    paper: true,
    plannedEntry: "",
    plannedStop: "",
    plannedTarget: "",
    actualEntry: "",
    actualExit: "",
    quantity: "",
    fees: "",
    reason: "",
    mistakes: "",
    tags: "",
    snapshot: "",
    openedAt: todayIso(),
    closedAt: "",
  };
}

export function JournalPage() {
  const plansState = useApi<TradePlansResponse>("/api/trade-plans");
  const plans = plansState.data?.plans ?? [];

  const [filterSymbol, setFilterSymbol] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterPaper, setFilterPaper] = useState<"all" | "paper" | "real">("all");

  const journalPath = useMemo(() => {
    const params = new URLSearchParams();
    // The API matches `symbol` exactly, so passing the search box here would
    // empty the list as soon as a prefix is typed. The substring filter below
    // narrows the fetched rows instead.
    const bounds = monthBounds(filterMonth);
    if (bounds) {
      params.set("from", bounds.from);
      params.set("to", bounds.to);
    }
    const query = params.toString();
    return `/api/journal${query ? `?${query}` : ""}`;
  }, [filterMonth]);

  const journalState = useApi<JournalResponse>(journalPath);
  const entries = useMemo(
    () => journalState.data?.entries ?? [],
    [journalState.data],
  );

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotImage, setSnapshotImage] = useState<string | null>(null);
  const [existingSnapshotUrl, setExistingSnapshotUrl] = useState<string | null>(
    null,
  );
  const [snapshotRemoved, setSnapshotRemoved] = useState(false);

  const snapshotPreview = snapshotImage ?? existingSnapshotUrl;

  // A chart "Snap" navigates here with the image in sessionStorage. Read it
  // once, clear the key, and prefill the form.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(PENDING_SNAPSHOT_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    try {
      window.sessionStorage.removeItem(PENDING_SNAPSHOT_KEY);
    } catch {
      // Ignore storage failures; the form still works without the image.
    }
    try {
      const pending = JSON.parse(raw) as PendingSnapshot;
      if (
        typeof pending.image !== "string" ||
        !pending.image.startsWith("data:image/")
      ) {
        return;
      }
      setSnapshotImage(pending.image);
      setExistingSnapshotUrl(null);
      setSnapshotRemoved(false);
      if (typeof pending.symbol === "string" && pending.symbol.trim()) {
        const symbol = pending.symbol.trim().toUpperCase();
        setDraft((current) => ({ ...current, symbol }));
      }
    } catch {
      // Ignore malformed pending data.
    }
  }, []);

  const update = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entries) {
      for (const tag of tagsOf(entry)) set.add(tag);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const filtered = useMemo(() => {
    const needle = filterSymbol.trim().toUpperCase();
    const bounds = monthBounds(filterMonth);
    return entries
      .filter((entry) => {
        if (needle && !entry.symbol.toUpperCase().includes(needle)) return false;
        if (bounds && monthOf(entry) !== filterMonth) return false;
        if (filterTag && !tagsOf(entry).includes(filterTag)) return false;
        if (filterPaper === "paper" && !entry.paper) return false;
        if (filterPaper === "real" && entry.paper) return false;
        return true;
      })
      .sort((a, b) => {
        const left = a.openedAt ?? a.createdAt;
        const right = b.openedAt ?? b.createdAt;
        return right.localeCompare(left);
      });
  }, [entries, filterSymbol, filterMonth, filterTag, filterPaper]);

  const reviews = useMemo(() => {
    const closed = filtered.filter(
      (entry) => entry.actualExit !== null && entry.actualExit !== undefined,
    );
    const pnls = closed
      .map(entryPnl)
      .filter((value): value is number => value !== null);
    const wins = pnls.filter((value) => value > 0).length;
    const losses = pnls.filter((value) => value < 0).length;
    const decided = wins + losses;
    const rs = closed
      .map((entry) => entryR(entry, entryPnl(entry)))
      .filter((value): value is number => value !== null);
    return {
      trades: filtered.length,
      closed: closed.length,
      wins,
      losses,
      winRate: decided > 0 ? (wins / decided) * 100 : null,
      netPnl: pnls.length > 0 ? pnls.reduce((sum, value) => sum + value, 0) : null,
      avgR: rs.length > 0 ? rs.reduce((sum, value) => sum + value, 0) / rs.length : null,
    };
  }, [filtered]);

  const actualEntry = parseNumber(draft.actualEntry);
  const actualExit = parseNumber(draft.actualExit);
  const quantity = parseNumber(draft.quantity);
  const fees = parseNumber(draft.fees) ?? 0;
  const pending = actualExit === null;
  const previewPnl =
    !pending && actualEntry !== null && actualExit !== null && quantity !== null && quantity > 0
      ? (draft.side === "buy"
          ? actualExit - actualEntry
          : actualEntry - actualExit) * quantity - fees
      : null;
  const plannedEntry = parseNumber(draft.plannedEntry);
  const plannedStop = parseNumber(draft.plannedStop);
  const plannedRisk =
    plannedEntry !== null && plannedStop !== null && quantity !== null
      ? Math.abs(plannedEntry - plannedStop) * quantity
      : null;
  const previewR =
    previewPnl !== null && plannedRisk !== null && plannedRisk > 0
      ? previewPnl / plannedRisk
      : null;

  function resetForm() {
    setDraft(emptyDraft());
    setEditingId(null);
    setError(null);
    setSnapshotImage(null);
    setExistingSnapshotUrl(null);
    setSnapshotRemoved(false);
  }

  function removeSnapshot() {
    setSnapshotImage(null);
    setExistingSnapshotUrl(null);
    setSnapshotRemoved(true);
  }

  function applyPlan(id: string) {
    if (!id) {
      update({ planId: "" });
      return;
    }
    const plan: TradePlan | undefined = plans.find(
      (item) => item.id === Number(id),
    );
    if (!plan) {
      update({ planId: id });
      return;
    }
    update({
      planId: id,
      symbol: plan.symbol,
      side: plan.side,
      plannedEntry: String(plan.entry),
      plannedStop: String(plan.stop),
      plannedTarget: plan.targets[0] === undefined ? "" : String(plan.targets[0]),
      quantity: plan.quantity ? String(plan.quantity) : draft.quantity,
    });
  }

  function loadEntry(entry: JournalEntry) {
    setEditingId(entry.id);
    setError(null);
    setSnapshotImage(null);
    setExistingSnapshotUrl(
      entry.snapshotUrl ??
        (entry.hasSnapshot ? `/api/journal/${entry.id}/snapshot` : null),
    );
    setSnapshotRemoved(false);
    setDraft({
      planId: entry.planId === null ? "" : String(entry.planId),
      symbol: entry.symbol,
      side: entry.side,
      paper: entry.paper,
      plannedEntry: entry.plannedEntry === null ? "" : String(entry.plannedEntry),
      plannedStop: entry.plannedStop === null ? "" : String(entry.plannedStop),
      plannedTarget: entry.plannedTarget === null ? "" : String(entry.plannedTarget),
      actualEntry: entry.actualEntry === null ? "" : String(entry.actualEntry),
      actualExit: entry.actualExit === null ? "" : String(entry.actualExit),
      quantity: entry.quantity === null ? "" : String(entry.quantity),
      fees: entry.fees === null ? "" : String(entry.fees),
      reason: entry.reason ?? "",
      mistakes: entry.mistakes ?? "",
      tags: tagsOf(entry).join(", "),
      snapshot:
        typeof entry.snapshot === "string"
          ? entry.snapshot
          : entry.snapshot === null || entry.snapshot === undefined
            ? ""
            : JSON.stringify(entry.snapshot),
      openedAt: entry.openedAt ? entry.openedAt.slice(0, 10) : "",
      closedAt: entry.closedAt ? entry.closedAt.slice(0, 10) : "",
    });
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const symbol = draft.symbol.trim().toUpperCase();
    if (!symbol) {
      setError("Enter a symbol.");
      return;
    }
    if (quantity !== null && quantity <= 0) {
      setError("Quantity must be above zero when provided.");
      return;
    }
    setBusy(true);
    try {
      const tags = draft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const body: Record<string, unknown> = {
        planId: draft.planId ? Number(draft.planId) : null,
        symbol,
        side: draft.side,
        paper: draft.paper,
        plannedEntry,
        plannedStop,
        plannedTarget: parseNumber(draft.plannedTarget),
        actualEntry,
        actualExit,
        quantity,
        fees,
        reason: draft.reason.trim() || null,
        mistakes: draft.mistakes.trim() || null,
        tags,
        snapshot: draft.snapshot.trim() || null,
        openedAt: draft.openedAt || null,
        closedAt: draft.closedAt || null,
      };
      // Omit the field to keep an existing image; null removes it; a data URL
      // replaces it. New entries simply include it when attached.
      if (snapshotImage) {
        body.snapshotImage = snapshotImage;
      } else if (editingId !== null && snapshotRemoved) {
        body.snapshotImage = null;
      }
      if (editingId === null) {
        await api("/api/journal", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else {
        await api(`/api/journal/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      journalState.reload();
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntry(id: number) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/journal/${id}`, { method: "DELETE" });
      journalState.reload();
      if (editingId === id) resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const reviewLabel = filterMonth
    ? filterMonth
    : filterTag
      ? `tag: ${filterTag}`
      : "all filtered entries";

  return (
    <div className="stack">
      <Notice>
        Journal entries are your own record. P&L is computed only after an
        actual exit is entered; an open trade stays pending. Paper trades are
        kept separate from real ones by the flag.
      </Notice>

      <Card
        title={editingId === null ? "New journal entry" : `Edit entry #${editingId}`}
        subtitle="Link a saved plan to compare the plan with what actually happened"
        action={
          editingId !== null ? (
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={resetForm}
            >
              Cancel edit
            </button>
          ) : undefined
        }
      >
        <form className="stack" onSubmit={(event) => void saveEntry(event)}>
          <div className="form-grid">
            <label>
              <span>Linked plan (optional)</span>
              <select
                value={draft.planId}
                onChange={(event) => applyPlan(event.target.value)}
              >
                <option value="">No linked plan</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    #{plan.id} {plan.symbol} {plan.side} {formatNumber(plan.entry)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Symbol</span>
              <input
                value={draft.symbol}
                required
                autoComplete="off"
                placeholder="NABIL"
                onChange={(event) =>
                  update({ symbol: event.target.value.toUpperCase() })
                }
              />
            </label>
            <div className="field-group">
              <span>Side</span>
              <Segmented
                value={draft.side}
                onChange={(side) => update({ side })}
                items={[
                  { value: "buy", label: "Buy" },
                  { value: "sell", label: "Sell" },
                ]}
                label="Entry side"
              />
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.paper}
                onChange={(event) => update({ paper: event.target.checked })}
              />
              <span>Paper trade</span>
            </label>
            <label>
              <span>Planned entry</span>
              <input
                value={draft.plannedEntry}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => update({ plannedEntry: event.target.value })}
              />
            </label>
            <label>
              <span>Planned stop</span>
              <input
                value={draft.plannedStop}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => update({ plannedStop: event.target.value })}
              />
            </label>
            <label>
              <span>Planned target</span>
              <input
                value={draft.plannedTarget}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => update({ plannedTarget: event.target.value })}
              />
            </label>
            <label>
              <span>Actual entry</span>
              <input
                value={draft.actualEntry}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => update({ actualEntry: event.target.value })}
              />
            </label>
            <label>
              <span>Actual exit</span>
              <input
                value={draft.actualExit}
                inputMode="decimal"
                autoComplete="off"
                placeholder="Leave blank while open"
                onChange={(event) => update({ actualExit: event.target.value })}
              />
            </label>
            <label>
              <span>Quantity</span>
              <input
                value={draft.quantity}
                inputMode="numeric"
                autoComplete="off"
                onChange={(event) => update({ quantity: event.target.value })}
              />
            </label>
            <label>
              <span>Fees (NPR)</span>
              <input
                value={draft.fees}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                onChange={(event) => update({ fees: event.target.value })}
              />
            </label>
            <label>
              <span>Opened</span>
              <input
                type="date"
                value={draft.openedAt}
                onChange={(event) => update({ openedAt: event.target.value })}
              />
            </label>
            <label>
              <span>Closed</span>
              <input
                type="date"
                value={draft.closedAt}
                onChange={(event) => update({ closedAt: event.target.value })}
              />
            </label>
            <label>
              <span>Tags (comma separated)</span>
              <input
                value={draft.tags}
                autoComplete="off"
                placeholder="breakout, earnings"
                onChange={(event) => update({ tags: event.target.value })}
              />
            </label>
            <label className="span-full">
              <span>Reason</span>
              <textarea
                value={draft.reason}
                rows={2}
                placeholder="Why this trade"
                onChange={(event) => update({ reason: event.target.value })}
              />
            </label>
            <label className="span-full">
              <span>Mistakes</span>
              <textarea
                value={draft.mistakes}
                rows={2}
                placeholder="What to do differently"
                onChange={(event) => update({ mistakes: event.target.value })}
              />
            </label>
            <label className="span-full">
              <span>Snapshot note</span>
              <textarea
                value={draft.snapshot}
                rows={2}
                placeholder="Short note about the setup at entry"
                onChange={(event) => update({ snapshot: event.target.value })}
              />
            </label>
            <div className="field-group span-full">
              <span>Chart snapshot</span>
              {snapshotPreview ? (
                <div className="snapshot-preview">
                  <img
                    src={snapshotPreview}
                    alt={`Chart snapshot for ${draft.symbol || "this entry"}`}
                  />
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={removeSnapshot}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <p className="muted small snapshot-empty">
                  Open a company chart and click Snap to attach it here.
                </p>
              )}
            </div>
          </div>

          <MiniStats
            items={[
              {
                label: pending ? "P&L" : "Realised P&L",
                value: pending ? "Pending" : formatNumber(previewPnl),
                tone: previewPnl === null ? undefined : toneOf(previewPnl),
                hint: pending ? "no actual exit yet" : undefined,
              },
              {
                label: "R multiple",
                value: previewR === null ? "—" : `${formatNumber(previewR)}R`,
                hint: plannedRisk === null ? "needs planned risk" : undefined,
              },
              {
                label: "Planned risk",
                value: formatNumber(plannedRisk),
                hint: "|entry − stop| × quantity",
              },
              {
                label: "Exit",
                value: pending ? "—" : formatNumber(actualExit),
                hint: pending ? "pending" : "actual",
              },
            ]}
          />

          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button className="button" type="submit" disabled={busy}>
              {busy
                ? "Saving…"
                : editingId === null
                  ? "Add entry"
                  : "Update entry"}
            </button>
            <button
              type="button"
              className="button button-ghost"
              disabled={busy}
              onClick={resetForm}
            >
              Clear
            </button>
          </div>
        </form>
      </Card>

      <Card
        title="Monthly review"
        subtitle={reviewLabel}
        action={<Badge tone="info">closed trades only for win rate and R</Badge>}
      >
        <div className="stats-row">
          <Stat label="Trades" value={reviews.trades} hint={`${reviews.closed} closed`} />
          <Stat label="Wins" value={reviews.wins} tone={reviews.wins > 0 ? "up" : undefined} />
          <Stat label="Losses" value={reviews.losses} tone={reviews.losses > 0 ? "down" : undefined} />
          <Stat
            label="Win rate"
            value={reviews.winRate === null ? "—" : `${formatNumber(reviews.winRate, 1)}%`}
            hint="wins ÷ decided"
          />
          <Stat
            label="Net P&L"
            value={formatNumber(reviews.netPnl)}
            tone={reviews.netPnl === null ? undefined : toneOf(reviews.netPnl)}
          />
          <Stat
            label="Average R"
            value={reviews.avgR === null ? "—" : `${formatNumber(reviews.avgR)}R`}
            tone={reviews.avgR === null ? undefined : toneOf(reviews.avgR)}
          />
        </div>
        <p className="muted small">
          Pending trades are counted in trades but excluded from wins, losses and
          average R until an actual exit is recorded.
        </p>
      </Card>

      <Card
        title="Journal"
        subtitle={`${filtered.length} entr${filtered.length === 1 ? "y" : "ies"}`}
        action={
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={journalState.reload}
          >
            Refresh
          </button>
        }
      >
        <div className="filters" style={{ marginBottom: 12 }}>
          <label>
            <span>Symbol</span>
            <input
              type="search"
              value={filterSymbol}
              placeholder="All"
              onChange={(event) => setFilterSymbol(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            <span>Month</span>
            <input
              type="month"
              value={filterMonth}
              onChange={(event) => setFilterMonth(event.target.value)}
            />
          </label>
          <label>
            <span>Tag</span>
            <select
              value={filterTag}
              onChange={(event) => setFilterTag(event.target.value)}
            >
              <option value="">All tags</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Type</span>
            <select
              value={filterPaper}
              onChange={(event) =>
                setFilterPaper(event.target.value as "all" | "paper" | "real")
              }
            >
              <option value="all">All trades</option>
              <option value="paper">Paper only</option>
              <option value="real">Real only</option>
            </select>
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => {
                setFilterSymbol("");
                setFilterMonth("");
                setFilterTag("");
                setFilterPaper("all");
              }}
            >
              Clear filters
            </button>
          </div>
        </div>

        {journalState.loading && !journalState.data ? (
          <Spinner label="Loading journal" />
        ) : journalState.error ? (
          <EmptyState title="Could not load the journal">
            {journalState.error}
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState title="No journal entries match">
            Add an entry above, or clear the filters.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Opened</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Type</th>
                  <th className="right">Qty</th>
                  <th className="right">Planned</th>
                  <th className="right">Actual</th>
                  <th className="right">P&L</th>
                  <th className="right">R</th>
                  <th>Chart</th>
                  <th>Tags</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const pnl = entryPnl(entry);
                  const r = entryR(entry, pnl);
                  const isPending =
                    entry.actualExit === null || entry.actualExit === undefined;
                  return (
                    <tr key={entry.id}>
                      <td className="muted small">
                        {formatDate(entry.openedAt ?? entry.createdAt)}
                        {entry.closedAt && (
                          <span className="cell-sub">
                            closed {formatDate(entry.closedAt)}
                          </span>
                        )}
                      </td>
                      <td>
                        <strong>{entry.symbol}</strong>
                        {entry.reason && (
                          <span className="cell-sub">{entry.reason}</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={entry.side === "buy" ? "good" : "bad"}>
                          {entry.side}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={entry.paper ? "info" : "neutral"}>
                          {entry.paper ? "paper" : "real"}
                        </Badge>
                      </td>
                      <td className="right">
                        {formatNumber(entry.quantity, 0)}
                      </td>
                      <td className="right mono">
                        {formatNumber(entry.plannedEntry)}
                        <span className="cell-sub">
                          stop {formatNumber(entry.plannedStop)} · target{" "}
                          {formatNumber(entry.plannedTarget)}
                        </span>
                      </td>
                      <td className="right mono">
                        {formatNumber(entry.actualEntry)}
                        <span className="cell-sub">
                          {isPending
                            ? "exit pending"
                            : `exit ${formatNumber(entry.actualExit)}`}
                        </span>
                      </td>
                      <td
                        className={`right ${
                          pnl === null ? "" : pnl >= 0 ? "tone-up" : "tone-down"
                        }`}
                      >
                        {isPending ? "Pending" : formatNumber(pnl)}
                      </td>
                      <td
                        className={`right ${
                          r === null ? "" : r >= 0 ? "tone-up" : "tone-down"
                        }`}
                      >
                        {r === null || isPending ? "—" : `${formatNumber(r)}R`}
                      </td>
                      <td className="snapshot-cell">
                        {entry.hasSnapshot ? (
                          <a
                            className="journal-thumb-link"
                            href={entry.snapshotUrl ?? `/api/journal/${entry.id}/snapshot`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open the chart snapshot full size"
                          >
                            <img
                              className="journal-thumb"
                              src={entry.snapshotUrl ?? `/api/journal/${entry.id}/snapshot`}
                              alt={`Chart snapshot for ${entry.symbol}`}
                              loading="lazy"
                              width={64}
                              height={40}
                            />
                          </a>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                      <td>
                        <span className="row" style={{ gap: 4 }}>
                          {tagsOf(entry).map((tag) => (
                            <span className="chip" key={tag}>
                              {tag}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="right">
                        <div
                          className="row"
                          style={{ gap: 6, flexWrap: "nowrap" }}
                        >
                          <button
                            type="button"
                            className="button button-ghost button-small"
                            onClick={() => loadEntry(entry)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="button button-ghost button-small"
                            disabled={busy}
                            onClick={() => void deleteEntry(entry.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

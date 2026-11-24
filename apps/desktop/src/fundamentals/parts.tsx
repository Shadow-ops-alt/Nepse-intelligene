import type { ReactNode } from "react";
import type { DataClassification, DataStateSummary, Provenance } from "../types";
import { Badge, DataStateBadge, EmptyState, formatTimestamp } from "../components/ui";
import { formatKind, type CapClass, type MetricKind, type Val } from "./model";

/** A value with a visible "d" marker and tooltip when it is derived. */
export function ValCell({ val, kind }: { val: Val; kind: MetricKind }) {
  if (val.value === null) {
    return (
      <span className="subtle" title={val.note}>
        —
      </span>
    );
  }
  return (
    <span title={val.note}>
      {formatKind(val.value, kind)}
      {val.derived && <DerivedMark />}
    </span>
  );
}

export function DerivedMark({ title = "derived locally" }: { title?: string }) {
  return (
    <sup className="subtle" style={{ marginLeft: 2, fontSize: "0.72em" }} title={title} aria-label="derived">
      d
    </sup>
  );
}

const CAP_TONE: Record<CapClass, "good" | "info" | "neutral" | "warn"> = {
  Large: "good",
  High: "info",
  Mid: "neutral",
  Low: "warn",
};

export function CapBadge({ value }: { value: CapClass | null | undefined }) {
  if (!value) return <span className="subtle">—</span>;
  return <Badge tone={CAP_TONE[value]}>{value}</Badge>;
}

/**
 * Provenance strip: classification + freshness + source + as-of. Unofficial
 * values always read UNVERIFIED; locally computed columns read DERIVED.
 */
export function ProvenanceLine({
  provenance,
  dataState,
  sources,
  asOf,
  derived = false,
  extra,
}: {
  provenance?: Provenance | null;
  dataState?: DataStateSummary | null;
  sources?: string[];
  asOf?: string | null;
  derived?: boolean;
  extra?: ReactNode;
}) {
  const classification: DataClassification =
    provenance?.classification === "VERIFIED" ? "VERIFIED" : "UNVERIFIED";
  const state = provenance?.state ?? dataState?.state ?? "unavailable";
  const when = asOf ?? provenance?.asOf ?? dataState?.lastAsOf ?? null;
  return (
    <span className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <DataStateBadge state={state} classification={classification} />
      {derived && <Badge tone="info">derived columns</Badge>}
      <span className="muted small">
        source {sources && sources.length > 0 ? sources.join(", ") : "public web pages"}
        {` · as of ${when ? when.slice(0, 10) : "—"}`}
        {provenance?.fetchedAt ? ` · imported ${formatTimestamp(provenance.fetchedAt)}` : ""}
      </span>
      {extra}
    </span>
  );
}

/**
 * Explain why a dataset is missing instead of crashing or showing blanks.
 *
 * Client builds never show shell commands here. The packaged app fetches the
 * public pages in the background, so the default message points at the Data
 * page. A developer command is shown only when a caller passes `command`.
 */
export function MissingData({
  title,
  status,
  error,
  endpoint,
  command,
  children,
}: {
  title: string;
  status?: number | null;
  error?: string | null;
  endpoint?: string;
  /** Developer-only command. Pass this only in developer-facing copy. */
  command?: string;
  children?: ReactNode;
}) {
  const reason =
    status === 404 && endpoint
      ? `The local API does not serve ${endpoint} yet (HTTP 404). Update the app/API, or nothing is stored for this request.`
      : error
        ? `Request failed: ${error}`
        : null;
  return (
    <EmptyState title={title}>
      {reason && <p>{reason}</p>}
      {children ?? (
        <p>
          Automatic updates fetch public data in the background while the app
          is open. Open the <strong>Data</strong> page to see update status,
          check now, or import CSV files manually when you are offline.
          {command ? (
            <>
              {" "}
              Developers can run <code>{command}</code> from a terminal.
            </>
          ) : null}
        </p>
      )}
    </EmptyState>
  );
}

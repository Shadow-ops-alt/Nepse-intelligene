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
        source {sources && sources.length > 0 ? sources.join(", ") : (provenance?.sourceType ?? "public web pages")}
        {provenance ? ` · terms ${provenance.termsStatus}` : ""}
        {` · as of ${when ? when.slice(0, 10) : "—"}`}
        {provenance?.fetchedAt ? ` · imported ${formatTimestamp(provenance.fetchedAt)}` : ""}
      </span>
      {extra}
    </span>
  );
}

/** Explain why a dataset is missing instead of crashing or showing blanks. */
export function MissingData({
  title,
  status,
  error,
  endpoint,
  command = "pnpm personal:details",
  children,
}: {
  title: string;
  status?: number | null;
  error?: string | null;
  endpoint?: string;
  command?: string;
  children?: ReactNode;
}) {
  const reason =
    status === 404 && endpoint
      ? `The local API does not serve ${endpoint} yet (HTTP 404) — update the app/API, or nothing is stored for this request.`
      : error
        ? `Request failed: ${error}`
        : null;
  return (
    <EmptyState title={title}>
      {reason && <p>{reason}</p>}
      {children ?? (
        <p>
          Run <code>{command}</code> to fetch public company pages, then import
          (<strong>Data → Import</strong> or <code>pnpm personal:sync</code>).
        </p>
      )}
    </EmptyState>
  );
}

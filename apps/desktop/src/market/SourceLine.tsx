import type { ReactNode } from "react";
import { Badge, formatTimestamp } from "../components/ui";

/**
 * One-line provenance footer: where a list came from, when it was fetched and
 * a link to the source page. External links open outside the app.
 */
export function SourceLine({
  source,
  fetchedAt,
  asOf,
  url,
  classification = "UNVERIFIED",
  children,
}: {
  source: ReactNode;
  fetchedAt?: string | null;
  asOf?: string | null;
  url?: string | null;
  classification?: "UNVERIFIED" | "DERIVED" | "VERIFIED";
  children?: ReactNode;
}) {
  return (
    <p className="muted small row" style={{ gap: 6 }}>
      <Badge tone={classification === "DERIVED" ? "info" : classification === "VERIFIED" ? "good" : "warn"}>
        {classification === "DERIVED" ? "derived" : classification === "VERIFIED" ? "verified" : "unverified"}
      </Badge>
      <span>
        Source: {source}
        {url && (
          <>
            {" "}
            ·{" "}
            <a href={url} target="_blank" rel="noreferrer">
              open source page
            </a>
          </>
        )}
        {" "}· fetched {fetchedAt ? formatTimestamp(fetchedAt) : "— (not recorded)"}
        {asOf && <> · as of {formatTimestamp(asOf)}</>}
        {children && <> · {children}</>}
      </span>
    </p>
  );
}

const NPT_OFFSET_MS = (5 * 60 + 45) * 60_000;

/** Today's calendar date in Nepal Time (YYYY-MM-DD). */
export function todayNpt(): string {
  return new Date(Date.now() + NPT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import type { DataClassification, DataState } from "../types";

export type BadgeTone = "neutral" | "good" | "warn" | "bad" | "info";

export function Badge({
  tone = "neutral",
  children,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

const STATE_LABEL: Record<DataState, string> = {
  live: "Live",
  delayed: "Delayed",
  eod: "EOD",
  stale: "Stale",
  unavailable: "Unavailable",
};

const STATE_TONE: Record<DataState, BadgeTone> = {
  live: "good",
  delayed: "warn",
  eod: "info",
  stale: "warn",
  unavailable: "neutral",
};

const CLASSIFICATION_LABEL: Record<DataClassification, string> = {
  VERIFIED: "Verified",
  UNVERIFIED: "Unverified",
  DERIVED: "Derived",
  DEMO: "Demo",
  MISSING: "Missing",
};

const CLASSIFICATION_TONE: Record<DataClassification, BadgeTone> = {
  VERIFIED: "good",
  UNVERIFIED: "warn",
  DERIVED: "info",
  DEMO: "bad",
  MISSING: "neutral",
};

/**
 * A freshness badge is always text plus colour. Colour alone never carries the
 * meaning. Classification is shown alongside the state unless the record is
 * independently verified.
 */
export function DataStateBadge({
  state,
  classification,
  showClassification = true,
  title,
}: {
  state: DataState;
  classification?: DataClassification;
  showClassification?: boolean;
  title?: string;
}) {
  return (
    <span className="state-badges" title={title}>
      <span className={`badge badge-${STATE_TONE[state]}`}>
        {STATE_LABEL[state]}
      </span>
      {showClassification &&
        classification &&
        classification !== "VERIFIED" && (
          <span className={`badge badge-${CLASSIFICATION_TONE[classification]}`}>
            {CLASSIFICATION_LABEL[classification]}
          </span>
        )}
    </span>
  );
}

/**
 * Market timestamps are shown in Nepal Time (UTC+05:45), the exchange's own
 * clock, so an end-of-day close reads 15:00 rather than 09:15 UTC.
 */
export function formatTimestamp(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const npt = new Date(parsed.getTime() + (5 * 60 + 45) * 60_000);
  return `${npt.toISOString().slice(0, 16).replace("T", " ")} NPT`;
}

export function formatAge(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return "unknown age";
  }
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function AsOf({
  value,
  ageSeconds,
}: {
  value?: string | null;
  ageSeconds?: number | null;
}) {
  if (!value) {
    return <span className="as-of">as of —</span>;
  }
  const showAge =
    typeof ageSeconds === "number" && Number.isFinite(ageSeconds);
  return (
    <span className="as-of" title={value}>
      {formatTimestamp(value)}
      {showAge && ` · ${formatAge(ageSeconds)}`}
    </span>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
  footer,
  className = "",
}: {
  title?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          {action && <div className="card-actions">{action}</div>}
        </header>
      )}
      {children}
      {footer && <div className="card-footer">{footer}</div>}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  badge,
  children,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "up" | "down" | "flat";
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="stat-label">
        <span>{label}</span>
        {badge}
      </span>
      <span className={`stat-value ${tone ? `tone-${tone}` : ""}`}>
        {value}
      </span>
      {hint && <span className="stat-hint">{hint}</span>}
      {children && <div className="stat-spark">{children}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div className="empty-body">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="skeleton" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      <span className="skeleton-bar" />
      <span className="skeleton-bar short" />
      <span className="skeleton-bar" />
    </div>
  );
}

export function Notice({
  tone = "warn",
  children,
}: {
  tone?: "info" | "warn" | "error";
  children: ReactNode;
}) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

/**
 * A table row that can be activated by mouse, Enter, or Space. Keyboard users
 * get the same navigation as pointer users.
 */
export function ClickableRow({
  onClick,
  children,
  className = "",
}: {
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr
      className={`clickable ${className}`.trim()}
      role="link"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        // Let nested controls (for example a Remove button) handle their own
        // keys instead of also activating the row.
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Terminal primitives (derived-analytics UI)
// ---------------------------------------------------------------------------

export function toneOf(value: number | null | undefined): "up" | "down" | "flat" {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "flat";
  }
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

/**
 * Signed change with an arrow glyph, so direction is readable without colour.
 */
export function Delta({
  value,
  suffix = "%",
  digits = 2,
  pill = false,
}: {
  value: number | null | undefined;
  suffix?: string;
  digits?: number;
  pill?: boolean;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="delta tone-flat">—</span>;
  }
  const tone = toneOf(value);
  const glyph =
    tone === "up" ? (
      <Icon.ArrowUp />
    ) : tone === "down" ? (
      <Icon.ArrowDown />
    ) : (
      <Icon.Minus />
    );
  return (
    <span className={`delta tone-${tone} ${pill ? "delta-pill" : ""}`.trim()}>
      {glyph}
      {Math.abs(value).toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })}
      {suffix}
    </span>
  );
}

/** Tiny inline line chart of a numeric series (no axes; decorative summary). */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  tone,
  fill = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: "up" | "down" | "flat";
  fill?: boolean;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => [
    index * step,
    height - ((value - min) / span) * (height - 2) - 1,
  ]);
  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x!.toFixed(1)},${y!.toFixed(1)}`)
    .join(" ");
  const direction =
    tone ?? toneOf((values.at(-1) ?? 0) - (values[0] ?? 0));
  const colour =
    direction === "up"
      ? "var(--up)"
      : direction === "down"
        ? "var(--down)"
        : "var(--text-subtle)";
  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`trend from ${values[0]?.toFixed(2)} to ${values.at(-1)?.toFixed(2)}`}
    >
      {fill && (
        <path
          d={`${line} L${width},${height} L0,${height} Z`}
          fill={colour}
          opacity={0.1}
        />
      )}
      <path d={line} fill="none" stroke={colour} strokeWidth={1.5} />
    </svg>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string; count?: number }>;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          className={`tab ${value === item.value ? "tab-active" : ""}`}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          {item.count !== undefined && (
            <span className="tab-count">{item.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string }>;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          className={value === item.value ? "segment-active" : ""}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export type SortDirection = "asc" | "desc";

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

/** Client-side sort with nulls always last, whatever the direction. */
export function useSort<T, K extends string>(
  rows: T[],
  initial: SortState<K>,
  accessor: (row: T, key: K) => number | string | null | undefined,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const sorted = useMemo(() => {
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = accessor(a, sort.key);
      const vb = accessor(b, sort.key);
      const aMissing = va === null || va === undefined || (typeof va === "number" && !Number.isFinite(va));
      const bMissing = vb === null || vb === undefined || (typeof vb === "number" && !Number.isFinite(vb));
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * factor;
      }
      return String(va).localeCompare(String(vb)) * factor;
    });
    // accessor is expected to be stable for a given table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  const toggle = (key: K, defaultDirection: SortDirection = "desc") => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: defaultDirection },
    );
  };

  return { sorted, sort, toggle };
}

export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  defaultDirection = "desc",
  title,
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K, defaultDirection?: SortDirection) => void;
  align?: "left" | "right";
  defaultDirection?: SortDirection;
  title?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={align === "right" ? "right" : undefined}
      aria-sort={
        active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
      }
      title={title}
    >
      <button
        type="button"
        className="sort-button"
        data-active={active}
        onClick={() => onSort(sortKey, defaultDirection)}
      >
        {label}
        {active ? (
          sort.direction === "asc" ? (
            <Icon.ChevronUp />
          ) : (
            <Icon.ChevronDown />
          )
        ) : (
          <Icon.Sort />
        )}
      </button>
    </th>
  );
}

/** Position of a value inside a [low, high] range, e.g. the 52-week range. */
export function RangeBar({
  low,
  high,
  value,
  showLabels = true,
}: {
  low: number | null | undefined;
  high: number | null | undefined;
  value: number | null | undefined;
  showLabels?: boolean;
}) {
  if (
    low === null || low === undefined ||
    high === null || high === undefined ||
    value === null || value === undefined ||
    !(high > low)
  ) {
    return <span className="muted small">—</span>;
  }
  const position = Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
  return (
    <div title={`${position.toFixed(0)}% of range`}>
      <div className="range-bar">
        <span className="range-fill" style={{ width: `${position}%` }} />
        <span className="range-marker" style={{ left: `${position}%` }} />
      </div>
      {showLabels && (
        <div className="range-labels">
          <span>{low.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
          <span>{high.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
        </div>
      )}
    </div>
  );
}

export function BreadthBar({
  advancers,
  unchanged,
  decliners,
}: {
  advancers: number;
  unchanged: number;
  decliners: number;
}) {
  const total = advancers + unchanged + decliners || 1;
  return (
    <div>
      <div
        className="breadth-bar"
        role="img"
        aria-label={`${advancers} advancing, ${unchanged} unchanged, ${decliners} declining`}
      >
        <span className="breadth-up" style={{ width: `${(advancers / total) * 100}%` }} />
        <span className="breadth-flat" style={{ width: `${(unchanged / total) * 100}%` }} />
        <span className="breadth-down" style={{ width: `${(decliners / total) * 100}%` }} />
      </div>
      <div className="breadth-legend">
        <span className="tone-up">▲ {advancers} up</span>
        <span className="muted">● {unchanged} flat</span>
        <span className="tone-down">▼ {decliners} down</span>
      </div>
    </div>
  );
}

export type Rating =
  | "strong-bullish"
  | "bullish"
  | "neutral"
  | "bearish"
  | "strong-bearish";

export const RATING_LABEL: Record<Rating, string> = {
  "strong-bullish": "Strong bullish",
  bullish: "Bullish",
  neutral: "Neutral",
  bearish: "Bearish",
  "strong-bearish": "Strong bearish",
};

export function RatingBadge({ rating }: { rating: Rating | null | undefined }) {
  if (!rating) return <span className="muted">—</span>;
  const tone: BadgeTone =
    rating === "strong-bullish" || rating === "bullish"
      ? "good"
      : rating === "strong-bearish" || rating === "bearish"
        ? "bad"
        : "neutral";
  return <Badge tone={tone}>{RATING_LABEL[rating]}</Badge>;
}

export function RatingGauge({
  rating,
  score,
}: {
  rating: Rating;
  score: number;
}) {
  const order: Rating[] = [
    "strong-bearish",
    "bearish",
    "neutral",
    "bullish",
    "strong-bullish",
  ];
  const classes = ["sb", "b", "n", "u", "su"];
  const active = order.indexOf(rating);
  return (
    <div className="gauge">
      <div className="row-between">
        <span
          className={`gauge-value ${
            active > 2 ? "tone-up" : active < 2 ? "tone-down" : ""
          }`}
        >
          {RATING_LABEL[rating]}
        </span>
        <span className="muted small mono">
          score {score >= 0 ? "+" : ""}
          {score.toFixed(2)}
        </span>
      </div>
      <div className="gauge-track" aria-hidden="true">
        {classes.map((name, index) => (
          <span key={name} className={`${name} ${index === active ? "on" : ""}`} />
        ))}
      </div>
      <div className="gauge-labels" aria-hidden="true">
        <span>Strong bear</span>
        <span>Bear</span>
        <span>Neutral</span>
        <span>Bull</span>
        <span>Strong bull</span>
      </div>
    </div>
  );
}

export function MiniStats({
  items,
}: {
  items: Array<{ label: string; value: ReactNode; hint?: ReactNode; tone?: "up" | "down" | "flat" }>;
}) {
  return (
    <div className="mini-stats">
      {items.map((item) => (
        <div className="mini-stat" key={item.label}>
          <span>{item.label}</span>
          <strong className={item.tone ? `tone-${item.tone}` : undefined}>
            {item.value}
          </strong>
          {item.hint && <small>{item.hint}</small>}
        </div>
      ))}
    </div>
  );
}

export function Avatar({ symbol, large = false }: { symbol: string; large?: boolean }) {
  return (
    <span className={`avatar ${large ? "avatar-lg" : ""}`} aria-hidden="true">
      {symbol.slice(0, 4)}
    </span>
  );
}

/**
 * Background colour for a heat cell. Intensity scales with |value| / range and
 * is mixed into the surface colour, so it works in both themes.
 */
export function heatStyle(
  value: number | null | undefined,
  range = 3,
): { background: string; color?: string } {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { background: "var(--surface-2)" };
  }
  const intensity = Math.min(1, Math.abs(value) / range);
  const percent = Math.round(12 + intensity * 58);
  const colour = value >= 0 ? "var(--up)" : "var(--down)";
  if (value === 0) return { background: "var(--surface-3)" };
  return {
    background: `color-mix(in srgb, ${colour} ${percent}%, var(--surface))`,
    color: intensity > 0.6 ? "#fff" : undefined,
  };
}

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]!);
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((key) => escape(row[key])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

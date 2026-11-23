import { useMemo, useState, type ReactNode } from "react";
import { useApi, type ApiState } from "../hooks";
import { formatNumber } from "../api";
import type {
  CompaniesResponse,
  Company,
  DataStateSummary,
  Ipo,
  IposResponse,
  NewsResponse,
} from "../types";
import {
  Badge,
  Card,
  ClickableRow,
  DataStateBadge,
  EmptyState,
  Notice,
  Segmented,
  SortHeader,
  Spinner,
  Tabs,
  downloadCsv,
  formatTimestamp,
  useSort,
  type BadgeTone,
} from "../components/ui";
import { Icon } from "../components/icons";
import { SourceLine, daysBetween, todayNpt } from "../market/SourceLine";

// ---------------------------------------------------------------------------
// Page-local response shapes (backend contract item 3)
// ---------------------------------------------------------------------------

interface CompanyEvent {
  symbol: string;
  type: string;
  date: string | null;
  fiscalYear: string | null;
  title: string;
  detail: string | null;
  url: string | null;
  source: string | null;
  classification: string;
  fetchedAt: string | null;
}

interface CompanyEventsResponse {
  providerId: string;
  symbol: string | null;
  types: string[];
  events: CompanyEvent[];
  total?: number;
  source: { file: string; modifiedAt: string } | null;
  unavailableReason?: string | null;
  dataState: DataStateSummary;
}

/** Event types written by the automatic details pass (ShareSansar company tabs). */
type EventType = "dividend" | "agm" | "rightShare" | "announcement" | "companyNews";

type EventsTab = "issues" | "rights" | "dividends" | "mna" | "lockin" | "news";

const TAB_TYPES: Record<EventsTab, EventType[]> = {
  issues: [],
  rights: ["rightShare"],
  dividends: ["dividend", "agm"],
  mna: ["announcement", "companyNews"],
  lockin: ["announcement", "companyNews"],
  news: ["companyNews", "announcement"],
};

const EVENT_TYPE_LABEL: Record<EventType, string> = {
  dividend: "Dividend",
  agm: "AGM",
  rightShare: "Right share",
  announcement: "Announcement",
  companyNews: "Company news",
};

/** The API caps `limit` at 5000 per request; one request per type. */
const EVENTS_LIMIT = 5000;
const ROW_CAP = 200;

const MNA_PATTERN = /merg|acqui|amalgamat|swap ratio|गाभ|प्राप्ति/i;
/**
 * Lock-in announcements. The Devanagari term is "लक-इन"/"लकइन"; a bare "लक"
 * would also match common words such as "लक्ष्य" (target).
 */
const LOCKIN_PATTERN = /lock[- ]?in|promoter share|लक[- ]?इन/i;

const ISSUE_TYPE_LABEL: Record<string, string> = {
  ipo: "IPO",
  fpo: "FPO",
  right: "Right",
  mutualFund: "Mutual fund",
  debenture: "Debenture",
  auction: "Auction",
};

function issueTypeLabel(type: string): string {
  return ISSUE_TYPE_LABEL[type] ?? type;
}

function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function ExternalLink({
  url,
  children = "open",
  textFallback = false,
}: {
  url: string | null | undefined;
  children?: ReactNode;
  /** Show the children as plain text (instead of "—") when there is no usable link. */
  textFallback?: boolean;
}) {
  const href = safeUrl(url);
  if (!href) return textFallback ? <span>{children}</span> : <span className="muted">—</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function SymbolChip({
  symbol,
  onOpenSymbol,
}: {
  symbol: string;
  onOpenSymbol: (symbol: string) => void;
}) {
  return (
    <button
      type="button"
      className="toggle-chip"
      style={{ padding: "1px 8px" }}
      onClick={(event) => {
        event.stopPropagation();
        onOpenSymbol(symbol);
      }}
    >
      {symbol}
    </button>
  );
}

function CapNote({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <p className="muted small" style={{ marginTop: 8 }}>
      Showing {shown.toLocaleString()} of {total.toLocaleString()}. Export CSV
      for every row.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Company-events plumbing
// ---------------------------------------------------------------------------

type EventsState = ApiState<CompanyEventsResponse>;

function useCompanyEvents(type: EventType, enabled: boolean): EventsState {
  return useApi<CompanyEventsResponse>(
    enabled
      ? `/api/company-events?type=${encodeURIComponent(type.toLowerCase())}&limit=${EVENTS_LIMIT}`
      : null,
  );
}

/** Why a company-events list is empty, or null when it has rows. */
function eventsProblem(state: EventsState, label: string): ReactNode | null {
  if (state.loading) return null;
  if (state.error) {
    if (state.error.startsWith("404")) {
      return (
        <>
          This API does not serve <code>/api/company-events</code> yet (404).
          The endpoint comes with the backend update; restart the API once it
          is in place. Nothing is shown in the meantime.
        </>
      );
    }
    return <>Could not load {label}: {state.error}</>;
  }
  const data = state.data;
  if (!data) return null;
  if (!data.source) {
    return (
      <>
        {data.unavailableReason ? (
          <>{data.unavailableReason}.</>
        ) : (
          <>
            company-events.csv has not been written to the data folder yet.
          </>
        )}{" "}
        Use <strong>Fetch company profiles</strong> on the{" "}
        <strong>Data</strong> page to load per-company dividend, AGM,
        right-share, announcement and company-news history from the public
        company pages (ShareSansar, unofficial). Nothing is shown until that
        details pass runs.
      </>
    );
  }
  if (data.events.length === 0) {
    return (
      <>
        company-events.csv has no {label} rows
        {data.types.length > 0 ? ` (types present: ${data.types.join(", ")})` : ""}.
        {data.unavailableReason ? ` ${data.unavailableReason}.` : ""}
      </>
    );
  }
  return null;
}

function truncated(state: EventsState): number | null {
  const total = state.data?.total;
  const count = state.data?.events.length ?? 0;
  return typeof total === "number" && total > count ? total : null;
}

function EventsSourceLine({ states }: { states: EventsState[] }) {
  const loaded = states.map((state) => state.data).filter((data): data is CompanyEventsResponse => Boolean(data));
  const withSource = loaded.find((data) => data.source);
  if (!withSource?.source) return null;
  let fetchedAt: string | null = null;
  for (const data of loaded) {
    for (const event of data.events) {
      if (event.fetchedAt && (!fetchedAt || event.fetchedAt > fetchedAt)) fetchedAt = event.fetchedAt;
    }
  }
  const cut = states.map(truncated).filter((value): value is number => value !== null);
  return (
    <SourceLine
      source="ShareSansar company pages (details pass, company-events.csv)"
      fetchedAt={fetchedAt ?? withSource.source.modifiedAt}
    >
      file updated {formatTimestamp(withSource.source.modifiedAt)}
      {cut.length > 0 && ` · newest ${EVENTS_LIMIT.toLocaleString()} rows per type shown (file has more)`}
    </SourceLine>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function EventsPage({
  onOpenSymbol,
}: {
  onOpenSymbol: (symbol: string) => void;
}) {
  const [tab, setTab] = useState<EventsTab>("issues");
  const [visited, setVisited] = useState<Set<EventsTab>>(() => new Set(["issues"]));

  const iposState = useApi<IposResponse>("/api/ipos");
  const newsState = useApi<NewsResponse>("/api/news");
  const companiesState = useApi<CompaniesResponse>("/api/companies");

  const needs = (type: EventType) => [...visited].some((item) => TAB_TYPES[item].includes(type));
  const dividendState = useCompanyEvents("dividend", needs("dividend"));
  const agmState = useCompanyEvents("agm", needs("agm"));
  const rightState = useCompanyEvents("rightShare", needs("rightShare"));
  const announcementState = useCompanyEvents("announcement", needs("announcement"));
  const companyNewsState = useCompanyEvents("companyNews", needs("companyNews"));

  const changeTab = (next: EventsTab) => {
    setTab(next);
    setVisited((current) => (current.has(next) ? current : new Set([...current, next])));
  };

  const companies = companiesState.data?.companies ?? [];
  const companyBySymbol = useMemo(
    () => new Map(companies.map((company) => [company.symbol, company])),
    [companies],
  );

  const ipos = iposState.data?.ipos ?? [];

  return (
    <div className="stack">
      <Tabs<EventsTab>
        label="Corporate events"
        value={tab}
        onChange={changeTab}
        items={[
          { value: "issues", label: "IPO / FPO / Right / Auction", count: ipos.length },
          { value: "rights", label: "Right shares" },
          { value: "dividends", label: "Dividends & AGM" },
          { value: "mna", label: "Mergers & acquisitions" },
          { value: "lockin", label: "Lock-in periods" },
          { value: "news", label: "News" },
        ]}
      />

      {tab === "issues" && <IssuesTab state={iposState} onOpenSymbol={onOpenSymbol} />}
      {tab === "rights" && (
        <RightsTab
          state={rightState}
          pipelineRights={ipos.filter((ipo) => ipo.type === "right").length}
          companyBySymbol={companyBySymbol}
          onOpenSymbol={onOpenSymbol}
        />
      )}
      {tab === "dividends" && (
        <DividendsTab
          dividendState={dividendState}
          agmState={agmState}
          companyBySymbol={companyBySymbol}
          onOpenSymbol={onOpenSymbol}
        />
      )}
      {tab === "mna" && (
        <MergersTab
          announcementState={announcementState}
          companyNewsState={companyNewsState}
          newsState={newsState}
          companies={companies}
          companiesLoading={companiesState.loading}
          companyBySymbol={companyBySymbol}
          onOpenSymbol={onOpenSymbol}
        />
      )}
      {tab === "lockin" && (
        <LockInTab
          announcementState={announcementState}
          companyNewsState={companyNewsState}
          companyBySymbol={companyBySymbol}
          onOpenSymbol={onOpenSymbol}
        />
      )}
      {tab === "news" && (
        <NewsTab
          newsState={newsState}
          companyNewsState={companyNewsState}
          announcementState={announcementState}
          onOpenSymbol={onOpenSymbol}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IPO / FPO / Right / Auction
// ---------------------------------------------------------------------------

type IssueBucket = "open" | "upcoming" | "recent" | "closed" | "unknown";

const BUCKETS: Array<{ value: IssueBucket; title: string; note: string; tone: BadgeTone }> = [
  {
    value: "open",
    title: "Open now",
    note: "Today falls between the published opening and closing dates (or the issue opens today).",
    tone: "good",
  },
  { value: "upcoming", title: "Upcoming", note: "Opening date is after today.", tone: "info" },
  {
    value: "recent",
    title: "Opened in the last 14 days — closing date not published",
    note: "The source lists only the application opening date. These may still be open; check the issue manager before applying. Not counted as open because the closing date is unknown.",
    tone: "warn",
  },
  { value: "closed", title: "Closed", note: "Closing date passed, or opened more than 14 days ago.", tone: "neutral" },
  {
    value: "unknown",
    title: "Status unknown",
    note: "The source gives no dates for these rows, so their status is not inferred.",
    tone: "neutral",
  },
];

interface IssueRow {
  ipo: Ipo;
  bucket: IssueBucket;
  open: string | null;
  close: string | null;
  /** Days until close (open bucket) or until opening (upcoming). */
  days: number | null;
}

function classifyIssue(ipo: Ipo, today: string): IssueRow {
  const open = ipo.openDate ? ipo.openDate.slice(0, 10) : null;
  const close = ipo.closeDate ? ipo.closeDate.slice(0, 10) : null;
  const row = (bucket: IssueBucket, days: number | null = null): IssueRow => ({ ipo, bucket, open, close, days });
  if (open && open > today) return row("upcoming", daysBetween(today, open));
  if (close) {
    if (close < today) return row("closed");
    if (!open || open <= today) return row("open", daysBetween(today, close));
  }
  if (open) {
    if (open === today) return row("open", null);
    const since = daysBetween(open, today);
    return row(since !== null && since <= 14 ? "recent" : "closed");
  }
  return row(ipo.status === "closed" ? "closed" : "unknown");
}

function issueNotes(notes: string | undefined): string {
  if (!notes) return "";
  return notes
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !/upcoming\/past issue list/i.test(part))
    .join(" · ");
}

function IssuesTab({
  state,
  onOpenSymbol,
}: {
  state: ApiState<IposResponse>;
  onOpenSymbol: (symbol: string) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const today = todayNpt();
  const ipos = state.data?.ipos ?? [];
  const provenance = state.data?.provenance ?? null;

  const typeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const ipo of ipos) map.set(ipo.type, (map.get(ipo.type) ?? 0) + 1);
    return map;
  }, [ipos]);
  const types = useMemo(() => {
    const known = ["ipo", "fpo", "right", "auction", "mutualFund", "debenture"];
    const extra = [...typeCounts.keys()].filter((type) => !known.includes(type)).sort();
    return [...known, ...extra];
  }, [typeCounts]);

  const rows = useMemo(
    () =>
      ipos
        .filter((ipo) => typeFilter === "all" || ipo.type === typeFilter)
        .map((ipo) => classifyIssue(ipo, today)),
    [ipos, typeFilter, today],
  );
  const grouped = useMemo(() => {
    const map = new Map<IssueBucket, IssueRow[]>();
    for (const row of rows) {
      const list = map.get(row.bucket) ?? [];
      list.push(row);
      map.set(row.bucket, list);
    }
    for (const [bucket, list] of map) {
      list.sort((a, b) =>
        bucket === "upcoming"
          ? (a.open ?? "").localeCompare(b.open ?? "")
          : (b.open ?? "").localeCompare(a.open ?? ""),
      );
    }
    return map;
  }, [rows]);

  if (state.loading) return <Spinner label="Loading the issue pipeline" />;
  if (state.error) return <EmptyState title="Could not load issues">{state.error}</EmptyState>;
  if (ipos.length === 0) {
    return (
      <EmptyState title="No public issues stored">
        Automatic updates fetch the issue pipeline from ShareSansar’s
        upcoming-issue list in the background while the app is open. Open the{" "}
        <strong>Data</strong> page to check status or refresh now.
      </EmptyState>
    );
  }

  const exportRows = () =>
    downloadCsv(
      `nepse-issues-${typeFilter}-${today}.csv`,
      rows.map((row) => ({
        bucket: row.bucket,
        symbol: row.ipo.symbol ?? "",
        company: row.ipo.companyName,
        type: row.ipo.type,
        openDate: row.open,
        closeDate: row.close,
        price: row.ipo.price ?? null,
        units: row.ipo.units ?? null,
        sourceStatus: row.ipo.status,
        notes: row.ipo.notes ?? "",
        sourceUrl: row.ipo.sourceUrl ?? "",
      })),
    );

  const noAuction = (typeCounts.get("auction") ?? 0) === 0;

  return (
    <div className="stack">
      <Card
        title="Public issues"
        subtitle={`${rows.length} of ${ipos.length} rows · today ${today} (Nepal Time)`}
        action={
          <div className="card-actions">
            {provenance && (
              <DataStateBadge state={provenance.state} classification={provenance.classification} />
            )}
            <button type="button" className="button button-ghost button-small" onClick={exportRows} disabled={rows.length === 0}>
              <Icon.Download /> CSV
            </button>
          </div>
        }
        footer={
          <SourceLine
            source="ShareSansar upcoming/past issue list"
            fetchedAt={provenance?.fetchedAt ?? null}
            url={ipos.find((ipo) => safeUrl(ipo.sourceUrl))?.sourceUrl ?? null}
          >
            dates, units and status as published; price and closing date are blank when the list does not carry them
          </SourceLine>
        }
      >
        <div className="presets" role="group" aria-label="Issue type">
          <button
            type="button"
            className="toggle-chip"
            aria-pressed={typeFilter === "all"}
            onClick={() => setTypeFilter("all")}
          >
            All ({ipos.length})
          </button>
          {types.map((type) => (
            <button
              key={type}
              type="button"
              className="toggle-chip"
              aria-pressed={typeFilter === type}
              onClick={() => setTypeFilter(type)}
            >
              {issueTypeLabel(type)} ({typeCounts.get(type) ?? 0})
            </button>
          ))}
        </div>
        {noAuction && (typeFilter === "all" || typeFilter === "auction") && (
          <Notice tone="info">
            Auctions: the stored issue list has no auction rows. The source
            list this app reads covers IPO, FPO, right, mutual-fund and
            debenture issues; share auctions are not published there, so none
            are shown rather than guessed.
          </Notice>
        )}
        <p className="muted small">
          {BUCKETS.map((bucket) => `${bucket.title.split(" —")[0]}: ${grouped.get(bucket.value)?.length ?? 0}`).join(" · ")}
        </p>
      </Card>

      {BUCKETS.map((bucket) => {
        const list = grouped.get(bucket.value) ?? [];
        if (list.length === 0) {
          return bucket.value === "open" || bucket.value === "upcoming" ? (
            <Card key={bucket.value} title={bucket.title} subtitle={bucket.note}>
              <EmptyState title={`${bucket.value === "open" ? "No issues open now" : "No upcoming issues"}${typeFilter === "all" ? "" : ` of type ${issueTypeLabel(typeFilter)}`}`} />
            </Card>
          ) : null;
        }
        return (
          <Card
            key={bucket.value}
            title={`${bucket.title} (${list.length})`}
            subtitle={bucket.note}
            action={<Badge tone={bucket.tone}>{bucket.value === "recent" ? "close date unknown" : bucket.title.toLowerCase()}</Badge>}
          >
            <div className={`table-scroll ${bucket.value === "closed" || bucket.value === "unknown" ? "short" : ""}`}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Type</th>
                    <th>Opens</th>
                    <th>Closes</th>
                    <th className="right">{bucket.value === "upcoming" ? "Opens in" : "Days left"}</th>
                    <th className="right">Price</th>
                    <th className="right">Units</th>
                    <th>Source status</th>
                    <th>Notes</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, ROW_CAP).map((row) => (
                    <tr key={row.ipo.id}>
                      <td>
                        {row.ipo.symbol ? (
                          <SymbolChip symbol={row.ipo.symbol} onOpenSymbol={onOpenSymbol} />
                        ) : (
                          <strong>—</strong>
                        )}
                        <span className="cell-sub">{row.ipo.companyName}</span>
                      </td>
                      <td>
                        <Badge tone="info">{issueTypeLabel(row.ipo.type)}</Badge>
                      </td>
                      <td className="nowrap">{row.open ?? "—"}</td>
                      <td className="nowrap">{row.close ?? <span className="muted">not published</span>}</td>
                      <td className="right">
                        {row.days === null
                          ? bucket.value === "open"
                            ? "opens today"
                            : "—"
                          : `${row.days} day${row.days === 1 ? "" : "s"}`}
                      </td>
                      <td className="right">{row.ipo.price === undefined ? "—" : formatNumber(row.ipo.price)}</td>
                      <td className="right">{row.ipo.units === undefined ? "—" : formatNumber(row.ipo.units, 0)}</td>
                      <td className="muted">{row.ipo.status}</td>
                      <td className="muted small" title={row.ipo.notes}>
                        <span className="cell-sub" style={{ maxWidth: 320 }}>
                          {issueNotes(row.ipo.notes) || "—"}
                        </span>
                      </td>
                      <td>
                        <ExternalLink url={row.ipo.sourceUrl}>source</ExternalLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CapNote shown={Math.min(ROW_CAP, list.length)} total={list.length} />
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic company-event table
// ---------------------------------------------------------------------------

type EventKey = "symbol" | "date" | "fiscalYear" | "title" | "type";

function EventTable({
  events,
  companyBySymbol,
  onOpenSymbol,
  showType = false,
  showFiscalYear = false,
  dateLabel = "Date",
  filename,
}: {
  events: CompanyEvent[];
  companyBySymbol: Map<string, Company>;
  onOpenSymbol: (symbol: string) => void;
  showType?: boolean;
  showFiscalYear?: boolean;
  dateLabel?: string;
  filename: string;
}) {
  const { sorted, sort, toggle } = useSort<CompanyEvent, EventKey>(
    events,
    { key: "date", direction: "desc" },
    (event, key) => event[key],
  );
  const visible = sorted.slice(0, ROW_CAP);
  const exportRows = () =>
    downloadCsv(
      filename,
      sorted.map((event) => ({
        symbol: event.symbol,
        type: event.type,
        date: event.date,
        fiscalYear: event.fiscalYear,
        title: event.title,
        detail: event.detail,
        url: event.url,
        source: event.source,
        classification: event.classification,
        fetchedAt: event.fetchedAt,
      })),
    );
  if (events.length === 0) return <EmptyState title="No matching rows" />;
  return (
    <>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <span className="muted small">{events.length.toLocaleString()} rows · newest first</span>
        <button type="button" className="button button-ghost button-small" onClick={exportRows}>
          <Icon.Download /> CSV ({events.length.toLocaleString()})
        </button>
      </div>
      <div className="table-scroll tall">
        <table className="table">
          <thead>
            <tr>
              <SortHeader label="Symbol" sortKey="symbol" sort={sort} onSort={toggle} defaultDirection="asc" />
              {showType && <SortHeader label="Type" sortKey="type" sort={sort} onSort={toggle} defaultDirection="asc" />}
              <SortHeader label={dateLabel} sortKey="date" sort={sort} onSort={toggle} />
              {showFiscalYear && <SortHeader label="Fiscal year" sortKey="fiscalYear" sort={sort} onSort={toggle} />}
              <SortHeader label="Title" sortKey="title" sort={sort} onSort={toggle} defaultDirection="asc" />
              <th>Detail</th>
              <th>Source · fetched</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((event, index) => (
              <ClickableRow
                key={`${event.symbol}-${event.type}-${event.date ?? ""}-${index}`}
                onClick={() => onOpenSymbol(event.symbol)}
              >
                <td>
                  <strong>{event.symbol}</strong>
                  <span className="cell-sub">{companyBySymbol.get(event.symbol)?.name ?? ""}</span>
                </td>
                {showType && (
                  <td>
                    <Badge tone="info">{EVENT_TYPE_LABEL[event.type as EventType] ?? event.type}</Badge>
                  </td>
                )}
                <td className="nowrap">{event.date ?? <span className="muted">undated</span>}</td>
                {showFiscalYear && <td className="nowrap">{event.fiscalYear ?? "—"}</td>}
                <td style={{ minWidth: 220 }}>{event.title || <span className="muted">—</span>}</td>
                <td className="muted small" style={{ minWidth: 200 }}>
                  {event.detail ?? "—"}
                </td>
                <td className="small nowrap">
                  {safeUrl(event.url) ? (
                    <a
                      href={safeUrl(event.url)!}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(clickEvent) => clickEvent.stopPropagation()}
                    >
                      {event.source ?? "source"}
                    </a>
                  ) : (
                    <span>{event.source ?? "—"}</span>
                  )}
                  <span className="cell-sub">{event.fetchedAt ? formatTimestamp(event.fetchedAt) : "fetch time not recorded"}</span>
                </td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </div>
      <CapNote shown={visible.length} total={sorted.length} />
    </>
  );
}

function useSymbolFilter(events: CompanyEvent[], search: string, fromToday: boolean) {
  return useMemo(() => {
    const needle = search.trim().toUpperCase();
    const today = todayNpt();
    return events.filter((event) => {
      if (needle && !event.symbol.includes(needle) && !event.title.toUpperCase().includes(needle)) return false;
      if (fromToday && (!event.date || event.date.slice(0, 10) < today)) return false;
      return true;
    });
  }, [events, search, fromToday]);
}

function FilterBar({
  search,
  onSearch,
  fromToday,
  onFromToday,
  fromTodayLabel = "From today on",
}: {
  search: string;
  onSearch: (value: string) => void;
  fromToday?: boolean;
  onFromToday?: (value: boolean) => void;
  fromTodayLabel?: string;
}) {
  return (
    <div className="filters" style={{ marginBottom: 10 }}>
      <label className="grow">
        <span>Symbol or text</span>
        <input value={search} placeholder="NABIL, bonus…" onChange={(event) => onSearch(event.target.value)} />
      </label>
      {onFromToday && (
        <label className="checkbox">
          <input type="checkbox" checked={Boolean(fromToday)} onChange={(event) => onFromToday(event.target.checked)} />
          <span>{fromTodayLabel}</span>
        </label>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right shares
// ---------------------------------------------------------------------------

function RightsTab({
  state,
  pipelineRights,
  companyBySymbol,
  onOpenSymbol,
}: {
  state: EventsState;
  pipelineRights: number;
  companyBySymbol: Map<string, Company>;
  onOpenSymbol: (symbol: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [fromToday, setFromToday] = useState(false);
  const events = state.data?.events ?? [];
  const filtered = useSymbolFilter(events, search, fromToday);
  const problem = eventsProblem(state, "right-share");

  return (
    <Card
      title="Right shares"
      subtitle="Per-company right-share history: ratio, units, price, opening/closing and book-closure dates"
      action={<Badge tone="warn">unverified</Badge>}
      footer={<EventsSourceLine states={[state]} />}
    >
      {pipelineRights > 0 && (
        <p className="muted small" style={{ marginBottom: 8 }}>
          {pipelineRights} right issue{pipelineRights === 1 ? "" : "s"} also appear in the issue
          pipeline (first tab), which is a separate source list.
        </p>
      )}
      {state.loading ? (
        <Spinner label="Loading right-share history" />
      ) : problem ? (
        <EmptyState title="Right-share history unavailable">{problem}</EmptyState>
      ) : (
        <>
          <FilterBar
            search={search}
            onSearch={setSearch}
            fromToday={fromToday}
            onFromToday={setFromToday}
            fromTodayLabel="Opening today or later"
          />
          <EventTable
            events={filtered}
            companyBySymbol={companyBySymbol}
            onOpenSymbol={onOpenSymbol}
            dateLabel="Opening"
            filename="nepse-right-shares.csv"
          />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Dividends & AGM
// ---------------------------------------------------------------------------

function DividendsTab({
  dividendState,
  agmState,
  companyBySymbol,
  onOpenSymbol,
}: {
  dividendState: EventsState;
  agmState: EventsState;
  companyBySymbol: Map<string, Company>;
  onOpenSymbol: (symbol: string) => void;
}) {
  const [view, setView] = useState<"dividend" | "agm">("dividend");
  const [search, setSearch] = useState("");
  const [fromToday, setFromToday] = useState(false);
  const state = view === "dividend" ? dividendState : agmState;
  const events = state.data?.events ?? [];
  const filtered = useSymbolFilter(events, search, fromToday);
  const problem = eventsProblem(state, view === "dividend" ? "dividend" : "AGM");

  return (
    <Card
      title={view === "dividend" ? "Dividends" : "Annual general meetings"}
      subtitle={
        view === "dividend"
          ? "Cash/bonus dividend history by fiscal year · date is the announcement date"
          : "AGM/SGM history · date is the meeting date"
      }
      action={
        <div className="card-actions">
          <Segmented<"dividend" | "agm">
            label="Event type"
            value={view}
            onChange={setView}
            items={[
              { value: "dividend", label: `Dividends${dividendState.data ? ` (${dividendState.data.total ?? dividendState.data.events.length})` : ""}` },
              { value: "agm", label: `AGM${agmState.data ? ` (${agmState.data.total ?? agmState.data.events.length})` : ""}` },
            ]}
          />
          <Badge tone="warn">unverified</Badge>
        </div>
      }
      footer={<EventsSourceLine states={[dividendState, agmState]} />}
    >
      {state.loading ? (
        <Spinner label="Loading company events" />
      ) : problem ? (
        <EmptyState title={`${view === "dividend" ? "Dividend" : "AGM"} history unavailable`}>{problem}</EmptyState>
      ) : (
        <>
          <FilterBar
            search={search}
            onSearch={setSearch}
            fromToday={fromToday}
            onFromToday={setFromToday}
            fromTodayLabel={view === "agm" ? "Meetings today or later" : "Announced today or later"}
          />
          <EventTable
            key={view}
            events={filtered}
            companyBySymbol={companyBySymbol}
            onOpenSymbol={onOpenSymbol}
            showFiscalYear={view === "dividend"}
            dateLabel={view === "agm" ? "Meeting" : "Announced"}
            filename={`nepse-${view === "dividend" ? "dividends" : "agm"}.csv`}
          />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Mergers & acquisitions
// ---------------------------------------------------------------------------

function MergersTab({
  announcementState,
  companyNewsState,
  newsState,
  companies,
  companiesLoading,
  companyBySymbol,
  onOpenSymbol,
}: {
  announcementState: EventsState;
  companyNewsState: EventsState;
  newsState: ApiState<NewsResponse>;
  companies: Company[];
  companiesLoading: boolean;
  companyBySymbol: Map<string, Company>;
  onOpenSymbol: (symbol: string) => void;
}) {
  const [search, setSearch] = useState("");
  const eventMatches = useMemo(
    () =>
      [...(announcementState.data?.events ?? []), ...(companyNewsState.data?.events ?? [])].filter((event) =>
        MNA_PATTERN.test(`${event.title} ${event.detail ?? ""}`),
      ),
    [announcementState.data, companyNewsState.data],
  );
  const filteredEvents = useSymbolFilter(eventMatches, search, false);
  const newsMatches = useMemo(
    () =>
      (newsState.data?.news ?? [])
        .filter((item) => MNA_PATTERN.test(`${item.title} ${item.summary ?? ""}`))
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    [newsState.data],
  );
  const inactive = useMemo(
    () =>
      companies
        .filter((company) => /merg|delist|amalgamat|acqui/i.test(company.status))
        .sort((a, b) => a.status.localeCompare(b.status) || a.symbol.localeCompare(b.symbol)),
    [companies],
  );
  const announcementProblem = eventsProblem(announcementState, "announcement");
  const newsProblem = eventsProblem(companyNewsState, "company-news");
  const loadingEvents = announcementState.loading || companyNewsState.loading;

  return (
    <div className="stack">
      <Notice tone="warn">
        <strong>Partial:</strong> compiled from announcements and the security
        master, not a complete M&amp;A history. Matches titles against{" "}
        <code>{MNA_PATTERN.source}</code>; a merger announced without those
        words is missed, and a title that merely mentions them is included.
      </Notice>

      <Card
        title="Announcements & company news"
        subtitle={`${eventMatches.length} matching rows from company announcements and company news`}
        action={<Badge tone="warn">unverified</Badge>}
        footer={<EventsSourceLine states={[announcementState, companyNewsState]} />}
      >
        {loadingEvents ? (
          <Spinner label="Scanning company announcements" />
        ) : announcementProblem && newsProblem ? (
          <EmptyState title="Company announcements unavailable">{announcementProblem}</EmptyState>
        ) : (
          <>
            {(announcementProblem || newsProblem) && (
              <Notice tone="warn">{announcementProblem ?? newsProblem}</Notice>
            )}
            <FilterBar search={search} onSearch={setSearch} />
            <EventTable
              events={filteredEvents}
              companyBySymbol={companyBySymbol}
              onOpenSymbol={onOpenSymbol}
              showType
              filename="nepse-mergers-announcements.csv"
            />
          </>
        )}
      </Card>

      <div className="grid two">
        <Card
          title="Market news mentioning M&A"
          subtitle={`${newsMatches.length} of ${newsState.data?.news.length ?? 0} stored headlines`}
          action={<Badge tone="warn">unverified</Badge>}
          footer={
            <SourceLine
              source="stored market news"
              fetchedAt={newsState.data?.provenance?.fetchedAt ?? null}
            />
          }
        >
          {newsState.loading ? (
            <Spinner label="Loading news" />
          ) : newsState.error ? (
            <EmptyState title="Could not load news">{newsState.error}</EmptyState>
          ) : newsMatches.length === 0 ? (
            <EmptyState title="No stored headline matches">
              Only the most recent market headlines are stored, so older merger
              news will not appear here.
            </EmptyState>
          ) : (
            <ul className="news-list">
              {newsMatches.map((item) => (
                <li key={item.id}>
                  <ExternalLink url={item.url} textFallback>{item.title}</ExternalLink>
                  <span className="muted small"> · {item.source} · {formatTimestamp(item.publishedAt)}</span>
                  {item.symbols.length > 0 && (
                    <span className="row" style={{ gap: 4, marginTop: 4 }}>
                      {item.symbols.map((symbol) => (
                        <SymbolChip key={symbol} symbol={symbol} onOpenSymbol={onOpenSymbol} />
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Merged / delisted in the security master"
          subtitle={`${inactive.length} companies whose status is not active`}
          action={<Badge tone="warn">unverified</Badge>}
          footer={
            <>
              The master records only the current status, not the merger
              partner, swap ratio or date. A “delisted” status may have other
              causes than a merger.
            </>
          }
        >
          {companiesLoading ? (
            <Spinner label="Loading companies" />
          ) : inactive.length === 0 ? (
            <EmptyState title="No merged or delisted companies in the master" />
          ) : (
            <div className="table-scroll short">
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Sector</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {inactive.map((company) => (
                    <ClickableRow key={company.symbol} onClick={() => onOpenSymbol(company.symbol)}>
                      <td>
                        <strong>{company.symbol}</strong>
                        <span className="cell-sub">{company.name}</span>
                      </td>
                      <td className="muted">{company.sector}</td>
                      <td>
                        <Badge tone="neutral">{company.status}</Badge>
                      </td>
                    </ClickableRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lock-in periods
// ---------------------------------------------------------------------------

function LockInTab({
  announcementState,
  companyNewsState,
  companyBySymbol,
  onOpenSymbol,
}: {
  announcementState: EventsState;
  companyNewsState: EventsState;
  companyBySymbol: Map<string, Company>;
  onOpenSymbol: (symbol: string) => void;
}) {
  const [search, setSearch] = useState("");
  const matches = useMemo(
    () =>
      [...(announcementState.data?.events ?? []), ...(companyNewsState.data?.events ?? [])].filter((event) =>
        LOCKIN_PATTERN.test(`${event.title} ${event.detail ?? ""}`),
      ),
    [announcementState.data, companyNewsState.data],
  );
  const filtered = useSymbolFilter(matches, search, false);
  const problem = eventsProblem(announcementState, "announcement");
  const scanned =
    (announcementState.data?.events.length ?? 0) + (companyNewsState.data?.events.length ?? 0);

  return (
    <div className="stack">
      <Notice tone="warn">
        <strong>Partial:</strong> NEPSE/CDSC do not publish a lock-in expiry
        schedule through the sources this app reads. This tab only lists
        company announcements and company news whose title mentions a lock-in
        or promoter shares (<code>{LOCKIN_PATTERN.source}</code>). Expiry dates
        are shown only when the announcement itself states them.
      </Notice>
      <Card
        title="Lock-in & promoter-share announcements"
        subtitle={`${matches.length} matches in ${scanned.toLocaleString()} stored announcements and company-news rows`}
        action={<Badge tone="warn">unverified</Badge>}
        footer={<EventsSourceLine states={[announcementState, companyNewsState]} />}
      >
        {announcementState.loading || companyNewsState.loading ? (
          <Spinner label="Scanning announcements" />
        ) : problem ? (
          <EmptyState title="Announcements unavailable">{problem}</EmptyState>
        ) : matches.length === 0 ? (
          <EmptyState title="No lock-in announcements found">
            None of the {scanned.toLocaleString()} stored announcements mention a
            lock-in or promoter shares. A lock-in dataset (promoter/IPO lock-in
            expiry by company) is not published by the free sources, so this
            tab cannot fill the gap — nothing is inferred from listing dates.
          </EmptyState>
        ) : (
          <>
            <FilterBar search={search} onSearch={setSearch} />
            <EventTable
              events={filtered}
              companyBySymbol={companyBySymbol}
              onOpenSymbol={onOpenSymbol}
              showType
              filename="nepse-lock-in-announcements.csv"
            />
          </>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

type FeedKind = "market" | "company" | "announcement";

interface FeedItem {
  id: string;
  kind: FeedKind;
  title: string;
  url: string | null;
  date: string | null;
  source: string;
  symbols: string[];
  summary: string | null;
  fetchedAt: string | null;
}

const FEED_LABEL: Record<FeedKind, string> = {
  market: "Market news",
  company: "Company news",
  announcement: "Announcement",
};

function NewsTab({
  newsState,
  companyNewsState,
  announcementState,
  onOpenSymbol,
}: {
  newsState: ApiState<NewsResponse>;
  companyNewsState: EventsState;
  announcementState: EventsState;
  onOpenSymbol: (symbol: string) => void;
}) {
  const [kind, setKind] = useState<"all" | FeedKind>("all");
  const [search, setSearch] = useState("");
  const marketFetchedAt = newsState.data?.provenance?.fetchedAt ?? null;

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    for (const item of newsState.data?.news ?? []) {
      items.push({
        id: `m-${item.id}`,
        kind: "market",
        title: item.title,
        url: item.url,
        date: item.publishedAt || null,
        source: item.source,
        symbols: item.symbols ?? [],
        summary: item.summary ?? null,
        fetchedAt: item.fetchedAt ?? marketFetchedAt,
      });
    }
    const addEvents = (state: EventsState, feedKind: FeedKind) => {
      (state.data?.events ?? []).forEach((event, index) => {
        items.push({
          id: `${feedKind}-${event.symbol}-${event.date ?? ""}-${index}`,
          kind: feedKind,
          title: event.title,
          url: event.url,
          date: event.date,
          source: event.source ?? "company page",
          symbols: [event.symbol],
          summary: event.detail,
          fetchedAt: event.fetchedAt,
        });
      });
    };
    addEvents(companyNewsState, "company");
    addEvents(announcementState, "announcement");
    return items.sort((a, b) => {
      if (a.date === b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });
  }, [newsState.data, companyNewsState.data, announcementState.data, marketFetchedAt]);

  const filtered = useMemo(() => {
    const needle = search.trim().toUpperCase();
    return feed.filter((item) => {
      if (kind !== "all" && item.kind !== kind) return false;
      if (!needle) return true;
      return (
        item.title.toUpperCase().includes(needle) ||
        item.symbols.some((symbol) => symbol.includes(needle))
      );
    });
  }, [feed, kind, search]);

  const counts = useMemo(() => {
    const map: Record<FeedKind, number> = { market: 0, company: 0, announcement: 0 };
    for (const item of feed) map[item.kind] += 1;
    return map;
  }, [feed]);

  const visible = filtered.slice(0, ROW_CAP);
  const companyProblem = eventsProblem(companyNewsState, "company-news");
  const loading = newsState.loading || companyNewsState.loading || announcementState.loading;

  const exportRows = () =>
    downloadCsv(
      "nepse-news.csv",
      filtered.map((item) => ({
        kind: item.kind,
        date: item.date,
        title: item.title,
        symbols: item.symbols.join(" "),
        source: item.source,
        url: item.url,
        fetchedAt: item.fetchedAt,
      })),
    );

  return (
    <Card
      title="News"
      subtitle={`${filtered.length.toLocaleString()} items · newest first`}
      action={
        <div className="card-actions">
          <Segmented<"all" | FeedKind>
            label="News type"
            value={kind}
            onChange={setKind}
            items={[
              { value: "all", label: `All (${feed.length})` },
              { value: "market", label: `Market (${counts.market})` },
              { value: "company", label: `Company (${counts.company})` },
              { value: "announcement", label: `Announcements (${counts.announcement})` },
            ]}
          />
          <button type="button" className="button button-ghost button-small" onClick={exportRows} disabled={filtered.length === 0}>
            <Icon.Download /> CSV
          </button>
        </div>
      }
      footer={
        <div className="stack-sm">
          <SourceLine source="market news (Merolagani/ShareSansar public pages)" fetchedAt={marketFetchedAt}>
            {newsState.data?.news.length ?? 0} headlines stored — the public feed keeps only the most recent ones
          </SourceLine>
          <EventsSourceLine states={[companyNewsState, announcementState]} />
        </div>
      }
    >
      {newsState.error && <Notice tone="error">Market news could not be loaded: {newsState.error}</Notice>}
      {companyProblem && !companyNewsState.loading && <Notice tone="warn">Company news: {companyProblem}</Notice>}
      <FilterBar search={search} onSearch={setSearch} />
      {loading && feed.length === 0 ? (
        <Spinner label="Loading news" />
      ) : filtered.length === 0 ? (
        <EmptyState title="No news matches" />
      ) : (
        <>
          <ul className="news-list">
            {visible.map((item) => (
              <li key={item.id}>
                <div className="row-between" style={{ alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <ExternalLink url={item.url} textFallback>{item.title}</ExternalLink>
                    {item.summary && (
                      <div className="muted small" style={{ marginTop: 2 }}>
                        {item.summary.length > 220 ? `${item.summary.slice(0, 220)}…` : item.summary}
                      </div>
                    )}
                    <div className="muted small" style={{ marginTop: 2 }}>
                      <Badge tone={item.kind === "market" ? "neutral" : "info"}>{FEED_LABEL[item.kind]}</Badge>{" "}
                      {item.source} ·{" "}
                      {item.date ? (item.date.length > 10 ? formatTimestamp(item.date) : item.date) : "undated"} · fetched{" "}
                      {item.fetchedAt ? formatTimestamp(item.fetchedAt) : "—"}
                    </div>
                  </div>
                  {item.symbols.length > 0 && (
                    <span className="row" style={{ gap: 4, flexShrink: 0 }}>
                      {item.symbols.map((symbol) => (
                        <SymbolChip key={symbol} symbol={symbol} onOpenSymbol={onOpenSymbol} />
                      ))}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <CapNote shown={visible.length} total={filtered.length} />
          {loading && <p className="muted small">Still loading company news…</p>}
        </>
      )}
    </Card>
  );
}


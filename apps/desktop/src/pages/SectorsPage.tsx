import { useMemo, useState, type ReactNode } from "react";
import { useApi } from "../hooks";
import { formatCompact, formatNumber } from "../api";
import { nptDate } from "../lib";
import type {
  Candle,
  CandlesResponse,
  CompaniesResponse,
  DataStateSummary,
  IndexQuote,
  IndicesResponse,
  Quote,
  QuotesResponse,
  ScreenerRow,
  SectorPerformance,
  SummaryResponse,
} from "../types";
import {
  Badge,
  Card,
  ClickableRow,
  DataStateBadge,
  Delta,
  EmptyState,
  MiniStats,
  Notice,
  Segmented,
  SortHeader,
  Spinner,
  Stat,
  Tabs,
  downloadCsv,
  formatTimestamp,
  heatStyle,
  useSort,
} from "../components/ui";
import { Icon } from "../components/icons";
import { PriceChart, type Overlay, type Study } from "../components/PriceChart";
import { mean, sectorKey, sumOrNull } from "../market/sectors";

// ---------------------------------------------------------------------------
// Page-local response shapes
// ---------------------------------------------------------------------------

/**
 * Screener fields added by the backend contract (item 4). They are optional
 * here so an API that has not been updated yet degrades to an explained empty
 * state instead of crashing.
 */
interface WeeklyScreenerRow extends ScreenerRow {
  return1W?: number | null;
  return2W?: number | null;
  avgVolume20?: number | null;
  volume3d?: number | null;
  volume3dRatio?: number | null;
  volume5d?: number | null;
  turnover5d?: number | null;
  avgAbsMove20?: number | null;
}

interface WeeklyScreenerResponse {
  providerId: string;
  generatedAt: string;
  rows: WeeklyScreenerRow[];
  dataState: DataStateSummary;
}

/** One company with everything the sector views need, joined once. */
interface MemberRow {
  symbol: string;
  name: string;
  sector: string;
  close: number | null;
  /** EOD change of the latest stored session; null if it did not trade that day. */
  change1D: number | null;
  return1W: number | null;
  return2W: number | null;
  volume5d: number | null;
  turnover5d: number | null;
  volume3dRatio: number | null;
  avgVolume20: number | null;
  /** volume5d ÷ (5 × avgVolume20). */
  weekVolumeRatio: number | null;
  avgAbsMove20: number | null;
  lastSession: string | null;
  stale: boolean;
}

interface SectorStat {
  sector: string;
  members: MemberRow[];
  traded: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  meanChange: number | null;
  subIndex: IndexQuote | null;
  published: SectorPerformance | null;
  volume5d: number | null;
  turnover5d: number | null;
  weeklyCovered: number;
}

type SectorTab = "sectors" | "sector-volume" | "stock-volume" | "trending" | "volatile";
type SectorSort = "change" | "volume" | "name" | "members";

const EMPTY_CANDLES: Candle[] = [];
const SUBINDEX_OVERLAYS: Overlay[] = ["sma50"];
const SUBINDEX_STUDIES: Study[] = [];

const WEEKLY_MISSING_REASON =
  "The running API's /api/screener rows do not include the weekly fields (return1W, return2W, volume5d, turnover5d, volume3dRatio, avgAbsMove20) yet. They come from the backend screener update; restart the API once it is in place. Nothing is estimated in the meantime.";

function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function numOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SectorsPage({
  onOpenSymbol,
}: {
  onOpenSymbol: (symbol: string) => void;
}) {
  const companiesState = useApi<CompaniesResponse>("/api/companies");
  const quotesState = useApi<QuotesResponse>("/api/quotes");
  const indicesState = useApi<IndicesResponse>("/api/indices");
  const summaryState = useApi<SummaryResponse>("/api/summary");
  const screenerState = useApi<WeeklyScreenerResponse>("/api/screener");

  const [tab, setTab] = useState<SectorTab>("sectors");
  const [activeOnly, setActiveOnly] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [sectorSort, setSectorSort] = useState<SectorSort>("change");

  const companies = companiesState.data?.companies ?? [];
  const allQuotes = quotesState.data?.quotes ?? [];
  const screenerRows = screenerState.data?.rows ?? [];
  const indices = indicesState.data?.indices ?? [];
  const published = summaryState.data?.sectors ?? null;

  const weeklyAvailable = useMemo(
    () => screenerRows.some((row) => row.volume5d !== undefined),
    [screenerRows],
  );

  // Only the latest stored session counts for the 1-day change.
  const latestSession = useMemo(() => {
    let latest: string | null = null;
    for (const quote of allQuotes) {
      const date = nptDate(quote.asOf);
      if (date && (!latest || date > latest)) latest = date;
    }
    return latest;
  }, [allQuotes]);

  const sessionQuotes = useMemo(() => {
    const map = new Map<string, Quote>();
    for (const quote of allQuotes) {
      if (nptDate(quote.asOf) === latestSession) map.set(quote.symbol, quote);
    }
    return map;
  }, [allQuotes, latestSession]);

  const screenerBySymbol = useMemo(
    () => new Map(screenerRows.map((row) => [row.symbol, row])),
    [screenerRows],
  );

  const universe = useMemo(
    () =>
      companies.filter(
        (company) =>
          !activeOnly ||
          (company.instrumentType === "Equity" && company.status === "active"),
      ),
    [companies, activeOnly],
  );

  const members = useMemo<MemberRow[]>(
    () =>
      universe.map((company) => {
        const quote = sessionQuotes.get(company.symbol);
        const row = screenerBySymbol.get(company.symbol);
        const volume5d = numOrNull(row?.volume5d);
        const avgVolume20 = numOrNull(row?.avgVolume20);
        return {
          symbol: company.symbol,
          name: company.name,
          sector: company.sector || "Unclassified",
          close: quote ? quote.ltp : numOrNull(row?.lastClose),
          change1D: quote && Number.isFinite(quote.changePercent) ? quote.changePercent : null,
          return1W: numOrNull(row?.return1W),
          return2W: numOrNull(row?.return2W),
          volume5d,
          turnover5d: numOrNull(row?.turnover5d),
          volume3dRatio: numOrNull(row?.volume3dRatio),
          avgVolume20,
          weekVolumeRatio:
            volume5d !== null && avgVolume20 !== null && avgVolume20 > 0
              ? volume5d / (5 * avgVolume20)
              : null,
          avgAbsMove20: numOrNull(row?.avgAbsMove20),
          lastSession: row?.to ?? (quote ? nptDate(quote.asOf) : null),
          stale: row?.provenance?.stale ?? false,
        };
      }),
    [universe, sessionQuotes, screenerBySymbol],
  );

  const subIndexByKey = useMemo(() => {
    const map = new Map<string, IndexQuote>();
    for (const index of indices) {
      if (!index.isSector) continue;
      for (const key of [sectorKey(index.name), sectorKey(index.symbol.replace(/_/g, " "))]) {
        if (key && !map.has(key)) map.set(key, index);
      }
    }
    return map;
  }, [indices]);

  const publishedByKey = useMemo(() => {
    const map = new Map<string, SectorPerformance>();
    for (const entry of published ?? []) {
      const key = sectorKey(entry.sector);
      if (key && !map.has(key)) map.set(key, entry);
    }
    return map;
  }, [published]);

  const stats = useMemo<SectorStat[]>(() => {
    const groups = new Map<string, MemberRow[]>();
    for (const member of members) {
      const list = groups.get(member.sector) ?? [];
      list.push(member);
      groups.set(member.sector, list);
    }
    return [...groups.entries()].map(([sector, list]) => {
      const changes = list
        .map((member) => member.change1D)
        .filter((value): value is number => value !== null);
      const volume = sumOrNull(list.map((member) => member.volume5d));
      const turnover = sumOrNull(list.map((member) => member.turnover5d));
      const key = sectorKey(sector);
      return {
        sector,
        members: list,
        traded: changes.length,
        advancers: changes.filter((value) => value > 0).length,
        decliners: changes.filter((value) => value < 0).length,
        unchanged: changes.filter((value) => value === 0).length,
        meanChange: mean(changes),
        subIndex: sector === "Unclassified" ? null : subIndexByKey.get(key) ?? null,
        published: sector === "Unclassified" ? null : publishedByKey.get(key) ?? null,
        volume5d: volume.total,
        turnover5d: turnover.total,
        weeklyCovered: volume.count,
      };
    });
  }, [members, subIndexByKey, publishedByKey]);

  const sortedStats = useMemo(() => {
    const list = [...stats];
    const nullsLast = (a: number | null, b: number | null) =>
      a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : b - a;
    if (sectorSort === "name") list.sort((a, b) => a.sector.localeCompare(b.sector));
    else if (sectorSort === "members") list.sort((a, b) => b.members.length - a.members.length);
    else if (sectorSort === "volume") list.sort((a, b) => nullsLast(a.turnover5d, b.turnover5d));
    else list.sort((a, b) => nullsLast(a.meanChange, b.meanChange));
    return list;
  }, [stats, sectorSort]);

  const unmatchedSubIndices = useMemo(() => {
    const used = new Set(
      stats.map((stat) => stat.subIndex?.symbol).filter((value): value is string => Boolean(value)),
    );
    return indices.filter((index) => index.isSector && !used.has(index.symbol));
  }, [stats, indices]);

  const unmatchedPublished = useMemo(() => {
    const used = new Set(stats.map((stat) => stat.published?.sector).filter(Boolean));
    return (published ?? []).filter((entry) => !used.has(entry.sector));
  }, [stats, published]);

  const selectedStat = stats.find((stat) => stat.sector === selected) ?? null;

  const openSector = (sector: string) => {
    setSelected(sector);
    setTab("sectors");
  };

  if (companiesState.loading || quotesState.loading) {
    return <Spinner label="Loading companies and end-of-day prices" />;
  }

  if (companiesState.error) {
    return (
      <EmptyState title="Could not load the company master">
        {companiesState.error}
      </EmptyState>
    );
  }

  if (companies.length === 0) {
    return (
      <EmptyState title="No companies stored">
        Sector views group the company master by sector. Automatic updates
        fetch the company list in the background while the app is open; open
        the <strong>Data</strong> page to check status or refresh now. If you
        are offline, import <code>companies.csv</code> from the Data page.
      </EmptyState>
    );
  }

  const tradedStats = stats.filter((stat) => stat.meanChange !== null);
  const up = tradedStats.filter((stat) => (stat.meanChange ?? 0) > 0).length;
  const down = tradedStats.filter((stat) => (stat.meanChange ?? 0) < 0).length;
  const best = [...tradedStats].sort((a, b) => (b.meanChange ?? 0) - (a.meanChange ?? 0))[0];
  const worst = [...tradedStats].sort((a, b) => (a.meanChange ?? 0) - (b.meanChange ?? 0))[0];
  const weekTurnover = sumOrNull(stats.map((stat) => stat.turnover5d)).total;
  const weekVolume = sumOrNull(stats.map((stat) => stat.volume5d)).total;
  const staleCount = members.filter((member) => member.stale).length;

  const screenerNotice = screenerState.loading ? (
    <Notice tone="info">
      Computing weekly volume and returns from stored candles (the first
      screener call after a data change can take a few seconds)…
    </Notice>
  ) : screenerState.error ? (
    <Notice tone="error">
      Screener unavailable ({screenerState.error}). Weekly volume, turnover and
      returns cannot be shown; the 1-day sector view still works from
      end-of-day quotes.
    </Notice>
  ) : !weeklyAvailable && screenerRows.length > 0 ? (
    <Notice tone="warn">{WEEKLY_MISSING_REASON}</Notice>
  ) : null;

  const weeklyGate = (content: ReactNode) =>
    screenerState.loading ? (
      <Spinner label="Computing weekly volume and returns" />
    ) : screenerState.error ? (
      <EmptyState title="Screener unavailable">{screenerState.error}</EmptyState>
    ) : !weeklyAvailable ? (
      <EmptyState title="Weekly fields not provided by this API">
        {WEEKLY_MISSING_REASON}
      </EmptyState>
    ) : (
      content
    );

  return (
    <div className="stack">
      <div className="stats-row">
        <Stat
          label="Session"
          value={latestSession ?? "—"}
          badge={<Badge tone="info">EOD</Badge>}
          hint={`${sessionQuotes.size} closes · ${universe.length} ${activeOnly ? "active equities" : "listed instruments"}`}
        />
        <Stat
          label="Sectors up / down"
          value={
            tradedStats.length > 0 ? (
              <span>
                <span className="tone-up">{up}</span>
                <span className="subtle"> / </span>
                <span className="tone-down">{down}</span>
              </span>
            ) : (
              "—"
            )
          }
          badge={<Badge tone="info">derived</Badge>}
          hint="equal-weighted 1-day change"
        />
        <Stat
          label="Best sector"
          value={best ? <Delta value={best.meanChange} /> : "—"}
          hint={best?.sector ?? "no closes in the session"}
          badge={<Badge tone="info">derived</Badge>}
        />
        <Stat
          label="Worst sector"
          value={worst ? <Delta value={worst.meanChange} /> : "—"}
          hint={worst?.sector ?? "no closes in the session"}
          badge={<Badge tone="info">derived</Badge>}
        />
        <Stat
          label="1-week turnover"
          value={weekTurnover !== null ? `Rs ${formatCompact(weekTurnover)}` : "—"}
          badge={<Badge tone="info">derived</Badge>}
          hint={
            weekVolume !== null
              ? `${formatCompact(weekVolume)} shares · last 5 sessions`
              : weeklyAvailable
                ? "no 5-session history"
                : "needs screener weekly fields"
          }
        />
      </div>

      <div className="row-between">
        <Tabs<SectorTab>
          label="Sector views"
          value={tab}
          onChange={setTab}
          items={[
            { value: "sectors", label: "Sectors", count: stats.length },
            { value: "sector-volume", label: "1-week volume by sector" },
            { value: "stock-volume", label: "1-week volume by stock" },
            { value: "trending", label: "Trending" },
            { value: "volatile", label: "Volatile" },
          ]}
        />
        <label
          className="checkbox"
          title={`${companies.length - companies.filter((company) => company.instrumentType === "Equity" && company.status === "active").length} instruments are not active equities (debentures, funds, promoter shares, delisted)`}
        >
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(event) => setActiveOnly(event.target.checked)}
          />
          <span>Active equities only</span>
        </label>
      </div>

      {screenerNotice}

      {tab === "sectors" && (
        <>
          <Card
            title="Sectors"
            subtitle={`${stats.length} sectors from the company master · session ${latestSession ?? "—"} · click a sector for its members`}
            action={
              <div className="card-actions">
                <Segmented<SectorSort>
                  label="Sort sectors"
                  value={sectorSort}
                  onChange={setSectorSort}
                  items={[
                    { value: "change", label: "1D" },
                    { value: "volume", label: "1W turnover" },
                    { value: "members", label: "Size" },
                    { value: "name", label: "A–Z" },
                  ]}
                />
                <Badge tone="info">derived</Badge>
              </div>
            }
            footer={
              <>
                Tile colour and the large number are the equal-weighted mean
                1-day change of members that closed in the latest stored session
                — not an official index. The sub-index line is the exchange
                sub-index (matched by name; “no sub-index” when none matches) and
                “published” is the source’s own sector-performance row, both
                unverified. 1-week volume and turnover are sums of members’ last
                5 sessions from the screener.{" "}
                {published === null &&
                  "No source-published sector performance is stored, so that line is omitted."}
              </>
            }
          >
            {stats.length === 0 ? (
              <EmptyState title="No companies in this universe" />
            ) : (
              <div className="heatmap">
                {sortedStats.map((stat) => (
                  <SectorTile
                    key={stat.sector}
                    stat={stat}
                    weeklyAvailable={weeklyAvailable}
                    selected={selected === stat.sector}
                    onSelect={() =>
                      setSelected((current) => (current === stat.sector ? null : stat.sector))
                    }
                  />
                ))}
              </div>
            )}
            {(unmatchedSubIndices.length > 0 || unmatchedPublished.length > 0) && (
              <p className="muted small" style={{ marginTop: 10 }}>
                {unmatchedSubIndices.length > 0 && (
                  <>
                    Sub-indices with no matching company sector:{" "}
                    {unmatchedSubIndices
                      .map(
                        (index) =>
                          `${index.name}${index.value !== null ? ` ${formatNumber(index.value)} (${pct(index.changePercent)})` : ""}`,
                      )
                      .join(", ")}
                    .{" "}
                  </>
                )}
                {unmatchedPublished.length > 0 && (
                  <>
                    Published sector rows with no company group in this view:{" "}
                    {unmatchedPublished
                      .map((entry) => `${entry.sector} (${pct(entry.changePercent)})`)
                      .join(", ")}
                    .
                  </>
                )}
              </p>
            )}
          </Card>

          {selectedStat ? (
            <SectorDetail
              stat={selectedStat}
              latestSession={latestSession}
              weeklyAvailable={weeklyAvailable}
              publishedAsOf={summaryState.data?.provenance.sectors?.asOf ?? null}
              onOpenSymbol={onOpenSymbol}
              onClose={() => setSelected(null)}
            />
          ) : (
            <p className="muted small">Select a sector above to see its companies and sub-index chart.</p>
          )}
        </>
      )}

      {tab === "sector-volume" &&
        weeklyGate(<SectorVolumeRanking stats={stats} onSelectSector={openSector} />)}

      {tab === "stock-volume" &&
        weeklyGate(
          <StockVolumeRanking
            members={members}
            staleCount={staleCount}
            onOpenSymbol={onOpenSymbol}
          />,
        )}

      {tab === "trending" &&
        weeklyGate(
          <TrendingView members={members} staleCount={staleCount} onOpenSymbol={onOpenSymbol} />,
        )}

      {tab === "volatile" &&
        weeklyGate(
          <VolatileView members={members} staleCount={staleCount} onOpenSymbol={onOpenSymbol} />,
        )}

      {screenerState.data && (
        <p className="muted small">
          Prices: end-of-day, unofficial (
          {quotesState.data && (
            <DataStateBadge
              state={quotesState.data.dataState.state}
              classification={quotesState.data.dataState.classification}
            />
          )}
          ). Weekly fields computed {formatTimestamp(screenerState.data.generatedAt)} from
          stored candles (derived). Sub-index levels come from stored index history.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sector tile + detail
// ---------------------------------------------------------------------------

function SectorTile({
  stat,
  weeklyAvailable,
  selected,
  onSelect,
}: {
  stat: SectorStat;
  weeklyAvailable: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const style = heatStyle(stat.meanChange, 2.5);
  const text = style.color ? { color: style.color } : undefined;
  const meta = style.color ? { color: style.color, opacity: 0.85 } : undefined;
  const subIndex = stat.subIndex;
  return (
    <button
      type="button"
      className="heat-tile"
      style={{ background: style.background, minHeight: 150 }}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="heat-name" style={text}>
        {stat.sector}
      </span>
      <span className="heat-meta" style={meta}>
        {stat.members.length} companies · {stat.traded} traded
      </span>
      <span className="heat-value" style={text}>
        {stat.meanChange === null ? "—" : pct(stat.meanChange)}
      </span>
      <span className="heat-meta" style={meta}>
        ▲{stat.advancers} ▼{stat.decliners} · equal-weighted 1D
      </span>
      <span className="heat-meta" style={meta}>
        {subIndex
          ? subIndex.value !== null
            ? `Sub-index ${formatNumber(subIndex.value)} (${pct(subIndex.changePercent)})`
            : "Sub-index: no stored history"
          : "no sub-index"}
      </span>
      {stat.published && (
        <span className="heat-meta" style={meta}>
          Published {pct(stat.published.changePercent)}
          {stat.published.turnover !== undefined && ` · Rs ${formatCompact(stat.published.turnover)}`}
        </span>
      )}
      <span className="heat-meta" style={meta}>
        {weeklyAvailable
          ? stat.volume5d !== null
            ? `1W ${formatCompact(stat.volume5d)} sh · Rs ${formatCompact(stat.turnover5d)}`
            : "1W volume: no 5-session history"
          : "1W volume: not provided"}
      </span>
    </button>
  );
}

function SectorDetail({
  stat,
  latestSession,
  weeklyAvailable,
  publishedAsOf,
  onOpenSymbol,
  onClose,
}: {
  stat: SectorStat;
  latestSession: string | null;
  weeklyAvailable: boolean;
  publishedAsOf: string | null;
  onOpenSymbol: (symbol: string) => void;
  onClose: () => void;
}) {
  const subIndex = stat.subIndex;
  return (
    <div className="stack">
      <Card
        title={stat.sector}
        subtitle={`${stat.members.length} companies · ${stat.traded} closed in session ${latestSession ?? "—"}`}
        action={
          <button type="button" className="button button-ghost button-small" onClick={onClose}>
            Close
          </button>
        }
      >
        <MiniStats
          items={[
            {
              label: "Equal-wt 1D",
              value: <Delta value={stat.meanChange} />,
              hint: `▲${stat.advancers} ▼${stat.decliners} ●${stat.unchanged}`,
            },
            {
              label: "Sub-index",
              value: subIndex
                ? subIndex.value !== null
                  ? formatNumber(subIndex.value)
                  : "no history"
                : "none",
              hint: subIndex
                ? subIndex.value !== null
                  ? `${subIndex.name} · ${pct(subIndex.changePercent)}`
                  : `${subIndex.name} not stored`
                : "no matching sub-index",
              tone:
                subIndex?.changePercent !== null && subIndex?.changePercent !== undefined
                  ? subIndex.changePercent > 0
                    ? "up"
                    : subIndex.changePercent < 0
                      ? "down"
                      : "flat"
                  : undefined,
            },
            {
              label: "Published",
              value: stat.published ? pct(stat.published.changePercent) : "—",
              hint: stat.published
                ? `source row · ${publishedAsOf ? formatTimestamp(publishedAsOf) : "as of —"}`
                : "not published for this sector",
            },
            {
              label: "Published turnover",
              value:
                stat.published?.turnover !== undefined
                  ? `Rs ${formatCompact(stat.published.turnover)}`
                  : "—",
              hint: "source, 1 day",
            },
            {
              label: "1W volume",
              value: weeklyAvailable ? formatCompact(stat.volume5d) : "—",
              hint: weeklyAvailable
                ? `${stat.weeklyCovered} of ${stat.members.length} with 5 sessions`
                : "not provided by API",
            },
            {
              label: "1W turnover",
              value:
                weeklyAvailable && stat.turnover5d !== null
                  ? `Rs ${formatCompact(stat.turnover5d)}`
                  : "—",
              hint: "sum of members",
            },
          ]}
        />
      </Card>

      <div className="grid main-side">
        <MembersTable
          title={`${stat.sector} — companies`}
          rows={stat.members}
          weeklyAvailable={weeklyAvailable}
          onOpenSymbol={onOpenSymbol}
        />
        <SubIndexChart index={subIndex} sector={stat.sector} />
      </div>
    </div>
  );
}

function SubIndexChart({ index, sector }: { index: IndexQuote | null; sector: string }) {
  const state = useApi<CandlesResponse>(
    index ? `/api/candles?kind=index&symbol=${encodeURIComponent(index.symbol)}` : null,
  );
  const candles = state.data?.candles ?? EMPTY_CANDLES;
  const provenance = state.data?.provenance ?? null;
  return (
    <Card
      title={index ? index.name : "Sub-index"}
      subtitle={
        index
          ? candles.length > 1
            ? `${candles[0]?.timestamp.slice(0, 10)} → ${candles.at(-1)?.timestamp.slice(0, 10)} · ${candles.length.toLocaleString()} sessions`
            : "end-of-day sub-index history"
          : `No exchange sub-index matches “${sector}”`
      }
      action={
        provenance ? (
          <DataStateBadge state={provenance.state} classification={provenance.classification} />
        ) : undefined
      }
      footer="Exchange sub-index level from stored end-of-day history (unofficial source). Sub-indices are capitalisation-weighted, so they can move differently from the equal-weighted tile."
    >
      {!index ? (
        <EmptyState title="No sub-index">
          The index list has no sector sub-index whose name matches this
          company sector, so there is nothing to chart. The equal-weighted
          member change is shown instead.
        </EmptyState>
      ) : state.loading ? (
        <Spinner label="Loading sub-index history" />
      ) : state.error ? (
        <EmptyState title="Could not load the sub-index">{state.error}</EmptyState>
      ) : candles.length < 2 ? (
        <EmptyState title={`No stored history for ${index.symbol}`}>
          The sub-index is listed but its daily history is not in the local
          store. Import <code>indices/{index.symbol}.csv</code> (Data → Import)
          to chart it.
        </EmptyState>
      ) : (
        <PriceChart
          key={index.symbol}
          candles={candles}
          variant="area"
          size="compact"
          defaultRange="1Y"
          defaultOverlays={SUBINDEX_OVERLAYS}
          defaultStudies={SUBINDEX_STUDIES}
          showVolume={false}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Reusable sortable member table
// ---------------------------------------------------------------------------

type MemberKey =
  | "symbol"
  | "sector"
  | "close"
  | "change1D"
  | "return1W"
  | "return2W"
  | "volume5d"
  | "turnover5d"
  | "volume3dRatio"
  | "weekVolumeRatio"
  | "avgAbsMove20"
  | "lastSession";

const MEMBER_COLUMNS: Record<
  MemberKey,
  { label: string; align: "left" | "right"; title?: string; render: (row: MemberRow) => ReactNode }
> = {
  symbol: {
    label: "Symbol",
    align: "left",
    render: (row) => (
      <>
        <strong>{row.symbol}</strong>
        <span className="cell-sub">{row.name}</span>
      </>
    ),
  },
  sector: { label: "Sector", align: "left", render: (row) => <span className="muted">{row.sector}</span> },
  close: { label: "Close", align: "right", render: (row) => formatNumber(row.close) },
  change1D: {
    label: "1D",
    align: "right",
    title: "End-of-day change in the latest stored session (— if it did not trade)",
    render: (row) => <Delta value={row.change1D} />,
  },
  return1W: { label: "1W", align: "right", title: "Calendar 7-day return", render: (row) => <Delta value={row.return1W} /> },
  return2W: { label: "2W", align: "right", title: "Calendar 14-day return", render: (row) => <Delta value={row.return2W} /> },
  volume5d: {
    label: "1W volume",
    align: "right",
    title: "Shares traded over the last 5 sessions",
    render: (row) => formatCompact(row.volume5d),
  },
  turnover5d: {
    label: "1W turnover",
    align: "right",
    title: "Turnover over the last 5 sessions",
    render: (row) => (row.turnover5d === null ? "—" : `Rs ${formatCompact(row.turnover5d)}`),
  },
  volume3dRatio: {
    label: "3D vol ×",
    align: "right",
    title: "Last 3 sessions' volume ÷ the average 3-session volume of the 20 sessions before them",
    render: (row) => (row.volume3dRatio === null ? "—" : `${formatNumber(row.volume3dRatio)}×`),
  },
  weekVolumeRatio: {
    label: "5D vol ×",
    align: "right",
    title: "Last 5 sessions' volume ÷ (5 × mean daily volume of the 20 sessions before the last)",
    render: (row) => (row.weekVolumeRatio === null ? "—" : `${formatNumber(row.weekVolumeRatio)}×`),
  },
  avgAbsMove20: {
    label: "Avg |move| 20",
    align: "right",
    title: "Mean absolute daily close-to-close move over the last 20 sessions",
    render: (row) => (row.avgAbsMove20 === null ? "—" : `${formatNumber(row.avgAbsMove20)}%`),
  },
  lastSession: {
    label: "Session",
    align: "left",
    render: (row) => (
      <span className="muted nowrap">
        {row.lastSession ?? "—"} {row.stale && <Badge tone="warn">stale</Badge>}
      </span>
    ),
  },
};

function SortableMembers({
  rows,
  columns,
  initial,
  ranked = false,
  limit,
  onOpenSymbol,
  emptyTitle = "No companies to show",
}: {
  rows: MemberRow[];
  columns: MemberKey[];
  initial: { key: MemberKey; direction: "asc" | "desc" };
  ranked?: boolean;
  limit?: number;
  onOpenSymbol: (symbol: string) => void;
  emptyTitle?: string;
}) {
  const { sorted, sort, toggle } = useSort<MemberRow, MemberKey>(rows, initial, (row, key) =>
    key === "symbol" ? row.symbol : row[key],
  );
  const visible = limit ? sorted.slice(0, limit) : sorted;
  if (rows.length === 0) return <EmptyState title={emptyTitle} />;
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            {ranked && <th className="rank">#</th>}
            {columns.map((key) => {
              const column = MEMBER_COLUMNS[key];
              return (
                <SortHeader
                  key={key}
                  label={column.label}
                  sortKey={key}
                  sort={sort}
                  onSort={toggle}
                  align={column.align}
                  defaultDirection={key === "symbol" || key === "sector" ? "asc" : "desc"}
                  title={column.title}
                />
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, index) => (
            <ClickableRow key={row.symbol} onClick={() => onOpenSymbol(row.symbol)}>
              {ranked && <td className="rank">{index + 1}</td>}
              {columns.map((key) => (
                <td key={key} className={MEMBER_COLUMNS[key].align === "right" ? "right" : undefined}>
                  {MEMBER_COLUMNS[key].render(row)}
                </td>
              ))}
            </ClickableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MembersTable({
  title,
  rows,
  weeklyAvailable,
  onOpenSymbol,
}: {
  title: string;
  rows: MemberRow[];
  weeklyAvailable: boolean;
  onOpenSymbol: (symbol: string) => void;
}) {
  const exportRows = () =>
    downloadCsv(
      `nepse-sector-${title.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.csv`,
      rows.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        close: row.close,
        change1D: row.change1D,
        return1W: row.return1W,
        return2W: row.return2W,
        volume1W: row.volume5d,
        turnover1W: row.turnover5d,
        volume3dRatio: row.volume3dRatio,
        lastSession: row.lastSession,
        classification: "DERIVED from UNVERIFIED end-of-day data",
      })),
    );
  return (
    <Card
      title={title}
      subtitle="Click a column to sort · click a row to open the company"
      action={
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={exportRows}
          disabled={rows.length === 0}
        >
          <Icon.Download /> CSV
        </button>
      }
      footer={
        weeklyAvailable
          ? "1W/2W are calendar 7/14-day returns; 1W volume is the last 5 sessions; 3D vol × compares the last 3 sessions with the 20 sessions before them. All derived from stored, unadjusted end-of-day candles."
          : WEEKLY_MISSING_REASON
      }
    >
      <SortableMembers
        rows={rows}
        columns={["symbol", "close", "change1D", "return1W", "return2W", "volume5d", "volume3dRatio", "lastSession"]}
        initial={{ key: "change1D", direction: "desc" }}
        onOpenSymbol={onOpenSymbol}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Ranking tabs
// ---------------------------------------------------------------------------

function SectorVolumeRanking({
  stats,
  onSelectSector,
}: {
  stats: SectorStat[];
  onSelectSector: (sector: string) => void;
}) {
  const [metric, setMetric] = useState<"volume" | "turnover">("turnover");
  const ranked = useMemo(() => {
    const valueOf = (stat: SectorStat) => (metric === "volume" ? stat.volume5d : stat.turnover5d);
    return stats
      .filter((stat) => valueOf(stat) !== null)
      .map((stat) => ({ stat, value: valueOf(stat)! }))
      .sort((a, b) => b.value - a.value);
  }, [stats, metric]);
  const total = ranked.reduce((sum, item) => sum + item.value, 0);
  const max = ranked[0]?.value ?? 0;

  return (
    <Card
      title="1-week volume by sector"
      subtitle="Sum of members' last 5 sessions · click a sector to open it"
      action={
        <div className="card-actions">
          <Segmented<"volume" | "turnover">
            label="Metric"
            value={metric}
            onChange={setMetric}
            items={[
              { value: "turnover", label: "Turnover (Rs)" },
              { value: "volume", label: "Shares" },
            ]}
          />
          <Badge tone="info">derived</Badge>
        </div>
      }
      footer="Turnover uses the exchange-reported daily turnover where the candle has it, else close × volume. Shares are not comparable across sectors with very different prices; turnover usually is."
    >
      {ranked.length === 0 ? (
        <EmptyState title="No sector has 5 sessions of stored volume" />
      ) : (
        <table className="table table-fixed">
          <tbody>
            {ranked.map(({ stat, value }, index) => (
              <ClickableRow key={stat.sector} onClick={() => onSelectSector(stat.sector)}>
                <td className="rank">{index + 1}</td>
                <td style={{ width: 220 }}>
                  <strong>{stat.sector}</strong>
                  <span className="cell-sub">
                    {stat.weeklyCovered} of {stat.members.length} companies with data
                  </span>
                </td>
                <td className="grow">
                  <div
                    aria-hidden="true"
                    style={{
                      height: 10,
                      borderRadius: 3,
                      width: `${max > 0 ? Math.max(1, (value / max) * 100) : 0}%`,
                      background: "var(--accent-border)",
                    }}
                  />
                </td>
                <td className="right nowrap" style={{ width: 130 }}>
                  {metric === "turnover" ? `Rs ${formatCompact(value)}` : formatCompact(value)}
                </td>
                <td className="right nowrap muted" style={{ width: 70 }}>
                  {total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "—"}
                </td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function StockVolumeRanking({
  members,
  staleCount,
  onOpenSymbol,
}: {
  members: MemberRow[];
  staleCount: number;
  onOpenSymbol: (symbol: string) => void;
}) {
  const [metric, setMetric] = useState<"volume" | "turnover">("volume");
  const ranked = useMemo(() => {
    const key = metric === "volume" ? "volume5d" : "turnover5d";
    return members
      .filter((member) => !member.stale && member[key] !== null)
      .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
  }, [members, metric]);
  const top = useMemo(() => ranked.slice(0, 50), [ranked]);

  const exportRows = () =>
    downloadCsv(
      `nepse-1w-${metric}-by-stock.csv`,
      ranked.map((row, index) => ({
        rank: index + 1,
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        close: row.close,
        return1W: row.return1W,
        volume1W: row.volume5d,
        turnover1W: row.turnover5d,
        volume3dRatio: row.volume3dRatio,
        lastSession: row.lastSession,
      })),
    );

  return (
    <Card
      title="1-week volume by stock"
      subtitle={`Top 50 of ${ranked.length} by last-5-session ${metric === "volume" ? "shares" : "turnover"} · re-sort within the top 50 by clicking a column`}
      action={
        <div className="card-actions">
          <Segmented<"volume" | "turnover">
            label="Rank by"
            value={metric}
            onChange={setMetric}
            items={[
              { value: "volume", label: "Shares" },
              { value: "turnover", label: "Turnover" },
            ]}
          />
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={exportRows}
            disabled={ranked.length === 0}
          >
            <Icon.Download /> CSV ({ranked.length})
          </button>
        </div>
      }
      footer={`Derived from stored end-of-day candles. ${staleCount} stale series (older than the freshness window) are excluded so an old week cannot rank as current.`}
    >
      <SortableMembers
        key={metric}
        rows={top}
        columns={["symbol", "sector", "close", "change1D", "return1W", "volume5d", "turnover5d", "volume3dRatio"]}
        initial={{ key: metric === "volume" ? "volume5d" : "turnover5d", direction: "desc" }}
        ranked
        onOpenSymbol={onOpenSymbol}
        emptyTitle="No stock has 5 sessions of stored volume"
      />
    </Card>
  );
}

function TrendingView({
  members,
  staleCount,
  onOpenSymbol,
}: {
  members: MemberRow[];
  staleCount: number;
  onOpenSymbol: (symbol: string) => void;
}) {
  const { confirmed, positive } = useMemo(() => {
    const live = members.filter((member) => !member.stale);
    const positiveWeek = live.filter((member) => (member.return1W ?? 0) > 0);
    return {
      positive: positiveWeek.length,
      confirmed: positiveWeek.filter(
        (member) => member.weekVolumeRatio !== null && member.weekVolumeRatio > 1,
      ),
    };
  }, [members]);
  const byWeek = useMemo(
    () =>
      [...confirmed]
        .sort((a, b) => (b.return1W ?? 0) - (a.return1W ?? 0))
        .slice(0, 25),
    [confirmed],
  );
  const byTwoWeeks = useMemo(
    () =>
      confirmed
        .filter((member) => member.return2W !== null)
        .sort((a, b) => (b.return2W ?? 0) - (a.return2W ?? 0))
        .slice(0, 25),
    [confirmed],
  );

  return (
    <div className="stack">
      <Notice tone="info">
        <strong>Rule:</strong> 1-week return &gt; 0 <em>and</em> volume
        confirmation — the last 5 sessions’ volume is above 5 × the mean daily
        volume of the 20 sessions before the last session (5D vol × &gt; 1).
        The baseline overlaps four of the five sessions, which makes the test
        stricter, not looser. {confirmed.length} of {positive} stocks with a
        positive week pass; {staleCount} stale series are excluded. Describes
        the past only — not a forecast or advice.
      </Notice>
      <div className="grid two">
        <Card title="Top by 1-week return" subtitle="Volume-confirmed · top 25" action={<Badge tone="info">derived</Badge>}>
          <SortableMembers
            rows={byWeek}
            columns={["symbol", "close", "return1W", "return2W", "weekVolumeRatio"]}
            initial={{ key: "return1W", direction: "desc" }}
            ranked
            onOpenSymbol={onOpenSymbol}
            emptyTitle="No stock passes the rule"
          />
        </Card>
        <Card title="Top by 2-week return" subtitle="Same rule · ranked by 14-day return · top 25" action={<Badge tone="info">derived</Badge>}>
          <SortableMembers
            rows={byTwoWeeks}
            columns={["symbol", "close", "return2W", "return1W", "weekVolumeRatio"]}
            initial={{ key: "return2W", direction: "desc" }}
            ranked
            onOpenSymbol={onOpenSymbol}
            emptyTitle="No stock passes the rule"
          />
        </Card>
      </div>
    </div>
  );
}

function VolatileView({
  members,
  staleCount,
  onOpenSymbol,
}: {
  members: MemberRow[];
  staleCount: number;
  onOpenSymbol: (symbol: string) => void;
}) {
  const [bucket, setBucket] = useState<"3" | "2-3" | "2">("3");
  const counts = useMemo(() => {
    let three = 0;
    let two = 0;
    for (const member of members) {
      if (member.stale || member.avgAbsMove20 === null) continue;
      if (member.avgAbsMove20 >= 3) three += 1;
      else if (member.avgAbsMove20 >= 2) two += 1;
    }
    return { three, two };
  }, [members]);
  const rows = useMemo(
    () =>
      members.filter((member) => {
        if (member.stale || member.avgAbsMove20 === null) return false;
        if (bucket === "3") return member.avgAbsMove20 >= 3;
        if (bucket === "2-3") return member.avgAbsMove20 >= 2 && member.avgAbsMove20 < 3;
        return member.avgAbsMove20 >= 2;
      }),
    [members, bucket],
  );

  const exportRows = () =>
    downloadCsv(
      `nepse-volatile-${bucket}.csv`,
      rows.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        avgAbsMove20: row.avgAbsMove20,
        close: row.close,
        change1D: row.change1D,
        return1W: row.return1W,
        return2W: row.return2W,
        volume1W: row.volume5d,
      })),
    );

  return (
    <Card
      title="Volatile stocks"
      subtitle={`Average absolute daily move over 20 sessions · ${counts.three} at ≥ 3% · ${counts.two} at 2–3%`}
      action={
        <div className="card-actions">
          <Segmented<"3" | "2-3" | "2">
            label="Bucket"
            value={bucket}
            onChange={setBucket}
            items={[
              { value: "3", label: `≥ 3% (${counts.three})` },
              { value: "2-3", label: `2–3% (${counts.two})` },
              { value: "2", label: `All ≥ 2% (${counts.three + counts.two})` },
            ]}
          />
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={exportRows}
            disabled={rows.length === 0}
          >
            <Icon.Download /> CSV
          </button>
        </div>
      }
      footer={`Avg |move| 20 = mean of |close ÷ previous close − 1| over the last 20 sessions, from stored unadjusted candles (a bonus/right adjustment day can inflate it). ${staleCount} stale series excluded.`}
    >
      <SortableMembers
        key={bucket}
        rows={rows}
        columns={["symbol", "sector", "avgAbsMove20", "close", "change1D", "return1W", "return2W", "volume5d"]}
        initial={{ key: "avgAbsMove20", direction: "desc" }}
        onOpenSymbol={onOpenSymbol}
        emptyTitle="No stock in this bucket"
      />
    </Card>
  );
}

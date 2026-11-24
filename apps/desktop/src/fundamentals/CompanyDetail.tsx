import { memo, useMemo, useState, type ReactNode } from "react";
import { formatCompact, formatNumber } from "../api";
import type { ApiState } from "../hooks";
import type {
  Company,
  CorporateActionsResponse,
  FloorsheetResponse,
  FloorsheetTrade,
  FundamentalsResponse,
  NewsItem,
  NewsResponse,
  Provenance,
  QuotesResponse,
  DataStateSummary,
} from "../types";
import {
  Badge,
  Card,
  EmptyState,
  MiniStats,
  Segmented,
  Spinner,
  Tabs,
  formatTimestamp,
} from "../components/ui";
import {
  CAP_RULE,
  FUND_METRIC_KEYS,
  METRICS,
  actionFiscalYear,
  actionKind,
  actionPercent,
  capClasses,
  closeMap,
  companyEventsPath,
  dividendYears,
  fiveYearDividends,
  fiscalYearLabel,
  formatKind,
  formatRsBig,
  formatStored,
  isFundSnapshot,
  marketCapUniverse,
  mergeSnapshots,
  otherKeys,
  pickInSnapshot,
  ratios,
  resolveMarketCap,
  storedLabel,
  NONE,
  type CapClass,
  type CompanyEventsResponse,
  type CompanyEvent,
  type MergedFundamentals,
  type Val,
} from "./model";
import { CapBadge, DerivedMark, MissingData, ProvenanceLine, ValCell } from "./parts";
import { useCachedApi, useCachedSelect } from "./useCachedApi";

type DetailTab = "profile" | "fundamentals" | "dividends" | "events" | "floorsheet";

export interface CompanyDetailProps {
  symbol: string;
  company: Company | undefined;
  companies: Company[];
  /** Last stored end-of-day close (from the candle series). */
  lastClose: number | null;
  lastCloseDate: string | null;
  fundamentals: ApiState<FundamentalsResponse>;
  actions: ApiState<CorporateActionsResponse>;
  news: ApiState<NewsResponse>;
  /** Import provenance of this company's master row. */
  companyProvenance?: Provenance | null;
}

function statusOf(error: string | null): number | null {
  const match = error?.match(/^(\d{3}):/);
  return match?.[1] ? Number(match[1]) : null;
}

function cashYield(cashPercent: number | null, paidUp: number | undefined, close: number | null, what: string): Val {
  if (cashPercent === null) return { ...NONE, note: "no cash dividend listed" };
  if (!paidUp || paidUp <= 0) return { ...NONE, note: "paid-up value per share not stored" };
  if (close === null || close <= 0) return { ...NONE, note: "no stored close" };
  return {
    value: ((cashPercent / 100) * paidUp * 100) / close,
    derived: true,
    note: `derived: ${what} cash dividend % × paid-up value (Rs ${paidUp}) ÷ last close`,
  };
}

/**
 * "Company detail" — profile, fundamentals, dividends, events/news and the
 * latest floorsheet for one symbol. Heavy datasets (events, floorsheet) load
 * only when their tab is first opened and are cached across tab switches.
 */
export const CompanyDetail = memo(function CompanyDetail(props: CompanyDetailProps) {
  const { symbol, company, companies, lastClose, fundamentals } = props;
  const [tab, setTab] = useState<DetailTab>("profile");
  const [opened, setOpened] = useState<Partial<Record<DetailTab, boolean>>>({ profile: true });
  const quotesState = useCachedApi<QuotesResponse>("/api/quotes");

  const merged = useMemo<MergedFundamentals | null>(() => {
    const data = fundamentals.data;
    if (!data) return null;
    const snapshots = [...(data.history ?? []), ...(data.latest ? [data.latest] : [])];
    return snapshots.length > 0 ? mergeSnapshots(symbol, snapshots) : null;
  }, [fundamentals.data, symbol]);

  const closes = useMemo(() => closeMap(quotesState.data?.quotes ?? []), [quotesState.data]);
  const close = lastClose ?? closes.get(symbol) ?? null;
  const cap = useMemo(() => resolveMarketCap(merged, company, close), [merged, company, close]);
  const capClass = useMemo(() => {
    const overrides = new Map<string, MergedFundamentals>(merged ? [[symbol, merged]] : []);
    const universe = marketCapUniverse(companies, closes, overrides);
    if (cap.value !== null && company?.instrumentType === "Equity") universe.set(symbol, cap);
    const classes = capClasses(new Map([...universe.entries()].map(([key, val]) => [key, val.value ?? 0])));
    return { value: classes.get(symbol) ?? null, size: universe.size };
  }, [companies, closes, merged, symbol, cap, company]);

  const change = (next: DetailTab) => {
    setTab(next);
    setOpened((current) => (current[next] ? current : { ...current, [next]: true }));
  };

  return (
    <Card
      title="Company detail"
      subtitle="Public profile, fundamentals, dividends, disclosures and the latest stored floorsheet"
    >
      <Tabs<DetailTab>
        label="Company detail"
        value={tab}
        onChange={change}
        items={[
          { value: "profile", label: "Profile" },
          { value: "fundamentals", label: "Fundamentals" },
          {
            value: "dividends",
            label: "Dividends & rights",
            ...(props.actions.data ? { count: props.actions.data.actions.length } : {}),
          },
          { value: "events", label: "Events & news" },
          { value: "floorsheet", label: "Floorsheet" },
        ]}
      />
      {tab === "profile" && (
        <ProfilePanel
          company={company}
          symbol={symbol}
          cap={cap}
          capClass={capClass.value}
          capUniverse={capClass.size}
          provenance={props.companyProvenance ?? null}
        />
      )}
      {tab === "fundamentals" && (
        <FundamentalsPanel
          symbol={symbol}
          state={fundamentals}
          merged={merged}
          close={close}
          closeDate={lastClose !== null ? props.lastCloseDate : null}
          company={company}
          cap={cap}
        />
      )}
      {tab === "dividends" && (
        <DividendsPanel symbol={symbol} state={props.actions} company={company} close={close} />
      )}
      {opened.events && (
        <div hidden={tab !== "events"}>
          <EventsPanel symbol={symbol} company={company} news={props.news} />
        </div>
      )}
      {opened.floorsheet && (
        <div hidden={tab !== "floorsheet"}>
          <FloorsheetPanel symbol={symbol} />
        </div>
      )}
    </Card>
  );
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function websiteHref(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function ProfilePanel({
  company,
  symbol,
  cap,
  capClass,
  capUniverse,
  provenance,
}: {
  company: Company | undefined;
  symbol: string;
  cap: Val;
  capClass: CapClass | null;
  capUniverse: number;
  provenance: Provenance | null;
}) {
  if (!company) {
    return (
      <MissingData title={`${symbol} is not in the company master`}>
        <p>
          Automatic updates fetch the public company list in the background
          while the app is open. Open the <strong>Data</strong> page to check
          status or refresh now. If you are offline, put{" "}
          <code>companies.csv</code> in the app data folder and import it from
          the Data page.
        </p>
      </MissingData>
    );
  }
  const fields: Array<{ label: string; value: ReactNode | null; raw: unknown }> = [
    { label: "Company name", value: company.name || null, raw: company.name },
    { label: "Sector", value: company.sector || null, raw: company.sector },
    { label: "Instrument", value: company.instrumentType || null, raw: company.instrumentType },
    {
      label: "Status",
      value: company.status ? <Badge tone={company.status === "active" ? "good" : "warn"}>{company.status}</Badge> : null,
      raw: company.status,
    },
    {
      label: "Shares outstanding",
      value: company.sharesOutstanding
        ? `${company.sharesOutstanding.toLocaleString("en-US", { maximumFractionDigits: 2 })} (${formatCompact(company.sharesOutstanding)})`
        : null,
      raw: company.sharesOutstanding,
    },
    {
      label: "Paid-up value / share",
      value: company.paidUpValue ? `Rs ${formatNumber(company.paidUpValue)}` : null,
      raw: company.paidUpValue,
    },
    {
      label: "Total paid-up capital",
      value: company.totalPaidUpValue ? formatRsBig(company.totalPaidUpValue) : null,
      raw: company.totalPaidUpValue,
    },
    {
      label: "Market cap",
      value:
        cap.value !== null ? (
          <>
            {formatRsBig(cap.value)}
            {cap.derived && <DerivedMark title={cap.note} />} <CapBadge value={capClass} />
          </>
        ) : null,
      raw: cap.value,
    },
    { label: "Listed", value: company.listedAt ? company.listedAt.slice(0, 10) : null, raw: company.listedAt },
    { label: "In operation since", value: company.operationDate || null, raw: company.operationDate },
    { label: "Share registrar", value: company.registrar || null, raw: company.registrar },
    { label: "Regulatory body", value: company.regulatoryBody || null, raw: company.regulatoryBody },
    { label: "Address", value: company.address || null, raw: company.address },
    { label: "Phone", value: company.phone || null, raw: company.phone },
    {
      label: "Email",
      value: company.email ? <a href={`mailto:${company.email}`}>{company.email}</a> : null,
      raw: company.email,
    },
    {
      label: "Website",
      value: company.website ? (
        <a href={websiteHref(company.website)} target="_blank" rel="noreferrer">
          {company.website}
        </a>
      ) : null,
      raw: company.website,
    },
  ];
  const shown = fields.filter((field) => field.value !== null && field.raw !== "" && field.raw !== undefined && field.raw !== null);
  const missing = fields.filter((field) => !shown.includes(field)).map((field) => field.label);
  const profileFetched = Boolean(company.profileAsOf || company.profileSource);

  return (
    <div className="stack">
      {!profileFetched && (
        <MissingData title="Public profile not fetched yet">
          <p>
            Only the company master row is stored. Use{" "}
            <strong>Fetch company profiles</strong> on the{" "}
            <strong>Data</strong> page to load shares outstanding, paid-up
            value, registrar and contacts from the public company pages. Market
            prices and the floorsheet update automatically.
          </p>
        </MissingData>
      )}
      <div className="kv">
        {shown.map((field) => (
          <div key={field.label}>
            <span>{field.label}</span>
            <strong>{field.value}</strong>
          </div>
        ))}
      </div>
      {missing.length > 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          Not published / not stored: {missing.join(", ")}.
        </p>
      )}
      <div className="card-footer" style={{ marginTop: 0 }}>
        <div className="stack-sm">
          <ProvenanceLine
            provenance={provenance}
            sources={company.profileSource ? [company.profileSource] : ["company master"]}
            asOf={company.profileAsOf ?? null}
          />
          <span className="small">
            Market cap: {cap.note}. {CAP_RULE} ({capUniverse} equities ranked; peers use the
            company master and last close.)
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fundamentals
// ---------------------------------------------------------------------------

function FundamentalsPanel({
  symbol,
  state,
  merged,
  close,
  closeDate,
  company,
  cap,
}: {
  symbol: string;
  state: ApiState<FundamentalsResponse>;
  merged: MergedFundamentals | null;
  close: number | null;
  closeDate: string | null;
  company: Company | undefined;
  cap: Val;
}) {
  const r = useMemo(() => ratios(merged, close), [merged, close]);
  const groups = useMemo(() => otherKeys(merged ? [merged] : []), [merged]);

  if (state.loading) return <Spinner label="Loading fundamentals" />;
  if (!merged) {
    return (
      <MissingData
        title={`No fundamentals stored for ${symbol}`}
        status={statusOf(state.error)}
        error={statusOf(state.error) === 404 ? null : state.error}
      />
    );
  }

  const provenance = state.data?.provenance.history ?? state.data?.provenance.latest ?? null;
  const snapshots = [...merged.snapshots].reverse();

  if (merged.snapshots.every(isFundSnapshot)) {
    const latest = merged.snapshots.at(-1)!;
    return (
      <div className="stack">
        <MiniStats
          items={[...FUND_METRIC_KEYS]
            .filter((key) => latest.metrics[key])
            .map((key) => ({ label: storedLabel(key), value: formatStored(latest.metrics[key], key) }))}
        />
        <ProvenanceLine provenance={provenance} sources={merged.sources} asOf={merged.reportedAt} />
        <p className="muted small" style={{ margin: 0 }}>
          Mutual fund: only NAV figures are published (weekly/monthly as displayed);
          EPS, P/E and book value do not apply.
        </p>
      </div>
    );
  }

  const latestCash = r.dividend.value;
  const quick: Array<{ label: string; val: Val; kind: Parameters<typeof formatKind>[1] }> = [
    {
      label: "P/E on last close",
      val:
        close && r.eps.value !== null && r.eps.value > 0
          ? { value: close / r.eps.value, derived: true, note: "derived: last close ÷ EPS" }
          : { ...NONE, note: "needs EPS > 0 and a stored close" },
      kind: "ratio",
    },
    {
      label: "P/B on last close",
      val:
        close && r.bvps.value !== null && r.bvps.value > 0
          ? { value: close / r.bvps.value, derived: true, note: "derived: last close ÷ book value per share" }
          : { ...NONE, note: "needs book value per share and a stored close" },
      kind: "ratio",
    },
    { label: "Earnings yield", val: r.earningsYield, kind: "percent" },
    {
      label: "ROE ≈ EPS ÷ BVPS",
      val:
        r.eps.value !== null && r.bvps.value !== null && r.bvps.value > 0
          ? { value: (r.eps.value / r.bvps.value) * 100, derived: true, note: "derived: EPS ÷ BVPS × 100" }
          : NONE,
      kind: "percent",
    },
    { label: "Dividend yield", val: cashYield(latestCash, company?.paidUpValue, close, "latest listed"), kind: "percent" },
  ];

  const historyColumns = METRICS.filter((def) =>
    merged.snapshots.some((snapshot) => pickInSnapshot(snapshot, def.key) !== null),
  );
  const missing = [
    ["EPS", r.eps],
    ["P/E", r.pe],
    ["Book value/share", r.bvps],
    ["P/B", r.pb],
    ["ROE", r.roe],
    ["ROA", r.roa],
    ["NPL", r.npl],
    ["Cash dividend", r.dividend],
    ["Bonus", r.bonus],
  ]
    .filter(([, val]) => (val as Val).value === null)
    .map(([label]) => label as string);

  const statement = (keys: string[], title: string) =>
    keys.length === 0 ? null : (
      <details>
        <summary className="muted small">
          {title} ({keys.length} lines)
        </summary>
        <StoredTable keys={keys} merged={merged} />
      </details>
    );

  return (
    <div className="stack">
      <MiniStats
        items={[
          { label: "EPS", value: <ValCell val={r.eps} kind="rs" />, hint: periodHint(r.eps) },
          { label: "P/E", value: <ValCell val={r.pe} kind="ratio" />, hint: periodHint(r.pe) },
          { label: "Book value / share", value: <ValCell val={r.bvps} kind="rs" />, hint: periodHint(r.bvps) },
          { label: "P/B", value: <ValCell val={r.pb} kind="ratio" />, hint: periodHint(r.pb) },
          { label: "ROE", value: <ValCell val={r.roe} kind="percent" />, hint: periodHint(r.roe) },
          { label: "ROA", value: <ValCell val={r.roa} kind="percent" />, hint: periodHint(r.roa) },
          { label: "NPL", value: <ValCell val={r.npl} kind="percent" />, hint: periodHint(r.npl) },
          { label: "Cash dividend", value: <ValCell val={r.dividend} kind="percent" />, hint: periodHint(r.dividend) },
          { label: "Bonus", value: <ValCell val={r.bonus} kind="percent" />, hint: periodHint(r.bonus) },
          { label: "Market cap", value: <ValCell val={cap} kind="rsBig" />, hint: cap.derived ? "derived" : "as displayed" },
        ]}
      />

      <div>
        <h4 className="muted small" style={{ margin: "0 0 8px" }}>
          Quick ratios on the last stored close{" "}
          {close !== null ? `(Rs ${formatNumber(close)}${closeDate ? `, ${closeDate}` : ""})` : ""} —{" "}
          <Badge tone="info">derived</Badge>
        </h4>
        <MiniStats
          items={quick.map((item) => ({
            label: item.label,
            value: <ValCell val={item.val} kind={item.kind} />,
            hint: item.val.value === null ? item.val.note : undefined,
          }))}
        />
        <p className="muted small" style={{ margin: "8px 0 0" }}>
          Published P/E and P/B use the source’s price when the page was fetched; these
          use the last stored end-of-day close, so the two can differ.
        </p>
      </div>

      {historyColumns.length > 0 && (
        <div className="table-scroll short">
          <table className="table">
            <thead>
              <tr>
                <th>Stored period</th>
                {historyColumns.map((def) => (
                  <th key={def.key} className="right">
                    {def.short}
                  </th>
                ))}
                <th>Reported</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snapshot) => (
                <tr key={snapshot.period}>
                  <td className="nowrap">
                    <strong>{snapshot.period}</strong>
                  </td>
                  {historyColumns.map((def) => {
                    const value = pickInSnapshot(snapshot, def.key);
                    return (
                      <td key={def.key} className="right nowrap">
                        {value === null ? <span className="subtle">—</span> : formatKind(value, def.kind)}
                      </td>
                    );
                  })}
                  <td className="muted small nowrap">{snapshot.reportedAt?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {groups.km.length > 0 && (
        <div>
          <h4 className="muted small" style={{ margin: "0 0 8px" }}>
            Key metrics as displayed (latest quarterly statement)
          </h4>
          <StoredTable keys={groups.km} merged={merged} />
        </div>
      )}
      {statement(groups.pl, "Profit & loss as displayed, Rs ’000")}
      {statement(groups.bs, "Balance sheet as displayed, Rs ’000")}

      <div className="card-footer" style={{ marginTop: 0 }}>
        <div className="stack-sm">
          <ProvenanceLine provenance={provenance} sources={merged.sources} asOf={merged.reportedAt} derived />
          <span className="small">
            Values as displayed by Merolagani (key ratios) and ShareSansar
            (latest quarterly statement, unaudited). <strong>d</strong> = DERIVED locally.
            Merolagani’s EPS is shown for the fiscal year / quarter it labels (a Q1–Q3
            figure may be part-year) and its P/E uses that figure; the statement EPS is
            labelled annualised by ShareSansar.
            {missing.length > 0 && ` Not published for ${symbol}: ${missing.join(", ")}.`} Audited
            multi-year statements, cash-flow statements and full historical balance sheets are
            not published by the free pages; only the periods listed above are stored.
          </span>
        </div>
      </div>
    </div>
  );
}

function periodHint(val: Val): string | undefined {
  if (val.value === null) return undefined;
  if (val.derived) return "derived";
  const fy = val.note.match(/FY ([0-9/]+)( Q\d)?/);
  return fy ? `FY ${fy[1]}${fy[2] ?? ""}` : val.period;
}

function StoredTable({ keys, merged }: { keys: string[]; merged: MergedFundamentals }) {
  return (
    <div className="table-scroll short">
      <table className="table">
        <thead>
          <tr>
            <th>Line</th>
            <th className="right">Value</th>
            <th>Period</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const stored = merged.values.get(key);
            return (
              <tr key={key}>
                <td>{storedLabel(key, stored?.metric)}</td>
                <td className="right nowrap">{formatStored(stored?.metric, key)}</td>
                <td className="muted small nowrap">{stored?.period ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dividends & rights
// ---------------------------------------------------------------------------

function DividendsPanel({
  symbol,
  state,
  company,
  close,
}: {
  symbol: string;
  state: ApiState<CorporateActionsResponse>;
  company: Company | undefined;
  close: number | null;
}) {
  const eventsState = useCachedApi<CompanyEventsResponse>(companyEventsPath(symbol));
  const actions = useMemo(() => state.data?.actions ?? [], [state.data]);
  const events = useMemo(() => eventsState.data?.events ?? [], [eventsState.data]);
  const summary = useMemo(() => fiveYearDividends(actions, events), [actions, events]);
  const allYears = useMemo(() => dividendYears(actions, events), [actions, events]);

  if (state.loading || eventsState.loading) return <Spinner label="Loading dividend history" />;
  if (allYears.length === 0 && actions.length === 0) {
    return (
      <MissingData
        title={`No dividend, bonus or right history stored for ${symbol}`}
        status={statusOf(state.error)}
        error={state.error}
        endpoint="/api/corporate-actions"
      />
    );
  }

  const paidUp = company?.paidUpValue;
  const latest = summary.years[0];
  const latestCash = summary.years.find((year) => year.cash !== null);
  const latestBonus = summary.years.find((year) => year.bonus !== null);

  return (
    <div className="stack">
      <MiniStats
        items={[
          {
            label: "Latest cash dividend",
            value: latestCash?.cash != null ? `${formatNumber(latestCash.cash)}%` : "—",
            hint: latestCash ? `FY ${latestCash.fiscalYear}` : "none listed",
          },
          {
            label: "Latest bonus",
            value: latestBonus?.bonus != null ? `${formatNumber(latestBonus.bonus)}%` : "—",
            hint: latestBonus ? `FY ${latestBonus.fiscalYear}` : "none listed",
          },
          {
            label: "5-yr avg cash",
            value: summary.cashAverage === null ? "—" : `${formatNumber(summary.cashAverage)}%`,
            hint: `${summary.cashYears} listed years`,
          },
          {
            label: "5-yr avg bonus",
            value: summary.bonusAverage === null ? "—" : `${formatNumber(summary.bonusAverage)}%`,
            hint: `${summary.bonusYears} listed years`,
          },
          {
            label: "Dividend yield",
            value: <ValCell val={cashYield(latestCash?.cash ?? null, paidUp, close, "latest listed")} kind="percent" />,
            hint: "latest cash ÷ close (derived)",
          },
          {
            label: "5-yr avg yield",
            value: <ValCell val={cashYield(summary.cashAverage, paidUp, close, "5-year average")} kind="percent" />,
            hint: "avg cash ÷ close (derived)",
          },
        ]}
      />

      <div className="table-scroll short">
        <table className="table">
          <thead>
            <tr>
              <th>Fiscal year</th>
              <th className="right">Cash %</th>
              <th className="right">Bonus %</th>
              <th>Right</th>
              <th className="right">Cash / share</th>
              <th className="right">Yield on close</th>
              <th>Listed by</th>
            </tr>
          </thead>
          <tbody>
            {summary.years.map((year) => {
              const perShare = year.cash !== null && paidUp ? (year.cash / 100) * paidUp : null;
              const yieldVal = cashYield(year.cash, paidUp, close, `FY ${year.fiscalYear}`);
              return (
                <tr key={year.start}>
                  <td>
                    <strong>FY {year.fiscalYear}</strong>
                    {year === latest && <span className="cell-sub">latest listed</span>}
                  </td>
                  <td className="right">{year.cash === null ? "—" : `${formatNumber(year.cash)}%`}</td>
                  <td className="right">{year.bonus === null ? "—" : `${formatNumber(year.bonus)}%`}</td>
                  <td className="muted">{year.right ?? "—"}</td>
                  <td className="right">
                    {perShare === null ? (
                      "—"
                    ) : (
                      <span title={`derived: ${formatNumber(year.cash)}% × Rs ${paidUp} paid-up`}>
                        Rs {formatNumber(perShare)}
                        <DerivedMark />
                      </span>
                    )}
                  </td>
                  <td className="right">
                    <ValCell val={yieldVal} kind="percent" />
                  </td>
                  <td className="muted small">
                    {year.sources.join(" + ")}
                    {year.conflict && (
                      <span className="cell-sub tone-down" title="Merolagani value kept">
                        ⚠ {year.conflict}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {actions.length > 0 && (
      <details>
        <summary className="muted small">All stored corporate actions ({actions.length})</summary>
        <div className="table-scroll short">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th className="right">% of paid-up</th>
                <th>Fiscal year</th>
                <th>Announced</th>
                <th>Book close / ex</th>
                <th>Source</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action, index) => {
                const percent = actionPercent(action);
                const kind = actionKind(action.type);
                return (
                  <tr key={`${action.type}-${index}`}>
                    <td>
                      <Badge tone={kind === "cash" ? "good" : kind === "bonus" ? "info" : "neutral"}>{action.type}</Badge>
                    </td>
                    <td className="right">{percent === null ? (action.ratio ?? "—") : `${formatNumber(percent)}%`}</td>
                    <td className="muted">{fiscalYearLabel(actionFiscalYear(action)) ?? "—"}</td>
                    <td className="muted small">{action.announcedAt?.slice(0, 10) ?? "—"}</td>
                    <td className="muted small">{(action.recordDate ?? action.exDate)?.slice(0, 10) ?? "—"}</td>
                    <td className="small">
                      {action.sourceUrl ? (
                        <a href={action.sourceUrl} target="_blank" rel="noreferrer">
                          link
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="muted small">{action.notes ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
      )}

      <div className="card-footer" style={{ marginTop: 0 }}>
        <div className="stack-sm">
          <ProvenanceLine
            provenance={state.data?.provenance}
            dataState={state.data?.dataState}
            sources={events.some((event) => event.type === "dividend") ? ["merolagani", "sharesansar (dividend events)"] : ["merolagani"]}
          />
          <span className="small">
            Percentages of paid-up value as listed: Merolagani’s dividend history,
            with ShareSansar’s dividend announcements filling years or bonus figures Merolagani
            does not list (a disagreement is flagged ⚠ and the Merolagani value kept).
            {allYears.length > summary.years.length && ` ${allYears.length} fiscal years are listed in all; the five most recent are shown.`}{" "}
            0% years are not listed, so — can mean “none declared” or “not listed”; averages
            use listed years only.
            Cash per share and yields are DERIVED (cash % × paid-up value{paidUp ? ` Rs ${paidUp}` : ", not stored"} ÷
            last close). Stored prices are not adjusted for these actions.
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Events & news
// ---------------------------------------------------------------------------

const EVENT_GROUPS: Array<{ type: string; label: string }> = [
  { type: "announcement", label: "Announcements" },
  { type: "agm", label: "AGM" },
  { type: "rightShare", label: "Right share" },
  { type: "dividend", label: "Dividend" },
  { type: "companyNews", label: "News" },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(item: NewsItem, symbol: string, name: string | undefined): boolean {
  if (item.symbols?.some((value) => value.toUpperCase() === symbol)) return true;
  const text = `${item.title} ${item.summary ?? ""}`;
  if (new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(symbol)}([^A-Za-z0-9]|$)`).test(text)) return true;
  const core = name?.replace(/\b(limited|ltd\.?|company|co\.?)\b/gi, "").trim();
  return Boolean(core && core.length >= 6 && text.toLowerCase().includes(core.toLowerCase()));
}

function EventsPanel({
  symbol,
  company,
  news,
}: {
  symbol: string;
  company: Company | undefined;
  news: ApiState<NewsResponse>;
}) {
  const state = useCachedApi<CompanyEventsResponse>(companyEventsPath(symbol));
  const grouped = useMemo(() => {
    const events = state.data?.events ?? [];
    const known = new Set(EVENT_GROUPS.map((group) => group.type));
    const groups = EVENT_GROUPS.map((group) => ({
      ...group,
      events: events.filter((event) => event.type === group.type),
    }));
    const others = events.filter((event) => !known.has(event.type));
    if (others.length > 0) groups.push({ type: "other", label: "Other", events: others });
    return groups;
  }, [state.data]);
  const related = useMemo(
    () => (news.data?.news ?? []).filter((item) => mentions(item, symbol, company?.name)),
    [news.data, symbol, company?.name],
  );

  const total = state.data?.events.length ?? 0;

  return (
    <div className="stack">
      {state.loading ? (
        <Spinner label="Loading company events" />
      ) : state.error || !state.data ? (
        <MissingData
          title="Company events unavailable"
          status={state.status}
          error={state.error}
          endpoint="/api/company-events"
        />
      ) : state.data.source === null ? (
        <MissingData title="No company events stored yet">
          <p>
            {state.data.unavailableReason ?? "company-events.csv has not been written to the data folder."}{" "}
            Use <strong>Fetch company profiles</strong> on the{" "}
            <strong>Data</strong> page to load announcements, AGMs, right
            shares, dividends and company news from the public company pages.
          </p>
        </MissingData>
      ) : total === 0 ? (
        <EmptyState title={`No events stored for ${symbol}`}>
          The events file exists ({state.data.types.length} event types across all companies) but
          has no rows for this symbol.
        </EmptyState>
      ) : (
        <div className="grid two">
          {grouped
            .filter((group) => group.events.length > 0)
            .map((group) => (
              <EventGroup key={group.type} label={group.label} events={group.events} />
            ))}
        </div>
      )}
      {state.data?.source && (
        <ProvenanceLine
          dataState={state.data.dataState}
          sources={[...new Set((state.data.events ?? []).map((event) => event.source ?? "sharesansar"))]}
          asOf={state.data.source.modifiedAt}
          extra={
            grouped.some((group) => group.events.length === 0) ? (
              <span className="muted small">
                none stored for {symbol}:{" "}
                {grouped
                  .filter((group) => group.events.length === 0)
                  .map((group) => group.label)
                  .join(", ")}
              </span>
            ) : undefined
          }
        />
      )}

      <div>
        <h4 className="muted small" style={{ margin: "0 0 8px" }}>
          Market headlines mentioning {symbol}
        </h4>
        {news.loading ? (
          <Spinner label="Loading news" />
        ) : (news.data?.news.length ?? 0) === 0 ? (
          <MissingData title="No market news stored" />
        ) : related.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            None of the {news.data?.news.length} stored headlines mention {symbol}
            {company?.name ? ` or “${company.name}”` : ""}. Headlines are market-wide and
            matched by symbol or company name.
          </p>
        ) : (
          <ul className="news-list">
            {related.map((item) => (
              <li key={item.id}>
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
                <span className="muted small">
                  {" "}
                  · {item.source} · {formatTimestamp(item.publishedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {news.data && (
          <div style={{ marginTop: 8 }}>
            <ProvenanceLine provenance={news.data.provenance} dataState={news.data.dataState} sources={["merolagani", "sharesansar"]} />
          </div>
        )}
      </div>
    </div>
  );
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

/** Source text sometimes keeps HTML entities (e.g. "&nbsp;"); show them as text. */
function plain(text: string): string {
  return text.replace(/&(nbsp|amp|quot|apos|lt|gt|#\d+);/g, (match, name: string) =>
    name.startsWith("#") ? String.fromCharCode(Number(name.slice(1))) : (ENTITIES[name] ?? match),
  );
}

function EventGroup({ label, events }: { label: string; events: CompanyEvent[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, 8);
  return (
    <div>
      <h4 className="row-between" style={{ margin: "0 0 8px" }}>
        <span>
          {label} <span className="muted small">({events.length})</span>
        </span>
        {events.length > 8 && (
          <button type="button" className="button button-ghost button-small" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${events.length}`}
          </button>
        )}
      </h4>
      <ul className="news-list">
        {shown.map((event, index) => (
          <li key={`${event.date ?? ""}-${index}`}>
            <span className="muted small mono">{event.date?.slice(0, 10) ?? "undated"}</span>{" "}
            {event.url ? (
              <a href={event.url} target="_blank" rel="noreferrer">
                {plain(event.title)}
              </a>
            ) : (
              <strong>{plain(event.title)}</strong>
            )}
            {event.fiscalYear && <span className="muted small"> · FY {fiscalYearLabel(event.fiscalYear)}</span>}
            {event.detail && <span className="cell-sub" style={{ whiteSpace: "normal", maxWidth: "none" }}>{plain(event.detail)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floorsheet (latest stored day)
// ---------------------------------------------------------------------------

interface FloorsheetDigest {
  date: string | null;
  availableDates: string[];
  provenance: Provenance | null;
  dataState: DataStateSummary | null;
  totalTrades: number;
  bySymbol: Map<string, FloorsheetTrade[]>;
}

function digestFloorsheet(raw: FloorsheetResponse): FloorsheetDigest {
  const bySymbol = new Map<string, FloorsheetTrade[]>();
  for (const trade of raw.trades ?? []) {
    const key = trade.symbol.toUpperCase();
    const list = bySymbol.get(key);
    if (list) list.push(trade);
    else bySymbol.set(key, [trade]);
  }
  return {
    date: raw.date,
    availableDates: raw.availableDates ?? [],
    provenance: raw.provenance ?? null,
    dataState: raw.dataState ?? null,
    totalTrades: raw.trades?.length ?? 0,
    bySymbol,
  };
}

interface BrokerRow {
  broker: string;
  quantity: number;
  amount: number;
  trades: number;
}

function aggregate(trades: FloorsheetTrade[], side: "buyerBroker" | "sellerBroker"): BrokerRow[] {
  const map = new Map<string, BrokerRow>();
  for (const trade of trades) {
    const broker = String(trade[side]);
    const row = map.get(broker) ?? { broker, quantity: 0, amount: 0, trades: 0 };
    row.quantity += trade.quantity;
    row.amount += trade.amount;
    row.trades += 1;
    map.set(broker, row);
  }
  return [...map.values()];
}

const BULK_THRESHOLD = 10_000_000;

function FloorsheetPanel({ symbol }: { symbol: string }) {
  const state = useCachedSelect<FloorsheetResponse, FloorsheetDigest>("/api/floorsheet", "bySymbol", digestFloorsheet);
  const [by, setBy] = useState<"quantity" | "amount">("quantity");
  const trades = useMemo(() => state.data?.bySymbol.get(symbol) ?? [], [state.data, symbol]);
  const stats = useMemo(() => {
    if (trades.length === 0) return null;
    const quantity = trades.reduce((sum, trade) => sum + trade.quantity, 0);
    const amount = trades.reduce((sum, trade) => sum + trade.amount, 0);
    const rates = trades.map((trade) => trade.rate);
    const buyers = aggregate(trades, "buyerBroker");
    const sellers = aggregate(trades, "sellerBroker");
    const net = new Map<string, { broker: string; net: number; netAmount: number }>();
    for (const row of buyers) net.set(row.broker, { broker: row.broker, net: row.quantity, netAmount: row.amount });
    for (const row of sellers) {
      const entry = net.get(row.broker) ?? { broker: row.broker, net: 0, netAmount: 0 };
      entry.net -= row.quantity;
      entry.netAmount -= row.amount;
      net.set(row.broker, entry);
    }
    return {
      quantity,
      amount,
      vwap: quantity > 0 ? amount / quantity : null,
      high: Math.max(...rates),
      low: Math.min(...rates),
      buyers,
      sellers,
      net: [...net.values()],
      bulk: trades.filter((trade) => trade.amount >= BULK_THRESHOLD).sort((a, b) => b.amount - a.amount),
    };
  }, [trades]);

  if (state.loading) return <Spinner label="Loading the latest stored floorsheet" />;
  if (state.error || !state.data) {
    return <MissingData title="Floorsheet unavailable" status={state.status} error={state.error} endpoint="/api/floorsheet" />;
  }
  if (!state.data.date) {
    return (
      <MissingData title="No floorsheet stored">
        <p>
          Automatic updates fetch the latest public floorsheet in the
          background while the app is open. Only the latest public floorsheet
          page is available, so earlier days cannot be back-filled. Open the{" "}
          <strong>Data</strong> page to check status or refresh now.
        </p>
      </MissingData>
    );
  }
  const footer = (
    <div className="card-footer" style={{ marginTop: 0 }}>
      <div className="stack-sm">
        <ProvenanceLine provenance={state.data.provenance} dataState={state.data.dataState} asOf={state.data.date} />
        <span className="small">
          End-of-day record of {state.data.date} ({state.data.totalTrades.toLocaleString()} trades market-wide,
          filtered to {symbol} locally; {state.data.availableDates.length} stored day
          {state.data.availableDates.length === 1 ? "" : "s"}). Broker numbers as displayed; VWAP,
          broker totals and net positions are DERIVED. Bulk = a single trade ≥ Rs 1 crore.
        </span>
      </div>
    </div>
  );
  if (!stats) {
    return (
      <div className="stack">
        <EmptyState title={`${symbol} did not trade in the stored floorsheet`}>
          No contracts for {symbol} on {state.data.date}.
        </EmptyState>
        {footer}
      </div>
    );
  }

  const top = (rows: BrokerRow[]) => [...rows].sort((a, b) => b[by] - a[by]).slice(0, 10);
  const netSorted = [...stats.net].sort((a, b) => b.net - a.net);
  const accumulators = netSorted.filter((row) => row.net > 0).slice(0, 5);
  const distributors = [...netSorted].reverse().filter((row) => row.net < 0).slice(0, 5);

  const brokerTable = (title: string, rows: BrokerRow[]) => (
    <div>
      <h4 className="muted small" style={{ margin: "0 0 8px" }}>
        {title}
      </h4>
      <div className="table-scroll short">
        <table className="table">
          <thead>
            <tr>
              <th>Broker</th>
              <th className="right">Quantity</th>
              <th className="right">Amount</th>
              <th className="right">Share</th>
              <th className="right">Trades</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.broker}>
                <td className="mono">#{row.broker}</td>
                <td className="right">{row.quantity.toLocaleString()}</td>
                <td className="right">{formatRsBig(row.amount)}</td>
                <td className="right">{((row[by] / (by === "quantity" ? stats.quantity : stats.amount)) * 100).toFixed(1)}%</td>
                <td className="right">{row.trades}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="stack">
      <MiniStats
        items={[
          { label: "Session", value: state.data.date, hint: "latest stored day" },
          { label: "Trades", value: trades.length.toLocaleString() },
          { label: "Quantity", value: stats.quantity.toLocaleString() },
          { label: "Turnover", value: formatRsBig(stats.amount) },
          { label: "VWAP", value: stats.vwap === null ? "—" : `Rs ${formatNumber(stats.vwap)}`, hint: "derived" },
          { label: "Rate range", value: `${formatNumber(stats.low)} – ${formatNumber(stats.high)}` },
          { label: "Bulk trades", value: stats.bulk.length, hint: "≥ Rs 1 crore each" },
        ]}
      />
      <div className="row" style={{ gap: 10 }}>
        <span className="muted small">Rank brokers by</span>
        <Segmented
          label="Rank brokers by"
          value={by}
          onChange={setBy}
          items={[
            { value: "quantity", label: "Quantity" },
            { value: "amount", label: "Amount" },
          ]}
        />
      </div>
      <div className="grid two">
        {brokerTable("Top buying brokers", top(stats.buyers))}
        {brokerTable("Top selling brokers", top(stats.sellers))}
      </div>
      <div className="grid two">
        <div>
          <h4 className="muted small" style={{ margin: "0 0 8px" }}>
            Net buyers (bought − sold, shares)
          </h4>
          {accumulators.length === 0 ? (
            <p className="muted small">None.</p>
          ) : (
            <MiniStats
              items={accumulators.map((row) => ({
                label: `#${row.broker}`,
                value: `+${row.net.toLocaleString()}`,
                tone: "up" as const,
                hint: formatRsBig(row.netAmount),
              }))}
            />
          )}
        </div>
        <div>
          <h4 className="muted small" style={{ margin: "0 0 8px" }}>
            Net sellers
          </h4>
          {distributors.length === 0 ? (
            <p className="muted small">None.</p>
          ) : (
            <MiniStats
              items={distributors.map((row) => ({
                label: `#${row.broker}`,
                value: row.net.toLocaleString(),
                tone: "down" as const,
                hint: formatRsBig(Math.abs(row.netAmount)),
              }))}
            />
          )}
        </div>
      </div>
      <div>
        <h4 className="muted small" style={{ margin: "0 0 8px" }}>
          Bulk trades (≥ Rs 1 crore)
        </h4>
        {stats.bulk.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            No single trade reached Rs 1 crore. Largest: {formatRsBig(Math.max(...trades.map((trade) => trade.amount)))}.
          </p>
        ) : (
          <div className="table-scroll short">
            <table className="table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Buyer</th>
                  <th>Seller</th>
                  <th className="right">Quantity</th>
                  <th className="right">Rate</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {stats.bulk.map((trade) => (
                  <tr key={trade.contractId}>
                    <td className="mono small">{trade.contractId}</td>
                    <td className="mono">#{trade.buyerBroker}</td>
                    <td className="mono">#{trade.sellerBroker}</td>
                    <td className="right">{trade.quantity.toLocaleString()}</td>
                    <td className="right">{formatNumber(trade.rate)}</td>
                    <td className="right">{formatRsBig(trade.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {footer}
    </div>
  );
}

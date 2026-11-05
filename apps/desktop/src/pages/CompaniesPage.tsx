import { useMemo, useState } from "react";
import { useApi } from "../hooks";
import type { CompaniesResponse, Company } from "../types";
import {
  AsOf,
  Avatar,
  Badge,
  Card,
  ClickableRow,
  DataStateBadge,
  EmptyState,
  SortHeader,
  Spinner,
  Stat,
  useSort,
} from "../components/ui";

type SortKey = "symbol" | "name" | "sector" | "instrumentType" | "status";

export function CompaniesPage({
  onOpenSymbol,
}: {
  onOpenSymbol: (symbol: string) => void;
}) {
  const companiesState = useApi<CompaniesResponse>("/api/companies");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("all");
  const [instrument, setInstrument] = useState("all");
  const [status, setStatus] = useState("all");

  const companies = companiesState.data?.companies ?? [];
  const provenance = companiesState.data?.provenance ?? {};

  const facets = useMemo(() => {
    const count = (key: keyof Company) => {
      const map = new Map<string, number>();
      for (const company of companies) {
        const value = String(company[key]);
        map.set(value, (map.get(value) ?? 0) + 1);
      }
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };
    return {
      sectors: count("sector"),
      instruments: count("instrumentType"),
      statuses: count("status"),
    };
  }, [companies]);

  const filtered = useMemo(() => {
    const needle = search.trim().toUpperCase();
    return companies.filter((company) => {
      if (sector !== "all" && company.sector !== sector) return false;
      if (instrument !== "all" && company.instrumentType !== instrument) return false;
      if (status !== "all" && company.status !== status) return false;
      if (needle === "") return true;
      return (
        company.symbol.toUpperCase().includes(needle) ||
        company.name.toUpperCase().includes(needle)
      );
    });
  }, [companies, search, sector, instrument, status]);

  const { sorted, sort, toggle } = useSort<Company, SortKey>(
    filtered,
    { key: "symbol", direction: "asc" },
    (company, key) => company[key],
  );

  if (companiesState.loading) return <Spinner label="Loading companies" />;

  if (companiesState.error) {
    return (
      <EmptyState title="Could not load the company master">
        {companiesState.error}
      </EmptyState>
    );
  }

  if (companies.length === 0) {
    return (
      <EmptyState title="No companies imported yet">
        Add <code>companies.csv</code> to the data folder and run an import
        from the Data page.
      </EmptyState>
    );
  }

  const unclassified = facets.sectors.find(([name]) => name === "Unclassified")?.[1] ?? 0;

  return (
    <div className="stack">
      <div className="stats-row">
        <Stat label="Securities" value={companies.length} hint="in the local master" />
        <Stat
          label="Instrument types"
          value={facets.instruments.length}
          hint={facets.instruments
            .slice(0, 3)
            .map(([name, n]) => `${n} ${name}`)
            .join(" · ")}
        />
        <Stat
          label="Sectors"
          value={facets.sectors.length}
          hint={`${unclassified} unclassified, shown as-is`}
        />
        <Stat
          label="Delisted / merged"
          value={facets.statuses.find(([name]) => name !== "active")?.[1] ?? 0}
          hint="kept for history; history may be incomplete"
        />
        <Stat
          label="Master state"
          value={
            <DataStateBadge
              state={companiesState.data?.dataState.state ?? "unavailable"}
              classification={companiesState.data?.dataState.classification ?? "MISSING"}
            />
          }
        />
      </div>

      <Card
        title="Security master"
        subtitle={`${sorted.length} of ${companies.length} · every row carries its import provenance`}
        action={
          companiesState.data ? (
            <DataStateBadge
              state={companiesState.data.dataState.state}
              classification={companiesState.data.dataState.classification}
            />
          ) : undefined
        }
      >
        <div className="filters" style={{ marginBottom: 14 }}>
          <label className="grow">
            <span>Search</span>
            <input
              value={search}
              placeholder="Symbol or name"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            <span>Instrument</span>
            <select value={instrument} onChange={(event) => setInstrument(event.target.value)}>
              <option value="all">All instruments</option>
              {facets.instruments.map(([name, n]) => (
                <option key={name} value={name}>
                  {name} ({n})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Sector</span>
            <select value={sector} onChange={(event) => setSector(event.target.value)}>
              <option value="all">All sectors</option>
              {facets.sectors.map(([name, n]) => (
                <option key={name} value={name}>
                  {name} ({n})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">Any status</option>
              {facets.statuses.map(([name, n]) => (
                <option key={name} value={name}>
                  {name} ({n})
                </option>
              ))}
            </select>
          </label>
        </div>

        {sorted.length === 0 ? (
          <EmptyState title="No companies match this filter" />
        ) : (
          <div className="table-scroll tall">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Symbol" sortKey="symbol" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <SortHeader label="Name" sortKey="name" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <SortHeader label="Sector" sortKey="sector" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <SortHeader label="Type" sortKey="instrumentType" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} defaultDirection="asc" />
                  <th>As of / state</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((company) => {
                  const entry = provenance[company.symbol];
                  return (
                    <ClickableRow key={company.symbol} onClick={() => onOpenSymbol(company.symbol)}>
                      <td>
                        <div className="symbol-cell">
                          <Avatar symbol={company.symbol} />
                          <strong>{company.symbol}</strong>
                        </div>
                      </td>
                      <td>{company.name}</td>
                      <td className={company.sector === "Unclassified" ? "subtle" : "muted"}>
                        {company.sector}
                      </td>
                      <td className="muted">{company.instrumentType}</td>
                      <td>
                        <Badge tone={company.status === "active" ? "good" : "warn"}>
                          {company.status}
                        </Badge>
                      </td>
                      <td>
                        <AsOf value={entry?.asOf ?? entry?.fetchedAt} ageSeconds={entry?.ageSeconds} />{" "}
                        {entry && (
                          <DataStateBadge
                            state={entry.state}
                            classification={entry.classification}
                            showClassification={false}
                          />
                        )}
                      </td>
                    </ClickableRow>
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

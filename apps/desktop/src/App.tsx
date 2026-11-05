import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useApi } from "./hooks";
import type { CompaniesResponse, Meta } from "./types";
import { DataStateBadge, Spinner } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { ThemeToggle } from "./components/ThemeToggle";
import { Icon } from "./components/icons";
import { useTheme } from "./theme";
import {
  describeAge,
  nptDate,
  readFlag,
  sessionAgeDays,
  UPDATE_COMMAND,
  UPDATE_REMINDER_DAYS,
  writeFlag,
} from "./lib";
import { MarketPage } from "./pages/MarketPage";
import { CompanyPage } from "./pages/CompanyPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { ScreenerPage } from "./pages/ScreenerPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { WatchlistPage } from "./pages/WatchlistPage";
import { DataPage } from "./pages/DataPage";
import { SettingsPage } from "./pages/SettingsPage";

function useHashRoute(): string {
  const [hash, setHash] = useState(
    () => window.location.hash.replace(/^#/, "") || "/market",
  );

  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash.replace(/^#/, "") || "/market");
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return hash;
}

function navigate(path: string): void {
  window.location.hash = `#${path}`;
}

interface NavItem {
  path: string;
  label: string;
  title: string;
  crumb: string;
  icon: (props: { className?: string }) => ReactElement;
  key: string;
}

const RESEARCH: NavItem[] = [
  {
    path: "/market",
    label: "Market",
    title: "Market overview",
    crumb: "End-of-day breadth, sectors and movers",
    icon: Icon.Market,
    key: "1",
  },
  {
    path: "/screener",
    label: "Screener",
    title: "Quant screener",
    crumb: "Technical and risk metrics computed from stored candles",
    icon: Icon.Screener,
    key: "2",
  },
  {
    path: "/companies",
    label: "Companies",
    title: "Companies",
    crumb: "Security master with instrument type, sector and status",
    icon: Icon.Companies,
    key: "3",
  },
];

const PERSONAL: NavItem[] = [
  {
    path: "/watchlist",
    label: "Watchlist",
    title: "Watchlist",
    crumb: "Saved symbols with returns, risk and correlation",
    icon: Icon.Watchlist,
    key: "4",
  },
  {
    path: "/portfolio",
    label: "Portfolio",
    title: "Portfolio",
    crumb: "Local ledger, cost basis and P&L",
    icon: Icon.Portfolio,
    key: "5",
  },
];

const SYSTEM: NavItem[] = [
  {
    path: "/data",
    label: "Data",
    title: "Data & coverage",
    crumb: "Source, provenance, imports and honest limits",
    icon: Icon.Data,
    key: "6",
  },
  {
    path: "/settings",
    label: "Settings",
    title: "Settings",
    crumb: "Appearance, storage and editions",
    icon: Icon.Settings,
    key: "7",
  },
];

const ALL_NAV = [...RESEARCH, ...PERSONAL, ...SYSTEM];

const SIDEBAR_KEY = "nepse-terminal.sidebar-collapsed";

export function App() {
  const route = useHashRoute();
  const metaState = useApi<Meta>("/api/meta");
  const companiesState = useApi<CompaniesResponse>("/api/companies");
  const meta = metaState.data;
  const { resolved, setMode } = useTheme();
  const [collapsed, setCollapsed] = useState(() => readFlag(SIDEBAR_KEY, false));
  const [paletteOpen, setPaletteOpen] = useState(false);

  const segments = route.split("/").filter(Boolean);
  const page = segments[0] ?? "market";
  const symbol = (segments[1] ?? "").toUpperCase();

  const openSymbol = useCallback((next: string) => navigate(`/company/${next}`), []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((value) => {
      writeFlag(SIDEBAR_KEY, !value);
      return !value;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (typing) return;
      if (event.key === "/") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.altKey && /^[1-7]$/.test(event.key)) {
        const item = ALL_NAV.find((nav) => nav.key === event.key);
        if (item) {
          event.preventDefault();
          navigate(item.path);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  const pages = useMemo<PaletteCommand[]>(
    () =>
      ALL_NAV.map((item) => ({
        id: item.path,
        label: item.title,
        hint: item.crumb,
        icon: item.icon,
        run: () => navigate(item.path),
      })),
    [],
  );

  const actions = useMemo<PaletteCommand[]>(
    () => [
      {
        id: "theme",
        label: resolved === "dark" ? "Switch to light theme" : "Switch to dark theme",
        icon: resolved === "dark" ? Icon.Sun : Icon.Moon,
        run: () => setMode(resolved === "dark" ? "light" : "dark"),
      },
      {
        id: "sidebar",
        label: collapsed ? "Expand sidebar" : "Collapse sidebar",
        hint: "Ctrl B",
        icon: Icon.PanelLeft,
        run: toggleSidebar,
      },
      {
        id: "update",
        label: "How to update the local archive",
        hint: "No background fetch — updates are manual",
        icon: Icon.Download,
        run: () => navigate("/data"),
      },
    ],
    [resolved, setMode, collapsed, toggleSidebar],
  );

  const current =
    page === "company"
      ? null
      : (ALL_NAV.find((item) => item.path === `/${page}`) ?? RESEARCH[0]!);

  const lastSession = nptDate(meta?.dataState.lastAsOf);
  const ageDays = sessionAgeDays(meta?.dataState.lastAsOf);
  const needsUpdate = ageDays !== null && ageDays > UPDATE_REMINDER_DAYS;

  let content: ReactNode;
  if (metaState.error) {
    content = (
      <div className="empty" role="alert">
        <h3>Local API not reachable</h3>
        <div className="empty-body">
          <p>{metaState.error}</p>
          <p className="muted small">
            Start the local API with <code>pnpm dev:api</code>, then reload.
          </p>
        </div>
      </div>
    );
  } else if (!meta) {
    content = <Spinner label="Loading workspace" />;
  } else if (page === "company" && symbol) {
    content = <CompanyPage symbol={symbol} onOpenSymbol={openSymbol} />;
  } else if (page === "companies") {
    content = <CompaniesPage onOpenSymbol={openSymbol} />;
  } else if (page === "screener") {
    content = <ScreenerPage onOpenSymbol={openSymbol} />;
  } else if (page === "portfolio") {
    content = <PortfolioPage onOpenSymbol={openSymbol} />;
  } else if (page === "watchlist") {
    content = <WatchlistPage onOpenSymbol={openSymbol} />;
  } else if (page === "data") {
    content = <DataPage meta={meta} onDataChanged={() => metaState.reload()} />;
  } else if (page === "settings") {
    content = <SettingsPage meta={meta} onOpenData={() => navigate("/data")} />;
  } else {
    content = (
      <MarketPage onOpenSymbol={openSymbol} onOpenData={() => navigate("/data")} />
    );
  }

  const renderNav = (items: NavItem[]) =>
    items.map((item) => {
      const active =
        route === item.path ||
        route.startsWith(`${item.path}/`) ||
        (item.path === "/companies" && page === "company");
      const ItemIcon = item.icon;
      return (
        <button
          key={item.path}
          type="button"
          className={`nav-item ${active ? "nav-active" : ""}`}
          aria-current={active ? "page" : undefined}
          title={collapsed ? item.label : undefined}
          onClick={() => navigate(item.path)}
        >
          <ItemIcon />
          <span className="nav-label">{item.label}</span>
          <span className="nav-key" aria-hidden="true">
            Alt {item.key}
          </span>
        </button>
      );
    });

  return (
    <div className={`app ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => navigate("/market")}
          aria-label="NEPSE Terminal home"
        >
          <span className="brand-mark" aria-hidden="true">
            <Icon.Logo />
          </span>
          <span className="brand-text">
            <strong>NEPSE Terminal</strong>
            <small>Quant research · EOD</small>
          </span>
        </button>

        <nav className="nav" aria-label="Primary">
          <div className="nav-section">Research</div>
          {renderNav(RESEARCH)}
          <div className="nav-section">Personal</div>
          {renderNav(PERSONAL)}
          <div className="nav-section">System</div>
          {renderNav(SYSTEM)}
        </nav>

        <div className="sidebar-footer">
          {meta ? (
            <div className="footer-detail stack-sm">
              <DataStateBadge
                state={meta.dataState.state}
                classification={meta.dataState.classification}
              />
              <div className="footer-line">
                <span>Companies</span>
                <strong className="num">{meta.store.companies.toLocaleString()}</strong>
              </div>
              <div className="footer-line">
                <span>Candles</span>
                <strong className="num">{meta.store.candles.toLocaleString()}</strong>
              </div>
              <div className="footer-line">
                <span>Last session</span>
                <strong className="num">{lastSession ?? "—"}</strong>
              </div>
            </div>
          ) : (
            <span className="muted small footer-detail">Connecting to local store…</span>
          )}
          <button
            type="button"
            className="collapse-toggle"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon.PanelLeft />
            <span className="collapse-label">Collapse</span>
            <kbd className="collapse-label" style={{ marginLeft: "auto" }}>
              Ctrl B
            </kbd>
          </button>
        </div>
      </aside>

      <main className="main">
        {meta?.edition === "free" && (
          <div className="edition-strip" role="note">
            <strong>Free Edition · unofficial data</strong>
            <span>
              End-of-day archive, terms unverified · analytics are derived
              mathematics · not investment advice
            </span>
          </div>
        )}

        <header className="topbar">
          <div className="topbar-heading">
            <h1 className="topbar-title">
              {page === "company" && symbol ? symbol : current?.title}
            </h1>
            <span className="topbar-crumb">
              {page === "company" && symbol
                ? "Company · chart, quant profile, patterns and seasonality"
                : current?.crumb}
            </span>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="palette-trigger"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open command palette"
            >
              <Icon.Search />
              <span>Search symbol or command…</span>
              <kbd>Ctrl K</kbd>
            </button>
            {meta && (
              <span
                className="session-pill"
                title="Newest stored market timestamp. Prices are end-of-day closes, never live."
              >
                <span className={`dot ${needsUpdate ? "dot-stale" : "dot-eod"}`} />
                EOD <strong>{lastSession ?? "—"}</strong>
                <span>{describeAge(ageDays)}</span>
              </span>
            )}
            <ThemeToggle />
          </div>
        </header>

        <div className="content">
          {needsUpdate && page !== "data" && (
            <div className="banner" role="status" style={{ marginBottom: 16 }}>
              <Icon.Alert />
              <div className="banner-body">
                <strong>The local archive is {describeAge(ageDays)}.</strong>{" "}
                The app never fetches in the background. To refresh, run{" "}
                <code>{UPDATE_COMMAND}</code>
              </div>
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => navigate("/data")}
              >
                Data page
              </button>
            </div>
          )}
          <ErrorBoundary key={route}>{content}</ErrorBoundary>
        </div>
      </main>

      <footer className="statusbar" aria-label="Status">
        <span className="status-item">
          <span className={`dot ${needsUpdate ? "dot-stale" : "dot-eod"}`} />
          <strong>End-of-day</strong> · not a live feed
        </span>
        <span className="status-item">
          Source <strong>{meta?.provider?.name ?? meta?.providerId ?? "—"}</strong>
        </span>
        <span className="status-item">
          Classification <strong>{meta?.dataState.classification ?? "—"}</strong>
        </span>
        <span className="status-spacer" />
        <span className="status-item">
          {meta
            ? `${meta.store.companies.toLocaleString()} securities · ${meta.store.candles.toLocaleString()} candles`
            : ""}
        </span>
        <span className="status-item">
          <kbd>/</kbd> search · <kbd>Alt 1–7</kbd> pages
        </span>
      </footer>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        companies={companiesState.data?.companies ?? []}
        pages={pages}
        actions={actions}
        onOpenSymbol={openSymbol}
      />
    </div>
  );
}

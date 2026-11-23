import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useApi, useRefreshStatus } from "./hooks";
import { api } from "./api";
import type { CompaniesResponse, Meta } from "./types";
import { DataStateBadge, Spinner } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { ThemeToggle } from "./components/ThemeToggle";
import { Icon } from "./components/icons";
import { useTheme } from "./theme";
import {
  describeAge,
  formatCheckTime,
  nptDate,
  readFlag,
  refreshPhaseLabel,
  sessionAgeDays,
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
import { AlertsPage } from "./pages/AlertsPage";
import { LivePage } from "./pages/LivePage";
import { CalculatorPage } from "./pages/CalculatorPage";
import { SectorsPage } from "./pages/SectorsPage";
import { FundamentalsPage } from "./pages/FundamentalsPage";
import { FloorsheetPage } from "./pages/FloorsheetPage";
import { EventsPage } from "./pages/EventsPage";
import { useAlerts } from "./alerts";

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
    path: "/live",
    label: "Live market",
    title: "Live market",
    crumb: "Unofficial live LTP from nepalstock.com, refreshed during trading hours",
    icon: Icon.Clock,
    key: "2",
  },
  {
    path: "/alerts",
    label: "Signals & alerts",
    title: "Signals & alerts",
    crumb: "Smart brief, RSI 30/50 crosses, MACD/EMA/Supertrend crosses, breakouts",
    icon: Icon.Alert,
    key: "3",
  },
  {
    path: "/screener",
    label: "Screener",
    title: "Quant screener",
    crumb: "Technical, volume and risk screens computed from stored candles",
    icon: Icon.Screener,
    key: "4",
  },
  {
    path: "/fundamentals",
    label: "Fundamentals",
    title: "Fundamental desk",
    crumb: "EPS, P/E, P/B, ROE, ROA, NPL, dividends — screen, compare and sector medians",
    icon: Icon.Sigma,
    key: "5",
  },
  {
    path: "/sectors",
    label: "Sectors",
    title: "Sectors",
    crumb: "Sector members, 1-week volume, trending and volatile stocks",
    icon: Icon.Companies,
    key: "6",
  },
  {
    path: "/floorsheet",
    label: "Floorsheet & brokers",
    title: "Floorsheet & brokers",
    crumb: "Top stocks, broker buy/sell, bulk trades and multi-day accumulation",
    icon: Icon.Data,
    key: "7",
  },
  {
    path: "/events",
    label: "IPO, events & news",
    title: "IPO, events & news",
    crumb: "IPO/FPO/right pipeline, dividends, mergers, lock-in and news",
    icon: Icon.Clock,
    key: "8",
  },
  {
    path: "/companies",
    label: "Companies",
    title: "Companies",
    crumb: "Security master with instrument type, sector and status",
    icon: Icon.Companies,
    key: "9",
  },
];

const PERSONAL: NavItem[] = [
  {
    path: "/watchlist",
    label: "Watchlist",
    title: "Watchlist",
    crumb: "Saved symbols with returns, risk and correlation",
    icon: Icon.Watchlist,
    key: "",
  },
  {
    path: "/portfolio",
    label: "Portfolio",
    title: "Portfolio",
    crumb: "Local ledger, cost basis and P&L",
    icon: Icon.Portfolio,
    key: "",
  },
  {
    path: "/calculator",
    label: "Calculator",
    title: "Share calculator",
    crumb: "Buy/sell cost, CGT, breakeven, WACC, bonus/right and dividend yield",
    icon: Icon.Sigma,
    key: "",
  },
];

const SYSTEM: NavItem[] = [
  {
    path: "/data",
    label: "Data",
    title: "Data & coverage",
    crumb: "Source, provenance, imports and honest limits",
    icon: Icon.Data,
    key: "",
  },
  {
    path: "/settings",
    label: "Settings",
    title: "Settings",
    crumb: "Appearance, storage and editions",
    icon: Icon.Settings,
    key: "",
  },
];

const ALL_NAV = [...RESEARCH, ...PERSONAL, ...SYSTEM];

const SIDEBAR_KEY = "nepse-terminal.sidebar-collapsed";

export function App() {
  const route = useHashRoute();
  const metaState = useApi<Meta>("/api/meta");
  const companiesState = useApi<CompaniesResponse>("/api/companies");
  const refreshState = useRefreshStatus();
  const meta = metaState.data;
  const refresh = refreshState.data;
  const { resolved, setMode } = useTheme();
  const [collapsed, setCollapsed] = useState(() => readFlag(SIDEBAR_KEY, false));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const alerts = useAlerts(Boolean(metaState.data));

  const segments = route.split("/").filter(Boolean);
  const page = segments[0] ?? "market";
  const symbol = (segments[1] ?? "").toUpperCase();

  // The mobile navigation drawer is scoped to one page visit.
  useEffect(() => {
    setDrawerOpen(false);
  }, [route]);

  const openSymbol = useCallback((next: string) => navigate(`/company/${next}`), []);

  const triggerRefresh = useCallback(async () => {
    setRefreshError(null);
    try {
      await api("/api/refresh/run", {
        method: "POST",
        body: JSON.stringify({}),
      });
      refreshState.reload();
    } catch (cause) {
      setRefreshError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [refreshState.reload]);

  const lastSuccessRef = useRef<string | null>(null);
  useEffect(() => {
    const next = refresh?.lastSuccessAt ?? null;
    if (next && lastSuccessRef.current && next !== lastSuccessRef.current) {
      // A background import finished: refresh the session pill and company list.
      metaState.reload();
      companiesState.reload();
      // Clear a stale manual-retry error now that an update has succeeded.
      setRefreshError(null);
    }
    lastSuccessRef.current = next;
  }, [refresh?.lastSuccessAt, metaState.reload, companiesState.reload]);

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
      if (event.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      if (typing) return;
      if (event.key === "/") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.altKey && /^[1-9]$/.test(event.key)) {
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
        label: "Data updates and status",
        hint: refresh?.running
          ? `Updating: ${refresh.phase}`
          : refresh?.enabled
            ? "Automatic updates are on"
            : "Automatic updates are off",
        icon: Icon.Download,
        run: () => navigate("/data"),
      },
    ],
    [
      resolved,
      setMode,
      collapsed,
      toggleSidebar,
      refresh?.running,
      refresh?.phase,
      refresh?.enabled,
    ],
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
            The local data service did not start. Quit and reopen NEPSE
            Terminal. If this keeps happening, open the Data page after the
            service is running or reinstall the app.
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
  } else if (page === "alerts") {
    content = <AlertsPage alerts={alerts} onOpenSymbol={openSymbol} />;
  } else if (page === "live") {
    content = <LivePage onOpenSymbol={openSymbol} />;
  } else if (page === "fundamentals") {
    content = <FundamentalsPage onOpenSymbol={openSymbol} />;
  } else if (page === "sectors") {
    content = <SectorsPage onOpenSymbol={openSymbol} />;
  } else if (page === "floorsheet") {
    content = <FloorsheetPage onOpenSymbol={openSymbol} />;
  } else if (page === "events") {
    content = <EventsPage onOpenSymbol={openSymbol} />;
  } else if (page === "calculator") {
    content = <CalculatorPage />;
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
          title={item.key ? `${item.label} (Alt ${item.key})` : item.label}
          onClick={() => {
            navigate(item.path);
            setDrawerOpen(false);
          }}
        >
          <ItemIcon />
          <span className="nav-label">{item.label}</span>
          {item.path === "/alerts" && alerts.unread > 0 ? (
            <span className="nav-count" aria-label={`${alerts.unread} unread alerts`}>
              {alerts.unread > 99 ? "99+" : alerts.unread}
            </span>
          ) : null}
        </button>
      );
    });

  return (
    <div
      className={`app ${collapsed ? "sidebar-collapsed" : ""} ${
        drawerOpen ? "sidebar-open" : ""
      }`}
    >
      <aside className="sidebar" id="app-sidebar">
        <button
          type="button"
          className="drawer-close"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <button
          className="brand"
          onClick={() => {
            navigate("/market");
            setDrawerOpen(false);
          }}
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
            <div className="footer-detail footer-compact" title={`${meta.store.companies.toLocaleString()} securities · ${meta.store.candles.toLocaleString()} candles`}>
              <DataStateBadge
                state={meta.dataState.state}
                classification={meta.dataState.classification}
              />
              <span className="muted small">
                Last session <strong className="num">{lastSession ?? "—"}</strong>
              </span>
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

      {drawerOpen && (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        />
      )}

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
          <button
            type="button"
            className="menu-toggle"
            aria-label="Open navigation"
            aria-controls="app-sidebar"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
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
          {refresh?.running && (
            <div className="banner" role="status" style={{ marginBottom: 16 }}>
              <Icon.Download />
              <div className="banner-body">
                <strong>Updating market data automatically.</strong>{" "}
                {refreshPhaseLabel(refresh.phase)}
                {refresh.lastProgress ? ` · ${refresh.lastProgress}` : ""}
              </div>
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => navigate("/data")}
              >
                Progress
              </button>
            </div>
          )}
          {!refresh?.running && (refresh?.lastError || refreshError) && (
            <div className="banner" role="alert" style={{ marginBottom: 16 }}>
              <Icon.Alert />
              <div className="banner-body">
                <strong>Automatic update failed.</strong>{" "}
                {refreshError ?? refresh?.lastError}
                {refresh?.nextCheckAt && (
                  <> Next retry at {formatCheckTime(refresh.nextCheckAt)}.</>
                )}
              </div>
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => void triggerRefresh()}
              >
                Retry now
              </button>
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => navigate("/data")}
              >
                Data page
              </button>
            </div>
          )}
          {!refresh?.running &&
            !refresh?.lastError &&
            !refreshError &&
            refresh &&
            needsUpdate &&
            page !== "data" && (
              <div className="banner" role="status" style={{ marginBottom: 16 }}>
                <Icon.Alert />
                <div className="banner-body">
                  <strong>The local archive is {describeAge(ageDays)}.</strong>{" "}
                  {refresh.enabled
                    ? `Automatic updates are on; the next check is at ${formatCheckTime(refresh.nextCheckAt)}.`
                    : meta?.edition === "free"
                      ? "Automatic updates are off. Open the Data page to refresh."
                      : "Automatic updates run in the Free Edition. Open the Data page for manual options."}
                </div>
                {refresh.enabled && (
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={() => void triggerRefresh()}
                  >
                    Check now
                  </button>
                )}
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
        <span className="status-item">
          <span
            className={`dot ${
              refresh?.running
                ? "dot-good"
                : refresh?.lastError
                  ? "dot-stale"
                  : "dot-eod"
            }`}
          />
          {refresh?.running
            ? "Updating data…"
            : refresh?.enabled
              ? "Auto-updates on"
              : "Auto-updates off"}
        </span>
        <span className="status-spacer" />
        <span className="status-item">
          {meta
            ? `${meta.store.companies.toLocaleString()} securities · ${meta.store.candles.toLocaleString()} candles`
            : ""}
        </span>
        <span className="status-item">
          <kbd>/</kbd> search · <kbd>Alt 1–9</kbd> pages
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

// Connector Hub — Main App with routing, TanStack Query, Zustand
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import ErrorBoundary from "./components/ErrorBoundary";
import AppSidebar from "./components/AppSidebar";
import Topbar from "./components/Topbar";
import NavigationLoadingDialog from "./components/NavigationLoadingDialog";
import NotificationPanel from "./components/NotificationPanel";
import BottomTabBar from "./components/BottomTabBar";
import GlobalSearch from "./components/GlobalSearch";
import { ThemeProvider } from "./contexts/ThemeContext";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Route, Switch, useLocation } from "wouter";
import { useConnectorStore } from "./stores/connectorStore";
import { fetchConnectors } from "./services";
import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { I18nContext, getTranslations, type Locale } from "./i18n";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import PageLogin from "./pages/PageLogin";

// Pages
import PageFleet from "./pages/PageFleet";
import PageDashboard from "./pages/PageDashboard";
import PageAssets from "./pages/PageAssets";
import PagePolicy from "./pages/PagePolicy";
import PageOffering from "./pages/PageOffering";
import PageCatalog from "./pages/PageCatalog";
import PageNegotiation from "./pages/PageNegotiation";
import PageTransfer from "./pages/PageTransfer";
import PageEDR from "./pages/PageEDR";
import PageInfra from "./pages/PageInfra";
import PageVault from "./pages/PageVault";
import PageAudit from "./pages/PageAudit";
import PageSettings from "./pages/PageSettings";
import PageShells from "./pages/PageShells";
import PageSubmodels from "./pages/PageSubmodels";
import PageIdentityHub from "./pages/PageIdentityHub";

/** Sync connector from URL param to Zustand store */
function ConnectorSync({ id }: { id: string }) {
  const selectConnector = useConnectorStore(s => s.selectConnector);
  const setNavigating = useConnectorStore(s => s.setNavigating);
  const { data: connectors = [] } = useQuery({
    queryKey: ["connectors"],
    queryFn: fetchConnectors,
  });
  useEffect(() => {
    const c = connectors.find(c => c.id === id);
    if (c) {
      selectConnector(c);
      setNavigating(false);
    }
  }, [id, connectors, selectConnector, setNavigating]);
  return null;
}

function AppRoutes() {
  const [, navigate] = useLocation();
  const connector = useConnectorStore(s => s.connector);
  const selectConnector = useConnectorStore(s => s.selectConnector);
  const setNavigating = useConnectorStore(s => s.setNavigating);

  const nav = (path: string) => navigate(path);
  const selectAndGo = (c: import("@/lib/data").Connector, page?: string) => {
    selectConnector(c);
    setNavigating(true);
    navigate(`/connectors/${c.id}/${page ?? "dashboard"}`);
  };

  return (
    <Switch>
      {/* Fleet Overview (Home) */}
      <Route path="/">
        <PageFleet onSelect={(c, page) => selectAndGo(c, page)} onNav={nav} />
      </Route>
      <Route path="/fleet">
        <PageFleet onSelect={(c, page) => selectAndGo(c, page)} onNav={nav} />
      </Route>

      {/* Connector-scoped pages */}
      <Route path="/connectors/:id/dashboard">
        {({ id }) => (
          <>
            <ConnectorSync id={id} />
            {connector && <PageDashboard conn={connector} onNav={nav} />}
          </>
        )}
      </Route>
      <Route path="/connectors/:id/assets">
        {({ id }) => (
          <>
            <ConnectorSync id={id} />
            <PageAssets onNav={nav} />
          </>
        )}
      </Route>
      <Route path="/connectors/:id/policy">
        {({ id }) => (
          <>
            <ConnectorSync id={id} />
            <PagePolicy />
          </>
        )}
      </Route>
      <Route path="/connectors/:id/contract">
        {({ id }) => (
          <>
            <ConnectorSync id={id} />
            <PageOffering onNav={nav} />
          </>
        )}
      </Route>
      <Route path="/connectors/:id/catalog">
        {({ id }) => (
          <>
            <ConnectorSync id={id} />
            <PageCatalog onNav={nav} />
          </>
        )}
      </Route>
      <Route path="/connectors/:id/negotiation">
        {({ id }) => (
          <>
            <ConnectorSync id={id} />
            <PageNegotiation onNav={nav} />
          </>
        )}
      </Route>
      <Route path="/connectors/:id/transfer">
        {({ id }) => (
          <>
            <ConnectorSync id={id} />
            <PageTransfer />
          </>
        )}
      </Route>
      <Route path="/connectors/:id/edr">
        {({ id }) => (
          <>
            <ConnectorSync id={id} />
            <PageEDR />
          </>
        )}
      </Route>
      {/* System pages — global, not connector-scoped */}
      <Route path="/system/vault">
        <PageVault />
      </Route>
      <Route path="/system/identity-hub">
        <PageIdentityHub onNav={nav} />
      </Route>
      <Route path="/system/audit">
        <PageAudit />
      </Route>
      <Route path="/registry">
        <PageShells />
      </Route>
      <Route path="/submodels">
        <PageSubmodels />
      </Route>
      <Route path="/connectors/:id/infra">
        {({ id }) => (
          <>
            <ConnectorSync id={id} />
            <PageInfra />
          </>
        )}
      </Route>

      {/* Settings */}
      <Route path="/settings">
        <PageSettings />
      </Route>

      {/* Fallback */}
      <Route>
        <PageFleet onSelect={(c, page) => selectAndGo(c, page)} onNav={nav} />
      </Route>
    </Switch>
  );
}

/** App Layout — pcf-exchange-ui 셸 패턴 (사이드바 + 탑바 + 메인) */
function AppLayout({ children }: { children: React.ReactNode }) {
  const drawerOpen = useConnectorStore(s => s.drawerOpen);
  const setDrawerOpen = useConnectorStore(s => s.setDrawerOpen);
  const toggleSearch = useConnectorStore(s => s.toggleSearch);

  // 모바일에서 네비게이션 시 사이드바 자동 닫힘
  const handleNavigate = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024)
      setDrawerOpen(false);
  };

  // 모바일 드로어 ESC 로 닫기
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && window.innerWidth < 1024) setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen, setDrawerOpen]);

  // 뷰포트 lg(1024) 경계 변화 동기화 — 리사이즈/회전 시 사이드바 상태 정합
  // (데스크톱=열림, 모바일=닫힘). 미동기화 시 lg+에서 사이드바가 숨거나 모바일에서 오버레이 잔존.
  useEffect(() => {
    const onResize = () => setDrawerOpen(window.innerWidth >= 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setDrawerOpen]);

  // 글로벌 검색 단축키 (Ctrl/Cmd + K)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        if (e.repeat) return;
        e.preventDefault();
        toggleSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSearch]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <NavigationLoadingDialog />

      {/* 모바일 backdrop (드로어 열림 시) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 사이드바: 모바일=고정 오버레이 드로어 / lg+=in-flow. 닫힘 시 모바일 슬라이드아웃, lg+ 숨김 */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 transition-transform duration-200 lg:static lg:z-auto lg:transition-none",
          drawerOpen ? "translate-x-0" : "-translate-x-full lg:hidden"
        )}
      >
        <AppSidebar
          onCollapse={() => setDrawerOpen(false)}
          onNavigate={handleNavigate}
        />
      </div>

      {/* 메인 컬럼 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-background">
          {/* 모바일/태블릿(<lg)은 하단 탭바 높이만큼 pb-20, 데스크톱은 pb-6 */}
          <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-20 lg:pb-6 flex flex-col gap-5 min-h-full page-enter">
            {children}
          </div>
        </main>
      </div>

      {/* 모바일/태블릿 하단 탭바 (<lg) */}
      <BottomTabBar />

      {/* 알림 슬라이드 패널 */}
      <NotificationPanel />

      {/* 글로벌 검색 (Ctrl/Cmd+K) */}
      <GlobalSearch />
    </div>
  );
}

/** Show login page or main app based on auth state */
function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) return <PageLogin />;

  return (
    <AppLayout>
      <AppRoutes />
    </AppLayout>
  );
}

function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    return (localStorage.getItem("locale") as Locale) || "ko";
  });
  const i18n = useMemo(
    () => ({
      locale,
      t: getTranslations(locale),
      setLocale: (l: Locale) => {
        setLocale(l);
        localStorage.setItem("locale", l);
      },
    }),
    [locale]
  );

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <I18nContext.Provider value={i18n}>
          <AuthProvider>
            <QueryClientProvider client={queryClient}>
              <TooltipProvider>
                <Toaster
                  position="top-center"
                  richColors
                  expand
                  visibleToasts={3}
                  duration={3000}
                />
                <AuthGate />
              </TooltipProvider>
            </QueryClientProvider>
          </AuthProvider>
        </I18nContext.Provider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

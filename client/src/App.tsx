// Connector Hub — Main App with routing, TanStack Query, Zustand
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { AppShell } from "./components/AppShell";
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
  const selectConnector = useConnectorStore((s) => s.selectConnector);
  const setNavigating = useConnectorStore((s) => s.setNavigating);
  const { data: connectors = [] } = useQuery({
    queryKey: ["connectors"],
    queryFn: fetchConnectors,
  });
  useEffect(() => {
    const c = connectors.find((c) => c.id === id);
    if (c) {
      selectConnector(c);
      setNavigating(false);
    }
  }, [id, connectors, selectConnector, setNavigating]);
  return null;
}

function AppRoutes() {
  const [, navigate] = useLocation();
  const connector = useConnectorStore((s) => s.connector);
  const selectConnector = useConnectorStore((s) => s.selectConnector);
  const setNavigating = useConnectorStore((s) => s.setNavigating);

  const nav = (path: string) => navigate(path);
  const selectAndGo = (c: import("@/lib/data").Connector) => {
    selectConnector(c);
    setNavigating(true);
    navigate(`/connectors/${c.id}/dashboard`);
  };

  return (
    <Switch>
      {/* Fleet Overview (Home) */}
      <Route path="/">
        <PageFleet onSelect={(c) => selectAndGo(c)} onNav={nav} />
      </Route>
      <Route path="/fleet">
        <PageFleet onSelect={(c) => selectAndGo(c)} onNav={nav} />
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
        <PageSettings onNav={nav} />
      </Route>

      {/* Fallback */}
      <Route>
        <PageFleet onSelect={(c) => selectAndGo(c)} onNav={nav} />
      </Route>
    </Switch>
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
    <AppShell>
      <AppRoutes />
    </AppShell>
  );
}

function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    return (localStorage.getItem("locale") as Locale) || "ko";
  });
  const i18n = useMemo(() => ({
    locale,
    t: getTranslations(locale),
    setLocale: (l: Locale) => { setLocale(l); localStorage.setItem("locale", l); },
  }), [locale]);

  return (
    <ErrorBoundary>
      <I18nContext.Provider value={i18n}>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <Toaster position="top-center" richColors expand visibleToasts={3} duration={3000} />
              <AuthGate />
            </TooltipProvider>
          </QueryClientProvider>
        </AuthProvider>
      </I18nContext.Provider>
    </ErrorBoundary>
  );
}

export default App;

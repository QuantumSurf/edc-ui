// Connector Hub — App Shell (spec 2.2, 3.3.1)
// Desktop: fixed sidebar 220px + main
// Tablet: drawer sidebar + main
// Mobile: full width + bottom Tab Bar (5 tabs)

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useConnectorStore } from "@/stores/connectorStore";
import { useLocation } from "wouter";
import { useIsFetching } from "@tanstack/react-query";
import {
  LayoutGrid, LayoutDashboard, Share2, ShieldCheck, Package, FileSignature,
  Search, FileText, ArrowRightLeft, Key,
  ChevronRight, ChevronLeft, ChevronDown, Menu, X, Bell,
  Settings, LogOut, MoreHorizontal,
  Vault as VaultIcon, ScrollText, Boxes, BookMarked, Shapes,
  Activity, ListChecks, Workflow, Wrench, Network, Fingerprint,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n, LOCALES } from "@/i18n";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { useSidebarCounts } from "@/hooks/useSidebarCounts";
import NotificationPanel from "./NotificationPanel";
import ConnectorSelectorCard from "./ConnectorSelectorCard";

/* ─── Types ──────────────────────────────────────────────────── */
interface NavItem {
  path: string;
  label: string;
  Icon: React.ElementType;
  count?: number;
  badge?: "new";
  postMvp?: boolean;
  /** short label for bottom tab bar */
  shortLabel?: string;
}

interface NavGroup {
  key: string;
  label: string;
  Icon?: React.ElementType;
  items: NavItem[];
}

function useNavItems() {
  const { t } = useI18n();

  const fleetGroup = (): NavGroup => ({
    key: "fleet",
    label: t.nav.groupFleet,
    Icon: Network,
    items: [
      { path: "/fleet", label: t.nav.fleetOverview, Icon: LayoutGrid },
    ],
  });

  const systemGroup = (): NavGroup => ({
    key: "system",
    label: t.nav.groupSystem,
    Icon: Wrench,
    items: [
      { path: "/system/vault", label: t.nav.vault, Icon: VaultIcon, postMvp: true },
      { path: "/system/identity-hub", label: t.nav.identityHub, Icon: Fingerprint, postMvp: true },
      { path: "/system/audit", label: t.nav.audit, Icon: ScrollText, postMvp: true },
    ],
  });

  const digitalTwinGroup = (): NavGroup => ({
    key: "digitalTwin",
    label: t.nav.groupDigitalTwin,
    Icon: Boxes,
    items: [
      { path: "/registry", label: t.nav.digitalTwins, Icon: BookMarked },
      { path: "/submodels", label: t.nav.submodels, Icon: Shapes },
    ],
  });

  const connectorGroups = (id: string, counts?: import("@/hooks/useSidebarCounts").SidebarCounts): NavGroup[] => [
    {
      key: "ops",
      label: t.nav.groupOps,
      Icon: Activity,
      items: [
        { path: `/connectors/${id}/dashboard`, label: t.nav.dashboard, Icon: LayoutDashboard },
      ],
    },
    {
      key: "provide",
      label: t.nav.groupProvide,
      Icon: Share2,
      items: [
        { path: `/connectors/${id}/assets`, label: t.nav.assets, Icon: Package, count: counts?.assets },
        { path: `/connectors/${id}/policy`, label: t.nav.policies, Icon: ShieldCheck, count: counts?.policies },
        { path: `/connectors/${id}/contract`, label: t.nav.offerings, Icon: FileSignature, count: counts?.offerings },
      ],
    },
    {
      key: "tx",
      label: t.nav.groupTransaction,
      Icon: ArrowRightLeft,
      items: [
        { path: `/connectors/${id}/catalog`, label: t.nav.catalog, Icon: Search },
        { path: `/connectors/${id}/negotiation`, label: t.nav.negotiations, Icon: FileText, count: counts?.negotiations },
        { path: `/connectors/${id}/transfer`, label: t.nav.transfers, Icon: ArrowRightLeft, count: counts?.transfers },
        { path: `/connectors/${id}/edr`, label: t.nav.edr, Icon: Key, count: counts?.edrs },
      ],
    },
  ];

  return { fleetGroup, systemGroup, connectorGroups, digitalTwinGroup };
}

/* ─── Bottom Tab Bar items (Mobile) ──────────────────────────── */
interface BottomTab {
  pathSuffix: string;
  label: string;
  Icon: React.ElementType;
}

function useBottomTabs(roles?: string[]) {
  const { t } = useI18n();
  const isProvider = roles?.includes("Provider") ?? false;
  // Provider: dashboard / assets / negotiation / transfer / more
  // Consumer: dashboard / catalog / negotiation / transfer / more
  const connectorTabs: BottomTab[] = [
    { pathSuffix: "dashboard",   label: t.nav.dashboard,    Icon: LayoutDashboard },
    ...(isProvider
      ? [{ pathSuffix: "assets",   label: t.nav.assets,      Icon: Package }]
      : [{ pathSuffix: "catalog",  label: t.nav.catalog,     Icon: Search }]),
    { pathSuffix: "negotiation", label: t.nav.negotiations, Icon: FileText },
    { pathSuffix: "transfer",    label: t.nav.transfers,    Icon: ArrowRightLeft },
    { pathSuffix: "more",        label: t.nav.more,         Icon: MoreHorizontal },
  ];
  const fleetTabs: BottomTab[] = [
    { pathSuffix: "fleet",       label: t.nav.fleet,        Icon: LayoutGrid },
    { pathSuffix: "assets",      label: t.nav.assets,       Icon: Package },
    { pathSuffix: "negotiation", label: t.nav.negotiations, Icon: FileText },
    { pathSuffix: "transfer",    label: t.nav.transfers,    Icon: ArrowRightLeft },
    { pathSuffix: "more",        label: t.nav.more,         Icon: MoreHorizontal },
  ];
  return { connectorTabs, fleetTabs };
}

/* ─── Sidebar ────────────────────────────────────────────────── */
function Sidebar({ className, style, collapsed, onToggle }: { className?: string; style?: React.CSSProperties; collapsed?: boolean; onToggle?: () => void }) {
  const [location, navigate] = useLocation();
  const connector = useConnectorStore((s) => s.connector);
  const setDrawerOpen = useConnectorStore((s) => s.setDrawerOpen);
  const { fleetGroup, systemGroup, connectorGroups, digitalTwinGroup } = useNavItems();
  const counts = useSidebarCounts(connector?.id ?? null);
  const { t } = useI18n();
  const { logout } = useAuth();
  const unreadCount = useUnreadNotificationCount();
  const openNotifications = useNotificationStore((s) => s.setPanelOpen);

  // Level-1 group expand/collapse (fl-aggregator pattern)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const groups: NavGroup[] = connector
    ? [fleetGroup(), ...connectorGroups(connector.id, counts), digitalTwinGroup(), systemGroup()]
    : [fleetGroup(), digitalTwinGroup(), systemGroup()];

  const handleNav = (path: string) => {
    navigate(path);
    setDrawerOpen(false);
  };

  const isItemActive = (path: string) =>
    path === "/fleet"
      ? location === "/fleet" || location === "/"
      : location === path || location.startsWith(path + "/");

  return (
    <aside
      className={cn("flex flex-col flex-shrink-0 sidebar-scroll overflow-x-hidden overflow-y-auto bg-sidebar text-sidebar-foreground border-r border-sidebar-border", className)}
      style={style}
    >
      {/* Brand */}
      <div
        className={cn("flex items-center py-4 gap-3 flex-shrink-0", collapsed ? "px-3 justify-center" : "px-4")}
        style={{ borderBottom: "1px solid oklch(0.38 0.10 240 / 0.6)" }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "oklch(0.60 0.22 240)", boxShadow: "0 4px 12px oklch(0.40 0.20 240 / 0.5)" }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" className="text-white">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold text-white leading-tight truncate">{t.common.appName}</p>
            <p className="text-[11px] leading-tight" style={{ color: "oklch(0.70 0.06 240)" }}>{t.common.appSubtitle}</p>
          </div>
        )}
        {onToggle && (
          <button
            onClick={onToggle}
            title={collapsed ? t.common.expand : t.common.collapse}
            className="hidden lg:flex items-center justify-center w-5 h-5 rounded transition-colors"
            style={{ color: "oklch(0.60 0.06 240)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "white"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.60 0.06 240)"; }}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        )}
      </div>

      {/* Connector Selector */}
      <ConnectorSelectorCard collapsed={collapsed} />

      {/* Nav Items */}
      <nav className={cn("flex-1 overflow-y-auto py-3 px-2", collapsed && "px-2")}>
        <div className="space-y-3">
        {groups.map((group, gi) => {
          const GroupIcon = group.Icon;
          const isGroupCollapsed = collapsedGroups.has(group.key);
          return (
            <div key={group.key} className={cn(gi > 0 && "pt-3")} style={gi > 0 ? { borderTop: "1px solid oklch(0.38 0.10 240 / 0.5)" } : undefined}>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="w-full flex items-center gap-1.5 text-[11px] uppercase tracking-widest px-2 mb-2 font-semibold transition-colors"
                  style={{ color: "oklch(0.58 0.08 240)" }}
                >
                  {GroupIcon && <GroupIcon size={14} style={{ color: "oklch(0.62 0.08 240)" }} />}
                  <span className="flex-1 text-left">{group.label}</span>
                  {isGroupCollapsed
                    ? <ChevronRight size={12} style={{ color: "oklch(0.62 0.08 240)" }} />
                    : <ChevronDown size={12} style={{ color: "oklch(0.62 0.08 240)" }} />}
                </button>
              )}
              <div className={cn("space-y-0.5", !collapsed && isGroupCollapsed && "hidden")}>
                {group.items.map((it) => {
                  const isActive = isItemActive(it.path);
                  const { Icon } = it;
                  return (
                    <button
                      key={it.path}
                      onClick={() => handleNav(it.path)}
                      title={collapsed ? it.label : undefined}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all duration-150 text-left relative",
                        collapsed && "lg:justify-center lg:px-0",
                      )}
                      style={
                        isActive
                          ? { background: "oklch(0.60 0.22 240 / 0.30)", color: "white", fontWeight: 600, boxShadow: "inset 0 0 0 1px oklch(0.65 0.20 240 / 0.4)" }
                          : { color: "oklch(0.75 0.06 240)" }
                      }
                      onMouseEnter={(e) => { if (!isActive) { (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.38 0.10 240 / 0.5)"; (e.currentTarget as HTMLButtonElement).style.color = "white"; } }}
                      onMouseLeave={(e) => { if (!isActive) { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.75 0.06 240)"; } }}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r" style={{ background: "oklch(0.75 0.18 220)" }} />
                      )}
                      <span style={{ color: isActive ? "oklch(0.82 0.15 220)" : "oklch(0.62 0.08 240)", display: "inline-flex" }}>
                        <Icon size={16} />
                      </span>
                      {!collapsed && (
                        <>
                          <span className="flex-1 truncate">{it.label}</span>
                          {it.count !== undefined && (
                            <span
                              className="text-[11px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                              style={
                                isActive
                                  ? { background: "oklch(1 0 0 / 0.15)", color: "white" }
                                  : { background: "oklch(0.75 0.18 75 / 0.15)", color: "oklch(0.85 0.12 75)", border: "1px solid oklch(0.75 0.18 75 / 0.3)" }
                              }
                            >
                              {it.count}
                            </span>
                          )}
                          {isActive && <ChevronRight size={12} style={{ color: "oklch(0.75 0.15 220)", flexShrink: 0 }} />}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </nav>

      {/* Bottom Links */}
      <div
        className={cn("p-2 space-y-0.5", collapsed && "px-1")}
        style={{ borderTop: "1px solid oklch(0.38 0.10 240 / 0.5)" }}
      >
        {/* Notifications */}
        <button
          onClick={() => openNotifications(true)}
          title={collapsed ? t.nav.notifications : undefined}
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs transition-colors relative",
            collapsed && "lg:justify-center lg:px-0"
          )}
          style={{ color: "oklch(0.65 0.05 240)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.38 0.10 240 / 0.5)"; (e.currentTarget as HTMLButtonElement).style.color = "white"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.65 0.05 240)"; }}
        >
          <Bell className="w-[14px] h-[14px]" />
          {!collapsed && <span className="flex-1 text-left">{t.nav.notifications}</span>}
          {unreadCount > 0 && (
            <span className={cn(
              "text-[11px] px-1.5 py-0.5 rounded-full bg-rose-500 text-white font-bold min-w-[16px] text-center",
              collapsed && "absolute top-1 right-1 px-1 min-w-[14px]"
            )}>
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => handleNav("/settings")}
          title={collapsed ? t.nav.settings : undefined}
          className={cn("w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs transition-colors", collapsed && "lg:justify-center lg:px-0")}
          style={{ color: "oklch(0.65 0.05 240)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.38 0.10 240 / 0.5)"; (e.currentTarget as HTMLButtonElement).style.color = "white"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.65 0.05 240)"; }}
        >
          <Settings className="w-[14px] h-[14px]" />
          {!collapsed && t.nav.settings}
        </button>
        <button
          onClick={logout}
          title={collapsed ? t.nav.signOut : undefined}
          className={cn("w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs transition-colors", collapsed && "lg:justify-center lg:px-0")}
          style={{ color: "oklch(0.65 0.05 240)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "oklch(0.38 0.10 240 / 0.5)"; (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.80 0.18 27)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.65 0.05 240)"; }}
        >
          <LogOut className="w-[14px] h-[14px]" />
          {!collapsed && t.nav.signOut}
        </button>
      </div>
    </aside>
  );
}

/* ─── Topbar ─────────────────────────────────────────────────── */
function Topbar() {
  const [location] = useLocation();
  const setDrawerOpen = useConnectorStore((s) => s.setDrawerOpen);
  const { locale, setLocale, t } = useI18n();
  const { user } = useAuth();
  const { fleetGroup, systemGroup, connectorGroups, digitalTwinGroup } = useNavItems();
  const togglePanel = useNotificationStore((s) => s.togglePanel);
  const panelOpen = useNotificationStore((s) => s.panelOpen);
  const unreadCount = useUnreadNotificationCount();

  const allItems: NavItem[] = [
    ...fleetGroup().items,
    ...connectorGroups("__id__").flatMap((g) => g.items),
    ...digitalTwinGroup().items,
    ...systemGroup().items,
  ];
  const locSuffix = location.replace(/^\/connectors\/[^/]+/, "");
  const currentLabel = allItems.find((it) => {
    const normalized = it.path.replace(/^\/connectors\/__id__/, "");
    if (!normalized) return location === it.path || location === "/";
    return locSuffix === normalized || locSuffix.startsWith(normalized + "/") || location === it.path;
  })?.label;

  const roleLabel = user?.role ?? "User";

  return (
    <header className="h-12 flex items-center gap-3 px-4 border-b border-border bg-card flex-shrink-0 shadow-sm">
      {/* Mobile menu */}
      <button onClick={() => setDrawerOpen(true)} className="lg:hidden p-1 rounded hover:bg-muted transition-colors">
        <Menu className="w-4 h-4 text-muted-foreground" />
      </button>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs flex-1 min-w-0">
        <span className="text-muted-foreground">{t.common.appName}</span>
        {currentLabel && (
          <>
            <ChevronRight className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />
            <span className="font-semibold text-foreground truncate">{currentLabel}</span>
          </>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
        <span className="hidden sm:block text-[12px] text-muted-foreground font-medium">v0.16.0</span>
        {/* Notification Bell */}
        <button
          onClick={togglePanel}
          aria-label={t.nav.notifications}
          className={cn(
            "relative inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors",
            panelOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
          )}
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span
              className="absolute top-1 right-1 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-bold"
              style={{ background: "oklch(0.62 0.22 25)", color: "white", boxShadow: "0 0 0 1.5px white" }}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        {/* Language toggle */}
        <button
          onClick={() => setLocale(locale === "ko" ? "en" : "ko")}
          className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted font-medium"
          title={locale === "ko" ? "Switch to English" : "한국어로 전환"}
        >
          {LOCALES[locale].flag} {locale.toUpperCase()}
        </button>
        {/* User info */}
        <div className="flex items-center gap-2 pl-3 border-l border-border">
          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-white text-[11px] font-bold">{(user?.name ?? user?.username ?? "U")[0]?.toUpperCase()}</span>
          </div>
          <div className="hidden sm:block leading-tight">
            <p className="text-xs font-semibold text-foreground">{user?.username ?? "user"}</p>
            {user?.tenantBpn && (
              <p className="mono text-[10px] text-muted-foreground leading-tight" title={user.tenantName}>{user.tenantBpn}</p>
            )}
          </div>
          <span className="text-[11px] px-1.5 py-0.5 rounded font-medium border bg-primary/10 text-primary border-primary/30 capitalize">
            {roleLabel}
          </span>
        </div>
      </div>
    </header>
  );
}

/* ─── Bottom Tab Bar (Mobile < 640px) ────────────────────────── */
function BottomTabBar() {
  const [location, navigate] = useLocation();
  const connector = useConnectorStore((s) => s.connector);
  const setDrawerOpen = useConnectorStore((s) => s.setDrawerOpen);
  const { connectorTabs, fleetTabs } = useBottomTabs(connector?.roles);

  const tabs = connector ? connectorTabs : fleetTabs;
  const connId = connector?.id ?? "";

  const getPath = (suffix: string) => {
    if (suffix === "fleet") return "/fleet";
    if (suffix === "more") return ""; // opens drawer
    return connector ? `/connectors/${connId}/${suffix}` : `/fleet`;
  };

  const isActive = (suffix: string) => {
    if (suffix === "fleet") return location === "/fleet" || location === "/";
    if (suffix === "more") return false;
    return location.includes(`/${suffix}`);
  };

  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border flex items-center justify-around h-14 px-1 safe-area-bottom">
      {tabs.map(({ pathSuffix, label, Icon }) => {
        const active = isActive(pathSuffix);
        return (
          <button
            key={pathSuffix}
            onClick={() => {
              if (pathSuffix === "more") {
                setDrawerOpen(true);
              } else {
                navigate(getPath(pathSuffix));
              }
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg transition-colors",
              active ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
            )}
          >
            <Icon className={cn("w-5 h-5", active && "stroke-[2.5px]")} />
            <span className={cn("text-[11px]", active ? "font-semibold" : "font-medium")}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ─── Navigation Loading Dialog ─────────────────────────────── */
function NavigationLoadingDialog() {
  const { t } = useI18n();
  const navigating = useConnectorStore((s) => s.navigating);
  const connector = useConnectorStore((s) => s.connector);
  const isFetching = useIsFetching();
  const visible = navigating || isFetching > 0;

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="bg-card border border-border rounded-xl shadow-2xl px-8 py-6 flex flex-col items-center gap-4 min-w-[220px]">
        {/* Spinner */}
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-[3px] border-border" />
          <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-blue-500 animate-spin" />
        </div>
        {/* Text */}
        <div className="flex flex-col items-center gap-1 text-center">
          {connector ? (
            <>
              <span className="text-[15px] font-semibold text-foreground">{connector.name}</span>
              <span className="text-[12px] text-muted-foreground">{t.common.loadingData}</span>
            </>
          ) : (
            <span className="text-[15px] font-semibold text-foreground">{t.common.loading}</span>
          )}
        </div>
        {/* Progress bar */}
        <div className="w-full h-[3px] bg-border rounded-full overflow-hidden">
          <div className="h-full w-1/2 bg-blue-500 nav-progress-bar rounded-full" />
        </div>
      </div>
    </div>
  );
}

/* ─── App Shell ──────────────────────────────────────────────── */
interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const drawerOpen = useConnectorStore((s) => s.drawerOpen);
  const setDrawerOpen = useConnectorStore((s) => s.setDrawerOpen);
  const { t } = useI18n();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <NavigationLoadingDialog />

      {/* Desktop Sidebar (lg+) */}
      <Sidebar
        className="hidden lg:flex"
        style={{ width: sidebarCollapsed ? 56 : 224, minWidth: sidebarCollapsed ? 56 : 224, maxWidth: sidebarCollapsed ? 56 : 224 }}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
      />

      {/* Mobile/Tablet Overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      {/* Mobile/Tablet Drawer */}
      <div className={cn(
        "fixed left-0 top-0 bottom-0 z-50 w-64 flex flex-col lg:hidden transition-transform duration-200",
        drawerOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex items-center justify-between px-4 h-11 bg-card border-b border-border">
          <span className="font-display font-semibold text-sm">{t.common.appName}</span>
          <button onClick={() => setDrawerOpen(false)}>
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <Sidebar className="flex flex-1" />
      </div>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="p-3 sm:p-4 xl:p-5 flex flex-col gap-4 min-h-full page-enter pb-20 sm:pb-4">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <BottomTabBar />

      {/* Notification Panel (Sheet slide-over) */}
      <NotificationPanel />
    </div>
  );
}

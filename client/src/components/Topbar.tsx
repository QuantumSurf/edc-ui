/**
 * Topbar — pcf-exchange-ui 셸과 동일한 메인 타이틀 바.
 * 좌측 메뉴 토글 + 브레드크럼(앱명 + 현재 페이지),
 * 우측 검색 · 버전 · 테마 토글 · 언어(KO/EN) · 알림 벨 · 사용자/역할.
 */
import { useLocation } from "wouter";
import {
  ChevronRight,
  Bell,
  Sun,
  Moon,
  Search,
  Settings as SettingsIcon,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnectorStore } from "@/stores/connectorStore";
import { useTheme } from "@/contexts/ThemeContext";
import { useI18n, type Translations } from "@/i18n";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { useAuth } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/** 현재 경로 → 페이지 라벨 (커넥터 종속 경로는 suffix 로 매칭) */
function currentLabel(t: Translations, location: string): string | undefined {
  const suffix = location.replace(/^\/connectors\/[^/]+/, "");
  const map: Record<string, string> = {
    "/fleet": t.nav.fleetOverview,
    "/dashboard": t.nav.dashboard,
    "/assets": t.nav.assets,
    "/policy": t.nav.policies,
    "/contract": t.nav.offerings,
    "/catalog": t.nav.catalog,
    "/negotiation": t.nav.negotiations,
    "/transfer": t.nav.transfers,
    "/edr": t.nav.edr,
    "/infra": t.nav.infra,
    "/registry": t.nav.digitalTwins,
    "/submodels": t.nav.submodels,
    "/system/vault": t.nav.vault,
    "/system/identity-hub": t.nav.identityHub,
    "/system/audit": t.nav.audit,
    "/settings": t.nav.settings,
  };
  if (location === "/" || location === "/fleet") return t.nav.fleetOverview;
  return map[location] ?? map[suffix];
}

export default function Topbar() {
  const [location, navigate] = useLocation();
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const setSearchOpen = useConnectorStore(s => s.setSearchOpen);
  const togglePanel = useNotificationStore(s => s.togglePanel);
  const panelOpen = useNotificationStore(s => s.panelOpen);
  const unreadCount = useUnreadNotificationCount();

  const label = currentLabel(t, location);
  const roleLabel =
    user?.role === "admin"
      ? t.auth.roleAdmin
      : user?.role === "operator"
        ? t.auth.roleOperator
        : user?.role === "viewer"
          ? t.auth.roleViewer
          : (user?.role ?? "User");

  return (
    <header className="h-12 flex items-center gap-3 px-4 border-b border-border bg-card flex-shrink-0 shadow-sm">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs flex-1 min-w-0">
        <span className="text-muted-foreground">{t.common.appName}</span>
        {label && (
          <>
            <ChevronRight className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />
            <span className="font-semibold text-foreground truncate">
              {label}
            </span>
          </>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* 글로벌 검색 (Ctrl/Cmd+K) */}
        <button
          onClick={() => setSearchOpen(true)}
          aria-label={t.common.searchTitle}
          title={t.common.searchTitle}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden md:inline">{t.common.searchTitle}</span>
          <kbd className="hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium text-muted-foreground">
            Ctrl K
          </kbd>
        </button>

        {/* 버전 */}
        <span className="hidden sm:block text-[12px] text-muted-foreground font-medium tabular-nums">
          v0.16.0
        </span>

        {/* 다크/라이트 테마 토글 */}
        <button
          onClick={toggleTheme}
          title={
            theme === "dark"
              ? locale === "ko"
                ? "라이트 모드로 전환"
                : "Switch to light"
              : locale === "ko"
                ? "다크 모드로 전환"
                : "Switch to dark"
          }
          aria-label={
            theme === "dark"
              ? locale === "ko"
                ? "라이트 모드로 전환"
                : "Switch to light"
              : locale === "ko"
                ? "다크 모드로 전환"
                : "Switch to dark"
          }
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {theme === "dark" ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>

        {/* 언어 KO / EN */}
        <div
          className="flex items-center gap-0.5 text-[12px] font-medium"
          role="group"
          aria-label={locale === "ko" ? "언어 선택" : "Language"}
        >
          <button
            onClick={() => setLocale("ko")}
            aria-pressed={locale === "ko"}
            className={cn(
              "px-1.5 py-1 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              locale === "ko"
                ? "text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            KO
          </button>
          <span className="text-muted-foreground/40" aria-hidden="true">
            /
          </span>
          <button
            onClick={() => setLocale("en")}
            aria-pressed={locale === "en"}
            className={cn(
              "px-1.5 py-1 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              locale === "en"
                ? "text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            EN
          </button>
        </div>

        {/* Notification Bell */}
        <button
          onClick={togglePanel}
          aria-label={t.nav.notifications}
          className={cn(
            "relative inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors",
            panelOpen
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
          )}
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold pointer-events-none"
              style={{
                background: "oklch(0.62 0.22 25)",
                color: "white",
                boxShadow: "0 0 0 1.5px var(--card)",
              }}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {/* User menu (드롭다운: 설정 / 로그아웃) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={locale === "ko" ? "사용자 메뉴" : "User menu"}
              className="flex items-center gap-2 pl-3 py-1 border-l border-border hover:bg-muted/40 rounded-r-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                <span className="text-white text-[11px] font-bold">
                  {(user?.name ?? user?.username ?? "U")[0]?.toUpperCase()}
                </span>
              </div>
              <div className="hidden sm:block leading-tight text-left">
                <p className="text-xs font-semibold text-foreground">
                  {user?.username ?? "user"}
                </p>
                {user?.tenantBpn && (
                  <p
                    className="mono text-[10px] text-muted-foreground leading-tight"
                    title={user.tenantName}
                  >
                    {user.tenantBpn}
                  </p>
                )}
              </div>
              <span className="text-[11px] px-1.5 py-0.5 rounded font-medium border bg-primary/10 text-primary border-primary/30">
                {roleLabel}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="space-y-0.5">
              <p className="text-xs font-semibold text-foreground truncate">
                {user?.name ?? user?.username ?? "user"}
              </p>
              {user?.email && (
                <p className="text-[11px] font-normal text-muted-foreground truncate">
                  {user.email}
                </p>
              )}
              {user?.tenantName && (
                <p className="text-[11px] font-normal text-muted-foreground truncate">
                  {user.tenantName}
                  {user?.tenantBpn ? ` · ${user.tenantBpn}` : ""}
                </p>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => navigate("/settings")}
              className="gap-2 text-xs"
            >
              <SettingsIcon className="w-3.5 h-3.5" /> {t.nav.settings}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={logout}
              className="gap-2 text-xs text-rose-600 dark:text-rose-400 focus:text-rose-600 dark:focus:text-rose-400"
            >
              <LogOut className="w-3.5 h-3.5" /> {t.nav.signOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

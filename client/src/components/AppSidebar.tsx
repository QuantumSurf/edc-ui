/**
 * AppSidebar — pcf-exchange-ui 셸 구조와 동일한 다크 네이비 사이드바.
 * 디자인: kmx 톤(oklch 240) + 좌측 액센트 활성 상태 + 그룹 접기/펼치기.
 * edc 고유: 커넥터 종속 네비(플릿 → 커넥터 선택 → OPS/PROVIDE/TRANSACTION) 기능 유지.
 */
import { cn } from "@/lib/utils";
import { useConnectorStore } from "@/stores/connectorStore";
import { Link, useLocation } from "wouter";
import { useState } from "react";
import {
  LayoutGrid,
  LayoutDashboard,
  Share2,
  ShieldCheck,
  Package,
  FileSignature,
  Search,
  FileText,
  ArrowRightLeft,
  Send,
  Key,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Bell,
  Settings as SettingsIcon,
  LogOut,
  Vault as VaultIcon,
  ScrollText,
  Boxes,
  BookMarked,
  Shapes,
  Activity,
  Wrench,
  Network,
  Fingerprint,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/i18n";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { useSidebarCounts, type SidebarCounts } from "@/hooks/useSidebarCounts";
import ConnectorSelectorCard from "./ConnectorSelectorCard";

interface NavItem {
  path: string;
  label: string;
  Icon: React.ElementType;
  count?: number;
}

interface NavGroup {
  key: string;
  label: string;
  Icon: React.ElementType;
  items: NavItem[];
}

/* 다크 사이드바 인터랙션 색상 (kmx 톤) */
const C = {
  idle: "oklch(0.75 0.06 240)",
  idleBg: "oklch(0.38 0.10 240 / 0.5)",
  groupLabel: "oklch(0.58 0.08 240)",
  groupIcon: "oklch(0.62 0.08 240)",
  activeBg: "oklch(0.60 0.22 240 / 0.30)",
  activeRing: "oklch(0.65 0.20 240 / 0.4)",
  activeAccent: "oklch(0.75 0.18 220)",
  activeIcon: "oklch(0.82 0.15 220)",
  bottomIdle: "oklch(0.65 0.05 240)",
  border: "oklch(0.38 0.10 240 / 0.6)",
  borderSoft: "oklch(0.38 0.10 240 / 0.5)",
};

function useNavGroups(): { build: () => NavGroup[] } {
  const { t } = useI18n();
  const connector = useConnectorStore(s => s.connector);
  const counts = useSidebarCounts(connector?.id ?? null);

  const fleetGroup: NavGroup = {
    key: "fleet",
    label: t.nav.groupFleet,
    Icon: Network,
    items: [{ path: "/fleet", label: t.nav.fleetOverview, Icon: LayoutGrid }],
  };

  const digitalTwinGroup: NavGroup = {
    key: "digitalTwin",
    label: t.nav.groupDigitalTwin,
    Icon: Boxes,
    items: [
      { path: "/registry", label: t.nav.digitalTwins, Icon: BookMarked },
      { path: "/submodels", label: t.nav.submodels, Icon: Shapes },
    ],
  };

  const systemGroup: NavGroup = {
    key: "system",
    label: t.nav.groupSystem,
    Icon: Wrench,
    items: [
      { path: "/system/vault", label: t.nav.vault, Icon: VaultIcon },
      {
        path: "/system/identity-hub",
        label: t.nav.identityHub,
        Icon: Fingerprint,
      },
      { path: "/system/audit", label: t.nav.audit, Icon: ScrollText },
    ],
  };

  const connectorGroups = (id: string, c?: SidebarCounts): NavGroup[] => [
    {
      key: "ops",
      label: t.nav.groupOps,
      Icon: Activity,
      items: [
        {
          path: `/connectors/${id}/dashboard`,
          label: t.nav.dashboard,
          Icon: LayoutDashboard,
        },
      ],
    },
    {
      key: "provide",
      label: t.nav.groupProvide,
      Icon: Share2,
      items: [
        {
          path: `/connectors/${id}/assets`,
          label: t.nav.assets,
          Icon: Package,
          count: c?.assets,
        },
        {
          path: `/connectors/${id}/policy`,
          label: t.nav.policies,
          Icon: ShieldCheck,
          count: c?.policies,
        },
        {
          path: `/connectors/${id}/contract`,
          label: t.nav.offerings,
          Icon: FileSignature,
          count: c?.offerings,
        },
      ],
    },
    {
      key: "tx",
      label: t.nav.groupTransaction,
      Icon: ArrowRightLeft,
      items: [
        {
          path: `/connectors/${id}/catalog`,
          label: t.nav.catalog,
          Icon: Search,
        },
        {
          path: `/connectors/${id}/negotiation`,
          label: t.nav.negotiations,
          Icon: FileText,
          count: c?.negotiations,
        },
        {
          path: `/connectors/${id}/transfer`,
          label: t.nav.transfers,
          Icon: Send,
          count: c?.transfers,
        },
        {
          path: `/connectors/${id}/edr`,
          label: t.nav.edr,
          Icon: Key,
          count: c?.edrs,
        },
      ],
    },
  ];

  const build = (): NavGroup[] =>
    connector
      ? [
          fleetGroup,
          ...connectorGroups(connector.id, counts),
          digitalTwinGroup,
          systemGroup,
        ]
      : [fleetGroup, digitalTwinGroup, systemGroup];

  return { build };
}

export default function AppSidebar({
  onCollapse,
  onNavigate,
}: {
  onCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const [location] = useLocation();
  const { t } = useI18n();
  const { logout } = useAuth();
  const { build } = useNavGroups();
  const unreadCount = useUnreadNotificationCount();
  const openNotifications = useNotificationStore(s => s.setPanelOpen);
  const collapsed = useConnectorStore(s => s.sidebarCollapsed);
  const toggleCollapsed = useConnectorStore(s => s.toggleSidebarCollapsed);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set()
  );
  const toggleGroup = (key: string) =>
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const groups = build();

  const isActive = (path: string) =>
    path === "/fleet"
      ? location === "/fleet" || location === "/"
      : location === path || location.startsWith(path + "/");

  return (
    <aside
      className={cn(
        "shrink-0 flex flex-col h-screen sidebar-scroll overflow-x-hidden overflow-y-auto bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[width] duration-200",
        // 데스크톱(lg+)만 레일 폭 적용 — 모바일 드로어는 항상 풀 폭(w-60)으로 펼쳐야 가독성 유지.
        collapsed ? "w-60 lg:w-16" : "w-60"
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex items-center py-4 gap-3 flex-shrink-0",
          // 접힘(lg+): 로고 위 / 토글 아래 세로 스택 → w-16 레일 안에서 겹침 없이 둘 다 노출
          collapsed
            ? "px-4 lg:flex-col lg:gap-2 lg:px-0 lg:items-center"
            : "px-4"
        )}
        style={{ borderBottom: `1px solid ${C.border}` }}
      >
        <img
          src="/logo.svg"
          alt="Quantum-X"
          width="28"
          height="28"
          className="w-7 h-7 flex-shrink-0"
        />
        {/* 접힘(lg+)에선 브랜드 텍스트 숨기고 로고만 레일 중앙 정렬 */}
        <div className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
          <p className="text-sm font-semibold text-white leading-tight truncate">
            Quantum-X
          </p>
          <p className="text-[11px] font-semibold leading-tight text-white truncate">
            {t.common.appName}
          </p>
        </div>
        {/* 모바일 드로어 닫기 전용 (lg:hidden) */}
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label={t.common.collapse}
            title={t.common.collapse}
            className="lg:hidden shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400/70"
            style={{ color: C.idle }}
            onMouseEnter={e => {
              e.currentTarget.style.background = C.idleBg;
              e.currentTarget.style.color = "white";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = C.idle;
            }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        {/* 데스크톱 전용 레일 접기/펼치기 토글 — 접어도 레일이 남아 다시 펼 수 있음.
            펼침=ChevronLeft, 접힘=ChevronRight (형제 공통 패턴). */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? t.common.expand : t.common.collapse}
          title={collapsed ? t.common.expand : t.common.collapse}
          className="hidden lg:inline-flex shrink-0 items-center justify-center w-6 h-6 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400/70"
          style={{ color: C.idle }}
          onMouseEnter={e => {
            e.currentTarget.style.background = C.idleBg;
            e.currentTarget.style.color = "white";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = C.idle;
          }}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Connector Selector (커넥터 선택 시에만 표시) */}
      <ConnectorSelectorCard collapsed={collapsed} />

      {/* Nav Groups */}
      <nav
        aria-label={t.nav.primary}
        className="flex-1 overflow-y-auto py-3 px-2"
      >
        <div className="space-y-3">
          {groups.map((group, gi) => {
            const GroupIcon = group.Icon;
            const groupCollapsed = collapsedGroups.has(group.key);
            return (
              <div
                key={group.key}
                className={cn(gi > 0 && "pt-3")}
                style={
                  gi > 0
                    ? { borderTop: `1px solid ${C.borderSoft}` }
                    : undefined
                }
              >
                {/* 접힘(lg+)에선 그룹 라벨·접기 chevron 을 숨기고 아이콘 링크만 노출 */}
                {collapsed ? (
                  <div className="hidden lg:block h-1" aria-hidden="true" />
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={!groupCollapsed}
                    aria-controls={`navgrp-${group.key}`}
                    className="w-full flex items-center gap-1.5 text-[11px] uppercase tracking-widest px-2 mb-2 font-semibold transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400/70"
                    style={{ color: C.groupLabel }}
                  >
                    <GroupIcon size={14} style={{ color: C.groupIcon }} />
                    <span className="flex-1 text-left">{group.label}</span>
                    {groupCollapsed ? (
                      <ChevronRight size={12} style={{ color: C.groupIcon }} />
                    ) : (
                      <ChevronDown size={12} style={{ color: C.groupIcon }} />
                    )}
                  </button>
                )}
                <div
                  id={`navgrp-${group.key}`}
                  role="group"
                  aria-label={group.label}
                  className={cn(
                    "space-y-0.5",
                    // 접힘 시엔 그룹 접기를 무시하고 항상 아이콘을 보여줘야 레일이 유효
                    !collapsed && groupCollapsed && "hidden"
                  )}
                >
                  {group.items.map(it => (
                    <SidebarLink
                      key={it.path}
                      href={it.path}
                      icon={it.Icon}
                      label={it.label}
                      count={it.count}
                      active={isActive(it.path)}
                      collapsed={collapsed}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </nav>

      {/* Bottom Links — 설정/알림/로그아웃 모두 동일 컴포넌트로 통일(아이콘 크기·자간 일치) */}
      <div
        className="p-2 space-y-0.5"
        style={{ borderTop: `1px solid ${C.borderSoft}` }}
      >
        <SidebarLink
          href="/settings"
          icon={SettingsIcon}
          label={t.nav.settings}
          active={location === "/settings"}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
        {/* 항목 사이 얇은 구분선 — 형제 프로젝트(pcf·fl-agent·identityhub 등) 과반수 푸터 형식 통일.
            접힘 레일에서도 구분선은 유지(아이콘 그룹 구획) */}
        <div className="h-px mx-1 my-1" style={{ background: C.borderSoft }} />
        <SidebarLink
          icon={Bell}
          label={t.nav.notifications}
          badge={unreadCount}
          collapsed={collapsed}
          onClick={() => openNotifications(true)}
        />
        <div className="h-px mx-1 my-1" style={{ background: C.borderSoft }} />
        <SidebarLink
          icon={LogOut}
          label={t.nav.signOut}
          collapsed={collapsed}
          onClick={logout}
        />
      </div>
    </aside>
  );
}

/* ─── Sidebar Link (nav item / action) ────────────────────────────
 * href 가 있으면 라우팅 링크, 없으면 onClick 액션(알림 패널·로그아웃).
 * count: 자원 개수(앰버), badge: 안읽음 수(로즈). 셋 다 동일 마크업 → 자간/정렬 일치.
 */
function SidebarLink({
  href,
  icon: Icon,
  label,
  count,
  badge,
  active = false,
  collapsed = false,
  onClick,
  onNavigate,
}: {
  href?: string;
  icon: React.ElementType;
  label: string;
  count?: number;
  badge?: number;
  active?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
  onNavigate?: () => void;
}) {
  // nav(href)는 <a>(wouter Link) 단일, 액션(onClick)은 <button> 단일로 렌더 →
  // <a><button> 중첩(비유효 HTML/a11y) 회피. aria-current 도 실제 요소에 부여.
  // 접힘(lg+): 아이콘만 중앙정렬(lg:justify-center lg:px-0), 텍스트/배지 숨김 + title 툴팁.
  const className = cn(
    "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all duration-150 text-left relative focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400/70",
    collapsed && "lg:justify-center lg:px-0"
  );
  // 접힘 시에만 native title 툴팁 — 펼침 상태에선 라벨이 보이므로 불필요
  const title = collapsed ? label : undefined;
  const style: React.CSSProperties = active
    ? {
        background: C.activeBg,
        color: "white",
        fontWeight: 600,
        boxShadow: `inset 0 0 0 1px ${C.activeRing}`,
      }
    : { color: C.idle };
  const onMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) {
      e.currentTarget.style.background = C.idleBg;
      e.currentTarget.style.color = "white";
    }
  };
  const onMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) {
      e.currentTarget.style.background = "transparent";
      e.currentTarget.style.color = C.idle;
    }
  };

  const content = (
    <>
      {active && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r"
          style={{ background: C.activeAccent }}
        />
      )}
      <span
        className="relative"
        style={{
          color: active ? C.activeIcon : C.groupIcon,
          display: "inline-flex",
        }}
      >
        <Icon size={16} />
        {/* 접힘 레일: 안읽음 배지를 아이콘 우상단 작은 점으로 축약 (숫자 표시 공간 없음) */}
        {collapsed && badge !== undefined && badge > 0 && (
          <span
            className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
            style={{ background: "oklch(0.62 0.22 25)" }}
          />
        )}
      </span>
      {/* 접힘(lg+)에선 라벨·count·badge·active chevron 모두 숨김 */}
      <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>
        {label}
      </span>
      {!collapsed && count !== undefined && (
        <span
          className="text-[11px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
          style={
            active
              ? { background: "oklch(1 0 0 / 0.15)", color: "white" }
              : {
                  background: "oklch(0.75 0.18 75 / 0.15)",
                  color: "oklch(0.85 0.12 75)",
                  border: "1px solid oklch(0.75 0.18 75 / 0.3)",
                }
          }
        >
          {count}
        </span>
      )}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span
          className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded-full text-[10px] font-bold flex-shrink-0"
          style={{ background: "oklch(0.62 0.22 25)", color: "white" }}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={title}
        className={className}
        style={style}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={title}
      className={className}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {content}
    </button>
  );
}

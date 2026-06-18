// Connector Hub — Mobile/Tablet Bottom Tab Bar (< lg)
// 화면이 좁아지면(사이드바가 드로어로 전환되는 lg 미만) 주요 메뉴를 하단 탭으로 노출.
// "더보기" 탭은 전체 메뉴 드로어(사이드바)를 연다.
import { useI18n } from "@/i18n";
import { useLocation } from "wouter";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  LayoutDashboard, Package, Search, FileText, ArrowRightLeft, LayoutGrid, MoreHorizontal,
  BookMarked, Shapes,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomTab {
  pathSuffix: string;
  label: string;
  Icon: React.ElementType;
}

export default function BottomTabBar() {
  const { t } = useI18n();
  const [location, navigate] = useLocation();
  const connector = useConnectorStore((s) => s.connector);
  const setDrawerOpen = useConnectorStore((s) => s.setDrawerOpen);
  const drawerOpen = useConnectorStore((s) => s.drawerOpen);

  const isProvider = connector?.roles?.includes("Provider") ?? false;

  // 커넥터 선택 시: 대시보드 / (Provider=자산 | Consumer=카탈로그) / 협상 / 전송 / 더보기
  const connectorTabs: BottomTab[] = [
    { pathSuffix: "dashboard", label: t.nav.dashboard, Icon: LayoutDashboard },
    isProvider
      ? { pathSuffix: "assets", label: t.nav.assets, Icon: Package }
      : { pathSuffix: "catalog", label: t.nav.catalog, Icon: Search },
    { pathSuffix: "negotiation", label: t.nav.negotiations, Icon: FileText },
    { pathSuffix: "transfer", label: t.nav.transfers, Icon: ArrowRightLeft },
    { pathSuffix: "more", label: t.nav.more, Icon: MoreHorizontal },
  ];
  // 플릿(커넥터 미선택): 글로벌 라우트만 노출 — 플릿 / 디지털트윈 / 시맨틱모델 / 더보기
  // (협상·전송은 커넥터 종속 라우트뿐이라 플릿 모드에선 의미 없어 제외)
  const fleetTabs: BottomTab[] = [
    { pathSuffix: "fleet", label: t.nav.fleet, Icon: LayoutGrid },
    { pathSuffix: "registry", label: t.nav.digitalTwins, Icon: BookMarked },
    { pathSuffix: "submodels", label: t.nav.submodels, Icon: Shapes },
    { pathSuffix: "more", label: t.nav.more, Icon: MoreHorizontal },
  ];

  const tabs = connector ? connectorTabs : fleetTabs;
  const connId = connector?.id ?? "";

  const getPath = (suffix: string) => {
    if (suffix === "more") return "";
    if (suffix === "fleet") return "/fleet";
    if (suffix === "registry") return "/registry";
    if (suffix === "submodels") return "/submodels";
    return connector ? `/connectors/${connId}/${suffix}` : "/fleet";
  };

  const isActive = (suffix: string) => {
    if (suffix === "more") return false;
    if (suffix === "fleet") return location === "/fleet" || location === "/";
    if (suffix === "registry") return location.startsWith("/registry");
    if (suffix === "submodels") return location.startsWith("/submodels");
    return location.includes(`/${suffix}`);
  };

  // 드로어(전체 메뉴 사이드바)가 열려 있으면 하단 탭바를 숨겨 사이드바 하단 링크와 겹치지 않게 한다.
  if (drawerOpen) return null;

  return (
    <nav
      aria-label={t.common.menu}
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border flex items-center justify-around h-14 px-1"
    >
      {tabs.map(({ pathSuffix, label, Icon }) => {
        const active = isActive(pathSuffix);
        return (
          <button
            key={pathSuffix}
            onClick={() => {
              if (pathSuffix === "more") setDrawerOpen(true);
              else navigate(getPath(pathSuffix));
            }}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground",
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

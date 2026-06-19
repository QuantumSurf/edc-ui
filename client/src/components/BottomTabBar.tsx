// Connector Hub — Mobile/Tablet Bottom Tab Bar (< lg)
// 화면이 좁아지면(사이드바가 드로어로 전환되는 lg 미만) 주요 메뉴만 하단 탭으로 노출.
// 주요 탭 4~5개 + "더보기". "더보기"는 보조/시스템 메뉴를 바텀시트(그리드)로 펼친다.
import { useI18n } from "@/i18n";
import { useLocation } from "wouter";
import { useState } from "react";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  LayoutDashboard, Package, Search, FileText, ArrowRightLeft, LayoutGrid, MoreHorizontal,
  BookMarked, Shapes, Vault as VaultIcon, Fingerprint, ScrollText,
  ShieldCheck, FileSignature, Key, Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface PrimaryTab {
  pathSuffix: string;
  label: string;
  Icon: React.ElementType;
}
interface OverflowItem {
  path: string;
  label: string;
  Icon: React.ElementType;
}

export default function BottomTabBar() {
  const { t } = useI18n();
  const [location, navigate] = useLocation();
  const connector = useConnectorStore((s) => s.connector);
  const drawerOpen = useConnectorStore((s) => s.drawerOpen);
  const [moreOpen, setMoreOpen] = useState(false);

  const isProvider = connector?.roles?.includes("Provider") ?? false;
  const connId = connector?.id ?? "";

  // 주요 탭 — 커넥터 선택 시 4개, 플릿 시 3개 (+ 더보기). flex-1 균등 분배라 몰리지 않음.
  const primaryTabs: PrimaryTab[] = connector
    ? [
        { pathSuffix: "dashboard", label: t.nav.dashboard, Icon: LayoutDashboard },
        isProvider
          ? { pathSuffix: "assets", label: t.nav.assets, Icon: Package }
          : { pathSuffix: "catalog", label: t.nav.catalog, Icon: Search },
        { pathSuffix: "negotiation", label: t.nav.negotiations, Icon: FileText },
        { pathSuffix: "transfer", label: t.nav.transfers, Icon: ArrowRightLeft },
      ]
    : [
        { pathSuffix: "fleet", label: t.nav.fleet, Icon: LayoutGrid },
        { pathSuffix: "registry", label: t.nav.digitalTwins, Icon: BookMarked },
        { pathSuffix: "submodels", label: t.nav.submodels, Icon: Shapes },
      ];

  // 시스템(글로벌) + 설정 — 어느 컨텍스트든 더보기에 포함
  const systemOverflow: OverflowItem[] = [
    { path: "/system/vault", label: t.nav.vault, Icon: VaultIcon },
    { path: "/system/identity-hub", label: t.nav.identityHub, Icon: Fingerprint },
    { path: "/system/audit", label: t.nav.audit, Icon: ScrollText },
    { path: "/settings", label: t.nav.settings, Icon: SettingsIcon },
  ];
  // 커넥터 선택 시 주요 탭에 없는 커넥터 페이지를 더보기에 추가
  const connectorOverflow: OverflowItem[] = connector
    ? [
        isProvider
          ? { path: `/connectors/${connId}/catalog`, label: t.nav.catalog, Icon: Search }
          : { path: `/connectors/${connId}/assets`, label: t.nav.assets, Icon: Package },
        { path: `/connectors/${connId}/policy`, label: t.nav.policies, Icon: ShieldCheck },
        { path: `/connectors/${connId}/contract`, label: t.nav.offerings, Icon: FileSignature },
        { path: `/connectors/${connId}/edr`, label: t.nav.edr, Icon: Key },
      ]
    : [];
  const overflowItems: OverflowItem[] = [...connectorOverflow, ...systemOverflow];

  const getPath = (suffix: string) => {
    if (suffix === "fleet") return "/fleet";
    if (suffix === "registry") return "/registry";
    if (suffix === "submodels") return "/submodels";
    return connector ? `/connectors/${connId}/${suffix}` : "/fleet";
  };

  const suffixActive = (suffix: string) => {
    if (suffix === "fleet") return location === "/fleet" || location === "/";
    if (suffix === "registry") return location.startsWith("/registry");
    if (suffix === "submodels") return location.startsWith("/submodels");
    return location.includes(`/${suffix}`);
  };
  const pathActive = (path: string) => location === path || location.startsWith(path + "/");
  const moreActive = overflowItems.some((i) => pathActive(i.path));

  const go = (path: string) => { setMoreOpen(false); navigate(path); };

  // 드로어(전체 메뉴 사이드바)가 열려 있으면 하단 탭바를 숨겨 겹침 방지.
  if (drawerOpen) return null;

  const tabCls = (active: boolean) =>
    cn(
      "flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 px-0.5 rounded-lg transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
      active ? "text-primary" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <>
      <nav
        aria-label={t.common.menu}
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border flex items-stretch h-14 px-1"
      >
        {primaryTabs.map(({ pathSuffix, label, Icon }) => {
          const active = suffixActive(pathSuffix);
          return (
            <button
              key={pathSuffix}
              onClick={() => navigate(getPath(pathSuffix))}
              aria-current={active ? "page" : undefined}
              className={tabCls(active)}
            >
              <Icon className={cn("w-5 h-5", active && "stroke-[2.5px]")} />
              <span className={cn("text-[11px] whitespace-nowrap", active ? "font-semibold" : "font-medium")}>{label}</span>
            </button>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={tabCls(moreActive)}
        >
          <MoreHorizontal className={cn("w-5 h-5", moreActive && "stroke-[2.5px]")} />
          <span className={cn("text-[11px] whitespace-nowrap", moreActive ? "font-semibold" : "font-medium")}>{t.nav.more}</span>
        </button>
      </nav>

      {/* 더보기 바텀시트 — 보조/시스템 메뉴 그리드 */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="lg:hidden rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="pb-0">
            <SheetTitle>{t.nav.more}</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-4 gap-2 px-4 pb-2">
            {overflowItems.map(({ path, label, Icon }) => {
              const active = pathActive(path);
              return (
                <button
                  key={path}
                  onClick={() => go(path)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                    active
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/60",
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[11px] font-medium text-center leading-tight">{label}</span>
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

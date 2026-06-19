// Connector Hub — 글로벌 검색 (Command Palette, Ctrl/Cmd+K)
// 커넥터(이름·BPN·상태) + 주요 페이지를 통합 검색. 선택 시 해당 위치로 이동.
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fetchConnectors } from "@/services";
import { useConnectorStore } from "@/stores/connectorStore";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { Connector } from "@/lib/data";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  Network, LayoutGrid, BookMarked, Shapes, Vault as VaultIcon, Fingerprint,
  ScrollText, Settings as SettingsIcon,
} from "lucide-react";

const DOT: Record<Connector["status"], string> = {
  up: "bg-emerald-500",
  warn: "bg-amber-500 status-pulse",
  down: "bg-rose-500",
};

export default function GlobalSearch() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const searchOpen = useConnectorStore((s) => s.searchOpen);
  const setSearchOpen = useConnectorStore((s) => s.setSearchOpen);
  const selectConnector = useConnectorStore((s) => s.selectConnector);
  const setNavigating = useConnectorStore((s) => s.setNavigating);

  const { data: connectors = [] } = useQuery({
    queryKey: ["connectors"],
    queryFn: fetchConnectors,
    enabled: searchOpen,
  });

  const go = (path: string) => { setSearchOpen(false); navigate(path); };
  const goConnector = (c: Connector) => {
    selectConnector(c);
    setNavigating(true);
    setSearchOpen(false);
    navigate(`/connectors/${c.id}/dashboard`);
  };

  const destinations = [
    { path: "/fleet", label: t.nav.fleetOverview, Icon: LayoutGrid },
    { path: "/registry", label: t.nav.digitalTwins, Icon: BookMarked },
    { path: "/submodels", label: t.nav.submodels, Icon: Shapes },
    { path: "/system/vault", label: t.nav.vault, Icon: VaultIcon },
    { path: "/system/identity-hub", label: t.nav.identityHub, Icon: Fingerprint },
    { path: "/system/audit", label: t.nav.audit, Icon: ScrollText },
    { path: "/settings", label: t.nav.settings, Icon: SettingsIcon },
  ];

  return (
    <CommandDialog
      open={searchOpen}
      onOpenChange={setSearchOpen}
      title={t.common.searchTitle}
      description={t.common.searchDescription}
    >
      <CommandInput placeholder={t.common.searchPlaceholder} />
      <CommandList>
        <CommandEmpty>{t.common.searchNoResults}</CommandEmpty>

        {connectors.length > 0 && (
          <CommandGroup heading={t.nav.fleet}>
            {connectors.map((c) => (
              <CommandItem
                key={c.id}
                value={`connector ${c.name} ${c.bpn}`}
                onSelect={() => goConnector(c)}
              >
                <span className={cn("w-2 h-2 rounded-full flex-shrink-0", DOT[c.status] ?? "bg-rose-500")} />
                <Network className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="font-medium flex-1 truncate">{c.name}</span>
                <span className="mono text-[11px] text-muted-foreground truncate max-w-[160px]">{c.bpn}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading={t.common.searchPages}>
          {destinations.map(({ path, label, Icon }) => (
            <CommandItem key={path} value={`page ${label} ${path}`} onSelect={() => go(path)}>
              <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="font-medium flex-1 truncate">{label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

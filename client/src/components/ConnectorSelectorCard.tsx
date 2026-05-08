// Connector Selector Card — sidebar top dropdown for switching connectors
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ChevronDown, LayoutGrid } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useConnectorStore } from "@/stores/connectorStore";
import { fetchConnectors } from "@/services";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { Connector } from "@/lib/data";

const STATUS_DOT_CLS: Record<Connector["status"], string> = {
  up: "bg-primary",
  warn: "bg-amber-400 status-pulse",
  down: "bg-rose-400",
};

interface ConnectorSelectorCardProps {
  collapsed?: boolean;
}

export default function ConnectorSelectorCard({ collapsed }: ConnectorSelectorCardProps) {
  const [, navigate] = useLocation();
  const connector = useConnectorStore((s) => s.connector);
  const selectConnector = useConnectorStore((s) => s.selectConnector);
  const setNavigating = useConnectorStore((s) => s.setNavigating);
  const setDrawerOpen = useConnectorStore((s) => s.setDrawerOpen);
  const { t } = useI18n();

  const { data: connectors = [] } = useQuery({
    queryKey: ["connectors"],
    queryFn: fetchConnectors,
  });

  if (!connector) return null;

  const switchTo = (c: Connector) => {
    if (c.id === connector.id) return;
    selectConnector(c);
    setNavigating(true);
    setDrawerOpen(false);
    navigate(`/connectors/${c.id}/dashboard`);
  };

  const goFleet = () => {
    selectConnector(null);
    setDrawerOpen(false);
    navigate("/fleet");
  };

  const dotCls = STATUS_DOT_CLS[connector.status] ?? "bg-rose-400";

  return (
    <div className={cn("px-2 pt-3", collapsed && "px-1")}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={collapsed ? `${connector.name} (${connector.bpn})` : undefined}
            className={cn(
              "w-full flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-left",
              collapsed ? "justify-center p-2" : "px-3 py-2"
            )}
          >
            <span className={cn("w-2 h-2 rounded-full flex-shrink-0", dotCls)} />
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-white truncate">
                    {connector.name}
                  </div>
                  <div className="mono text-[11px] text-white/55 truncate">
                    {connector.bpn}
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-white/55 flex-shrink-0" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t.nav.fleet}
          </DropdownMenuLabel>
          {connectors.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onSelect={() => switchTo(c)}
              className={cn(
                "flex items-center gap-2 py-1.5",
                c.id === connector.id && "bg-accent/60"
              )}
            >
              <span className={cn("w-2 h-2 rounded-full flex-shrink-0", STATUS_DOT_CLS[c.status])} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate">{c.name}</div>
                <div className="mono text-[11px] text-muted-foreground truncate">{c.bpn}</div>
              </div>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={goFleet} className="flex items-center gap-2 py-1.5">
            <LayoutGrid className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[13px]">{t.nav.fleetSwitch}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// KMX EDC — Notification Panel (Sheet slide-over from right)
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotificationStore } from "@/stores/notificationStore";
import { useNotifications } from "@/hooks/useNotifications";
import { type NotificationItem } from "@/services/api";
import { useI18n } from "@/i18n";
import { useLocation } from "wouter";
import {
  AlertTriangle, AlertCircle, CheckCircle2, Info, X, Bell, Trash2, CheckCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationType = "info" | "warn" | "error" | "success";

/* ─── Icon + color per notification type ─────────────────────── */
const TYPE_CONFIG: Record<NotificationType, { Icon: React.ElementType; color: string; bg: string }> = {
  warn:    { Icon: AlertTriangle, color: "text-amber-500",   bg: "bg-amber-50 dark:bg-amber-950/30" },
  error:   { Icon: AlertCircle,   color: "text-rose-500",    bg: "bg-rose-50 dark:bg-rose-950/30" },
  success: { Icon: CheckCircle2,  color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
  info:    { Icon: Info,          color: "text-sky-500",     bg: "bg-sky-50 dark:bg-sky-950/30" },
};

/* ─── Relative time ──────────────────────────────────────────── */
function useTimeAgo() {
  const { t } = useI18n();
  return (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return t.notifications.timeAgo.justNow;
    if (minutes < 60) return t.notifications.timeAgo.minutesAgo(minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t.notifications.timeAgo.hoursAgo(hours);
    const days = Math.floor(hours / 24);
    return t.notifications.timeAgo.daysAgo(days);
  };
}

/* ─── Panel ──────────────────────────────────────────────────── */
export default function NotificationPanel() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const panelOpen = useNotificationStore((s) => s.panelOpen);
  const setPanelOpen = useNotificationStore((s) => s.setPanelOpen);
  const { notifications: allNotifications, unreadCount, markRead, markAllRead, dismiss, clearAll } = useNotifications();
  const notifications = allNotifications.filter((n) => !n.read);
  const timeAgo = useTimeAgo();

  const handleClick = (n: NotificationItem) => {
    markRead(n.id);
    if (n.link) {
      navigate(n.link);
      setPanelOpen(false);
    }
  };

  return (
    <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
      <SheetContent side="right" className="w-[360px] sm:w-[400px] p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="px-4 py-3 border-b border-border flex-shrink-0">
          {/* Sheet의 우상단 X 닫기 아이콘과 겹치지 않도록 우측 padding(pr-8) 부여 */}
          <SheetTitle className="flex items-center gap-2 text-[15px] pr-8">
            <Bell className="w-4 h-4" />
            {t.notifications.title}
            {unreadCount > 0 && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-rose-500 text-white font-bold min-w-[18px] text-center">
                {unreadCount}
              </span>
            )}
          </SheetTitle>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium transition-colors mt-1.5 self-start"
            >
              <CheckCheck className="w-3 h-3" />
              {t.notifications.markAllRead}
            </button>
          )}
        </SheetHeader>

        {/* Notification List */}
        <ScrollArea className="flex-1">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Bell className="w-10 h-10 opacity-20 mb-3" />
              <span className="text-[12px]">{t.notifications.empty}</span>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((n) => {
                const { Icon, color, bg } = TYPE_CONFIG[n.type];
                return (
                  <div
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={cn(
                      "flex gap-3 px-4 py-3 transition-colors cursor-pointer hover:bg-muted/50",
                      !n.read && "border-l-2 border-l-blue-500 bg-blue-50/30 dark:bg-blue-950/10"
                    )}
                  >
                    {/* Icon */}
                    <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5", bg)}>
                      <Icon className={cn("w-3.5 h-3.5", color)} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <span className={cn("text-[12px] text-foreground truncate", !n.read && "font-semibold")}>
                          {n.title}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                          className="text-muted-foreground hover:text-foreground transition-opacity flex-shrink-0 opacity-40 hover:opacity-100"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] text-muted-foreground/60">{timeAgo(n.timestamp)}</span>
                        <span className="text-[11px] text-muted-foreground/40">
                          {t.notifications.sources[n.source as keyof typeof t.notifications.sources] ?? n.source}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        {notifications.length > 0 && (
          <SheetFooter className="px-4 py-2 border-t border-border flex-shrink-0">
            <button
              onClick={clearAll}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-rose-600 transition-colors mx-auto"
            >
              <Trash2 className="w-3 h-3" />
              {t.notifications.clearAll}
            </button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

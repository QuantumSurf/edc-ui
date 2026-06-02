// KMX EDC — Notification Panel (Sheet slide-over from right)
import { useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotificationStore } from "@/stores/notificationStore";
import { useNotifications } from "@/hooks/useNotifications";
import { type NotificationItem } from "@/services/api";
import { ListError } from "@/components/ui-kmx";
import { ConfirmActionDialog } from "@/components/DetailDeleteDialogs";
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
  const {
    notifications: allNotifications, unreadCount, isError, refetch, isFetching,
    markRead, markAllRead, dismiss, clearAll,
  } = useNotifications();
  const timeAgo = useTimeAgo();

  // 표시 필터 — 기본 "전체"(이력 유지). 읽어도 전체 탭에선 사라지지 않음.
  const [tab, setTab] = useState<"all" | "unread">("all");
  const shown = tab === "unread" ? allNotifications.filter((n) => !n.read) : allNotifications;

  // 전체 삭제 확인 다이얼로그
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClick = (n: NotificationItem) => {
    markRead(n.id);
    if (n.link) {
      navigate(n.link);
      setPanelOpen(false);
    }
  };

  const TABS: Array<{ key: "all" | "unread"; label: string }> = [
    { key: "all", label: t.notifications.tabAll },
    { key: "unread", label: t.notifications.tabUnread },
  ];

  return (
    <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
      <SheetContent side="right" className="w-[360px] sm:w-[400px] p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="px-4 py-3 border-b border-border flex-shrink-0">
          {/* Sheet의 우상단 X 닫기 아이콘과 겹치지 않도록 우측 padding(pr-8) 부여 */}
          <SheetTitle className="flex items-center gap-2 text-[15px] font-semibold text-foreground pr-8">
            <Bell className="w-4 h-4" />
            {t.notifications.title}
            {unreadCount > 0 && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-rose-500 text-white font-bold min-w-[18px] text-center">
                {unreadCount}
              </span>
            )}
          </SheetTitle>

          <div className="flex items-center justify-between gap-2 mt-2">
            {/* 전체 / 안읽음 필터 탭 */}
            <div className="flex gap-1" role="tablist" aria-label={t.notifications.title}>
              {TABS.map((tb) => (
                <button
                  key={tb.key}
                  role="tab"
                  aria-selected={tab === tb.key}
                  onClick={() => setTab(tb.key)}
                  className={cn(
                    "text-[11px] px-2.5 py-1 rounded-md border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                    tab === tb.key
                      ? "border-primary/40 bg-primary/10 text-primary font-medium"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {tb.label}
                  {tb.key === "unread" && unreadCount > 0 && ` (${unreadCount})`}
                </button>
              ))}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium transition-colors flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
              >
                <CheckCheck className="w-3 h-3" />
                {t.notifications.markAllRead}
              </button>
            )}
          </div>
        </SheetHeader>

        {/* Notification List */}
        <ScrollArea className="flex-1">
          {isError && allNotifications.length === 0 ? (
            <ListError onRetry={() => refetch()} fetching={isFetching} />
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Bell className="w-10 h-10 opacity-20 mb-3" />
              <span className="text-[12px]">{tab === "unread" ? t.notifications.emptyUnread : t.notifications.empty}</span>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {shown.map((n) => {
                const { Icon, color, bg } = TYPE_CONFIG[n.type];
                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleClick(n)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(n); }
                    }}
                    aria-label={`${n.title}${!n.read ? ` — ${t.notifications.unreadLabel}` : ""}`}
                    className={cn(
                      "flex gap-3 px-4 py-3 transition-colors cursor-pointer hover:bg-muted/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary",
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
                          {!n.read && <span className="sr-only">{t.notifications.unreadLabel}: </span>}
                          {n.title}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                          aria-label={t.notifications.dismiss}
                          className="text-muted-foreground hover:text-foreground transition-opacity flex-shrink-0 opacity-40 hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] text-muted-foreground/60" title={new Date(n.timestamp).toLocaleString()}>{timeAgo(n.timestamp)}</span>
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
        {allNotifications.length > 0 && (
          <SheetFooter className="px-4 py-2 border-t border-border flex-shrink-0">
            <button
              onClick={() => setConfirmClear(true)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-rose-600 transition-colors mx-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            >
              <Trash2 className="w-3 h-3" />
              {t.notifications.clearAll}
            </button>
          </SheetFooter>
        )}
      </SheetContent>

      {/* 전체 삭제 확인 */}
      <ConfirmActionDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        tone="danger"
        title={t.notifications.clearAllConfirmTitle}
        description={t.notifications.clearAllConfirmDesc}
        confirmLabel={t.notifications.clearAll}
        onConfirm={() => { clearAll(); setConfirmClear(false); }}
      />
    </Sheet>
  );
}

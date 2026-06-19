// KMX EDC — Notification Panel
// 디자인: aas-service-hub AlertPanel 과 동일 — 다크 슬라이드오버 + 심각도 필터칩 + 카드형.
// 동작은 edc 유지: 카드 클릭=읽음+링크이동, 개별 삭제(X), 모두 읽음, 전체 삭제, 조회 실패 시 재시도.
import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotificationStore } from "@/stores/notificationStore";
import { useNotifications } from "@/hooks/useNotifications";
import { type NotificationItem } from "@/services/api";
import { ListError } from "@/components/ui-kmx";
import { ConfirmActionDialog } from "@/components/DetailDeleteDialogs";
import { useI18n } from "@/i18n";
import { useLocation } from "wouter";
import {
  BellRing, BellOff, XCircle, AlertTriangle, Info, CheckCircle2, X, CheckCheck, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationType = "info" | "warn" | "error" | "success";

/* ─── 심각도(타입)별 아이콘 + 색 — 흰 카드 위 좌측 색 아이콘으로만 구별 ─── */
const SEVERITY: Record<NotificationType, { Icon: React.ElementType; color: string }> = {
  error:   { Icon: XCircle,       color: "text-rose-500 dark:text-rose-400" },
  warn:    { Icon: AlertTriangle, color: "text-amber-500 dark:text-amber-400" },
  info:    { Icon: Info,          color: "text-sky-500 dark:text-sky-400" },
  success: { Icon: CheckCircle2,  color: "text-emerald-500 dark:text-emerald-400" },
};

/* ─── 상대 시간 ──────────────────────────────────────────────── */
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
  const { t, locale } = useI18n();
  const [, navigate] = useLocation();
  const panelOpen = useNotificationStore((s) => s.panelOpen);
  const setPanelOpen = useNotificationStore((s) => s.setPanelOpen);
  const {
    notifications: allNotifications, unreadCount, isError, refetch, isFetching,
    markRead, markAllRead, dismiss, clearAll,
  } = useNotifications();
  const timeAgo = useTimeAgo();

  const [filter, setFilter] = useState<"all" | NotificationType>("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const counts = {
    info: allNotifications.filter((n) => n.type === "info").length,
    error: allNotifications.filter((n) => n.type === "error").length,
    warn: allNotifications.filter((n) => n.type === "warn").length,
    success: allNotifications.filter((n) => n.type === "success").length,
  };
  const filtered = filter === "all" ? allNotifications : allNotifications.filter((n) => n.type === filter);

  const close = () => setPanelOpen(false);
  const handleClick = (n: NotificationItem) => {
    markRead(n.id);
    if (n.link) { navigate(n.link); close(); }
  };

  const typeLabel = (f: "all" | NotificationType): string => {
    const ko: Record<string, string> = { all: "전체", error: "오류", warn: "경고", info: "정보", success: "완료" };
    const en: Record<string, string> = { all: "All", error: "Error", warn: "Warning", info: "Info", success: "Success" };
    return (locale === "ko" ? ko : en)[f] ?? f;
  };

  if (!panelOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={close} aria-hidden="true" />

      {/* Panel — aas-service 와 동일하게 테마 추종(라이트=밝은 표면 / 다크=딥네이비). */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-96 max-w-full flex flex-col bg-background text-foreground border-l border-border shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <BellRing className="w-4 h-4 text-primary" />
            <span className="font-medium text-xs">{t.notifications.title}</span>
            {unreadCount > 0 && (
              <span className="h-5 px-1.5 inline-flex items-center rounded-full text-[11px] bg-primary text-primary-foreground font-medium">
                {unreadCount}
              </span>
            )}
          </div>
          <button
            onClick={close}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col flex-1 min-h-0 px-4 pt-3">
          {/* Filter chips */}
          <div className="flex items-center gap-1.5 mb-3 flex-shrink-0">
            {(["all", "info", "warn", "error", "success"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {typeLabel(f)} ({f === "all" ? allNotifications.length : counts[f]})
              </button>
            ))}
          </div>

          {/* Action row — 모두 읽음 / 전체 삭제 */}
          {allNotifications.length > 0 && (
            <div className="flex items-center gap-2 mb-2 flex-shrink-0">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  {t.notifications.markAllRead}
                </button>
              )}
              <button
                onClick={() => setConfirmClear(true)}
                className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t.notifications.clearAll}
              </button>
            </div>
          )}

          {/* List */}
          <ScrollArea className="flex-1">
            {isError && allNotifications.length === 0 ? (
              <ListError onRetry={() => refetch()} fetching={isFetching} />
            ) : allNotifications.length === 0 && isFetching ? (
              <div className="space-y-3 pb-4 pr-2" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="p-3 rounded-lg border border-border bg-card animate-pulse">
                    <div className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-muted mt-0.5" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-2/3 bg-muted rounded" />
                        <div className="h-2.5 w-full bg-muted rounded" />
                        <div className="h-2.5 w-1/3 bg-muted rounded" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <BellOff className="w-10 h-10 text-muted-foreground/50 mb-3" />
                <p className="text-xs text-muted-foreground font-medium">{t.notifications.empty}</p>
                {filter !== "all" && (
                  <button
                    onClick={() => setFilter("all")}
                    className="mt-2 text-[11px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                  >
                    {typeLabel("all")}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3 pb-4 pr-2">
                {filtered.map((n) => {
                  const { Icon, color } = SEVERITY[n.type as NotificationType] ?? SEVERITY.info;
                  return (
                    <div
                      key={n.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleClick(n)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(n); } }}
                      aria-label={`${n.title}${!n.read ? ` — ${t.notifications.unreadLabel}` : ""}`}
                      className="group w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                    >
                      <div className="flex items-start gap-2.5">
                        <Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", color)} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className={cn("text-xs break-words text-foreground min-w-0", !n.read && "font-semibold")}>
                              {n.title}
                            </p>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                              <button
                                onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                                aria-label={t.notifications.dismiss}
                                className="text-muted-foreground/50 hover:text-foreground opacity-60 group-hover:opacity-100 transition-opacity focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border border-current/40", color)}>
                              {typeLabel(n.type as NotificationType)}
                            </span>
                            <span className="text-xs font-medium text-foreground/80">
                              {t.notifications.sources[n.source as keyof typeof t.notifications.sources] ?? n.source}
                            </span>
                            <span className="text-xs font-medium text-foreground/75 ml-auto whitespace-nowrap flex-shrink-0">
                              {timeAgo(n.timestamp)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

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
    </>
  );
}

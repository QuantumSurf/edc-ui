// KMX EDC — Notification Panel
// 디자인: aas-service-hub AlertPanel 과 동일 — 다크 슬라이드오버 + 심각도 필터칩 + 카드형.
// 동작: 읽음/미읽음 모두 표시(읽음=흐림, 네이버 알림창 스타일), 카드 클릭=확인(읽음, DB 기록 보존),
// 우상단 X=목록에서 제거(프론트 전용 — dismissed localStorage, 백엔드 기록은 삭제하지 않음).
import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotificationStore } from "@/stores/notificationStore";
import { useNotifications } from "@/hooks/useNotifications";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { NOTIFY_PREFS_KEY, readPref } from "@/lib/prefs";
import { type NotificationItem } from "@/services/api";
import { ListError } from "@/components/ui-kmx";
import { useI18n } from "@/i18n";
import { fmtDateTime } from "@/lib/datetime";
import { useLocation } from "wouter";
import {
  Bell,
  BellOff,
  XCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  X,
  CheckCheck,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationType = "info" | "warn" | "error" | "success";

/* ─── 설정 알림 토글(source → storageKey) ───────────────────────
 * 설정 페이지의 토글이 실제로 알림 표시를 제어하도록, 알림의 source 를
 * 해당 토글 키에 매핑해 꺼진 source 는 패널에서 숨긴다.
 * transfer 성공/실패는 단일 transferFailed 토글에 함께 귀속(별도 성공 토글 없음). */
const SOURCE_PREF: Record<NotificationItem["source"], string> = {
  vc: "notify.vcExpiry",
  negotiation: "notify.negTerminated",
  transfer: "notify.transferFailed",
  edr: "notify.edrExpiry",
  system: "notify.connectorHealth",
};

/* ─── 심각도(타입)별 아이콘 + 색 — 흰 카드 위 좌측 색 아이콘으로만 구별 ─── */
const SEVERITY: Record<
  NotificationType,
  { Icon: React.ElementType; color: string }
> = {
  error: { Icon: XCircle, color: "text-rose-500 dark:text-rose-400" },
  warn: { Icon: AlertTriangle, color: "text-amber-500 dark:text-amber-400" },
  info: { Icon: Info, color: "text-sky-500 dark:text-sky-400" },
  success: {
    Icon: CheckCircle2,
    color: "text-emerald-500 dark:text-emerald-400",
  },
};

/* ─── 시각 표기 ──────────────────────────────────────────────── */
// 알림 시각도 다른 시각 표기와 동일하게 "YYYY-MM-DD HH:mm:ss"(KST)로 표시(감사로그만 ISO).
function useTimeAgo() {
  return fmtDateTime;
}

/* ─── Panel ──────────────────────────────────────────────────── */
export default function NotificationPanel() {
  const { t, locale } = useI18n();
  const [, navigate] = useLocation();
  const panelOpen = useNotificationStore(s => s.panelOpen);
  const setPanelOpen = useNotificationStore(s => s.setPanelOpen);
  const dismissed = useNotificationStore(s => s.dismissed);
  const dismiss = useNotificationStore(s => s.dismiss);
  const pruneDismissed = useNotificationStore(s => s.pruneDismissed);
  const {
    notifications: rawNotifications,
    isError,
    refetch,
    isFetching,
    markAllRead,
    markRead,
  } = useNotifications();
  const timeAgo = useTimeAgo();

  // 슬라이드오버 패널을 dialog 로: 초기 포커스/트랩/스크롤락/복원 제공(WCAG 2.4.3/4.1.2).
  const panelRef = useDialogA11y<HTMLDivElement>(panelOpen);

  const [filter, setFilter] = useState<"all" | NotificationType>("all");

  // 타 탭에서 설정 토글이 바뀌면 storage 이벤트로 강제 리렌더해 게이트를 재평가.
  // (패널 자체가 닫혔다 열리면 마운트/리렌더로 자연히 최신 prefs 를 읽는다.)
  const [, bumpPrefs] = useState(0);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === NOTIFY_PREFS_KEY) bumpPrefs(v => v + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ESC 로 패널 닫기 — 백드롭/X 외 키보드 종료 경로(WCAG 2.4.3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setPanelOpen]);

  // 사라진 알림 id 는 dismissed 목록에서 정리해 무한 증가를 막는다.
  // 단 콜드 로드/로딩 중엔 rawNotifications=[] 이므로 그때 prune 하면 dismissed(localStorage)를
  // 통째로 비워 지속성이 깨진다 — 데이터가 실제로 로드됐을 때(비어있지 않을 때)만 정리한다.
  useEffect(() => {
    if (rawNotifications.length === 0) return;
    pruneDismissed(rawNotifications.map(n => n.id));
  }, [rawNotifications, pruneDismissed]);

  // 읽음/미읽음을 모두 표시한다(읽음은 흐리게). 설정에서 꺼진 source 와 X로 제거한(dismissed)
  // 알림만 숨긴다. 클릭=확인(markRead)은 DB 기록을 남기고 흐려질 뿐 목록에서 사라지지 않는다.
  const dismissedSet = new Set(dismissed);
  const allNotifications = rawNotifications.filter(
    n => readPref(SOURCE_PREF[n.source] ?? "", true) && !dismissedSet.has(n.id)
  );
  const unreadCount = allNotifications.filter(n => !n.read).length;

  const counts = {
    info: allNotifications.filter(n => n.type === "info").length,
    error: allNotifications.filter(n => n.type === "error").length,
    warn: allNotifications.filter(n => n.type === "warn").length,
    success: allNotifications.filter(n => n.type === "success").length,
  };
  const filtered =
    filter === "all"
      ? allNotifications
      : allNotifications.filter(n => n.type === filter);

  const close = () => setPanelOpen(false);
  const handleClick = (n: NotificationItem) => {
    // 클릭 = 확인(읽음) 처리 — DB에는 기록을 남기고(삭제 X) 패널의 미확인 목록에서만 사라진다.
    // 패널은 계속 열어 둬 연속으로 확인할 수 있게 한다(이동/닫기 없음).
    markRead(n.id);
  };

  const typeLabel = (f: "all" | NotificationType): string =>
    t.notifications.filterLabels[f] ?? f;

  if (!panelOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={close}
        aria-hidden="true"
      />

      {/* Panel — aas-service 와 동일하게 테마 추종(라이트=밝은 표면 / 다크=딥네이비). */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-panel-title"
        tabIndex={-1}
        className="fixed right-0 top-0 bottom-0 z-50 w-96 max-w-full flex flex-col bg-background text-foreground border-l border-border shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            <span
              id="notification-panel-title"
              className="font-semibold text-[15px]"
            >
              {t.notifications.title}
            </span>
            {unreadCount > 0 && (
              // 미읽음 배지: rose-500 + 99+ 캡 = 형제 프로젝트 과반수(5/8) 관례.
              <span className="h-5 px-1.5 inline-flex items-center rounded-full text-[11px] bg-rose-500 text-white font-medium">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </div>
          <button
            onClick={close}
            className="-mr-1 p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col flex-1 min-h-0 px-4 pt-3">
          {/* Filter chips */}
          <div className="flex items-center gap-1.5 mb-3 flex-shrink-0">
            {(["all", "info", "warn", "error", "success"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {typeLabel(f)} (
                {f === "all" ? allNotifications.length : counts[f]})
              </button>
            ))}
          </div>

          {/* Action row — '모두 읽음'(확인) + 우측 '알림 설정' 링크(형제 과반수 5/8 관례,
              Catena 구현 이식). 하드 삭제는 두지 않는다(클릭=확인=기록 보존 원칙,
              읽은 기록은 백엔드 pruneNotifications 가 정리). */}
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
              onClick={() => {
                close();
                navigate("/settings");
              }}
              className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
              {t.notifications.openSettings}
            </button>
          </div>

          {/* List — 로딩/완료/빈 전환을 보조기술에 통지(WCAG 4.1.3) */}
          <ScrollArea
            className="flex-1"
            aria-live="polite"
            aria-busy={isFetching}
          >
            {isError && allNotifications.length === 0 ? (
              <ListError onRetry={() => refetch()} fetching={isFetching} />
            ) : allNotifications.length === 0 && isFetching ? (
              <div className="space-y-3 pb-4 pr-2" aria-hidden="true">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="p-3 rounded-lg border border-border bg-card animate-pulse"
                  >
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
                <p className="text-xs text-muted-foreground font-medium">
                  {t.notifications.empty}
                </p>
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
                {filtered.map(n => {
                  const { Icon, color } =
                    SEVERITY[n.type as NotificationType] ?? SEVERITY.info;
                  // i18n: msgKey+params 가 있으면 사용자 언어로 번역, 없으면 저장된 title/message 폴백.
                  const tplMap = t.notifications.messages as Record<
                    string,
                    | {
                        title: (p: Record<string, unknown>) => string;
                        message: (p: Record<string, unknown>) => string;
                      }
                    | undefined
                  >;
                  const tpl = n.msgKey ? tplMap[n.msgKey] : undefined;
                  const title = tpl ? tpl.title(n.params ?? {}) : n.title;
                  const message = tpl ? tpl.message(n.params ?? {}) : n.message;
                  return (
                    <div
                      key={n.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleClick(n)}
                      onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleClick(n);
                        }
                      }}
                      aria-label={`${title}${!n.read ? ` — ${t.notifications.unreadLabel}` : ""}`}
                      title={t.notifications.clickToDismiss}
                      className={cn(
                        // 네이버 알림창처럼 간격 있는 개별 카드(shadow) — 클릭=확인(읽음)→흐려짐,
                        // 우상단 X=목록에서 제거(프론트만, 백엔드 기록 보존). pr-8=X 자리 확보.
                        "relative w-full text-left p-3 pr-8 rounded-lg border border-border bg-card shadow-sm transition-all duration-150 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                        !n.read
                          ? "border-l-2 border-l-primary bg-primary/5 hover:bg-accent/30"
                          : "opacity-60 hover:opacity-100 hover:bg-accent/20"
                      )}
                    >
                      {/* 우상단 X — 프론트에서만 목록 제거(백엔드 기록은 삭제하지 않음) */}
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          dismiss(n.id);
                        }}
                        aria-label={t.notifications.removeFromList}
                        title={t.notifications.removeFromList}
                        className="absolute top-1.5 right-1.5 p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <div className="flex items-start gap-2.5">
                        <Icon
                          className={cn("w-4 h-4 mt-0.5 flex-shrink-0", color)}
                        />
                        <div className="flex-1 min-w-0">
                          <p
                            className={cn(
                              "text-[12px] truncate text-foreground",
                              !n.read && "font-semibold"
                            )}
                          >
                            {title}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                            {message}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span
                              className={cn(
                                "text-[11px] font-medium px-2 py-0.5 rounded-full border border-current/40",
                                color
                              )}
                            >
                              {typeLabel(n.type as NotificationType)}
                            </span>
                            <span className="text-[11px] font-medium text-foreground/80">
                              {t.notifications.sources[
                                n.source as keyof typeof t.notifications.sources
                              ] ?? n.source}
                            </span>
                            <span className="text-[11px] font-medium text-foreground/75 ml-auto whitespace-nowrap flex-shrink-0">
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
    </>
  );
}

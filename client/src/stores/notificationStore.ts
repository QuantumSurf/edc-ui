// KMX EDC — Notification Store (Zustand)
// UI state only (panelOpen). Data is managed via React Query + useNotifications hook.
import { create } from "zustand";

// Re-export type alias for backwards compatibility
export type { NotificationItem as Notification } from "@/services/api";
export type NotificationType = "info" | "warn" | "error" | "success";
export type NotificationSource =
  | "system"
  | "negotiation"
  | "transfer"
  | "edr"
  | "vc";

// 프론트 전용 dismiss 집합 — X 로 목록에서 제거해도 백엔드 기록은 삭제하지 않고,
// 이 id 목록만 localStorage 에 남겨 재로드 후에도 목록에서 계속 가려지게 한다.
const DISMISSED_KEY = "kmx-notify-dismissed";
function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
function saveDismissed(ids: string[]): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch {
    // localStorage 비가용(사생활 모드 등) — dismiss 는 세션 내에서만 유지
  }
}

interface NotificationUIStore {
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  // 프론트에서만 목록에서 제거된 알림 id(백엔드 기록은 보존). localStorage 로 지속.
  dismissed: string[];
  dismiss: (id: string) => void;
  // 현재 존재하는 알림 id 로 정리 — 사라진 id 를 걷어내 무한 증가를 막는다.
  pruneDismissed: (existingIds: string[]) => void;
}

export const useNotificationStore = create<NotificationUIStore>(set => ({
  panelOpen: false,
  setPanelOpen: open => set({ panelOpen: open }),
  togglePanel: () => set(s => ({ panelOpen: !s.panelOpen })),
  dismissed: loadDismissed(),
  dismiss: id =>
    set(s => {
      if (s.dismissed.includes(id)) return s;
      const next = [...s.dismissed, id];
      saveDismissed(next);
      return { dismissed: next };
    }),
  pruneDismissed: existingIds =>
    set(s => {
      const keep = new Set(existingIds);
      const next = s.dismissed.filter(id => keep.has(id));
      if (next.length === s.dismissed.length) return s;
      saveDismissed(next);
      return { dismissed: next };
    }),
}));

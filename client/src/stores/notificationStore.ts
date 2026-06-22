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

interface NotificationUIStore {
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
}

export const useNotificationStore = create<NotificationUIStore>(set => ({
  panelOpen: false,
  setPanelOpen: open => set({ panelOpen: open }),
  togglePanel: () => set(s => ({ panelOpen: !s.panelOpen })),
}));

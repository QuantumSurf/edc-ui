// KMX EDC — Notifications React Query hook
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotifications,
  createNotification,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  clearAllNotifications,
  type NotificationItem,
} from "@/services/api";
import { readPref } from "@/pages/PageSettings";

const QUERY_KEY = ["notifications"] as const;

// 설정 알림 토글(source → storageKey). NotificationPanel 과 동일 매핑을 사용해
// 사이드바 미읽음 배지도 꺼진 source 를 제외하여 패널과 수가 일치하게 한다.
const SOURCE_PREF: Record<NotificationItem["source"], string> = {
  vc: "notify.vcExpiry",
  negotiation: "notify.negTerminated",
  transfer: "notify.transferFailed",
  edr: "notify.edrExpiry",
  system: "notify.connectorHealth",
};

function isEnabled(n: NotificationItem): boolean {
  return readPref(SOURCE_PREF[n.source] ?? "", true);
}

export function useNotifications() {
  const queryClient = useQueryClient();

  const {
    data: notifications = [],
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchNotifications,
    refetchInterval: 30_000, // 30초마다 폴링
  });

  const unreadCount = notifications.filter(n => !n.read && isEnabled(n)).length;

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const prev = queryClient.getQueryData<NotificationItem[]>(QUERY_KEY);
      queryClient.setQueryData<NotificationItem[]>(QUERY_KEY, (old = []) =>
        old.map(n => (n.id === id ? { ...n, read: true } : n))
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(QUERY_KEY, ctx.prev);
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const prev = queryClient.getQueryData<NotificationItem[]>(QUERY_KEY);
      queryClient.setQueryData<NotificationItem[]>(QUERY_KEY, (old = []) =>
        old.map(n => ({ ...n, read: true }))
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(QUERY_KEY, ctx.prev);
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => dismissNotification(id),
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const prev = queryClient.getQueryData<NotificationItem[]>(QUERY_KEY);
      queryClient.setQueryData<NotificationItem[]>(QUERY_KEY, (old = []) =>
        old.filter(n => n.id !== id)
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(QUERY_KEY, ctx.prev);
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: clearAllNotifications,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const prev = queryClient.getQueryData<NotificationItem[]>(QUERY_KEY);
      queryClient.setQueryData<NotificationItem[]>(QUERY_KEY, []);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(QUERY_KEY, ctx.prev);
    },
  });

  const addMutation = useMutation({
    mutationFn: (n: Omit<NotificationItem, "id" | "read" | "timestamp">) =>
      createNotification(n),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return {
    notifications,
    unreadCount,
    isError,
    refetch,
    isFetching,
    markRead: (id: string) => markReadMutation.mutate(id),
    markAllRead: () => markAllReadMutation.mutate(),
    dismiss: (id: string) => dismissMutation.mutate(id),
    clearAll: () => clearAllMutation.mutate(),
    addNotification: (n: Omit<NotificationItem, "id" | "read" | "timestamp">) =>
      addMutation.mutate(n),
  };
}

/** Lightweight hook for unread count only (used in sidebar + topbar) */
export function useUnreadNotificationCount(): number {
  const { data = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  return data.filter(n => !n.read && isEnabled(n)).length;
}

// KMX EDC — Zustand Store for connector & UI state
import { create } from "zustand";
import type { Connector } from "@/lib/data";

// 데스크톱 아이콘 레일 접힘 상태 (drawerOpen=모바일 드로어와 별개 축).
const COLLAPSE_KEY = "kmx-sidebar-collapsed";
const initialCollapsed = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(COLLAPSE_KEY) === "true";
};

interface ConnectorStore {
  /** Currently selected connector (null = Fleet view) */
  connector: Connector | null;
  /** Sidebar drawer open state (tablet/mobile) */
  drawerOpen: boolean;
  /** Desktop (lg+) icon-rail collapse state — drawerOpen 과 별개 축 */
  sidebarCollapsed: boolean;
  /** Navigation loading indicator (true while transitioning to a connector page) */
  navigating: boolean;
  /** Global search (Ctrl/Cmd+K) command palette open state */
  searchOpen: boolean;

  selectConnector: (c: Connector | null) => void;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  toggleSidebarCollapsed: () => void;
  setNavigating: (v: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  toggleSearch: () => void;
  /** 로그아웃/테넌트 전환 시 선택 커넥터·전이/검색 상태를 초기화(모듈 싱글톤이라 수동 리셋 필요) */
  reset: () => void;
}

export const useConnectorStore = create<ConnectorStore>(set => ({
  connector: null,
  // 데스크톱(lg+)은 사이드바 기본 열림, 모바일은 닫힘 (pcf 셸 패턴)
  drawerOpen: typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  sidebarCollapsed: initialCollapsed(),
  navigating: false,
  searchOpen: false,

  selectConnector: c => set({ connector: c }),
  setDrawerOpen: open => set({ drawerOpen: open }),
  toggleDrawer: () => set(s => ({ drawerOpen: !s.drawerOpen })),
  toggleSidebarCollapsed: () =>
    set(s => {
      const next = !s.sidebarCollapsed;
      if (typeof window !== "undefined")
        window.localStorage.setItem(COLLAPSE_KEY, String(next));
      return { sidebarCollapsed: next };
    }),
  setNavigating: v => set({ navigating: v }),
  setSearchOpen: open => set({ searchOpen: open }),
  toggleSearch: () => set(s => ({ searchOpen: !s.searchOpen })),
  // drawerOpen·sidebarCollapsed 은 뷰포트/사용자 선호 UI 상태라 보존; 테넌트 데이터에 묶인 상태만 비운다.
  reset: () => set({ connector: null, navigating: false, searchOpen: false }),
}));

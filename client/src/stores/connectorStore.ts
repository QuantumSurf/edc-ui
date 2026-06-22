// KMX EDC — Zustand Store for connector & UI state
import { create } from "zustand";
import type { Connector } from "@/lib/data";

interface ConnectorStore {
  /** Currently selected connector (null = Fleet view) */
  connector: Connector | null;
  /** Sidebar drawer open state (tablet/mobile) */
  drawerOpen: boolean;
  /** Navigation loading indicator (true while transitioning to a connector page) */
  navigating: boolean;
  /** Global search (Ctrl/Cmd+K) command palette open state */
  searchOpen: boolean;

  selectConnector: (c: Connector | null) => void;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  setNavigating: (v: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  toggleSearch: () => void;
}

export const useConnectorStore = create<ConnectorStore>(set => ({
  connector: null,
  // 데스크톱(lg+)은 사이드바 기본 열림, 모바일은 닫힘 (pcf 셸 패턴)
  drawerOpen: typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  navigating: false,
  searchOpen: false,

  selectConnector: c => set({ connector: c }),
  setDrawerOpen: open => set({ drawerOpen: open }),
  toggleDrawer: () => set(s => ({ drawerOpen: !s.drawerOpen })),
  setNavigating: v => set({ navigating: v }),
  setSearchOpen: open => set({ searchOpen: open }),
  toggleSearch: () => set(s => ({ searchOpen: !s.searchOpen })),
}));

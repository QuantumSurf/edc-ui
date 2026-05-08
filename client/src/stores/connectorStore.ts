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

  selectConnector: (c: Connector | null) => void;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  setNavigating: (v: boolean) => void;
}

export const useConnectorStore = create<ConnectorStore>((set) => ({
  connector: null,
  drawerOpen: false,
  navigating: false,

  selectConnector: (c) => set({ connector: c }),
  setDrawerOpen: (open) => set({ drawerOpen: open }),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  setNavigating: (v) => set({ navigating: v }),
}));

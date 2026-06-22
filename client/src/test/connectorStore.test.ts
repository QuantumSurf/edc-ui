// Test: Zustand connector store
import { describe, it, expect, beforeEach } from "vitest";
import { useConnectorStore } from "../stores/connectorStore";
import type { Connector } from "../lib/data";

const SAMPLE_CONNECTOR: Connector = {
  id: "test-01",
  name: "TEST-01",
  bpn: "BPNL000000000TST",
  status: "up",
  env: "DEV",
  roles: ["Provider"],
  dcp: "1.0",
  aas: false,
  assets: 0,
  offers: 0,
  negs: 0,
  transfers: 0,
};

describe("Connector Store (Zustand)", () => {
  beforeEach(() => {
    // Reset store between tests
    useConnectorStore.setState({ connector: null, drawerOpen: false });
  });

  it("initial state has no connector and drawer closed", () => {
    const state = useConnectorStore.getState();
    expect(state.connector).toBeNull();
    expect(state.drawerOpen).toBe(false);
  });

  it("selectConnector updates connector", () => {
    const store = useConnectorStore.getState();
    store.selectConnector(SAMPLE_CONNECTOR);
    expect(useConnectorStore.getState().connector).toEqual(SAMPLE_CONNECTOR);
  });

  it("selectConnector(null) clears connector", () => {
    const store = useConnectorStore.getState();
    store.selectConnector(SAMPLE_CONNECTOR);
    store.selectConnector(null);
    expect(useConnectorStore.getState().connector).toBeNull();
  });

  it("setDrawerOpen controls drawer state", () => {
    const store = useConnectorStore.getState();
    store.setDrawerOpen(true);
    expect(useConnectorStore.getState().drawerOpen).toBe(true);
    store.setDrawerOpen(false);
    expect(useConnectorStore.getState().drawerOpen).toBe(false);
  });

  it("toggleDrawer flips drawer state", () => {
    const store = useConnectorStore.getState();
    expect(useConnectorStore.getState().drawerOpen).toBe(false);
    store.toggleDrawer();
    expect(useConnectorStore.getState().drawerOpen).toBe(true);
    store.toggleDrawer();
    expect(useConnectorStore.getState().drawerOpen).toBe(false);
  });
});

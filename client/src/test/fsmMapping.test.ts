// Test: FSM state code → UI mapping
import { describe, it, expect } from "vitest";
import { NEG_STATE_MAP, TRANSFER_STATE_MAP } from "../lib/data";

describe("FSM State Code Mapping", () => {
  describe("Negotiation FSM (spec 4.5.2)", () => {
    it("maps all required state codes", () => {
      expect(NEG_STATE_MAP[100]).toBeDefined();
      expect(NEG_STATE_MAP[200]).toBeDefined();
      expect(NEG_STATE_MAP[800]).toBeDefined();
      expect(NEG_STATE_MAP[1200]).toBeDefined();
      expect(NEG_STATE_MAP[1300]).toBeDefined();
    });

    it("INITIAL (100) → gray", () => {
      expect(NEG_STATE_MAP[100].name).toBe("INITIAL");
      expect(NEG_STATE_MAP[100].variant).toBe("gray");
    });

    it("REQUESTING (200) → blue", () => {
      expect(NEG_STATE_MAP[200].name).toBe("REQUESTING");
      expect(NEG_STATE_MAP[200].variant).toBe("blue");
    });

    it("AGREED (800) → teal", () => {
      expect(NEG_STATE_MAP[800].name).toBe("AGREED");
      expect(NEG_STATE_MAP[800].variant).toBe("teal");
    });

    it("FINALIZED (1200) → green", () => {
      expect(NEG_STATE_MAP[1200].name).toBe("FINALIZED");
      expect(NEG_STATE_MAP[1200].variant).toBe("green");
    });

    it("TERMINATED (1300) → red", () => {
      expect(NEG_STATE_MAP[1300].name).toBe("TERMINATED");
      expect(NEG_STATE_MAP[1300].variant).toBe("red");
    });

    it("has Korean labels for all states", () => {
      Object.values(NEG_STATE_MAP).forEach((entry) => {
        expect(entry.label).toBeTruthy();
        expect(entry.label.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Transfer FSM (spec 4.6)", () => {
    it("maps all required state codes", () => {
      expect(TRANSFER_STATE_MAP[400]).toBeDefined();
      expect(TRANSFER_STATE_MAP[1200]).toBeDefined();
      expect(TRANSFER_STATE_MAP[1300]).toBeDefined();
    });

    it("STARTED (400) → blue", () => {
      expect(TRANSFER_STATE_MAP[400].name).toBe("STARTED");
      expect(TRANSFER_STATE_MAP[400].variant).toBe("blue");
    });

    it("COMPLETED (1200) → green", () => {
      expect(TRANSFER_STATE_MAP[1200].name).toBe("COMPLETED");
      expect(TRANSFER_STATE_MAP[1200].variant).toBe("green");
    });

    it("TERMINATED (1300) → red", () => {
      expect(TRANSFER_STATE_MAP[1300].name).toBe("TERMINATED");
      expect(TRANSFER_STATE_MAP[1300].variant).toBe("red");
    });
  });
});

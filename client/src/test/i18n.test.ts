// Test: i18n translation system
import { describe, it, expect } from "vitest";
import { getTranslations, type Locale } from "../i18n";
import ko from "../i18n/ko";
import en from "../i18n/en";

describe("i18n Translation System", () => {
  it("getTranslations returns Korean for 'ko'", () => {
    const t = getTranslations("ko");
    expect(t.nav.dashboard).toBe("대시보드");
    expect(t.fleet.totalConnectors).toBe("총 커넥터");
  });

  it("getTranslations returns English for 'en'", () => {
    const t = getTranslations("en");
    expect(t.nav.dashboard).toBe("Dashboard");
    expect(t.fleet.totalConnectors).toBe("Total Connectors");
  });

  it("all top-level keys match between ko and en", () => {
    const koKeys = Object.keys(ko).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(koKeys);
  });

  it("all nav keys match between ko and en", () => {
    const koKeys = Object.keys(ko.nav).sort();
    const enKeys = Object.keys(en.nav).sort();
    expect(enKeys).toEqual(koKeys);
  });

  it("function translations work (dynamic values)", () => {
    const tKo = getTranslations("ko");
    const tEn = getTranslations("en");

    expect(tKo.fleet.assetsRegistered(10)).toContain("10");
    expect(tEn.fleet.assetsRegistered(10)).toContain("10");

    expect(tKo.dcp.expiresIn(23)).toContain("23");
    expect(tEn.dcp.expiresIn(23)).toContain("23");
  });

  it("all section keys in en match ko structure", () => {
    const sections = [
      "common",
      "nav",
      "fleet",
      "dashboard",
      "assets",
      "policies",
      "offerings",
      "catalog",
      "negotiations",
      "transfers",
      "edr",
      "dcp",
      "infra",
      "addConnector",
    ] as const;

    sections.forEach(section => {
      const koSection = ko[section];
      const enSection = en[section];
      const koKeys = Object.keys(koSection as Record<string, unknown>).sort();
      const enKeys = Object.keys(enSection as Record<string, unknown>).sort();
      expect(enKeys, `Section "${section}" keys mismatch`).toEqual(koKeys);
    });
  });
});

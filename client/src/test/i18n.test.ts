// Test: i18n translation system
import { describe, it, expect } from "vitest";
import { getTranslations } from "../i18n";
import ko from "../i18n/ko";
import en from "../i18n/en";

/** 모든 깊이의 키 경로를 평탄화(함수는 leaf 로 취급). Record 캐스트 블록도 함께 비교된다. */
function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" && typeof v !== "function"
      ? keyPaths(v as Record<string, unknown>, path)
      : [path];
  });
}

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

  it("function translations work (dynamic values)", () => {
    const tKo = getTranslations("ko");
    const tEn = getTranslations("en");

    expect(tKo.fleet.assetsRegistered(10)).toContain("10");
    expect(tEn.fleet.assetsRegistered(10)).toContain("10");
  });

  it("ko/en 전체 키 구조가 모든 깊이에서 일치한다", () => {
    // 얕은/부분 섹션 검사 대신 재귀 비교로 누락을 원천 차단(templateDesc 등 Record 캐스트 블록 포함).
    const koPaths = keyPaths(ko as Record<string, unknown>).sort();
    const enPaths = keyPaths(en as Record<string, unknown>).sort();
    expect(enPaths).toEqual(koPaths);
  });
});

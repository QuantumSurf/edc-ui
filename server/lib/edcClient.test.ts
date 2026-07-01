import { describe, it, expect } from "vitest";
import { withJsonLd, EDC_QUERY_LIMIT } from "./edcClient.js";

// B2 회귀 방지 — QuerySpec 목록 요청에 명시적 limit 이 없으면 EDC 가 기본 50 으로 잘라
// 목록/카운트/KPI/알림 폴러에서 데이터가 조용히 유실된다.
describe("withJsonLd (EDC QuerySpec limit)", () => {
  it("QuerySpec 목록 요청에 명시적 limit 을 주입한다", () => {
    const q = withJsonLd({});
    expect(q["@type"]).toBe("QuerySpec");
    expect(q["limit"]).toBe(EDC_QUERY_LIMIT);
  });

  it("호출자가 지정한 limit 은 존중한다(예: 존재확인용 limit:1)", () => {
    expect(withJsonLd({ limit: 1 })["limit"]).toBe(1);
  });

  it("QuerySpec 이 아닌 body(예: ContractDefinition)에는 limit 을 넣지 않는다", () => {
    const q = withJsonLd({ "@type": "ContractDefinition", "@id": "x" });
    expect(q["limit"]).toBeUndefined();
  });
});

// 카탈로그 정책 열 표시용 오퍼 ID 디코더 — 커넥터 버전별 세그먼트 인코딩 차이 검증.
import { describe, expect, it } from "vitest";
import { decodePolicyId, extractOfferConstraints } from "../routes/catalog.js";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("decodePolicyId", () => {
  it("kmx-edc 0.17: 세 세그먼트 모두 base64url(3번째=base64 UUID)를 정의ID로 디코딩", () => {
    // 실측(사용자 카탈로그 화면)에서 관측된 형태
    const id =
      "bXQtb2ZmZXItMDE=:bXQtYXNzZXQtMDE=:MzQ4NjYxYTItNzk5Yi00NTUzLWExNTEtMGU5ZGVmZDFlYWI5";
    expect(decodePolicyId(id)).toBe("mt-offer-01");
  });

  it("EDC 코어: 3번째 세그먼트가 raw UUID 인 형태도 디코딩", () => {
    const id = `${b64("mt-offer-01")}:${b64("mt-asset-01")}:348661a2-799b-4553-a151-0e9defd1eab9`;
    expect(decodePolicyId(id)).toBe("mt-offer-01");
  });

  it("오퍼 ID 형태가 아니면(세그먼트≠3, 3번째가 UUID 아님) 원본 유지", () => {
    expect(decodePolicyId("plain-policy-id")).toBe("plain-policy-id");
    expect(decodePolicyId("a:b")).toBe("a:b");
    expect(decodePolicyId("a:b:c:d")).toBe("a:b:c:d");
    // 3번째가 UUID 도 base64(UUID)도 아님 → 오퍼 ID 아님
    expect(decodePolicyId(`${b64("x")}:${b64("y")}:notauuid`)).toBe(
      `${b64("x")}:${b64("y")}:notauuid`
    );
  });

  it("빈 값은 그대로", () => {
    expect(decodePolicyId("")).toBe("");
  });
});

describe("extractOfferConstraints", () => {
  it("카탈로그 DCAT 축약형(and 래퍼·전체 IRI)에서 제약을 사람이 읽는 요약으로", () => {
    // 실측(mt-offer-01 카탈로그 offerPolicy)
    const policy = {
      "@type": "Offer",
      permission: [
        {
          action: "use",
          constraint: [
            {
              and: [
                {
                  leftOperand:
                    "https://w3id.org/catenax/2025/9/policy/FrameworkAgreement",
                  operator: "eq",
                  rightOperand: "DataExchangeGovernance:1.0",
                },
                {
                  leftOperand:
                    "https://w3id.org/catenax/2025/9/policy/UsagePurpose",
                  operator: "isAnyOf",
                  rightOperand: "cx.core.digitalTwinRegistry:1",
                },
              ],
            },
          ],
        },
      ],
    };
    expect(extractOfferConstraints(policy)).toEqual([
      {
        left: "FrameworkAgreement",
        op: "=",
        right: "DataExchangeGovernance:1.0",
      },
      { left: "UsagePurpose", op: "∈", right: "cx.core.digitalTwinRegistry:1" },
    ]);
  });

  it("odrl: 접두형·operator @id 객체·배열 rightOperand 도 처리", () => {
    const policy = {
      "odrl:permission": {
        "odrl:action": { "@id": "odrl:use" },
        "odrl:constraint": {
          "odrl:leftOperand": { "@id": "kmx:BusinessPartnerNumber" },
          "odrl:operator": { "@id": "odrl:isAnyOf" },
          "odrl:rightOperand": ["BPNL000000000CON", "BPNL0000000002ND"],
        },
      },
    };
    expect(extractOfferConstraints(policy)).toEqual([
      {
        left: "BusinessPartnerNumber",
        op: "∈",
        right: "BPNL000000000CON, BPNL0000000002ND",
      },
    ]);
  });

  it("제약 없는 정책(공개 데이터)은 빈 배열", () => {
    expect(
      extractOfferConstraints({ permission: [{ action: "use" }] })
    ).toEqual([]);
    expect(extractOfferConstraints(null)).toEqual([]);
  });
});

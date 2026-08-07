// friendlyPolicyError — 실 커넥터(kmx-edc)에서 관측된 오류 원문 그대로를 fixture 로 검증.
import { describe, expect, it } from "vitest";
import { friendlyPolicyError, operandDisplay } from "@/lib/policyErrors";
import ko from "@/i18n/ko";

const m = ko.policies.err;

describe("operandDisplay", () => {
  it("전체 IRI·접두형을 로컬명으로 축약", () => {
    expect(
      operandDisplay(
        "https://w3id.org/catenax/2025/9/policy/FrameworkAgreement"
      )
    ).toBe("FrameworkAgreement");
    expect(operandDisplay("cx-policy:Membership")).toBe("Membership");
    expect(operandDisplay("kmx:transferCount")).toBe("transferCount");
    expect(operandDisplay("Warranty")).toBe("Warranty");
  });
});

describe("friendlyPolicyError (실측 fixture)", () => {
  it("CAC-019 필수 제약 누락 — 반복 원문을 한 문장으로 집계", () => {
    const raw =
      "Usage Policy 의 permission 에 필수 제약이 없습니다: https://w3id.org/catenax/2025/9/policy/FrameworkAgreement; Usage Policy 의 permission 에 필수 제약이 없습니다: https://w3id.org/catenax/2025/9/policy/UsagePurpose";
    expect(friendlyPolicyError(raw, m)).toBe(
      m.usageRequired("FrameworkAgreement, UsagePurpose")
    );
  });

  it("enum 허용값 위반 — 허용 목록 유지, 로컬명 표기", () => {
    const raw =
      "'Warranty' 제약의 rightOperand 'cx.warranty.everything:1': 허용값이 아닙니다. 허용: [cx.warranty.none:1, cx.warranty.contractReference:1, cx.warranty.dataQualityIssues:1]";
    const out = friendlyPolicyError(raw, m);
    expect(out).toContain("'Warranty'");
    expect(out).toContain("cx.warranty.everything:1");
    expect(out).toContain("허용되는 값");
    expect(out).not.toContain("rightOperand");
  });

  it("operator 위반 3중 반복 — 중복 제거해 한 줄로", () => {
    const one =
      "'UsagePurpose' 제약의 operator 'eq' 는 허용되지 않습니다. 허용: [isAnyOf]";
    const raw = [one, one, one].join("; ");
    expect(friendlyPolicyError(raw, m)).toBe(
      m.operatorNotAllowed("UsagePurpose", "eq", "isAnyOf")
    );
  });

  it("미지원 제약(unbound) — 규칙 덤프 제거·scopes/functions 중복 통합", () => {
    const raw =
      "leftOperand 'cx-policy:Membership' is not bound to any scopes: Rule { Permission constraints: [And constraint: [Constraint 'cx-policy:Membership' EQ 'active']] } ; leftOperand 'cx-policy:Membership' is not bound to any functions: Rule { Permission constraints: [] }";
    expect(friendlyPolicyError(raw, m)).toBe(m.unknownConstraint("Membership"));
  });

  it("상호배타 제약 — 전체 IRI 를 로컬명으로", () => {
    const raw =
      "'https://w3id.org/catenax/2025/9/policy/DataUsageEndDurationDays' 와 'https://w3id.org/catenax/2025/9/policy/DataUsageEndDate' 는 함께 사용할 수 없습니다";
    expect(friendlyPolicyError(raw, m)).toBe(
      m.mutuallyExclusive("DataUsageEndDurationDays", "DataUsageEndDate")
    );
  });

  it("허용목록 밖 제약(usage 에 BPN) — BPN 접근정책 힌트 포함", () => {
    const raw =
      "이 규칙에서 허용되지 않는 제약입니다: https://w3id.org/catenax/2025/9/policy/BusinessPartnerNumber";
    const out = friendlyPolicyError(raw, m);
    expect(out).toContain("'BusinessPartnerNumber'");
    expect(out).toContain(m.bpnAccessOnlyHint);
  });

  it("kmx BPNL 형식 오류 — 전체 IRI 인용 제약명도 축약", () => {
    const raw =
      "'https://w3id.org/kmx/v0.1/ns/BusinessPartnerNumber' 제약의 rightOperand 'BPNL000000000CON,BPNL000000000002': BPNL + 12자리(영대문자/숫자) 형식이어야 합니다";
    const out = friendlyPolicyError(raw, m);
    expect(out).toContain("'BusinessPartnerNumber'");
    expect(out).toContain("BPNL + 12자리");
    expect(out).not.toContain("w3id.org");
  });

  it("정책 ID 중복 (EDC 코어 영어 메시지)", () => {
    const raw =
      "Object of type PolicyDefinition with ID=policy-access-bpn already exists";
    expect(friendlyPolicyError(raw, m)).toBe(m.duplicateId);
  });

  it("매칭 안 되는 원문 — IRI 축약만 하고 보존(정보 유실 방지)", () => {
    const raw =
      "알 수 없는 오류: https://w3id.org/catenax/2025/9/policy/Liability 처리 실패";
    const out = friendlyPolicyError(raw, m);
    expect(out).toContain("Liability");
    expect(out).not.toContain("w3id.org");
  });
});

import { describe, expect, it } from "vitest";
import { describeConstraint } from "@/lib/constraintLabels";

describe("describeConstraint (사용자 친화 문구)", () => {
  it("Framework/UsagePurpose 를 한국어 라벨+값으로", () => {
    expect(
      describeConstraint(
        {
          left: "FrameworkAgreement",
          op: "=",
          right: "DataExchangeGovernance:1.0",
        },
        "ko"
      )
    ).toBe("프레임워크 협약: 데이터 교환 거버넌스 v1.0");
    expect(
      describeConstraint(
        {
          left: "UsagePurpose",
          op: "∈",
          right: "cx.core.digitalTwinRegistry:1",
        },
        "ko"
      )
    ).toBe("사용 목적: 디지털 트윈 레지스트리");
  });

  it("Membership active → 멤버십: 활성", () => {
    expect(
      describeConstraint({ left: "Membership", op: "=", right: "active" }, "ko")
    ).toBe("멤버십: 활성");
  });

  it("BPN 번호(식별자)는 라벨만 번역, 값은 원문 유지", () => {
    expect(
      describeConstraint(
        {
          left: "BusinessPartnerNumber",
          op: "∈",
          right: "BPNL000000000CON, BPNL0000000002ND",
        },
        "ko"
      )
    ).toBe("허용 기업(BPN): BPNL000000000CON, BPNL0000000002ND");
  });

  it("숫자 비교(전송 횟수)는 기호 유지", () => {
    expect(
      describeConstraint({ left: "transferCount", op: "<", right: "5" }, "ko")
    ).toBe("전송 횟수 < 5");
  });

  it("영어 로케일", () => {
    expect(
      describeConstraint({ left: "Membership", op: "=", right: "active" }, "en")
    ).toBe("Membership: active");
  });

  it("미등록 제약/값은 원문 유지(정보 유실 방지)", () => {
    expect(
      describeConstraint({ left: "SomeUnknown", op: "=", right: "x:1" }, "ko")
    ).toBe("SomeUnknown: x:1");
  });
});

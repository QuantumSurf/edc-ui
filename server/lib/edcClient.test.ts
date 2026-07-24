import { describe, it, expect } from "vitest";
import {
  withJsonLd,
  EDC_QUERY_LIMIT,
  buildPolicyDefinition,
  toEdcAssetBody,
  mapAsset,
  mapPolicy,
  mapNegotiation,
  mapTransfer,
  mapEDR,
  mapOffering,
  fmtDateTimeShort,
} from "./edcClient.js";

// JSON-LD 탐색용 좁힘 헬퍼(any 미사용 — no-explicit-any 경고 회피).
const asObj = (v: unknown): Record<string, unknown> =>
  v as Record<string, unknown>;
const asArr = (v: unknown): unknown[] => v as unknown[];

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

  it("QuerySpec 에 기본 정렬(createdAt DESC)을 주입한다", () => {
    const q = withJsonLd({});
    expect(q["sortField"]).toBe("createdAt");
    expect(q["sortOrder"]).toBe("DESC");
  });

  it("호출자가 sortField 를 주면 존중한다(기본 sortOrder 미주입)", () => {
    const q = withJsonLd({ sortField: "state" });
    expect(q["sortField"]).toBe("state");
    expect(q["sortOrder"]).toBeUndefined();
  });

  it("이미 @context 가 있으면 그대로 통과(빌드 생략)", () => {
    const body = { "@context": { foo: "bar" }, "@type": "X" };
    expect(withJsonLd(body)).toBe(body);
  });
});

// ── 정책 빌더(평면 → ODRL JSON-LD) ────────────────────────────────
describe("buildPolicyDefinition", () => {
  it("기본값 permission + odrl:use, 단일 제약을 ODRL 노드로", () => {
    const d = buildPolicyDefinition({
      policyId: "p1",
      constraints: [
        {
          leftOperand: "Membership",
          operator: "odrl:eq",
          rightOperand: "active",
        },
      ],
    });
    expect(d["@id"]).toBe("p1");
    expect(d["@type"]).toBe("PolicyDefinition");
    const policy = asObj(d["policy"]);
    expect(policy["@type"]).toBe("odrl:Set");
    const perm = asObj(asArr(policy["odrl:permission"])[0]);
    expect(perm["odrl:action"]).toEqual({ "@id": "odrl:use" });
    const c = asObj(asArr(perm["odrl:constraint"])[0]);
    expect(c["odrl:leftOperand"]).toBe("Membership");
    expect(c["odrl:operator"]).toEqual({ "@id": "odrl:eq" });
    expect(c["odrl:rightOperand"]).toBe("active");
  });

  it("action 접두 없으면 odrl: 보정, 있으면 유지", () => {
    const a = asObj(
      buildPolicyDefinition({ policyId: "p", action: "transfer" })["policy"]
    );
    expect(asObj(asArr(a["odrl:permission"])[0])["odrl:action"]).toEqual({
      "@id": "odrl:transfer",
    });
    const b = asObj(
      buildPolicyDefinition({ policyId: "p", action: "cx:custom" })["policy"]
    );
    expect(asObj(asArr(b["odrl:permission"])[0])["odrl:action"]).toEqual({
      "@id": "cx:custom",
    });
  });

  it("prohibition ruleType 은 odrl:prohibition 키로(permission 부재)", () => {
    const p = asObj(
      buildPolicyDefinition({
        policyId: "p",
        ruleType: "prohibition",
        action: "use",
      })["policy"]
    );
    expect(asArr(p["odrl:prohibition"])).toHaveLength(1);
    expect(p["odrl:permission"]).toBeUndefined();
  });

  it("복수값 operator(isAnyOf)는 rightOperand 를 쉼표분리 배열로", () => {
    const p = asObj(
      buildPolicyDefinition({
        policyId: "p",
        constraints: [
          {
            leftOperand: "BusinessPartnerNumber",
            operator: "odrl:isAnyOf",
            rightOperand: "BPNL1, BPNL2 ,BPNL3",
          },
        ],
      })["policy"]
    );
    const right = asObj(
      asArr(asObj(asArr(p["odrl:permission"])[0])["odrl:constraint"])[0]
    )["odrl:rightOperand"];
    expect(right).toEqual(["BPNL1", "BPNL2", "BPNL3"]);
  });

  it("다중 제약 + logicOp 는 논리 래퍼(odrl:and)로 감싼다", () => {
    const p = asObj(
      buildPolicyDefinition({
        policyId: "p",
        logicOp: "and",
        constraints: [
          { leftOperand: "a", operator: "odrl:eq", rightOperand: "1" },
          { leftOperand: "b", operator: "odrl:eq", rightOperand: "2" },
        ],
      })["policy"]
    );
    const cons = asArr(
      asObj(asArr(p["odrl:permission"])[0])["odrl:constraint"]
    );
    expect(cons).toHaveLength(1);
    expect(asArr(asObj(cons[0])["odrl:and"])).toHaveLength(2);
  });

  it("@context 에 edc/odrl/cx-policy 프리픽스를 포함", () => {
    const ctx = asObj(buildPolicyDefinition({ policyId: "p" })["@context"]);
    expect(ctx["@vocab"]).toBe("https://w3id.org/edc/v0.0.1/ns/");
    expect(ctx["odrl"]).toBe("http://www.w3.org/ns/odrl/2/");
    expect(ctx["cx-policy"]).toBe("https://w3id.org/catenax/policy/");
  });
});

// ── 자산 빌더/매퍼 라운드트립 ─────────────────────────────────────
describe("toEdcAssetBody / mapAsset", () => {
  it("기본 dataAddress·properties 구성(HttpData 기본값)", () => {
    const b = toEdcAssetBody({
      id: "a1",
      name: "자산",
      baseUrl: "https://ex.com/data",
    });
    expect(b["@id"]).toBe("a1");
    expect(asObj(b["properties"])["name"]).toBe("자산");
    const da = asObj(b["dataAddress"]);
    expect(da["type"]).toBe("HttpData");
    expect(da["baseUrl"]).toBe("https://ex.com/data");
    expect(da["proxyPath"]).toBe("false");
    expect(da["contentType"]).toBe("application/json");
  });

  it("name 미지정 시 id 로 폴백, forceId 가 @id 강제", () => {
    expect(asObj(toEdcAssetBody({ id: "x" })["properties"])["name"]).toBe("x");
    expect(toEdcAssetBody({ id: "body" }, "url")["@id"]).toBe("url");
  });

  it("authCode 는 vault placeholder {{...}} 로 감싼다", () => {
    const da = asObj(
      toEdcAssetBody({ id: "a", authCode: "my-alias" })["dataAddress"]
    );
    expect(da["authCode"]).toBe("{{my-alias}}");
  });

  it("customProperties 병합하되 시스템 예약 키(name)는 덮지 못함", () => {
    const p = asObj(
      toEdcAssetBody({
        id: "a",
        customProperties: { region: "KR", name: "덮어쓰기시도" },
      })["properties"]
    );
    expect(p["region"]).toBe("KR");
    expect(p["name"]).toBe("a");
  });

  it("라운드트립: kmx:aas*·dct:type·semanticId·커스텀 속성 보존", () => {
    const body = toEdcAssetBody({
      id: "a1",
      name: "n",
      ver: "1.0",
      type: "cx-taxo:X",
      sem: "urn:samm:x",
      aasId: "urn:aas:1",
      submodelId: "urn:sm:1",
      customProperties: { region: "KR" },
    });
    const m = mapAsset(body);
    expect(m.id).toBe("a1");
    expect(m.name).toBe("n");
    expect(m.ver).toBe("1.0");
    expect(m.type).toBe("cx-taxo:X");
    expect(m.sem).toBe("urn:samm:x");
    expect(m.aasId).toBe("urn:aas:1");
    expect(m.submodelId).toBe("urn:sm:1");
    expect(m.customProperties.region).toBe("KR");
  });

  it("dct:type 이 문자열로 와도 처리", () => {
    const m = mapAsset({
      "@id": "a",
      properties: { "dct:type": "PlainType" },
    });
    expect(m.type).toBe("PlainType");
  });
});

// ── 정책 빌더 ↔ 매퍼 라운드트립 ──────────────────────────────────
describe("mapPolicy (라운드트립)", () => {
  it("ruleType·action·제약 보존 + 레거시 문자열 결합", () => {
    const built = buildPolicyDefinition({
      policyId: "p1",
      ruleType: "permission",
      action: "use",
      constraints: [
        {
          leftOperand: "Membership",
          operator: "odrl:eq",
          rightOperand: "active",
        },
      ],
    });
    const m = mapPolicy(built);
    expect(m.id).toBe("p1");
    expect(m.ruleType).toBe("permission");
    expect(m.action).toBe("use");
    expect(m.rules[0].constraints[0]).toEqual({
      left: "Membership",
      op: "eq",
      right: "active",
    });
    expect(m.constraint).toBe("Membership eq active");
  });

  it("or 논리 결합을 감지·평탄화", () => {
    const built = buildPolicyDefinition({
      policyId: "p",
      logicOp: "or",
      constraints: [
        { leftOperand: "a", operator: "odrl:eq", rightOperand: "1" },
        { leftOperand: "b", operator: "odrl:eq", rightOperand: "2" },
      ],
    });
    const m = mapPolicy(built);
    expect(m.logic).toBe("or");
    expect(m.rules[0].constraints).toHaveLength(2);
  });

  it("복수값(isAnyOf) 배열 rightOperand 를 쉼표결합으로 복원", () => {
    const built = buildPolicyDefinition({
      policyId: "p",
      constraints: [
        { leftOperand: "bpn", operator: "odrl:isAnyOf", rightOperand: "A,B" },
      ],
    });
    const m = mapPolicy(built);
    expect(m.rules[0].constraints[0].right).toBe("A,B");
  });
});

// ── 협상 상태 매핑 ────────────────────────────────────────────────
describe("mapNegotiation", () => {
  it("상태 문자열→코드, counterPartyId→peer, createdAt epoch 보존", () => {
    const m = mapNegotiation({
      "@id": "n1",
      state: "FINALIZED",
      counterPartyId: "BPNL-CON",
      createdAt: 1719400000000,
    });
    expect(m.id).toBe("n1");
    expect(m.state).toBe(1200);
    expect(m.name).toBe("FINALIZED");
    expect(m.peer).toBe("BPNL-CON");
    expect(m.createdAt).toBe(1719400000000);
  });

  it("미지 상태는 code 0", () => {
    expect(mapNegotiation({ state: "WEIRD" }).state).toBe(0);
  });

  it("meta 로 소요시간(초) 계산", () => {
    const m = mapNegotiation(
      { state: "AGREED" },
      { started_at: new Date(0), completed_at: new Date(2500) }
    );
    expect(m.t).toBe("2.5s");
  });
});

// ── 전송 상태 매핑 ────────────────────────────────────────────────
describe("mapTransfer", () => {
  it("transferType 에서 PULL/PUSH 모드 추출", () => {
    expect(mapTransfer({ transferType: "HttpData-PULL" }).transferType).toBe(
      "PULL"
    );
    expect(mapTransfer({ transferType: "HttpData-PUSH" }).transferType).toBe(
      "PUSH"
    );
  });

  it("소비자 완료로 종료된 TERMINATED 는 COMPLETED 로 표기(오류 숨김)", () => {
    const m = mapTransfer({
      state: "TERMINATED",
      errorDetail: "Completed by consumer",
    });
    expect(m.state).toBe(1200);
    expect(m.name).toBe("COMPLETED");
    expect(m.errorDetail).toBe("");
  });

  it("실제 오류로 TERMINATED 면 실패(1300)로 남고 errorDetail 유지", () => {
    const m = mapTransfer({
      state: "TERMINATED",
      errorDetail: "provider rejected",
    });
    expect(m.state).toBe(1300);
    expect(m.errorDetail).toBe("provider rejected");
  });

  it("errorDetail 이 JSON-LD 배열이면 문자열화", () => {
    const m = mapTransfer({
      state: "TERMINATED",
      errorDetail: [{ "@value": "boom" }],
    });
    expect(m.errorDetail).toContain("boom");
  });
});

// ── EDR 매핑 ─────────────────────────────────────────────────────
describe("mapEDR", () => {
  it("transferProcessId 를 12자로 자른 tpId, asset/provider 매핑", () => {
    const m = mapEDR({
      transferProcessId: "abcdefghijklmnop",
      assetId: "a1",
      providerId: "prov",
    });
    expect(m.tpId).toBe("abcdefghijkl");
    expect(m.asset).toBe("a1");
    expect(m.prov).toBe("prov");
  });

  it("expiresAt 이 있으면(예: Catena-X 커넥터) 남은 분을 계산", () => {
    const m = mapEDR({
      transferProcessId: "x",
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60_000,
    });
    // 30분 뒤 만료 → left 는 대략 30(실행 시각 오차 수 분 허용).
    expect(m.left).toBeGreaterThan(25);
    expect(m.left).toBeLessThanOrEqual(30);
  });

  it("expiresAt 없으면 left=-1(만료정보 없음, 활성 간주)", () => {
    expect(mapEDR({ transferProcessId: "x", assetId: "a" }).left).toBe(-1);
  });
});

// ── 계약 정의(오퍼링) 매핑 ────────────────────────────────────────
describe("mapOffering", () => {
  it("assetsSelector.operandRight 에서 자산·정책 id 추출", () => {
    const m = mapOffering({
      "@id": "o1",
      assetsSelector: { operandRight: "asset-1" },
      accessPolicyId: "ap",
      contractPolicyId: "cp",
    });
    expect(m.id).toBe("o1");
    expect(m.asset).toBe("asset-1");
    expect(m.access).toBe("ap");
    expect(m.contract).toBe("cp");
  });

  it("다중 자산(operandRight 배열)은 쉼표결합", () => {
    const m = mapOffering({ assetsSelector: { operandRight: ["a", "b"] } });
    expect(m.asset).toBe("a,b");
  });
});

// ── 표시용 날짜 포맷(KST 고정) ────────────────────────────────────
describe("fmtDateTimeShort", () => {
  it("UTC epoch 0 을 Asia/Seoul(KST, +9)로 포맷", () => {
    // 1970-01-01 00:00:00 UTC = 09:00:00 KST. timeZone 명시라 시스템 TZ 무관 결정적.
    expect(fmtDateTimeShort(new Date(0))).toBe("1970-01-01 09:00:00");
  });
});

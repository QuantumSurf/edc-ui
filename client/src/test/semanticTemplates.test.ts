import { describe, it, expect } from "vitest";
import {
  recognizeSemanticId,
  SEMANTIC_TEMPLATES,
} from "@/lib/semanticTemplates";
import {
  isLikelyIri,
  isLikelyIrdi,
  isValidIdShort,
  isLikelyGlobalReference,
} from "@/lib/descriptorValidation";

describe("recognizeSemanticId", () => {
  it("카탈로그 정확 매칭 → exact=true + caution=false + ref", () => {
    const r = recognizeSemanticId(
      "https://admin-shell.io/idta/nameplate/3/0/Nameplate"
    );
    expect(r?.name).toBe("Digital Nameplate");
    expect(r?.source).toBe("IDTA");
    expect(r?.exact).toBe(true);
    expect(r?.caution).toBe(false);
    expect(r?.ref).toBe("IDTA 02006-3-0");
  });

  it("Catena-X 구버전은 인식되지만 정본과 달라 caution=true", () => {
    // 카탈로그엔 9.0.0 만 있으므로 7.0.0 은 계열 인식 + 버전 확인 경고
    const r = recognizeSemanticId("urn:samm:io.catenax.pcf:7.0.0#Pcf");
    expect(r?.source).toBe("Catena-X");
    expect(r?.name).toBe("Pcf");
    expect(r?.exact).toBe(false);
    expect(r?.caution).toBe(true);
    expect(r?.ref).toBe("io.catenax.pcf");
  });

  it("admin-shell.io 미수록 템플릿도 경로에서 이름 유도(caution=true)", () => {
    const r = recognizeSemanticId(
      "https://admin-shell.io/idta/AssetInterfacesDescription/1/0/Submodel"
    );
    expect(r?.source).toBe("IDTA");
    expect(r?.name).toBe("AssetInterfacesDescription");
    expect(r?.caution).toBe(true);
  });

  it("IRDI 는 출처(ECLASS/IEC CDD)만 식별하고 경고 아님", () => {
    const ec = recognizeSemanticId("0173-1#02-AAC879#008");
    expect(ec?.source).toBe("IRDI");
    expect(ec?.name).toBe("ECLASS (IRDI)");
    expect(ec?.caution).toBe(false);
    const cdd = recognizeSemanticId("0112-1#02-ABC123#001");
    expect(cdd?.name).toBe("IEC CDD (IRDI)");
  });

  it("표준 아닌 값·빈값은 null", () => {
    expect(recognizeSemanticId("urn:uuid:123")).toBeNull();
    expect(recognizeSemanticId("just some text")).toBeNull();
    expect(recognizeSemanticId("")).toBeNull();
    expect(recognizeSemanticId(null)).toBeNull();
  });

  it("카탈로그 semanticId 는 전부 IRI/IRDI 형식", () => {
    for (const t of SEMANTIC_TEMPLATES) {
      expect(isLikelyGlobalReference(t.semanticId)).toBe(true);
    }
  });
});

describe("descriptorValidation", () => {
  it("isLikelyIri: 스킴 보유 식별자만", () => {
    expect(isLikelyIri("urn:samm:io.catenax.pcf:9.0.0#Pcf")).toBe(true);
    expect(isLikelyIri("https://admin-shell.io/idta/TimeSeries/1/1")).toBe(
      true
    );
    expect(isLikelyIri("MyShell")).toBe(false);
    expect(isLikelyIri("")).toBe(false);
    // IRDI 는 IRI 로 치지 않는다(별도 취급)
    expect(isLikelyIri("0173-1#02-AAC879#008")).toBe(false);
  });

  it("isLikelyIrdi: eCl@ss/CDD 형식", () => {
    expect(isLikelyIrdi("0173-1#02-AAC879#008")).toBe(true);
    expect(isLikelyIrdi("urn:uuid:1")).toBe(false);
  });

  it("isValidIdShort: AASd-002 명명규칙", () => {
    expect(isValidIdShort("MyShell")).toBe(true);
    expect(isValidIdShort("Serial_Part1")).toBe(true);
    expect(isValidIdShort("1abc")).toBe(false); // 숫자 시작
    expect(isValidIdShort("My-Shell")).toBe(false); // 하이픈
    expect(isValidIdShort("")).toBe(false);
  });

  it("isLikelyGlobalReference: IRI 또는 IRDI", () => {
    expect(isLikelyGlobalReference("urn:samm:x:1#Y")).toBe(true);
    expect(isLikelyGlobalReference("0173-1#02-AAC879#008")).toBe(true);
    expect(isLikelyGlobalReference("plain")).toBe(false);
  });
});

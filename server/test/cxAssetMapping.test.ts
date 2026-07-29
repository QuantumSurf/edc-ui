import { describe, expect, it } from "vitest";
import { mapAsset, toEdcAssetBody } from "../lib/edcClient";

/**
 * CX-0002 (Digital Twins in Catena-X) 자산 등록 규약 회귀 테스트.
 *
 * 인증 항목에서 확인된 MUST 위반 4건을 고정한다:
 *   CAC-017/038  dct prefix 는 http://purl.org/dc/terms/
 *   CAC-018/019/039/040  cx-common:version 은 최소 "3.0"
 *   CAC-041/042  semanticId 는 aas-semantics 네임스페이스
 *   CAC-037/038  단일 Submodel 은 cx-taxo:Submodel (Dialog 쪽 값이지만 매핑 왕복 확인)
 */
describe("CX-0002 자산 JSON-LD 매핑", () => {
  const base = {
    id: "urn:uuid:sub-1",
    name: "PCF Submodel",
    type: "cx-taxo:Submodel",
    sem: "urn:samm:io.catenax.pcf:7.0.0#Pcf",
    dataAddressType: "HttpData",
    baseUrl: "http://backend:8080/data",
  };

  it("CAC-017: dct prefix 가 http 스킴이어야 한다", () => {
    const body = toEdcAssetBody(base);
    const ctx = body["@context"] as Record<string, string>;
    expect(ctx.dct).toBe("http://purl.org/dc/terms/");
    expect(ctx.dct).not.toContain("https://purl.org");
  });

  it("CAC-018/019: cx-common:version 이 비어 있지 않고 최소 3.0 이어야 한다", () => {
    const props = toEdcAssetBody(base).properties as Record<string, unknown>;
    const ver = String(props["cx-common:version"]);
    expect(ver).not.toBe("");
    const [major, minor] = ver.split(".").map(Number);
    expect(major * 100 + (minor ?? 0)).toBeGreaterThanOrEqual(300);
  });

  it("CAC-018: 명시된 version 은 그대로 보존한다", () => {
    const props = toEdcAssetBody({ ...base, ver: "3.1" }).properties as Record<string, unknown>;
    expect(props["cx-common:version"]).toBe("3.1");
  });

  it("CAC-041/042: semanticId 는 aas-semantics 네임스페이스로 나가야 한다", () => {
    const body = toEdcAssetBody(base);
    const ctx = body["@context"] as Record<string, string>;
    const props = body.properties as Record<string, unknown>;
    expect(ctx["aas-semantics"]).toBe("https://admin-shell.io/aas/3/0/HasSemantics/");
    expect(props["aas-semantics:semanticId"]).toBe(base.sem);
    expect(props.semanticId).toBeUndefined();
  });

  it("dct:type 은 @id 객체로 직렬화된다", () => {
    const props = toEdcAssetBody(base).properties as Record<string, unknown>;
    expect(props["dct:type"]).toEqual({ "@id": "cx-taxo:Submodel" });
  });

  it("읽기 경로: 표준 IRI(http)로 저장된 자산을 인식한다", () => {
    const mapped = mapAsset({
      "@id": "urn:uuid:sub-1",
      properties: {
        "http://purl.org/dc/terms/type": { "@id": "https://w3id.org/catenax/taxonomy#Submodel" },
        "https://admin-shell.io/aas/3/0/HasSemantics/semanticId": "urn:samm:x#Y",
        "cx-common:version": "3.0",
      },
      dataAddress: { type: "HttpData" },
    });
    expect(mapped.type).toBe("https://w3id.org/catenax/taxonomy#Submodel");
    expect(mapped.sem).toBe("urn:samm:x#Y");
    expect(mapped.ver).toBe("3.0");
  });

  it("읽기 경로: 과거 https 로 저장된 자산도 계속 읽힌다(하위호환)", () => {
    const mapped = mapAsset({
      "@id": "legacy",
      properties: {
        "https://purl.org/dc/terms/type": { "@id": "https://w3id.org/catenax/taxonomy#DigitalTwinRegistry" },
      },
      dataAddress: { type: "HttpData" },
    });
    expect(mapped.type).toBe("https://w3id.org/catenax/taxonomy#DigitalTwinRegistry");
  });

  it("사용자 정의 속성은 표준 키를 덮어쓰지 않는다", () => {
    const props = toEdcAssetBody({
      ...base,
      customProperties: { "cx-common:version": "9.9", "http://purl.org/dc/terms/type": "x" },
    }).properties as Record<string, unknown>;
    expect(props["cx-common:version"]).toBe("3.0");
    expect(props["dct:type"]).toEqual({ "@id": "cx-taxo:Submodel" });
  });
});

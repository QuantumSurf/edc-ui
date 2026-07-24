// 특화 뷰 추출 로직 특성화 — AAS Part 2 본문에서 리프 평탄화·핵심 필드 승격을 고정.
import { describe, it, expect } from "vitest";
import {
  flattenLeaves,
  detectTemplateKind,
  extractNameplate,
  extractTechnicalProps,
} from "@/lib/templateViews";

const NAMEPLATE_BODY = {
  idShort: "Nameplate",
  submodelElements: [
    {
      idShort: "ManufacturerName",
      modelType: "MultiLanguageProperty",
      value: [
        { language: "en", text: "QuantumSurf" },
        { language: "ko", text: "퀀텀서프" },
      ],
    },
    {
      idShort: "SerialNumber",
      modelType: "Property",
      value: "SN-1",
    },
    {
      idShort: "Markings",
      modelType: "SubmodelElementCollection",
      value: [{ idShort: "CEMarking", modelType: "Property", value: "true" }],
    },
  ],
};

describe("flattenLeaves", () => {
  it("중첩 SMC 를 경로와 함께 평탄화, MLP 는 ko 우선", () => {
    const leaves = flattenLeaves(NAMEPLATE_BODY);
    expect(leaves).toContainEqual({
      path: "ManufacturerName",
      idShort: "ManufacturerName",
      value: "퀀텀서프",
    });
    expect(leaves).toContainEqual({
      path: "Markings.CEMarking",
      idShort: "CEMarking",
      value: "true",
    });
  });

  it("본문이 객체가 아니면 빈 배열", () => {
    expect(flattenLeaves(null)).toEqual([]);
    expect(flattenLeaves("x")).toEqual([]);
  });
});

describe("detectTemplateKind", () => {
  it("정본 semanticId 를 인지(02006/02003)", () => {
    expect(
      detectTemplateKind("https://admin-shell.io/idta/nameplate/3/0/Nameplate")
    ).toBe("nameplate");
    expect(
      detectTemplateKind(
        "https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/2"
      )
    ).toBe("technicalData");
  });

  it("경로 패턴 폴백(비정본 버전) + 미지/빈 값은 null", () => {
    expect(
      detectTemplateKind("https://admin-shell.io/zvei/nameplate/2/0/Nameplate")
    ).toBe("nameplate");
    expect(detectTemplateKind("urn:samm:io.catenax.pcf:7.0.0#Pcf")).toBeNull();
    expect(detectTemplateKind("")).toBeNull();
  });
});

describe("extractNameplate / extractTechnicalProps", () => {
  it("Nameplate 핵심 필드를 표준 순서로 승격(있는 것만)", () => {
    const fields = extractNameplate(flattenLeaves(NAMEPLATE_BODY));
    expect(fields.map(f => f.key)).toEqual([
      "ManufacturerName",
      "SerialNumber",
    ]);
    expect(fields[0].value).toBe("퀀텀서프");
  });

  it("TechnicalProperties/GeneralInformation 스코프 우선, 없으면 전체", () => {
    const body = {
      submodelElements: [
        {
          idShort: "TechnicalProperties",
          value: [{ idShort: "RatedPower", value: "150" }],
        },
        { idShort: "Notes", value: "etc" },
      ],
    };
    const scoped = extractTechnicalProps(flattenLeaves(body));
    expect(scoped).toHaveLength(1);
    expect(scoped[0].path).toBe("TechnicalProperties.RatedPower");

    const noScope = extractTechnicalProps(
      flattenLeaves({ submodelElements: [{ idShort: "A", value: "1" }] })
    );
    expect(noScope).toHaveLength(1);
  });
});

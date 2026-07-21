// KMX EDC — 표준 서브모델 템플릿(semanticId) 카탈로그 & 인식
//
// AAS 세미나 핵심: "서브모델의 정체성은 idShort 가 아니라 semanticId 가 결정한다",
// "재사용 → 확장 → 신규: 표준 템플릿을 먼저 재사용하라". DTR 서브모델 descriptor 의
// semanticId 를 표준 템플릿과 대조해 (1) 입력 시 재사용을 돕고, (2) 표시 시 사람이
// 읽는 이름으로 인식(라벨링)한다.
//
// 카탈로그 semanticId 는 정본에서 확인한 값만 수록한다(날조 금지):
//  - Catena-X aspect: eclipse-tractusx/sldt-semantic-models (git tree 최신 버전)
//  - IDTA 범용 템플릿: admin-shell.io (검증된 3종). 미검증 템플릿은 카탈로그에서 빼되
//    recognize() 의 일반 패턴 매칭으로 표시만 커버한다.

export type TemplateSource = "IDTA" | "Catena-X";

export interface SemanticTemplate {
  /** 정확한 semanticId(IRI). 데이터리스트 추천값으로 사용. */
  semanticId: string;
  /** 사람이 읽는 이름. */
  name: string;
  source: TemplateSource;
  /** IDTA 번호 또는 Catena-X 네임스페이스 등 참고 식별자. */
  ref: string;
}

/**
 * 큐레이트 카탈로그 — semanticId 는 전부 정본에서 확인한 정확값.
 * 데이터리스트 추천 + 정확 매칭 인식에 사용한다.
 */
export const SEMANTIC_TEMPLATES: readonly SemanticTemplate[] = [
  // ── IDTA 범용 템플릿(admin-shell.io, 검증됨) ──────────────────────────
  {
    semanticId: "https://admin-shell.io/idta/nameplate/3/0/Nameplate",
    name: "Digital Nameplate",
    source: "IDTA",
    ref: "IDTA 02006-3-0",
  },
  {
    semanticId: "https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/2",
    name: "Technical Data",
    source: "IDTA",
    ref: "IDTA 02003-1-2",
  },
  {
    semanticId: "https://admin-shell.io/idta/TimeSeries/1/1",
    name: "Time Series Data",
    source: "IDTA",
    ref: "IDTA 02008-1-1",
  },
  // ── Catena-X SAMM aspect(sldt-semantic-models, 최신 버전) ─────────────
  {
    semanticId: "urn:samm:io.catenax.serial_part:4.0.0#SerialPart",
    name: "Serial Part",
    source: "Catena-X",
    ref: "io.catenax.serial_part",
  },
  {
    semanticId: "urn:samm:io.catenax.batch:4.0.0#Batch",
    name: "Batch",
    source: "Catena-X",
    ref: "io.catenax.batch",
  },
  {
    semanticId:
      "urn:samm:io.catenax.part_type_information:2.0.0#PartTypeInformation",
    name: "Part Type Information",
    source: "Catena-X",
    ref: "io.catenax.part_type_information",
  },
  {
    semanticId: "urn:samm:io.catenax.part_as_planned:2.0.0#PartAsPlanned",
    name: "Part As Planned",
    source: "Catena-X",
    ref: "io.catenax.part_as_planned",
  },
  {
    semanticId:
      "urn:samm:io.catenax.single_level_bom_as_built:4.0.0#SingleLevelBomAsBuilt",
    name: "Single Level BoM As Built",
    source: "Catena-X",
    ref: "io.catenax.single_level_bom_as_built",
  },
  {
    semanticId:
      "urn:samm:io.catenax.single_level_bom_as_planned:4.0.0#SingleLevelBomAsPlanned",
    name: "Single Level BoM As Planned",
    source: "Catena-X",
    ref: "io.catenax.single_level_bom_as_planned",
  },
  {
    semanticId:
      "urn:samm:io.catenax.single_level_usage_as_built:4.0.0#SingleLevelUsageAsBuilt",
    name: "Single Level Usage As Built",
    source: "Catena-X",
    ref: "io.catenax.single_level_usage_as_built",
  },
  {
    semanticId: "urn:samm:io.catenax.pcf:9.0.0#Pcf",
    name: "Product Carbon Footprint (PCF)",
    source: "Catena-X",
    ref: "io.catenax.pcf",
  },
  {
    semanticId:
      "urn:samm:io.catenax.generic.digital_product_passport:7.0.0#DigitalProductPassport",
    name: "Digital Product Passport",
    source: "Catena-X",
    ref: "io.catenax.generic.digital_product_passport",
  },
  {
    semanticId:
      "urn:samm:io.catenax.traction_battery_code:2.0.0#TractionBatteryCode",
    name: "Traction Battery Code",
    source: "Catena-X",
    ref: "io.catenax.traction_battery_code",
  },
  {
    semanticId:
      "urn:samm:io.catenax.certificate_of_destruction:2.0.0#CertificateOfDestruction",
    name: "Certificate of Destruction",
    source: "Catena-X",
    ref: "io.catenax.certificate_of_destruction",
  },
] as const;

export interface RecognizedTemplate {
  name: string;
  source: TemplateSource;
  /** 카탈로그 정확 매칭이면 true(추가로 ref 제공). 패턴 매칭이면 false. */
  exact: boolean;
  ref?: string;
}

/** snake_case / kebab → "Title Case" 근사. 인식 이름 유도용. */
function humanize(seg: string): string {
  return seg
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * semanticId 를 알려진 표준 템플릿으로 인식한다.
 *  1) 카탈로그 정확 매칭 → exact=true
 *  2) `urn:samm:io.catenax.<ns>:<ver>#<Aspect>` → Catena-X aspect(버전 무관)
 *  3) `https://admin-shell.io/...` → IDTA/AAS(경로에서 이름 유도)
 *  4) 그 외 → null
 */
export function recognizeSemanticId(
  value: string | null | undefined
): RecognizedTemplate | null {
  const v = (value ?? "").trim();
  if (!v) return null;

  const exact = SEMANTIC_TEMPLATES.find(t => t.semanticId === v);
  if (exact)
    return {
      name: exact.name,
      source: exact.source,
      exact: true,
      ref: exact.ref,
    };

  // Catena-X SAMM aspect: urn:samm:io.catenax.<ns>:<ver>#<Aspect>
  const cx = /^urn:samm:io\.catenax\.([a-z0-9_.]+):[^#]*#(\w+)/i.exec(v);
  if (cx) {
    const aspect = cx[2];
    return {
      name: humanize(aspect),
      source: "Catena-X",
      exact: false,
      ref: `io.catenax.${cx[1]}`,
    };
  }

  // admin-shell.io / IDTA: 경로에서 의미 세그먼트 추출(버전 숫자·키워드 제외)
  const as = /^https?:\/\/admin-shell\.io\/(.+)$/i.exec(v);
  if (as) {
    const parts = as[1].split("/").filter(Boolean);
    const skip = new Set(["idta", "zvei", "submodel", "submodels", "aas"]);
    const meaningful = parts.filter(
      p => !/^\d+$/.test(p) && !skip.has(p.toLowerCase())
    );
    const seg = meaningful[meaningful.length - 1] ?? parts[0];
    return { name: humanize(seg), source: "IDTA", exact: false };
  }

  return null;
}

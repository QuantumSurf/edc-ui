// 서브모델 특화 뷰(Nameplate 02006 · TechnicalData 02003)용 순수 추출 로직.
// SubmodelContentViewer 의 범용 트리를 대체하는 게 아니라, 표준 템플릿일 때
// 핵심 필드를 상단에 승격해 보여주기 위한 평탄화/추출 유틸이다.
// (컴포넌트와 분리해 둔 이유: 순수 함수라 단위테스트로 고정 가능 + HMR 규칙)

import { recognizeSemanticId } from "@/lib/semanticTemplates";

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;

/** 자식 요소 배열 — SMC(value)·Submodel(submodelElements)·Entity(statements). */
function childElements(el: Rec): Rec[] {
  for (const key of ["submodelElements", "statements", "annotations"]) {
    const v = el[key];
    if (Array.isArray(v)) return v.map(asRec).filter((x): x is Rec => !!x);
  }
  const v = el["value"];
  if (Array.isArray(v) && v.every(x => asRec(x)?.["idShort"] !== undefined)) {
    return v.map(asRec).filter((x): x is Rec => !!x);
  }
  return [];
}

/** 리프 값 문자열화 — Property.value, MLP(value[{language,text}]) 등. */
function leafValue(el: Rec): string | null {
  const v = el["value"];
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return String(v);
  if (Array.isArray(v) && v.every(x => asRec(x)?.["text"] !== undefined)) {
    // MLP — ko 우선, 없으면 첫 항목
    const ko = v.map(asRec).find(r => r?.["language"] === "ko");
    const first = asRec(v[0]);
    return String((ko ?? first)?.["text"] ?? "");
  }
  return null;
}

export interface FlatLeaf {
  /** 경로(부모 idShort 포함, '.' 결합) — 예: "GeneralInformation.ManufacturerName" */
  path: string;
  idShort: string;
  value: string;
}

/** 서브모델 본문을 리프(값을 가진 Property/MLP)로 평탄화한다. */
export function flattenLeaves(content: unknown, maxDepth = 6): FlatLeaf[] {
  const root = asRec(content);
  if (!root) return [];
  const out: FlatLeaf[] = [];
  const walk = (el: Rec, prefix: string, depth: number) => {
    if (depth > maxDepth) return;
    const children = childElements(el);
    const idShort = String(el["idShort"] ?? "");
    const path = prefix ? (idShort ? `${prefix}.${idShort}` : prefix) : idShort;
    if (children.length === 0) {
      const v = leafValue(el);
      if (v !== null && idShort) out.push({ path, idShort, value: v });
      return;
    }
    for (const c of children) walk(c, path, depth + 1);
  };
  for (const c of childElements(root)) walk(c, "", 0);
  return out;
}

/** 템플릿 종류 판별 — 정본 매칭(ref) 우선, admin-shell.io 경로 패턴 폴백. */
export function detectTemplateKind(
  semanticId: string | null | undefined
): "nameplate" | "technicalData" | null {
  const v = (semanticId ?? "").trim();
  if (!v) return null;
  const r = recognizeSemanticId(v);
  // 정본 ref 는 "IDTA 02006-3-0" 처럼 버전 접미가 붙는다 — 번호 접두로 매칭.
  if (r?.ref?.startsWith("IDTA 02006")) return "nameplate";
  if (r?.ref?.startsWith("IDTA 02003")) return "technicalData";
  if (/nameplate/i.test(v)) return "nameplate";
  if (/technical[_ -]?data/i.test(v)) return "technicalData";
  return null;
}

export interface HighlightField {
  key: string;
  label: { ko: string; en: string };
  value: string;
}

// Digital Nameplate(02006) 핵심 필드 — idShort 표준명 기준(대소문자 무시 매칭).
const NAMEPLATE_FIELDS: Array<{ id: string; ko: string; en: string }> = [
  { id: "ManufacturerName", ko: "제조사", en: "Manufacturer" },
  {
    id: "ManufacturerProductDesignation",
    ko: "제품 명칭",
    en: "Product designation",
  },
  { id: "ManufacturerProductRoot", ko: "제품 계열", en: "Product root" },
  { id: "SerialNumber", ko: "시리얼 번호", en: "Serial number" },
  { id: "YearOfConstruction", ko: "제조 연도", en: "Year of construction" },
  { id: "DateOfManufacture", ko: "제조 일자", en: "Date of manufacture" },
  {
    id: "CountryOfOrigin",
    ko: "원산지",
    en: "Country of origin",
  },
  { id: "URIOfTheProduct", ko: "제품 URI", en: "Product URI" },
];

/** Nameplate 핵심 필드 추출(있는 것만, 표준 순서 유지). */
export function extractNameplate(leaves: FlatLeaf[]): HighlightField[] {
  const out: HighlightField[] = [];
  for (const f of NAMEPLATE_FIELDS) {
    const hit = leaves.find(
      l => l.idShort.toLowerCase() === f.id.toLowerCase()
    );
    if (hit)
      out.push({ key: f.id, label: { ko: f.ko, en: f.en }, value: hit.value });
  }
  return out;
}

/** TechnicalData(02003): TechnicalProperties/GeneralInformation 하위 리프를 표로. */
export function extractTechnicalProps(leaves: FlatLeaf[]): FlatLeaf[] {
  const scoped = leaves.filter(l =>
    /^(TechnicalProperties|GeneralInformation)\./i.test(l.path)
  );
  return scoped.length > 0 ? scoped : leaves;
}

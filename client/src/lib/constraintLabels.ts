// 카탈로그 "정책" 열 — CX-0152 제약을 사람이 읽는 문구로.
// 예: FrameworkAgreement = DataExchangeGovernance:1.0 → "프레임워크 협약: 데이터 교환 거버넌스 v1.0"
// 제약 종류(leftOperand 로컬명)와 알려진 열거값만 번역하고, 식별자(BPN·날짜·미지값)는 원문 유지.

export interface OfferConstraint {
  left: string;
  op: string;
  right: string;
}

type Locale = "ko" | "en";

// 제약 종류(로컬명) → 사람이 읽는 라벨.
const LEFT_LABELS: Record<string, { ko: string; en: string }> = {
  Membership: { ko: "멤버십", en: "Membership" },
  FrameworkAgreement: { ko: "프레임워크 협약", en: "Framework agreement" },
  BusinessPartnerNumber: { ko: "허용 기업(BPN)", en: "Allowed company (BPN)" },
  BusinessPartnerGroup: { ko: "허용 기업 그룹", en: "Allowed company group" },
  UsagePurpose: { ko: "사용 목적", en: "Usage purpose" },
  transferCount: { ko: "전송 횟수", en: "Transfer count" },
  AffiliatesBpnl: { ko: "계열사 기업(BPN)", en: "Affiliate company (BPN)" },
  AffiliatesRegion: { ko: "계열사 지역", en: "Affiliate region" },
  ExclusiveUsage: { ko: "독점 사용", en: "Exclusive usage" },
  UsageRestriction: { ko: "사용 제한", en: "Usage restriction" },
  DataFrequency: { ko: "데이터 제공 빈도", en: "Data frequency" },
  ContractReference: { ko: "계약 참조", en: "Contract reference" },
  ContractTermination: {
    ko: "계약 종료 시 처리",
    en: "On contract termination",
  },
  JurisdictionLocation: { ko: "관할 지역", en: "Jurisdiction" },
  JurisdictionLocationReference: {
    ko: "관할 지역 기준",
    en: "Jurisdiction basis",
  },
  Liability: { ko: "책임 범위", en: "Liability" },
  Precedence: { ko: "문서 우선순위", en: "Precedence" },
  VersionChanges: { ko: "버전 변경 기준", en: "Version changes" },
  Warranty: { ko: "보증", en: "Warranty" },
  WarrantyDefinition: { ko: "보증 기간 정의", en: "Warranty definition" },
  WarrantyDurationMonths: { ko: "보증 기간(개월)", en: "Warranty months" },
  ConfidentialInformationMeasures: {
    ko: "기밀정보 보호조치",
    en: "Confidentiality measures",
  },
  ConfidentialInformationSharing: {
    ko: "기밀정보 공유 범위",
    en: "Confidential sharing",
  },
  DataUsageEndDate: { ko: "데이터 사용 종료일", en: "Data usage end date" },
  DataUsageEndDurationDays: {
    ko: "데이터 사용 기간(일)",
    en: "Data usage days",
  },
  DataUsageEndDefinition: { ko: "데이터 사용 종료 기준", en: "Data usage end" },
  DataProvisioningEndDate: {
    ko: "데이터 제공 종료일",
    en: "Provisioning end date",
  },
  DataProvisioningEndDurationDays: {
    ko: "데이터 제공 기간(일)",
    en: "Provisioning days",
  },
};

// 알려진 열거값 → 사람이 읽는 라벨(미등록 값은 원문 유지 — BPN·날짜 등 식별자).
const VALUE_LABELS: Record<string, { ko: string; en: string }> = {
  active: { ko: "활성", en: "active" },
  "DataExchangeGovernance:1.0": {
    ko: "데이터 교환 거버넌스 v1.0",
    en: "Data Exchange Governance v1.0",
  },
  "Traceability:1.0": { ko: "트레이서빌리티 v1.0", en: "Traceability v1.0" },
  "QualityManagement:1.0": {
    ko: "품질경영 v1.0",
    en: "Quality Management v1.0",
  },
  "cx.core.digitalTwinRegistry:1": {
    ko: "디지털 트윈 레지스트리",
    en: "Digital Twin Registry",
  },
  "cx.core.industrycore:1": { ko: "인더스트리 코어", en: "Industry Core" },
  "cx.dataFrequency.once:1": { ko: "1회", en: "once" },
  "cx.dataFrequency.unlimited:1": { ko: "무제한", en: "unlimited" },
  "cx.data.deletion:1": { ko: "데이터 삭제", en: "data deletion" },
  "cx.data.keeping:1": { ko: "데이터 보관", en: "data keeping" },
  "cx.warranty.none:1": { ko: "없음", en: "none" },
  "cx.warranty.contractReference:1": {
    ko: "계약 참조",
    en: "contract reference",
  },
  "cx.warranty.dataQualityIssues:1": {
    ko: "데이터 품질 이슈",
    en: "data quality issues",
  },
  "cx.exclusiveUsage.dataConsumer:1": {
    ko: "데이터 소비자 독점",
    en: "data consumer exclusive",
  },
  "cx.region.all:1": { ko: "전 지역", en: "all regions" },
  "cx.region.europe:1": { ko: "유럽", en: "Europe" },
  "cx.region.northAmerica:1": { ko: "북미", en: "North America" },
  "cx.region.southAmerica:1": { ko: "남미", en: "South America" },
  "cx.region.africa:1": { ko: "아프리카", en: "Africa" },
  "cx.region.asia:1": { ko: "아시아", en: "Asia" },
  "cx.region.oceania:1": { ko: "오세아니아", en: "Oceania" },
  "cx.region.antarctica:1": { ko: "남극", en: "Antarctica" },
  "cx.dataUsageEnd.unlimited:1": { ko: "무제한", en: "unlimited" },
  "cx.grossNegligence:1": { ko: "중과실", en: "gross negligence" },
  "cx.slightNegligence:1": { ko: "경과실", en: "slight negligence" },
};

// 비교 연산자(숫자 제약)는 값을 그대로 두고 기호로.
const COMPARE_OPS = new Set(["<", ">", "≤", "≥", "≠"]);

function leftLabel(name: string, locale: Locale): string {
  return LEFT_LABELS[name]?.[locale] ?? name;
}

function valueLabel(v: string, locale: Locale): string {
  return VALUE_LABELS[v.trim()]?.[locale] ?? v.trim();
}

/** 제약 하나를 사람이 읽는 한 줄 문구로. */
export function describeConstraint(c: OfferConstraint, locale: Locale): string {
  const left = leftLabel(c.left, locale);
  const values = c.right
    .split(",")
    .map(v => valueLabel(v, locale))
    .filter(Boolean)
    .join(", ");
  // 숫자 비교(전송 횟수 < 5 등)는 "라벨 기호 값"으로.
  if (COMPARE_OPS.has(c.op)) return `${left} ${c.op} ${values}`.trim();
  // 그 외(=, ∈ 등 "값이어야 함")는 "라벨: 값"으로.
  if (!values) return left;
  return `${left}: ${values}`;
}

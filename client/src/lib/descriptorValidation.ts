// KMX EDC — DTR descriptor 형식 검증 헬퍼(비차단 힌트용)
//
// AAS 세미나 정량 체크리스트: AAS/Submodel Id 는 IRI/IRDI 형식, idShort 는 명명규칙
// (AASd-002), semanticId 는 IRI(또는 IRDI). 이 콘솔은 registry descriptor 를 다루므로
// 콘텐츠 레벨(value/valueType/CD)이 아닌 descriptor 레벨 형식만 '경고'로 안내한다.
// 하드 블록 금지 — descriptor 는 기계 생성이 잦고 DTR 백엔드가 자체 검증하므로,
// 오탐 위험을 피해 '입력했으나 형식이 어긋날 때'만 비차단 경고를 띄운다.

/** IRI 근사 판정: 스킴(`scheme:`)을 가진 절대 식별자(urn:*, https:* 등). */
export function isLikelyIri(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  // RFC 3986 scheme + 최소 1자 이상 스킴별 본문. IRDI 는 별도로 취급하므로 제외.
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:.+/.test(s) && !isLikelyIrdi(s);
}

/** IRDI 근사 판정: eCl@ss/IEC CDD 형식(예: 0173-1#02-AAC879#008). */
export function isLikelyIrdi(v: string): boolean {
  const s = v.trim();
  // ICD(4자리)-... #... 형태. 대략적 근사(정밀 ISO 29002-5 아님).
  return /^\d{4}-[0-9A-Za-z]+(#[0-9A-Za-z]+)+/.test(s);
}

/** idShort 명명규칙(AASd-002): 영문자로 시작, 영숫자/밑줄만. */
export function isValidIdShort(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s);
}

/** semanticId 는 IRI 또는 IRDI 여야 한다(둘 다 아니면 경고). */
export function isLikelyGlobalReference(v: string): boolean {
  return isLikelyIri(v) || isLikelyIrdi(v);
}

/**
 * 같은 레벨에서 2회 이상 등장한 값들을 반환한다(형제 서브모델 idShort/id 중복 검출).
 * AAS 표준상 동일 레벨 idShort 중복은 금지, descriptor id 는 전역 고유해야 한다.
 * 빈 값은 '아직 미입력'이므로 중복 판정에서 제외한다.
 */
export function findDuplicates(values: Array<string | undefined>): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const raw of values) {
    const v = (raw ?? "").trim();
    if (!v) continue;
    if (seen.has(v)) dup.add(v);
    else seen.add(v);
  }
  return dup;
}

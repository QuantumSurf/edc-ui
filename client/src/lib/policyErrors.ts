// 정책 저장 실패 시 커넥터(kmx-edc 검증기·EDC 코어)가 주는 원문을 사용자 친화 문구로
// 변환한다. 원문은 전체 IRI·규칙 덤프·영어 코어 메시지가 섞여 있어 그대로 노출하면
// 사용자가 이해할 수 없다(예: "leftOperand 'x' is not bound to any scopes: Rule {…}").
// 변환 문구 자체는 i18n(ko/en `policies.err`)에서 받는다.

export interface PolicyErrMessages {
  usageRequired: (names: string) => string;
  notAllowedInRule: (name: string) => string;
  bpnAccessOnlyHint: string;
  mutuallyExclusive: (a: string, b: string) => string;
  operatorNotAllowed: (name: string, op: string, allowed: string) => string;
  valueNotAllowed: (name: string, value: string, allowed: string) => string;
  badFormat: (name: string, hint: string) => string;
  unknownConstraint: (name: string) => string;
  duplicateId: string;
  mixedActions: string;
  andOnly: string;
  singleValue: (name: string) => string;
  duplicateValues: (name: string) => string;
  emptyValue: (name: string) => string;
  actionMustBe: (rule: string, action: string) => string;
  ruleNotAllowed: (rule: string) => string;
  formatBpnl: string;
  formatInteger: string;
  formatDate: string;
}

const NS_PREFIXES = [
  "https://w3id.org/catenax/2025/9/policy/",
  "https://w3id.org/catenax/policy/",
  "https://w3id.org/kmx/v0.1/ns/",
  "https://w3id.org/edc/v0.0.1/ns/",
  "cx-policy:",
  "kmx:",
  "odrl:",
];

/** 전체 IRI/접두형을 로컬명으로 축약 — 빌더 드롭다운에서 보이는 토큰과 일치시킨다. */
export function operandDisplay(v: string): string {
  let out = v;
  for (const p of NS_PREFIXES) {
    if (out.startsWith(p)) {
      out = out.slice(p.length);
      break;
    }
  }
  const i = Math.max(out.lastIndexOf("/"), out.lastIndexOf("#"));
  return i < 0 ? out : out.slice(i + 1);
}

/** 문장 안의 전체 IRI 들을 로컬명으로 치환(fallback 표시용). */
function compactIris(s: string): string {
  return s.replace(/https?:\/\/[^\s'";,)\]}]+/g, m => operandDisplay(m));
}

/** 정규식 힌트를 사람이 읽을 수 있는 형식 안내로. */
function formatHint(pattern: string, m: PolicyErrMessages): string {
  if (pattern.includes("BPNL")) return m.formatBpnl;
  if (/\\d\{4\}/.test(pattern) || pattern.includes("T\\d")) return m.formatDate;
  if (pattern.includes("\\d+") && pattern.length < 20) return m.formatInteger;
  return pattern;
}

/**
 * 커넥터 오류 원문 → 사용자 친화 문구. 여러 메시지("; " 결합·중복 포함)를 분해해
 * 패턴별로 번역하고, 같은 내용은 한 번만 남긴다. 매칭 실패 시 IRI 축약 + 규칙 덤프
 * 제거만 한 원문을 반환한다(정보 유실 방지).
 */
export function friendlyPolicyError(raw: string, m: PolicyErrMessages): string {
  if (!raw.trim()) return raw;
  const segments = raw.split(/;\s+/);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };

  // CAC-019(필수 제약 누락)는 제약별로 반복되므로 모아서 한 문장으로.
  const required: string[] = [];
  const rest: string[] = [];
  for (const seg of segments) {
    const r = seg.match(/필수 제약이 없습니다:\s*(\S+)/);
    if (r) {
      const name = operandDisplay(r[1]);
      if (!required.includes(name)) required.push(name);
    } else {
      rest.push(seg);
    }
  }
  if (required.length) push(m.usageRequired(required.join(", ")));

  for (const seg of rest) {
    let match: RegExpMatchArray | null;

    if ((match = seg.match(/leftOperand '([^']+)' is not bound to any/))) {
      push(m.unknownConstraint(operandDisplay(match[1])));
      continue;
    }
    if (/already exists/i.test(seg)) {
      push(m.duplicateId);
      continue;
    }
    if (
      (match = seg.match(/'([^']+)' 와 '([^']+)' 는 함께 사용할 수 없습니다/))
    ) {
      push(
        m.mutuallyExclusive(operandDisplay(match[1]), operandDisplay(match[2]))
      );
      continue;
    }
    if ((match = seg.match(/허용되지 않는 제약입니다[:\s]*(\S+)/))) {
      const name = operandDisplay(match[1]);
      let msg = m.notAllowedInRule(name);
      if (name.includes("BusinessPartner")) msg += " " + m.bpnAccessOnlyHint;
      push(msg);
      continue;
    }
    if (
      (match = seg.match(
        /'([^']+)' 제약의 operator '([^']+)' 는 허용되지 않습니다\. 허용: \[([^\]]*)\]/
      ))
    ) {
      push(m.operatorNotAllowed(operandDisplay(match[1]), match[2], match[3]));
      continue;
    }
    if (
      (match = seg.match(
        /'([^']+)' 제약의 rightOperand '([^']*)': 허용값이 아닙니다\. 허용: \[([^\]]*)\]/
      ))
    ) {
      push(m.valueNotAllowed(operandDisplay(match[1]), match[2], match[3]));
      continue;
    }
    if (
      (match = seg.match(
        /'([^']+)' 제약의 rightOperand '[^']*': 형식이 올바르지 않습니다 \(기대: ([^)]*)\)/
      ))
    ) {
      push(m.badFormat(operandDisplay(match[1]), formatHint(match[2], m)));
      continue;
    }
    // 그 외 "rightOperand 'v': <사유>" 류(kmx BPNL 안내 등)는 사유를 그대로 힌트로.
    if ((match = seg.match(/'([^']+)' 제약의 rightOperand '[^']*':\s*(.+)$/))) {
      push(m.badFormat(operandDisplay(match[1]), match[2].trim()));
      continue;
    }
    if ((match = seg.match(/'([^']+)' 제약은 단일 값만 허용합니다/))) {
      push(m.singleValue(operandDisplay(match[1])));
      continue;
    }
    if ((match = seg.match(/'([^']+)' 제약의 rightOperand 에 중복 값/))) {
      push(m.duplicateValues(operandDisplay(match[1])));
      continue;
    }
    if ((match = seg.match(/'([^']+)' 제약에 rightOperand 가 없습니다/))) {
      push(m.emptyValue(operandDisplay(match[1])));
      continue;
    }
    if (/access 와 use 를 섞을 수 없습니다/.test(seg)) {
      push(m.mixedActions);
      continue;
    }
    if (/odrl:and 로만 체이닝/.test(seg)) {
      push(m.andOnly);
      continue;
    }
    if ((match = seg.match(/(\S+) 의 action 은 '([^']+)' 여야 합니다/))) {
      push(m.actionMustBe(match[1], operandDisplay(match[2])));
      continue;
    }
    if (
      (match = seg.match(/이 정책 유형에서는 (\S+) 규칙을 사용할 수 없습니다/))
    ) {
      push(m.ruleNotAllowed(match[1]));
      continue;
    }
    // fallback — IRI 축약 + "Rule {…}" 덤프 제거
    const cleaned = compactIris(seg.replace(/Rule \{.*$/s, "").trim());
    if (cleaned) push(cleaned);
  }

  return out.join("\n");
}

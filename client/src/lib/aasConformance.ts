// AAS 표준 적합성(디스크립터 레벨) 점검 — 이미 로드된 셸 디스크립터
// (globalAssetId·idShort·submodelDescriptors[].semanticId)만으로 판정 가능한 규칙.
//
// 근거: AAS 세미나 "정량적 평가" 체크리스트의 디스크립터 레벨 항목
//  - AAS Id/globalAssetId 설정(#4·#6), idShort 설정(#2)
//  - 필수 서브모델(Nameplate·Handover·Technical Data·Operational) + 총 6~8종(#5)
//  - 서브모델 Semantic ID 작성(#10)
// KMX 고유 추가: 버전 드리프트(정본 카탈로그와 다른 버전, semanticTemplates caution),
// idShort 형식(AASd-002)·중복 검사(descriptorValidation 재사용).
//
// 비차단(non-blocking) 인지형 검증 — 저장/노출을 막지 않는다. fail 은 명백한
// 필수 결손(빈 globalAssetId 등)에만 쓰고, 세미나 가이드 항목은 warn 으로 둔다
// (임계 정책은 운영 확정 시 보정 대상).

import type { ShellDescriptor } from "@/lib/data";
import { recognizeSemanticId } from "@/lib/semanticTemplates";
import { isValidIdShort, findDuplicates } from "@/lib/descriptorValidation";

export type ConformanceLevel = "pass" | "warn" | "fail";

export interface ConformanceRule {
  id: string;
  label: string;
  level: ConformanceLevel;
  detail: string;
}

export interface ConformanceReport {
  rules: ConformanceRule[];
  summary: { pass: number; warn: number; fail: number };
  overall: ConformanceLevel;
}

type Loc = "ko" | "en";
const tr = (loc: Loc, ko: string, en: string) => (loc === "ko" ? ko : en);

// 세미나 "필수 4종" — semanticId/idShort 소프트 매칭으로 감지한다.
// (Handover 02004 는 KMX 정본 카탈로그에 없어 recognizeSemanticId 정확 매칭이 불가 —
//  admin-shell.io 경로/idShort 패턴으로 느슨하게 인지)
const REQUIRED_SUBMODELS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Digital Nameplate", pattern: /nameplate/i },
  { name: "Handover Documentation", pattern: /handover/i },
  { name: "Technical Data", pattern: /technical[_ -]?data/i },
  { name: "Operational Data", pattern: /operation|operating|betrieb/i },
];

export function checkShellConformance(
  shell: ShellDescriptor,
  locale: Loc = "ko"
): ConformanceReport {
  const rules: ConformanceRule[] = [];
  const subs = shell.submodelDescriptors ?? [];

  // 1) globalAssetId 설정(필수)
  rules.push({
    id: "globalAssetId",
    label: tr(locale, "globalAssetId 설정", "globalAssetId set"),
    level: shell.globalAssetId?.trim() ? "pass" : "fail",
    detail: shell.globalAssetId?.trim()
      ? shell.globalAssetId
      : tr(locale, "globalAssetId 가 비어 있음", "globalAssetId is empty"),
  });

  // 2) AAS idShort 설정 + 형식(AASd-002)
  const idShortOk = !!shell.idShort?.trim();
  const idShortValid = idShortOk && isValidIdShort(shell.idShort);
  rules.push({
    id: "aasIdShort",
    label: tr(locale, "AAS idShort 설정/형식", "AAS idShort set/format"),
    level: !idShortOk ? "fail" : idShortValid ? "pass" : "warn",
    detail: !idShortOk
      ? tr(locale, "idShort 가 비어 있음", "idShort is empty")
      : idShortValid
        ? shell.idShort
        : tr(
            locale,
            `AASd-002 형식 위반 의심: ${shell.idShort}`,
            `possible AASd-002 violation: ${shell.idShort}`
          ),
  });

  // 3) 모든 서브모델에 Semantic ID(필수)
  const noSemantic = subs.filter(s => !s.semanticId?.trim());
  rules.push({
    id: "semanticIdPresent",
    label: tr(locale, "서브모델 Semantic ID", "Submodel Semantic ID"),
    level:
      subs.length === 0 ? "warn" : noSemantic.length === 0 ? "pass" : "fail",
    detail:
      subs.length === 0
        ? tr(locale, "서브모델 없음", "no submodels")
        : noSemantic.length === 0
          ? tr(locale, "전 서브모델 작성됨", "all submodels have semanticId")
          : tr(
              locale,
              `${noSemantic.length}종 누락: ${noSemantic.map(s => s.idShort || s.id).join(", ")}`,
              `${noSemantic.length} missing: ${noSemantic.map(s => s.idShort || s.id).join(", ")}`
            ),
  });

  // 4) 표준 인지 커버리지(정보성) — 정본/패턴 어느 쪽이든 인지되면 카운트
  const recognizedCount = subs.filter(
    s => s.semanticId && recognizeSemanticId(s.semanticId) !== null
  ).length;
  rules.push({
    id: "standardCoverage",
    label: tr(locale, "표준 인지 커버리지", "Standard recognition coverage"),
    level:
      subs.length === 0
        ? "warn"
        : recognizedCount === subs.length
          ? "pass"
          : "warn",
    detail: tr(
      locale,
      `${recognizedCount}/${subs.length} 서브모델이 표준(IDTA/Catena-X/IRDI)으로 인지됨`,
      `${recognizedCount}/${subs.length} submodels recognized (IDTA/Catena-X/IRDI)`
    ),
  });

  // 5) 버전 드리프트(KMX 고유) — 정본 카탈로그와 다른 버전/비정본 경로(caution)
  const drifted = subs.filter(s => {
    const r = s.semanticId ? recognizeSemanticId(s.semanticId) : null;
    return r?.caution === true;
  });
  rules.push({
    id: "versionDrift",
    label: tr(locale, "정본 버전 일치", "Canonical version match"),
    level: drifted.length === 0 ? "pass" : "warn",
    detail:
      drifted.length === 0
        ? tr(locale, "버전 드리프트 없음", "no version drift")
        : tr(
            locale,
            `${drifted.length}종 확인 필요: ${drifted.map(s => s.idShort || s.id).join(", ")}`,
            `${drifted.length} need review: ${drifted.map(s => s.idShort || s.id).join(", ")}`
          ),
  });

  // 6) 필수 서브모델(세미나 4종) 존재 — 소프트 매칭(semanticId·idShort)
  const matchesRequired = (p: RegExp) =>
    subs.some(s => p.test(s.semanticId ?? "") || p.test(s.idShort ?? ""));
  const missing = REQUIRED_SUBMODELS.filter(r => !matchesRequired(r.pattern));
  rules.push({
    id: "requiredSubmodels",
    label: tr(locale, "필수 서브모델(4종)", "Required submodels (4)"),
    level: missing.length === 0 ? "pass" : "warn",
    detail:
      missing.length === 0
        ? tr(locale, "4종 모두 존재", "all 4 present")
        : tr(
            locale,
            `누락 의심: ${missing.map(m => m.name).join(", ")}`,
            `possibly missing: ${missing.map(m => m.name).join(", ")}`
          ),
  });

  // 7) 서브모델 총 6~8종(세미나 가이드)
  const n = subs.length;
  rules.push({
    id: "submodelCount",
    label: tr(locale, "서브모델 6~8종", "6–8 submodels"),
    level: n >= 6 && n <= 8 ? "pass" : "warn",
    detail: tr(locale, `현재 ${n}종`, `${n} submodels`),
  });

  // 8) 서브모델 idShort 중복 없음
  const dups = findDuplicates(subs.map(s => s.idShort));
  rules.push({
    id: "idShortDuplicates",
    label: tr(locale, "서브모델 idShort 중복 없음", "No duplicate idShort"),
    level: dups.size === 0 ? "pass" : "warn",
    detail:
      dups.size === 0
        ? tr(locale, "중복 없음", "no duplicates")
        : tr(
            locale,
            `중복: ${[...dups].join(", ")}`,
            `duplicates: ${[...dups].join(", ")}`
          ),
  });

  const summary = {
    pass: rules.filter(r => r.level === "pass").length,
    warn: rules.filter(r => r.level === "warn").length,
    fail: rules.filter(r => r.level === "fail").length,
  };
  const overall: ConformanceLevel =
    summary.fail > 0 ? "fail" : summary.warn > 0 ? "warn" : "pass";

  return { rules, summary, overall };
}

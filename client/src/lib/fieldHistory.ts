// KMX EDC — 필드 입력 이력(서버 저장) 훅·유틸 (UI 비의존)
//
// FieldHistory.tsx(컴포넌트 파일)에서 분리 — Fast Refresh 보존 목적.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFieldHistory, recordFieldHistory } from "@/services";

/** 필드 키 → datalist id(영숫자/.-_ 외 문자는 '-'로 치환). */
export function fhId(key: string): string {
  return "fh-" + key.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

export function useFieldHistory(keys: string[]) {
  const qc = useQueryClient();
  // 키 집합이 같으면 동일 쿼리(정렬해 안정적 키 생성).
  const keyStr = [...keys].sort().join(",");
  const { data } = useQuery({
    queryKey: ["field-history", keyStr],
    queryFn: () => fetchFieldHistory(keys),
    enabled: keys.length > 0,
    staleTime: 60_000,
  });
  const record = (entries: { fieldKey: string; value: string }[]) => {
    recordFieldHistory(entries);
    // 다음 폼 오픈 시 방금 입력값이 제안에 보이도록 무효화.
    qc.invalidateQueries({ queryKey: ["field-history"] });
  };
  return {
    suggestions: (data ?? {}) as Record<string, string[]>,
    record,
  };
}

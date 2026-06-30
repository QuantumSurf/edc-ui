// 작성 폼 자동완성 인프라
// - useFieldHistory(keys): 서버 입력 이력 조회 + 제출 시 기록 함수 제공
// - HistoryDatalist: <datalist> 렌더(입력에 list={fhId(key)} 연결)
// - fhId: 필드 키 → 안전한 datalist id
//
// 사용 예:
//   const { suggestions, record } = useFieldHistory(["asset.baseUrl"]);
//   <input list={fhId("asset.baseUrl")} ... />
//   <HistoryDatalist id={fhId("asset.baseUrl")} options={suggestions["asset.baseUrl"]} />
//   // 제출 성공 후: record([{ fieldKey: "asset.baseUrl", value: baseUrl }])

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

/** 입력 이력 제안을 담는 <datalist>. 제안이 없으면 렌더하지 않는다. */
export function HistoryDatalist({
  id,
  options,
}: {
  id: string;
  options?: string[];
}) {
  if (!options || options.length === 0) return null;
  return (
    <datalist id={id}>
      {options.map(o => (
        <option key={o} value={o} />
      ))}
    </datalist>
  );
}

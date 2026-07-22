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

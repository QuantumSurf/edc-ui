// KMX EDC — 테이블 정렬 상태/유틸 (UI 비의존)
//
// ui-kmx.tsx(컴포넌트 파일)에서 분리 — 컴포넌트 파일이 훅/순수함수를 함께 export 하면
// React Fast Refresh 가 동작하지 않는다(react-refresh/only-export-components).

import * as React from "react";

export type SortDir = "asc" | "desc";

/** 컬럼 키/방향 상태 + 토글. 같은 키 재클릭 시 asc↔desc 전환. */
export function useTableSort(
  initialKey: string | null = null,
  initialDir: SortDir = "asc"
) {
  // 단일 상태 객체 — 순수 업데이터만 사용(StrictMode 이중 호출에도 안전).
  const [sort, setSort] = React.useState<{ key: string | null; dir: SortDir }>({
    key: initialKey,
    dir: initialDir,
  });
  const toggleSort = React.useCallback((key: string) => {
    setSort(s =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  }, []);
  return { sortKey: sort.key, sortDir: sort.dir, toggleSort };
}

/** accessor 로 추출한 값으로 정렬한 새 배열을 반환(숫자/날짜/문자 자동 처리, null 후순위). */
export function sortRows<T>(
  rows: T[],
  key: string | null,
  dir: SortDir,
  accessor: (row: T, key: string) => string | number | Date | null | undefined
): T[] {
  if (!key) return rows;
  const sign = dir === "asc" ? 1 : -1;
  const norm = (v: string | number | Date | null | undefined) =>
    v instanceof Date ? v.getTime() : v;
  return [...rows].sort((a, b) => {
    const va = norm(accessor(a, key));
    const vb = norm(accessor(b, key));
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number")
      return (va - vb) * sign;
    return (
      String(va).localeCompare(String(vb), undefined, { numeric: true }) * sign
    );
  });
}

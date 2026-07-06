// KMX EDC — 숫자 표시 포맷
// 사람이 읽는 수치(카운트·수량·용량·합계 등)에 천단위 구분 쉼표를 넣는다.
// 연도·ID·포트·버전 등 자리 구분이 무의미하거나 유해한 값에는 사용하지 않는다.

/** 정수/실수를 천단위 쉼표로: 1234567 → "1,234,567". null/NaN 은 "—". */
export function fmtNum(n: number | null | undefined): string {
  if (n == null || (typeof n === "number" && Number.isNaN(n))) return "—";
  // ko/en 모두 천단위 구분자가 쉼표라 로케일 고정(결정적 출력).
  return n.toLocaleString("en-US");
}

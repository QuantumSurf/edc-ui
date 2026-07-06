// KMX EDC — 표시용 날짜/시각 포맷
// 감사로그를 제외한 모든 시각 표기는 이 함수로 "YYYY-MM-DD HH:mm:ss"(KST) 로 통일한다.
// (sv-SE 로케일이 ISO 유사 포맷을 주므로 timeZone·24시간·초 옵션과 함께 사용.)

const DISPLAY_TZ = "Asia/Seoul";

/** ISO/epoch/Date → "2026-06-27 14:44:30" (KST). 값이 없거나 잘못되면 "—" 또는 원문 반환. */
export function fmtDateTime(
  input: string | number | Date | null | undefined
): string {
  if (input == null || input === "") return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return typeof input === "string" ? input : "—";
  return d.toLocaleString("sv-SE", {
    timeZone: DISPLAY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

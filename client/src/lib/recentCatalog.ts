// 카탈로그 브라우저 "최근 조회" 기록 — 수동 입력한 외부 커넥터를 재선택하기 위해
// localStorage에 보관한다. url+counterPartyId 기준 dedupe, 최신 우선, 최대 5건.

// 저장 키 — cross-tab 동기화(storage 이벤트 구독)를 위해 PageCatalog 에서 import 해 사용한다.
export const RECENT_KEY = "kmx.catalog.recent";
const KEY = RECENT_KEY;
const MAX = 5;

export interface RecentCatalogEntry {
  url: string;
  counterPartyId: string;
}

export function getRecent(): RecentCatalogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentCatalogEntry =>
          e && typeof e.url === "string" && typeof e.counterPartyId === "string"
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

/** 조회 성공 시 호출. 동일 (url, counterPartyId)는 맨 앞으로 끌어올리고 최대 MAX건 유지. 갱신된 목록을 반환. */
export function addRecent(entry: RecentCatalogEntry): RecentCatalogEntry[] {
  const url = entry.url.trim();
  const counterPartyId = entry.counterPartyId.trim();
  if (!url || !counterPartyId) return getRecent();
  const next = [
    { url, counterPartyId },
    ...getRecent().filter(
      e => !(e.url === url && e.counterPartyId === counterPartyId)
    ),
  ].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* localStorage 불가(사생활 모드 등) — 무시 */
  }
  return next;
}

/** 특정 (url, counterPartyId) 항목을 최근 목록에서 제거. 갱신된 목록을 반환. */
export function removeRecent(entry: RecentCatalogEntry): RecentCatalogEntry[] {
  const next = getRecent().filter(
    e => !(e.url === entry.url && e.counterPartyId === entry.counterPartyId)
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* localStorage 불가 — 무시 */
  }
  return next;
}

// KMX EDC — 알림 환경설정(localStorage) 공유 유틸
//
// PageSettings(토글 UI)와 NotificationPanel·useNotifications(source별 알림 필터)가 같은 prefs를
// 읽고 쓴다. 과거 이 헬퍼가 PageSettings.tsx 안에 있어, NotificationPanel/useNotifications가
// PageSettings를 정적 import → route 코드 스플리팅에서 PageSettings 청크가 분리되지 못했다.
// 작은 util로 분리해 PageSettings도 완전 lazy 로드되게 한다.

export const NOTIFY_PREFS_KEY = "kmx-notify-prefs";

export function readPref(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(NOTIFY_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return typeof parsed[key] === "boolean" ? parsed[key] : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: boolean): void {
  try {
    const raw = localStorage.getItem(NOTIFY_PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    parsed[key] = value;
    localStorage.setItem(NOTIFY_PREFS_KEY, JSON.stringify(parsed));
  } catch {
    /* storage may be unavailable */
  }
}

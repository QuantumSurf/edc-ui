// 대량 전송 진행률 표시용 포매터(순수·로케일 중립 단위). ETA 문구는 i18n 에서 조립.

/** 바이트 → "1.20 GB" 형식(base-1024, KB/MB/GB/TB). 음수/미상은 "—". */
export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

/** 속도(B/s) → "1.31 MB/s". 0 이하/미상은 "—". */
export function formatSpeed(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return "—";
  return `${formatBytes(bps)}/s`;
}

/** 남은 초 → {h,m,s}. 음수/미상은 null. */
export function etaParts(
  sec: number | null | undefined
): { h: number; m: number; s: number } | null {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return null;
  const t = Math.round(sec);
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

/** 전송량/총량 → 0~100(%) 또는 null(총량 미상). */
export function percent(
  transferred: number,
  total: number | null | undefined
): number | null {
  if (total == null || !Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, (transferred / total) * 100));
}

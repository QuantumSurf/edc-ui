// 동적 import(lazy 라우트 청크) 로드 실패 시 가드된 자동 복구.
//
// 배포/HMR 로 청크 해시가 바뀌면, 이미 열려 있던 탭은 옛 해시의 청크를 요청해
// "Failed to fetch dynamically imported module" 로 실패한다(코드 결함 아님 — 낡은 탭).
// dev 에서는 Vite 의존성 재최적화 중 옛 dep 청크가 504(Outdated Optimize Dep)로
// 떨어지는 같은 부류의 실패도 있다. 이때 흰 화면/에러 대신 새로고침해 새 청크를 받는다.
//
// 가드(무한 새로고침 방지): 60초 창 안에서 최대 2회까지만 자동 새로고침한다.
//  - 1회로 제한하면 dev 재최적화가 끝나기 전(수 초)에 두 번째 실패가 나는 순간
//    바로 에러 화면으로 떨어진다 → 2회 + 새로고침 전 짧은 지연(재최적화 완료 틈)으로 완화.
//  - 창 안에서 그 이상 실패하면(=진짜 깨진 모듈) 에러를 그대로 던져 ErrorBoundary 가 잡는다.
// 상태는 sessionStorage(탭 단위)에 남는다.

const RELOAD_GUARD_KEY = "kmx-chunk-reload-guard";
const RELOAD_WINDOW_MS = 60_000;
const MAX_RELOADS_PER_WINDOW = 2;
// 새로고침 전 지연 — dev 의 Vite 재최적화(수백 ms~수 초)가 끝날 틈을 준다.
const RELOAD_DELAY_MS = 600;

/** 청크 네트워크 로드 실패인지(모듈 평가 중 throw 된 실제 버그와 구분). */
function isChunkLoadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message || "";
  return (
    /dynamically imported module/i.test(m) || // Chrome/Firefox
    /error loading dynamically imported module/i.test(m) ||
    /importing a module script failed/i.test(m) || // Safari
    /failed to fetch/i.test(m)
  );
}

/**
 * 가드를 확인·증가시키고, 허용되면 지연 새로고침을 예약한 뒤 true.
 * 창 내 허용 횟수를 넘겼으면(또는 sessionStorage 불가) false — 호출자가 에러를 던진다.
 * 동기 판정이라 이벤트 핸들러(vite:preloadError 의 preventDefault)에서도 쓸 수 있다.
 */
function scheduleGuardedReload(): boolean {
  try {
    const now = Date.now();
    let count = 0;
    let windowStart = now;
    const raw = sessionStorage.getItem(RELOAD_GUARD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        count?: number;
        windowStart?: number;
      };
      if (
        typeof parsed.windowStart === "number" &&
        now - parsed.windowStart < RELOAD_WINDOW_MS
      ) {
        count = parsed.count ?? 0;
        windowStart = parsed.windowStart;
      }
    }
    if (count >= MAX_RELOADS_PER_WINDOW) return false;
    sessionStorage.setItem(
      RELOAD_GUARD_KEY,
      JSON.stringify({ count: count + 1, windowStart })
    );
    window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    return true;
  } catch {
    // sessionStorage 불가(프라이빗 모드 등) — 안전하게 재시도하지 않는다.
    return false;
  }
}

/**
 * `lazy(() => import(...))` 의 팩토리를 감싼다. 청크 로드가 실패하면 가드된
 * 새로고침으로 복구하고, 허용 초과면 원래 에러를 던진다(ErrorBoundary 로 위임).
 * 제네릭 T 로 모듈 네임스페이스 타입을 그대로 보존하므로 lazy 의 추론이 깨지지 않는다.
 */
export function reloadableImport<T>(
  factory: () => Promise<T>
): () => Promise<T> {
  return async () => {
    try {
      return await factory();
    } catch (err) {
      if (isChunkLoadError(err) && scheduleGuardedReload()) {
        // 새로고침 예약됨 — 트리가 곧 교체되므로 영원히 pending 인 promise 를 준다
        // (Suspense 는 그동안 폴백을 유지).
        return new Promise<T>(() => {});
      }
      throw err;
    }
  };
}

/**
 * Vite 가 modulepreload 실패 시 발생시키는 `vite:preloadError` 를 받아 같은 가드된
 * 새로고침으로 복구한다(운영 빌드에서 lazy import 의 preload 링크가 먼저 깨지는 경우).
 * main.tsx 에서 앱 렌더 전에 1회 호출.
 */
export function installChunkReloadHandler(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", event => {
    // 새로고침이 예약되면 기본 동작(throw)을 막는다. 허용 초과면 막지 않아
    // Vite 가 에러를 던지고 ErrorBoundary 가 처리하게 둔다.
    if (scheduleGuardedReload()) event.preventDefault();
  });
}

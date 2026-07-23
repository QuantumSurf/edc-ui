// 동적 import(lazy 라우트 청크) 로드 실패 시 1회 자동 복구.
//
// 배포/HMR 로 청크 해시가 바뀌면, 이미 열려 있던 탭은 옛 해시의 청크를 요청해
// "Failed to fetch dynamically imported module" 로 실패한다(코드 결함 아님 — 낡은 탭).
// 이때 흰 화면/에러 대신 한 번만 새로고침해 새 청크를 받게 한다.
//
// 무한 새로고침 방지: 마지막 새로고침 시각을 sessionStorage 에 남겨, 쿨다운 안에
// 또 실패하면(=진짜 깨진 모듈) 새로고침하지 않고 에러를 그대로 던져 ErrorBoundary 가
// 잡게 한다.

const RELOAD_GUARD_KEY = "kmx-chunk-reload-at";
const RELOAD_COOLDOWN_MS = 10_000;

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

/** 쿨다운을 넘겼으면 새로고침하고 true, 방금 새로고침했으면(=재발) false. */
function tryReloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || "0");
    const now = Date.now();
    if (now - last > RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
      window.location.reload();
      return true;
    }
  } catch {
    // sessionStorage 불가(프라이빗 모드 등) — 안전하게 재시도하지 않는다.
  }
  return false;
}

/**
 * `lazy(() => import(...))` 의 팩토리를 감싼다. 청크 로드가 실패하면 가드된 1회
 * 새로고침으로 복구하고, 재발이면 원래 에러를 던진다(ErrorBoundary 로 위임).
 * 제네릭 T 로 모듈 네임스페이스 타입을 그대로 보존하므로 lazy 의 추론이 깨지지 않는다.
 */
export function reloadableImport<T>(
  factory: () => Promise<T>
): () => Promise<T> {
  return async () => {
    try {
      return await factory();
    } catch (err) {
      if (isChunkLoadError(err) && tryReloadOnce()) {
        // 새로고침 진행 중 — 트리가 곧 교체되므로 영원히 pending 인 promise 를 준다
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
    // 새로고침에 성공하면 기본 동작(throw)을 막는다. 재발(쿨다운 내)이면 막지 않아
    // Vite 가 에러를 던지고 ErrorBoundary 가 처리하게 둔다.
    if (tryReloadOnce()) event.preventDefault();
  });
}

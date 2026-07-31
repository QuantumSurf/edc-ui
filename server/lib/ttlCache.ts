// KMX EDC — 짧은 TTL 인메모리 캐시
// 팬아웃 집계(커넥터당 3~4 outbound)처럼 비싼 read 응답을, 사이드바·대시보드의 잦은 폴링에서
// 재사용해 뒤단 EDC 커넥터 부하와 tail 지연(p99)을 줄인다. 테넌트 단위 키.

export function createTtlCache<T>(ttlMs: number) {
  const store = new Map<string, { at: number; value: T }>();
  return {
    get(key: string): T | undefined {
      const hit = store.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;
      return undefined;
    },
    set(key: string, value: T): void {
      store.set(key, { at: Date.now(), value });
      // 무한 증가 방지 — 만료분 정리(테넌트 수만큼이라 실무상 소규모).
      if (store.size > 500) {
        const now = Date.now();
        for (const [k, v] of store) if (now - v.at >= ttlMs) store.delete(k);
      }
    },
    // 뮤테이션(커넥터 등록/수정/삭제) 후 전체 무효화 — 뮤테이션은 드물어 통삭제로 충분.
    clear(): void {
      store.clear();
    },
  };
}

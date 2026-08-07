// KMX EDC — 짧은 TTL 인메모리 캐시
// 팬아웃 집계(커넥터당 3~4 outbound)처럼 비싼 read 응답을, 사이드바·대시보드의 잦은 폴링에서
// 재사용해 뒤단 EDC 커넥터 부하와 tail 지연(p99)을 줄인다. 테넌트 단위 키.

export function createTtlCache<T>(
  ttlMs: number,
  opts?: { maxStaleMs?: number }
) {
  // TTL 이 지나도 이 나이까지는 낡은 값을 즉시 돌려주고 갱신은 뒤에서 돌린다(SWR).
  // 이 상한을 넘으면 낡은 값을 버리고 계산이 끝날 때까지 기다린다(무한 stale 방지).
  const maxStaleMs = opts?.maxStaleMs ?? ttlMs * 12;
  const store = new Map<string, { at: number; value: T }>();
  // 키별 진행 중 계산(단일 비행). TTL 만료 순간 동시 요청이 전부 미스로 떨어져 각자 팬아웃을
  // 여는 캐시 스탬피드를 막는다.
  const inflight = new Map<string, Promise<T>>();
  const cache = {
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
    /**
     * 캐시 히트면 즉시, 미스면 compute 를 **키당 1회만** 실행하고 나머지 동시 요청은 그 결과를
     * 함께 기다린다(single-flight).
     *
     * 이게 없으면: TTL 5초가 만료되는 순간 그 시점의 모든 동시 요청이 미스가 되어 각자 커넥터
     * 팬아웃(커넥터당 3~4 outbound)을 연다. 커넥터 하나가 응답하지 않으면 각 팬아웃이 타임아웃
     * (3~5초)까지 소켓과 이벤트루프를 붙잡고, 그 사이 도착한 요청이 또 미스로 쌓여 pg 풀
     * (max 20, 획득 타임아웃 5초)까지 고갈된다 → 해당 커넥터와 무관한 /api 전체가 503.
     * 실측(50 VU, 도달불가 커넥터 1개): 처리량 248→81 req/s, p95 32ms→3.01s, 부하 종료 후에도
     * 풀이 회복되지 않음.
     *
     * compute 가 reject 하면 대기 중인 모든 호출자에게 같은 오류가 전파되고(어차피 같이 실패할
     * 요청들), in-flight 기록은 해제돼 다음 요청이 재시도한다. 실패는 캐시하지 않는다.
     */
    async getOrCompute(key: string, compute: () => Promise<T>): Promise<T> {
      const entry = store.get(key);
      const age = entry ? Date.now() - entry.at : Infinity;
      if (entry && age < ttlMs) return entry.value; // 신선 → 즉시

      const refresh = (): Promise<T> => {
        const pending = inflight.get(key);
        if (pending) return pending;
        const p = compute()
          .then(value => {
            cache.set(key, value);
            return value;
          })
          .finally(() => {
            inflight.delete(key);
          });
        inflight.set(key, p);
        return p;
      };

      // stale-while-revalidate — TTL 은 지났지만 maxStaleMs 안이면 낡은 값을 즉시 주고 갱신은
      // 뒤에서 돌린다. 이게 없으면 커넥터 하나가 죽었을 때 TTL 만료 때마다 그 시점의 모든 요청이
      // 팬아웃 타임아웃(3~5초)을 함께 기다린다(single-flight 는 중복 팬아웃만 막지, 대기 자체는
      // 못 없앤다). 실측(50 VU, 도달불가 커넥터 1개): SWR 없이 p95 4.26s → SWR 로 정상 복귀.
      // 갱신 실패는 삼킨다(대기자 없음) — 낡은 값을 유지하다 maxStaleMs 초과 시 블로킹 재계산.
      if (entry && age < maxStaleMs) {
        void refresh().catch(() => {});
        return entry.value;
      }
      return refresh();
    },
    // 뮤테이션(커넥터 등록/수정/삭제) 후 전체 무효화 — 뮤테이션은 드물어 통삭제로 충분.
    // 진행 중 계산은 취소하지 않는다(그 결과는 낡을 수 있으나 다음 요청이 곧 갱신한다).
    clear(): void {
      store.clear();
    },
  };
  return cache;
}

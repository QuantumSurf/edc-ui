// KMX EDC — 동시성 상한 유틸 (fan-out DoS 방어)
//
// 커넥터 수가 큰 테넌트에서 단일 요청(GET /api/connectors, /api/fleet/kpi)이
// 커넥터당 3~4개의 무제한 병렬 outbound axios 호출을 한꺼번에 열어 BFF 의 소켓/FD/
// 이벤트루프를 고갈시키는 증폭(self-DoS)을 방지한다. 입력 순서를 보존해 결과를 반환.

/** 동시성 상한을 둔 map — 입력 순서 보존. fn 이 throw 하면 전체가 reject 되므로,
 *  부분 장애를 견뎌야 하는 호출부는 fn 내부에서 try/catch 로 폴백을 반환해야 한다. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        results[i] = await fn(items[i], i);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/** 커넥터 fan-out(상태/KPI 집계) 동시성 상한. 환경변수로 조정 가능. */
export const FLEET_FANOUT_CONCURRENCY = Number(
  process.env.FLEET_FANOUT_CONCURRENCY ?? 8
);

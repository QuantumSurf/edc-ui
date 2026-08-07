// KMX EDC — TTL 캐시 단일 비행(single-flight) 회귀테스트
//
// 캐시 스탬피드가 재발하면 커넥터 1개가 응답하지 않을 때 BFF 전체가 무너진다(pg 풀 고갈).
// 실측(50 VU, 도달불가 커넥터 1개): 처리량 248→81 req/s, p95 32ms→3.01s, 부하 후 미회복.
// 그 조건을 코드 레벨로 고정한다 — 동시 미스는 compute 를 단 1회만 실행해야 한다.

import { describe, it, expect, vi } from "vitest";
import { createTtlCache } from "./ttlCache.js";

const tick = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("createTtlCache — 단일 비행", () => {
  it("동시 미스 50건이 compute 를 1회만 호출하고 모두 같은 값을 받는다", async () => {
    const cache = createTtlCache<number>(5000);
    const compute = vi.fn(async () => {
      await tick(30); // 팬아웃 지연 모사
      return 42;
    });

    const results = await Promise.all(
      Array.from({ length: 50 }, () => cache.getOrCompute("t1", compute))
    );

    expect(compute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(50);
    expect(new Set(results)).toEqual(new Set([42]));
  });

  it("키가 다르면 각각 계산한다(테넌트 격리)", async () => {
    const cache = createTtlCache<string>(5000);
    const compute = vi.fn(async (v: string) => {
      await tick(10);
      return v;
    });
    const [a, b] = await Promise.all([
      cache.getOrCompute("tenant-a", () => compute("a")),
      cache.getOrCompute("tenant-b", () => compute("b")),
    ]);
    expect(compute).toHaveBeenCalledTimes(2);
    expect([a, b]).toEqual(["a", "b"]);
  });

  it("계산이 끝나면 TTL 동안 캐시에서 나간다(compute 재실행 없음)", async () => {
    const cache = createTtlCache<number>(5000);
    const compute = vi.fn(async () => 7);
    expect(await cache.getOrCompute("k", compute)).toBe(7);
    expect(await cache.getOrCompute("k", compute)).toBe(7);
    expect(cache.get("k")).toBe(7);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("TTL 만료 후에는 다시 계산한다", async () => {
    const cache = createTtlCache<number>(20);
    const compute = vi.fn(async () => 1);
    await cache.getOrCompute("k", compute);
    await tick(35);
    await cache.getOrCompute("k", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("TTL 만료분은 기다리지 않고 낡은 값을 즉시 주고 뒤에서 갱신한다(SWR)", async () => {
    let n = 0;
    const cache = createTtlCache<number>(20, { maxStaleMs: 10_000 });
    const compute = vi.fn(async () => {
      await tick(120); // 죽은 커넥터의 팬아웃 타임아웃 모사
      return ++n;
    });

    expect(await cache.getOrCompute("k", compute)).toBe(1); // 최초는 블로킹
    await tick(35); // TTL 경과

    // 낡았지만 즉시 반환되어야 한다 — compute 지연(120ms)을 기다리면 안 된다.
    const t0 = Date.now();
    expect(await cache.getOrCompute("k", compute)).toBe(1);
    expect(Date.now() - t0).toBeLessThan(60);

    await tick(160); // 백그라운드 갱신 완료
    expect(await cache.getOrCompute("k", compute)).toBe(2);
  });

  it("maxStaleMs 를 넘긴 값은 버리고 새로 계산할 때까지 기다린다", async () => {
    const cache = createTtlCache<number>(10, { maxStaleMs: 30 });
    const compute = vi.fn(async () => 1);
    await cache.getOrCompute("k", compute);
    await tick(60); // maxStaleMs 초과
    const fresh = vi.fn(async () => 99);
    expect(await cache.getOrCompute("k", fresh)).toBe(99);
  });

  it("SWR 백그라운드 갱신이 실패해도 낡은 값 서빙은 계속된다", async () => {
    const cache = createTtlCache<number>(20, { maxStaleMs: 10_000 });
    expect(await cache.getOrCompute("k", async () => 5)).toBe(5);
    await tick(35);
    const boom = vi.fn(async () => {
      throw new Error("connector down");
    });
    expect(await cache.getOrCompute("k", boom)).toBe(5);
    await tick(20);
    expect(await cache.getOrCompute("k", boom)).toBe(5);
  });

  it("compute 실패는 캐시하지 않고, 대기 중인 동시 호출 모두에 전파된다", async () => {
    const cache = createTtlCache<number>(5000);
    const boom = vi.fn(async () => {
      await tick(10);
      throw new Error("fan-out failed");
    });

    const settled = await Promise.allSettled([
      cache.getOrCompute("k", boom),
      cache.getOrCompute("k", boom),
      cache.getOrCompute("k", boom),
    ]);
    expect(settled.every(s => s.status === "rejected")).toBe(true);
    expect(boom).toHaveBeenCalledTimes(1);
    expect(cache.get("k")).toBeUndefined();

    // in-flight 기록이 해제돼 다음 요청이 재시도할 수 있어야 한다(영구 실패 고착 방지).
    const ok = vi.fn(async () => 9);
    expect(await cache.getOrCompute("k", ok)).toBe(9);
  });

  it("clear 후에는 새로 계산한다(뮤테이션 무효화)", async () => {
    const cache = createTtlCache<number>(5000);
    const compute = vi.fn(async () => 3);
    await cache.getOrCompute("k", compute);
    cache.clear();
    await cache.getOrCompute("k", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

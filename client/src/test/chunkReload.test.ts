// reloadableImport 가드 로직 회귀 고정.
// - 청크 로드 실패 → 짧은 지연(600ms) 후 새로고침, 그 사이 promise 는 pending 유지
// - 60초 창 안 최대 2회까지 허용(두 번째 실패 = dev Vite 재최적화 중 재발 케이스)
// - 창 안 3회째 → 새로고침 안 하고 원래 에러를 던짐(ErrorBoundary 위임)
// - 창(60초) 경과 후엔 카운터가 리셋되어 다시 복구 가능
// - 청크 에러가 아닌 실제 예외 → 새로고침 안 하고 던짐 / 정상 → 모듈 반환
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reloadableImport } from "@/lib/chunkReload";

const GUARD_KEY = "kmx-chunk-reload-guard";
const CHUNK_ERR = new Error(
  "Failed to fetch dynamically imported module: http://x/PagePolicy.js"
);

/** promise 가 pending 인지 — 마이크로태스크 몇 번을 돌려도 값이 안 나오면 pending. */
async function isPending(p: Promise<unknown>): Promise<boolean> {
  const settled = vi.fn();
  p.then(settled, settled);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return !settled.mock.calls.length;
}

describe("reloadableImport — 청크 로드 실패 자동 복구", () => {
  let reloadSpy: ReturnType<typeof vi.fn>;
  const realLocation = window.location;

  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    reloadSpy = vi.fn();
    // jsdom 의 location.reload 는 재정의 불가 → location 자체를 최소 스텁으로 교체.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload: reloadSpy } as unknown as Location,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: realLocation,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("청크 실패 1회 → 600ms 지연 후 새로고침, promise 는 pending", async () => {
    const factory = vi.fn().mockRejectedValueOnce(CHUNK_ERR);
    const p = reloadableImport(factory)();

    expect(await isPending(p)).toBe(true);
    // 지연 전에는 새로고침하지 않는다(재최적화 완료 틈 확보).
    expect(reloadSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(GUARD_KEY)!)).toEqual({
      count: 1,
      windowStart: 1_000_000,
    });
  });

  it("60초 창 안 2회째 실패도 복구 허용(count=2)", async () => {
    sessionStorage.setItem(
      GUARD_KEY,
      JSON.stringify({ count: 1, windowStart: 1_000_000 })
    );
    vi.setSystemTime(1_005_000); // 5초 뒤 재발(dev 재최적화 중)
    const p = reloadableImport(vi.fn().mockRejectedValue(CHUNK_ERR))();

    expect(await isPending(p)).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(GUARD_KEY)!).count).toBe(2);
  });

  it("창 안 3회째 → 새로고침 안 하고 원래 에러를 던짐", async () => {
    sessionStorage.setItem(
      GUARD_KEY,
      JSON.stringify({ count: 2, windowStart: 1_000_000 })
    );
    vi.setSystemTime(1_010_000);
    const factory = vi.fn().mockRejectedValue(CHUNK_ERR);

    await expect(reloadableImport(factory)()).rejects.toBe(CHUNK_ERR);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("창(60초) 경과 후엔 카운터 리셋 — 다시 복구", async () => {
    sessionStorage.setItem(
      GUARD_KEY,
      JSON.stringify({ count: 2, windowStart: 1_000_000 })
    );
    vi.setSystemTime(1_000_000 + 61_000); // 창 밖
    const p = reloadableImport(vi.fn().mockRejectedValue(CHUNK_ERR))();

    expect(await isPending(p)).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(GUARD_KEY)!)).toEqual({
      count: 1,
      windowStart: 1_000_000 + 61_000,
    });
  });

  it("청크 에러가 아니면 새로고침 안 하고 그대로 던짐", async () => {
    const boom = new Error("boom: 실제 런타임 버그");
    const factory = vi.fn().mockRejectedValue(boom);

    await expect(reloadableImport(factory)()).rejects.toBe(boom);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("정상 로드는 모듈을 그대로 반환", async () => {
    const mod = { default: () => null };
    const factory = vi.fn().mockResolvedValue(mod);

    await expect(reloadableImport(factory)()).resolves.toBe(mod);
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});

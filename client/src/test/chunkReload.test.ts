// reloadableImport 가드 로직 회귀 고정.
// - 청크 로드 실패 1회 → 1회 새로고침(그 사이 promise 는 pending 유지)
// - 쿨다운 내 재발 → 새로고침 안 하고 원래 에러를 던짐(ErrorBoundary 위임)
// - 청크 에러가 아닌 실제 예외 → 새로고침 안 하고 던짐
// - 정상 → 그대로 모듈 반환
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reloadableImport } from "@/lib/chunkReload";

const CHUNK_ERR = new Error(
  "Failed to fetch dynamically imported module: http://x/PagePolicy.js"
);

/** pending 인지(값이 안 나오는지) 확인 — 새로고침 중엔 resolve/reject 하지 않아야 한다. */
function isPending(p: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    p.then(
      () => false,
      () => false
    ),
    new Promise<boolean>(r => setTimeout(() => r(true), 20)),
  ]);
}

describe("reloadableImport — 청크 로드 실패 자동 복구", () => {
  let reloadSpy: ReturnType<typeof vi.fn>;
  const realLocation = window.location;

  beforeEach(() => {
    sessionStorage.clear();
    reloadSpy = vi.fn();
    // jsdom 의 location.reload 는 재정의 불가 → location 자체를 최소 스텁으로 교체.
    // chunkReload 는 window.location.reload 만 쓰므로 reload 만 있으면 충분하다.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload: reloadSpy } as unknown as Location,
    });
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: realLocation,
    });
    vi.restoreAllMocks();
  });

  it("청크 실패 1회 → 새로고침 1회 + 가드 기록, promise 는 pending", async () => {
    const factory = vi.fn().mockRejectedValueOnce(CHUNK_ERR);
    const p = reloadableImport(factory)();

    expect(await isPending(p)).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("kmx-chunk-reload-at")).toBe("1000000");
  });

  it("쿨다운 내 재발 → 새로고침 안 함, 원래 에러를 던짐", async () => {
    // 방금(같은 시각) 새로고침한 것으로 표시 → 쿨다운 안.
    sessionStorage.setItem("kmx-chunk-reload-at", "1000000");
    const factory = vi.fn().mockRejectedValue(CHUNK_ERR);

    await expect(reloadableImport(factory)()).rejects.toBe(CHUNK_ERR);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("청크 에러가 아니면 새로고침 안 하고 그대로 던짐", async () => {
    const boom = new Error("boom: 실제 런타임 버그");
    const factory = vi.fn().mockRejectedValue(boom);

    await expect(reloadableImport(factory)()).rejects.toBe(boom);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("정상 로드는 모듈을 그대로 반환", async () => {
    const mod = { default: () => null };
    const factory = vi.fn().mockResolvedValue(mod);

    await expect(reloadableImport(factory)()).resolves.toBe(mod);
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});

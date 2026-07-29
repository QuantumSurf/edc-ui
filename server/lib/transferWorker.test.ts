import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import {
  startBulkTransfer,
  cancelBulkTransfer,
  subscribe,
  getSnapshot,
  computeSpeedSample,
  type Uploader,
  type SourceFile,
  type ProgressSnapshot,
} from "./transferWorker.js";

// 스트림을 소비하며 진행 바이트를 보고하는 페이크 업로더(S3 불필요).
function collectUploader(store: Array<{ key: string; size: number }> = []): {
  uploader: Uploader;
  store: typeof store;
} {
  const uploader: Uploader = {
    async upload(key, body, onBytes, signal) {
      let loaded = 0;
      for await (const chunk of body as AsyncIterable<Buffer>) {
        if (signal.aborted) throw new Error("aborted");
        loaded += chunk.length;
        onBytes(loaded);
      }
      store.push({ key, size: loaded });
    },
  };
  return { uploader, store };
}

// 취소 테스트용 — abort 전까지 영원히 대기하는 업로더.
const hangingUploader: Uploader = {
  upload(_key, _body, _onBytes, signal) {
    return new Promise<void>((_res, rej) => {
      if (signal.aborted) return rej(new Error("aborted"));
      signal.addEventListener("abort", () => rej(new Error("aborted")), {
        once: true,
      });
    });
  },
};

function sizedSource(name: string, size: number): SourceFile {
  return { name, size, open: async () => Readable.from(Buffer.alloc(size)) };
}
function unsizedSource(name: string, actual: number): SourceFile {
  return { name, open: async () => Readable.from(Buffer.alloc(actual)) };
}

function waitTerminal(cid: string, tid: string): Promise<ProgressSnapshot> {
  return new Promise(res => {
    const unsub = subscribe(cid, tid, s => {
      if (
        s.state === "COMPLETED" ||
        s.state === "FAILED" ||
        s.state === "CANCELED"
      ) {
        unsub();
        res(s);
      }
    });
  });
}

describe("transferWorker — 진행률/상태", () => {
  it("단일 파일(크기 알림) → 전송량=total, COMPLETED", async () => {
    const { uploader, store } = collectUploader();
    startBulkTransfer({
      connectorId: "c1",
      transferId: "single",
      files: [sizedSource("a.bin", 1000)],
      uploader,
    });
    const snap = await waitTerminal("c1", "single");
    expect(snap.state).toBe("COMPLETED");
    expect(snap.transferredBytes).toBe(1000);
    expect(snap.totalBytes).toBe(1000);
    expect(snap.fileCount).toBe(1);
    expect(snap.filesDone).toBe(1);
    expect(snap.currentFile).toBeNull();
    expect(store).toEqual([{ key: "a.bin", size: 1000 }]);
  });

  it("다수 파일 → filesDone 증가·집계 전송량", async () => {
    const { uploader } = collectUploader();
    startBulkTransfer({
      connectorId: "c1",
      transferId: "multi",
      files: [
        sizedSource("a", 100),
        sizedSource("b", 200),
        sizedSource("c", 300),
      ],
      uploader,
    });
    const snap = await waitTerminal("c1", "multi");
    expect(snap.state).toBe("COMPLETED");
    expect(snap.fileCount).toBe(3);
    expect(snap.filesDone).toBe(3);
    expect(snap.transferredBytes).toBe(600);
    expect(snap.totalBytes).toBe(600);
  });

  it("크기 미상 → totalBytes 는 완료 시 실제 전송량으로 확정", async () => {
    const { uploader } = collectUploader();
    startBulkTransfer({
      connectorId: "c1",
      transferId: "unsized",
      files: [unsizedSource("x", 150), unsizedSource("y", 250)],
      uploader,
    });
    const snap = await waitTerminal("c1", "unsized");
    expect(snap.state).toBe("COMPLETED");
    expect(snap.transferredBytes).toBe(400);
    expect(snap.totalBytes).toBe(400);
    expect(snap.filesDone).toBe(2);
  });

  it("취소 → CANCELED", async () => {
    startBulkTransfer({
      connectorId: "c1",
      transferId: "cancelme",
      files: [sizedSource("big", 10_000)],
      uploader: hangingUploader,
    });
    // 실행(RUNNING) 진입 대기.
    await new Promise(r => setTimeout(r, 20));
    expect(cancelBulkTransfer("c1", "cancelme")).toBe(true);
    const snap = await waitTerminal("c1", "cancelme");
    expect(snap.state).toBe("CANCELED");
  });

  it("동시 잡 상한 초과 시 throw", async () => {
    const ids = ["j1", "j2", "j3", "j4"];
    for (const id of ids) {
      startBulkTransfer({
        connectorId: "cap",
        transferId: id,
        files: [sizedSource("f", 999999)],
        uploader: hangingUploader,
      });
    }
    await new Promise(r => setTimeout(r, 20));
    expect(() =>
      startBulkTransfer({
        connectorId: "cap",
        transferId: "j5",
        files: [sizedSource("f", 1)],
        uploader: hangingUploader,
      })
    ).toThrow(/too many/i);
    // 정리 — 모두 취소.
    for (const id of ids) cancelBulkTransfer("cap", id);
    await Promise.all(ids.map(id => waitTerminal("cap", id)));
  });

  it("subscribe 는 즉시 현재 스냅샷을 전달한다", async () => {
    const { uploader } = collectUploader();
    startBulkTransfer({
      connectorId: "c1",
      transferId: "sub",
      files: [sizedSource("a", 100)],
      uploader,
    });
    const seen: string[] = [];
    const unsub = subscribe("c1", "sub", s => seen.push(s.state));
    await waitTerminal("c1", "sub");
    unsub();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe("COMPLETED");
    expect(getSnapshot("c1", "sub")?.state).toBe("COMPLETED");
  });

  it("바이트 상한 초과 → FAILED(사유 명시)", async () => {
    const prev = process.env.BULK_TRANSFER_MAX_BYTES;
    process.env.BULK_TRANSFER_MAX_BYTES = "50";
    try {
      const { uploader } = collectUploader();
      startBulkTransfer({
        connectorId: "cap-b",
        transferId: "over",
        // 크기 미상(사전차단 우회) → 런타임 그물이 상한 초과를 잡아야 한다.
        files: [unsizedSource("big", 100)],
        uploader,
      });
      const snap = await waitTerminal("cap-b", "over");
      expect(snap.state).toBe("FAILED");
      expect(snap.error).toMatch(/byte cap/i);
    } finally {
      if (prev === undefined) delete process.env.BULK_TRANSFER_MAX_BYTES;
      else process.env.BULK_TRANSFER_MAX_BYTES = prev;
    }
  });
});

describe("computeSpeedSample — 속도(EMA)·ETA", () => {
  it("첫 표본은 순간속도, ETA=남은/속도", () => {
    const r = computeSpeedSample({
      prevEma: null,
      prevBytes: 0,
      prevAtMs: 0,
      curBytes: 1000,
      nowMs: 1000,
      totalBytes: 2000,
    });
    expect(r.bytesPerSec).toBe(1000);
    expect(r.etaSec).toBe(1);
  });

  it("EMA 평활 적용", () => {
    const r = computeSpeedSample({
      prevEma: 1000,
      prevBytes: 1000,
      prevAtMs: 1000,
      curBytes: 1400,
      nowMs: 2000,
      totalBytes: 2000,
    });
    // inst=400, ema=0.35*400+0.65*1000=790
    expect(Math.round(r.bytesPerSec ?? 0)).toBe(790);
    expect(r.etaSec).toBe(1); // (2000-1400)/790 ≈ 0.76 → 1
  });

  it("dt<=0 이면 직전 속도 유지·ETA null", () => {
    const r = computeSpeedSample({
      prevEma: 500,
      prevBytes: 100,
      prevAtMs: 5000,
      curBytes: 200,
      nowMs: 5000,
      totalBytes: 1000,
    });
    expect(r.bytesPerSec).toBe(500);
    expect(r.etaSec).toBeNull();
  });

  it("총량 미상이면 ETA null", () => {
    const r = computeSpeedSample({
      prevEma: null,
      prevBytes: 0,
      prevAtMs: 0,
      curBytes: 500,
      nowMs: 1000,
      totalBytes: null,
    });
    expect(r.bytesPerSec).toBe(500);
    expect(r.etaSec).toBeNull();
  });
});

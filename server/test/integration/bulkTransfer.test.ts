// 대량전송 MinIO 통합 회귀테스트 — k6(읽기 램프)가 못 잡는 "스트리밍 정확성" 을 CI 로
// 잡는다. 워커 + createS3Uploader 로 실제 MinIO 에 멀티파트 스트리밍 업로드 후 HeadObject 로
// 객체 실적재를 검증하고, 다수 파일 집계·진행 중 취소를 확인한다.
// Docker/testcontainers 미가용 시 우아하게 skip(REQUIRE_INTEGRATION=1 이면 실패).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Readable } from "node:stream";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { HeadObjectCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { makeS3Client, type S3Target } from "../../lib/s3.js";
import {
  createResumableS3Uploader,
  type MultipartState,
  type MultipartStateStore,
} from "../../lib/resumableUploader.js";
import {
  startBulkTransfer,
  cancelBulkTransfer,
  createS3Uploader,
  subscribe,
  type ProgressSnapshot,
  type SourceFile,
} from "../../lib/transferWorker.js";

let container: StartedTestContainer | undefined;
let target: S3Target | undefined;
let ready = false;

function bufSource(name: string, size: number): SourceFile {
  return {
    name,
    size,
    open: async () =>
      Readable.from(
        (function* () {
          let sent = 0;
          const chunk = Buffer.alloc(1024 * 1024, 7);
          while (sent < size) {
            const n = Math.min(chunk.length, size - sent);
            sent += n;
            yield chunk.subarray(0, n);
          }
        })()
      ),
  };
}

// 청크마다 지연을 둬 업로드를 느리게 → 진행 중 취소가 가능하도록.
function slowSource(name: string, size: number, delayMs: number): SourceFile {
  return {
    name,
    size,
    open: async () =>
      Readable.from(
        (async function* () {
          let sent = 0;
          const chunk = Buffer.alloc(1024 * 1024, 3);
          while (sent < size) {
            const n = Math.min(chunk.length, size - sent);
            sent += n;
            yield chunk.subarray(0, n);
            await new Promise(r => setTimeout(r, delayMs));
          }
        })()
      ),
  };
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

beforeAll(async () => {
  try {
    container = await new GenericContainer("minio/minio")
      .withEnvironment({
        MINIO_ROOT_USER: "minio",
        MINIO_ROOT_PASSWORD: "minio12345",
      })
      .withCommand(["server", "/data"])
      .withExposedPorts(9000)
      .withWaitStrategy(
        Wait.forHttp("/minio/health/live", 9000).forStatusCode(200)
      )
      .start();
  } catch (err) {
    const msg = `[integration] Docker/MinIO 미가용: ${(err as Error).message}`;
    if (process.env.REQUIRE_INTEGRATION === "1") throw new Error(msg);
    console.warn(msg + " — 대량전송 MinIO 통합테스트 skip");
    return;
  }
  target = {
    bucket: "bulk-test",
    region: "us-east-1",
    endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
    accessKeyId: "minio",
    secretAccessKey: "minio12345",
    forcePathStyle: true,
  };
  await makeS3Client(target)
    .send(new CreateBucketCommand({ Bucket: target.bucket }))
    .catch(() => {});
  ready = true;
}, 120_000);

afterAll(async () => {
  if (container) await container.stop();
});

describe("대량전송 MinIO 통합 — 실 스트리밍", () => {
  it("단일 파일 → MinIO 실적재 + COMPLETED", async () => {
    if (!ready || !target) return;
    const SIZE = 12 * 1024 * 1024;
    startBulkTransfer({
      connectorId: "it",
      transferId: "single",
      files: [bufSource("big.bin", SIZE)],
      uploader: createS3Uploader(target),
    });
    const snap = await waitTerminal("it", "single");
    expect(snap.state).toBe("COMPLETED");
    expect(snap.transferredBytes).toBe(SIZE);
    expect(snap.totalBytes).toBe(SIZE);
    const head = await makeS3Client(target).send(
      new HeadObjectCommand({ Bucket: target.bucket, Key: "big.bin" })
    );
    expect(head.ContentLength).toBe(SIZE);
  }, 60_000);

  it("다수 파일 → 각 객체 적재 + filesDone 집계", async () => {
    if (!ready || !target) return;
    const s1 = 9 * 1024 * 1024;
    const s2 = 3 * 1024 * 1024;
    startBulkTransfer({
      connectorId: "it",
      transferId: "multi",
      files: [bufSource("m1.bin", s1), bufSource("m2.bin", s2)],
      uploader: createS3Uploader(target),
    });
    const snap = await waitTerminal("it", "multi");
    expect(snap.state).toBe("COMPLETED");
    expect(snap.filesDone).toBe(2);
    expect(snap.transferredBytes).toBe(s1 + s2);
    const c = makeS3Client(target);
    const h1 = await c.send(
      new HeadObjectCommand({ Bucket: target.bucket, Key: "m1.bin" })
    );
    const h2 = await c.send(
      new HeadObjectCommand({ Bucket: target.bucket, Key: "m2.bin" })
    );
    expect(h1.ContentLength).toBe(s1);
    expect(h2.ContentLength).toBe(s2);
  }, 60_000);

  it("진행 중 취소 → CANCELED", async () => {
    if (!ready || !target) return;
    startBulkTransfer({
      connectorId: "it",
      transferId: "cancel",
      files: [slowSource("slow.bin", 40 * 1024 * 1024, 60)],
      uploader: createS3Uploader(target),
    });
    await new Promise(r => setTimeout(r, 300));
    expect(cancelBulkTransfer("it", "cancel")).toBe(true);
    const snap = await waitTerminal("it", "cancel");
    expect(snap.state).toBe("CANCELED");
  }, 60_000);
});

// 인메모리 멀티파트 상태 저장소(재개 로직 자체 검증 — DB 불필요).
function memStore(): MultipartStateStore {
  const m = new Map<string, MultipartState>();
  return {
    load: async k => m.get(k) ?? null,
    save: async (k, s) => {
      m.set(k, structuredClone(s));
    },
    clear: async k => {
      m.delete(k);
    },
  };
}

// bytesBeforeThrow 만큼 보낸 뒤 에러를 던지는 소스(=크래시 시뮬레이션, 취소 아님).
function erroringSource(bytesBeforeThrow: number): Readable {
  return Readable.from(
    (async function* () {
      let sent = 0;
      const chunk = Buffer.alloc(1024 * 1024, 5);
      while (sent < bytesBeforeThrow) {
        yield chunk;
        sent += chunk.length;
      }
      throw new Error("simulated crash");
    })()
  );
}
function fullSource(size: number): Readable {
  return Readable.from(
    (function* () {
      let sent = 0;
      const chunk = Buffer.alloc(1024 * 1024, 5);
      while (sent < size) {
        const n = Math.min(chunk.length, size - sent);
        sent += n;
        yield chunk.subarray(0, n);
      }
    })()
  );
}

describe("대량전송 재개 — 크래시 후 ListParts 로 이어받기", () => {
  it("2파트 업로드 후 크래시 → 재개 시 남은 파트만 올려 완료", async () => {
    if (!ready || !target) return;
    const SIZE = 20 * 1024 * 1024; // 8MB 파트 → 2파트(16MB) + 잔여(4MB)
    const store = memStore();
    const noAbort = new AbortController();

    // 1차: 18MB 보낸 뒤 크래시(2파트=16MB 영속, 3파트 미완).
    const up1 = createResumableS3Uploader(target, store);
    await expect(
      up1.upload(
        "resume.bin",
        erroringSource(18 * 1024 * 1024),
        () => {},
        noAbort.signal
      )
    ).rejects.toThrow();
    const saved = await store.load("resume.bin");
    expect(saved).not.toBeNull();
    expect(saved!.parts.length).toBe(2); // 크래시라 상태 영속(취소 아님 → Abort 안 함)

    // 2차: 새 업로더가 저장 상태로 재개 → ListParts(2파트) 인식, 남은 4MB 올려 완료.
    const up2 = createResumableS3Uploader(target, store);
    let lastBytes = 0;
    await up2.upload(
      "resume.bin",
      fullSource(SIZE),
      b => (lastBytes = b),
      new AbortController().signal
    );
    expect(lastBytes).toBe(SIZE);
    expect(await store.load("resume.bin")).toBeNull(); // 완료 시 상태 정리

    const head = await makeS3Client(target).send(
      new HeadObjectCommand({ Bucket: target.bucket, Key: "resume.bin" })
    );
    expect(head.ContentLength).toBe(SIZE); // 재개로 조립된 객체가 정확한 크기
  }, 90_000);
});

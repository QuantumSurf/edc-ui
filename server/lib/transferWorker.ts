// KMX EDC — 대량 데이터 전송 워커 (source pull → S3/MinIO 스트리밍 업로드 + 실시간 진행률)
//
// 화이트보드 유즈케이스1: 콘솔측 워커가 소스(provider EDR 데이터플레인 등)에서 바이트를 pull
// 하여 MinIO(S3 호환)로 스트리밍 업로드한다. 바이트가 워커를 통과하므로 정확한 전송량·속도를
// 측정할 수 있다(@aws-sdk/lib-storage Upload 의 httpUploadProgress). 단일/다수 파일 모두 지원.
//
// 설계:
//  - 소스(SourceFile.open)와 업로더(Uploader)는 주입 가능 → S3 없이 진행률 수학 단위테스트.
//  - 진행 스냅샷은 1s 주기 타이머가 계산·방출(속도 EMA, ETA). 파트 콜백은 카운터만 갱신 →
//    파트(수 MB) 버스트와 무관하게 UI 갱신 cadence 를 1s 로 안정화(설계상 폴링과 동일 해상도).
//  - 취소는 AbortController 로 진행 중 업로드를 중단한다.
//  - 동시 잡 수 상한으로 워커/BFF 부하를 억제한다.

import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";
import { makeS3Client, type S3Target } from "./s3.js";

export type TransferState =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED";

export interface ProgressSnapshot {
  transferId: string;
  connectorId: string;
  state: TransferState;
  totalBytes: number | null; // 전체 총량(모든 파일 크기를 알 때만), 미상=null
  transferredBytes: number;
  fileCount: number;
  filesDone: number;
  currentFile: string | null;
  currentFileBytes: number;
  currentFileTotal: number | null;
  bytesPerSec: number | null; // EMA 평활 속도
  etaSec: number | null; // 남은 예상 초
  error?: string;
}

/** 전송할 소스 파일 1건 — name=목적지 오브젝트 키, size=알면 total/ETA 계산에 사용. */
export interface SourceFile {
  name: string;
  size?: number;
  open: () => Promise<Readable>;
}

/** 바이트 싱크 추상화(기본=S3). 테스트는 페이크 업로더로 진행률 수학만 검증한다. */
export interface Uploader {
  upload(
    key: string,
    body: Readable,
    onBytes: (loaded: number) => void,
    signal: AbortSignal
  ): Promise<void>;
}

export interface BulkTransferParams {
  connectorId: string;
  transferId: string;
  files: SourceFile[];
  uploader: Uploader;
  /** 스로틀된 스냅샷(≈1/s + 상태전이/종료 시) 수신 — DB 영속 등에 사용. */
  onProgress?: (snap: ProgressSnapshot) => void;
}

const SPEED_ALPHA = 0.35; // EMA 계수(높을수록 최근값 민감)
const MAX_ACTIVE_JOBS = Number(process.env.BULK_TRANSFER_MAX_JOBS ?? 4);

interface Job {
  key: string;
  snap: ProgressSnapshot;
  abort: AbortController;
  canceled: boolean;
  // 속도 계산용 직전 표본
  lastSampleBytes: number;
  lastSampleAt: number;
}

const jobs = new Map<string, Job>();
const subscribers = new Map<string, Set<(s: ProgressSnapshot) => void>>();

export function jobKey(connectorId: string, transferId: string): string {
  return `${connectorId}:${transferId}`;
}

export function getSnapshot(
  connectorId: string,
  transferId: string
): ProgressSnapshot | null {
  return jobs.get(jobKey(connectorId, transferId))?.snap ?? null;
}

export function activeJobCount(): number {
  let n = 0;
  for (const j of jobs.values())
    if (j.snap.state === "RUNNING" || j.snap.state === "PENDING") n++;
  return n;
}

/** 진행 스냅샷 구독(SSE). 즉시 현재 스냅샷을 1회 전달하고, 이후 갱신을 push 한다. */
export function subscribe(
  connectorId: string,
  transferId: string,
  fn: (s: ProgressSnapshot) => void
): () => void {
  const key = jobKey(connectorId, transferId);
  let set = subscribers.get(key);
  if (!set) {
    set = new Set();
    subscribers.set(key, set);
  }
  set.add(fn);
  const cur = jobs.get(key)?.snap;
  if (cur) {
    try {
      fn(cur);
    } catch {
      /* 구독자 오류 무시 */
    }
  }
  return () => {
    const s = subscribers.get(key);
    if (s) {
      s.delete(fn);
      if (s.size === 0) subscribers.delete(key);
    }
  };
}

function emit(job: Job, onProgress?: (s: ProgressSnapshot) => void): void {
  const snap = { ...job.snap };
  if (onProgress) {
    try {
      onProgress(snap);
    } catch {
      /* 영속 실패는 무시(진행 자체는 계속) */
    }
  }
  const set = subscribers.get(job.key);
  if (set) {
    for (const fn of set) {
      try {
        fn(snap);
      } catch {
        /* 구독자 오류 무시 */
      }
    }
  }
}

/** 민감정보(쿼리스트링·Bearer 토큰) 제거 후 짧은 오류 메시지. */
function sanitizeError(e: unknown): string {
  let msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  msg = msg
    .replace(/\?[^\s]*/g, "?…")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer …");
  return msg.slice(0, 300);
}

/** 속도(EMA)·ETA 계산 — 순수 함수(결정적 테스트용). dt<=0 이면 직전 속도 유지. */
export function computeSpeedSample(opts: {
  prevEma: number | null;
  prevBytes: number;
  prevAtMs: number;
  curBytes: number;
  nowMs: number;
  totalBytes: number | null;
}): { bytesPerSec: number | null; etaSec: number | null } {
  const dt = (opts.nowMs - opts.prevAtMs) / 1000;
  if (dt <= 0) return { bytesPerSec: opts.prevEma, etaSec: null };
  const inst = (opts.curBytes - opts.prevBytes) / dt;
  const ema =
    opts.prevEma == null
      ? inst
      : SPEED_ALPHA * inst + (1 - SPEED_ALPHA) * opts.prevEma;
  const speed = ema < 0 ? 0 : ema;
  let etaSec: number | null = null;
  if (opts.totalBytes != null && speed > 0) {
    const remain = opts.totalBytes - opts.curBytes;
    etaSec = remain > 0 ? Math.round(remain / speed) : 0;
  }
  return { bytesPerSec: speed, etaSec };
}

function computeSpeedEta(job: Job): void {
  const now = Date.now();
  const { bytesPerSec, etaSec } = computeSpeedSample({
    prevEma: job.snap.bytesPerSec,
    prevBytes: job.lastSampleBytes,
    prevAtMs: job.lastSampleAt,
    curBytes: job.snap.transferredBytes,
    nowMs: now,
    totalBytes: job.snap.totalBytes,
  });
  if (now > job.lastSampleAt) {
    job.snap.bytesPerSec = bytesPerSec;
    job.snap.etaSec = etaSec;
    job.lastSampleBytes = job.snap.transferredBytes;
    job.lastSampleAt = now;
  }
}

/**
 * 대량 전송 시작. 이미 같은 키의 잡이 실행 중이면 그 스냅샷을 반환한다(중복 시작 방지).
 * 동시 잡 상한 초과 시 Error("too many active transfers") throw.
 */
export function startBulkTransfer(
  params: BulkTransferParams
): ProgressSnapshot {
  const key = jobKey(params.connectorId, params.transferId);
  const existing = jobs.get(key);
  if (
    existing &&
    (existing.snap.state === "RUNNING" || existing.snap.state === "PENDING")
  ) {
    return existing.snap;
  }
  if (activeJobCount() >= MAX_ACTIVE_JOBS) {
    throw new Error("too many active transfers");
  }
  const allSized =
    params.files.length > 0 && params.files.every(f => f.size != null);
  const totalBytes = allSized
    ? params.files.reduce((a, f) => a + (f.size ?? 0), 0)
    : null;
  const job: Job = {
    key,
    abort: new AbortController(),
    canceled: false,
    lastSampleBytes: 0,
    lastSampleAt: Date.now(),
    snap: {
      transferId: params.transferId,
      connectorId: params.connectorId,
      state: "PENDING",
      totalBytes,
      transferredBytes: 0,
      fileCount: params.files.length,
      filesDone: 0,
      currentFile: null,
      currentFileBytes: 0,
      currentFileTotal: null,
      bytesPerSec: null,
      etaSec: null,
    },
  };
  jobs.set(key, job);
  // 비동기 실행(호출부는 즉시 초기 스냅샷을 받는다).
  void runJob(job, params);
  return job.snap;
}

async function runJob(job: Job, params: BulkTransferParams): Promise<void> {
  job.snap.state = "RUNNING";
  emit(job, params.onProgress);
  let doneBytes = 0;
  const tick = setInterval(() => {
    computeSpeedEta(job);
    emit(job, params.onProgress);
  }, 1000);
  tick.unref?.();
  try {
    for (let i = 0; i < params.files.length; i++) {
      if (job.canceled) throw new Error("canceled");
      const f = params.files[i];
      job.snap.currentFile = f.name;
      job.snap.currentFileTotal = f.size ?? null;
      job.snap.currentFileBytes = 0;
      const stream = await f.open();
      await params.uploader.upload(
        f.name,
        stream,
        loaded => {
          job.snap.currentFileBytes = loaded;
          job.snap.transferredBytes = doneBytes + loaded;
        },
        job.abort.signal
      );
      // 파일 크기가 미상이었으면 실제 전송량으로 확정.
      doneBytes += f.size ?? job.snap.currentFileBytes;
      job.snap.transferredBytes = doneBytes;
      job.snap.filesDone = i + 1;
    }
    job.snap.state = "COMPLETED";
    job.snap.currentFile = null;
    if (job.snap.totalBytes == null) job.snap.totalBytes = doneBytes;
    job.snap.etaSec = 0;
  } catch (e) {
    job.snap.state = job.canceled ? "CANCELED" : "FAILED";
    if (!job.canceled) job.snap.error = sanitizeError(e);
  } finally {
    clearInterval(tick);
    emit(job, params.onProgress);
    // 종료된 잡은 잠시 후 정리(재접속/최종 스냅샷 조회 여유).
    scheduleCleanup(job.key);
  }
}

const CLEANUP_DELAY_MS = 60_000;
function scheduleCleanup(key: string): void {
  const t = setTimeout(() => {
    const j = jobs.get(key);
    if (j && j.snap.state !== "RUNNING" && j.snap.state !== "PENDING") {
      jobs.delete(key);
    }
  }, CLEANUP_DELAY_MS);
  t.unref?.();
}

/** 진행 중 전송 취소. 존재하지 않거나 이미 종료면 false. */
export function cancelBulkTransfer(
  connectorId: string,
  transferId: string
): boolean {
  const job = jobs.get(jobKey(connectorId, transferId));
  if (!job || job.snap.state !== "RUNNING") return false;
  job.canceled = true;
  job.abort.abort();
  return true;
}

/** S3/MinIO 업로더(스트리밍 멀티파트, 백프레셔). partSize=부분 진행률 해상도. */
export function createS3Uploader(target: S3Target): Uploader {
  const client = makeS3Client(target);
  return {
    async upload(key, body, onBytes, signal) {
      const up = new Upload({
        client,
        params: { Bucket: target.bucket, Key: key, Body: body },
        partSize: 8 * 1024 * 1024,
        queueSize: 4,
      });
      const onAbort = (): void => {
        up.abort().catch(() => {});
      };
      signal.addEventListener("abort", onAbort, { once: true });
      up.on("httpUploadProgress", p => {
        if (typeof p.loaded === "number") onBytes(p.loaded);
      });
      try {
        await up.done();
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

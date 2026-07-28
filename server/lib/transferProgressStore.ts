// KMX EDC — 대량 전송 진행 스냅샷 영속(transfer_progress)
//
// 워커의 인메모리 이미터(subscribe)가 실시간 push 를 담당하고, 이 스토어는 최신 스냅샷을
// DB 에 남겨 (1) SSE 재접속 초기상태, (2) 폴백 폴링(GET /progress), (3) 타 레플리카/워커
// 종료 후 가시성을 제공한다. 자격(S3 키)은 저장하지 않는다(스냅샷에 없음).

import { getPool } from "./db.js";
import type { ProgressSnapshot } from "./transferWorker.js";

/** 스냅샷 UPSERT(≈1/s + 상태전이). started_at 은 최초 1회만 세팅(이후 보존). best-effort. */
export async function persistSnapshot(s: ProgressSnapshot): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO transfer_progress
         (transfer_id, connector_id, state, total_bytes, transferred_bytes, file_count,
          files_done, current_file, current_file_bytes, current_file_total, bytes_per_sec,
          eta_sec, error, started_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
               COALESCE(
                 (SELECT started_at FROM transfer_progress
                   WHERE transfer_id=$1 AND connector_id=$2),
                 NOW()),
               NOW())
       ON CONFLICT (transfer_id, connector_id) DO UPDATE SET
         state=EXCLUDED.state, total_bytes=EXCLUDED.total_bytes,
         transferred_bytes=EXCLUDED.transferred_bytes, file_count=EXCLUDED.file_count,
         files_done=EXCLUDED.files_done, current_file=EXCLUDED.current_file,
         current_file_bytes=EXCLUDED.current_file_bytes,
         current_file_total=EXCLUDED.current_file_total,
         bytes_per_sec=EXCLUDED.bytes_per_sec, eta_sec=EXCLUDED.eta_sec,
         error=EXCLUDED.error, updated_at=NOW()`,
      [
        s.transferId,
        s.connectorId,
        s.state,
        s.totalBytes,
        s.transferredBytes,
        s.fileCount,
        s.filesDone,
        s.currentFile,
        s.currentFileBytes,
        s.currentFileTotal,
        s.bytesPerSec,
        s.etaSec,
        s.error ?? null,
      ]
    );
  } catch (err) {
    console.error("[transferProgress] persist 실패:", (err as Error).message);
  }
}

/** 최신 스냅샷 조회(폴백 폴링/SSE 초기). 없으면 null. */
export async function readSnapshot(
  connectorId: string,
  transferId: string
): Promise<ProgressSnapshot | null> {
  const { rows } = await getPool().query(
    `SELECT * FROM transfer_progress WHERE transfer_id=$1 AND connector_id=$2`,
    [transferId, connectorId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    transferId: r.transfer_id,
    connectorId: r.connector_id,
    state: r.state,
    totalBytes: r.total_bytes != null ? Number(r.total_bytes) : null,
    transferredBytes: Number(r.transferred_bytes),
    fileCount: Number(r.file_count),
    filesDone: Number(r.files_done),
    currentFile: r.current_file ?? null,
    currentFileBytes: Number(r.current_file_bytes),
    currentFileTotal:
      r.current_file_total != null ? Number(r.current_file_total) : null,
    bytesPerSec: r.bytes_per_sec != null ? Number(r.bytes_per_sec) : null,
    etaSec: r.eta_sec != null ? Number(r.eta_sec) : null,
    error: r.error ?? undefined,
  };
}

// KMX EDC — 대량 전송 오케스트레이션(잡 플랜 영속 + 소스 재구성 + 시작 + 크래시 재개)
//
// 라우트(최초 시작)와 부팅 시 재개(resumePendingTransfers)가 공유한다. 잡 플랜(transfer_job)에는
// 재구성에 필요한 비밀 아닌 정보(파일 목록·objectName·S3 목적지)만 저장한다. S3 자격은 저장하지
// 않으므로 재개는 자격이 env 로 있을 때만 가능하다(요청별 dataSink 시크릿은 재기동 후 소실).

import type { Readable } from "node:stream";
import { getPool } from "./db.js";
import { getConnector } from "./connectorRegistry.js";
import { getEdcClient } from "./edcClient.js";
import { pullEdrData, evictEdrTokens } from "./edrRefresh.js";
import { assertEndpointPublic } from "../middleware/validation.js";
import { resolveS3Target, isS3TargetUsable, type S3Target } from "./s3.js";
import {
  createResumableS3Uploader,
  createDbMultipartStore,
} from "./resumableUploader.js";
import {
  startBulkTransfer,
  type SourceFile,
  type ProgressSnapshot,
} from "./transferWorker.js";
import { persistSnapshot } from "./transferProgressStore.js";
import { bulkTransfersTotal, bulkBytesTransferred } from "./metrics.js";

export interface JobPlanFile {
  path?: string; // EDR endpoint 하위 경로(없으면 루트)
  key: string; // 목적지 오브젝트 키
  size?: number;
}
export interface JobPlan {
  connectorId: string;
  transferId: string;
  files: JobPlanFile[];
  objectName?: string;
  // 비밀 아닌 목적지(자격은 저장 안 함).
  s3: {
    bucket: string;
    region: string;
    endpoint?: string;
    forcePathStyle?: boolean;
  };
}

// transfers.ts 의 appendProxyPath 와 동일(순수) — 순환 의존 회피용 로컬 사본.
function appendProxyPath(endpoint: string, path?: string): string | null {
  if (!path || !path.trim()) return endpoint;
  const rel = path.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rel) || rel.startsWith("//")) return null;
  return endpoint.replace(/\/+$/, "") + (rel.startsWith("/") ? rel : `/${rel}`);
}

export async function saveJobPlan(plan: JobPlan): Promise<void> {
  await getPool().query(
    `INSERT INTO transfer_job (transfer_id, connector_id, plan, status, updated_at)
     VALUES ($1,$2,$3,'RUNNING',NOW())
     ON CONFLICT (transfer_id, connector_id) DO UPDATE
       SET plan=EXCLUDED.plan, status='RUNNING', updated_at=NOW()`,
    [plan.transferId, plan.connectorId, JSON.stringify(plan)]
  );
}

export async function markJobDone(
  connectorId: string,
  transferId: string
): Promise<void> {
  await getPool().query(
    `UPDATE transfer_job SET status='DONE', updated_at=NOW()
      WHERE transfer_id=$1 AND connector_id=$2`,
    [transferId, connectorId]
  );
}

/**
 * 대량 전송이 COMPLETED 되면 EDC 전송을 완료 처리한다(수동 "완료 처리" 버튼과 동등, 단 데이터는
 * 이미 S3 로 옮겼으므로 재-fetch 는 생략). EDC terminate + EDR 토큰 정리 + completed_at/
 * user_completed=TRUE + size_bytes 기록 → UI 상태 배지가 '전송 완료'로 오버레이된다.
 */
async function completeEdcTransfer(
  client: ReturnType<typeof getEdcClient>,
  connectorId: string,
  transferId: string,
  bytes: number
): Promise<void> {
  try {
    await client.post(`/v3/transferprocesses/${transferId}/terminate`, {
      "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
      reason: "Completed by bulk transfer",
    });
  } catch {
    // terminate 실패(이미 종료/네트워크)해도 완료 마킹은 진행(수동 완료와 동일 정책).
  }
  void evictEdrTokens(connectorId, transferId).catch(() => {});
  try {
    await getPool().query(
      `INSERT INTO transfer_metadata (transfer_id, connector_id, completed_at, user_completed, size_bytes)
       VALUES ($1, $2, NOW(), TRUE, $3)
       ON CONFLICT (transfer_id, connector_id)
       DO UPDATE SET completed_at = NOW(), user_completed = TRUE,
                     size_bytes = COALESCE($3, transfer_metadata.size_bytes)`,
      [transferId, connectorId, bytes > 0 ? bytes : null]
    );
  } catch (e) {
    console.error(`[bulk] 완료 마킹 실패 ${transferId}:`, (e as Error).message);
  }
}

async function loadPendingJobPlans(): Promise<JobPlan[]> {
  const { rows } = await getPool().query(
    `SELECT plan FROM transfer_job WHERE status='RUNNING'`
  );
  return rows.map(r => r.plan as JobPlan);
}

async function buildSourceFiles(
  client: ReturnType<typeof getEdcClient>,
  connectorId: string,
  transferId: string,
  endpoint: string,
  edr: Record<string, unknown>,
  files: JobPlanFile[]
): Promise<SourceFile[] | { error: string }> {
  const out: SourceFile[] = [];
  for (const f of files) {
    const targetUrl = appendProxyPath(endpoint, f.path);
    if (targetUrl === null)
      return { error: "file.path must be a relative sub-path" };
    const ssrf = await assertEndpointPublic(targetUrl);
    if (ssrf) return { error: `Rejected EDR data endpoint: ${ssrf}` };
    out.push({
      name: f.key,
      size: typeof f.size === "number" && f.size >= 0 ? f.size : undefined,
      open: async () => {
        const r = await pullEdrData(
          client,
          connectorId,
          transferId,
          targetUrl,
          edr,
          {
            responseType: "stream",
            maxRedirects: 0,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          }
        );
        return r.data as Readable;
      },
    });
  }
  return out;
}

/**
 * 잡 플랜으로 대량 전송을 시작(또는 재개)한다. target 은 자격 포함(최초=dataSink/env, 재개=env).
 * 재개 시 resumable 업로더가 저장된 멀티파트 상태를 ListParts 로 재조정해 남은 파트만 올린다.
 */
export async function startBulkFromPlan(
  plan: JobPlan,
  target: S3Target
): Promise<{ snapshot?: ProgressSnapshot; error?: string; status?: number }> {
  const conn = await getConnector(plan.connectorId);
  if (!conn) return { error: "connector not found", status: 404 };
  const client = getEdcClient(conn.id, {
    managementUrl: conn.managementUrl,
    apiKey: conn.apiKey,
  });

  const edrRes = await client
    .get(`/v3/edrs/${plan.transferId}/dataaddress`)
    .catch(() => null);
  const edr = edrRes?.data as Record<string, unknown> | undefined;
  const endpoint = edr?.["endpoint"] as string | undefined;
  const token = edr?.["authorization"] as string | undefined;
  if (!edr || !endpoint || !token)
    return { error: "EDR not found or expired for this transfer", status: 404 };

  const built = await buildSourceFiles(
    client,
    plan.connectorId,
    plan.transferId,
    endpoint,
    edr,
    plan.files
  );
  if ("error" in built)
    return {
      error: built.error,
      status: /sub-path/.test(built.error) ? 400 : 502,
    };

  await saveJobPlan(plan);
  const uploader = createResumableS3Uploader(
    target,
    createDbMultipartStore(plan.connectorId, plan.transferId)
  );
  try {
    const snapshot = startBulkTransfer({
      connectorId: plan.connectorId,
      transferId: plan.transferId,
      files: built,
      uploader,
      onProgress: s => {
        void persistSnapshot(s);
        if (
          s.state === "COMPLETED" ||
          s.state === "FAILED" ||
          s.state === "CANCELED"
        ) {
          bulkTransfersTotal.inc({ state: s.state.toLowerCase() });
          bulkBytesTransferred.inc(s.transferredBytes);
          void markJobDone(plan.connectorId, plan.transferId);
          // 데이터가 실제로 다 옮겨졌으면 EDC 전송도 완료 처리 → 상태 배지 '전송 완료'.
          if (s.state === "COMPLETED")
            void completeEdcTransfer(
              client,
              plan.connectorId,
              plan.transferId,
              s.transferredBytes
            );
        }
      },
    });
    return { snapshot };
  } catch (e) {
    if (/too many/i.test((e as Error).message))
      return { error: "too many active transfers, retry later", status: 429 };
    throw e;
  }
}

/** 부팅 시 진행 중이던(RUNNING) 잡을 이어받는다. S3 자격은 env 필요. best-effort. */
export async function resumePendingTransfers(): Promise<void> {
  let plans: JobPlan[];
  try {
    plans = await loadPendingJobPlans();
  } catch (e) {
    console.error("[resume] 잡 플랜 로드 실패:", (e as Error).message);
    return;
  }
  if (plans.length === 0) return;
  console.log(`[resume] 진행 중 대량전송 ${plans.length}건 재개 시도`);
  for (const plan of plans) {
    // 재개용 목적지 — plan(비밀 아님) + env 자격.
    const target: S3Target = {
      bucket: plan.s3.bucket || process.env.S3_BUCKET || "",
      region: plan.s3.region || process.env.S3_REGION || "us-east-1",
      endpoint: plan.s3.endpoint || process.env.S3_ENDPOINT || undefined,
      forcePathStyle:
        plan.s3.forcePathStyle ??
        (process.env.S3_FORCE_PATH_STYLE === "true" || !!plan.s3.endpoint),
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    };
    if (!isS3TargetUsable(target)) {
      console.warn(
        `[resume] ${plan.transferId}: S3 자격(env) 없음 → 재개 불가, FAILED 처리`
      );
      await persistSnapshot(
        failedSnapshot(plan, "resume requires S3 credentials in env")
      ).catch(() => {});
      await markJobDone(plan.connectorId, plan.transferId).catch(() => {});
      continue;
    }
    try {
      const r = await startBulkFromPlan(plan, target);
      if (r.error) {
        console.warn(`[resume] ${plan.transferId}: ${r.error} → 재개 중단`);
        await persistSnapshot(failedSnapshot(plan, r.error)).catch(() => {});
        await markJobDone(plan.connectorId, plan.transferId).catch(() => {});
      } else {
        console.log(`[resume] ${plan.transferId} 재개 시작`);
      }
    } catch (e) {
      console.error(
        `[resume] ${plan.transferId} 재개 실패:`,
        (e as Error).message
      );
    }
  }
}

function failedSnapshot(plan: JobPlan, error: string): ProgressSnapshot {
  return {
    transferId: plan.transferId,
    connectorId: plan.connectorId,
    state: "FAILED",
    totalBytes: null,
    transferredBytes: 0,
    fileCount: plan.files.length,
    filesDone: 0,
    currentFile: null,
    currentFileBytes: 0,
    currentFileTotal: null,
    bytesPerSec: null,
    etaSec: null,
    error,
  };
}

/** 라우트 편의 — resolveS3Target 재노출(라우트가 s3 를 별도 임포트하지 않도록). */
export { resolveS3Target, isS3TargetUsable };

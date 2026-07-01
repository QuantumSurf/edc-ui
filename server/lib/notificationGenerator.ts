// KMX EDC — Notification Generator (background poller)
//
// Periodically polls each registered connector and inserts notification rows
// for noteworthy events:
//   - negotiation.terminated  → error
//   - transfer.terminated     → error
//   - transfer.completed      → success (gated to avoid noise — only first observe)
//   - edr.expiring            → warn  (when < 60 min remaining)
//   - vc.expiring             → warn  (when < 30 days remaining)
//   - connector.unreachable   → error
//
// Idempotency:
//   Each notification has a deterministic source-key composed of
//   (connector_id, kind, target_id). We track previously-fired keys in memory
//   plus a DB UNIQUE INDEX guard to prevent duplicates across BFF restarts.

import type { PoolClient } from "pg";
import { getPool } from "./db.js";
import { listAllConnectorsUnsafe } from "./connectorRegistry.js";
import { getEdcClient, withJsonLd } from "./edcClient.js";
import { recordAudit } from "./audit.js";
import { notificationPollTotal } from "./metrics.js";

const POLL_INTERVAL_MS = Number(process.env.KMX_NOTIFY_POLL_MS ?? 60_000);
const ENABLED = process.env.KMX_NOTIFY_ENABLED !== "false";
const POLL_CONCURRENCY = Number(process.env.KMX_NOTIFY_CONCURRENCY ?? 4);
const DEDUP_CACHE_LIMIT = Number(
  process.env.KMX_NOTIFY_DEDUP_CACHE_LIMIT ?? 10_000
);
const DEDUP_TTL_DAYS = Number(process.env.KMX_NOTIFY_DEDUP_TTL_DAYS ?? 30);
const DEDUP_CLEANUP_EVERY_N_TICKS = Number(
  process.env.KMX_NOTIFY_CLEANUP_EVERY_N_TICKS ?? 60
);
const DAY_BUCKET_TZ = process.env.KMX_NOTIFY_TIMEZONE ?? "Asia/Seoul";

/** Bounded in-memory dedup cache (process-local). DB UNIQUE INDEX is the cross-restart guarantor. */
class BoundedSet {
  private set = new Set<string>();
  constructor(private readonly limit: number) {}
  has(k: string): boolean {
    return this.set.has(k);
  }
  add(k: string): void {
    if (this.set.size >= this.limit) {
      // Drop the oldest ~10% to amortize work
      const drop = Math.max(1, Math.floor(this.limit * 0.1));
      let i = 0;
      for (const v of this.set) {
        this.set.delete(v);
        if (++i >= drop) break;
      }
    }
    this.set.add(k);
  }
  size(): number {
    return this.set.size;
  }
}
const seenKeys = new BoundedSet(DEDUP_CACHE_LIMIT);

/** Stable key for dedup. Prefix with kind so retired keys don't conflict. */
function makeKey(connectorId: string, kind: string, targetId: string): string {
  return `${connectorId}::${kind}::${targetId}`;
}

/** YYYY-MM-DD in configured timezone (default KST). */
function dayBucket(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DAY_BUCKET_TZ }).format(
    new Date()
  );
}

interface InsertSpec {
  type: "info" | "warn" | "error" | "success";
  source: "system" | "negotiation" | "transfer" | "edr" | "vc";
  title: string;
  message: string;
  link?: string;
  /** i18n 메시지 키(예: "edrExpiring") — 표시 시점에 사용자 언어로 번역한다.
   *  title/message 는 키 없는 옛 데이터·폴백용으로 유지(한국어). */
  msgKey?: string;
  /** i18n 보간 파라미터(connector/asset/minutes 등). 표시 시 템플릿에 주입. */
  params?: Record<string, unknown>;
  /** 감사 로그에도 기록할 시스템 이벤트 메타(요구사항: 감사 로그를 통한 시스템 모니터링).
   *  알림과 동일 dedup 하에 있으므로 '새 이벤트'만 1회 감사에 남는다(폴링마다 도배 X). */
  audit?: {
    action: string;
    category: string;
    target?: string | null;
    targetType?: string | null;
    connectorId?: string | null;
    result: "SUCCESS" | "FAILURE";
    severity: "INFO" | "WARN" | "CRITICAL";
    message: string;
  };
  /** stable key for cross-restart dedup via notification_dedup table */
  dedupKey: string;
  /** 알림을 소유하는 테넌트(커넥터 소유 테넌트). UI는 자기 테넌트 알림만 조회. */
  tenantId?: string | null;
}

/** Persist notification + dedup row. Returns true if newly created. */
async function insertOnce(spec: InsertSpec): Promise<boolean> {
  if (seenKeys.has(spec.dedupKey)) return false;
  const pool = getPool();
  // Try insert into dedup table; ON CONFLICT do nothing → check rowcount.
  const dedup = await pool.query(
    `INSERT INTO notification_dedup (dedup_key) VALUES ($1) ON CONFLICT (dedup_key) DO NOTHING`,
    [spec.dedupKey]
  );
  if (dedup.rowCount === 0) {
    seenKeys.add(spec.dedupKey);
    return false;
  }
  await pool.query(
    `INSERT INTO notifications (tenant_id, type, source, title, message, link, msg_key, msg_params)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      spec.tenantId ?? null,
      spec.type,
      spec.source,
      spec.title,
      spec.message,
      spec.link ?? null,
      spec.msgKey ?? null,
      spec.params ? JSON.stringify(spec.params) : null,
    ]
  );
  // 시스템 이벤트를 감사 로그에도 기록 — 사용자 작업(감사)과 시스템 이벤트(알림)를
  // 감사 로그 한 곳에서 통합 모니터링. best-effort(실패해도 알림 흐름 미영향).
  if (spec.audit) {
    void recordAudit({
      tenantId: spec.tenantId ?? null,
      actorId: null,
      actorEmail: null,
      actorRole: null, // 시스템 생성 이벤트(행위자 없음)
      action: spec.audit.action,
      category: spec.audit.category,
      target: spec.audit.target ?? null,
      targetType: spec.audit.targetType ?? null,
      connectorId: spec.audit.connectorId ?? null,
      result: spec.audit.result,
      severity: spec.audit.severity,
      message: spec.audit.message,
    });
  }
  seenKeys.add(spec.dedupKey);
  return true;
}

/** Ensure dedup table exists (idempotent — initDb companion). */
export async function ensureNotificationDedupTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS notification_dedup (
      dedup_key   TEXT PRIMARY KEY,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await runDedupCleanup();
}

/** Drop dedup rows older than TTL. Called at boot + periodically. */
async function runDedupCleanup(): Promise<void> {
  try {
    const r = await getPool().query(
      `DELETE FROM notification_dedup WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`,
      [DEDUP_TTL_DAYS]
    );
    if ((r.rowCount ?? 0) > 0) {
      console.log(`[NotifyGen] dedup cleanup removed ${r.rowCount} rows`);
    }
  } catch (err) {
    console.warn("[NotifyGen] dedup cleanup failed:", (err as Error).message);
  }
}

/** Run promises with bounded concurrency. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (it: T) => Promise<void>
): Promise<void> {
  let idx = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = idx++;
        if (i >= items.length) return;
        await fn(items[i]);
      }
    }
  );
  await Promise.all(workers);
}

/* ─── Poll one connector ────────────────────────────────────── */

async function pollConnector(conn: {
  id: string;
  name: string;
  managementUrl: string;
  apiKey: string;
  tenantId?: string | null;
}): Promise<void> {
  const client = getEdcClient(conn.id, {
    managementUrl: conn.managementUrl,
    apiKey: conn.apiKey,
  });
  let anyQuerySucceeded = false;
  const errors: string[] = [];

  // ── Negotiations: TERMINATED → error ──
  try {
    const r = await client.post(
      "/v3/contractnegotiations/request",
      withJsonLd({})
    );
    anyQuerySucceeded = true;
    const list = (
      Array.isArray(r.data) ? r.data : (r.data?.["dataset"] ?? [])
    ) as Record<string, unknown>[];
    for (const n of list) {
      if (n["state"] !== "TERMINATED") continue;
      const id = (n["@id"] as string) ?? "";
      const peer = (n["counterPartyId"] as string) ?? "";
      const errorDetail = (n["errorDetail"] as string) ?? "(사유 미상)";
      await insertOnce({
        type: "error",
        source: "negotiation",
        title: `협상 종료 — ${conn.name}`,
        message: `상대 ${peer} 와의 협상이 실패했습니다. ${errorDetail}`.slice(
          0,
          1900
        ),
        msgKey: "negTerminated",
        params: { connector: conn.name, peer, detail: errorDetail },
        link: "/transaction/negotiations",
        audit: {
          action: "event.negotiation.failed",
          category: "NEGOTIATION",
          target: id,
          targetType: "Negotiation",
          connectorId: conn.id,
          result: "FAILURE",
          severity: "WARN",
          message: `Negotiation failed on ${conn.name}`,
        },
        dedupKey: makeKey(conn.id, "neg.terminated", id),
        tenantId: conn.tenantId,
      });
    }
  } catch (e) {
    errors.push((e as Error).message);
  }

  // ── Transfers: TERMINATED → error, COMPLETED → success ──
  try {
    const r = await client.post(
      "/v3/transferprocesses/request",
      withJsonLd({})
    );
    anyQuerySucceeded = true;
    const list = (
      Array.isArray(r.data) ? r.data : (r.data?.["dataset"] ?? [])
    ) as Record<string, unknown>[];
    for (const tp of list) {
      const state = tp["state"] as string;
      const id = (tp["@id"] as string) ?? "";
      const asset = (tp["assetId"] as string) ?? "";
      if (state === "TERMINATED") {
        const errorDetail = (tp["errorDetail"] as string) ?? "(사유 미상)";
        await insertOnce({
          type: "error",
          source: "transfer",
          title: `전송 실패 — ${conn.name}`,
          message: `자산 ${asset} 전송이 종료되었습니다. ${errorDetail}`.slice(
            0,
            1900
          ),
          msgKey: "transferTerminated",
          params: { connector: conn.name, asset, detail: errorDetail },
          link: "/transaction/transfers",
          audit: {
            action: "event.transfer.failed",
            category: "TRANSFER",
            target: id,
            targetType: "Transfer",
            connectorId: conn.id,
            result: "FAILURE",
            severity: "WARN",
            message: `Transfer of asset ${asset} failed on ${conn.name}`,
          },
          dedupKey: makeKey(conn.id, "transfer.terminated", id),
          tenantId: conn.tenantId,
        });
      } else if (state === "COMPLETED") {
        await insertOnce({
          type: "success",
          source: "transfer",
          title: `전송 완료 — ${conn.name}`,
          message: `자산 ${asset} 전송이 정상 완료되었습니다.`,
          msgKey: "transferCompleted",
          params: { connector: conn.name, asset },
          link: "/transaction/transfers",
          audit: {
            action: "event.transfer.completed",
            category: "TRANSFER",
            target: id,
            targetType: "Transfer",
            connectorId: conn.id,
            result: "SUCCESS",
            severity: "INFO",
            message: `Transfer of asset ${asset} completed on ${conn.name}`,
          },
          dedupKey: makeKey(conn.id, "transfer.completed", id),
          tenantId: conn.tenantId,
        });
      }
    }
  } catch (e) {
    errors.push((e as Error).message);
  }

  // ── EDRs: 만료 < 60분 → warn ──
  try {
    const r = await client.post("/v3/edrs/request", withJsonLd({}));
    anyQuerySucceeded = true;
    const list = (Array.isArray(r.data) ? r.data : []) as Record<
      string,
      unknown
    >[];
    const now = Date.now();
    for (const edr of list) {
      const expiresAt = edr["expiresAt"] as number | undefined;
      if (!expiresAt) continue;
      const left = Math.round((expiresAt - now) / 60_000);
      if (left <= 0 || left >= 60) continue;
      const tpId =
        (edr["transferProcessId"] as string) ?? (edr["@id"] as string) ?? "";
      // Per-day dedup: alias gives one warning per day per EDR
      const today = dayBucket();
      await insertOnce({
        type: "warn",
        source: "edr",
        title: `EDR 만료 임박 — ${conn.name}`,
        message: `Transfer ${tpId.slice(0, 12)} 의 EDR이 ${left}분 후 만료됩니다.`,
        msgKey: "edrExpiring",
        params: { connector: conn.name, transfer: tpId.slice(0, 12), minutes: left },
        link: "/transaction/edr",
        audit: {
          action: "event.edr.expiring",
          category: "TRANSFER",
          target: tpId.slice(0, 12),
          targetType: "EDR",
          connectorId: conn.id,
          result: "FAILURE",
          severity: "WARN",
          message: `EDR for transfer ${tpId.slice(0, 12)} expiring in ${left} min on ${conn.name}`,
        },
        dedupKey: makeKey(conn.id, `edr.expiring.${today}`, tpId),
        tenantId: conn.tenantId,
      });
    }
  } catch (e) {
    errors.push((e as Error).message);
  }

  // If all 3 queries failed, fire connector unreachable.
  // Per-day dedup so the same dead connector doesn't spam.
  if (!anyQuerySucceeded) {
    const today = dayBucket();
    const detail = errors.length ? errors.join("; ") : "no detail";
    await insertOnce({
      type: "error",
      source: "system",
      title: `Connector unreachable: ${conn.name}`,
      message:
        `${conn.managementUrl} 응답 없음 — DSP / 협상 / 전송 작업 중단 가능. (${detail})`.slice(
          0,
          1900
        ),
      msgKey: "connectorUnreachable",
      params: {
        connector: conn.name,
        url: conn.managementUrl,
        detail: detail.slice(0, 1800),
      },
      link: "/system/infra",
      audit: {
        action: "event.connector.unreachable",
        category: "CONNECTOR",
        target: conn.name,
        targetType: "Connector",
        connectorId: conn.id,
        result: "FAILURE",
        severity: "CRITICAL",
        message: `Connector ${conn.name} unreachable (${conn.managementUrl})`,
      },
      dedupKey: makeKey(conn.id, `connector.unreachable.${today}`, conn.id),
      tenantId: conn.tenantId,
    });
  }
}

/* ─── Tick + scheduler ──────────────────────────────────────── */

let tickCount = 0;

// 멀티레플리카에서 폴러가 전 레플리카에서 돌면 커넥터당 N배 EDC 폴링이 발생한다(중복 알림 행은
// dedup PK 가 막지만 업스트림 폴링 부하는 배가). advisory lock 으로 '리더' 한 레플리카만 폴링하도록
// 선출한다(비블로킹 try-lock; 리더 사망 시 세션 종료로 락이 풀려 다음 tick 에 다른 레플리카가 승계).
const NOTIFY_LEADER_LOCK_KEY = 4915232;
let leaderClient: PoolClient | null = null;
async function isLeader(): Promise<boolean> {
  if (leaderClient) return true;
  const client = await getPool().connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS ok",
      [NOTIFY_LEADER_LOCK_KEY]
    );
    if (rows[0]?.ok) {
      leaderClient = client; // 락 보유를 위해 연결을 계속 점유
      client.on("error", () => {
        leaderClient = null; // 연결 끊기면 리더 자격 상실 → 재선출
      });
      return true;
    }
    client.release();
    return false;
  } catch {
    client.release();
    return false;
  }
}

async function tick(): Promise<void> {
  if (!(await isLeader())) return; // 비리더 레플리카는 폴링 생략
  try {
    const conns = await listAllConnectorsUnsafe();
    await runWithConcurrency(conns, POLL_CONCURRENCY, async c => {
      try {
        await pollConnector({
          id: c.id,
          name: c.name,
          managementUrl: c.managementUrl,
          apiKey: c.apiKey,
          tenantId: c.tenantId ?? null,
        });
        notificationPollTotal.inc({ result: "success" });
      } catch (err) {
        notificationPollTotal.inc({ result: "failure" });
        console.warn(
          `[NotifyGen] connector ${c.id} poll error:`,
          (err as Error).message
        );
      }
    });

    // Periodic dedup cleanup so the table doesn't grow forever in long-running BFFs.
    tickCount++;
    if (tickCount % DEDUP_CLEANUP_EVERY_N_TICKS === 0) {
      await runDedupCleanup();
    }
  } catch (err) {
    console.error("[NotifyGen] tick failed:", (err as Error).message);
  }
}

let timer: NodeJS.Timeout | null = null;

export async function startNotificationGenerator(): Promise<void> {
  if (!ENABLED) {
    console.log("[NotifyGen] disabled by KMX_NOTIFY_ENABLED=false");
    return;
  }
  await ensureNotificationDedupTable();
  // Initial tick after short delay so other init code has settled.
  setTimeout(tick, 5_000);
  timer = setInterval(tick, POLL_INTERVAL_MS);
  console.log(
    `[NotifyGen] started (poll=${POLL_INTERVAL_MS}ms, concurrency=${POLL_CONCURRENCY}, ` +
      `dedupCache=${DEDUP_CACHE_LIMIT}, cleanupEvery=${DEDUP_CLEANUP_EVERY_N_TICKS}ticks, tz=${DAY_BUCKET_TZ})`
  );
}

export function stopNotificationGenerator(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** 읽은 알림 중 보존기간 초과분 삭제 — 무한 증가 방지(best-effort). 미읽음은 보존한다. */
export async function pruneNotifications(
  retentionDays = Number(process.env.NOTIFICATION_RETENTION_DAYS ?? 90)
): Promise<void> {
  try {
    await getPool().query(
      `DELETE FROM notifications
        WHERE read = TRUE AND created_at < NOW() - ($1 || ' days')::interval`,
      [String(Math.max(1, Math.floor(retentionDays) || 90))]
    );
  } catch (err) {
    console.error(
      "[NotifyGen] notification prune failed:",
      (err as Error).message
    );
  }
}

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

import { getPool } from "./db.js";
import { listConnectors } from "./connectorRegistry.js";
import { getEdcClient, withJsonLd } from "./edcClient.js";

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
  /** stable key for cross-restart dedup via notification_dedup table */
  dedupKey: string;
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
    `INSERT INTO notifications (type, source, title, message, link)
     VALUES ($1, $2, $3, $4, $5)`,
    [spec.type, spec.source, spec.title, spec.message, spec.link ?? null]
  );
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
        link: "/transaction/negotiations",
        dedupKey: makeKey(conn.id, "neg.terminated", id),
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
          link: "/transaction/transfers",
          dedupKey: makeKey(conn.id, "transfer.terminated", id),
        });
      } else if (state === "COMPLETED") {
        await insertOnce({
          type: "success",
          source: "transfer",
          title: `전송 완료 — ${conn.name}`,
          message: `자산 ${asset} 전송이 정상 완료되었습니다.`,
          link: "/transaction/transfers",
          dedupKey: makeKey(conn.id, "transfer.completed", id),
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
        link: "/transaction/edr",
        dedupKey: makeKey(conn.id, `edr.expiring.${today}`, tpId),
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
      link: "/system/infra",
      dedupKey: makeKey(conn.id, `connector.unreachable.${today}`, conn.id),
    });
  }
}

/* ─── Tick + scheduler ──────────────────────────────────────── */

let tickCount = 0;

async function tick(): Promise<void> {
  try {
    const conns = await listConnectors();
    await runWithConcurrency(conns, POLL_CONCURRENCY, async c => {
      try {
        await pollConnector({
          id: c.id,
          name: c.name,
          managementUrl: c.managementUrl,
          apiKey: c.apiKey,
        });
      } catch (err) {
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

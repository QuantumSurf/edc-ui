// KMX EDC — Tenant lookup + per-tenant settings (tenant_settings table)

import { getPool } from "./db.js";

export interface Tenant {
  id: string;
  name: string;
  bpn: string;
}

/** Fetch a tenant by id. */
export async function getTenant(id: string): Promise<Tenant | undefined> {
  const { rows } = await getPool().query<{
    id: string;
    name: string;
    bpn: string;
  }>(`SELECT id, name, bpn FROM tenants WHERE id = $1 LIMIT 1`, [id]);
  return rows[0];
}

/** True when another tenant already owns this BPN (BPN is the login id). */
export async function isBpnTaken(
  bpn: string,
  exceptTenantId: string
): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM tenants WHERE bpn = $1 AND id <> $2 LIMIT 1`,
    [bpn, exceptTenantId]
  );
  return rows.length > 0;
}

/** Postgres unique_violation(23505) 여부 — BPN 유니크 백스톱 충돌 판별용. */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === "23505";
}

/** Update a tenant's BPN (its organization identifier / login id).
 *  uq_tenants_bpn 유니크 인덱스가 동시 경합/중복을 백스톱하므로, 호출부는
 *  isUniqueViolation 으로 23505 를 잡아 409 로 매핑해야 한다. */
export async function updateTenantBpn(
  id: string,
  bpn: string
): Promise<Tenant | undefined> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{
      id: string;
      name: string;
      bpn: string;
    }>(`UPDATE tenants SET bpn = $1 WHERE id = $2 RETURNING id, name, bpn`, [
      bpn,
      id,
    ]);
    // BPN 은 소유 커넥터의 식별자(connectors.bpn)에도 반영된다. 함께 갱신하지 않으면
    // (1) migrateTenants 가 옛 bpn 으로 로그인 불가한 고아 테넌트를 재생성하고,
    // (2) 커넥터가 로그인/카탈로그 정체성과 다른 bpn 을 광고한다. 원자적으로 전파.
    await client.query(`UPDATE connectors SET bpn = $1 WHERE tenant_id = $2`, [
      bpn,
      id,
    ]);
    await client.query("COMMIT");
    return rows[0];
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Read a single per-tenant setting value (empty string when unset). */
export async function getTenantSetting(
  tenantId: string,
  key: string
): Promise<string> {
  const { rows } = await getPool().query<{ value: string }>(
    `SELECT value FROM tenant_settings WHERE tenant_id = $1 AND key = $2`,
    [tenantId, key]
  );
  return rows[0]?.value ?? "";
}

/** Read multiple per-tenant settings at once. */
export async function getTenantSettings(
  tenantId: string,
  keys: string[]
): Promise<Record<string, string>> {
  const { rows } = await getPool().query<{ key: string; value: string }>(
    `SELECT key, value FROM tenant_settings WHERE tenant_id = $1 AND key = ANY($2)`,
    [tenantId, keys]
  );
  const m: Record<string, string> = {};
  for (const r of rows) m[r.key] = (r.value ?? "").trim();
  return m;
}

/** Upsert a per-tenant setting. */
export async function setTenantSetting(
  tenantId: string,
  key: string,
  value: string
): Promise<void> {
  await getPool().query(
    `INSERT INTO tenant_settings (tenant_id, key, value, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [tenantId, key, value]
  );
}

/* ── Tenant offboarding (H8) ──────────────────────────────────────
 * 2단계 오프보딩: (1) archive — 소프트삭제로 로그인/세션을 즉시 차단(복구 가능),
 * (2) purge — 보존기간 경과 후 모든 데이터를 하드삭제(복구 불가). 플랫폼 운영 CLI 전용
 * (server/scripts/offboardTenant.ts). super-admin 역할·HTTP 노출 없음.
 * ---------------------------------------------------------------- */

// 커넥터 파생(connector_id 로 연결) + 테넌트 스코프(tenant_id) 테이블 목록. purge 삭제 순서를
// 위해 파생을 먼저, users·tenants 를 마지막에 둔다. 상수 배열이라 SQL 식별자 보간이 안전하다.
const TENANT_SCOPED_TABLES = [
  "connectors",
  "tenant_settings",
  "notifications",
  "semantic_models",
  "audit_logs",
  "field_history",
  "users",
] as const;

export interface ArchiveResult {
  archived: boolean;
  tenantId?: string;
  name?: string;
  usersInvalidated?: number;
}

/** 오프보딩 1단계 — 테넌트 아카이브(소프트삭제). 로그인(auth.ts 의 archived_at IS NULL 필터)과
 *  조회를 즉시 차단하고, 해당 테넌트 전 사용자의 token_version 을 올려 라이브 세션을 무효화한다.
 *  이미 아카이브되었거나 미존재면 archived=false. */
export async function archiveTenant(bpn: string): Promise<ArchiveResult> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string; name: string }>(
      `UPDATE tenants SET archived_at = NOW()
        WHERE bpn = $1 AND archived_at IS NULL
        RETURNING id, name`,
      [bpn]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return { archived: false };
    }
    const tenantId = rows[0].id;
    const inval = await client.query(
      `UPDATE users SET token_version = token_version + 1 WHERE tenant_id = $1`,
      [tenantId]
    );
    await client.query("COMMIT");
    return {
      archived: true,
      tenantId,
      name: rows[0].name,
      usersInvalidated: inval.rowCount ?? 0,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** 보존기간 내 복구 — 아카이브 해제. 무효화된 세션은 복원하지 않으므로 사용자는 재로그인해야 한다. */
export async function restoreTenant(
  bpn: string
): Promise<{ restored: boolean; tenantId?: string; name?: string }> {
  const { rows } = await getPool().query<{ id: string; name: string }>(
    `UPDATE tenants SET archived_at = NULL
      WHERE bpn = $1 AND archived_at IS NOT NULL
      RETURNING id, name`,
    [bpn]
  );
  if (rows.length === 0) return { restored: false };
  return { restored: true, tenantId: rows[0].id, name: rows[0].name };
}

export interface TenantOverview {
  id: string;
  bpn: string;
  name: string;
  archivedAt: string | null;
  connectorCount: number;
  userCount: number;
}

/** 전체 테넌트 목록 + 아카이브 상태/커넥터·사용자 수(오프보딩 대상 확인용). */
export async function listTenants(): Promise<TenantOverview[]> {
  const { rows } = await getPool().query<{
    id: string;
    bpn: string;
    name: string;
    archived_at: Date | string | null;
    connector_count: string;
    user_count: string;
  }>(
    `SELECT t.id, t.bpn, t.name, t.archived_at,
            (SELECT COUNT(*) FROM connectors c WHERE c.tenant_id = t.id) AS connector_count,
            (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count
       FROM tenants t
      ORDER BY t.archived_at NULLS FIRST, t.name`
  );
  return rows.map(r => ({
    id: r.id,
    bpn: r.bpn,
    name: r.name,
    archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
    connectorCount: Number(r.connector_count),
    userCount: Number(r.user_count),
  }));
}

export interface PurgeResult {
  tenantId: string;
  bpn: string;
  name: string;
  archivedAt: string;
  deleted: Record<string, number>;
}

/** 오프보딩 2단계 — 아카이브 후 retentionDays 초과 테넌트의 모든 데이터를 하드삭제(복구 불가).
 *  dryRun 이면 대상만 반환하고 삭제하지 않는다. 각 테넌트를 개별 트랜잭션으로 처리해 부분 실패를
 *  격리한다(한 테넌트 실패가 다른 테넌트 삭제를 되돌리지 않음). */
export async function purgeArchivedTenants(
  retentionDays: number,
  dryRun: boolean
): Promise<PurgeResult[]> {
  // 하한/정수 클램프 — 음수/0/비정수 입력이 보존창을 무력화(임계값이 NOW() 미래/현재로 이동)해
  // 방금 아카이브한 테넌트까지 하드삭제하는 것을 차단한다(audit/notification prune 과 동일 방어).
  // 예: retentionDays=-5 → NOW()-('-5 days') = NOW()+5d → 아카이브 전부 매칭. 기본 폴백 30일.
  const days = Math.max(1, Math.floor(retentionDays) || 30);
  const { rows: targets } = await getPool().query<{
    id: string;
    bpn: string;
    name: string;
    archived_at: Date | string;
  }>(
    `SELECT id, bpn, name, archived_at FROM tenants
      WHERE archived_at IS NOT NULL
        AND archived_at < NOW() - ($1 || ' days')::interval
      ORDER BY archived_at`,
    [String(days)]
  );

  const results: PurgeResult[] = [];
  for (const t of targets) {
    const archivedAt = new Date(t.archived_at).toISOString();
    if (dryRun) {
      results.push({
        tenantId: t.id,
        bpn: t.bpn,
        name: t.name,
        archivedAt,
        deleted: {},
      });
      continue;
    }
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      // TOCTOU 가드(CWE-367) — 대상 SELECT 와 이 삭제 트랜잭션 사이에 restoreTenant 로 활성화된
      // 테넌트가 하드삭제되는 것을 막는다. 행을 FOR UPDATE 로 잠그고 archived_at·보존기간을
      // 트랜잭션 안에서 재검증 — 그 사이 restore/미충족이면 자식 삭제조차 하지 않고 스킵한다.
      const guard = await client.query(
        `SELECT id FROM tenants
          WHERE id = $1 AND archived_at IS NOT NULL
            AND archived_at < NOW() - ($2 || ' days')::interval
          FOR UPDATE`,
        [t.id, String(days)]
      );
      if (guard.rowCount === 0) {
        await client.query("ROLLBACK");
        continue;
      }
      const deleted: Record<string, number> = {};
      // 커넥터 파생 메타(connector_id 로 연결) 먼저 삭제.
      for (const meta of ["transfer_metadata", "negotiation_metadata"]) {
        const r = await client.query(
          `DELETE FROM ${meta} WHERE connector_id IN (SELECT id FROM connectors WHERE tenant_id = $1)`,
          [t.id]
        );
        deleted[meta] = r.rowCount ?? 0;
      }
      // 테넌트 스코프 테이블(connectors → ... → users 순).
      for (const tbl of TENANT_SCOPED_TABLES) {
        const r = await client.query(
          `DELETE FROM ${tbl} WHERE tenant_id = $1`,
          [t.id]
        );
        deleted[tbl] = r.rowCount ?? 0;
      }
      const rt = await client.query(`DELETE FROM tenants WHERE id = $1`, [t.id]);
      deleted.tenants = rt.rowCount ?? 0;
      await client.query("COMMIT");
      results.push({
        tenantId: t.id,
        bpn: t.bpn,
        name: t.name,
        archivedAt,
        deleted,
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  return results;
}

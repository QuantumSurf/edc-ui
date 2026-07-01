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

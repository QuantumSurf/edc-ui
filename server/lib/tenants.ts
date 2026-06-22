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

/** Update a tenant's BPN (its organization identifier / login id). */
export async function updateTenantBpn(
  id: string,
  bpn: string
): Promise<Tenant | undefined> {
  const { rows } = await getPool().query<{
    id: string;
    name: string;
    bpn: string;
  }>(`UPDATE tenants SET bpn = $1 WHERE id = $2 RETURNING id, name, bpn`, [
    bpn,
    id,
  ]);
  return rows[0];
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

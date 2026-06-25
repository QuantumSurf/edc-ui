// KMX EDC — Connector Registry (PostgreSQL-backed)
// Manages registered connector endpoints and API keys

import { randomUUID } from "crypto";
import { getPool } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

export interface ConnectorEntry {
  id: string;
  name: string;
  bpn: string;
  managementUrl: string;
  dspEndpoint: string;
  apiKey: string;
  env: "PROD" | "STG" | "DEV";
  roles: string[];
  dcpVersion: string;
  did?: string;
  identityHubUrl?: string;
  tenantId?: string;
  createdAt: string;
}

/** Map a DB row (snake_case) to ConnectorEntry (camelCase) */
function rowToEntry(row: Record<string, unknown>): ConnectorEntry {
  return {
    id: row.id as string,
    name: row.name as string,
    bpn: row.bpn as string,
    managementUrl: row.management_url as string,
    dspEndpoint: row.dsp_endpoint as string,
    // at-rest 암호화 해제 — 레거시 평문은 decryptSecret 가 그대로 통과(이행기 호환).
    apiKey: decryptSecret(row.api_key as string),
    env: row.env as "PROD" | "STG" | "DEV",
    roles: row.roles as string[],
    dcpVersion: row.dcp_version as string,
    did: (row.did as string) ?? undefined,
    identityHubUrl: (row.identity_hub_url as string) ?? undefined,
    tenantId: (row.tenant_id as string) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/**
 * List a tenant's connectors. tenantId는 필수 — 인자 누락/빈값이면 전체 노출 대신
 * 명시적으로 실패(fail-closed)해, 어떤 라우트도 실수로 전 테넌트 커넥터를 조회하지 못하게 한다.
 */
export async function listConnectors(
  tenantId: string
): Promise<ConnectorEntry[]> {
  if (!tenantId) throw new Error("listConnectors: tenantId required");
  const { rows } = await getPool().query(
    "SELECT * FROM connectors WHERE tenant_id = $1 ORDER BY created_at",
    [tenantId]
  );
  return rows.map(rowToEntry);
}

/**
 * 전 테넌트 커넥터 조회 — 내부/백그라운드/마이그레이션 전용. 라우트에서 호출 금지.
 * (notificationGenerator의 전역 폴링 등 테넌트 무관 작업만 사용)
 */
export async function listAllConnectorsUnsafe(): Promise<ConnectorEntry[]> {
  const { rows } = await getPool().query(
    "SELECT * FROM connectors ORDER BY created_at"
  );
  return rows.map(rowToEntry);
}

export async function getConnector(
  id: string
): Promise<ConnectorEntry | undefined> {
  const { rows } = await getPool().query(
    "SELECT * FROM connectors WHERE id = $1",
    [id]
  );
  return rows.length > 0 ? rowToEntry(rows[0]) : undefined;
}

/** 테넌트당 등록된 커넥터 수 — 등록 상한 검사용(tenant 스코프라 전 테넌트 수 누출 없음). */
export async function countConnectorsByTenant(
  tenantId: string
): Promise<number> {
  const { rows } = await getPool().query(
    "SELECT COUNT(*)::int AS n FROM connectors WHERE tenant_id = $1",
    [tenantId]
  );
  return (rows[0]?.n as number) ?? 0;
}

export async function registerConnector(
  entry: Omit<ConnectorEntry, "id" | "createdAt" | "tenantId">,
  tenantId: string
): Promise<ConnectorEntry> {
  // Generate ID: env 접두 + 충돌 없는 UUID 단편(전역 COUNT(*) 제거 — 동시 등록 PK 충돌 및
  // 전체 테넌트 커넥터 수 누출 방지). validateConnectorId 정규식(^[a-zA-Z0-9\-_]+$) 충족.
  const id = `${entry.env.toLowerCase()}-${randomUUID().slice(0, 8)}`;

  const sql = `
    INSERT INTO connectors (id, name, bpn, management_url, dsp_endpoint, api_key, env, roles, dcp_version, did, identity_hub_url, tenant_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;

  const { rows } = await getPool().query(sql, [
    id,
    entry.name,
    entry.bpn,
    entry.managementUrl,
    entry.dspEndpoint,
    encryptSecret(entry.apiKey ?? ""), // at-rest 암호화
    entry.env,
    entry.roles,
    entry.dcpVersion,
    entry.did ?? null,
    entry.identityHubUrl ?? null,
    tenantId,
  ]);

  return rowToEntry(rows[0]);
}

export async function updateConnector(
  id: string,
  updates: Partial<Omit<ConnectorEntry, "id" | "createdAt">>
): Promise<ConnectorEntry | undefined> {
  // Build dynamic SET clause from provided fields
  const fieldMap: Record<string, string> = {
    name: "name",
    bpn: "bpn",
    managementUrl: "management_url",
    dspEndpoint: "dsp_endpoint",
    apiKey: "api_key",
    env: "env",
    roles: "roles",
    dcpVersion: "dcp_version",
    did: "did",
    identityHubUrl: "identity_hub_url",
  };

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in updates) {
      const val = updates[key as keyof typeof updates];
      if (val === undefined) continue;
      setClauses.push(`${col} = $${idx}`);
      // API Key 는 at-rest 암호화 후 저장. 그 외 옵션 필드("did" 등)의 빈 문자열은 null.
      if (col === "api_key" && typeof val === "string") {
        values.push(encryptSecret(val));
      } else {
        values.push(
          val === "" && (col === "did" || col === "identity_hub_url")
            ? null
            : val
        );
      }
      idx++;
    }
  }

  if (setClauses.length === 0) return getConnector(id);

  values.push(id);
  const sql = `UPDATE connectors SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`;
  const { rows } = await getPool().query(sql, values);
  return rows.length > 0 ? rowToEntry(rows[0]) : undefined;
}

export async function deleteConnector(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    "DELETE FROM connectors WHERE id = $1",
    [id]
  );
  return (rowCount ?? 0) > 0;
}

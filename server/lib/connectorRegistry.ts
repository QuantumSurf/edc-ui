// KMX EDC — Connector Registry (PostgreSQL-backed)
// Manages registered connector endpoints and API keys

import { getPool } from "./db.js";

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
    apiKey: row.api_key as string,
    env: row.env as "PROD" | "STG" | "DEV",
    roles: row.roles as string[],
    dcpVersion: row.dcp_version as string,
    did: (row.did as string) ?? undefined,
    identityHubUrl: (row.identity_hub_url as string) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function listConnectors(): Promise<ConnectorEntry[]> {
  const { rows } = await getPool().query("SELECT * FROM connectors ORDER BY created_at");
  return rows.map(rowToEntry);
}

export async function getConnector(id: string): Promise<ConnectorEntry | undefined> {
  const { rows } = await getPool().query("SELECT * FROM connectors WHERE id = $1", [id]);
  return rows.length > 0 ? rowToEntry(rows[0]) : undefined;
}

export async function registerConnector(
  entry: Omit<ConnectorEntry, "id" | "createdAt">,
): Promise<ConnectorEntry> {
  // Generate ID: env-NN (next sequence number)
  const { rows: countRows } = await getPool().query("SELECT COUNT(*)::int AS cnt FROM connectors");
  const id = `${entry.env.toLowerCase()}-${String(countRows[0].cnt + 1).padStart(2, "0")}`;

  const sql = `
    INSERT INTO connectors (id, name, bpn, management_url, dsp_endpoint, api_key, env, roles, dcp_version, did, identity_hub_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `;

  const { rows } = await getPool().query(sql, [
    id, entry.name, entry.bpn, entry.managementUrl, entry.dspEndpoint,
    entry.apiKey, entry.env, entry.roles, entry.dcpVersion,
    entry.did ?? null, entry.identityHubUrl ?? null,
  ]);

  return rowToEntry(rows[0]);
}

export async function updateConnector(
  id: string,
  updates: Partial<Omit<ConnectorEntry, "id" | "createdAt">>,
): Promise<ConnectorEntry | undefined> {
  // Build dynamic SET clause from provided fields
  const fieldMap: Record<string, string> = {
    name: "name", bpn: "bpn", managementUrl: "management_url",
    dspEndpoint: "dsp_endpoint", apiKey: "api_key", env: "env",
    roles: "roles", dcpVersion: "dcp_version", did: "did",
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
      // Store empty string as null for optional fields like "did"
      values.push((val === "" && (col === "did" || col === "identity_hub_url")) ? null : val);
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
  const { rowCount } = await getPool().query("DELETE FROM connectors WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

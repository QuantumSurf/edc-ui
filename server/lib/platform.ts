// KMX EDC — Platform Infrastructure Clients
// - Vault HTTP client (read-only metadata, no secret values exposed)
// - Platform PostgreSQL pool (read-only stats from pg_catalog)
//
// Security:
//   - Never returns Vault secret VALUES in API responses (only aliases/metadata).
//   - PG credentials must be a read-only role (to be configured in operations).
//   - All endpoints must be RBAC-gated.

import axios, { type AxiosInstance } from "axios";
import pg from "pg";

const { Pool } = pg;

/* ─── Vault Client ───────────────────────────────────────────── */

const VAULT_URL = process.env.PLATFORM_VAULT_URL ?? "http://platform-vault:8200";
const VAULT_TOKEN = process.env.PLATFORM_VAULT_TOKEN ?? "root";
const VAULT_NAMESPACE = process.env.PLATFORM_VAULT_NAMESPACE ?? "";

let vaultClient: AxiosInstance | null = null;

export function getVaultClient(): AxiosInstance {
  if (!vaultClient) {
    const headers: Record<string, string> = {
      "X-Vault-Token": VAULT_TOKEN,
    };
    if (VAULT_NAMESPACE) headers["X-Vault-Namespace"] = VAULT_NAMESPACE;
    vaultClient = axios.create({
      baseURL: VAULT_URL,
      headers,
      timeout: 5_000,
    });
  }
  return vaultClient;
}

export function getVaultUrl(): string {
  return VAULT_URL;
}

/* ─── Platform PG Pool (read-only stats) ─────────────────────── */

const PLATFORM_PG_URL =
  process.env.PLATFORM_DATABASE_URL ??
  // Fallback: assume kmxedc admin role on shared instance.
  // Production: set PLATFORM_DATABASE_URL to a read-only role explicitly.
  "postgresql://kmxedc:kmxedc-dev-password@platform-postgres:5432/postgres";

let platformPool: pg.Pool | null = null;

export function getPlatformPool(): pg.Pool {
  if (!platformPool) {
    platformPool = new Pool({
      connectionString: PLATFORM_PG_URL,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return platformPool;
}

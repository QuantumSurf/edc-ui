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
import { getPool } from "./db.js";

const { Pool } = pg;

/* ─── Vault Client ───────────────────────────────────────────── */
// Connection config is read from `app_settings` (configurable via the
// Settings screen); env vars are used as the fallback default.

const VAULT_URL_ENV = process.env.PLATFORM_VAULT_URL ?? "http://platform-vault:8200";
const VAULT_TOKEN_ENV = process.env.PLATFORM_VAULT_TOKEN ?? "root";
const VAULT_NAMESPACE_ENV = process.env.PLATFORM_VAULT_NAMESPACE ?? "";

// ── Production 안전 가드 ──────────────────────────────────────────────
// dev 편의용 기본값(Vault root 토큰, dev DB 비밀번호)이 production 으로 새어
// 나가면 플랫폼 시크릿/DB 전체가 노출된다. NODE_ENV=production 일 때 안전하지
// 않은 기본값이면 부팅을 거부한다.
// dev/demo 에서 의도적으로 production 모드 + 기본값을 쓰려면
// ALLOW_INSECURE_DEFAULTS=true 로 명시적 opt-out (실 운영에선 절대 설정 금지).
if (process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_DEFAULTS !== "true") {
  const insecure: string[] = [];
  if (!process.env.PLATFORM_VAULT_TOKEN || VAULT_TOKEN_ENV === "root") insecure.push("PLATFORM_VAULT_TOKEN");
  if (!process.env.PLATFORM_DATABASE_URL || process.env.PLATFORM_DATABASE_URL.includes("kmxedc-dev-password")) {
    insecure.push("PLATFORM_DATABASE_URL");
  }
  if (insecure.length > 0) {
    throw new Error(
      `[platform] production 에서 안전하지 않은 기본값 감지 — 다음 환경변수를 명시적으로 설정해야 합니다: ${insecure.join(", ")}`,
    );
  }
}

interface VaultConfig { url: string; token: string; namespace: string }

async function readVaultConfig(): Promise<VaultConfig> {
  try {
    const { rows } = await getPool().query<{ key: string; value: string }>(
      `SELECT key, value FROM app_settings WHERE key IN ('vault_url', 'vault_token', 'vault_namespace')`,
    );
    const m: Record<string, string> = {};
    for (const r of rows) m[r.key] = r.value ?? "";
    return {
      url: m.vault_url?.trim() || VAULT_URL_ENV,
      token: m.vault_token?.trim() || VAULT_TOKEN_ENV,
      namespace: (m.vault_namespace ?? VAULT_NAMESPACE_ENV).trim(),
    };
  } catch {
    // app_settings unavailable (e.g. DB not ready) — fall back to env.
    return { url: VAULT_URL_ENV, token: VAULT_TOKEN_ENV, namespace: VAULT_NAMESPACE_ENV };
  }
}

let vaultClient: AxiosInstance | null = null;
let vaultCacheKey = "";

export async function getVaultClient(): Promise<AxiosInstance> {
  const cfg = await readVaultConfig();
  const key = `${cfg.url}|${cfg.namespace}|${cfg.token}`;
  if (!vaultClient || vaultCacheKey !== key) {
    const headers: Record<string, string> = { "X-Vault-Token": cfg.token };
    if (cfg.namespace) headers["X-Vault-Namespace"] = cfg.namespace;
    vaultClient = axios.create({ baseURL: cfg.url, headers, timeout: 5_000 });
    vaultCacheKey = key;
  }
  return vaultClient;
}

export async function getVaultUrl(): Promise<string> {
  return (await readVaultConfig()).url;
}

/* ─── Vault secret value access (KV v2) ──────────────────────────
 * 시크릿 '값'을 다루는 내부용 헬퍼. API 응답으로 노출하지 말 것.
 * KV v2 경로: 값은 secret/data/{alias}, field 컨벤션은 `content`.
 */
export async function readVaultSecret(alias: string): Promise<string> {
  const vault = await getVaultClient();
  const { data } = await vault.get(`/v1/secret/data/${encodeURIComponent(alias)}`);
  const inner = (data as { data?: { data?: Record<string, unknown> } })?.data?.data ?? {};
  return String(inner.content ?? "");
}

export async function writeVaultSecret(alias: string, value: string): Promise<void> {
  const vault = await getVaultClient();
  await vault.post(`/v1/secret/data/${encodeURIComponent(alias)}`, { data: { content: value } });
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

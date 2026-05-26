// KMX EDC — PostgreSQL Database Module
// Connection pool + schema initialization

import pg from "pg";
import { randomUUID } from "crypto";
import { hashPassword } from "./auth.js";

const { Pool } = pg;

let pool: pg.Pool;

export function getPool(): pg.Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      console.warn("[DB] WARNING: DATABASE_URL env var is not set. Using default development connection string.");
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://kmx:kmx_dev_123@localhost:5432/kmx_edc",
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

/** Create tables if not exists */
async function createSchema(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS connectors (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      bpn             TEXT NOT NULL,
      management_url  TEXT NOT NULL,
      dsp_endpoint    TEXT NOT NULL,
      api_key         TEXT NOT NULL DEFAULT '',
      env             TEXT NOT NULL CHECK (env IN ('PROD', 'STG', 'DEV')),
      roles           TEXT[] NOT NULL DEFAULT '{}',
      dcp_version     TEXT NOT NULL DEFAULT '1.0',
      did             TEXT,
      identity_hub_url TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Migration: add identity_hub_url to existing tables
  await getPool().query(`ALTER TABLE connectors ADD COLUMN IF NOT EXISTS identity_hub_url TEXT;`);

  // 검증가능 자격증명 로컬 스토어 (IdentityHub 미연결 시 수동 관리)
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS verifiable_credentials (
      id              TEXT NOT NULL,
      connector_id    TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
      type            TEXT NOT NULL,
      exp             TEXT NOT NULL,
      days            INTEGER NOT NULL DEFAULT 9999,
      ok              BOOLEAN NOT NULL DEFAULT TRUE,
      raw_json        JSONB,
      synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (id, connector_id)
    );
  `);

  // 전송 메타데이터: 시작 시각, 완료 시각, 데이터 크기, 완료 처리 여부
  // - user_completed: 사용자가 "완료 처리" 클릭 → TERMINATED를 COMPLETED로 오버레이
  // - size_bytes: EDR fetch 시 Content-Length로 측정
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS transfer_metadata (
      transfer_id       TEXT NOT NULL,
      connector_id      TEXT NOT NULL,
      started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at      TIMESTAMPTZ,
      size_bytes        BIGINT,
      fetch_duration_ms INTEGER,
      user_completed    BOOLEAN NOT NULL DEFAULT FALSE,
      hidden            BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (transfer_id, connector_id)
    );
  `);
  await getPool().query(`ALTER TABLE transfer_metadata ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;`);
  await getPool().query(`ALTER TABLE transfer_metadata ADD COLUMN IF NOT EXISTS fetch_duration_ms INTEGER;`);

  // 협상 메타데이터: EDC에 완료 시각 필드가 없어 소요시간 계산을 위해 별도 저장
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS negotiation_metadata (
      negotiation_id  TEXT NOT NULL,
      connector_id    TEXT NOT NULL,
      started_at      TIMESTAMPTZ,
      completed_at    TIMESTAMPTZ,
      PRIMARY KEY (negotiation_id, connector_id)
    );
  `);

  // 사용자 계정 + RBAC 역할 (admin/operator/viewer)
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      email           TEXT UNIQUE NOT NULL,
      name            TEXT NOT NULL,
      role            TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
      password_hash   TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);

  // UI 알림: 사용자에게 표시되는 시스템/이벤트 알림
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      type        TEXT NOT NULL CHECK (type IN ('info', 'warn', 'error', 'success')),
      source      TEXT NOT NULL CHECK (source IN ('system', 'negotiation', 'transfer', 'edr', 'vc')),
      title       TEXT NOT NULL,
      message     TEXT NOT NULL,
      link        TEXT,
      read        BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Tractus-X 시맨틱 모델 (SAMM): 로컬 보관
  // - urn: 모델 식별자 (e.g. urn:samm:io.catenax.pcf:7.0.0#Pcf)
  // - status: DRAFT / RELEASED / STANDARDIZED / DEPRECATED
  // - model_type: SAMM / BAMM / other (UI 호환용)
  // - content: SAMM TTL/RDF 본문 (수 KB ~ 수십 KB)
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS semantic_models (
      urn             TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      version         TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'RELEASED', 'STANDARDIZED', 'DEPRECATED')),
      model_type      TEXT NOT NULL DEFAULT 'SAMM',
      content         TEXT NOT NULL DEFAULT '',
      description_ko  TEXT NOT NULL DEFAULT '',
      description_en  TEXT NOT NULL DEFAULT '',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_semantic_models_name ON semantic_models(name);`);

  // 글로벌 애플리케이션 설정 (key-value).
  // 예: identity_hub_url — 이 UI 인스턴스가 사용하는 단일 IdentityHub URL.
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * 첫 부팅 시 기본 계정 시드 (admin/operator/viewer).
 * 보안: 환경변수 `SEED_*_PASSWORD` 미설정 시 강력한 random password 생성 후 시작 로그에 1회 출력.
 * Production에서는 명시적 env 설정 권장 (random은 stdout만 남으므로 로그 캡처 못 하면 분실).
 */
async function seedDb(): Promise<void> {
  const { rowCount } = await getPool().query(`SELECT 1 FROM users LIMIT 1`);
  if (rowCount && rowCount > 0) return;

  // crypto.randomBytes 기반 base64url (24 bytes ≈ 32 chars)
  const randomPassword = (): string => {
    const arr = new Uint8Array(24);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: Crypto = (globalThis as any).crypto;
    c.getRandomValues(arr);
    return Buffer.from(arr).toString("base64url");
  };

  type SeedRole = "admin" | "operator" | "viewer";
  const seeds: Array<{ email: string; name: string; role: SeedRole; envKey: string }> = [
    { email: "admin@kmx.io",    name: "Admin User",    role: "admin",    envKey: "SEED_ADMIN_PASSWORD" },
    { email: "operator@kmx.io", name: "Ops Engineer",  role: "operator", envKey: "SEED_OPERATOR_PASSWORD" },
    { email: "viewer@kmx.io",   name: "Business User", role: "viewer",   envKey: "SEED_VIEWER_PASSWORD" },
  ];

  const printedCreds: Array<{ email: string; password: string }> = [];
  for (const s of seeds) {
    const envPw = process.env[s.envKey];
    const pwPlain = envPw && envPw.length >= 8 ? envPw : randomPassword();
    if (!envPw) printedCreds.push({ email: s.email, password: pwPlain });
    const pwHash = await hashPassword(pwPlain);
    await getPool().query(
      `INSERT INTO users (id, email, name, role, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [randomUUID(), s.email, s.name, s.role, pwHash],
    );
  }

  if (printedCreds.length > 0) {
    console.log("\n[DB] ┌─────────────────────────────────────────────────────────────");
    console.log("[DB] │  *** GENERATED INITIAL PASSWORDS (shown once, save now) ***");
    for (const { email, password } of printedCreds) {
      console.log(`[DB] │  ${email}  →  ${password}`);
    }
    console.log("[DB] │  Set SEED_{ADMIN,OPERATOR,VIEWER}_PASSWORD env to override.");
    console.log("[DB] └─────────────────────────────────────────────────────────────\n");
  } else {
    console.log("[DB] Seeded default users from SEED_*_PASSWORD env vars.");
  }
}

/** Initialize database: create schema + seed */
export async function initDb(): Promise<void> {
  await createSchema();
  await seedDb();
  console.log("[DB] Database initialized");
}

/** Graceful shutdown */
export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
}

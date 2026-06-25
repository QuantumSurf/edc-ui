// KMX EDC — PostgreSQL Database Module
// Connection pool + schema initialization

import pg from "pg";
import { randomUUID } from "crypto";
import { hashPassword } from "./auth.js";
import { readVaultSecret, writeVaultSecret } from "./platform.js";
import { encryptSecret } from "./crypto.js";

const { Pool } = pg;

let pool: pg.Pool;

export function getPool(): pg.Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      console.warn(
        "[DB] WARNING: DATABASE_URL env var is not set. Using default development connection string."
      );
    }
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        "postgresql://kmx:kmx_dev_123@localhost:5432/kmx_edc",
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

/** Create tables if not exists */
async function createSchema(): Promise<void> {
  // 멀티테넌트: 조직(참여자) = 테넌트. 사용자/커넥터/설정의 격리 단위.
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      bpn         TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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
      tenant_id       TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Migration: add identity_hub_url to existing tables
  await getPool().query(
    `ALTER TABLE connectors ADD COLUMN IF NOT EXISTS identity_hub_url TEXT;`
  );
  // Migration: add tenant_id (multi-tenant isolation)
  await getPool().query(
    `ALTER TABLE connectors ADD COLUMN IF NOT EXISTS tenant_id TEXT;`
  );

  // 테넌트별 설정 (Identity Hub 등). Vault 등 인스턴스 전역 설정은 app_settings 유지.
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS tenant_settings (
      tenant_id   TEXT NOT NULL,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, key)
    );
  `);

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
  await getPool().query(
    `ALTER TABLE transfer_metadata ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;`
  );
  await getPool().query(
    `ALTER TABLE transfer_metadata ADD COLUMN IF NOT EXISTS fetch_duration_ms INTEGER;`
  );

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
  await getPool().query(
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`
  );
  // Migration: associate each user with a tenant (multi-tenant)
  await getPool().query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id TEXT;`
  );
  // Migration: token_version(세션 강제종료) + 로그인 무차별 대입 잠금 컬럼.
  await getPool().query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;`
  );
  await getPool().query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0;`
  );
  await getPool().query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;`
  );

  // UI 알림: 사용자에게 표시되는 시스템/이벤트 알림
  // tenant_id: 테넌트(조직)별 격리 — 모든 조회/변경은 호출자 테넌트로 스코프된다.
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id   TEXT,
      type        TEXT NOT NULL CHECK (type IN ('info', 'warn', 'error', 'success')),
      source      TEXT NOT NULL CHECK (source IN ('system', 'negotiation', 'transfer', 'edr', 'vc')),
      title       TEXT NOT NULL,
      message     TEXT NOT NULL,
      link        TEXT,
      read        BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Migration: add tenant_id to existing notifications tables (multi-tenant isolation)
  await getPool().query(
    `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS tenant_id TEXT;`
  );
  await getPool().query(
    `CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id, created_at DESC);`
  );

  // Tractus-X 시맨틱 모델 (SAMM): 로컬 보관
  // - urn: 모델 식별자 (e.g. urn:samm:io.catenax.pcf:7.0.0#Pcf)
  // - status: DRAFT / RELEASED / STANDARDIZED / DEPRECATED
  // - model_type: SAMM / BAMM / other (UI 호환용)
  // - content: SAMM TTL/RDF 본문 (수 KB ~ 수십 KB)
  // tenant_id: 시맨틱 모델도 테넌트별 격리. URN 유니크는 (tenant_id, urn) 복합으로 잡아
  // 서로 다른 조직이 같은 URN 공간을 공유·덮어쓰지 못하도록 한다.
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS semantic_models (
      tenant_id       TEXT,
      urn             TEXT NOT NULL,
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
  // Migration: add tenant_id to legacy tables (urn-only PK 시절 데이터 보존).
  await getPool().query(
    `ALTER TABLE semantic_models ADD COLUMN IF NOT EXISTS tenant_id TEXT;`
  );
  // Migration: 기존 urn-only PK를 (tenant_id, urn) 복합 유니크로 전환(멱등).
  // - 레거시 PK(semantic_models_pkey) 제거 후 복합 유니크 인덱스 생성.
  await getPool().query(
    `ALTER TABLE semantic_models DROP CONSTRAINT IF EXISTS semantic_models_pkey;`
  );
  await getPool().query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_models_tenant_urn ON semantic_models(tenant_id, urn);`
  );
  await getPool().query(
    `CREATE INDEX IF NOT EXISTS idx_semantic_models_name ON semantic_models(name);`
  );

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

// prod 에서 거부할 흔한 약비번(소문자 비교). 길이 검사만으로는 'password' 등을 못 막는다.
const WEAK_SEED_PASSWORDS = new Set([
  "password",
  "password1",
  "12345678",
  "00000000",
  "admin123",
  "changeme",
  "qwerty123",
  "letmein1",
]);

/**
 * 첫 부팅 시 기본 데모 계정 시드 (admin/operator).
 * 데모 비밀번호 기본값은 "0000" (환경변수 SEED_*_PASSWORD로 재정의 가능).
 */
async function seedDb(): Promise<void> {
  const { rowCount } = await getPool().query(`SELECT 1 FROM users LIMIT 1`);
  if (rowCount && rowCount > 0) return;

  type SeedRole = "admin" | "operator" | "viewer";
  const seeds: Array<{
    email: string;
    name: string;
    role: SeedRole;
    envKey: string;
  }> = [
    {
      email: "admin@kmx.io",
      name: "Admin User",
      role: "admin",
      envKey: "SEED_ADMIN_PASSWORD",
    },
    // 이용자(소비자) 데모 계정은 실제 operator 역할로 시드 — admin 전용 RoleGate(connector:write,
    // vc:write 등)가 제대로 가려지는지 데모/QA에서 검증 가능하도록 한다(과거 admin 강제 승격은 제거).
    {
      email: "operator@kmx.io",
      name: "Ops Engineer",
      role: "operator",
      envKey: "SEED_OPERATOR_PASSWORD",
    },
  ];

  const printedCreds: Array<{ email: string; password: string }> = [];
  for (const s of seeds) {
    const envPw = process.env[s.envKey];
    // 프로덕션에서는 약한 기본 비밀번호 시드를 거부 — SEED_*_PASSWORD(>=8자, 흔한 약비번 금지).
    if (
      process.env.NODE_ENV === "production" &&
      (!envPw || envPw.length < 8 || WEAK_SEED_PASSWORDS.has(envPw.toLowerCase()))
    ) {
      throw new Error(
        `[DB] ${s.envKey} must be a strong value (>=8 chars, not a common password) in production — refusing to seed a weak default password.`
      );
    }
    const pwPlain = envPw && envPw.length >= 4 ? envPw : "0000";
    if (!envPw) printedCreds.push({ email: s.email, password: pwPlain });
    const pwHash = await hashPassword(pwPlain);
    await getPool().query(
      `INSERT INTO users (id, email, name, role, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [randomUUID(), s.email, s.name, s.role, pwHash]
    );
  }

  if (printedCreds.length > 0) {
    console.log(
      "\n[DB] ┌─────────────────────────────────────────────────────────────"
    );
    console.log(
      "[DB] │  *** GENERATED INITIAL PASSWORDS (shown once, save now) ***"
    );
    for (const { email, password } of printedCreds) {
      console.log(`[DB] │  ${email}  →  ${password}`);
    }
    console.log(
      "[DB] │  Set SEED_{ADMIN,OPERATOR,VIEWER}_PASSWORD env to override."
    );
    console.log(
      "[DB] └─────────────────────────────────────────────────────────────\n"
    );
  } else {
    console.log("[DB] Seeded default users from SEED_*_PASSWORD env vars.");
  }
}

/**
 * 멀티테넌트 마이그레이션 (매 부팅 idempotent).
 * - 커넥터의 distinct BPN마다 테넌트 보장 + 커넥터를 BPN으로 backfill
 * - 시드 계정(admin/operator/viewer)을 각각 별도 테넌트에 1:1 매핑
 *   (기존 커넥터 BPN을 우선 배정 → 계정별 격리된 플릿이 보이도록)
 */
async function migrateTenants(): Promise<void> {
  const pool = getPool();

  const ensureTenant = async (name: string, bpn: string): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE bpn = $1 LIMIT 1`,
      [bpn]
    );
    if (rows.length > 0) return rows[0].id;
    const id = randomUUID();
    await pool.query(
      `INSERT INTO tenants (id, name, bpn) VALUES ($1, $2, $3)`,
      [id, name, bpn]
    );
    return id;
  };

  // 1) 기존 커넥터 BPN마다 테넌트 보장
  const { rows: bpnRows } = await pool.query<{ bpn: string }>(
    `SELECT DISTINCT bpn FROM connectors WHERE bpn <> '' ORDER BY bpn DESC`
  );
  for (const { bpn } of bpnRows) await ensureTenant(`Org ${bpn}`, bpn);

  // 2) 커넥터 tenant_id backfill (BPN 매칭)
  await pool.query(
    `UPDATE connectors c SET tenant_id = t.id
       FROM tenants t
      WHERE c.bpn = t.bpn AND (c.tenant_id IS NULL OR c.tenant_id = '')`
  );

  // 3) 테넌트 없는 사용자에게 1:1 테넌트 배정
  const { rows: userRows } = await pool.query<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE tenant_id IS NULL OR tenant_id = '' ORDER BY email`
  );
  const bpnList = bpnRows.map(r => r.bpn);
  for (let i = 0; i < userRows.length; i++) {
    const u = userRows[i];
    let bpn = bpnList[i];
    let name: string;
    if (bpn) {
      name = `Org ${bpn}`;
    } else {
      const lp = u.email.split("@")[0];
      // 표준 BPNL 형식(^BPNL[0-9A-Z]+$)에 맞춰 하이픈 제거 — 카탈로그 counterPartyId 정규화 호환(id 27).
      bpn = `BPNLDEMO${lp.replace(/[^0-9A-Za-z]/g, "").toUpperCase()}`;
      name = `${lp.charAt(0).toUpperCase()}${lp.slice(1)} Org`;
    }
    const tid = await ensureTenant(name, bpn);
    await pool.query(`UPDATE users SET tenant_id = $1 WHERE id = $2`, [
      tid,
      u.id,
    ]);
  }

  // 4) 데모 계정 역할 정정(멱등): 과거 admin으로 강제 승격됐던 operator@kmx.io를 operator로 강등.
  //    RBAC 분리 검증이 가능하도록 admin이 아닌 실제 operator 역할로 되돌린다.
  await pool.query(
    `UPDATE users SET role = 'operator' WHERE email = 'operator@kmx.io' AND role = 'admin'`
  );
}

/**
 * 레거시 전역 app_settings의 IdentityHub 설정을 per-tenant tenant_settings로 백필.
 * 멀티테넌트 리팩터로 getIdentityHubConfig가 tenant_settings만 읽게 되면서, 과거 전역
 * 설정이 고아가 되어 분산신원 화면이 "미구성"으로 보이던 회귀를 자동 치유한다.
 * - 멱등: 값이 없거나 빈 경우에만 채우고, 사용자가 지정한 per-tenant 값은 보존.
 * - identity_hub_url: 공유 IH → 빈/누락 테넌트 모두에 전역 URL.
 * - identity_hub_participant_id: 누락/빈이면 해당 테넌트 자신의 BPN.
 * - identity_hub_api_key: 레거시 전역 키는 BPN == 레거시 participant_id인 테넌트에만(격리 유지).
 */
async function migrateIdentityHubSettings(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings
      WHERE key IN ('identity_hub_url', 'identity_hub_participant_id', 'identity_hub_api_key')`
  );
  const g: Record<string, string> = {};
  for (const r of rows) g[r.key] = (r.value ?? "").trim();
  const url = g.identity_hub_url ?? "";
  const legacyPid = g.identity_hub_participant_id ?? "";
  const apiKey = g.identity_hub_api_key ?? "";

  // 빈/누락 값만 채움(비어있지 않은 per-tenant 값은 DO UPDATE WHERE로 보존).
  const upsertIfEmpty = async (
    tenantId: string,
    key: string,
    value: string
  ): Promise<void> => {
    if (!value) return;
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, key, value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
       WHERE tenant_settings.value IS NULL OR tenant_settings.value = ''`,
      [tenantId, key, value]
    );
  };

  const { rows: tenants } = await pool.query<{ id: string; bpn: string }>(
    `SELECT id, bpn FROM tenants`
  );
  for (const t of tenants) {
    // 1) 레거시 전역 설정(url/participant) 백필 — 전역 url이 있을 때만.
    if (url) {
      await upsertIfEmpty(t.id, "identity_hub_url", url);
      await upsertIfEmpty(t.id, "identity_hub_participant_id", t.bpn);
      if (legacyPid && t.bpn === legacyPid) {
        await upsertIfEmpty(t.id, "identity_hub_api_key", apiKey);
      }
    }

    // 2) API 키를 vault alias 참조로 전환 — 각 테넌트에 alias 설정(미설정 시).
    const alias = `ih-apikey-${t.bpn}`;
    await upsertIfEmpty(t.id, "identity_hub_api_key_alias", alias);

    // 3) 레거시 평문 키가 남아 있으면 vault로 1회 이관(vault에 값 없을 때만) 후 평문 제거.
    //    vault 미가용 시 부팅이 실패하지 않도록 best-effort.
    try {
      const { rows: pk } = await pool.query<{ value: string }>(
        `SELECT value FROM tenant_settings WHERE tenant_id = $1 AND key = 'identity_hub_api_key'`,
        [t.id]
      );
      const plain = (pk[0]?.value ?? "").trim();
      if (plain) {
        let existing = "";
        try {
          existing = await readVaultSecret(alias);
        } catch {
          existing = "";
        }
        if (!existing) await writeVaultSecret(alias, plain);
        await pool.query(
          `UPDATE tenant_settings SET value = '', updated_at = NOW() WHERE tenant_id = $1 AND key = 'identity_hub_api_key'`,
          [t.id]
        );
      }
    } catch (e) {
      console.warn(
        `[DB] IH apikey → vault migration skipped for ${t.bpn}: ${(e as Error).message}`
      );
    }
  }
  console.log("[DB] IdentityHub settings reconciled (vault alias references)");
}

/**
 * 커넥터 EDC API Key 평문 → AES-256-GCM at-rest 암호화(멱등). 이미 enc:v1: 이면 건너뜀.
 * HUB_APIKEY_SECRET 미설정 시 prod 에서는 encryptSecret 가 throw → 해당 행은 건너뛰고
 * 경고만 남긴다(부팅 비차단). 평문은 decryptSecret 패스스루로 계속 동작하되, 암호화하려면
 * 운영자가 HUB_APIKEY_SECRET 을 설정해야 한다.
 */
async function migrateConnectorApiKeys(): Promise<void> {
  const { rows } = await getPool().query<{ id: string; api_key: string }>(
    `SELECT id, api_key FROM connectors WHERE api_key <> '' AND api_key NOT LIKE 'enc:v1:%'`
  );
  if (rows.length === 0) return;
  let migrated = 0;
  for (const r of rows) {
    try {
      const enc = encryptSecret(r.api_key);
      await getPool().query(`UPDATE connectors SET api_key = $1 WHERE id = $2`, [
        enc,
        r.id,
      ]);
      migrated++;
    } catch (e) {
      console.warn(
        `[DB] connector ${r.id} api_key 암호화 실패(HUB_APIKEY_SECRET 확인) — 평문 유지: ${(e as Error).message}`
      );
    }
  }
  if (migrated > 0)
    console.log(`[DB] connector api_key ${migrated}건 at-rest 암호화 완료`);
}

/** Initialize database: create schema + seed */
export async function initDb(): Promise<void> {
  await createSchema();
  await seedDb();
  await migrateTenants();
  await migrateIdentityHubSettings();
  await migrateConnectorApiKeys();
  // tenants.bpn 유니크 백스톱 — BPN = 로그인 식별자라는 불변식을 DB 레벨에서 강제한다.
  // 이게 없으면 동시 PUT /settings/tenant 의 isBpnTaken 선검사가 TOCTOU 경합으로 뚫려
  // 동일 BPN 이 두 테넌트에 생겨 로그인 라우팅이 모호해진다(CWE-367). 레거시 중복이 이미
  // 있으면 인덱스 생성이 실패할 수 있어 best-effort(부팅 비차단)로 경고만 남긴다.
  try {
    await getPool().query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_bpn ON tenants(bpn);`
    );
  } catch (e) {
    console.warn(
      `[DB] tenants.bpn 유니크 인덱스 생성 실패(중복 BPN 존재 가능) — 수동 정리 필요: ${(e as Error).message}`
    );
  }
  console.log("[DB] Database initialized");
}

/** Graceful shutdown */
export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
}

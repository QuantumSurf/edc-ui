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
      // 멀티테넌트 단일 서버 — 사용자 요청 + 백그라운드 폴러/감사 쓰기가 한 풀을 공유하므로
      // env 로 상향 조정 가능(기본 20). 너무 작으면 부하 시 pool timeout(5s) 발생.
      max: Number(process.env.DB_POOL_MAX) || 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // 폭주 쿼리 방어(선택) — 설정 시 서버측(statement)·클라측(query) 타임아웃을 건다.
      // 기본 off: 마이그레이션/보존정리 같은 긴 쿼리를 임의로 끊지 않기 위함.
      ...(Number(process.env.DB_STATEMENT_TIMEOUT_MS) > 0
        ? {
            statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS),
            query_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS),
          }
        : {}),
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

  // Migration: 테넌트 오프보딩(H8) — 아카이브(소프트삭제) 타임스탬프. NULL=활성, 값=아카이브 시각.
  // 로그인/세션을 즉시 차단하고, 보존기간 경과 후 CLI purge 로 하드삭제한다.
  await getPool().query(
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;`
  );

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
      -- started_at 은 /start(전송 시작) 시에만 명시 세팅. fetch/complete/terminate/삭제 등
      -- start 가 아닌 INSERT 는 NULL 로 둬 mapTransfer 가 EDC createdAt(실제 전송 시각)으로
      -- 폴백하게 한다(과거 DEFAULT NOW() 가 모든 INSERT 에 '지금'을 찍어, 이미 완료/실패한 전송을
      -- fetch 하면 전송 시각이 완료 시각보다 늦게 표시되던 버그 방지).
      started_at        TIMESTAMPTZ,
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
  // Migration(멱등): started_at 의 DEFAULT NOW()/NOT NULL 제거 — start 가 아닌 INSERT 가
  // started_at 을 '지금'으로 잘못 찍던 것을 막는다(전송/완료 시각 역전 버그 수정).
  await getPool().query(
    `ALTER TABLE transfer_metadata ALTER COLUMN started_at DROP DEFAULT;`
  );
  await getPool().query(
    `ALTER TABLE transfer_metadata ALTER COLUMN started_at DROP NOT NULL;`
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
  // 성공률 KPI 용 최종 상태 — 목록 라우트가 터미널 상태 도달 시 1회 기록한다.
  // (협상: FINALIZED/TERMINATED, 전송: COMPLETED/TERMINATED — 소비자완료 오버레이 반영)
  await getPool().query(
    `ALTER TABLE negotiation_metadata ADD COLUMN IF NOT EXISTS last_state TEXT;`
  );
  await getPool().query(
    `ALTER TABLE transfer_metadata ADD COLUMN IF NOT EXISTS last_state TEXT;`
  );

  // 핫 조회는 WHERE connector_id=$1 로만 필터하는데, 복합 PK 의 후행 컬럼은 이 조건을 못 타
  // 매 목록/카운트/stats 요청이 seq-scan 이 된다. connector_id 단독 인덱스로 커버.
  await getPool().query(
    `CREATE INDEX IF NOT EXISTS idx_transfer_meta_connector ON transfer_metadata(connector_id);`
  );
  await getPool().query(
    `CREATE INDEX IF NOT EXISTS idx_negotiation_meta_connector ON negotiation_metadata(connector_id);`
  );

  // EDR 토큰 공유 저장소(멀티레플리카) — provider 데이터플레인 EDR 의 액세스/refresh 토큰
  // 쌍을 전송별로 공유해, 어느 레플리카가 갱신하든 최신 토큰을 모두가 본다(인메모리
  // 프로세스별 캐시의 stale/중복 refresh 제거). 토큰은 at-rest 암호화(server/lib/crypto.ts).
  // FOR UPDATE 행잠금으로 동시 refresh 를 직렬화한다(edrRefresh.ts).
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS edr_tokens (
      connector_id     TEXT NOT NULL,
      tp_id            TEXT NOT NULL,
      access_token     TEXT NOT NULL,
      refresh_token    TEXT,
      refresh_endpoint TEXT,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (connector_id, tp_id)
    );
  `);
  await getPool().query(
    `CREATE INDEX IF NOT EXISTS idx_edr_tokens_updated ON edr_tokens(updated_at);`
  );

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
  // Migration: i18n 지원 — 알림을 완성 문장이 아니라 msg_key + msg_params 로 저장해
  // 표시 시점에 사용자 언어로 번역한다. (기존 title/message 는 폴백으로 유지)
  await getPool().query(
    `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS msg_key TEXT;`
  );
  await getPool().query(
    `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS msg_params JSONB;`
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

  // 감사 로그(Audit Log): 변이(생성/수정/삭제)·로그인 등 보안 이벤트를 실데이터로 기록.
  // tenant_id 로 테넌트 격리(조회는 호출자 테넌트로 스코프). actor_*= 행위자, action/category=
  // 행위 분류, result/severity=결과·심각도, status_code/method/path=기술 컨텍스트.
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id     TEXT,
      actor_id      TEXT,
      actor_email   TEXT,
      actor_role    TEXT,
      action        TEXT NOT NULL,
      category      TEXT NOT NULL,
      target        TEXT,
      target_type   TEXT,
      connector_id  TEXT,
      result        TEXT NOT NULL CHECK (result IN ('SUCCESS', 'FAILURE')),
      severity      TEXT NOT NULL DEFAULT 'INFO'
                    CHECK (severity IN ('INFO', 'WARN', 'CRITICAL')),
      status_code   INTEGER,
      ip            TEXT,
      user_agent    TEXT,
      method        TEXT,
      path          TEXT,
      message       TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await getPool().query(
    `CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id, created_at DESC);`
  );

  // 입력 이력(Field History): 작성 폼의 자유텍스트 입력값을 테넌트별로 저장 → 자동완성 제안.
  // (tenant_id, field_key, value) 복합 PK 로 멱등 upsert, use_count/last_used_at 로 빈도·최근순 정렬.
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS field_history (
      tenant_id     TEXT NOT NULL,
      field_key     TEXT NOT NULL,
      value         TEXT NOT NULL,
      use_count     INTEGER NOT NULL DEFAULT 1,
      last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, field_key, value)
    );
  `);
  await getPool().query(
    `CREATE INDEX IF NOT EXISTS idx_field_history_lookup
       ON field_history(tenant_id, field_key, use_count DESC, last_used_at DESC);`
  );
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
      (!envPw ||
        envPw.length < 8 ||
        WEAK_SEED_PASSWORDS.has(envPw.toLowerCase()))
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

  // 1회성 마이그레이션 — 커넥터 BPN 으로부터 테넌트를 자동 생성하는 동작(step 1)을 매 부팅
  // 반복하면 BPN drift·DB 복원·수동 편집 등으로 로그인 불가한 'Org {bpn}' 고아 테넌트가 계속
  // 생긴다. app_settings 마커로 최초 1회만 실행한다(이후 테넌트는 명시적 온보딩으로만 생성).
  const MIGRATION_MARKER = "migration:tenants-from-connectors-v1";
  const { rows: doneRows } = await pool.query(
    `SELECT 1 FROM app_settings WHERE key = $1`,
    [MIGRATION_MARKER]
  );
  if (doneRows.length > 0) return;

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

  // 마커 기록 — 다음 부팅부터 재실행하지 않는다(고아 테넌트 재생성 방지).
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, 'done', NOW())
     ON CONFLICT (key) DO UPDATE SET value = 'done', updated_at = NOW()`,
    [MIGRATION_MARKER]
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
      await getPool().query(
        `UPDATE connectors SET api_key = $1 WHERE id = $2`,
        [enc, r.id]
      );
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

/** 스키마/마이그레이션 버전 — 스키마 변경 시 갱신한다. readiness 게이팅에 사용:
 *  롤링 배포 때 구버전 파드가 새 스키마로 마이그레이션된 DB 를 만나면 NotReady 로 빠져
 *  트래픽에서 제외된다(구/신 스키마 파드 동시 서빙으로 인한 일시 500 방지). */
export const SCHEMA_VERSION = "2026-07-02";

/** 이 프로세스의 SCHEMA_VERSION 이 DB 에 기록된 버전과 일치하는지 — /readyz 게이팅용. */
export async function isSchemaReady(): Promise<boolean> {
  try {
    const { rows } = await getPool().query<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'schema_version'`
    );
    return rows[0]?.value === SCHEMA_VERSION;
  } catch {
    return false;
  }
}

/** Initialize database: create schema + seed */
export async function initDb(): Promise<void> {
  // 멀티레플리카 콜드스타트에서 여러 레플리카가 스키마 생성/시드/마이그레이션을 shared Postgres 에
  // 동시 실행하면 경합이 생긴다(예: migrateTenants 의 ensureTenant 중복 INSERT → 뒤이은 중복 BPN
  // 가드가 양쪽 부팅을 거부). advisory lock 으로 한 번에 한 레플리카만 초기화하도록 직렬화한다.
  // (프로세스가 죽으면 세션 종료로 락이 자동 해제된다.)
  const INIT_LOCK_KEY = 4915231;
  const lockClient = await getPool().connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock($1)", [INIT_LOCK_KEY]);
    await runInit();
  } finally {
    await lockClient
      .query("SELECT pg_advisory_unlock($1)", [INIT_LOCK_KEY])
      .catch(() => {});
    lockClient.release();
  }
}

async function runInit(): Promise<void> {
  await createSchema();
  await seedDb();
  await migrateTenants();
  await migrateIdentityHubSettings();
  await migrateConnectorApiKeys();
  // tenants.bpn 유니크 백스톱 — BPN = 로그인 식별자라는 불변식을 DB 레벨에서 강제한다.
  // 이게 없으면 동시 PUT /settings/tenant 의 isBpnTaken 선검사가 TOCTOU 경합으로 뚫려
  // 동일 BPN 이 두 테넌트에 생겨 로그인 라우팅(WHERE bpn=$1 ... LIMIT 1)이 모호해진다
  // (CWE-367) → 사용자가 자기 BPN 으로 로그인했는데 다른 테넌트로 바인딩되는 교차테넌트 로그인.
  // 멀티테넌트 SaaS 에서 이는 출시 차단급 결함이므로 fail-closed: 중복 BPN 이 존재하면
  // 조용히 진행(경고만)하지 않고 부팅을 거부해 수동 정리를 강제한다.
  const dupBpn = await getPool().query<{ bpn: string; n: string }>(
    `SELECT bpn, COUNT(*) AS n FROM tenants GROUP BY bpn HAVING COUNT(*) > 1`
  );
  if (dupBpn.rows.length > 0) {
    const list = dupBpn.rows.map(r => `${r.bpn}(x${r.n})`).join(", ");
    throw new Error(
      `[DB] 중복 BPN 발견 — 멀티테넌트 로그인 격리가 깨집니다(교차테넌트 로그인 위험). ` +
        `중복을 정리한 뒤 재기동하세요: ${list}`
    );
  }
  await getPool().query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_bpn ON tenants(bpn);`
  );
  // 스키마 버전 마커 기록 — 마이그레이션 완료 후. /readyz 가 이 값으로 준비 여부를 게이팅한다.
  await getPool().query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('schema_version', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [SCHEMA_VERSION]
  );
  console.log(`[DB] Database initialized (schema ${SCHEMA_VERSION})`);
}

/** Graceful shutdown */
export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
}

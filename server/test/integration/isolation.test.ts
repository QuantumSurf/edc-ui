// KMX EDC — 멀티테넌트 격리 통합테스트 (H11)
// testcontainers 로 격리된 Postgres 를 띄우고, 실제 Express 앱(buildApp)에 supertest 로
// 두 테넌트 세션을 만들어 데이터 격리를 검증한다. Docker 미가용 환경에서는 스위트를 우아하게
// 건너뛴다(단위 스위트 차단 방지).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { Express } from "express";

let container: StartedPostgreSqlContainer | undefined;
let closeDb: (() => Promise<void>) | undefined;
let app: Express;
let ready = false;

// 두 테넌트(admin/operator 시드) — migrateTenants 가 무커넥터 사용자에게 BPNLDEMO* BPN 을 배정.
let tenantA: { bpn: string; connectorId: string };
let tenantB: { bpn: string; connectorId: string };

beforeAll(async () => {
  try {
    // 이미 dev 로 pull 된 이미지를 재사용해 빠르게 기동.
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
  } catch (err) {
    console.warn(
      "[integration] Docker/testcontainers 미가용 — 격리 통합테스트 skip:",
      (err as Error).message
    );
    return;
  }

  // db/app 은 DATABASE_URL 을 지연 참조(getPool 최초 호출=initDb). 설정 후 동적 import.
  process.env.DATABASE_URL = container.getConnectionUri();
  const db = await import("../../lib/db.js");
  const { buildApp } = await import("../../app.js");
  closeDb = db.closeDb;

  await db.initDb(); // 스키마 + admin/operator 시드 + migrateTenants(테넌트 자동배정)
  app = buildApp();

  const pool = db.getPool();
  const { rows } = await pool.query<{ bpn: string; role: string; tid: string }>(
    `SELECT t.bpn, u.role, t.id AS tid
       FROM users u JOIN tenants t ON u.tenant_id = t.id
      ORDER BY u.role`
  );
  const admin = rows.find(r => r.role === "admin");
  const operator = rows.find(r => r.role === "operator");
  if (!admin || !operator) throw new Error("시드 테넌트 조회 실패");

  // 각 테넌트에 커넥터 1개씩 심는다(격리 대상). management/dsp 는 .invalid TLD 라 EDC 호출이
  // DNS 즉시 실패(타임아웃 없음) → 목록엔 status:down 으로 포함된다.
  const mkConn = (tid: string, bpn: string, id: string) =>
    pool.query(
      `INSERT INTO connectors (id, name, bpn, management_url, dsp_endpoint, env, tenant_id)
       VALUES ($1, $2, $3, 'http://edc.invalid', 'http://edc.invalid', 'DEV', $4)`,
      [id, `Conn ${id}`, bpn, tid]
    );
  await mkConn(admin.tid, admin.bpn, "conn-a");
  await mkConn(operator.tid, operator.bpn, "conn-b");

  tenantA = { bpn: admin.bpn, connectorId: "conn-a" };
  tenantB = { bpn: operator.bpn, connectorId: "conn-b" };
  ready = true;
}, 180_000);

afterAll(async () => {
  if (closeDb) await closeDb().catch(() => {});
  if (container) await container.stop().catch(() => {});
}, 30_000);

async function loginAgent(bpn: string) {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/login")
    .send({ tenantId: bpn, password: "0000" });
  expect(res.status).toBe(200);
  return agent;
}

describe("멀티테넌트 격리 (통합, testcontainers Postgres)", () => {
  it("각 테넌트는 자기 커넥터만 목록에서 본다(양방향 스코프)", async () => {
    if (!ready) return; // Docker 미가용 → skip
    const a = await loginAgent(tenantA.bpn);
    const b = await loginAgent(tenantB.bpn);

    const listA = await a.get("/api/connectors");
    expect(listA.status).toBe(200);
    const idsA = (listA.body as Array<{ id: string }>).map(c => c.id);
    expect(idsA).toContain(tenantA.connectorId);
    expect(idsA).not.toContain(tenantB.connectorId);

    const listB = await b.get("/api/connectors");
    expect(listB.status).toBe(200);
    const idsB = (listB.body as Array<{ id: string }>).map(c => c.id);
    expect(idsB).toContain(tenantB.connectorId);
    expect(idsB).not.toContain(tenantA.connectorId);
  });

  it("타 테넌트 커넥터 하위 경로 접근은 404 (requireConnectorOwnership — 존재 미노출)", async () => {
    if (!ready) return;
    const a = await loginAgent(tenantA.bpn);
    // A 가 B 의 커넥터 counts 조회 시도 → 소유권 미들웨어가 404(교차테넌트, EDC 도달 전 차단).
    const res = await a.get(`/api/connectors/${tenantB.connectorId}/counts`);
    expect(res.status).toBe(404);

    // 대칭: B → A 커넥터도 404.
    const b = await loginAgent(tenantB.bpn);
    const res2 = await b.get(`/api/connectors/${tenantA.connectorId}/counts`);
    expect(res2.status).toBe(404);
  });

  it("무인증 상태로는 세션 쿠키가 없어 로그인 응답이 Set-Cookie(httpOnly)를 내려준다", async () => {
    if (!ready) return;
    const res = await request(app)
      .post("/api/auth/login")
      .send({ tenantId: tenantA.bpn, password: "0000" });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.some(c => /kmx_token=.*HttpOnly/i.test(c))).toBe(true);
    expect(setCookie.some(c => /kmx_csrf=/.test(c))).toBe(true);
    // 본문에 토큰이 노출되지 않아야 한다(httpOnly 쿠키로만 운반).
    expect(res.body.token).toBeUndefined();
  });
});

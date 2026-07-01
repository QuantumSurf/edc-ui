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
    const msg = `[integration] Docker/testcontainers 미가용: ${(err as Error).message}`;
    // 반드시 격리를 검증해야 하는 환경(CI 통합 잡)에서는 조용한 그린 금지 — 명확히 실패시킨다.
    if (process.env.REQUIRE_INTEGRATION === "1") throw new Error(msg);
    console.warn(msg + " — 격리 통합테스트 skip");
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
  it("각 테넌트는 자기 커넥터만 목록에서 본다(양방향 스코프)", async ctx => {
    if (!ready) ctx.skip(); // Docker 미가용 → 실제 skip(통과 오집계 방지)
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

  it("타 테넌트 커넥터 하위 경로 접근은 404 (requireConnectorOwnership — 존재 미노출)", async ctx => {
    if (!ready) ctx.skip();
    const a = await loginAgent(tenantA.bpn);

    // 양성 대조: 자기 커넥터는 소유권 가드를 통과해야 한다 → 404(존재 미노출)가 아니어야 함.
    // (edc.invalid 라 EDC 집계는 실패해 5xx 일 수 있으나, 404 면 격리 자체가 깨진 것.) 이 대조가
    // 없으면 '모두에게 안 보이는 전역 고장'도 교차테넌트 404 로 거짓 통과할 수 있다.
    const own = await a.get(`/api/connectors/${tenantA.connectorId}/counts`);
    expect(own.status).not.toBe(404);

    // 교차테넌트: A 가 B 의 커넥터 counts 조회 → 소유권 미들웨어가 404(EDC 도달 전 차단) + 존재
    // 미노출 바디. 상태코드뿐 아니라 사유(connector-not-found)까지 단언한다.
    const res = await a.get(`/api/connectors/${tenantB.connectorId}/counts`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "connector-not-found" });

    // 대칭: B → A 커넥터도 404.
    const b = await loginAgent(tenantB.bpn);
    const res2 = await b.get(`/api/connectors/${tenantA.connectorId}/counts`);
    expect(res2.status).toBe(404);
  });

  it("무인증 상태로는 세션 쿠키가 없어 로그인 응답이 Set-Cookie(httpOnly)를 내려준다", async ctx => {
    if (!ready) ctx.skip();
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

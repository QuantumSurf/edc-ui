// KMX EDC — 라우트 레벨 통합테스트 (인증 · CSRF · 세션 무효화 · RBAC)
//
// isolation.test.ts 가 '테넌트 격리'를 검증한다면, 이 스위트는 라우트 앞단 가드
// (인증·CSRF·역할)가 실제 HTTP 경로에서 동작하는지 검증한다. 단위 테스트(csrf.test.ts 등)는
// 미들웨어를 목 req/res 로만 보므로, 실제 앱에 배선됐는지·순서가 맞는지는 잡지 못한다.
//
// testcontainers Postgres + 실제 buildApp() + supertest. Docker 미가용 시 우아하게 skip
// (REQUIRE_INTEGRATION=1 이면 조용한 그린 대신 명확히 실패).

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

// 시드 계정은 역할별로 별도 테넌트에 1:1 매핑된다(admin / operator). 로그인 식별자는 BPN.
let adminBpn = "";
let operatorBpn = "";

beforeAll(async () => {
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
  } catch (err) {
    const msg = `[integration] Docker/testcontainers 미가용: ${(err as Error).message}`;
    if (process.env.REQUIRE_INTEGRATION === "1") throw new Error(msg);
    console.warn(msg + " — 라우트 통합테스트 skip");
    return;
  }

  process.env.DATABASE_URL = container.getConnectionUri();
  const db = await import("../../lib/db.js");
  const { buildApp } = await import("../../app.js");
  closeDb = db.closeDb;

  await db.initDb();
  app = buildApp();

  const { rows } = await db.getPool().query<{
    bpn: string;
    role: string;
  }>(`SELECT t.bpn, u.role FROM users u JOIN tenants t ON u.tenant_id = t.id`);
  adminBpn = rows.find(r => r.role === "admin")?.bpn ?? "";
  operatorBpn = rows.find(r => r.role === "operator")?.bpn ?? "";
  if (!adminBpn || !operatorBpn)
    throw new Error("시드 테넌트(admin/operator) 조회 실패");
  ready = true;
}, 180_000);

afterAll(async () => {
  if (closeDb) await closeDb().catch(() => {});
  if (container) await container.stop().catch(() => {});
}, 30_000);

/** 로그인 후 agent(쿠키 보관)와 CSRF 토큰 값을 함께 돌려준다. */
async function login(bpn: string) {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/login")
    .send({ tenantId: bpn, password: "0000" });
  expect(res.status).toBe(200);
  const setCookie = (res.headers["set-cookie"] as unknown as string[]) ?? [];
  const csrf = setCookie
    .map(c => /(?:^|;\s*)kmx_csrf=([^;]+)/.exec(c)?.[1])
    .find(Boolean);
  if (!csrf) throw new Error("kmx_csrf 쿠키가 발급되지 않았다");
  return { agent, csrf: decodeURIComponent(csrf) };
}

describe("라우트 가드 (통합: 인증·CSRF·세션·RBAC)", () => {
  it("잘못된 비밀번호는 401 invalid-credentials", async ctx => {
    if (!ready) ctx.skip();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ tenantId: adminBpn, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid-credentials" });
  });

  it("타입이 틀린 로그인 바디는 400 (문자열 강제)", async ctx => {
    if (!ready) ctx.skip();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ tenantId: 123, password: null });
    expect(res.status).toBe(400);
  });

  it("GET /api/auth/me 는 세션 사용자(역할·테넌트)를 돌려준다", async ctx => {
    if (!ready) ctx.skip();
    const { agent } = await login(adminBpn);
    const res = await agent.get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("admin");
    expect(res.body.email).toBeTruthy();
    // 비밀번호 해시 등 민감정보가 새지 않아야 한다.
    expect(res.body.password_hash).toBeUndefined();
    expect(res.body.passwordHash).toBeUndefined();
  });

  it("변이 요청에 X-CSRF-Token 이 없으면 403 (double-submit 강제)", async ctx => {
    if (!ready) ctx.skip();
    const { agent } = await login(adminBpn);
    // 쿠키는 붙지만 CSRF 헤더가 없다 → csrfProtection 이 차단해야 한다.
    const res = await agent.post("/api/auth/logout");
    expect(res.status).toBe(403);
  });

  it("올바른 CSRF 토큰이면 통과하고, 로그아웃은 기존 세션을 무효화한다", async ctx => {
    if (!ready) ctx.skip();
    const { agent, csrf } = await login(adminBpn);

    // 로그아웃 전에는 세션이 살아 있다.
    expect((await agent.get("/api/auth/me")).status).toBe(200);

    const out = await agent.post("/api/auth/logout").set("X-CSRF-Token", csrf);
    expect(out.status).not.toBe(403); // CSRF 통과
    expect(out.status).toBeLessThan(300);

    // token_version 증가 → 같은 쿠키를 계속 써도 더는 인증되지 않는다(탈취 토큰 회수).
    const after = await agent.get("/api/auth/me");
    expect(after.status).toBe(401);
  });

  it("무인증 상태로 보호 라우트에 접근하면 200 이 아니다", async ctx => {
    if (!ready) ctx.skip();
    const res = await request(app).get("/api/auth/me");
    expect(res.status).not.toBe(200);
    expect([401, 403]).toContain(res.status);
  });

  it("operator 는 admin 전용 라우트에서 403 (역할 게이팅)", async ctx => {
    if (!ready) ctx.skip();
    const { agent, csrf } = await login(operatorBpn);
    const res = await agent
      .put("/api/system/settings/tenant")
      .set("X-CSRF-Token", csrf)
      .send({ name: "op-attempt" });
    expect(res.status).toBe(403);
  });

  it("admin 은 같은 라우트에서 403 이 아니다 (양성 대조)", async ctx => {
    if (!ready) ctx.skip();
    const { agent, csrf } = await login(adminBpn);
    const res = await agent
      .put("/api/system/settings/tenant")
      .set("X-CSRF-Token", csrf)
      .send({ name: "admin-allowed" });
    // 역할 게이트를 통과했는지만 본다(하위 처리 결과는 이 테스트의 관심사가 아니다).
    expect(res.status).not.toBe(403);
  });
});

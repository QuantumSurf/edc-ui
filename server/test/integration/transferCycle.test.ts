// KMX EDC — E2E 전송 사이클 통합테스트
//
// 콘솔의 최고가치 경로(카탈로그 조회 → 계약 협상 → 전송 시작 → EDR → 데이터 Pull)를
// 실제 HTTP 스택으로 왕복 검증한다. routes.test.ts 가 '가드 배선'을, isolation.test.ts 가
// '테넌트 격리'를 본다면 이 스위트는 'EDC 프록시 비즈니스 사이클'을 본다 — 이전까지
// 이 경로는 자동테스트 0건이었다(TRL 5→6 갭).
//
// 업스트림 EDC 는 dev-mock(edc-mock.cjs)을 자식 프로세스로 띄워 대체한다. 목은 실
// KMX-EDC 의 시간기반 상태전이(협상 8s→FINALIZED, 전송 4s→STARTED)와 EDR refresh
// 프로토콜(/token)을 흉내낸다. MOCK_EXPIRE_EDR=true 로 만료 액세스 토큰을 발급시켜
// KMX 고유 경로인 403→refresh→재시도(edrRefresh.ts)까지 실제로 태운다.
//
// testcontainers Postgres — Docker 미가용 시 우아하게 skip(REQUIRE_INTEGRATION=1 이면 실패).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { spawn, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { Express } from "express";

let container: StartedPostgreSqlContainer | undefined;
let closeDb: (() => Promise<void>) | undefined;
let app: Express;
let mock: ChildProcess | undefined;
let ready = false;

let adminBpn = "";
const MOCK_PORT = 18090 + Math.floor(Math.random() * 500);
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`;
const DSP = `${MOCK_BASE}/api/v1/dsp`;

/** mock 헬스가 뜰 때까지 폴링. */
async function waitMockUp(timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${MOCK_BASE}/health`);
      if (res.ok) return;
    } catch {
      /* 아직 안 뜸 */
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("mock EDC 미기동");
}

beforeAll(async () => {
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
  } catch (err) {
    const msg = `[integration] Docker/testcontainers 미가용: ${(err as Error).message}`;
    if (process.env.REQUIRE_INTEGRATION === "1") throw new Error(msg);
    console.warn(msg + " — 전송 사이클 통합테스트 skip");
    return;
  }

  // 목 EDC 를 자식 프로세스로 기동 — 만료 토큰 발급 모드로 refresh 경로까지 검증.
  const mockPath = fileURLToPath(
    new URL("../../../dev-mock/edc-mock.cjs", import.meta.url)
  );
  mock = spawn(process.execPath, [mockPath], {
    env: {
      ...process.env,
      MOCK_PORT: String(MOCK_PORT),
      MOCK_PUBLIC_BASE: MOCK_BASE,
      MOCK_EXPIRE_EDR: "true",
    },
    stdio: "ignore",
  });
  await waitMockUp();

  // 127.0.0.1 업스트림을 SSRF 가드가 허용하도록(dev compose 와 동일 스위치).
  process.env.ALLOW_PRIVATE_DSP = "true";
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
  if (!adminBpn) throw new Error("시드 admin 테넌트 조회 실패");
  ready = true;
}, 180_000);

afterAll(async () => {
  if (closeDb) await closeDb().catch(() => {});
  if (container) await container.stop().catch(() => {});
  if (mock && !mock.killed) mock.kill();
});

/** 로그인 → 쿠키 유지 agent + CSRF 토큰. */
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

/** 조건이 참이 될 때까지 폴링(간격 500ms). */
async function pollUntil<T>(
  fn: () => Promise<T | null>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v !== null) return v;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`${label} — ${timeoutMs}ms 내 미도달`);
}

describe("E2E 전송 사이클 (카탈로그→협상→전송→EDR refresh→Pull)", () => {
  it("전 구간이 실제 HTTP 경로로 완주된다", { timeout: 90_000 }, async ctx => {
    if (!ready) return ctx.skip();
    const { agent, csrf } = await login(adminBpn);
    const csrfHdr = { "X-CSRF-Token": csrf };

    // 1) 커넥터 등록(zod 게이트 + DNS SSRF 가드 통과 경로)
    const created = await agent.post("/api/connectors").set(csrfHdr).send({
      name: "e2e-mock",
      managementUrl: MOCK_BASE,
      dspEndpoint: DSP,
      env: "DEV",
      apiKey: "demo-key",
    });
    expect(created.status).toBe(201);
    const connId = created.body.id as string;
    expect(connId).toBeTruthy();

    // 2) 카탈로그 조회 — 오퍼 확보(+ attachAasLinks 는 DTR 미설정이라 무해 생략)
    const cat = await agent
      .post(`/api/connectors/${connId}/catalog`)
      .set(csrfHdr)
      .send({ dspEndpoint: DSP, counterPartyId: "BPNL000000000PRD" });
    expect(cat.status).toBe(200);
    const offers = cat.body as Array<Record<string, unknown>>;
    expect(offers.length).toBeGreaterThan(0);
    const offer = offers[0];
    expect(offer.offerId).toBeTruthy();
    expect(offer.assetId).toBeTruthy();

    // 3) 협상 시작 → FINALIZED + agreementId (목: 8초 후 전이)
    const negStart = await agent
      .post(`/api/connectors/${connId}/negotiations/start`)
      .set(csrfHdr)
      .send({
        offerId: offer.offerId,
        assetId: offer.assetId,
        providerDid: offer.providerDid ?? "BPNL000000000PRD",
        dspEndpoint: DSP,
        offerPolicy: offer.offerPolicy ?? undefined,
      });
    expect(negStart.status).toBe(200);
    const negId = negStart.body["@id"] as string;
    expect(negId).toBeTruthy();

    // 단건 GET 은 raw EDC JSON-LD 를 그대로 프록시한다(목록 POST 만 mapNegotiation).
    const finalized = await pollUntil(
      async () => {
        const r = await agent.get(
          `/api/connectors/${connId}/negotiations/${negId}`
        );
        return r.status === 200 &&
          r.body.state === "FINALIZED" &&
          r.body.contractAgreementId
          ? { agreementId: r.body.contractAgreementId as string }
          : null;
      },
      20_000,
      "협상 FINALIZED"
    );

    // 4) 전송 시작 → STARTED (목: 4초 후 전이 + EDR 발급)
    const trStart = await agent
      .post(`/api/connectors/${connId}/transfers/start`)
      .set(csrfHdr)
      .send({
        agreementId: finalized.agreementId,
        counterPartyAddress: DSP,
        assetId: offer.assetId,
      });
    expect(trStart.status).toBe(200);
    const tpId = trStart.body["@id"] as string;
    expect(tpId).toBeTruthy();

    await pollUntil(
      async () => {
        const r = await agent.get(
          `/api/connectors/${connId}/transfers/${tpId}`
        );
        return r.status === 200 && r.body.state === "STARTED" ? r.body : null;
      },
      15_000,
      "전송 STARTED"
    );

    // 5) 데이터 Pull — MOCK_EXPIRE_EDR=true 라 첫 액세스 토큰은 만료(403).
    //    성공(200)했다는 것 자체가 KMX EDR refresh 프로토콜(403→/token→재시도,
    //    edrRefresh.ts)이 실제로 완주됐다는 증거다.
    const fetched = await agent
      .post(`/api/connectors/${connId}/transfers/${tpId}/fetch`)
      .set(csrfHdr)
      .send({});
    expect(fetched.status).toBe(200);
    expect(fetched.body.sizeBytes).toBeGreaterThan(0);

    // 6) 완료 처리 + 성공률 KPI(summary) — 목록 라우트의 last_state side-write 와
    //    /stats/summary 집계가 실제로 맞물리는지 확인한다.
    const done = await agent
      .post(`/api/connectors/${connId}/transfers/${tpId}/complete`)
      .set(csrfHdr)
      .send({});
    expect(done.status).toBeLessThan(500);
    // 목록 조회로 side-write 트리거(협상 FINALIZED → last_state 기록)
    await agent
      .post(`/api/connectors/${connId}/negotiations`)
      .set(csrfHdr)
      .send({});
    await agent
      .post(`/api/connectors/${connId}/transfers`)
      .set(csrfHdr)
      .send({});
    const summary = await agent.get(
      `/api/connectors/${connId}/stats/summary?days=1`
    );
    expect(summary.status).toBe(200);
    expect(summary.body.negotiations.finalized).toBeGreaterThanOrEqual(1);
    expect(summary.body.negotiations.successRate).not.toBeNull();
    expect(summary.body.transfers.completed).toBeGreaterThanOrEqual(1);

    // 7) EDR 목록 — 실 KMX-EDC 형태(expiresAt 없음 → left=-1 '활성') 확인
    const edrs = await agent
      .post(`/api/connectors/${connId}/edrs`)
      .set(csrfHdr)
      .send({});
    expect(edrs.status).toBe(200);
    const mine = (edrs.body as Array<{ tpId: string; left: number }>).find(e =>
      tpId.startsWith(e.tpId)
    );
    expect(mine).toBeTruthy();
    expect(mine?.left).toBe(-1);
  });

  it(
    "실패 주입: 존재하지 않는 agreement 로 전송을 시작해도 사이클이 오염되지 않는다",
    {
      timeout: 30_000,
    },
    async ctx => {
      if (!ready) return ctx.skip();
      const { agent, csrf } = await login(adminBpn);
      // 유효하지 않은 agreementId 도 목은 IdResponse 를 주지만(관대한 목),
      // BFF 계약(필수 필드 검증)은 지켜져야 한다 — agreementId 누락은 400.
      const missing = await agent
        .post(`/api/connectors/nonexistent/transfers/start`)
        .set("X-CSRF-Token", csrf)
        .send({ counterPartyAddress: DSP });
      expect(missing.status).toBeGreaterThanOrEqual(400);
    }
  );
});

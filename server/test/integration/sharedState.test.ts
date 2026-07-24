// KMX EDC — 멀티레플리카 공유상태 통합테스트
//
// 두 가지 크로스 레플리카 메커니즘을 실제 Postgres 로 검증한다:
//  ① EDR 토큰 공유 저장소(edr_tokens) — resolve/store/evict/prune + at-rest 암호화.
//     어느 레플리카가 저장하든 최신 토큰을 모두가 읽는다(인메모리 캐시 대체).
//  ② pg LISTEN/NOTIFY 무효화(pubsub) — 한 연결의 NOTIFY 가 다른 연결의 LISTEN 핸들러에
//     도달하는지(= 타 레플리카 캐시 즉시 무효화)를 단일 프로세스의 두 커넥션으로 검증한다.
//
// testcontainers Postgres — Docker 미가용 시 우아하게 skip(REQUIRE_INTEGRATION=1 이면 실패).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

let container: StartedPostgreSqlContainer | undefined;
let ready = false;

// 동적 import(초기화 순서상 DATABASE_URL 설정 후 로드).
type DbMod = typeof import("../../lib/db.js");
type EdrMod = typeof import("../../lib/edrRefresh.js");
type PubMod = typeof import("../../lib/pubsub.js");
let db: DbMod;
let edr: EdrMod;
let pub: PubMod;

const C = "conn-shared-1";
const TP = "tp-shared-1";

beforeAll(async () => {
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
  } catch (err) {
    const msg = `[integration] Docker/testcontainers 미가용: ${(err as Error).message}`;
    if (process.env.REQUIRE_INTEGRATION === "1") throw new Error(msg);
    console.warn(msg + " — 공유상태 통합테스트 skip");
    return;
  }
  process.env.DATABASE_URL = container.getConnectionUri();
  db = await import("../../lib/db.js");
  edr = await import("../../lib/edrRefresh.js");
  pub = await import("../../lib/pubsub.js");
  await db.initDb();
  ready = true;
}, 180_000);

afterAll(async () => {
  if (pub) await pub.stopPubSub().catch(() => {});
  if (db) await db.closeDb().catch(() => {});
  if (container) await container.stop().catch(() => {});
});

describe("EDR 토큰 공유 저장소(edr_tokens)", () => {
  it("resolve 는 EDR 원본을 저장하고, 액세스/refresh 토큰을 at-rest 암호화한다", async () => {
    if (!ready) return;
    const tokens = await edr.resolveEdrTokens(C, TP, {
      authorization: "access-orig",
      refreshToken: "refresh-orig",
      refreshEndpoint: "https://provider.example/token",
    });
    expect(tokens.accessToken).toBe("access-orig");

    const { rows } = await db.getPool().query<{
      access_token: string;
      refresh_token: string;
    }>(`SELECT access_token, refresh_token FROM edr_tokens WHERE connector_id=$1 AND tp_id=$2`, [C, TP]);
    expect(rows).toHaveLength(1);
    // 평문이 그대로 저장되지 않고 enc:v1 봉투로 암호화되어 있어야 한다.
    expect(rows[0].access_token.startsWith("enc:v1:")).toBe(true);
    expect(rows[0].access_token).not.toContain("access-orig");
    expect(rows[0].refresh_token?.startsWith("enc:v1:")).toBe(true);
  });

  it("이미 저장된(=타 레플리카가 갱신한) 토큰이 있으면 새 EDR 보다 저장값을 우선한다", async () => {
    if (!ready) return;
    // 다른 EDR 을 넘겨도, 저장소의 기존 토큰이 반환되어야 한다(크로스 레플리카 최신값 우선).
    const tokens = await edr.resolveEdrTokens(C, TP, {
      authorization: "access-different",
      refreshToken: "refresh-different",
    });
    expect(tokens.accessToken).toBe("access-orig");
  });

  it("evict 는 행을 삭제하고, 이후 resolve 는 새 EDR 로 재저장한다", async () => {
    if (!ready) return;
    await edr.evictEdrTokens(C, TP);
    const after = await db
      .getPool()
      .query(`SELECT 1 FROM edr_tokens WHERE connector_id=$1 AND tp_id=$2`, [
        C,
        TP,
      ]);
    expect(after.rowCount).toBe(0);

    const tokens = await edr.resolveEdrTokens(C, TP, {
      authorization: "access-new",
    });
    expect(tokens.accessToken).toBe("access-new");
  });

  it("prune 는 보존기간 초과 행을 삭제한다", async () => {
    if (!ready) return;
    await edr.pruneEdrTokens(0); // maxAge 0 → 모든 행 삭제
    const { rowCount } = await db.getPool().query(`SELECT 1 FROM edr_tokens`);
    expect(rowCount).toBe(0);
  });
});

describe("pg LISTEN/NOTIFY 크로스 레플리카 무효화(pubsub)", () => {
  it("한 연결의 NOTIFY 가 다른 연결의 LISTEN 핸들러에 전달된다", async () => {
    if (!ready) return;
    const received: string[] = [];
    pub.onEvict(payload => received.push(payload));
    await pub.startPubSub();
    // LISTEN 이 실제로 자리 잡을 시간을 준다(connect + LISTEN 왕복).
    await new Promise(r => setTimeout(r, 300));

    await pub.notifyEvict("notify-prefs:BPNL-TEST");

    // 비동기 전달 — 최대 3초 폴링.
    const start = Date.now();
    while (Date.now() - start < 3000 && received.length === 0) {
      await new Promise(r => setTimeout(r, 50));
    }
    expect(received).toContain("notify-prefs:BPNL-TEST");
  });
});

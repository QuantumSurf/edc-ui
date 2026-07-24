// KMX EDC — 크로스 레플리카 캐시 무효화(pg LISTEN/NOTIFY)
//
// 멀티레플리카에서 한 인스턴스의 쓰기(예: 알림 설정 변경)를 다른 인스턴스의 인메모리 캐시가
// 즉시 반영하게 한다. 새 인프라(Redis 등) 없이 이미 쓰는 Postgres 의 LISTEN/NOTIFY 로 구현한다.
//
// - notify(payload): 풀 커넥션에서 pg_notify 를 쏜다(전송은 로컬 LISTEN 상태와 무관 —
//   구독 중인 다른 레플리카가 받는다). 로컬 LISTEN 이 끊겨 있어도 다른 레플리카는 수신한다.
// - 수신: 전용 Client 하나가 채널을 LISTEN 하고, 등록된 핸들러로 payload 를 넘긴다.
// - 견고성: 연결이 끊기면 백오프 재연결 후 재-LISTEN. 실패해도 각 캐시의 TTL 이 폴백이라
//   즉시성만 잃을 뿐 정확성은 유지된다.

import pg from "pg";
import { getPool } from "./db.js";

const CHANNEL = "kmx_cache_evict";

type EvictHandler = (payload: string) => void;
const handlers = new Set<EvictHandler>();

let client: pg.Client | null = null;
let stopped = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let backoffMs = 1000;
const BACKOFF_MAX_MS = 30_000;

function connString(): string {
  return (
    process.env.DATABASE_URL ??
    "postgresql://kmx:kmx_dev_123@localhost:5432/kmx_edc"
  );
}

async function connect(): Promise<void> {
  if (stopped) return;
  const c = new pg.Client({ connectionString: connString() });
  c.on("notification", msg => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    for (const h of handlers) {
      try {
        h(msg.payload);
      } catch (err) {
        console.error("[pubsub] handler error:", (err as Error).message);
      }
    }
  });
  // 연결이 끊기면(에러/서버 종료) 재연결을 예약한다.
  c.on("error", err => {
    console.error("[pubsub] client error:", (err as Error).message);
    scheduleReconnect();
  });
  c.on("end", () => scheduleReconnect());

  await c.connect();
  await c.query(`LISTEN ${CHANNEL}`);
  client = c;
  backoffMs = 1000; // 성공 시 백오프 리셋
  console.log("[pubsub] LISTEN 활성 —", CHANNEL);
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  const oldClient = client;
  client = null;
  if (oldClient) {
    oldClient.removeAllListeners();
    oldClient.end().catch(() => {});
  }
  const delay = backoffMs;
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch(err => {
      console.error("[pubsub] 재연결 실패:", (err as Error).message);
      scheduleReconnect();
    });
  }, delay);
  reconnectTimer.unref?.();
}

/** LISTEN 시작(부팅 시 1회). 실패해도 앱은 계속 동작(각 캐시 TTL 폴백). */
export async function startPubSub(): Promise<void> {
  stopped = false;
  try {
    await connect();
  } catch (err) {
    console.error(
      "[pubsub] 초기 연결 실패 — TTL 폴백으로 계속:",
      (err as Error).message
    );
    scheduleReconnect();
  }
}

/** graceful shutdown 시 정리. */
export async function stopPubSub(): Promise<void> {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const c = client;
  client = null;
  if (c) {
    c.removeAllListeners();
    await c.end().catch(() => {});
  }
}

/** 캐시 무효화 이벤트를 다른 레플리카로 방송한다. best-effort(실패해도 TTL 폴백). */
export async function notifyEvict(payload: string): Promise<void> {
  try {
    await getPool().query(`SELECT pg_notify($1, $2)`, [CHANNEL, payload]);
  } catch (err) {
    console.error("[pubsub] notify 실패:", (err as Error).message);
  }
}

/** 무효화 이벤트 핸들러 등록. payload 접두로 종류를 구분한다(예: "notify-prefs:<tenantId>"). */
export function onEvict(handler: EvictHandler): void {
  handlers.add(handler);
}

// KMX EDC — 대시보드 KPI용 정확 카운트 (EDC postgres 직접 COUNT).
//
// 배경: EDC 관리 API에는 총개수(count) 엔드포인트가 없다. 총건수를 알려면 목록을
//   통째로 가져와 세야 하는데, 대량 누적 시 무정렬 전체 조회가 컨트롤플레인 CPU를
//   급증시킨다(그래서 목록 조회는 EDC_QUERY_LIMIT 로 상한을 둔다). 그 결과 대시보드의
//   '데이터 전송' 카드가 목록 길이(상한)에서 멈춰 실제보다 작게 보였다.
//
// 해법: 커넥터의 EDC postgres 에 직접 COUNT(*) 하면 즉시·정확하다. 단 이는 EDC 내부
//   스키마에 의존하므로, 접속 정보가 EDC_STATS_DB(env, JSON: {connectorId: url}) 에
//   설정된 커넥터에 대해서만 동작한다. 미설정 커넥터는 null 을 반환해 호출측이 기존
//   목록 길이로 그대로 폴백하도록 한다(원격/관리형 EDC 처럼 DB 접근 불가한 경우 보호).
//
// EDC TransferProcessStates 서수(enum ordinal, 안정적):
//   REQUESTING=400, STARTED=600, SUSPENDED=700, COMPLETED=800, TERMINATED=850
// HttpData-PULL 에서 소비자가 완료하면 provider/consumer 전송 모두 TERMINATED(850)로
// 끝나고 error_detail 에 "... Completed by consumer ..." 가 남는다 → 이를 완료로 집계한다
// (edcClient.mapTransfer 의 UI 매핑과 동일 규칙을 DB 측에서 재현).

import pg from "pg";

const { Pool } = pg;

// 진행 중(active)으로 보는 상태 — UI(transferStats)의 REQUESTING/STARTED/SUSPENDED 와 일치.
const ACTIVE_STATES = [400, 600, 700];

let pools: Map<string, pg.Pool | null> | null = null;

function getConfig(): Record<string, string> {
  try {
    const raw = process.env.EDC_STATS_DB;
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? (obj as Record<string, string>) : {};
  } catch {
    // 잘못된 JSON 이면 기능 자체를 비활성(폴백) — 부팅을 막지 않는다.
    return {};
  }
}

function getPool(connectorId: string): pg.Pool | null {
  if (!pools) pools = new Map();
  if (pools.has(connectorId)) return pools.get(connectorId) ?? null;
  const url = getConfig()[connectorId];
  const pool = url
    ? new Pool({
        connectionString: url,
        max: 2,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      })
    : null;
  pools.set(connectorId, pool);
  return pool;
}

export interface TransferCounts {
  transfers: number;
  transfersCompleted: number;
  transfersActive: number;
}

/** 커넥터의 EDC DB 에서 전송 총계/완료/진행 카운트. 미설정이면 null(→ 호출측 폴백). */
export async function getTransferCounts(
  connectorId: string
): Promise<TransferCounts | null> {
  const pool = getPool(connectorId);
  if (!pool) return null;
  const { rows } = await pool.query(
    `select
       count(*)::int as total,
       count(*) filter (
         where state = 800
            or (state = 850 and error_detail ilike '%completed by consumer%')
       )::int as completed,
       count(*) filter (where state = any($1::int[]))::int as active
     from edc_transfer_process`,
    [ACTIVE_STATES]
  );
  const r = (rows[0] ?? {}) as {
    total?: number;
    completed?: number;
    active?: number;
  };
  return {
    transfers: Number(r.total) || 0,
    transfersCompleted: Number(r.completed) || 0,
    transfersActive: Number(r.active) || 0,
  };
}

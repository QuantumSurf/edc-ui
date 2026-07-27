// KMX EDC — Dashboard Stats Routes
// GET /:id/stats/trend  — 24h hourly negotiation & transfer counts
// GET /:id/stats/fsm    — negotiation FSM state distribution

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getPool } from "../lib/db.js";
import { getConnector } from "../lib/connectorRegistry.js";
import { getEdcClient, withJsonLd, EDC_QUERY_LIMIT } from "../lib/edcClient.js";
import { getTransferCounts } from "../lib/edcStatsDb.js";

const router = Router();

/** 원시 EDC 항목에서 생성 시각(epoch ms)을 최대한 견고하게 읽는다. */
function readCreatedMs(o: Record<string, unknown>): number {
  const v =
    o["createdAt"] ??
    o["edc:createdAt"] ??
    o["stateTimestamp"] ??
    o["edc:stateTimestamp"];
  const n = typeof v === "string" ? Date.parse(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// 트렌드 응답 캐시 — 대시보드가 30초 폴링하므로(뷰어 수만큼 배가) EDC 전체 목록 재조회를
// TTL 로 묶는다. 버킷이 1시간 단위라 60초 지연은 표시에 무해.
const TREND_CACHE_TTL_MS = 60_000;
const trendCache = new Map<string, { at: number; result: unknown }>();

// 창 내 목록을 페이지로 끝까지 수집한다. withJsonLd 기본(최신순 DESC + 상한)만 쓰면 창 내
// 데이터가 상한을 넘을 때 최신 N건만 집계돼 과거 버킷이 가짜 0 절벽이 된다(적대검증 확정).
// 최신순이므로 페이지 마지막 항목이 cutoff 이전이면 창을 전부 덮은 것 → 중단.
const TREND_MAX_PAGES = 10; // 폭주 방지 상한(페이지당 EDC_QUERY_LIMIT건)
async function fetchListSince(
  client: ReturnType<typeof getEdcClient>,
  path: string,
  cutoffMs: number
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 0; page < TREND_MAX_PAGES; page++) {
    const resp = await client.post(
      path,
      withJsonLd({ limit: EDC_QUERY_LIMIT, offset: page * EDC_QUERY_LIMIT })
    );
    const list: Record<string, unknown>[] = Array.isArray(resp.data)
      ? (resp.data as Record<string, unknown>[])
      : [];
    out.push(...list);
    if (list.length < EDC_QUERY_LIMIT) break;
    const oldest = readCreatedMs(list[list.length - 1]);
    if (oldest !== 0 && oldest < cutoffMs) break;
  }
  return out;
}

// GET /:id/stats/trend?hours=24
// Returns array of { hour, negs, transfers } for the last N hours (default 24)
router.get(
  "/:id/stats/trend",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorId = req.params.id;
      const hours = Math.min(
        parseInt((req.query.hours as string) ?? "24", 10) || 24,
        168
      );

      // 커넥터의 실제 EDC 협상/전송 목록의 createdAt 기준으로 집계한다.
      // (과거: negotiation_metadata/transfer_metadata.started_at 기준 → UI가 '시작'한 커넥터에만
      //  기록돼, provider처럼 상대가 개시한 협상/전송이 mirror돼 있어도 트렌드가 비었다.
      //  EDC 목록은 해당 커넥터가 '당사자'인 협상/전송을 모두 포함하므로 provider·consumer 양쪽에
      //  올바르게 반영된다. 대시보드가 30초 폴링하므로 60초 캐시로 상시 부하를 상수화한다.)
      const cacheKey = `${connectorId}:${hours}`;
      const cached = trendCache.get(cacheKey);
      if (cached && Date.now() - cached.at < TREND_CACHE_TTL_MS) {
        res.json(cached.result);
        return;
      }
      const conn = await getConnector(connectorId);
      if (!conn) {
        res.json([]);
        return;
      }
      const client = getEdcClient(conn.id, {
        managementUrl: conn.managementUrl,
        apiKey: conn.apiKey,
      });
      // 조회 실패는 무음 0 이 아니라 에러로 전파한다 — 빈 차트는 "데이터 없음"과 구분이 안 돼
      // 장애를 숨긴다(적대검증). 창 기준 cutoff 는 버킷 집계와 동일 값을 쓴다.
      const cutoff = Date.now() - hours * 3_600_000;
      const [negList, trList] = await Promise.all([
        fetchListSince(client, "/v3/contractnegotiations/request", cutoff),
        fetchListSince(client, "/v3/transferprocesses/request", cutoff),
      ]);

      // 시간 슬롯 생성 (현재 시각 기준 hours개)
      // 라벨은 KST(Asia/Seoul)로 명시 포맷 — d.getHours()는 서버 프로세스 로컬 TZ(컨테이너
      // 기본 UTC)라 x축이 KST와 9시간 어긋났다. 조인은 epochH(절대)라 TZ 무관하게 정확하고,
      // 라벨만 KST로 표기한다. (버킷은 정시 경계라 UTC↔KST 정수시 오프셋에도 "HH:00"로 정렬.)
      const TREND_TZ = process.env.TREND_LABEL_TZ ?? "Asia/Seoul";
      const now = new Date();
      const slots: { label: string; epochH: number }[] = [];
      for (let i = hours - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setMinutes(0, 0, 0);
        d.setHours(d.getHours() - i);
        slots.push({
          label: d.toLocaleTimeString("en-GB", {
            timeZone: TREND_TZ,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
          epochH: Math.floor(d.getTime() / 3_600_000),
        });
      }

      // createdAt(epoch ms) → 시간버킷(epochH) 카운트. 최근 hours 범위만.
      const bucketCounts = (list: Record<string, unknown>[]) => {
        const m = new Map<number, number>();
        for (const it of list) {
          const ms = readCreatedMs(it);
          if (ms < cutoff) continue;
          const h = Math.floor(ms / 3_600_000);
          m.set(h, (m.get(h) ?? 0) + 1);
        }
        return m;
      };
      const negMap = bucketCounts(negList);
      const trMap = bucketCounts(trList);

      const result = slots.map(s => ({
        t: s.label,
        negs: negMap.get(s.epochH) ?? 0,
        transfers: trMap.get(s.epochH) ?? 0,
      }));

      trendCache.set(cacheKey, { at: Date.now(), result });
      // 캐시 무한 증가 방지 — 커넥터×기간 조합이 쌓이면 만료분만 정리.
      if (trendCache.size > 200) {
        for (const [k, v] of trendCache) {
          if (Date.now() - v.at >= TREND_CACHE_TTL_MS) trendCache.delete(k);
        }
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/stats/summary?days=N — 성공률 KPI(협상·전송), 기간 1~90일(기본 7).
// 데이터원은 metadata 테이블의 last_state(목록 라우트가 터미널 도달 시 1회 기록).
// EDC 목록 재조회 없이 DB 집계만으로 계산한다 — 대시보드 KPI 카드용.
// 주의: last_state 는 콘솔이 목록을 열람한 시점에 기록되는 파생값이라, 콘솔이 한 번도
// 열람하지 않은 협상/전송은 집계에 없다(성공률은 '관측된 터미널' 기준).
router.get(
  "/:id/stats/summary",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorId = req.params.id;
      const daysRaw = Number(req.query.days);
      const days = Number.isFinite(daysRaw)
        ? Math.min(Math.max(1, Math.floor(daysRaw)), 90)
        : 7;

      const [neg, tr] = await Promise.all([
        getPool().query<{ last_state: string; cnt: string }>(
          `SELECT last_state, COUNT(*) AS cnt
             FROM negotiation_metadata
            WHERE connector_id = $1
              AND last_state IS NOT NULL
              AND completed_at >= NOW() - ($2 || ' days')::interval
            GROUP BY last_state`,
          [connectorId, String(days)]
        ),
        getPool().query<{
          last_state: string | null;
          user_completed: boolean;
          cnt: string;
        }>(
          `SELECT last_state, user_completed, COUNT(*) AS cnt
             FROM transfer_metadata
            WHERE connector_id = $1
              AND (last_state IS NOT NULL OR user_completed)
              AND completed_at >= NOW() - ($2 || ' days')::interval
            GROUP BY last_state, user_completed`,
          [connectorId, String(days)]
        ),
      ]);

      const negCount = (state: string) =>
        Number(neg.rows.find(r => r.last_state === state)?.cnt ?? 0);
      const finalized = negCount("FINALIZED");
      const negTerminated = negCount("TERMINATED");
      const negTotal = finalized + negTerminated;

      // 전송 성공 = COMPLETED(소비자완료 오버레이 포함) 또는 user_completed.
      // 실패 = TERMINATED 이면서 user_completed 아님.
      let completed = 0;
      let failed = 0;
      for (const r of tr.rows) {
        const n = Number(r.cnt);
        if (r.last_state === "COMPLETED" || r.user_completed) completed += n;
        else if (r.last_state === "TERMINATED") failed += n;
      }
      const trTotal = completed + failed;

      const rate = (ok: number, total: number) =>
        total > 0 ? Math.round((ok / total) * 1000) / 10 : null;

      res.json({
        days,
        negotiations: {
          total: negTotal,
          finalized,
          terminated: negTerminated,
          successRate: rate(finalized, negTotal),
        },
        transfers: {
          total: trTotal,
          completed,
          failed,
          successRate: rate(completed, trTotal),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/stats/counts
// 전송 총계/완료/진행 '정확값'. 목록 조회는 EDC_QUERY_LIMIT 상한이 걸려 대시보드 카드가
// 상한에서 멈추므로, EDC DB 에 직접 COUNT 해 정확값을 준다(설정된 커넥터만). 미설정이면
// { exact:false } → 클라이언트가 기존 목록 길이로 폴백.
router.get(
  "/:id/stats/counts",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const counts = await getTransferCounts(req.params.id);
      if (!counts) {
        res.json({ exact: false });
        return;
      }
      res.json({ exact: true, ...counts });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/stats/fsm
// Returns negotiation FSM state distribution: [{ name, value, color }]
router.get(
  "/:id/stats/fsm",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // negotiation_metadata에는 상태 정보 없음 → EDC 목록 기반으로 집계
      // 클라이언트에서 이미 negotiations 데이터를 보유하므로 여기서는 DB 집계만 제공
      // (추후 확장용 — 현재는 클라이언트 side 집계로 충분)
      res.json([]);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

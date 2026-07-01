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

const router = Router();

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

      // 협상: negotiation_metadata.started_at 기준
      const negRows = await getPool().query<{ hour: string; cnt: string }>(
        `SELECT date_trunc('hour', started_at) AS hour, COUNT(*) AS cnt
       FROM negotiation_metadata
       WHERE connector_id = $1
         AND started_at >= NOW() - ($2 || ' hours')::INTERVAL
       GROUP BY 1
       ORDER BY 1`,
        [connectorId, hours]
      );

      // 전송: transfer_metadata.started_at 기준
      const trRows = await getPool().query<{ hour: string; cnt: string }>(
        `SELECT date_trunc('hour', started_at) AS hour, COUNT(*) AS cnt
       FROM transfer_metadata
       WHERE connector_id = $1
         AND started_at >= NOW() - ($2 || ' hours')::INTERVAL
       GROUP BY 1
       ORDER BY 1`,
        [connectorId, hours]
      );

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

      // DB 결과를 epochH 키로 인덱싱
      const negMap = new Map<number, number>();
      for (const r of negRows.rows) {
        const h = Math.floor(new Date(r.hour).getTime() / 3_600_000);
        negMap.set(h, parseInt(r.cnt, 10));
      }
      const trMap = new Map<number, number>();
      for (const r of trRows.rows) {
        const h = Math.floor(new Date(r.hour).getTime() / 3_600_000);
        trMap.set(h, parseInt(r.cnt, 10));
      }

      const result = slots.map(s => ({
        t: s.label,
        negs: negMap.get(s.epochH) ?? 0,
        transfers: trMap.get(s.epochH) ?? 0,
      }));

      res.json(result);
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
      const connectorId = req.params.id;

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

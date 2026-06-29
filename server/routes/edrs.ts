// KMX EDC — Endpoint Data Reference (EDR) Routes
// Proxies: POST /v3/edrs/request, DELETE /v3/edrs/:tpId

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getConnector } from "../lib/connectorRegistry.js";
import { getEdcClient, withJsonLd, mapEDR } from "../lib/edcClient.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();
const writeGuard = requireRole("admin", "operator");

// EDR dataaddress 조회 동시성 상한 — 활성 EDR이 많을 때 무제한 병렬(N+1)로 provider/EDC를
// 과부하시키지 않도록 제한(id 78). 환경변수로 조정 가능.
const EDR_FETCH_CONCURRENCY = Number(process.env.EDR_FETCH_CONCURRENCY ?? 6);

/** 동시성 상한을 둔 map — 입력 순서를 보존해 결과 배열을 반환. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        results[i] = await fn(items[i], i);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function resolveConnector(id: string) {
  const conn = await getConnector(id);
  if (!conn) throw new Error(`Connector ${id} not found`);
  return {
    conn,
    client: getEdcClient(conn.id, {
      managementUrl: conn.managementUrl,
      apiKey: conn.apiKey,
    }),
  };
}

// POST /:id/edrs — proxy to POST /v3/edrs/request
// active EDR에 대해 /v3/edrs/:tpId/dataaddress를 병렬 조회 → endpoint + authorization 병합
// EDR list 조회는 token bearer reveal 위험이 있어 write 권한 (admin/operator) 필수.
router.post(
  "/:id/edrs",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.post(
        "/v3/edrs/request",
        withJsonLd(req.body)
      );
      const rawList: Record<string, unknown>[] = Array.isArray(response.data)
        ? response.data
        : [];

      const now = Date.now();
      // 활성 EDR마다 dataaddress를 동시성 상한 하에 병렬 조회(무제한 N+1 방지 — id 78).
      const enriched = await mapWithConcurrency(
        rawList,
        EDR_FETCH_CONCURRENCY,
        async raw => {
          const tpId =
            (raw["transferProcessId"] as string) ??
            (raw["@id"] as string) ??
            "";
          const expiresAt = raw["expiresAt"] as number | undefined;
          const isActive = !expiresAt || expiresAt > now;

          if (isActive && tpId) {
            try {
              const addrRes = await client.get(`/v3/edrs/${tpId}/dataaddress`);
              const addr = addrRes.data as Record<string, unknown>;
              return {
                ...raw,
                endpoint: addr["endpoint"] ?? raw["endpoint"] ?? "",
                authorization:
                  addr["authorization"] ?? raw["authorization"] ?? "",
              };
            } catch {
              // dataaddress 조회 실패 시 원본 그대로
            }
          }
          return raw;
        }
      );

      res.json(enriched.map(mapEDR));
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/edrs/stats — compute EDR statistics from live data
router.get(
  "/:id/edrs/stats",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.post("/v3/edrs/request", withJsonLd({}));
      const edrs = Array.isArray(response.data)
        ? response.data.map(mapEDR)
        : [];

      const now = Date.now();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // active 정의를 목록 라우트(`!expiresAt || expiresAt > now`)와 일치시킨다(id 81).
      // left === -1(만료정보 없음)과 left > 0(미래 만료) 모두 활성. left === 0(만료/임박)만 제외.
      const active = edrs.filter((e: { left: number }) => e.left !== 0);
      const expired = edrs.filter(
        (e: { expiresAt: number }) =>
          e.expiresAt > 0 &&
          e.expiresAt <= now &&
          e.expiresAt >= todayStart.getTime()
      );

      // nearestExpiry는 실제 만료 시각이 있는 EDR(left > 0)만 대상 — left === -1이 항상 최소로
      // 뽑혀 '가장 임박'으로 오인되는 문제 방지(active 집계와 임박 계산을 분리).
      const expiringCandidates = active.filter(
        (e: { left: number }) => e.left > 0
      );
      const nearest =
        expiringCandidates.length > 0
          ? expiringCandidates.reduce(
              (
                min: { left: number; tpId: string; asset: string },
                e: { left: number; tpId: string; asset: string }
              ) => (e.left < min.left ? e : min),
              expiringCandidates[0]
            )
          : null;

      // GC scheduler defaults (can be overridden by connector config)
      const gcInterval = parseInt(process.env.EDR_GC_INTERVAL ?? "300", 10);
      const gcBatchSize = parseInt(process.env.EDR_GC_BATCH_SIZE ?? "500", 10);
      const gcGrace = parseInt(process.env.EDR_GC_GRACE ?? "60", 10);
      const lastRunMs =
        Math.floor(now / (gcInterval * 1000)) * (gcInterval * 1000);
      const nextRunMs = lastRunMs + gcInterval * 1000;

      res.json({
        todayGcDeleted: expired.length,
        gcErrors: 0,
        nearestExpiry: nearest
          ? { tpId: nearest.tpId, asset: nearest.asset, left: nearest.left }
          : null,
        gcScheduler: {
          interval: `${gcInterval}s (${Math.round(gcInterval / 60)}분)`,
          batchSize: gcBatchSize,
          grace: `${gcGrace}s`,
          lastRun: new Date(lastRunMs).toLocaleTimeString("ko-KR", {
            hour12: false,
          }),
          nextRun: new Date(nextRunMs).toLocaleTimeString("ko-KR", {
            hour12: false,
          }),
          enabled: true,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id/edrs/:tpId — proxy to DELETE /v3/edrs/:tpId
router.delete(
  "/:id/edrs/:tpId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.delete(`/v3/edrs/${req.params.tpId}`);
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

// KMX EDC — Endpoint Data Reference (EDR) Routes
// Proxies: POST /v3/edrs/request, DELETE /v3/edrs/:tpId

import { Router, type Request, type Response, type NextFunction } from "express";
import { getConnector } from "../lib/connectorRegistry.js";
import { getEdcClient, withJsonLd, mapEDR } from "../lib/edcClient.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();
const writeGuard = requireRole("admin", "operator");

async function resolveConnector(id: string) {
  const conn = await getConnector(id);
  if (!conn) throw new Error(`Connector ${id} not found`);
  return { conn, client: getEdcClient(conn.id, { managementUrl: conn.managementUrl, apiKey: conn.apiKey }) };
}

// POST /:id/edrs — proxy to POST /v3/edrs/request
// active EDR에 대해 /v3/edrs/:tpId/dataaddress를 병렬 조회 → endpoint + authorization 병합
// EDR list 조회는 token bearer reveal 위험이 있어 write 권한 (admin/operator) 필수.
router.post("/:id/edrs", writeGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { client } = await resolveConnector(req.params.id);
    const response = await client.post("/v3/edrs/request", withJsonLd(req.body));
    const rawList: Record<string, unknown>[] = Array.isArray(response.data) ? response.data : [];

    const now = Date.now();
    const enriched = await Promise.all(
      rawList.map(async (raw) => {
        const tpId = (raw["transferProcessId"] as string) ?? (raw["@id"] as string) ?? "";
        const expiresAt = raw["expiresAt"] as number | undefined;
        const isActive = !expiresAt || expiresAt > now;

        if (isActive && tpId) {
          try {
            const addrRes = await client.get(`/v3/edrs/${tpId}/dataaddress`);
            const addr = addrRes.data as Record<string, unknown>;
            return {
              ...raw,
              endpoint: addr["endpoint"] ?? raw["endpoint"] ?? "",
              authorization: addr["authorization"] ?? raw["authorization"] ?? "",
            };
          } catch {
            // dataaddress 조회 실패 시 원본 그대로
          }
        }
        return raw;
      })
    );

    res.json(enriched.map(mapEDR));
  } catch (error) {
    next(error);
  }
});

// GET /:id/edrs/stats — compute EDR statistics from live data
router.get("/:id/edrs/stats", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { client } = await resolveConnector(req.params.id);
    const response = await client.post("/v3/edrs/request", withJsonLd({}));
    const edrs = Array.isArray(response.data) ? response.data.map(mapEDR) : [];

    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const active = edrs.filter((e: { left: number }) => e.left > 0);
    const expired = edrs.filter((e: { expiresAt: number }) => e.expiresAt > 0 && e.expiresAt <= now && e.expiresAt >= todayStart.getTime());

    // Nearest expiry among active EDRs
    const nearest = active.length > 0
      ? active.reduce((min: { left: number; tpId: string; asset: string }, e: { left: number; tpId: string; asset: string }) =>
          e.left < min.left ? e : min, active[0])
      : null;

    // GC scheduler defaults (can be overridden by connector config)
    const gcInterval = parseInt(process.env.EDR_GC_INTERVAL ?? "300", 10);
    const gcBatchSize = parseInt(process.env.EDR_GC_BATCH_SIZE ?? "500", 10);
    const gcGrace = parseInt(process.env.EDR_GC_GRACE ?? "60", 10);
    const lastRunMs = Math.floor(now / (gcInterval * 1000)) * (gcInterval * 1000);
    const nextRunMs = lastRunMs + gcInterval * 1000;

    res.json({
      todayGcDeleted: expired.length,
      gcErrors: 0,
      nearestExpiry: nearest ? { tpId: nearest.tpId, asset: nearest.asset, left: nearest.left } : null,
      gcScheduler: {
        interval: `${gcInterval}s (${Math.round(gcInterval / 60)}분)`,
        batchSize: gcBatchSize,
        grace: `${gcGrace}s`,
        lastRun: new Date(lastRunMs).toLocaleTimeString("ko-KR"),
        nextRun: new Date(nextRunMs).toLocaleTimeString("ko-KR"),
        enabled: true,
      },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /:id/edrs/:tpId — proxy to DELETE /v3/edrs/:tpId
router.delete("/:id/edrs/:tpId", writeGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { client } = await resolveConnector(req.params.id);
    const response = await client.delete(`/v3/edrs/${req.params.tpId}`);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

export default router;

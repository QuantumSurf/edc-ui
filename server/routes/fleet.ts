// KMX EDC — Fleet KPI Aggregation Route
// Aggregates health, asset, negotiation, and transfer counts across all connectors

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { listConnectors } from "../lib/connectorRegistry.js";
import { createEdcClient } from "../lib/edcClient.js";
import {
  mapWithConcurrency,
  FLEET_FANOUT_CONCURRENCY,
} from "../lib/concurrency.js";

const router = Router();

const JSON_LD_QUERY = {
  "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
  "@type": "QuerySpec",
};

interface ConnectorKpi {
  id: string;
  name: string;
  // 부분 장애 표현: up(전부 성공)/warn(일부 성공)/down(전부 실패).
  status: "up" | "warn" | "down";
  assets: number;
  negotiations: number;
  transfers: number;
}

// GET /kpi — aggregate KPI across the tenant's connectors in parallel
router.get("/kpi", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // tenant fail-closed: tenantId 없는 토큰은 KPI 전체 노출 대신 거부.
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      res.status(403).json({ error: "no-tenant" });
      return;
    }
    const connectors = await listConnectors(tenantId);

    // Short-circuit: if no connectors registered, return immediately
    if (connectors.length === 0) {
      return res.json({
        totalConnectors: 0,
        up: 0,
        warn: 0,
        down: 0,
        totalAssets: 0,
        totalOffers: 0,
        totalNegotiations: 0,
        totalTransfers: 0,
        vcWarnings: 0,
        perConnector: [],
      });
    }

    // 동시성 상한 fan-out(커넥터당 3 outbound). 무제한 병렬은 커넥터가 많은 테넌트에서
    // 단일 요청으로 BFF 소켓/이벤트루프를 고갈시킬 수 있어 상한을 둔다. 부분 장애는
    // 커넥터 단위 try/catch 로 흡수해 down 상태로 폴백(allSettled 동등 내성).
    const perConnector: ConnectorKpi[] = await mapWithConcurrency(
      connectors,
      FLEET_FANOUT_CONCURRENCY,
      async (conn): Promise<ConnectorKpi> => {
        try {
          const client = createEdcClient({
            managementUrl: conn.managementUrl,
            apiKey: conn.apiKey,
            timeoutMs: 3_000, // 5s → 3s for faster initial response
          });

          const [assetsRes, negotiationsRes, transfersRes] =
            await Promise.allSettled([
              client.post("/v3/assets/request", JSON_LD_QUERY),
              client.post("/v3/contractnegotiations/request", JSON_LD_QUERY),
              client.post("/v3/transferprocesses/request", JSON_LD_QUERY),
            ]);

          // 3개 모두 성공=up, 0개=down, 일부만=warn(부분 장애).
          const oks = [assetsRes, negotiationsRes, transfersRes].filter(
            r => r.status === "fulfilled"
          ).length;
          const status: "up" | "warn" | "down" =
            oks === 0 ? "down" : oks === 3 ? "up" : "warn";

          return {
            id: conn.id,
            name: conn.name,
            status,
            assets:
              assetsRes.status === "fulfilled"
                ? Array.isArray(assetsRes.value.data)
                  ? assetsRes.value.data.length
                  : 0
                : 0,
            negotiations:
              negotiationsRes.status === "fulfilled"
                ? Array.isArray(negotiationsRes.value.data)
                  ? negotiationsRes.value.data.length
                  : 0
                : 0,
            transfers:
              transfersRes.status === "fulfilled"
                ? Array.isArray(transfersRes.value.data)
                  ? transfersRes.value.data.length
                  : 0
                : 0,
          };
        } catch {
          return {
            id: conn.id,
            name: conn.name,
            status: "down",
            assets: 0,
            negotiations: 0,
            transfers: 0,
          };
        }
      }
    );

    const up = perConnector.filter(c => c.status === "up").length;
    const warn = perConnector.filter(c => c.status === "warn").length;
    const down = perConnector.length - up - warn;

    // Match client FleetKPI interface
    res.json({
      totalConnectors: perConnector.length,
      up,
      warn,
      down,
      totalAssets: perConnector.reduce((sum, c) => sum + c.assets, 0),
      totalOffers: 0,
      totalNegotiations: perConnector.reduce(
        (sum, c) => sum + c.negotiations,
        0
      ),
      totalTransfers: perConnector.reduce((sum, c) => sum + c.transfers, 0),
      vcWarnings: 0,
      perConnector,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

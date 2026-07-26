// KMX EDC — Health Check Route
// Proxies: GET /api/check/health

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getConnector } from "../lib/connectorRegistry.js";
import { getEdcClient } from "../lib/edcClient.js";

const router = Router();

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

// GET /:id/health — 커넥터 도달성 프로브
// 실 kmx-edc 는 observability(/api/check/health)가 default 컨텍스트(별도 포트)에 있어
// 등록된 management URL 로는 404 가 난다. UI 가 실제로 의존하는 것은 Management API
// 도달성이므로 QuerySpec(limit 1) 프로브를 1차로 쓰고, management 포트에 observability 를
// 겸하는 배포(dev-mock, 단일 포트 배포)를 위해 /api/check/health 를 2차 폴백으로 유지한다.
// (connectors.ts test-connection 라우트와 동일한 프로브 순서 — 판정 일관성.)
router.get(
  "/:id/health",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      try {
        await client.post("/v3/assets/request", {
          "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
          "@type": "QuerySpec",
          limit: 1,
        });
        // 기존 소비자와 호환되는 EDC observability 응답 형태로 정규화.
        res.json({
          isSystemHealthy: true,
          probe: "management",
          componentResults: [
            { component: "Management API", isHealthy: true, failure: null },
          ],
        });
        return;
      } catch {
        // 폴백: 같은 포트의 observability 엔드포인트
      }
      const response = await client.get("/api/check/health");
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

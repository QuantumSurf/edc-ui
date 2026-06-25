// KMX EDC — Asset Management Routes
// Proxies: POST /v3/assets/request, POST /v3/assets, DELETE /v3/assets/:assetId

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getConnector } from "../lib/connectorRegistry.js";
import {
  getEdcClient,
  withJsonLd,
  mapAsset,
  toEdcAssetBody,
} from "../lib/edcClient.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();
const writeGuard = requireRole("admin", "operator");

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

// POST /:id/assets — proxy to POST /v3/assets/request (list)
// Also fetches offerings to determine per-asset offering status
router.post(
  "/:id/assets",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const [assetRes, offRes] = await Promise.all([
        client.post("/v3/assets/request", withJsonLd(req.body)),
        client
          .post("/v3/contractdefinitions/request", withJsonLd({}))
          .catch(() => ({ data: [] })),
      ]);
      const mapped = Array.isArray(assetRes.data)
        ? assetRes.data.map(mapAsset)
        : assetRes.data;

      // Build set of asset IDs referenced by offerings
      if (Array.isArray(mapped) && Array.isArray(offRes.data)) {
        const offeredAssetIds = new Set<string>();
        for (const off of offRes.data) {
          const selector = off["assetsSelector"] ?? off["edc:assetsSelector"];
          if (selector) {
            const sel = Array.isArray(selector) ? selector[0] : selector;
            // 다중 자산(in 연산자)은 operandRight가 배열 — 각 요소를 모두 Set에 추가(id 72).
            const right =
              (sel as Record<string, unknown>)?.["operandRight"] ??
              (sel as Record<string, unknown>)?.["edc:operandRight"];
            if (Array.isArray(right)) {
              for (const r of right) if (r) offeredAssetIds.add(String(r));
            } else if (right) {
              offeredAssetIds.add(String(right));
            }
          }
        }
        for (const a of mapped) {
          (a as { offered: boolean }).offered = offeredAssetIds.has(
            (a as { id: string }).id
          );
        }
      }

      res.json(mapped);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/assets/create — proxy to POST /v3/assets (create)
// 평면 클라 모델을 toEdcAssetBody로 EDC JSON-LD 변환(customProperties 병합 포함 — id 12).
router.post(
  "/:id/assets/create",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const edcBody = toEdcAssetBody(req.body as Record<string, unknown>);
      const response = await client.post("/v3/assets", edcBody);
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/assets/:assetId — proxy to GET /v3/assets/:assetId (detail)
router.get(
  "/:id/assets/:assetId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.get(`/v3/assets/${req.params.assetId}`);
      res.json(mapAsset(response.data));
    } catch (error) {
      next(error);
    }
  }
);

// PUT /:id/assets/:assetId — proxy to PUT /v3/assets (update)
// create와 동일 변환(toEdcAssetBody)으로 평면→JSON-LD. @id는 URL :assetId로 강제 정합.
// (과거: withJsonLd raw 전달이라 properties/dataAddress 미구성으로 수정 깨짐 — id 11)
router.put(
  "/:id/assets/:assetId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const edcBody = toEdcAssetBody(
        req.body as Record<string, unknown>,
        req.params.assetId
      );
      const response = await client.put("/v3/assets", edcBody);
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id/assets/:assetId — proxy to DELETE /v3/assets/:assetId
router.delete(
  "/:id/assets/:assetId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.delete(`/v3/assets/${req.params.assetId}`);
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

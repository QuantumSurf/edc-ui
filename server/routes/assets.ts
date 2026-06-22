// KMX EDC — Asset Management Routes
// Proxies: POST /v3/assets/request, POST /v3/assets, DELETE /v3/assets/:assetId

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getConnector } from "../lib/connectorRegistry.js";
import { getEdcClient, withJsonLd, mapAsset } from "../lib/edcClient.js";
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
            const assetId =
              ((sel as Record<string, unknown>)?.["operandRight"] as string) ??
              ((sel as Record<string, unknown>)?.[
                "edc:operandRight"
              ] as string) ??
              "";
            if (assetId) offeredAssetIds.add(assetId);
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
// Accepts simplified client model and transforms to EDC JSON-LD
router.post(
  "/:id/assets/create",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const b = req.body as Record<string, string>;

      const edcBody: Record<string, unknown> = {
        "@context": {
          "@vocab": "https://w3id.org/edc/v0.0.1/ns/",
          "cx-common": "https://w3id.org/catenax/ontology/common#",
          dct: "https://purl.org/dc/terms/",
          "cx-taxo": "https://w3id.org/catenax/taxonomy#",
        },
        "@id": b.id,
        properties: {
          name: b.name ?? b.id,
          "cx-common:version": b.ver ?? "",
          ...(b.type ? { "dct:type": { "@id": b.type } } : {}),
          ...(b.sem ? { semanticId: b.sem } : {}),
          ...(b.aasVersion ? { "kmx:aasVersion": b.aasVersion } : {}),
          ...(b.aasId ? { "kmx:aasId": b.aasId } : {}),
          ...(b.submodelId ? { "kmx:submodelId": b.submodelId } : {}),
        },
        dataAddress: {
          type: b.dataAddressType ?? "HttpData",
          baseUrl: b.baseUrl,
          proxyPath: b.proxyPath ?? "false",
          proxyQueryParams: b.proxyQueryParams ?? "false",
          authCode: b.authCode ? `{{${b.authCode}}}` : undefined,
          contentType: b.contentType ?? "application/json",
        },
      };

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
router.put(
  "/:id/assets/:assetId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.put("/v3/assets", withJsonLd(req.body));
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

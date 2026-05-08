// KMX EDC — Contract Definition (Offering) Routes
// Proxies: POST /v3/contractdefinitions/request, POST /v3/contractdefinitions, DELETE /v3/contractdefinitions/:offId

import { Router, type Request, type Response, type NextFunction } from "express";
import { getConnector } from "../lib/connectorRegistry.js";
import { getEdcClient, withJsonLd, mapOffering } from "../lib/edcClient.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();
const writeGuard = requireRole("admin", "operator");

async function resolveConnector(id: string) {
  const conn = await getConnector(id);
  if (!conn) throw new Error(`Connector ${id} not found`);
  return { conn, client: getEdcClient(conn.id, { managementUrl: conn.managementUrl, apiKey: conn.apiKey }) };
}

// POST /:id/offerings — proxy to POST /v3/contractdefinitions/request (list)
router.post("/:id/offerings", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { client } = await resolveConnector(req.params.id);
    const response = await client.post("/v3/contractdefinitions/request", withJsonLd(req.body));
    const mapped = Array.isArray(response.data) ? response.data.map(mapOffering) : response.data;
    res.json(mapped);
  } catch (error) {
    next(error);
  }
});

// POST /:id/offerings/create — proxy to POST /v3/contractdefinitions (create)
router.post("/:id/offerings/create", writeGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, asset, access, contract } = req.body;

    // Build EDC ContractDefinition JSON-LD from frontend payload
    const assetIds = asset ? String(asset).split(",").map((s: string) => s.trim()).filter(Boolean) : [];
    const edcBody = withJsonLd({
      "@type": "ContractDefinition",
      "@id": id || undefined,
      "accessPolicyId": access,
      "contractPolicyId": contract,
      "assetsSelector": assetIds.length > 0 ? [{
        "@type": "CriterionDto",
        "operandLeft": "https://w3id.org/edc/v0.0.1/ns/id",
        "operator": assetIds.length === 1 ? "=" : "in",
        "operandRight": assetIds.length === 1 ? assetIds[0] : assetIds,
      }] : [],
    });

    const { client } = await resolveConnector(req.params.id);
    const response = await client.post("/v3/contractdefinitions", edcBody);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// GET /:id/offerings/:offId — detail
router.get("/:id/offerings/:offId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { client } = await resolveConnector(req.params.id);
    const response = await client.get(`/v3/contractdefinitions/${req.params.offId}`);
    res.json(mapOffering(response.data));
  } catch (error) {
    next(error);
  }
});

// PUT /:id/offerings/:offId — update
router.put("/:id/offerings/:offId", writeGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { client } = await resolveConnector(req.params.id);
    const response = await client.put(`/v3/contractdefinitions/${req.params.offId}`, withJsonLd(req.body));
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

// DELETE /:id/offerings/:offId — proxy to DELETE /v3/contractdefinitions/:offId
router.delete("/:id/offerings/:offId", writeGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { client } = await resolveConnector(req.params.id);
    const response = await client.delete(`/v3/contractdefinitions/${req.params.offId}`);
    res.json(response.data);
  } catch (error) {
    next(error);
  }
});

export default router;

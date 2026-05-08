// KMX EDC — Connector Registry Routes
// Manages connector CRUD (no EDC proxy — operates on local registry)

import { Router, type Request, type Response, type NextFunction } from "express";
import { listConnectors, getConnector, registerConnector, updateConnector, deleteConnector } from "../lib/connectorRegistry.js";
import { createEdcClient } from "../lib/edcClient.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();
const adminOnly = requireRole("admin");
const operatorOrAdmin = requireRole("admin", "operator");

const JSON_LD_QUERY = {
  "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
  "@type": "QuerySpec",
};

function countArray(res: { status: string; value?: { data: unknown } }): number {
  if (res.status !== "fulfilled") return 0;
  const d = (res as PromiseFulfilledResult<{ data: unknown }>).value.data;
  return Array.isArray(d) ? d.length : 0;
}

// GET / — list all registered connectors (with live status + counts)
router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const connectors = await listConnectors();

    // Parallel status + resource counts for all connectors
    const withStatus = await Promise.all(
      connectors.map(async ({ apiKey, ...safe }) => {
        let status: "up" | "down" = "down";
        let assets = 0, offers = 0, negs = 0, transfers = 0;

        try {
          const client = createEdcClient({ managementUrl: safe.managementUrl, apiKey, timeoutMs: 5_000 });

          const [assetsRes, offersRes, negsRes, transfersRes] = await Promise.allSettled([
            client.post("/v3/assets/request", JSON_LD_QUERY),
            client.post("/v3/contractdefinitions/request", JSON_LD_QUERY),
            client.post("/v3/contractnegotiations/request", JSON_LD_QUERY),
            client.post("/v3/transferprocesses/request", JSON_LD_QUERY),
          ]);

          assets = countArray(assetsRes);
          offers = countArray(offersRes);
          negs = countArray(negsRes);
          transfers = countArray(transfersRes);

          // If any call succeeded, connector is up
          if ([assetsRes, offersRes, negsRes, transfersRes].some((r) => r.status === "fulfilled")) {
            status = "up";
          }
        } catch { /* all failed → down */ }

        return { ...safe, status, assets, offers, negs, transfers };
      })
    );

    res.json(withStatus);
  } catch (error) {
    next(error);
  }
});

// POST / — register a new connector
router.post("/", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connector = await registerConnector(req.body);
    const { apiKey, ...safe } = connector;
    res.status(201).json(safe);
  } catch (error) {
    next(error);
  }
});

// POST /test-connection — test connectivity before registration
router.post("/test-connection", operatorOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { managementUrl, apiKey } = req.body;
    if (!managementUrl) {
      res.status(400).json({ error: "managementUrl is required" });
      return;
    }

    const client = createEdcClient({
      managementUrl,
      apiKey: apiKey ?? "",
      timeoutMs: 5_000,
    });

    // Try Management API endpoint (assets query) since /api/check/health is on a different port
    try {
      const response = await client.post("/v3/assets/request", {
        "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
        "@type": "QuerySpec",
        "limit": 1,
      });
      res.json({ status: "ok", detail: { assets: Array.isArray(response.data) ? response.data.length : 0 } });
      return;
    } catch {
      // Fallback: try health endpoint (same port)
    }

    const response = await client.get("/api/check/health");
    res.json({ status: "ok", detail: response.data });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(502).json({ status: "fail", detail: msg });
  }
});

// PUT /:id — update a connector
router.put("/:id", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await updateConnector(req.params.id, req.body);
    if (!updated) {
      res.status(404).json({ error: `Connector ${req.params.id} not found` });
      return;
    }
    const { apiKey, ...safe } = updated;
    res.json(safe);
  } catch (error) {
    next(error);
  }
});

// DELETE /:id — delete a connector by id
router.delete("/:id", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await deleteConnector(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: `Connector ${req.params.id} not found` });
      return;
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;

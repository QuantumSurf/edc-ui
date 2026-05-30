// KMX EDC — Connector Registry Routes
// Manages connector CRUD (no EDC proxy — operates on local registry)

import { Router, type Request, type Response, type NextFunction } from "express";
import { listConnectors, getConnector, registerConnector, updateConnector, deleteConnector } from "../lib/connectorRegistry.js";
import { getTenant } from "../lib/tenants.js";
import { createEdcClient } from "../lib/edcClient.js";
import { requireRole } from "../middleware/auth.js";
import { validateDspEndpoint } from "../middleware/validation.js";

const router = Router();
const adminOnly = requireRole("admin");
const operatorOrAdmin = requireRole("admin", "operator");

// SSRF 가드: 서버가 호출하게 될 커넥터 URL(managementUrl/dspEndpoint)이
// 사설/내부/메타데이터 주소를 가리키지 않도록 검증. (catalog 등과 동일 정책)
function validateConnectorUrls(body: { managementUrl?: unknown; dspEndpoint?: unknown }): string | null {
  const fields: Array<["managementUrl" | "dspEndpoint", unknown]> = [
    ["managementUrl", body.managementUrl],
    ["dspEndpoint", body.dspEndpoint],
  ];
  for (const [field, val] of fields) {
    if (typeof val === "string" && val.trim()) {
      const err = validateDspEndpoint(val.trim());
      if (err) return `${field}: ${err}`;
    }
  }
  return null;
}

const JSON_LD_QUERY = {
  "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
  "@type": "QuerySpec",
};

function countArray(res: { status: string; value?: { data: unknown } }): number {
  if (res.status !== "fulfilled") return 0;
  const d = (res as PromiseFulfilledResult<{ data: unknown }>).value.data;
  return Array.isArray(d) ? d.length : 0;
}

// GET / — list the tenant's registered connectors (with live status + counts)
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connectors = await listConnectors(req.user?.tenantId);

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

// POST / — register a new connector under the caller's tenant
router.post("/", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      res.status(403).json({ error: "no-tenant" });
      return;
    }
    // BPN is managed in Settings (the tenant's org BPN) — force it server-side,
    // ignoring any client-supplied bpn. tenant_id is likewise forced from the token.
    const tenant = await getTenant(tenantId);
    const entry = { ...req.body, bpn: tenant?.bpn ?? req.body?.bpn };
    const ssrfErr = validateConnectorUrls(entry);
    if (ssrfErr) {
      res.status(400).json({ error: `Rejected URL — ${ssrfErr}` });
      return;
    }
    const connector = await registerConnector(entry, tenantId);
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
    const ssrfErr = validateDspEndpoint(String(managementUrl).trim());
    if (ssrfErr) {
      res.status(400).json({ error: `Rejected managementUrl — ${ssrfErr}` });
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
    const ssrfErr = validateConnectorUrls(req.body ?? {});
    if (ssrfErr) {
      res.status(400).json({ error: `Rejected URL — ${ssrfErr}` });
      return;
    }
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

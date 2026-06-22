// KMX EDC — Tenant isolation middleware
// Ensures the authenticated user's tenant owns the connector referenced by :id.
// Mounted on /api/connectors/:id so it guards EVERY connector-scoped sub-route
// (assets, policies, offerings, negotiations, transfers, edrs, catalog, health,
//  plus connector PUT/DELETE).

import type { Request, Response, NextFunction } from "express";
import { getConnector } from "../lib/connectorRegistry.js";

// Non-connector segments that legitimately sit under /api/connectors/* and must
// NOT be treated as a connector id.
const RESERVED_IDS = new Set(["test-connection"]);

export async function requireConnectorOwnership(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const id = req.params.id;
    if (!id || RESERVED_IDS.has(id)) return next();

    const tenantId = req.user?.tenantId;
    const conn = await getConnector(id);

    // 404 (not 403) for missing OR cross-tenant — don't leak existence to other tenants.
    if (!conn || !tenantId || conn.tenantId !== tenantId) {
      res.status(404).json({ error: "connector-not-found" });
      return;
    }
    return next();
  } catch (err) {
    next(err);
  }
}

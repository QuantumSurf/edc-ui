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

// GET /:id/health — proxy to GET /api/check/health
router.get(
  "/:id/health",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.get("/api/check/health");
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

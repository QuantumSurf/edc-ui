// KMX EDC — Fleet KPI Aggregation Route
// Aggregates health, asset, negotiation, and transfer counts across all connectors

import { Router, type Request, type Response, type NextFunction } from "express";
import { listConnectors } from "../lib/connectorRegistry.js";
import { createEdcClient } from "../lib/edcClient.js";

const router = Router();

const JSON_LD_QUERY = {
  "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
  "@type": "QuerySpec",
};

interface ConnectorKpi {
  id: string;
  name: string;
  healthy: boolean;
  assets: number;
  negotiations: number;
  transfers: number;
}

// GET /kpi — aggregate KPI across all connectors in parallel
router.get("/kpi", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const connectors = await listConnectors();

    // Short-circuit: if no connectors registered, return immediately
    if (connectors.length === 0) {
      return res.json({
        totalConnectors: 0,
        up: 0, warn: 0, down: 0,
        totalAssets: 0, totalOffers: 0,
        totalNegotiations: 0, totalTransfers: 0,
        vcWarnings: 0, perConnector: [],
      });
    }

    const results = await Promise.allSettled(
      connectors.map(async (conn): Promise<ConnectorKpi> => {
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

        // If at least one call succeeded, connector is healthy
        const healthy = [assetsRes, negotiationsRes, transfersRes].some(
          (r) => r.status === "fulfilled"
        );

        return {
          id: conn.id,
          name: conn.name,
          healthy,
          assets:
            assetsRes.status === "fulfilled"
              ? Array.isArray(assetsRes.value.data) ? assetsRes.value.data.length : 0
              : 0,
          negotiations:
            negotiationsRes.status === "fulfilled"
              ? Array.isArray(negotiationsRes.value.data) ? negotiationsRes.value.data.length : 0
              : 0,
          transfers:
            transfersRes.status === "fulfilled"
              ? Array.isArray(transfersRes.value.data) ? transfersRes.value.data.length : 0
              : 0,
        };
      })
    );

    const perConnector: ConnectorKpi[] = results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : {
            id: connectors[i].id,
            name: connectors[i].name,
            healthy: false,
            assets: 0,
            negotiations: 0,
            transfers: 0,
          }
    );

    const up = perConnector.filter((c) => c.healthy).length;
    const down = perConnector.length - up;

    // Match client FleetKPI interface
    res.json({
      totalConnectors: perConnector.length,
      up,
      warn: 0,
      down,
      totalAssets: perConnector.reduce((sum, c) => sum + c.assets, 0),
      totalOffers: 0,
      totalNegotiations: perConnector.reduce((sum, c) => sum + c.negotiations, 0),
      totalTransfers: perConnector.reduce((sum, c) => sum + c.transfers, 0),
      vcWarnings: 0,
      perConnector,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

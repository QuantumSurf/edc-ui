// KMX EDC — Policy Definition Routes
// Proxies: POST /v3/policydefinitions/request, POST /v3/policydefinitions, DELETE /v3/policydefinitions/:policyId

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getConnector } from "../lib/connectorRegistry.js";
import { getEdcClient, withJsonLd, mapPolicy } from "../lib/edcClient.js";
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

// POST /:id/policies — proxy to POST /v3/policydefinitions/request (list)
// Also fetches offerings to count per-policy references
router.post(
  "/:id/policies",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const [polRes, offRes] = await Promise.all([
        client.post("/v3/policydefinitions/request", withJsonLd(req.body)),
        client
          .post("/v3/contractdefinitions/request", withJsonLd({}))
          .catch(() => ({ data: [] })),
      ]);
      const mapped = Array.isArray(polRes.data)
        ? polRes.data.map(mapPolicy)
        : polRes.data;

      // Count how many offerings reference each policy (access or contract)
      if (Array.isArray(mapped) && Array.isArray(offRes.data)) {
        const counts = new Map<string, number>();
        for (const off of offRes.data) {
          const access =
            off["accessPolicyId"] ?? off["edc:accessPolicyId"] ?? "";
          const contract =
            off["contractPolicyId"] ?? off["edc:contractPolicyId"] ?? "";
          if (access)
            counts.set(
              access as string,
              (counts.get(access as string) ?? 0) + 1
            );
          if (contract && contract !== access)
            counts.set(
              contract as string,
              (counts.get(contract as string) ?? 0) + 1
            );
        }
        for (const p of mapped) {
          (p as { offers: number }).offers =
            counts.get((p as { id: string }).id) ?? 0;
        }
      }

      res.json(mapped);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/policies/create — proxy to POST /v3/policydefinitions (create)
router.post(
  "/:id/policies/create",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { policyId, constraints } = req.body;

      // If already in JSON-LD format (has @context), pass through
      if (req.body["@context"]) {
        const { client } = await resolveConnector(req.params.id);
        const response = await client.post("/v3/policydefinitions", req.body);
        res.json(response.data);
        return;
      }

      // Build EDC PolicyDefinition JSON-LD from ODRL builder data
      const edcBody = {
        "@context": {
          "@vocab": "https://w3id.org/edc/v0.0.1/ns/",
          odrl: "http://www.w3.org/ns/odrl/2/",
          "cx-policy": "https://w3id.org/catenax/policy/",
        },
        "@type": "PolicyDefinition",
        "@id": policyId,
        policy: {
          "@context": "http://www.w3.org/ns/odrl.jsonld",
          "@type": "odrl:Set",
          "odrl:permission": [
            {
              "odrl:action": { "@id": "odrl:use" },
              ...(constraints?.length
                ? {
                    "odrl:constraint": constraints.map(
                      (c: {
                        leftOperand: string;
                        operator: string;
                        rightOperand: string;
                      }) => ({
                        "odrl:leftOperand": c.leftOperand,
                        "odrl:operator": { "@id": c.operator },
                        "odrl:rightOperand": c.rightOperand,
                      })
                    ),
                  }
                : {}),
            },
          ],
        },
      };

      const { client } = await resolveConnector(req.params.id);
      const response = await client.post("/v3/policydefinitions", edcBody);
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/policies/:policyId — detail
router.get(
  "/:id/policies/:policyId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.get(
        `/v3/policydefinitions/${req.params.policyId}`
      );
      res.json(mapPolicy(response.data));
    } catch (error) {
      next(error);
    }
  }
);

// PUT /:id/policies/:policyId — update
router.put(
  "/:id/policies/:policyId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.put(
        `/v3/policydefinitions/${req.params.policyId}`,
        withJsonLd(req.body)
      );
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id/policies/:policyId — proxy to DELETE /v3/policydefinitions/:policyId
router.delete(
  "/:id/policies/:policyId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.delete(
        `/v3/policydefinitions/${req.params.policyId}`
      );
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

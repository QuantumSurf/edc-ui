// KMX EDC — Policy Definition Routes
// Proxies: POST /v3/policydefinitions/request, POST /v3/policydefinitions, DELETE /v3/policydefinitions/:policyId

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
  mapPolicy,
  buildPolicyDefinition,
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
// 빌더 평면 필드(ruleType/action/logicOp/constraints)를 buildPolicyDefinition으로 ODRL 변환.
// (과거: permission+use 하드코딩으로 prohibition/transfer/논리결합이 모두 손실 — id 17/20)
router.post(
  "/:id/policies/create",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 이미 완전한 JSON-LD면 그대로 통과(클라가 미리 조립해 보낸 경우).
      if (req.body["@context"]) {
        const { client } = await resolveConnector(req.params.id);
        const response = await client.post("/v3/policydefinitions", req.body);
        res.json(response.data);
        return;
      }

      const { policyId, ruleType, action, logicOp, constraints } = req.body;
      const edcBody = buildPolicyDefinition({
        policyId,
        ruleType,
        action,
        logicOp,
        constraints,
      });

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
// create와 동일 빌더로 평면 필드를 EDC PolicyDefinition으로 변환(과거: 원시 빌더 전달로 수정 실패/손상 — id 18).
router.put(
  "/:id/policies/:policyId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      // 이미 완전한 JSON-LD면 그대로, 아니면 빌더로 조립(@id는 URL의 policyId로 강제 정합).
      const body = req.body?.["@context"]
        ? req.body
        : buildPolicyDefinition({
            policyId: req.params.policyId,
            ruleType: req.body?.ruleType,
            action: req.body?.action,
            logicOp: req.body?.logicOp,
            constraints: req.body?.constraints,
          });
      const response = await client.put(
        `/v3/policydefinitions/${req.params.policyId}`,
        body
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

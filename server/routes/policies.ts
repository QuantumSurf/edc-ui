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

// 서버 측 정책 제약 검증(이중 방어) — 평면 빌더 경로에만 적용한다(@context 사전조립
// JSON-LD 경로는 건드리지 않는다). 클라이언트 검증을 우회한 직접 API 호출로도 깨진
// 정책(빈 피연산자, 비숫자 비교)이 EDC에 저장되는 것을 막는다.
// 빈 제약 배열(개방형 정책)은 정상이므로 통과시킨다.
function validatePolicyConstraints(constraints: unknown): string | null {
  const list = Array.isArray(constraints) ? constraints : [];
  for (const c of list) {
    const cc = (c ?? {}) as Record<string, unknown>;
    if (!String(cc.leftOperand ?? "").trim())
      return "제약 조건의 leftOperand는 필수입니다";
    if (!String(cc.rightOperand ?? "").trim())
      return "제약 조건의 rightOperand는 필수입니다";
    const op = String(cc.operator ?? "");
    if (
      (op === "odrl:gt" || op === "odrl:lt") &&
      !/^-?\d+(\.\d+)?$/.test(String(cc.rightOperand).trim())
    )
      return "비교 연산자(> / <)의 rightOperand는 숫자여야 합니다";
  }
  return null;
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
      if (!String(policyId ?? "").trim()) {
        res.status(400).json({ error: "policyId는 필수입니다" });
        return;
      }
      const cErr = validatePolicyConstraints(constraints);
      if (cErr) {
        res.status(400).json({ error: cErr });
        return;
      }
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
      // 이미 완전한 JSON-LD면 그대로, 아니면 빌더로 조립(@id는 URL의 policyId로 강제 정합).
      let body;
      if (req.body?.["@context"]) {
        body = req.body;
      } else {
        const cErr = validatePolicyConstraints(req.body?.constraints);
        if (cErr) {
          res.status(400).json({ error: cErr });
          return;
        }
        body = buildPolicyDefinition({
          policyId: req.params.policyId,
          ruleType: req.body?.ruleType,
          action: req.body?.action,
          logicOp: req.body?.logicOp,
          constraints: req.body?.constraints,
        });
      }
      const { client } = await resolveConnector(req.params.id);
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
      const policyId = req.params.policyId;
      // 계약(ContractDefinition)이 access/contract 정책으로 참조 중인 정책은 삭제 거부 —
      // 댕글링(유령) 참조 방지. UI는 이미 막지만(offers>0 시 삭제 비활성) 서버 검증이 없어
      // 우회 가능했음. 목록 API의 offers 계산과 동일한 교차조회를 사용한다.
      const offRes = await client
        .post("/v3/contractdefinitions/request", withJsonLd({}))
        .catch(() => ({ data: [] as unknown[] }));
      const offerings: unknown[] = Array.isArray(offRes.data)
        ? offRes.data
        : [];
      const referenced = offerings.some(o => {
        const off = o as Record<string, unknown>;
        const access = off["accessPolicyId"] ?? off["edc:accessPolicyId"] ?? "";
        const contract =
          off["contractPolicyId"] ?? off["edc:contractPolicyId"] ?? "";
        return access === policyId || contract === policyId;
      });
      if (referenced) {
        res
          .status(409)
          .json({ error: "계약에 등록된 정책은 삭제할 수 없습니다" });
        return;
      }
      const response = await client.delete(`/v3/policydefinitions/${policyId}`);
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

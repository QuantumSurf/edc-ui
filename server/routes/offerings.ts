// KMX EDC — Contract Definition (Offering) Routes
// Proxies: POST /v3/contractdefinitions/request, POST /v3/contractdefinitions, DELETE /v3/contractdefinitions/:offId

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
  EDC_QUERY_LIMIT,
  mapOffering,
  buildAssetAgreementCounts,
  countAgreementsForAssets,
} from "../lib/edcClient.js";
import { requireRole } from "../middleware/auth.js";
import type { AxiosInstance } from "axios";

const router = Router();
const writeGuard = requireRole("admin", "operator");

// 계약(agreement) 조회용 QuerySpec — withJsonLd 기본 sortField=createdAt 은
// contractagreements 엔티티가 지원하지 않아 500 을 내므로, 정렬 없이 limit 만 보낸다.
const AGREEMENTS_QUERY = {
  "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
  "@type": "QuerySpec",
  limit: EDC_QUERY_LIMIT,
};

/** assetId → 계약(agreement) 수 맵을 조회. 계약 조회 실패 시 빈 맵(오퍼링 목록은 정상 반환). */
async function agreementCounts(
  client: AxiosInstance
): Promise<Map<string, number>> {
  try {
    const res = await client.post(
      "/v3/contractagreements/request",
      AGREEMENTS_QUERY
    );
    return buildAssetAgreementCounts(res.data);
  } catch {
    return new Map();
  }
}

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

// 평면 클라 payload({id, asset, access, contract})를 EDC ContractDefinition JSON-LD로
// 변환 + fail-fast 검증한다. POST/PUT 공용 — 과거 PUT은 평면 body를 그대로 전달해
// assetsSelector/accessPolicyId 미조립 + @id 누락으로 수정이 깨졌다(엉뚱한 계약 생성).
function buildContractDefinition(
  body: Record<string, unknown>,
  forceId?: string
): { edcBody: Record<string, unknown> } | { error: string } {
  const { id, asset, access, contract } = body;
  const assetIds = asset
    ? String(asset)
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
    : [];
  const accessId = typeof access === "string" ? access.trim() : "";
  const contractId = typeof contract === "string" ? contract.trim() : "";
  if (!accessId || !contractId) {
    return {
      error: "accessPolicyId(access)와 contractPolicyId(contract)는 필수입니다",
    };
  }
  if (assetIds.length === 0) {
    return { error: "asset은 최소 1개 이상 필요합니다" };
  }
  const edcBody = withJsonLd({
    "@type": "ContractDefinition",
    "@id": forceId ?? (typeof id === "string" && id ? id : undefined),
    accessPolicyId: accessId,
    contractPolicyId: contractId,
    assetsSelector: [
      {
        "@type": "CriterionDto",
        operandLeft: "https://w3id.org/edc/v0.0.1/ns/id",
        operator: assetIds.length === 1 ? "=" : "in",
        operandRight: assetIds.length === 1 ? assetIds[0] : assetIds,
      },
    ],
  });
  return { edcBody };
}

// POST /:id/offerings — proxy to POST /v3/contractdefinitions/request (list)
router.post(
  "/:id/offerings",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.post(
        "/v3/contractdefinitions/request",
        withJsonLd(req.body)
      );
      const mapped = Array.isArray(response.data)
        ? response.data.map(mapOffering)
        : response.data;
      // cnt(계약 수): 오퍼링 자산이 참조되는 실제 계약(agreement) 수를 채운다.
      // (과거: mapOffering 이 0 하드코딩 → 화면 '계약 수'가 항상 0·삭제 차단 미작동)
      if (Array.isArray(mapped)) {
        const counts = await agreementCounts(client);
        for (const o of mapped) {
          (o as { asset: string; cnt: number }).cnt = countAgreementsForAssets(
            (o as { asset: string }).asset,
            counts
          );
        }
      }
      res.json(mapped);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/offerings/create — proxy to POST /v3/contractdefinitions (create)
router.post(
  "/:id/offerings/create",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // fail-fast 검증 + JSON-LD 변환(공용 헬퍼). 잘못된 오퍼링은 협상 단계가 아니라
      // 생성 단계에서 즉시 400으로 거부(과거: 협상 단계에서야 실패 — id 74).
      const built = buildContractDefinition(
        req.body as Record<string, unknown>
      );
      if ("error" in built) {
        res.status(400).json({ error: built.error });
        return;
      }
      const { client } = await resolveConnector(req.params.id);
      const response = await client.post(
        "/v3/contractdefinitions",
        built.edcBody
      );
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/offerings/:offId — detail
router.get(
  "/:id/offerings/:offId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.get(
        `/v3/contractdefinitions/${req.params.offId}`
      );
      const offering = mapOffering(response.data);
      // 상세도 계약 수를 채운다 — 삭제 차단(계약 참조 시)이 올바로 동작하도록.
      const counts = await agreementCounts(client);
      offering.cnt = countAgreementsForAssets(offering.asset, counts);
      res.json(offering);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /:id/offerings/:offId — update
// create와 동일 헬퍼로 평면 필드를 EDC ContractDefinition으로 변환 + 검증한다.
// (과거: 평면 body를 그대로 전달 → @id 누락으로 EDC가 수정 대상을 못 찾고 엉뚱한
//  계약을 새로 만들었다. assetsSelector/accessPolicyId도 미조립이라 수정이 깨짐.)
// EDC v3 업데이트는 assets와 동일하게 /v3/contractdefinitions(경로에 id 없음) + body @id.
router.put(
  "/:id/offerings/:offId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const built = buildContractDefinition(
        req.body as Record<string, unknown>,
        req.params.offId
      );
      if ("error" in built) {
        res.status(400).json({ error: built.error });
        return;
      }
      const { client } = await resolveConnector(req.params.id);
      const response = await client.put(
        "/v3/contractdefinitions",
        built.edcBody
      );
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id/offerings/:offId — proxy to DELETE /v3/contractdefinitions/:offId
router.delete(
  "/:id/offerings/:offId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.delete(
        `/v3/contractdefinitions/${req.params.offId}`
      );
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

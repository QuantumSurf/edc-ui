// KMX EDC — Asset Management Routes
// Proxies: POST /v3/assets/request, POST /v3/assets, DELETE /v3/assets/:assetId

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
  mapAsset,
  toEdcAssetBody,
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

// dataAddress 시크릿 필드 — 편집 화면이 보안상 비워서 시작하고 저장 시 생략하는 값들.
const SECRET_DA_FIELDS = [
  "accessKeyId",
  "secretAccessKey",
  "authCode",
] as const;

/** JSON-LD compact 응답에서 필드를 관용적으로 추출(접두/전체 IRI 허용). */
function pickDaField(obj: Record<string, unknown>, name: string): unknown {
  for (const [k, v] of Object.entries(obj)) {
    if (k === name || k.endsWith(`:${name}`) || k.endsWith(`/${name}`))
      return v;
  }
  return undefined;
}

// EDC 의 자산 PUT 은 dataAddress 를 병합이 아니라 통째로 교체한다(적대검증 실측 확정).
// 편집 화면은 시크릿(S3 자격증명·authCode)을 비워 시작하고 저장 시 생략하므로, 그대로
// PUT 하면 objectName 하나만 바꿔도 자격증명이 소실돼 이후 전송이 인증 실패한다.
// → 생략된 시크릿 필드는 기존 자산에서 읽어 보존한다("미입력 = 기존 값 유지" 시맨틱 실현).
async function preserveOmittedSecrets(
  client: ReturnType<typeof getEdcClient>,
  assetId: string,
  edcBody: Record<string, unknown>
): Promise<void> {
  const da = edcBody["dataAddress"] as Record<string, unknown> | undefined;
  if (!da) return;
  const missing = SECRET_DA_FIELDS.filter(f => da[f] === undefined);
  if (missing.length === 0) return;
  let cur: Record<string, unknown>;
  try {
    cur = (await client.get(`/v3/assets/${encodeURIComponent(assetId)}`))
      .data as Record<string, unknown>;
  } catch {
    return; // 기존 자산 조회 실패(신규 등) — 병합만 생략하고 PUT 은 그대로 진행
  }
  const curDaRaw = pickDaField(cur, "dataAddress");
  const curDa = (Array.isArray(curDaRaw) ? curDaRaw[0] : curDaRaw) as
    | Record<string, unknown>
    | undefined;
  if (!curDa || typeof curDa !== "object") return;
  // 타입 변경(HttpData→AmazonS3 등) 시 기존 시크릿은 다른 스키마의 값이라 보존하지 않는다.
  const curType = String(pickDaField(curDa, "type") ?? "");
  if (curType && curType !== String(da["type"] ?? "")) return;
  for (const f of missing) {
    const v = pickDaField(curDa, f);
    if (typeof v === "string" && v) da[f] = v;
  }
}

// 서버 측 자산 입력 검증(이중 방어) — 클라이언트 검증을 우회한 직접 API 호출로도 깨진
// 자산이 EDC에 저장되는 것을 막는다. 단, 기존 정상 데이터를 깨지 않도록 보수적으로:
//  - baseUrl은 'https 강제'가 아니라 '파싱 가능한 URL'만 확인(내부 클러스터 http 주소 보존).
//  - id 형식은 생성 시에만 검증(편집은 immutable한 기존 id라 재검증하지 않음).
function validateAssetBody(
  b: Record<string, unknown>,
  opts: { checkId: boolean }
): string | null {
  if (opts.checkId) {
    const id = String(b.id ?? "").trim();
    if (!id) return "id는 필수입니다";
    if (id.length > 128 || /[/?#%&\s]/.test(id))
      return "id 형식이 올바르지 않습니다(공백·/?#%& 불가, 128자 이하)";
  }
  const baseUrl = typeof b.baseUrl === "string" ? b.baseUrl.trim() : "";
  if (baseUrl) {
    try {
      new URL(baseUrl);
    } catch {
      return "baseUrl 형식이 올바르지 않습니다";
    }
  }
  // AmazonS3 는 커넥터 CP 검증기(validator-data-address-s3)의 필수값을 선검증해
  // 사용자에게 더 이른/명확한 오류를 준다.
  if (String(b.dataAddressType ?? "") === "AmazonS3") {
    const region = typeof b.region === "string" ? b.region.trim() : "";
    const bucket = typeof b.bucketName === "string" ? b.bucketName.trim() : "";
    if (!region || !bucket)
      return "AmazonS3 자산은 region과 bucketName이 필수입니다";
  }
  return null;
}

// POST /:id/assets — proxy to POST /v3/assets/request (list)
// Also fetches offerings to determine per-asset offering status
router.post(
  "/:id/assets",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const [assetRes, offRes] = await Promise.all([
        client.post("/v3/assets/request", withJsonLd(req.body)),
        client
          .post("/v3/contractdefinitions/request", withJsonLd({}))
          .catch(() => ({ data: [] })),
      ]);
      const mapped = Array.isArray(assetRes.data)
        ? assetRes.data.map(mapAsset)
        : assetRes.data;

      // Build set of asset IDs referenced by offerings
      if (Array.isArray(mapped) && Array.isArray(offRes.data)) {
        const offeredAssetIds = new Set<string>();
        for (const off of offRes.data) {
          const selector = off["assetsSelector"] ?? off["edc:assetsSelector"];
          if (selector) {
            const sel = Array.isArray(selector) ? selector[0] : selector;
            // 다중 자산(in 연산자)은 operandRight가 배열 — 각 요소를 모두 Set에 추가(id 72).
            const right =
              (sel as Record<string, unknown>)?.["operandRight"] ??
              (sel as Record<string, unknown>)?.["edc:operandRight"];
            if (Array.isArray(right)) {
              for (const r of right) if (r) offeredAssetIds.add(String(r));
            } else if (right) {
              offeredAssetIds.add(String(right));
            }
          }
        }
        for (const a of mapped) {
          (a as { offered: boolean }).offered = offeredAssetIds.has(
            (a as { id: string }).id
          );
        }
      }

      res.json(mapped);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/assets/create — proxy to POST /v3/assets (create)
// 평면 클라 모델을 toEdcAssetBody로 EDC JSON-LD 변환(customProperties 병합 포함 — id 12).
router.post(
  "/:id/assets/create",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const vErr = validateAssetBody(req.body as Record<string, unknown>, {
        checkId: true,
      });
      if (vErr) {
        res.status(400).json({ error: vErr });
        return;
      }
      const { client } = await resolveConnector(req.params.id);
      const edcBody = toEdcAssetBody(req.body as Record<string, unknown>);
      const response = await client.post("/v3/assets", edcBody);
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/assets/:assetId — proxy to GET /v3/assets/:assetId (detail)
router.get(
  "/:id/assets/:assetId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.get(`/v3/assets/${req.params.assetId}`);
      res.json(mapAsset(response.data));
    } catch (error) {
      next(error);
    }
  }
);

// PUT /:id/assets/:assetId — proxy to PUT /v3/assets (update)
// create와 동일 변환(toEdcAssetBody)으로 평면→JSON-LD. @id는 URL :assetId로 강제 정합.
// (과거: withJsonLd raw 전달이라 properties/dataAddress 미구성으로 수정 깨짐 — id 11)
router.put(
  "/:id/assets/:assetId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 편집은 id가 immutable한 기존 자산이므로 id 재검증은 생략(레거시 id 보존), baseUrl만 확인.
      const vErr = validateAssetBody(req.body as Record<string, unknown>, {
        checkId: false,
      });
      if (vErr) {
        res.status(400).json({ error: vErr });
        return;
      }
      const { client } = await resolveConnector(req.params.id);
      const edcBody = toEdcAssetBody(
        req.body as Record<string, unknown>,
        req.params.assetId
      );
      // 생략된 시크릿(S3 자격증명·authCode)은 기존 값 보존 — EDC PUT 은 전체 교체라 필수.
      await preserveOmittedSecrets(client, req.params.assetId, edcBody);
      const response = await client.put("/v3/assets", edcBody);
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id/assets/:assetId — proxy to DELETE /v3/assets/:assetId
router.delete(
  "/:id/assets/:assetId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const assetId = req.params.assetId;
      // 계약(ContractDefinition)이 참조 중인 자산은 삭제 거부 — 댕글링(유령) 참조 방지.
      // UI는 이미 막지만(offered 시 삭제 비활성), 직접 API 호출/우회로도 막아 무결성을 보장한다.
      // 목록 API의 offered 계산과 동일한 assetsSelector 교차조회를 사용한다.
      const offRes = await client
        .post("/v3/contractdefinitions/request", withJsonLd({}))
        .catch(() => ({ data: [] as unknown[] }));
      const offerings: unknown[] = Array.isArray(offRes.data)
        ? offRes.data
        : [];
      const referenced = offerings.some(o => {
        const off = o as Record<string, unknown>;
        const selector = off["assetsSelector"] ?? off["edc:assetsSelector"];
        if (!selector) return false;
        const sel = (
          Array.isArray(selector) ? selector[0] : selector
        ) as Record<string, unknown>;
        const right = sel?.["operandRight"] ?? sel?.["edc:operandRight"];
        if (Array.isArray(right)) return right.some(r => String(r) === assetId);
        return right != null && String(right) === assetId;
      });
      if (referenced) {
        res
          .status(409)
          .json({ error: "계약에 등록된 자산은 삭제할 수 없습니다" });
        return;
      }
      const response = await client.delete(`/v3/assets/${assetId}`);
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

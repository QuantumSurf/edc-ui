// KMX EDC — Catalog Request Route
// Proxies: POST /v3/catalog/request

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getConnector } from "../lib/connectorRegistry.js";
import { getEdcClient } from "../lib/edcClient.js";
import { validateDspEndpoint } from "../middleware/validation.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();

const DSP_PROTOCOL = "dataspace-protocol-http:2025-1";

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

// EDC ContractOfferId 포맷: base64url(정의ID):base64url(assetId):uuid
// 카탈로그의 정책 @id는 이 인코딩 형태라 화면에 그대로 노출하면 가독성이 나쁘다.
// 표시용으로 정의ID(첫 세그먼트)를 디코딩한다. (협상 ContractRequest에는 raw offerId가 별도로 쓰임)
const OFFER_UUID_RE = /^[0-9a-fA-F-]{36}$/;
function decodePolicyId(id: string): string {
  if (!id) return id;
  const parts = id.split(":");
  if (parts.length === 3 && OFFER_UUID_RE.test(parts[2])) {
    try {
      const def = Buffer.from(parts[0], "base64url").toString("utf8");
      if (def && /^[\x20-\x7E]+$/.test(def)) return def; // 출력 가능한 ASCII만 채택
    } catch {
      /* 디코딩 실패 시 원본 유지 */
    }
  }
  return id;
}

/* ── DCAT JSON-LD → CatalogOffer[] mapper ──────────────────── */
interface CatalogOffer {
  name: string;
  type: string;
  src: string;
  pols: string[];
  offerId: string;
  assetId: string;
  dspEndpoint: string;
  providerDid: string;
}

function mapCatalogResponse(
  data: Record<string, unknown>,
  fallbackDspEndpoint = ""
): CatalogOffer[] {
  // EDC returns a DCAT Catalog with dcat:dataset array
  let datasets: Record<string, unknown>[] = [];
  const raw = data["dcat:dataset"] ?? data["dataset"] ?? [];
  if (Array.isArray(raw)) datasets = raw;
  else if (raw && typeof raw === "object")
    datasets = [raw as Record<string, unknown>];

  // Extract providerDid from catalog root participantId
  const providerDid = (data["participantId"] ??
    data["edc:participantId"] ??
    "") as string;

  // Extract dspEndpoint from catalog root service if available, otherwise fall back to queried endpoint
  const rootService = data["service"] ?? data["dcat:service"];
  let rootDspEndpoint = fallbackDspEndpoint;
  if (rootService) {
    const svc = Array.isArray(rootService) ? rootService[0] : rootService;
    const ep = ((svc as Record<string, unknown>)?.["endpointURL"] ??
      (svc as Record<string, unknown>)?.["dcat:endpointURL"] ??
      "") as string;
    if (ep) rootDspEndpoint = ep;
  }

  return datasets.map(ds => {
    const assetId = (ds["@id"] ??
      ds["edc:id"] ??
      ds["id"] ??
      "unknown") as string;
    const name = (ds["name"] ??
      ds["edc:name"] ??
      ds["rdfs:label"] ??
      assetId) as string;
    const type = (ds["edc:type"] ??
      (ds["dct:type"] as Record<string, unknown>)?.["@id"] ??
      ds["type"] ??
      "Asset") as string;

    // Extract policy IDs from odrl:hasPolicy
    const rawPolicy = ds["odrl:hasPolicy"] ?? ds["hasPolicy"] ?? [];
    const policies: Record<string, unknown>[] = Array.isArray(rawPolicy)
      ? rawPolicy
      : [rawPolicy];
    const rawPols = policies
      .map(p => (p?.["@id"] ?? p?.["id"] ?? "") as string)
      .filter(Boolean);

    // offerId: first policy's @id + 전체 policy 객체 (ContractRequest에 raw 인코딩값 그대로 필요)
    const offerId = rawPols[0] ?? "";
    const offerPolicy = policies[0] ?? null;

    // pols: 화면 표시용 — 인코딩된 offer @id를 정의ID로 디코딩
    const pols = rawPols.map(decodePolicyId);

    // Source from distribution or dataAddress
    const dist = ds["dcat:distribution"] ?? ds["distribution"];
    let src = "";
    let dspEndpoint = rootDspEndpoint;
    if (dist) {
      const d = Array.isArray(dist)
        ? dist[0]
        : (dist as Record<string, unknown>);
      src = ((d as Record<string, unknown>)?.["dcat:accessURL"] ??
        (d as Record<string, unknown>)?.["dcat:downloadURL"] ??
        "") as string;
      // Extract DSP endpoint from accessService
      const accessService =
        (d as Record<string, unknown>)?.["accessService"] ??
        (d as Record<string, unknown>)?.["dcat:accessService"];
      if (accessService) {
        const svc = Array.isArray(accessService)
          ? accessService[0]
          : accessService;
        const ep =
          (svc as Record<string, unknown>)?.["endpointURL"] ??
          (svc as Record<string, unknown>)?.["dcat:endpointURL"] ??
          "";
        if (ep) dspEndpoint = ep as string;
      }
    }

    return {
      name,
      type,
      src,
      pols,
      offerId,
      offerPolicy,
      assetId,
      dspEndpoint,
      providerDid,
    };
  });
}

// POST /:id/catalog — proxy to POST /v3/catalog/request
// 인증된 모든 역할이 카탈로그 조회 가능. SSRF 방지를 위해 dspEndpoint 사전 검증.
router.post(
  "/:id/catalog",
  requireRole("admin", "operator", "viewer"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { dspEndpoint, counterPartyId } = req.body ?? {};

      if (!dspEndpoint || typeof dspEndpoint !== "string") {
        res
          .status(400)
          .json({ error: "dspEndpoint is required and must be a string" });
        return;
      }
      if (!counterPartyId || typeof counterPartyId !== "string") {
        res
          .status(400)
          .json({ error: "counterPartyId is required and must be a string" });
        return;
      }
      if (dspEndpoint.length > 2048 || counterPartyId.length > 512) {
        res.status(400).json({ error: "Input length exceeds limit" });
        return;
      }
      const ssrfErr = validateDspEndpoint(dspEndpoint);
      if (ssrfErr) {
        res.status(400).json({ error: `Rejected dspEndpoint: ${ssrfErr}` });
        return;
      }

      const { client } = await resolveConnector(req.params.id);

      // DSP 2025-1 endpoint 보정: 끝이 /api/v1/dsp 면 /2025-1 자동 부착
      // (Consumer EDC는 /2025-1을 자동 추가하지 않으므로, 사용자 실수 방지를 위해 BFF에서 보정)
      let normalizedDspEndpoint = String(dspEndpoint).replace(/\/+$/, "");
      if (/\/api\/v1\/dsp$/.test(normalizedDspEndpoint)) {
        normalizedDspEndpoint = `${normalizedDspEndpoint}/2025-1`;
      }

      // counterPartyId 보정: 이 값은 발급되는 STS 토큰의 audience로 쓰인다. provider의
      // 전체 DID여야 하며, 맨 BPN(예: BPNL000000000PRD)을 그대로 쓰면 audience 불일치로
      // provider가 opaque "CatalogError 401 Unauthorized"를 반환한다. BPN 형태면 이
      // 데이터스페이스 규약(did:web:identityhub:participants:<BPN>)으로 정규화한다.
      let normalizedCounterPartyId = String(counterPartyId).trim();
      if (
        !/^did:/i.test(normalizedCounterPartyId) &&
        /^BPNL[0-9A-Z]+$/i.test(normalizedCounterPartyId)
      ) {
        normalizedCounterPartyId = `did:web:identityhub:participants:${normalizedCounterPartyId}`;
      }

      // Build proper CatalogRequest JSON-LD
      const catalogRequest = {
        "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
        "@type": "CatalogRequest",
        counterPartyAddress: normalizedDspEndpoint,
        counterPartyId: normalizedCounterPartyId,
        protocol: DSP_PROTOCOL,
      };

      // DCP 인증 플로우(STS 토큰 + DID 해석 + VC 검증)에 최소 20~30초 소요 → 60초로 연장
      const response = await client.post(
        "/v3/catalog/request",
        catalogRequest,
        { timeout: 60_000 }
      );

      // Map DCAT response to CatalogOffer[] (queried DSP endpoint as fallback)
      const offers = mapCatalogResponse(
        response.data ?? {},
        normalizedDspEndpoint
      );
      res.json(offers);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

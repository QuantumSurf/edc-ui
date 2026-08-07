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
import { assertEndpointPublic } from "../middleware/validation.js";
import { requireRole } from "../middleware/auth.js";
import {
  getDtrClient,
  mapShellDescriptor,
  type ShellDescriptorLite,
} from "../lib/dtrClient.js";
import { getTenant } from "../lib/tenants.js";

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

// EDC ContractOfferId 포맷: base64url(정의ID):base64url(assetId):<uuid>
// 카탈로그의 정책 @id는 이 인코딩 형태라 화면에 그대로 노출하면 가독성이 나쁘다.
// 표시용으로 정의ID(첫 세그먼트)를 디코딩한다. (협상 ContractRequest에는 raw offerId가 별도로 쓰임)
// 세 번째 세그먼트는 커넥터 버전에 따라 raw UUID(EDC 코어) 또는 base64url(UUID)
// (kmx-edc 0.17)로 온다 — 둘 다 UUID로 인식해 첫 세그먼트를 디코딩한다.
const OFFER_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function b64ToUtf8(s: string): string | null {
  try {
    const out = Buffer.from(s, "base64url").toString("utf8");
    return out && /^[\x20-\x7E]+$/.test(out) ? out : null; // 출력 가능한 ASCII만
  } catch {
    return null;
  }
}
export function decodePolicyId(id: string): string {
  if (!id) return id;
  const parts = id.split(":");
  if (parts.length !== 3) return id;
  // 세 번째 세그먼트가 raw UUID 이거나, base64url 로 디코딩했을 때 UUID 여야 오퍼 ID 로 본다.
  const isOfferId =
    OFFER_UUID_RE.test(parts[2]) ||
    OFFER_UUID_RE.test(b64ToUtf8(parts[2]) ?? "");
  if (!isOfferId) return id;
  return b64ToUtf8(parts[0]) ?? id;
}

// ── 오퍼 정책 제약 요약 ──────────────────────────────────────────
// 카탈로그의 "정책" 열은 오퍼 ID(mt-offer-01) 만으로는 "이 데이터를 쓰려면 무슨 조건을
// 충족해야 하나"를 알 수 없다. offerPolicy(계약 정책)의 제약을 사람이 읽을 수 있는
// {left, op, right} 로 평탄화해 화면에 칩으로 노출한다.
export interface OfferConstraint {
  left: string;
  op: string;
  right: string;
}

// operator 로컬명 → 사람이 읽는 기호(없으면 로컬명 그대로).
const OP_SYMBOLS: Record<string, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  lt: "<",
  gteq: "≥",
  lteq: "≤",
  isAnyOf: "∈",
  isNoneOf: "∉",
  in: "∈",
};

function localName(v: string): string {
  const i = Math.max(
    v.lastIndexOf("/"),
    v.lastIndexOf("#"),
    v.lastIndexOf(":")
  );
  return i < 0 ? v : v.slice(i + 1);
}

function operandName(v: unknown): string {
  const s =
    v && typeof v === "object"
      ? String((v as Record<string, unknown>)["@id"] ?? "")
      : String(v ?? "");
  return localName(s);
}

function opDisplay(op: unknown): string {
  const s =
    op && typeof op === "object"
      ? String((op as Record<string, unknown>)["@id"] ?? "")
      : String(op ?? "");
  const name = localName(s);
  return OP_SYMBOLS[name] ?? name;
}

function rightDisplay(r: unknown): string {
  if (Array.isArray(r)) return r.map(rightDisplay).filter(Boolean).join(", ");
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    return String(o["@value"] ?? o["@id"] ?? "");
  }
  return String(r ?? "");
}

/**
 * offerPolicy(카탈로그 DCAT 축약형 또는 odrl: 접두형) 에서 permission 제약을 평탄화한다.
 * 논리 래퍼(and/or/xone)는 재귀적으로 풀고, atomic 제약만 {left, op, right} 로 수집한다.
 */
export function extractOfferConstraints(
  policy: Record<string, unknown> | null | undefined
): OfferConstraint[] {
  if (!policy) return [];
  const LOGICAL = ["and", "or", "xone"];
  const out: OfferConstraint[] = [];
  const walk = (node: unknown) => {
    if (!node) return;
    for (const n of Array.isArray(node) ? node : [node]) {
      if (!n || typeof n !== "object") continue;
      const obj = n as Record<string, unknown>;
      const logical = LOGICAL.map(k => [k, `odrl:${k}`]).find(
        ([a, b]) => obj[a] !== undefined || obj[b] !== undefined
      );
      if (logical) {
        walk(obj[logical[0]] ?? obj[logical[1]]);
        continue;
      }
      const left = obj["leftOperand"] ?? obj["odrl:leftOperand"];
      if (left == null) continue;
      out.push({
        left: operandName(left),
        op: opDisplay(obj["operator"] ?? obj["odrl:operator"]),
        right: rightDisplay(obj["rightOperand"] ?? obj["odrl:rightOperand"]),
      });
    }
  };
  const perms = policy["permission"] ?? policy["odrl:permission"] ?? [];
  for (const p of Array.isArray(perms) ? perms : [perms]) {
    if (!p || typeof p !== "object") continue;
    const po = p as Record<string, unknown>;
    walk(po["constraint"] ?? po["odrl:constraint"]);
  }
  return out;
}

/* ── DCAT JSON-LD → CatalogOffer[] mapper ──────────────────── */
interface CatalogOffer {
  name: string;
  type: string;
  src: string;
  pols: string[];
  // constraints: 화면 "정책" 열에 표시할 사람이 읽는 제약 요약(offerPolicy 에서 추출).
  constraints: OfferConstraint[];
  offerId: string;
  // offerPolicy: 협상(ContractRequest)에 그대로 넘기는 전체 정책 객체. 선언↔페이로드 정합(id 80).
  offerPolicy: Record<string, unknown> | null;
  assetId: string;
  dspEndpoint: string;
  providerDid: string;
  // ── AAS 연계(부가) — 이 오퍼가 어느 디지털 트윈의 데이터인지. DTR 미가용 시 비어
  //    있을 수 있으며 카탈로그 자체 동작에는 영향이 없다(attachAasLinks 참조).
  aasId?: string;
  aasIdShort?: string;
  globalAssetId?: string;
}

/**
 * 카탈로그 오퍼(EDC assetId) ↔ DTR 셸 연계.
 * 매칭 근거 2중: (1) 서브모델 디스크립터 endpoint 의 subprotocolBody("id=<assetId>;…")
 * — ExposeSubmodelDialog 가 생성하는 표준 규약, (2) href 쿼리 등에서 못 찾으면 무시.
 * 부가 정보이므로 DTR 장애·미설정 시 조용히 건너뛴다(카탈로그를 깨뜨리지 않는다).
 */
async function attachAasLinks(
  req: Request,
  offers: CatalogOffer[]
): Promise<void> {
  if (offers.length === 0) return;
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return;
    const tenant = await getTenant(tenantId);
    if (!tenant?.bpn) return;
    // BPN 단위 TTL 캐시(assetId→셸 요약) — 매 카탈로그 조회마다 DTR 을 동기 호출하던 부하를
    // 제거한다(카탈로그는 자주 열린다). 짧은 TTL 이라 최신성 손실은 미미.
    const byAssetId = await getAasLinkMap(tenant.bpn);
    for (const offer of offers) {
      const shell = byAssetId.get(offer.assetId);
      if (!shell) continue;
      offer.aasId = shell.aasId;
      offer.aasIdShort = shell.aasIdShort;
      offer.globalAssetId = shell.globalAssetId;
    }
  } catch {
    // DTR 미가용 — 부가 정보라 무시하고 카탈로그는 그대로 반환.
  }
}

interface AasLink {
  aasId: string;
  aasIdShort: string;
  globalAssetId: string;
}
const AAS_LINK_TTL_MS = 60_000;
const aasLinkCache = new Map<
  string,
  { map: Map<string, AasLink>; exp: number }
>();

/** BPN 의 assetId→AAS 연계 맵을 TTL 캐시로 조회. DTR 첫 페이지(500)까지 커서 순회. */
async function getAasLinkMap(bpn: string): Promise<Map<string, AasLink>> {
  const now = Date.now();
  const hit = aasLinkCache.get(bpn);
  if (hit && hit.exp > now) return hit.map;

  const dtr = getDtrClient(bpn);
  const map = new Map<string, AasLink>();
  let cursor: string | undefined;
  let pages = 0;
  // 200 개씩 커서 순회(과거엔 첫 200 만 봐서 초과분 매칭 누락). 안전 상한 5페이지(=1000).
  do {
    const params: Record<string, unknown> = { limit: 200 };
    if (cursor) params.cursor = cursor;
    const { data } = await dtr.get("/shell-descriptors", { params });
    const shells: ShellDescriptorLite[] = Array.isArray(data?.result)
      ? data.result.map(mapShellDescriptor)
      : [];
    for (const shell of shells) {
      for (const sub of shell.submodelDescriptors) {
        for (const ep of sub.endpoints ?? []) {
          const m = /(?:^|;)\s*id=([^;]+)/.exec(ep.subprotocolBody ?? "");
          if (m?.[1])
            map.set(m[1].trim(), {
              aasId: shell.id,
              aasIdShort: shell.idShort,
              globalAssetId: shell.globalAssetId,
            });
        }
      }
    }
    cursor = data?.paging_metadata?.cursor as string | undefined;
    pages++;
    if (cursor && pages >= 5) {
      console.warn(
        `[catalog] attachAasLinks: DTR 셸이 1000개를 초과해 순회를 절단(bpn=${bpn}). 일부 오퍼의 AAS 연계가 누락될 수 있음.`
      );
      break;
    }
  } while (cursor);

  aasLinkCache.set(bpn, { map, exp: now + AAS_LINK_TTL_MS });
  return map;
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

    // offerId와 offerPolicy를 '동일' 정책 객체에서 일관 선택 — @id(또는 id)를 가진 첫 정책을
    // 단일 소스로 잡아 둘이 서로 다른 정책에서 나오는 정합성 붕괴를 막는다(id 79).
    // (negotiations의 {...offerPolicy, "@id": offerId} 합성이 정합성을 유지하도록)
    const primaryPolicy =
      policies.find(p => p?.["@id"] ?? p?.["id"]) ?? policies[0] ?? null;
    const offerId = (primaryPolicy?.["@id"] ??
      primaryPolicy?.["id"] ??
      "") as string;
    const offerPolicy = primaryPolicy;

    // pols: 화면 표시용 — 인코딩된 offer @id를 정의ID로 디코딩
    const pols = rawPols.map(decodePolicyId);
    // constraints: 계약 정책의 제약을 사람이 읽는 요약으로(정책 열 표시).
    const constraints = extractOfferConstraints(offerPolicy);

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
      constraints,
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
      const { dspEndpoint, counterPartyId, assetId } = req.body ?? {};

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
      const ssrfErr = await assertEndpointPublic(dspEndpoint);
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
      const catalogRequest: Record<string, unknown> = {
        "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
        "@type": "CatalogRequest",
        counterPartyAddress: normalizedDspEndpoint,
        counterPartyId: normalizedCounterPartyId,
        protocol: DSP_PROTOCOL,
      };
      // 특정 자산만 조회 — assetId 지정 시 querySpec 필터를 부착해 카탈로그 페이지 한계(기본 상한)를
      // 우회한다. (대량 오퍼링 중 방금 발행한 자산을 소비자가 확실히 찾도록 — id 폴백 방지)
      if (
        typeof assetId === "string" &&
        assetId.trim() &&
        assetId.length <= 256
      ) {
        catalogRequest["querySpec"] = {
          filterExpression: [
            {
              operandLeft: "https://w3id.org/edc/v0.0.1/ns/id",
              operator: "=",
              operandRight: assetId.trim(),
            },
          ],
        };
      }

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
      await attachAasLinks(req, offers);
      res.json(offers);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

// KMX EDC — Connector Registry Routes
// Manages connector CRUD (no EDC proxy — operates on local registry)

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import {
  listConnectors,
  getConnector,
  registerConnector,
  updateConnector,
  deleteConnector,
  countConnectorsByTenant,
} from "../lib/connectorRegistry.js";
import { getTenant } from "../lib/tenants.js";
import { createEdcClient, EDC_QUERY_LIMIT } from "../lib/edcClient.js";
import { requireRole } from "../middleware/auth.js";
import { assertEndpointPublic } from "../middleware/validation.js";
import { validateBody } from "../middleware/validate.js";
import {
  createConnectorSchema,
  updateConnectorSchema,
  testConnectionSchema,
} from "../schemas/connectors.js";
import {
  mapWithConcurrency,
  FLEET_FANOUT_CONCURRENCY,
} from "../lib/concurrency.js";

const router = Router();
const adminOnly = requireRole("admin");
const operatorOrAdmin = requireRole("admin", "operator");

// 테넌트당 커넥터 수 상한 — 무제한 등록 후 GET / fan-out(커넥터당 4 outbound) 증폭 DoS 방지.
const MAX_CONNECTORS_PER_TENANT = Number(
  process.env.MAX_CONNECTORS_PER_TENANT ?? 100
);

// SSRF 가드: 서버가 호출하게 될 커넥터 URL(managementUrl/dspEndpoint)이
// 사설/내부/메타데이터 주소를 가리키지 않도록 검증. (catalog 등과 동일 정책)
// SSRF 가드 — catalog/negotiation/transfer 와 동일하게 DNS 해석 기반
// assertEndpointPublic 을 쓴다(문자열 검사만으로는 공인 도메인→내부 IP 해석을 못 막고,
// managementUrl 은 폴러·플릿이 반복 폴링하므로 등록 시점 강한 가드가 특히 중요).
async function validateConnectorUrls(body: {
  managementUrl?: unknown;
  dspEndpoint?: unknown;
}): Promise<string | null> {
  const fields: Array<["managementUrl" | "dspEndpoint", unknown]> = [
    ["managementUrl", body.managementUrl],
    ["dspEndpoint", body.dspEndpoint],
  ];
  for (const [field, val] of fields) {
    if (typeof val === "string" && val.trim()) {
      const err = await assertEndpointPublic(val.trim());
      if (err) return `${field}: ${err}`;
    }
  }
  return null;
}

const JSON_LD_QUERY = {
  "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
  "@type": "QuerySpec",
  // limit 미지정 시 EDC 기본 50 으로 카운트가 잘린다(사이드바 배지 과소집계).
  limit: EDC_QUERY_LIMIT,
};

function countArray(res: {
  status: string;
  value?: { data: unknown };
}): number {
  if (res.status !== "fulfilled") return 0;
  const d = (res as PromiseFulfilledResult<{ data: unknown }>).value.data;
  return Array.isArray(d) ? d.length : 0;
}

// GET / — list the tenant's registered connectors (with live status + counts)
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // tenant fail-closed: tenantId 없는 토큰은 전체 노출 대신 명시적으로 거부.
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      res.status(403).json({ error: "no-tenant" });
      return;
    }
    const connectors = await listConnectors(tenantId);

    // 동시성 상한 fan-out(커넥터당 4 outbound). 무제한 Promise.all 은 커넥터가 많은
    // 테넌트에서 단일 요청으로 소켓/이벤트루프를 고갈시킬 수 있어 상한을 둔다.
    const withStatus = await mapWithConcurrency(
      connectors,
      FLEET_FANOUT_CONCURRENCY,
      async ({ apiKey, ...safe }) => {
        // 부분 장애(일부 API만 실패) 표현을 위해 up/warn/down 3-state로 산출.
        let status: "up" | "warn" | "down" = "down";
        let assets = 0,
          offers = 0,
          negs = 0,
          transfers = 0;

        try {
          const client = createEdcClient({
            managementUrl: safe.managementUrl,
            apiKey,
            timeoutMs: 5_000,
          });

          const [assetsRes, offersRes, negsRes, transfersRes] =
            await Promise.allSettled([
              client.post("/v3/assets/request", JSON_LD_QUERY),
              client.post("/v3/contractdefinitions/request", JSON_LD_QUERY),
              client.post("/v3/contractnegotiations/request", JSON_LD_QUERY),
              client.post("/v3/transferprocesses/request", JSON_LD_QUERY),
            ]);

          assets = countArray(assetsRes);
          offers = countArray(offersRes);
          negs = countArray(negsRes);
          transfers = countArray(transfersRes);

          // 4개 모두 성공=up, 0개=down, 일부만 성공=warn(부분 장애/열화).
          const oks = [assetsRes, offersRes, negsRes, transfersRes].filter(
            r => r.status === "fulfilled"
          ).length;
          status = oks === 0 ? "down" : oks === 4 ? "up" : "warn";
        } catch {
          /* all failed → down */
        }

        // 클라 계약 호환: 카드가 dcpVersion으로 DCP 배지를 표시하므로 dcpVersion을 그대로 노출.
        // (safe에 이미 dcpVersion 포함 — 별도 alias 불필요)
        return { ...safe, status, assets, offers, negs, transfers };
      }
    );

    res.json(withStatus);
  } catch (error) {
    next(error);
  }
});

// POST / — register a new connector under the caller's tenant
router.post(
  "/",
  adminOnly,
  // 필수 필드/타입/enum 검증은 zod 게이트(createConnectorSchema)가 담당 —
  // 누락/오타가 500 으로 새거나 임의 env/roles 가 저장되는 것을 400 으로 명확히 거부.
  validateBody(createConnectorSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      // BPN is managed in Settings (the tenant's org BPN) — force it server-side,
      // ignoring any client-supplied bpn. tenant_id is likewise forced from the token.
      const tenant = await getTenant(tenantId);
      const entry = { ...req.body, bpn: tenant?.bpn ?? req.body?.bpn };
      const ssrfErr = await validateConnectorUrls(entry);
      if (ssrfErr) {
        res.status(400).json({ error: `Rejected URL — ${ssrfErr}` });
        return;
      }
      // 테넌트당 커넥터 수 상한 — fan-out 증폭 DoS 방지(tenant 스코프 COUNT).
      if (
        (await countConnectorsByTenant(tenantId)) >= MAX_CONNECTORS_PER_TENANT
      ) {
        res.status(409).json({ error: "connector-limit-reached" });
        return;
      }
      const connector = await registerConnector(entry, tenantId);
      const { apiKey: _apiKey, ...safe } = connector;
      res.status(201).json(safe);
    } catch (error) {
      next(error);
    }
  }
);

// POST /test-connection — test connectivity before registration
// [클라 계약] 이 가드는 operator+admin(operatorOrAdmin)이다. 클라 rbac.ts는 이를 미러링하는
// 권한 키(예: "connector:test": ["admin","operator"])로 표현을 동기화해야 한다(다음 단계 클라 작업).
router.post(
  "/test-connection",
  operatorOrAdmin,
  validateBody(testConnectionSchema),
  async (req: Request, res: Response, _next: NextFunction) => {
    try {
      const { managementUrl, apiKey } = req.body as {
        managementUrl: string;
        apiKey?: string;
      };
      // DNS 해석 기반 SSRF 가드(등록 경로와 동일 강도).
      const ssrfErr = await assertEndpointPublic(managementUrl.trim());
      if (ssrfErr) {
        res.status(400).json({ error: `Rejected managementUrl — ${ssrfErr}` });
        return;
      }

      const client = createEdcClient({
        managementUrl,
        apiKey: apiKey ?? "",
        timeoutMs: 5_000,
      });

      // Try Management API endpoint (assets query) since /api/check/health is on a different port
      try {
        const response = await client.post("/v3/assets/request", {
          "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
          "@type": "QuerySpec",
          limit: 1,
        });
        res.json({
          status: "ok",
          detail: {
            assets: Array.isArray(response.data) ? response.data.length : 0,
          },
        });
        return;
      } catch {
        // Fallback: try health endpoint (same port)
      }

      const response = await client.get("/api/check/health");
      res.json({ status: "ok", detail: response.data });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      // 업스트림(커넥터 EDC) 미도달 — Vault/EDC 경로와 동일하게 503 으로 통일(502 혼용 제거).
      res.status(503).json({ status: "fail", detail: msg });
    }
  }
);

// PUT /:id — update a connector
router.put(
  "/:id",
  adminOnly,
  validateBody(updateConnectorSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      // 소유권 확인(IDOR 차단 — 본인 테넌트 커넥터만). requireConnectorOwnership 미들웨어가
      // 이미 막지만, BPN 강제와 동일 트랜잭션 맥락에서 한 번 더 명시 검증해 fail-closed 유지.
      const existing = await getConnector(req.params.id);
      if (!existing || existing.tenantId !== tenantId) {
        res.status(404).json({ error: "connector-not-found" });
        return;
      }

      const ssrfErr = await validateConnectorUrls(req.body ?? {});
      if (ssrfErr) {
        res.status(400).json({ error: `Rejected URL — ${ssrfErr}` });
        return;
      }

      // POST와 동일한 서버측 불변식: bpn/tenantId/id는 클라이언트 입력을 신뢰하지 않고
      // 테넌트 조직 BPN으로 재강제한다(임의 bpn 갱신으로 'BPN=테넌트 식별자' 불변식 파괴 차단).
      const tenant = await getTenant(tenantId);
      const {
        bpn: _ignoredBpn,
        tenantId: _ignoredTid,
        id: _ignoredId,
        ...safeBody
      } = (req.body ?? {}) as Record<string, unknown>;
      const updates = { ...safeBody, bpn: tenant?.bpn ?? existing.bpn };

      const updated = await updateConnector(req.params.id, updates);
      if (!updated) {
        res.status(404).json({ error: "connector-not-found" });
        return;
      }
      const { apiKey: _apiKey, ...safe } = updated;
      res.json(safe);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id — delete a connector by id
router.delete(
  "/:id",
  adminOnly,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await deleteConnector(req.params.id);
      if (!deleted) {
        // ownership 미들웨어와 동일 계약(코드값)으로 통일 — id 값 노출 제거.
        res.status(404).json({ error: "connector-not-found" });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

export default router;

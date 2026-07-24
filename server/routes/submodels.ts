// KMX EDC — DTR: Submodel Descriptor Routes
// Path: /api/dtr/shells/:aasId/submodels[/:submodelId]
// 멀티테넌트: 호출자 테넌트 BPN(Edc-Bpn)으로 DTR 클라이언트를 만들어 셸 풀을 격리한다(id 86).

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import axios from "axios";
import {
  getDtrClient,
  encodeAasId,
  mapSubmodelDescriptor,
} from "../lib/dtrClient.js";
import { getTenant } from "../lib/tenants.js";
import { requireRole } from "../middleware/auth.js";
import { assertEndpointPublic } from "../middleware/validation.js";

const router = Router();
const writeGuard = requireRole("admin", "operator");

/** 호출자 테넌트 BPN으로 DTR 클라이언트 생성. tenantId/BPN 없으면 null(호출부 403). */
async function resolveDtrClient(req: Request) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return null;
  const tenant = await getTenant(tenantId);
  if (!tenant?.bpn) return null;
  return getDtrClient(tenant.bpn);
}

// GET /api/dtr/shells/:aasId/submodels — list submodel descriptors of a shell
router.get(
  "/shells/:aasId/submodels",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = await resolveDtrClient(req);
      if (!client) {
        res.status(403).json({ error: "no-tenant-bpn" });
        return;
      }
      const aas = encodeAasId(req.params.aasId);
      const { data } = await client.get(
        `/shell-descriptors/${aas}/submodel-descriptors`
      );
      const items = Array.isArray(data?.result)
        ? data.result.map(mapSubmodelDescriptor)
        : [];
      res.json({ items });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/dtr/shells/:aasId/submodels/:submodelId/content
// 디스크립터의 endpoint href 를 따라가 실제 서브모델 본문(AAS Part 2 Submodel Interface —
// submodelElements/value/element별 semanticId)을 읽기 전용으로 프록시한다. 이게 없으면
// 콘솔은 "디스크립터 브라우저"에 머문다 — 등록 오류를 실본문으로 검증하는 실무 경로.
// href 는 레지스트리에서 온 외부 입력이므로 SSRF 가드(assertEndpointPublic — DNS 해석
// 포함)를 반드시 통과시키고, 리다이렉트·응답 크기도 제한한다.
router.get(
  "/shells/:aasId/submodels/:submodelId/content",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = await resolveDtrClient(req);
      if (!client) {
        res.status(403).json({ error: "no-tenant-bpn" });
        return;
      }
      const aas = encodeAasId(req.params.aasId);
      const { data } = await client.get(
        `/shell-descriptors/${aas}/submodel-descriptors`
      );
      const descs = Array.isArray(data?.result)
        ? data.result.map(mapSubmodelDescriptor)
        : [];
      const desc = descs.find(
        (d: { id: string }) => d.id === req.params.submodelId
      );
      if (!desc) {
        res.status(404).json({ error: "submodel-not-found" });
        return;
      }
      const href = desc.endpoints.find((e: { href: string }) => e.href)?.href;
      if (!href) {
        res.status(404).json({ error: "no-submodel-endpoint" });
        return;
      }
      const unsafe = await assertEndpointPublic(href);
      if (unsafe) {
        res.status(400).json({ error: "unsafe-endpoint", detail: unsafe });
        return;
      }
      const { data: content } = await axios.get(href, {
        timeout: 8_000,
        maxContentLength: 2_000_000, // 뷰어용 상한 — 거대 본문으로 BFF 메모리 고갈 방지
        maxRedirects: 0, // 리다이렉트로 SSRF 가드를 우회하지 못하게 차단
        headers: { Accept: "application/json" },
      });
      res.json({
        idShort: desc.idShort,
        semanticId: desc.semanticId,
        href,
        content,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/dtr/shells/:aasId/submodels — create submodel descriptor
router.post(
  "/shells/:aasId/submodels",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = await resolveDtrClient(req);
      if (!client) {
        res.status(403).json({ error: "no-tenant-bpn" });
        return;
      }
      const aas = encodeAasId(req.params.aasId);
      const { data } = await client.post(
        `/shell-descriptors/${aas}/submodel-descriptors`,
        req.body
      );
      res.status(201).json(mapSubmodelDescriptor(data));
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/dtr/shells/:aasId/submodels/:submodelId — replace submodel descriptor
router.put(
  "/shells/:aasId/submodels/:submodelId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = await resolveDtrClient(req);
      if (!client) {
        res.status(403).json({ error: "no-tenant-bpn" });
        return;
      }
      const aas = encodeAasId(req.params.aasId);
      const sub = encodeAasId(req.params.submodelId);
      await client.put(
        `/shell-descriptors/${aas}/submodel-descriptors/${sub}`,
        req.body
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/dtr/shells/:aasId/submodels/:submodelId
router.delete(
  "/shells/:aasId/submodels/:submodelId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = await resolveDtrClient(req);
      if (!client) {
        res.status(403).json({ error: "no-tenant-bpn" });
        return;
      }
      const aas = encodeAasId(req.params.aasId);
      const sub = encodeAasId(req.params.submodelId);
      await client.delete(
        `/shell-descriptors/${aas}/submodel-descriptors/${sub}`
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

export default router;

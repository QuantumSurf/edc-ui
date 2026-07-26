// KMX EDC — Business Partner Group Routes
// kmx-bpn-policy 확장이 노출하는 Management API(/v3/business-partner-groups)를 프록시한다.
// 그룹 멤버십은 BusinessPartnerGroup 정책 제약(isAnyOf 등)의 평가 대상 데이터 —
// 스토어에 등록되지 않은 BPN 은 그룹 정책에서 항상 거부되므로, 정책 화면에서 함께 관리한다.

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getConnector } from "../lib/connectorRegistry.js";
import { getEdcClient } from "../lib/edcClient.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();
const writeGuard = requireRole("admin", "operator");

const KMX_NS = "https://w3id.org/kmx/v0.1/ns/";
// kmx-edc KmxPolicyDefinitionValidator 와 동일한 BPN 형식 — 불일치 입력은 커넥터까지 가기 전에 400.
const BPN_RE = /^BPNL[0-9A-Z]{12}$/;
// 그룹 목록 집계 시 그룹별 멤버 조회 동시성 상한(무제한 N+1 방지 — edrs 라우트와 동일 정책).
const GROUP_FETCH_CONCURRENCY = 6;

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

/** JSON-LD compact 응답에서 문자열 배열 값을 관용적으로 추출(kmx: 접두 유무·단일 문자열 축약 허용). */
function pickStringArray(
  obj: Record<string, unknown>,
  suffix: string
): string[] {
  for (const [k, v] of Object.entries(obj)) {
    if (k !== suffix && !k.endsWith(`:${suffix}`) && !k.endsWith(`/${suffix}`))
      continue;
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
    if (typeof v === "string" && v) return [v];
  }
  return [];
}

// GET /:id/bpn-groups — 전체 그룹과 각 그룹의 멤버 BPN 을 집계해 반환.
// 응답: { groups: [{ group, bpns: string[] }] }
router.get(
  "/:id/bpn-groups",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const namesRes = await client.get("/v3/business-partner-groups/groups");
      const names = pickStringArray(
        namesRes.data as Record<string, unknown>,
        "groups"
      );

      const results = new Array<{ group: string; bpns: string[] }>(
        names.length
      );
      let nextIdx = 0;
      const workers = Array.from(
        {
          length: Math.max(1, Math.min(GROUP_FETCH_CONCURRENCY, names.length)),
        },
        async () => {
          while (true) {
            const i = nextIdx++;
            if (i >= names.length) break;
            try {
              const r = await client.get(
                `/v3/business-partner-groups/group/${encodeURIComponent(names[i])}`
              );
              results[i] = {
                group: names[i],
                bpns: pickStringArray(
                  r.data as Record<string, unknown>,
                  "bpns"
                ),
              };
            } catch {
              // 개별 그룹 조회 실패는 빈 멤버로 표시(목록 전체 실패 방지)
              results[i] = { group: names[i], bpns: [] };
            }
          }
        }
      );
      await Promise.all(workers);

      res.json({ groups: results });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/bpn-groups/bpn/:bpn — 특정 BPN 이 속한 그룹 목록(편집 진입용).
router.get(
  "/:id/bpn-groups/bpn/:bpn",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const r = await client.get(
        `/v3/business-partner-groups/${encodeURIComponent(req.params.bpn)}`
      );
      res.json({
        bpn: req.params.bpn,
        groups: pickStringArray(r.data as Record<string, unknown>, "groups"),
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/bpn-groups — BPN→그룹 매핑 upsert. { bpn, groups: string[] }
// 커넥터 API 는 POST(신규, 중복 409)/PUT(갱신, 미존재 404)이 분리돼 있어 BFF 가 409→PUT 폴백으로
// upsert 시맨틱을 제공한다(UI 는 '저장' 단일 동작).
router.post(
  "/:id/bpn-groups",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { bpn, groups } = (req.body ?? {}) as {
        bpn?: string;
        groups?: unknown;
      };
      if (!bpn || !BPN_RE.test(bpn)) {
        res
          .status(400)
          .json({ error: "bpn must match BPNL + 12 alphanumeric characters" });
        return;
      }
      const groupList = Array.isArray(groups)
        ? groups.map(g => String(g).trim()).filter(Boolean)
        : [];
      if (groupList.length === 0) {
        res.status(400).json({ error: "groups must be a non-empty array" });
        return;
      }

      const { client } = await resolveConnector(req.params.id);
      const body = {
        "@context": { kmx: KMX_NS },
        "@id": bpn,
        "kmx:groups": groupList,
      };
      try {
        await client.post("/v3/business-partner-groups", body);
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status !== 409) throw err;
        await client.put("/v3/business-partner-groups", body);
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id/bpn-groups/:bpn — BPN 의 그룹 매핑 전체 삭제.
router.delete(
  "/:id/bpn-groups/:bpn",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      await client.delete(
        `/v3/business-partner-groups/${encodeURIComponent(req.params.bpn)}`
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

export default router;

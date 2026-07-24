// KMX EDC — Contract Negotiation Routes
// Proxies: POST /v3/contractnegotiations/request, POST /v3/contractnegotiations,
//          GET /v3/contractnegotiations/:negId, GET /v3/contractnegotiations/:negId/agreement

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
  mapNegotiation,
  type NegotiationMeta,
} from "../lib/edcClient.js";
import { getPool } from "../lib/db.js";
import { requireRole } from "../middleware/auth.js";
import { assertEndpointPublic } from "../middleware/validation.js";

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

// POST /:id/negotiations — proxy to POST /v3/contractnegotiations/request (list)
// 종료 상태 협상의 completed_at을 최초 1회 기록 → 소요시간 계산에 사용
router.post(
  "/:id/negotiations",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorId = req.params.id;
      const { client } = await resolveConnector(connectorId);
      const response = await client.post(
        "/v3/contractnegotiations/request",
        withJsonLd(req.body)
      );
      const rawList: Record<string, unknown>[] = Array.isArray(response.data)
        ? response.data
        : [];

      // 기존 메타 조회
      const { rows } = await getPool().query(
        `SELECT negotiation_id, started_at, completed_at
       FROM negotiation_metadata WHERE connector_id = $1`,
        [connectorId]
      );
      const metaMap = new Map<string, NegotiationMeta>();
      for (const r of rows) {
        metaMap.set(r.negotiation_id, {
          started_at: r.started_at ?? null,
          completed_at: r.completed_at ?? null,
        });
      }

      // 터미널 상태(FINALIZED/TERMINATED) 협상 중 미기록 항목 UPSERT
      const TERMINAL = new Set(["FINALIZED", "TERMINATED"]);
      const toUpsert = rawList.filter(raw => {
        const id = (raw["@id"] as string) ?? "";
        const state = (raw["state"] as string) ?? "";
        const existing = metaMap.get(id);
        return TERMINAL.has(state) && !existing?.completed_at;
      });

      if (toUpsert.length > 0) {
        await Promise.all(
          toUpsert.map(raw => {
            const id = (raw["@id"] as string) ?? "";
            const state = (raw["state"] as string) ?? "";
            // started_at은 /start 라우트에서만 기록 (EDC createdAt은 사용 안 함)
            // → 목록 최초 발견 시 completed_at만 기록, started_at은 이미 있을 때만 유지
            return getPool().query(
              `INSERT INTO negotiation_metadata (negotiation_id, connector_id, completed_at, last_state)
             VALUES ($1, $2, NOW(), $3)
             ON CONFLICT (negotiation_id, connector_id)
             DO UPDATE SET
               completed_at = COALESCE(negotiation_metadata.completed_at, NOW()),
               last_state = COALESCE(negotiation_metadata.last_state, EXCLUDED.last_state)`,
              [id, connectorId, state]
            );
          })
        );
        // 방금 upsert한 항목 반영
        const fresh = await getPool().query(
          `SELECT negotiation_id, started_at, completed_at
         FROM negotiation_metadata WHERE connector_id = $1`,
          [connectorId]
        );
        for (const r of fresh.rows) {
          metaMap.set(r.negotiation_id, {
            started_at: r.started_at ?? null,
            completed_at: r.completed_at ?? null,
          });
        }
      }

      const mapped = rawList.map(raw => {
        const id = (raw["@id"] as string) ?? "";
        return mapNegotiation(raw, metaMap.get(id));
      });

      res.json(mapped);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/negotiations/start — proxy to POST /v3/contractnegotiations (start)
router.post(
  "/:id/negotiations/start",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const { offerId, assetId, providerDid, dspEndpoint, offerPolicy } =
        req.body ?? {};

      if (!offerId || !assetId || !dspEndpoint) {
        res
          .status(400)
          .json({ error: "offerId, assetId, and dspEndpoint are required" });
        return;
      }
      if (typeof dspEndpoint !== "string" || dspEndpoint.length > 2048) {
        res.status(400).json({
          error: "dspEndpoint must be a string and within 2048 chars",
        });
        return;
      }
      const ssrfErr = await assertEndpointPublic(dspEndpoint);
      if (ssrfErr) {
        res.status(400).json({ error: `Rejected dspEndpoint: ${ssrfErr}` });
        return;
      }

      // offerPolicy가 있으면 카탈로그에서 받은 전체 policy 객체를 그대로 사용
      // → Consumer 검증 시 Provider 합의 내용과 policy 내용이 일치해야 함
      const policy = offerPolicy
        ? {
            "@context": "http://www.w3.org/ns/odrl.jsonld",
            ...offerPolicy,
            "@id": offerId,
            assigner: providerDid,
            target: assetId,
          }
        : {
            "@context": "http://www.w3.org/ns/odrl.jsonld",
            "@type": "Offer",
            "@id": offerId,
            assigner: providerDid,
            target: assetId,
          };

      // DSP 2025-1 endpoint 보정: 끝이 /api/v1/dsp 면 /2025-1 자동 부착
      // (catalog 라우트와 동일 패턴 — Consumer EDC가 자동 추가하지 않으므로 BFF에서 보정)
      let normalizedDspEndpoint = String(dspEndpoint).replace(/\/+$/, "");
      if (/\/api\/v1\/dsp$/.test(normalizedDspEndpoint)) {
        normalizedDspEndpoint = `${normalizedDspEndpoint}/2025-1`;
      }

      const contractRequest = {
        "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
        "@type": "ContractRequest",
        counterPartyAddress: normalizedDspEndpoint,
        counterPartyId: providerDid,
        protocol: "dataspace-protocol-http:2025-1",
        policy: policy,
      };

      const response = await client.post(
        "/v3/contractnegotiations",
        contractRequest
      );
      const negId = (response.data as Record<string, unknown>)["@id"] as string;

      // 시작 시각 기록
      if (negId) {
        await getPool().query(
          `INSERT INTO negotiation_metadata (negotiation_id, connector_id, started_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (negotiation_id, connector_id) DO NOTHING`,
          [negId, req.params.id]
        );
      }

      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/negotiations/:negId/terminate — proxy to POST /v3/contractnegotiations/:negId/terminate
router.post(
  "/:id/negotiations/:negId/terminate",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const { reason } = req.body ?? {};
      await client.post(
        `/v3/contractnegotiations/${req.params.negId}/terminate`,
        {
          "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
          "@type": "TerminationMessage",
          code: "USER_TERMINATED",
          reason: reason ?? "Terminated by operator",
        }
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/negotiations/:negId — proxy to GET /v3/contractnegotiations/:negId
router.get(
  "/:id/negotiations/:negId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.get(
        `/v3/contractnegotiations/${req.params.negId}`
      );
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/negotiations/:negId/agreement — proxy to GET /v3/contractnegotiations/:negId/agreement
router.get(
  "/:id/negotiations/:negId/agreement",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.get(
        `/v3/contractnegotiations/${req.params.negId}/agreement`
      );
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

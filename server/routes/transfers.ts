// KMX EDC — Transfer Process Routes
//
// 크기/소요시간 추적 전략:
//   - transfer_metadata 테이블에 started_at, completed_at, size_bytes, user_completed 기록
//   - 전송 시작 시 started_at 기록
//   - 완료 처리 시 completed_at 기록 + user_completed=true → UI에서 COMPLETED로 오버레이
//   - POST /:id/transfers/:tpId/fetch → EDR로 실제 데이터 Pull, Content-Length → size_bytes 기록

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import axios from "axios";
import { getConnector } from "../lib/connectorRegistry.js";
import {
  getEdcClient,
  withJsonLd,
  mapTransfer,
  type TransferMeta,
} from "../lib/edcClient.js";
import { getPool } from "../lib/db.js";
import { requireRole } from "../middleware/auth.js";
import { validateDspEndpoint } from "../middleware/validation.js";

const router = Router();
const writeGuard = requireRole("admin", "operator");

/**
 * EDR endpoint(신뢰된 provider 데이터플레인 URL)에 선택적 하위 경로/쿼리를 안전하게 덧붙인다.
 * 절대 URL / protocol-relative(`//`) 는 호스트 변조 우려로 거부(null 반환).
 * 프록시 자산(DTR 등)을 하위 경로로 조회하기 위함.
 */
function appendProxyPath(
  endpoint: string,
  path?: unknown,
  query?: unknown
): string | null {
  let url = endpoint;
  if (typeof path === "string" && path.trim()) {
    const rel = path.trim();
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rel) || rel.startsWith("//"))
      return null;
    url =
      endpoint.replace(/\/+$/, "") + (rel.startsWith("/") ? rel : `/${rel}`);
  }
  if (typeof query === "string" && query.trim()) {
    const q = query.trim().replace(/^[?&]+/, "");
    if (q) url += (url.includes("?") ? "&" : "?") + q;
  }
  return url;
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

/** 특정 커넥터의 메타데이터 Map 조회 */
async function getMetaMap(
  connectorId: string
): Promise<Map<string, TransferMeta & { hidden: boolean }>> {
  const { rows } = await getPool().query(
    `SELECT transfer_id, user_completed, started_at, completed_at, size_bytes, fetch_duration_ms, hidden
     FROM transfer_metadata WHERE connector_id = $1`,
    [connectorId]
  );
  const map = new Map<string, TransferMeta & { hidden: boolean }>();
  for (const r of rows) {
    map.set(r.transfer_id, {
      user_completed: r.user_completed,
      started_at: r.started_at ?? null,
      completed_at: r.completed_at ?? null,
      size_bytes: r.size_bytes != null ? Number(r.size_bytes) : null,
      fetch_duration_ms:
        r.fetch_duration_ms != null ? Number(r.fetch_duration_ms) : null,
      hidden: r.hidden,
    });
  }
  return map;
}

// POST /:id/transfers — proxy to POST /v3/transferprocesses/request (list)
router.post(
  "/:id/transfers",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorId = req.params.id;
      const { client } = await resolveConnector(connectorId);

      const [response, metaMap] = await Promise.all([
        client.post("/v3/transferprocesses/request", withJsonLd(req.body)),
        getMetaMap(connectorId),
      ]);

      const mapped = Array.isArray(response.data)
        ? response.data
            .map((raw: Record<string, unknown>) => {
              const id = (raw["@id"] as string) ?? "";
              return {
                ...mapTransfer(raw, metaMap.get(id)),
                _hidden: metaMap.get(id)?.hidden ?? false,
              };
            })
            .filter(t => !t._hidden)
            .map(({ _hidden: _, ...t }) => t)
        : response.data;

      res.json(mapped);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/transfers/start — proxy to POST /v3/transferprocesses (start)
router.post(
  "/:id/transfers/start",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorId = req.params.id;
      const { client } = await resolveConnector(connectorId);
      const { agreementId, counterPartyAddress, assetId, dataSink } =
        req.body ?? {};

      if (!agreementId) {
        res.status(400).json({ error: "agreementId is required" });
        return;
      }
      if (!counterPartyAddress) {
        res.status(400).json({
          error: "counterPartyAddress (provider DSP endpoint) is required",
        });
        return;
      }
      if (
        typeof counterPartyAddress !== "string" ||
        counterPartyAddress.length > 2048
      ) {
        res.status(400).json({
          error: "counterPartyAddress must be a string and within 2048 chars",
        });
        return;
      }
      const tpSsrfErr = validateDspEndpoint(counterPartyAddress);
      if (tpSsrfErr) {
        res
          .status(400)
          .json({ error: `Rejected counterPartyAddress: ${tpSsrfErr}` });
        return;
      }

      // DSP 2025-1 endpoint 보정 (catalog/negotiations와 동일 패턴)
      let normalizedDspEndpoint = String(counterPartyAddress).replace(
        /\/+$/,
        ""
      );
      if (/\/api\/v1\/dsp$/.test(normalizedDspEndpoint)) {
        normalizedDspEndpoint = `${normalizedDspEndpoint}/2025-1`;
      }

      const sinkType: string = dataSink?.type ?? "HttpProxy";
      const isProxy = sinkType === "HttpProxy";

      const transferRequest: Record<string, unknown> = {
        "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
        "@type": "TransferRequest",
        counterPartyAddress: normalizedDspEndpoint,
        contractId: agreementId,
        transferType: isProxy ? "HttpData-PULL" : "HttpData-PUSH",
        protocol: "dataspace-protocol-http:2025-1",
        dataDestination: isProxy
          ? { "@type": "DataAddress", type: "HttpProxy" }
          : {
              "@type": "DataAddress",
              type: "HttpData",
              baseUrl: dataSink?.endpoint ?? "",
            },
      };
      if (assetId) transferRequest["assetId"] = assetId;

      const response = await client.post(
        "/v3/transferprocesses",
        transferRequest
      );
      const tpId = (response.data as Record<string, unknown>)["@id"] as string;

      // 시작 시각 기록
      if (tpId) {
        await getPool().query(
          `INSERT INTO transfer_metadata (transfer_id, connector_id, started_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (transfer_id, connector_id) DO NOTHING`,
          [tpId, connectorId]
        );
      }

      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/transfers/:tpId — proxy to GET /v3/transferprocesses/:tpId
router.get(
  "/:id/transfers/:tpId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { client } = await resolveConnector(req.params.id);
      const response = await client.get(
        `/v3/transferprocesses/${req.params.tpId}`
      );
      res.json(response.data);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/transfers/:tpId/fetch — EDR로 실제 데이터 Pull + 크기 기록
// 응답: { data, sizeBytes, contentType }
router.post(
  "/:id/transfers/:tpId/fetch",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tpId } = req.params;
      const connectorId = req.params.id;
      const { client } = await resolveConnector(connectorId);

      // 1. EDR DataAddress 조회 (endpoint + authorization 토큰)
      const edrRes = await client.get(`/v3/edrs/${tpId}/dataaddress`);
      const edr = edrRes.data as Record<string, unknown>;
      const endpoint = edr["endpoint"] as string;
      const token = edr["authorization"] as string;

      if (!endpoint || !token) {
        res
          .status(404)
          .json({ error: "EDR not found or expired for this transfer" });
        return;
      }

      // 프록시 자산(예: DTR cx-taxo:DigitalTwinRegistry, proxyPath=true)은 EDR endpoint
      // 루트가 아니라 하위 경로로 조회해야 데이터가 나온다(루트 pull은 빈 응답 → size=—).
      // 선택적 path/query를 EDR endpoint에 안전하게 덧붙인다.
      const targetUrl = appendProxyPath(
        endpoint,
        req.body?.path,
        req.body?.query
      );
      if (targetUrl === null) {
        res
          .status(400)
          .json({ error: "path must be a relative sub-path (no scheme/host)" });
        return;
      }

      // 2. Provider Data Plane에서 실제 데이터 Pull — 소요시간 측정
      const fetchStart = Date.now();
      const dataRes = await axios.get(targetUrl, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "arraybuffer",
        timeout: 30_000,
      });
      const fetchDurationMs = Date.now() - fetchStart;

      const sizeBytes = dataRes.data?.length ?? 0;
      const contentType =
        (dataRes.headers["content-type"] as string) ??
        "application/octet-stream";

      // 3. size_bytes + fetch_duration_ms 기록 (UPSERT)
      await getPool().query(
        `INSERT INTO transfer_metadata (transfer_id, connector_id, size_bytes, fetch_duration_ms)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (transfer_id, connector_id)
       DO UPDATE SET size_bytes = EXCLUDED.size_bytes, fetch_duration_ms = EXCLUDED.fetch_duration_ms`,
        [tpId, connectorId, sizeBytes, fetchDurationMs]
      );

      // 4. 데이터 응답 (JSON이면 파싱, 아니면 raw)
      let body: unknown;
      try {
        body = JSON.parse(Buffer.from(dataRes.data).toString("utf-8"));
      } catch {
        body = Buffer.from(dataRes.data).toString("utf-8");
      }

      res.json({ data: body, sizeBytes, contentType });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id/transfers — 전체 삭제 (STARTED는 terminate 후 hidden, 나머지는 바로 hidden)
router.delete(
  "/:id/transfers",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectorId = req.params.id;
      const { client } = await resolveConnector(connectorId);

      // 1. 현재 전송 목록 조회
      const response = await client.post(
        "/v3/transferprocesses/request",
        withJsonLd({})
      );
      const allTransfers: Array<{ id: string; state: string }> = Array.isArray(
        response.data
      )
        ? response.data.map((r: Record<string, unknown>) => ({
            id: (r["@id"] as string) ?? "",
            state: (r["state"] as string) ?? "",
          }))
        : [];

      // 2. STARTED 상태는 terminate 먼저 (종료되지 않으면 EDC 레코드가 남음)
      const started = allTransfers.filter(t => t.state === "STARTED");
      await Promise.allSettled(
        started.map(t =>
          client.post(`/v3/transferprocesses/${t.id}/terminate`, {
            "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
            reason: "Deleted by user",
          })
        )
      );

      // 3. 모든 ID를 hidden=true로 표시 (UPSERT 배치)
      const ids = allTransfers.map(t => t.id).filter(Boolean);
      if (ids.length > 0) {
        await Promise.all(
          ids.map(id =>
            getPool().query(
              `INSERT INTO transfer_metadata (transfer_id, connector_id, hidden)
             VALUES ($1, $2, TRUE)
             ON CONFLICT (transfer_id, connector_id)
             DO UPDATE SET hidden = TRUE`,
              [id, connectorId]
            )
          )
        );
      }

      res.json({ deleted: ids.length });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/transfers/:tpId/complete — 완료 처리
// 1. EDR로 데이터 Pull → size_bytes + fetch_duration_ms 기록 (아직 fetch 안 한 경우)
// 2. EDC /terminate 호출
// 3. completed_at + user_completed=true 기록 → 목록에서 COMPLETED 오버레이
router.post(
  "/:id/transfers/:tpId/complete",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tpId } = req.params;
      const connectorId = req.params.id;
      const { client } = await resolveConnector(connectorId);

      // 이미 fetch 기록이 있는지 확인
      const { rows } = await getPool().query(
        "SELECT fetch_duration_ms FROM transfer_metadata WHERE transfer_id = $1 AND connector_id = $2",
        [tpId, connectorId]
      );
      const alreadyFetched =
        rows.length > 0 && rows[0].fetch_duration_ms != null;

      // fetch 기록이 없으면 자동으로 Pull 수행
      if (!alreadyFetched) {
        try {
          const edrRes = await client.get(`/v3/edrs/${tpId}/dataaddress`);
          const edr = edrRes.data as Record<string, unknown>;
          const endpoint = edr["endpoint"] as string;
          const token = edr["authorization"] as string;

          if (endpoint && token) {
            const fetchStart = Date.now();
            const dataRes = await axios.get(endpoint, {
              headers: { Authorization: `Bearer ${token}` },
              responseType: "arraybuffer",
              timeout: 30_000,
            });
            const fetchDurationMs = Date.now() - fetchStart;
            const sizeBytes = dataRes.data?.length ?? 0;

            await getPool().query(
              `INSERT INTO transfer_metadata (transfer_id, connector_id, size_bytes, fetch_duration_ms)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (transfer_id, connector_id)
             DO UPDATE SET size_bytes = EXCLUDED.size_bytes, fetch_duration_ms = EXCLUDED.fetch_duration_ms`,
              [tpId, connectorId, sizeBytes, fetchDurationMs]
            );
          }
        } catch {
          // EDR 만료 등으로 fetch 실패해도 완료 처리는 계속 진행
        }
      }

      // EDC terminate
      await client.post(`/v3/transferprocesses/${tpId}/terminate`, {
        "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
        reason: "Completed by consumer",
      });

      // 완료 메타 기록
      await getPool().query(
        `INSERT INTO transfer_metadata (transfer_id, connector_id, completed_at, user_completed)
       VALUES ($1, $2, NOW(), TRUE)
       ON CONFLICT (transfer_id, connector_id)
       DO UPDATE SET completed_at = NOW(), user_completed = TRUE`,
        [tpId, connectorId]
      );

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/transfers/:tpId/terminate — 강제 종료
router.post(
  "/:id/transfers/:tpId/terminate",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tpId } = req.params;
      const connectorId = req.params.id;
      const { client } = await resolveConnector(connectorId);
      const { reason } = req.body ?? {};

      await client.post(`/v3/transferprocesses/${tpId}/terminate`, {
        "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
        reason: reason ?? "Terminated by user",
      });

      await getPool().query(
        `INSERT INTO transfer_metadata (transfer_id, connector_id, completed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (transfer_id, connector_id)
       DO UPDATE SET completed_at = NOW()`,
        [tpId, connectorId]
      );

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

export default router;

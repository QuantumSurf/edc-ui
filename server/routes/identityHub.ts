// KMX EDC — IdentityHub status monitoring (proxy)
// Reads the global identity_hub_url setting and probes its /api/check/health.

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import axios from "axios";
import { getIdentityHubConfig } from "../lib/identityHubConfig.js";
import { validateDspEndpoint } from "../middleware/validation.js";

const router = Router();
const TIMEOUT_MS = 5000;

interface ComponentResult {
  component: string;
  isHealthy: boolean;
  failure: string | null;
}

interface HealthResponse {
  status: "up" | "warn" | "down" | "unconfigured";
  baseUrl: string;
  endpointUrl: string;
  latencyMs: number | null;
  checkedAt: string;
  isSystemHealthy: boolean | null;
  components: ComponentResult[];
  httpStatus: number | null;
  error: string | null;
}

function buildHealthUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  // If user already pointed at /api or /api/check or full path, do not duplicate.
  if (/\/api\/check\/health$/.test(clean)) return clean;
  if (/\/api\/check$/.test(clean)) return `${clean}/health`;
  if (/\/api$/.test(clean)) return `${clean}/check/health`;
  return `${clean}/api/check/health`;
}

// GET /api/identity-hub/health — probe IdentityHub health
router.get(
  "/health",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { url: baseUrl } = await getIdentityHubConfig(req.user?.tenantId);
      if (!baseUrl) {
        const body: HealthResponse = {
          status: "unconfigured",
          baseUrl: "",
          endpointUrl: "",
          latencyMs: null,
          checkedAt: new Date().toISOString(),
          isSystemHealthy: null,
          components: [],
          httpStatus: null,
          error: "identity_hub_url is not configured",
        };
        res.json(body);
        return;
      }

      // SSRF 방어: 저장/환경값이 사설·내부·메타데이터 주소면 외부 요청을 보내지 않음.
      const ssrfErr = validateDspEndpoint(baseUrl);
      if (ssrfErr) {
        res.json({
          status: "down",
          baseUrl,
          endpointUrl: "",
          latencyMs: null,
          checkedAt: new Date().toISOString(),
          isSystemHealthy: null,
          components: [],
          httpStatus: null,
          error: `Rejected URL — ${ssrfErr}`,
        } satisfies HealthResponse);
        return;
      }
      const endpointUrl = buildHealthUrl(baseUrl);
      const startedAt = Date.now();
      try {
        const { data, status } = await axios.get(endpointUrl, {
          timeout: TIMEOUT_MS,
          validateStatus: () => true,
        });
        const latencyMs = Date.now() - startedAt;
        const isSystemHealthy = Boolean(
          (data as { isSystemHealthy?: boolean })?.isSystemHealthy
        );
        const components: ComponentResult[] = Array.isArray(
          (data as { componentResults?: unknown })?.componentResults
        )
          ? (
              data as { componentResults: Array<Record<string, unknown>> }
            ).componentResults.map(c => ({
              component: (c.component as string) ?? "",
              isHealthy: Boolean(c.isHealthy),
              failure: (c.failure as string) ?? null,
            }))
          : [];
        let outStatus: HealthResponse["status"] = "down";
        if (status >= 200 && status < 300) {
          if (isSystemHealthy && components.every(c => c.isHealthy))
            outStatus = "up";
          else if (components.some(c => c.isHealthy)) outStatus = "warn";
          else outStatus = "down";
        }
        const body: HealthResponse = {
          status: outStatus,
          baseUrl,
          endpointUrl,
          latencyMs,
          checkedAt: new Date().toISOString(),
          isSystemHealthy:
            status >= 200 && status < 300 ? isSystemHealthy : null,
          components,
          httpStatus: status,
          error: status >= 200 && status < 300 ? null : `http ${status}`,
        };
        res.json(body);
      } catch (e) {
        const latencyMs = Date.now() - startedAt;
        const body: HealthResponse = {
          status: "down",
          baseUrl,
          endpointUrl,
          latencyMs,
          checkedAt: new Date().toISOString(),
          isSystemHealthy: false,
          components: [],
          httpStatus: null,
          error: (e as Error).message,
        };
        res.json(body);
      }
    } catch (error) {
      next(error);
    }
  }
);

/* ─── Participant's own identity info ────────────────────────── */

interface CredentialSummary {
  id: string;
  type: string;
  issuer: string;
  status: string;
}

interface ParticipantResponse {
  configured: boolean;
  participantId: string;
  baseUrl: string;
  did: string | null;
  credentials: CredentialSummary[];
  credentialError: string | null;
  checkedAt: string;
}

// Map a (loosely-shaped) IdentityHub credential record into a flat summary.
function mapCredential(raw: unknown): CredentialSummary {
  const o = (raw ?? {}) as Record<string, unknown>;
  const vcWrap = (o.verifiableCredential ?? {}) as Record<string, unknown>;
  const vc = (vcWrap.credential ?? o.credential ?? o) as Record<
    string,
    unknown
  >;
  const rawType = vc.type ?? (o as Record<string, unknown>).type;
  const types: string[] = Array.isArray(rawType)
    ? rawType.map(String)
    : rawType
      ? [String(rawType)]
      : [];
  const issuer = vc.issuer;
  return {
    id: String(o.id ?? vc.id ?? ""),
    type:
      types.filter(t => t !== "VerifiableCredential").join(", ") ||
      "VerifiableCredential",
    issuer: String(
      issuer && typeof issuer === "object"
        ? ((issuer as Record<string, unknown>).id ?? "")
        : (issuer ?? "")
    ),
    status: String(o.state ?? o.status ?? "—"),
  };
}

// The Identity Management API runs on a separate port from the default/health
// API. kmx-ih layout: default :8181 (host :28181) → Identity API :8182 (:28182).
function toIdentityApiBase(url: string): string {
  try {
    const u = new URL(url);
    // 기본/health 포트 → Identity API 포트로 스왑
    if (u.port === "8181") u.port = "8182";
    else if (u.port === "28181") u.port = "28182";
    // origin만 반환 — 경로(/api/identity/v1alpha/...)는 호출부가 부여하므로
    // cfg.url의 '/api' 같은 suffix를 떼어 '/api/api/...' 중복을 방지.
    return `${u.protocol}//${u.host}`;
  } catch {
    return url
      .replace(/\/+$/, "")
      .replace(/:8181(?=\/|$)/, ":8182")
      .replace(/:28181(?=\/|$)/, ":28182");
  }
}

// GET /api/identity-hub/participant — fetch the participant's own identity
// info (DID + verifiable credentials) from the configured IdentityHub server.
router.get(
  "/participant",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cfg = await getIdentityHubConfig(req.user?.tenantId);
      const body: ParticipantResponse = {
        configured: Boolean(cfg.url && cfg.participantId),
        participantId: cfg.participantId,
        baseUrl: cfg.url,
        did: cfg.participantId.startsWith("did:") ? cfg.participantId : null,
        credentials: [],
        credentialError: null,
        checkedAt: new Date().toISOString(),
      };
      if (!body.configured) {
        res.json(body);
        return;
      }
      // SSRF 방어: 구성된 URL이 사설·내부·메타데이터 주소면 외부 요청을 보내지 않음.
      const ssrfErr = validateDspEndpoint(cfg.url);
      if (ssrfErr) {
        body.credentialError = `Rejected URL — ${ssrfErr}`;
        res.json(body);
        return;
      }
      // Tractus-X IdentityHub Identity Management API (port 8182). Credentials are
      // listed via GET /v1alpha/participants/{participantContextId}/credentials.
      // EDC IdentityHub의 participant context id는 participantId의 base64url 인코딩이며,
      // 인증은 X-Api-Key 헤더(해당 참가자의 API 토큰)로 한다.
      const base = toIdentityApiBase(cfg.url);
      const idPath = Buffer.from(cfg.participantId).toString("base64url");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
      try {
        const { data, status } = await axios.get(
          `${base}/api/identity/v1alpha/participants/${idPath}/credentials`,
          { headers, timeout: TIMEOUT_MS, validateStatus: () => true }
        );
        if (status >= 200 && status < 300 && Array.isArray(data)) {
          body.credentials = data.map(mapCredential);
        } else {
          // IdentityHub의 오류 본문을 함께 노출 → 401(API 키 불일치) vs 403/404(participant 컨텍스트 ID 경로) 구분에 도움.
          let detail = "";
          try {
            detail = typeof data === "string" ? data : JSON.stringify(data);
          } catch {
            /* ignore */
          }
          if (detail === "{}" || detail === "[]" || detail === "null")
            detail = "";
          body.credentialError = `http ${status}${detail ? ` — ${detail.slice(0, 300)}` : ""}`;
        }
      } catch (e) {
        body.credentialError = (e as Error).message;
      }
      res.json(body);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

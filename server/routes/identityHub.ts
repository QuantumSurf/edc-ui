// KMX EDC — IdentityHub status monitoring (proxy)
// Reads the global identity_hub_url setting and probes its /api/check/health.

import { Router, type Request, type Response, type NextFunction } from "express";
import axios from "axios";
import { getIdentityHubConfig } from "../lib/identityHubConfig.js";

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
router.get("/health", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { url: baseUrl } = await getIdentityHubConfig();
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

    const endpointUrl = buildHealthUrl(baseUrl);
    const startedAt = Date.now();
    try {
      const { data, status } = await axios.get(endpointUrl, { timeout: TIMEOUT_MS, validateStatus: () => true });
      const latencyMs = Date.now() - startedAt;
      const isSystemHealthy = Boolean((data as { isSystemHealthy?: boolean })?.isSystemHealthy);
      const components: ComponentResult[] = Array.isArray((data as { componentResults?: unknown })?.componentResults)
        ? ((data as { componentResults: Array<Record<string, unknown>> }).componentResults).map((c) => ({
            component: (c.component as string) ?? "",
            isHealthy: Boolean(c.isHealthy),
            failure: (c.failure as string) ?? null,
          }))
        : [];
      let outStatus: HealthResponse["status"] = "down";
      if (status >= 200 && status < 300) {
        if (isSystemHealthy && components.every((c) => c.isHealthy)) outStatus = "up";
        else if (components.some((c) => c.isHealthy)) outStatus = "warn";
        else outStatus = "down";
      }
      const body: HealthResponse = {
        status: outStatus,
        baseUrl,
        endpointUrl,
        latencyMs,
        checkedAt: new Date().toISOString(),
        isSystemHealthy: status >= 200 && status < 300 ? isSystemHealthy : null,
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
});

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
  const vc = (vcWrap.credential ?? o.credential ?? o) as Record<string, unknown>;
  const rawType = vc.type ?? (o as Record<string, unknown>).type;
  const types: string[] = Array.isArray(rawType) ? rawType.map(String) : rawType ? [String(rawType)] : [];
  const issuer = vc.issuer;
  return {
    id: String(o.id ?? vc.id ?? ""),
    type: types.filter((t) => t !== "VerifiableCredential").join(", ") || "VerifiableCredential",
    issuer: String(
      issuer && typeof issuer === "object" ? (issuer as Record<string, unknown>).id ?? "" : issuer ?? "",
    ),
    status: String(o.state ?? o.status ?? "—"),
  };
}

// The Identity Management API runs on a separate port from the default/health
// API. kmx-ih layout: default :8181 (host :28181) → Identity API :8182 (:28182).
function toIdentityApiBase(url: string): string {
  return url
    .replace(/\/+$/, "")
    .replace(/:8181(?=\/|$)/, ":8182")
    .replace(/:28181(?=\/|$)/, ":28182");
}

// GET /api/identity-hub/participant — fetch the participant's own identity
// info (DID + verifiable credentials) from the configured IdentityHub server.
router.get("/participant", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cfg = await getIdentityHubConfig();
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
    // Tractus-X IdentityHub Identity Management API (port 8182). Credentials
    // are retrieved via a POST "query" with the participant id used as-is in
    // the path; the API key authenticates via the X-Api-Key header.
    const base = toIdentityApiBase(cfg.url);
    const idPath = encodeURIComponent(cfg.participantId);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
    try {
      const { data, status } = await axios.post(
        `${base}/api/identity/v1alpha/participants/${idPath}/credentials`,
        {},
        { headers, timeout: TIMEOUT_MS, validateStatus: () => true },
      );
      if (status >= 200 && status < 300 && Array.isArray(data)) {
        body.credentials = data.map(mapCredential);
      } else {
        body.credentialError = `http ${status}`;
      }
    } catch (e) {
      body.credentialError = (e as Error).message;
    }
    res.json(body);
  } catch (error) {
    next(error);
  }
});

export default router;

// KMX EDC — IdentityHub status monitoring (proxy)
// Reads the global identity_hub_url setting and probes its /api/check/health.

import { Router, type Request, type Response, type NextFunction } from "express";
import axios from "axios";
import { getPool } from "../lib/db.js";

const router = Router();
const TIMEOUT_MS = 5000;

async function readIdentityHubUrl(): Promise<string> {
  const { rows } = await getPool().query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = $1`,
    ["identity_hub_url"],
  );
  return (rows[0]?.value ?? "").trim();
}

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
    const baseUrl = await readIdentityHubUrl();
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

export default router;

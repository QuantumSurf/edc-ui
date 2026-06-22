// KMX EDC — System Info Route
//
// GET /api/system/info — runtime metadata for the Settings page.
// Read-only, no secrets exposed. Available to all authenticated roles.
//
// Sources:
//   - Connector Hub version: package.json (read at startup)
//   - EDC / DSP / DCP versions: env overrides with sensible defaults
//   - environment / apiMode: derived from NODE_ENV
//   - uptimeSeconds: process.uptime()

import { Router, type Request, type Response } from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { listConnectors } from "../lib/connectorRegistry.js";
import { getEdcClient } from "../lib/edcClient.js";

const router = Router();

/* ─── EDC runtime version cache (queried lazily, refreshed every 1h) ─── */
let edcVersionCache: { value: string; expiresAt: number } | null = null;
const EDC_VERSION_TTL_MS = 60 * 60 * 1000;

async function probeEdcVersion(): Promise<string | null> {
  try {
    const conns = await listConnectors();
    if (!conns.length) return null;
    const c = conns[0];
    const client = getEdcClient(c.id, {
      managementUrl: c.managementUrl,
      apiKey: c.apiKey,
    });
    // EDC exposes /api/version on the management context (returns array of module versions).
    const r = await client.get("/api/version", { timeout: 3_000 });
    const data = r.data;
    if (Array.isArray(data) && data.length) {
      const ver = (data[0]?.version ?? data[0]?.["edc.runtime.version"]) as
        | string
        | undefined;
      if (ver) return `v${ver}`;
    } else if (typeof data?.version === "string") {
      return `v${data.version}`;
    }
    return null;
  } catch {
    return null;
  }
}

async function getEdcRuntimeVersion(): Promise<string> {
  // Env override always wins.
  if (process.env.EDC_RUNTIME_VERSION) return process.env.EDC_RUNTIME_VERSION;
  const now = Date.now();
  if (edcVersionCache && edcVersionCache.expiresAt > now)
    return edcVersionCache.value;
  const probed = await probeEdcVersion();
  const value = probed ?? "v0.16.0";
  edcVersionCache = { value, expiresAt: now + EDC_VERSION_TTL_MS };
  return value;
}

/* ─── Read connector-hub version from package.json once at boot ───── */
let connectorHubVersion = "unknown";
let connectorHubVersionSource = "default";
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // Try a few candidate locations: dev (server/routes -> ../..) and prod (dist -> ..)
  const candidates = [
    path.resolve(__dirname, "..", "..", "package.json"),
    path.resolve(__dirname, "..", "package.json"),
    path.resolve(process.cwd(), "package.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, "utf8");
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === "kmx-edc-ui" && parsed.version) {
        connectorHubVersion = `v${parsed.version}`;
        connectorHubVersionSource = p;
        break;
      }
    } catch {
      /* try next */
    }
  }
} catch {
  /* keep default */
}
console.log(
  `[system] connectorHub=${connectorHubVersion} (source=${connectorHubVersionSource})`
);

/* ─── /info ───────────────────────────────────────────────────────── */
router.get("/info", async (_req: Request, res: Response) => {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const environment = (
    process.env.APP_ENV ?? (nodeEnv === "production" ? "PROD" : "DEV")
  ).toUpperCase();
  // apiMode: "Live" when BFF can reach real EDC/Vault/PG (always true in this build).
  // Allow override via env in case a future "Mock" demo build is shipped.
  const apiMode = process.env.API_MODE ?? "Live";
  const edcRuntime = await getEdcRuntimeVersion();

  res.json({
    connectorHub: connectorHubVersion,
    edcRuntime,
    dspVersion: process.env.DSP_VERSION ?? "2025-1",
    dcpVersion: process.env.DCP_VERSION ?? "1.0",
    managementApi: process.env.EDC_MANAGEMENT_API_VERSION ?? "v3",
    environment,
    apiMode,
    nodeEnv,
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
  });
});

export default router;

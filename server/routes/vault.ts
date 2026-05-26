// KMX EDC — Platform Vault management API (read-only).
//
// Endpoints (all RBAC-gated):
//   GET /api/platform/vault/status        — sealed/unsealed/version (admin/operator/viewer)
//   GET /api/platform/vault/list          — alias list, NO values (admin/operator)
//   GET /api/platform/vault/meta/:alias   — metadata only (admin/operator)
//
// Security:
//   - Secret VALUES are never returned (NF-23 honored).
//   - Only paths under `secret/` are exposed.
//   - All requests use server-side platform token; client never sees it.
//   - Key rotation is intentionally NOT exposed via UI; operators must use
//     `vault write transit/keys/<name>/rotate` directly with audit logging.

import { Router, type Request, type Response, type NextFunction } from "express";
import { requireRole } from "../middleware/auth.js";
import { getVaultClient, getVaultUrl } from "../lib/platform.js";

const router = Router();

/** Whitelist of allowed alias prefixes (defense-in-depth). */
const ALIAS_PREFIX_ALLOWLIST = [
  "ih-aes-key",
  "dataplane-private-key",
  "dataplane-public-key",
  "sts-client-secret",
  "consumer-sts-client-secret",
  // EDC-managed aliases — actual prefix varies by extension; cover both forms.
  "edc:",
  "edc-",
];

function isAliasAllowed(alias: string): boolean {
  return ALIAS_PREFIX_ALLOWLIST.some((p) => alias === p || alias.startsWith(p));
}

/* ─── GET /status ────────────────────────────────────────────── */
router.get(
  "/status",
  requireRole("admin", "operator", "viewer"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const vault = await getVaultClient();
      const [seal, health] = await Promise.all([
        vault.get("/v1/sys/seal-status").then((r) => r.data),
        vault.get("/v1/sys/health").then((r) => r.data).catch((e) => e.response?.data ?? {}),
      ]);
      res.json({
        url: await getVaultUrl(),
        sealed: seal.sealed === true,
        version: seal.version ?? health.version ?? "unknown",
        clusterName: seal.cluster_name ?? null,
        clusterId: seal.cluster_id ?? null,
        initialized: seal.initialized !== false,
        standby: health.standby === true,
        type: seal.type ?? "shamir",
      });
    } catch (error) {
      next(error);
    }
  }
);

/* ─── GET /list ──────────────────────────────────────────────── */
// KV-v2 metadata listing (LIST verb on /v1/secret/metadata)
router.get(
  "/list",
  requireRole("admin", "operator"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const vault = await getVaultClient();
      const r = await vault.request({
        method: "LIST",
        url: "/v1/secret/metadata",
      });
      const aliases: string[] = r.data?.data?.keys ?? [];
      // Defense-in-depth: filter to allowlisted aliases only
      const filtered = aliases.filter(isAliasAllowed);
      res.json({ aliases: filtered, total: filtered.length });
    } catch (error: unknown) {
      // 404 from Vault means no secrets — return empty list.
      const e = error as { response?: { status?: number } };
      if (e?.response?.status === 404) {
        return res.json({ aliases: [], total: 0 });
      }
      next(error);
    }
  }
);

/* ─── GET /meta/:alias ───────────────────────────────────────── */
router.get(
  "/meta/:alias",
  requireRole("admin", "operator"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const alias = req.params.alias;
      if (!isAliasAllowed(alias)) {
        return res.status(403).json({ error: "alias-not-allowed" });
      }
      const vault = await getVaultClient();
      const r = await vault.get(`/v1/secret/metadata/${encodeURIComponent(alias)}`);
      const meta = r.data?.data ?? {};
      // Strip any value-like fields defensively
      res.json({
        alias,
        createdTime: meta.created_time,
        currentVersion: meta.current_version,
        updatedTime: meta.updated_time,
        maxVersions: meta.max_versions,
        casRequired: meta.cas_required,
        deleteVersionAfter: meta.delete_version_after,
        // versions metadata only (no values)
        versions: meta.versions
          ? Object.entries(meta.versions).map(([v, info]) => ({
              version: Number(v),
              ...(info as { created_time?: string; deletion_time?: string; destroyed?: boolean }),
            }))
          : [],
      });
    } catch (error: unknown) {
      const e = error as { response?: { status?: number } };
      if (e?.response?.status === 404) {
        return res.status(404).json({ error: "alias-not-found" });
      }
      next(error);
    }
  }
);

export default router;

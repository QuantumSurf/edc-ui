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

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
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
  "ih-apikey-", // per-tenant IdentityHub API key (vault-referenced)
  // EDC-managed aliases — actual prefix varies by extension; cover both forms.
  "edc:",
  "edc-",
];

function isAliasAllowed(alias: string): boolean {
  return ALIAS_PREFIX_ALLOWLIST.some(p => alias === p || alias.startsWith(p));
}

/** Vault 자체에 도달 못한 경우(미구성·DNS 실패·연결 거부 등)인지 판별. HTTP 응답이 온
 *  에러(권한·봉인 등)와 구분해, 미도달은 503 으로 깔끔히 처리하기 위함. */
function isUnreachable(error: unknown): boolean {
  const e = error as { code?: string; response?: unknown };
  if (e?.response) return false; // Vault 가 응답함 → 도달은 됨(다른 오류)
  return (
    typeof e?.code === "string" &&
    /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET|EHOSTUNREACH/.test(
      e.code
    )
  );
}

/* ─── GET /status ────────────────────────────────────────────── */
router.get(
  "/status",
  // Vault 봉인상태·클러스터 식별자·내부 URL은 운영 정보 — viewer 차단(/list·/meta와 일관).
  requireRole("admin", "operator"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const vault = await getVaultClient();
      const [seal, health] = await Promise.all([
        vault.get("/v1/sys/seal-status").then(r => r.data),
        vault
          .get("/v1/sys/health")
          .then(r => r.data)
          .catch(e => e.response?.data ?? {}),
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
    } catch (error: unknown) {
      // Vault 미도달/미구성(ENOTFOUND·ECONNREFUSED 등)은 503 으로 명확히 반환한다.
      // (raw 500 + 내부 호스트명 누출 방지. 클라는 이 에러로 '도달 불가/미구성'을 표시하고
      //  데모 데이터를 진짜처럼 노출하지 않는다.)
      if (isUnreachable(error)) {
        return res.status(503).json({ error: "vault-unreachable" });
      }
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
      // 미도달/미구성은 503(내부 호스트명 누출 방지).
      if (isUnreachable(error)) {
        return res.status(503).json({ error: "vault-unreachable" });
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
      const r = await vault.get(
        `/v1/secret/metadata/${encodeURIComponent(alias)}`
      );
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
              ...(info as {
                created_time?: string;
                deletion_time?: string;
                destroyed?: boolean;
              }),
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

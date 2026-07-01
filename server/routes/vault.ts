// KMX EDC — Platform Vault management API (read-only).
//
// Endpoints (all RBAC-gated):
//   GET /api/platform/vault/status        — sealed/unsealed/version (admin/operator)
//   GET /api/platform/vault/list          — caller's OWN aliases only, NO values (admin/operator)
//   GET /api/platform/vault/meta/:alias   — metadata of caller's OWN alias only (admin/operator)
//
// Multi-tenancy: /list and /meta are tenant-scoped. A tenant admin/operator only
// ever sees its own IdentityHub API-key alias (ih-apikey-{tenantId}); platform
// infrastructure secrets (dataplane/STS/EDC keys) and other tenants' aliases are
// never enumerated or readable — the shared vault namespace is otherwise global.
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
import { getTenant } from "../lib/tenants.js";
import { ihApiKeyAlias } from "../lib/identityHubConfig.js";

const router = Router();

/**
 * 호출자(테넌트)가 조회할 수 있는 vault 별칭 집합 — 본인 IdentityHub API 키뿐이다.
 * 단일 vault 네임스페이스를 전 테넌트가 공유하므로, 접두사 allowlist만으로는 한 테넌트
 * admin 이 타 테넌트의 ih-apikey-{BPN} 별칭(=BPN 열거)과 플랫폼 인프라 시크릿을 모두
 * 보게 된다. 따라서 본인 소유 별칭만 정확히 매칭해 노출한다. 레거시 BPN 기반 별칭은
 * tenantId 기반으로 자가 마이그레이션되기 전까지 함께 인정한다.
 */
async function ownVaultAliases(
  tenantId: string | undefined
): Promise<Set<string>> {
  if (!tenantId) return new Set();
  const aliases = new Set<string>([ihApiKeyAlias(tenantId)]);
  try {
    const tenant = await getTenant(tenantId);
    if (tenant?.bpn) aliases.add(`ih-apikey-${tenant.bpn}`);
  } catch {
    /* getTenant 실패 → tenantId 기반 별칭만 인정(fail-closed) */
  }
  return aliases;
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 테넌트 격리: 본인 소유 별칭만 노출. 미보유/무테넌트면 빈 목록(fail-closed).
      const own = await ownVaultAliases(req.user?.tenantId);
      if (own.size === 0) {
        res.json({ aliases: [], total: 0 });
        return;
      }
      const vault = await getVaultClient();
      const r = await vault.request({
        method: "LIST",
        url: "/v1/secret/metadata",
      });
      const aliases: string[] = r.data?.data?.keys ?? [];
      // 본인 소유 별칭만 통과 — 타 테넌트 별칭·플랫폼 인프라 시크릿 열거 차단.
      const filtered = aliases.filter(a => own.has(a));
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
      // 테넌트 격리: 본인 소유 별칭이 아니면 존재 자체를 드러내지 않도록 404.
      const own = await ownVaultAliases(req.user?.tenantId);
      if (!own.has(alias)) {
        return res.status(404).json({ error: "alias-not-found" });
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

// KMX EDC — Global app settings (key-value store in `app_settings`).
// Currently exposes identity_hub_url. admin-only writes.

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getPool } from "../lib/db.js";
import { requireRole } from "../middleware/auth.js";
import {
  getIdentityHubConfig,
  ihApiKeyAlias,
} from "../lib/identityHubConfig.js";
import {
  getTenantSetting,
  getTenantSettings,
  setTenantSetting,
  getTenant,
  updateTenantBpn,
  isBpnTaken,
  isUniqueViolation,
} from "../lib/tenants.js";
import {
  NOTIFY_PREF_KEYS,
  invalidateTenantNotifyPrefs,
} from "../lib/notificationGenerator.js";
import { validateBody } from "../middleware/validate.js";
import { notifyPrefsSchema } from "../schemas/settings.js";
import { validateDspEndpoint } from "../middleware/validation.js";
import {
  writeVaultSecret,
  VAULT_RUNTIME_CONFIG_ENABLED,
} from "../lib/platform.js";

const router = Router();
const writeGuard = requireRole("admin");

const MAX_VALUE_LEN = 1024;

async function getSetting(key: string): Promise<string> {
  const { rows } = await getPool().query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = $1`,
    [key]
  );
  return rows[0]?.value ?? "";
}

async function setSetting(key: string, value: string): Promise<void> {
  await getPool().query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

// GET /api/system/settings/notifications — 테넌트의 알림 source 토글(미설정=on).
// 서버 생성 게이팅(notificationGenerator.isSourceEnabled)과 같은 키/값을 쓴다.
router.get(
  "/settings/notifications",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      const stored = await getTenantSettings(tenantId, NOTIFY_PREF_KEYS);
      const prefs: Record<string, boolean> = {};
      for (const k of NOTIFY_PREF_KEYS) prefs[k] = stored[k] !== "false";
      res.json(prefs);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/system/settings/notifications — 알림 source 토글 갱신(부분).
// 테넌트 전체에 적용되는 생성 차단이므로 admin/operator 만(viewer 의 로컬 표시
// 필터는 클라 localStorage 가 그대로 담당).
router.put(
  "/settings/notifications",
  requireRole("admin", "operator"),
  validateBody(notifyPrefsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      const body = req.body as Record<string, boolean | undefined>;
      for (const k of NOTIFY_PREF_KEYS) {
        const v = body[k];
        if (typeof v === "boolean") {
          await setTenantSetting(tenantId, k, v ? "true" : "false");
        }
      }
      invalidateTenantNotifyPrefs(tenantId); // TTL 캐시 즉시 무효화(최대 60초 지연 제거)
      const stored = await getTenantSettings(tenantId, NOTIFY_PREF_KEYS);
      const prefs: Record<string, boolean> = {};
      for (const k of NOTIFY_PREF_KEYS) prefs[k] = stored[k] !== "false";
      res.json(prefs);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/system/settings/tenant — current organization (tenant) info incl. BPN
router.get(
  "/settings/tenant",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      const tenant = tenantId ? await getTenant(tenantId) : undefined;
      res.json({ name: tenant?.name ?? "", bpn: tenant?.bpn ?? "" });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/system/settings/tenant — update the organization BPN (also the login id)
router.put(
  "/settings/tenant",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      const raw = (req.body?.bpn ?? "") as unknown;
      if (typeof raw !== "string") {
        res.status(400).json({ error: "bpn must be string" });
        return;
      }
      const bpn = raw.trim();
      if (!bpn) {
        res.status(400).json({ error: "bpn is required" });
        return;
      }
      if (bpn.length > MAX_VALUE_LEN) {
        res.status(400).json({ error: "value too long" });
        return;
      }
      // BPN 형식 검증(근본 차단) — 비표준 값이 저장되면 카탈로그 counterPartyId 정규화가
      // 실패해 audience 불일치(opaque 401)를 유발하므로 표준 BPNL 형식만 허용한다(id 27).
      if (!/^BPNL[0-9A-Z]+$/i.test(bpn)) {
        res.status(400).json({ error: "bpn-invalid-format" });
        return;
      }
      // 선검사(친절한 409). 동시 PUT TOCTOU 는 uq_tenants_bpn 유니크 인덱스가 백스톱한다.
      if (await isBpnTaken(bpn, tenantId)) {
        res.status(409).json({ error: "bpn-already-in-use" });
        return;
      }
      try {
        const updated = await updateTenantBpn(tenantId, bpn);
        res.json({ name: updated?.name ?? "", bpn: updated?.bpn ?? bpn });
      } catch (e) {
        // 유니크 백스톱 충돌(동시 등록 경합) → 409.
        if (isUniqueViolation(e)) {
          res.status(409).json({ error: "bpn-already-in-use" });
          return;
        }
        throw e;
      }
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/system/settings/identity-hub-url (per-tenant)
router.get(
  "/settings/identity-hub-url",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      const value = tenantId
        ? await getTenantSetting(tenantId, "identity_hub_url")
        : "";
      res.json({ value });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/system/settings/identity-hub-url (per-tenant)
router.put(
  "/settings/identity-hub-url",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      const value = (req.body?.value ?? "") as unknown;
      if (typeof value !== "string") {
        res.status(400).json({ error: "value must be string" });
        return;
      }
      if (value.length > MAX_VALUE_LEN) {
        res.status(400).json({ error: "value too long" });
        return;
      }
      if (value.trim()) {
        const ssrfErr = validateDspEndpoint(value.trim());
        if (ssrfErr) {
          res.status(400).json({ error: `Rejected URL — ${ssrfErr}` });
          return;
        }
      }
      await setTenantSetting(tenantId, "identity_hub_url", value.trim());
      res.json({ value: value.trim() });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/system/settings/vault-config
// Returns the Vault connection config. The token VALUE is never returned —
// only a boolean indicating whether one is stored.
// 플랫폼 Vault URL/네임스페이스는 인프라 설정이라 admin 전용(쓰기 PUT과 동일 least-privilege) —
// viewer/operator 에게 전역 Vault 엔드포인트를 노출하지 않는다.
router.get(
  "/settings/vault-config",
  writeGuard,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [url, token, namespace] = await Promise.all([
        getSetting("vault_url"),
        getSetting("vault_token"),
        getSetting("vault_namespace"),
      ]);
      res.json({ url, namespace, hasToken: token.length > 0 });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/system/settings/vault-config
// Accepts { url, token, namespace }. The token is only overwritten when a
// non-empty value is supplied (blank = keep the existing token).
router.put(
  "/settings/vault-config",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // prod 에서 Vault 인프라는 env(PLATFORM_VAULT_*)로만 관리한다. 런타임 재지정을 허용하면
      // 테넌트 admin 이 전역 Vault 를 자기 서버로 돌려 타 테넌트 시크릿을 가로챌 수 있다(CWE-639).
      if (!VAULT_RUNTIME_CONFIG_ENABLED) {
        res.status(403).json({ error: "vault-config-env-managed" });
        return;
      }
      const body = (req.body ?? {}) as {
        url?: unknown;
        token?: unknown;
        namespace?: unknown;
      };
      const url = typeof body.url === "string" ? body.url.trim() : "";
      const namespace =
        typeof body.namespace === "string" ? body.namespace.trim() : "";
      const token = typeof body.token === "string" ? body.token : "";
      if (
        url.length > MAX_VALUE_LEN ||
        namespace.length > MAX_VALUE_LEN ||
        token.length > MAX_VALUE_LEN
      ) {
        res.status(400).json({ error: "value too long" });
        return;
      }
      if (url) {
        const ssrfErr = validateDspEndpoint(url);
        if (ssrfErr) {
          res.status(400).json({ error: `Rejected vault url — ${ssrfErr}` });
          return;
        }
      }
      await setSetting("vault_url", url);
      await setSetting("vault_namespace", namespace);
      if (token.length > 0) await setSetting("vault_token", token.trim());
      const savedToken = await getSetting("vault_token");
      res.json({ url, namespace, hasToken: savedToken.length > 0 });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/system/settings/identity-hub-config
// Connection config for fetching the participant's own info from the
// IdentityHub server. The API key VALUE is never returned.
router.get(
  "/settings/identity-hub-config",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Effective values: per-tenant settings override, env vars as the baseline.
      const cfg = await getIdentityHubConfig(req.user?.tenantId);
      res.json({
        url: cfg.url,
        participantId: cfg.participantId,
        hasApiKey: cfg.apiKey.length > 0,
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/system/settings/identity-hub-config
// Accepts { url, participantId, apiKey }. The API key is only overwritten
// when a non-empty value is supplied (blank = keep the existing key).
router.put(
  "/settings/identity-hub-config",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      const body = (req.body ?? {}) as {
        url?: unknown;
        participantId?: unknown;
        apiKey?: unknown;
      };
      const url = typeof body.url === "string" ? body.url.trim() : "";
      const participantId =
        typeof body.participantId === "string" ? body.participantId.trim() : "";
      const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
      if (
        url.length > MAX_VALUE_LEN ||
        participantId.length > MAX_VALUE_LEN ||
        apiKey.length > MAX_VALUE_LEN
      ) {
        res.status(400).json({ error: "value too long" });
        return;
      }
      if (url) {
        const ssrfErr = validateDspEndpoint(url);
        if (ssrfErr) {
          res.status(400).json({ error: `Rejected URL — ${ssrfErr}` });
          return;
        }
      }
      await setTenantSetting(tenantId, "identity_hub_url", url);
      await setTenantSetting(
        tenantId,
        "identity_hub_participant_id",
        participantId
      );
      // API 키는 평문 DB 대신 platform-vault에 저장하고 tenant_settings엔 alias만 기록.
      // 별칭은 불변 tenantId 기반(ihApiKeyAlias) — 가변 BPN을 쓰면 BPN 반납·재사용 시
      // 두 테넌트가 같은 vault 키를 공유/덮어쓴다(교차테넌트 시크릿 누수).
      if (apiKey.length > 0) {
        const alias = ihApiKeyAlias(tenantId);
        await writeVaultSecret(alias, apiKey.trim());
        await setTenantSetting(tenantId, "identity_hub_api_key_alias", alias);
        // 레거시 평문이 남아 있으면 제거(이제 vault가 정본).
        await setTenantSetting(tenantId, "identity_hub_api_key", "");
      }
      const cfg = await getIdentityHubConfig(tenantId);
      res.json({ url, participantId, hasApiKey: cfg.apiKey.length > 0 });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

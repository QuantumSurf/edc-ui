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
import { getIdentityHubConfig } from "../lib/identityHubConfig.js";
import {
  getTenantSetting,
  setTenantSetting,
  getTenant,
  updateTenantBpn,
  isBpnTaken,
} from "../lib/tenants.js";
import { validateDspEndpoint } from "../middleware/validation.js";
import { writeVaultSecret } from "../lib/platform.js";

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
      if (await isBpnTaken(bpn, tenantId)) {
        res.status(409).json({ error: "bpn-already-in-use" });
        return;
      }
      const updated = await updateTenantBpn(tenantId, bpn);
      res.json({ name: updated?.name ?? "", bpn: updated?.bpn ?? bpn });
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
router.get(
  "/settings/vault-config",
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
      if (apiKey.length > 0) {
        const tenant = await getTenant(tenantId);
        const alias = `ih-apikey-${tenant?.bpn || tenantId}`;
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

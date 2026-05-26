// KMX EDC — Global app settings (key-value store in `app_settings`).
// Currently exposes identity_hub_url. admin-only writes.

import { Router, type Request, type Response, type NextFunction } from "express";
import { getPool } from "../lib/db.js";
import { requireRole } from "../middleware/auth.js";
import { getIdentityHubConfig } from "../lib/identityHubConfig.js";

const router = Router();
const writeGuard = requireRole("admin");

const MAX_VALUE_LEN = 1024;

async function getSetting(key: string): Promise<string> {
  const { rows } = await getPool().query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = $1`,
    [key],
  );
  return rows[0]?.value ?? "";
}

async function setSetting(key: string, value: string): Promise<void> {
  await getPool().query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value],
  );
}

// GET /api/system/settings/identity-hub-url
router.get("/settings/identity-hub-url", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const value = await getSetting("identity_hub_url");
    res.json({ value });
  } catch (error) {
    next(error);
  }
});

// PUT /api/system/settings/identity-hub-url
router.put("/settings/identity-hub-url", writeGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const value = (req.body?.value ?? "") as unknown;
    if (typeof value !== "string") {
      res.status(400).json({ error: "value must be string" });
      return;
    }
    if (value.length > MAX_VALUE_LEN) {
      res.status(400).json({ error: "value too long" });
      return;
    }
    await setSetting("identity_hub_url", value.trim());
    res.json({ value: value.trim() });
  } catch (error) {
    next(error);
  }
});

// GET /api/system/settings/vault-config
// Returns the Vault connection config. The token VALUE is never returned —
// only a boolean indicating whether one is stored.
router.get("/settings/vault-config", async (_req: Request, res: Response, next: NextFunction) => {
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
});

// PUT /api/system/settings/vault-config
// Accepts { url, token, namespace }. The token is only overwritten when a
// non-empty value is supplied (blank = keep the existing token).
router.put("/settings/vault-config", writeGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as { url?: unknown; token?: unknown; namespace?: unknown };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const namespace = typeof body.namespace === "string" ? body.namespace.trim() : "";
    const token = typeof body.token === "string" ? body.token : "";
    if (url.length > MAX_VALUE_LEN || namespace.length > MAX_VALUE_LEN || token.length > MAX_VALUE_LEN) {
      res.status(400).json({ error: "value too long" });
      return;
    }
    await setSetting("vault_url", url);
    await setSetting("vault_namespace", namespace);
    if (token.length > 0) await setSetting("vault_token", token.trim());
    const savedToken = await getSetting("vault_token");
    res.json({ url, namespace, hasToken: savedToken.length > 0 });
  } catch (error) {
    next(error);
  }
});

// GET /api/system/settings/identity-hub-config
// Connection config for fetching the participant's own info from the
// IdentityHub server. The API key VALUE is never returned.
router.get("/settings/identity-hub-config", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Effective values: app_settings overrides, env vars as the baseline.
    const cfg = await getIdentityHubConfig();
    res.json({ url: cfg.url, participantId: cfg.participantId, hasApiKey: cfg.apiKey.length > 0 });
  } catch (error) {
    next(error);
  }
});

// PUT /api/system/settings/identity-hub-config
// Accepts { url, participantId, apiKey }. The API key is only overwritten
// when a non-empty value is supplied (blank = keep the existing key).
router.put("/settings/identity-hub-config", writeGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as { url?: unknown; participantId?: unknown; apiKey?: unknown };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const participantId = typeof body.participantId === "string" ? body.participantId.trim() : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
    if (url.length > MAX_VALUE_LEN || participantId.length > MAX_VALUE_LEN || apiKey.length > MAX_VALUE_LEN) {
      res.status(400).json({ error: "value too long" });
      return;
    }
    await setSetting("identity_hub_url", url);
    await setSetting("identity_hub_participant_id", participantId);
    if (apiKey.length > 0) await setSetting("identity_hub_api_key", apiKey.trim());
    const savedKey = await getSetting("identity_hub_api_key");
    res.json({ url, participantId, hasApiKey: savedKey.length > 0 });
  } catch (error) {
    next(error);
  }
});

export default router;

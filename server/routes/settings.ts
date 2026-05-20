// KMX EDC — Global app settings (key-value store in `app_settings`).
// Currently exposes identity_hub_url. admin-only writes.

import { Router, type Request, type Response, type NextFunction } from "express";
import { getPool } from "../lib/db.js";
import { requireRole } from "../middleware/auth.js";

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

export default router;

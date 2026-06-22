// KMX EDC — Authentication routes
// POST /login, POST /logout, GET /me

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getPool } from "../lib/db.js";
import {
  verifyPassword,
  dummyVerify,
  signToken,
  type Role,
} from "../lib/auth.js";
import { getTenant } from "../lib/tenants.js";
import { requireAuth } from "../middleware/auth.js";
import { loginRateLimit } from "../middleware/rateLimit.js";

const router = Router();

const MAX_TENANT_LEN = 128; // tenant id (BPN) 입력 한도
const MAX_PASSWORD_LEN = 256; // bcrypt input 한도(72바이트 truncation 고려해 충분히 큼)

// POST /login — exchange tenant id (BPN) + password for a JWT.
// The tenant is identified by its BPN; the user is resolved as that tenant's
// account. rate limit: IP당 15분에 10번 (loginRateLimit middleware)
router.post(
  "/login",
  loginRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, password } = req.body ?? {};
      if (typeof tenantId !== "string" || typeof password !== "string") {
        res
          .status(400)
          .json({ error: "tenantId and password are required strings" });
        return;
      }
      if (
        tenantId.length > MAX_TENANT_LEN ||
        password.length > MAX_PASSWORD_LEN ||
        password.length === 0
      ) {
        res.status(400).json({ error: "Invalid tenant id or password length" });
        return;
      }
      const bpn = tenantId.trim();
      if (!bpn) {
        res.status(400).json({ error: "tenantId and password are required" });
        return;
      }

      // Resolve the tenant by BPN, then its user account.
      const { rows } = await getPool().query(
        `SELECT u.id, u.email, u.name, u.role, u.password_hash,
              t.id AS tenant_id, t.name AS tenant_name, t.bpn AS tenant_bpn
         FROM tenants t
         JOIN users u ON u.tenant_id = t.id
        WHERE t.bpn = $1
        ORDER BY u.created_at
        LIMIT 1`,
        [bpn]
      );
      if (rows.length === 0) {
        // 사용자 미존재 시에도 동일한 bcrypt 비용을 소모(타이밍 열거 방지) 후 동일 응답.
        await dummyVerify(password);
        res.status(401).json({ error: "invalid-credentials" });
        return;
      }
      const u = rows[0] as {
        id: string;
        email: string;
        name: string;
        role: Role;
        password_hash: string;
        tenant_id: string;
        tenant_name: string | null;
        tenant_bpn: string | null;
      };
      const ok = await verifyPassword(password, u.password_hash);
      if (!ok) {
        res.status(401).json({ error: "invalid-credentials" });
        return;
      }

      const token = signToken({
        id: u.id,
        email: u.email,
        role: u.role,
        name: u.name,
        tenantId: u.tenant_id ?? undefined,
      });
      res.json({
        token,
        user: {
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          tenantId: u.tenant_id ?? undefined,
          tenantName: u.tenant_name ?? undefined,
          tenantBpn: u.tenant_bpn ?? undefined,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /logout — client-driven; no server state yet
router.post("/logout", (_req: Request, res: Response) => {
  res.status(204).end();
});

// GET /me — return the current authenticated user (+ tenant info)
router.get(
  "/me",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const u = (
        req as Request & {
          user?: {
            id: string;
            email: string;
            role: Role;
            name?: string;
            tenantId?: string;
          };
        }
      ).user;
      if (!u) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const tenant = u.tenantId ? await getTenant(u.tenantId) : undefined;
      res.json({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        tenantId: u.tenantId,
        tenantName: tenant?.name,
        tenantBpn: tenant?.bpn,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

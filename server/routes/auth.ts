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

// 계정 단위 무차별 대입 잠금 — IP rate-limit(우회/분산/멀티레플리카 약점)과 독립적으로
// 표적 계정을 보호한다(CWE-307). 환경변수로 조정 가능.
const LOGIN_MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES ?? 10);
const LOGIN_LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES ?? 15);

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
              u.token_version, u.failed_login_count, u.locked_until,
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
        token_version: number;
        failed_login_count: number;
        locked_until: Date | string | null;
        tenant_id: string;
        tenant_name: string | null;
        tenant_bpn: string | null;
      };

      // 계정 잠금 — 잠금 창 내면 비밀번호 검증 없이 차단(무차별 대입 방어).
      if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
        res.status(429).json({ error: "account-locked" });
        return;
      }

      const ok = await verifyPassword(password, u.password_hash);
      if (!ok) {
        // 실패 카운트 증가, 임계 초과 시 잠금. 계정 단위라 IP 분산·멀티레플리카에도 견고.
        const failed = (u.failed_login_count ?? 0) + 1;
        if (failed >= LOGIN_MAX_FAILURES) {
          await getPool().query(
            `UPDATE users SET failed_login_count = $1,
               locked_until = NOW() + ($2 || ' minutes')::interval WHERE id = $3`,
            [failed, String(LOGIN_LOCKOUT_MINUTES), u.id]
          );
        } else {
          await getPool().query(
            `UPDATE users SET failed_login_count = $1 WHERE id = $2`,
            [failed, u.id]
          );
        }
        res.status(401).json({ error: "invalid-credentials" });
        return;
      }

      // 성공 — 실패 카운터/잠금 해제.
      await getPool().query(
        `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`,
        [u.id]
      );

      const token = signToken({
        id: u.id,
        email: u.email,
        role: u.role,
        name: u.name,
        tenantId: u.tenant_id ?? undefined,
        tv: u.token_version ?? 0,
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

// POST /logout — 서버측 세션 강제종료: 호출자의 token_version 을 증가시켜 발급된 모든
// 토큰을 즉시 무효화한다(탈취 토큰 회수 가능). 인증 필수.
router.post(
  "/logout",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user?.id) {
        await getPool().query(
          `UPDATE users SET token_version = token_version + 1 WHERE id = $1`,
          [req.user.id]
        );
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

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

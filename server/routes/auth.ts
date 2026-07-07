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
  hashPassword,
  dummyVerify,
  signToken,
  type Role,
} from "../lib/auth.js";
import { getTenant } from "../lib/tenants.js";
import { requireAuth } from "../middleware/auth.js";
import { loginRateLimit } from "../middleware/rateLimit.js";
import { recordAudit } from "../lib/audit.js";
import {
  setAuthCookies,
  clearAuthCookies,
  generateCsrfToken,
} from "../lib/cookies.js";

const router = Router();

const MAX_TENANT_LEN = 128; // tenant id (BPN) 입력 한도
const MAX_PASSWORD_LEN = 256; // bcrypt input 한도(72바이트 truncation 고려해 충분히 큼)

// 양의 정수 env 파싱 — 오설정(비숫자·0·음수)을 조용히 삼키지 않고 안전 기본값으로 폴백 + 경고.
// Number()만 쓰면 'off' 같은 값이 NaN → 'failed >= NaN'이 항상 false → 계정 잠금이 무증상
// 비활성화(CWE-307 통제 소멸)되거나 'NaN minutes'::interval 로 500 이 난다(fail-safe 로 방어).
function positiveIntEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[AUTH] ${name}='${raw}' invalid — falling back to default ${def}`);
    return def;
  }
  return Math.floor(n);
}

// 계정 단위 무차별 대입 잠금 — IP rate-limit(우회/분산/멀티레플리카 약점)과 독립적으로
// 표적 계정을 보호한다(CWE-307). 환경변수로 조정 가능.
const LOGIN_MAX_FAILURES = positiveIntEnv("LOGIN_MAX_FAILURES", 10);
const LOGIN_LOCKOUT_MINUTES = positiveIntEnv("LOGIN_LOCKOUT_MINUTES", 15);

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
        WHERE t.bpn = $1 AND t.archived_at IS NULL
        ORDER BY u.created_at
        LIMIT 1`,
        [bpn]
      );
      if (rows.length === 0) {
        // 사용자 미존재 시에도 동일한 bcrypt 비용을 소모(타이밍 열거 방지) 후 동일 응답.
        await dummyVerify(password);
        // 미존재 테넌트(BPN)는 어느 테넌트에도 귀속시킬 수 없어 tenant_id=null 로 기록.
        void recordAudit({
          action: "auth.login",
          category: "AUTH",
          target: bpn,
          targetType: "User",
          result: "FAILURE",
          actorEmail: bpn,
          ip: req.ip ?? null,
          userAgent: (req.headers["user-agent"] as string) ?? null,
          method: "POST",
          path: "/api/auth/login",
          message: "Login failed (unknown tenant)",
        });
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

      // 열거저항(CWE-203/307): 잠금 여부와 무관하게 항상 비밀번호를 먼저 검증한다.
      //  (1) 미존재 계정(dummyVerify)과 동일하게 정확히 1회 bcrypt 를 소모 → 타이밍 균등화.
      //  (2) 429(account-locked)는 '올바른 비밀번호'를 제시한 실제 소유자에게만 노출한다.
      //      비밀번호가 틀리면 미존재·잠금·오답을 구분하지 않고 항상 401 → 계정 열거 오라클 제거.
      //  (기존엔 잠금 시 비밀번호 검증 없이 429 를 반환해, 공격자가 429/401 상태코드와 잠금경로의
      //   빠른 응답(타이밍)으로 특정 BPN 의 존재 여부를 열거할 수 있었다.)
      const locked =
        u.locked_until != null &&
        new Date(u.locked_until).getTime() > Date.now();

      const ok = await verifyPassword(password, u.password_hash);

      if (locked) {
        if (ok) {
          // 정당한 소유자 — 잠금 사실을 안내(429)해 UX 를 보전한다. 토큰은 발급하지 않는다.
          // 잠금 중에는 카운터/만료시각을 갱신하지 않는다(재잠금 금지) — 그래야 공격자가
          // 오답 반복으로 잠금을 무한 연장하는 self-DoS 확대를 막는다(잠금은 자연 만료).
          void recordAudit({
            tenantId: u.tenant_id ?? null,
            actorId: u.id,
            actorEmail: u.email,
            actorRole: u.role,
            action: "auth.login",
            category: "AUTH",
            target: u.email,
            targetType: "User",
            result: "FAILURE",
            ip: req.ip ?? null,
            userAgent: (req.headers["user-agent"] as string) ?? null,
            method: "POST",
            path: "/api/auth/login",
            message: "Login blocked (account locked)",
          });
          res.status(429).json({ error: "account-locked" });
          return;
        }
        // 오답 — 미존재/잠금과 구분되지 않도록 동일한 401. 활성 잠금 중이라 카운터 미변경.
        void recordAudit({
          tenantId: u.tenant_id ?? null,
          actorId: u.id,
          actorEmail: u.email,
          actorRole: u.role,
          action: "auth.login",
          category: "AUTH",
          target: u.email,
          targetType: "User",
          result: "FAILURE",
          ip: req.ip ?? null,
          userAgent: (req.headers["user-agent"] as string) ?? null,
          method: "POST",
          path: "/api/auth/login",
          message: "Login failed (bad password, locked)",
        });
        res.status(401).json({ error: "invalid-credentials" });
        return;
      }

      if (!ok) {
        // 잠금 아님 + 오답 — 실패 카운트 증가, 임계 이상이면 잠금. 계정 단위라 IP 분산·멀티레플리카에도 견고.
        // 단일 원자적 UPDATE 로 처리한다 — 앱단 read-modify-write(SELECT 값 +1 되쓰기)는 느린
        // bcrypt 지연 창(수백 ms) 동안 동시 오답이 모두 같은 stale 카운터를 읽어 누적이 소실되는
        // lost-update 경합(분산 무차별 대입으로 계정 잠금을 우회)이 있었다. UPDATE 문 내에서
        // failed_login_count 를 행 잠금하에 읽고 증가시키면 동시 요청이 직렬화되어 경합이 사라진다.
        // 만료된 잠금(locked_until <= NOW())이 남아 있으면 카운터를 1 로 리셋(재잠금 무한루프 방지),
        // 아니면 +1. 새 카운터가 임계 이상이면 locked_until 을 설정한다.
        await getPool().query(
          `UPDATE users
              SET failed_login_count = CASE
                    WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 1
                    ELSE failed_login_count + 1
                  END,
                  locked_until = CASE
                    WHEN (CASE
                            WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 1
                            ELSE failed_login_count + 1
                          END) >= $2
                      THEN NOW() + ($3 || ' minutes')::interval
                    ELSE NULL
                  END
            WHERE id = $1`,
          [u.id, LOGIN_MAX_FAILURES, String(LOGIN_LOCKOUT_MINUTES)]
        );
        void recordAudit({
          tenantId: u.tenant_id ?? null,
          actorId: u.id,
          actorEmail: u.email,
          actorRole: u.role,
          action: "auth.login",
          category: "AUTH",
          target: u.email,
          targetType: "User",
          result: "FAILURE",
          ip: req.ip ?? null,
          userAgent: (req.headers["user-agent"] as string) ?? null,
          method: "POST",
          path: "/api/auth/login",
          message: "Login failed (bad password)",
        });
        res.status(401).json({ error: "invalid-credentials" });
        return;
      }

      // 성공 — 실패 카운터/잠금 해제.
      await getPool().query(
        `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`,
        [u.id]
      );

      void recordAudit({
        tenantId: u.tenant_id ?? null,
        actorId: u.id,
        actorEmail: u.email,
        actorRole: u.role,
        action: "auth.login",
        category: "AUTH",
        target: u.email,
        targetType: "User",
        result: "SUCCESS",
        ip: req.ip ?? null,
        userAgent: (req.headers["user-agent"] as string) ?? null,
        method: "POST",
        path: "/api/auth/login",
        message: "Login",
      });

      const token = signToken({
        id: u.id,
        email: u.email,
        role: u.role,
        name: u.name,
        tenantId: u.tenant_id ?? undefined,
        tv: u.token_version ?? 0,
      });
      // JWT 는 httpOnly 쿠키로만 운반한다(응답 본문에 토큰을 넣지 않음) — XSS 가 토큰을
      // 읽어 탈취하는 경로를 원천 차단. CSRF 이중제출 토큰(가독 쿠키)을 함께 발급한다.
      setAuthCookies(res, token, generateCsrfToken());
      res.json({
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
        void recordAudit({
          tenantId: req.user.tenantId ?? null,
          actorId: req.user.id,
          actorEmail: req.user.email,
          actorRole: req.user.role,
          action: "auth.logout",
          category: "AUTH",
          target: req.user.email,
          targetType: "User",
          result: "SUCCESS",
          ip: req.ip ?? null,
          userAgent: (req.headers["user-agent"] as string) ?? null,
          method: "POST",
          path: "/api/auth/logout",
          message: "Logout",
        });
      }
      clearAuthCookies(res); // 브라우저 세션 쿠키 삭제(서버측 token_version 무효화와 함께)
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

// POST /change-password — 인증된 사용자의 셀프 비밀번호 변경(자격증명 회전).
router.post(
  "/change-password",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uid = req.user?.id;
      if (!uid) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const { currentPassword, newPassword } = (req.body ?? {}) as {
        currentPassword?: unknown;
        newPassword?: unknown;
      };
      if (
        typeof currentPassword !== "string" ||
        typeof newPassword !== "string"
      ) {
        res
          .status(400)
          .json({ error: "currentPassword and newPassword required" });
        return;
      }
      // 최소 8자 + 과도 길이 차단(bcrypt 72바이트 truncation 고려한 상한).
      if (newPassword.length < 8 || newPassword.length > MAX_PASSWORD_LEN) {
        res.status(400).json({ error: "password-policy" });
        return;
      }
      const { rows } = await getPool().query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE id = $1`,
        [uid]
      );
      if (rows.length === 0) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const ok = await verifyPassword(currentPassword, rows[0].password_hash);
      if (!ok) {
        res.status(403).json({ error: "current-password-mismatch" });
        return;
      }
      const hash = await hashPassword(newPassword);
      // token_version 증가 → 기존 발급 토큰 전부 무효화(변경 후 재로그인 강제, 탈취 세션 회수).
      await getPool().query(
        `UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2`,
        [hash, uid]
      );
      void recordAudit({
        tenantId: req.user?.tenantId ?? null,
        actorId: uid,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        action: "auth.change-password",
        category: "AUTH",
        target: req.user?.email,
        targetType: "User",
        result: "SUCCESS",
        ip: req.ip ?? null,
        userAgent: (req.headers["user-agent"] as string) ?? null,
        method: "POST",
        path: "/api/auth/change-password",
        message: "Password changed",
      });
      // token_version 증가로 현재 쿠키의 토큰도 무효화됨 → 쿠키를 즉시 삭제해 클라를 깨끗이
      // 로그아웃시킨다(재로그인 필요).
      clearAuthCookies(res);
      res.status(204).end(); // 토큰 무효화됨 → 클라 재로그인 필요
    } catch (err) {
      next(err);
    }
  }
);

export default router;

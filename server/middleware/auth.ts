// KMX EDC — BFF Authentication + Authorization Middleware
// - requireAuth: validates Bearer JWT, attaches req.user
// - requireRole(...roles): RBAC check against req.user.role
// - authMiddleware: legacy entry that delegates to requireAuth (with dev bypass)

import type { Request, Response, NextFunction } from "express";
import { verifyToken, type Role, type TokenPayload } from "../lib/auth.js";
import { getPool } from "../lib/db.js";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * 토큰이 현재 유효한 세대인지 확인 — users.token_version 과 payload.tv 대조.
 * 로그아웃/강제차단 시 token_version 을 증가시키면 그 이전 발급 토큰은 즉시 무효화된다(CWE-613).
 * 배포 전 발급된 토큰(tv 없음)은 tv=0 으로 간주해 기본값 0 과 일치 → 대량 로그아웃 회피.
 */
async function isTokenCurrent(payload: TokenPayload): Promise<boolean> {
  const { rows } = await getPool().query<{ token_version: number }>(
    `SELECT token_version FROM users WHERE id = $1`,
    [payload.id]
  );
  if (rows.length === 0) return false; // 사용자 삭제됨 → 거부
  return (payload.tv ?? 0) === (rows[0].token_version ?? 0);
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/** Core JWT auth. Attaches req.user when a valid Bearer token is provided. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing-token" });
  }
  const token = authHeader.slice(7);

  // Development-only: accept legacy demo tokens for smoke tests. These are granted
  // the lowest-privilege role ("viewer") so read routes guarded by
  // requireRole("admin","operator","viewer") pass, while admin/operator writes stay blocked.
  // tenantId="dev"를 명시 부여해 listConnectors가 항상 WHERE tenant_id 경로를 타게 한다
  // (미부여 시 전 테넌트 노출 회귀 방지 — tenant 격리 fail-closed).
  if (!IS_PRODUCTION && token.startsWith("demo-token-")) {
    req.user = {
      id: "dev",
      email: "dev@kmx.io",
      role: "viewer",
      tenantId: process.env.DEV_TENANT_ID ?? "dev",
    };
    return next();
  }

  let payload: TokenPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: "invalid-token" });
  }
  // 토큰 검증(서명/만료)과 token_version 조회를 분리한다 — 일시적 DB 오류는 '토큰 무효'가
  // 아니므로 401(세션 비움)이 아닌 503(재시도)으로 신호하고, throw 가 async 미들웨어 밖으로
  // 전파돼 프로세스를 죽이지 않게 한다.
  let current: boolean;
  try {
    current = await isTokenCurrent(payload);
  } catch (err) {
    console.error(
      "[AUTH] token check failed (transient):",
      (err as Error).message
    );
    return res.status(503).json({ error: "auth-unavailable" });
  }
  if (!current) {
    return res.status(401).json({ error: "token-revoked" });
  }
  req.user = payload;
  return next();
}

/** RBAC check: allow the request only when req.user.role is in `allowed`. */
export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "unauthorized" });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: "forbidden", required: allowed });
    }
    return next();
  };
}

/**
 * Backwards-compatible middleware used by existing app.use("/api", authMiddleware).
 * Public endpoints (login) must be mounted BEFORE this middleware.
 *
 * Development only (NODE_ENV !== "production"):
 *  - No Authorization header  -> pass through WITHOUT req.user. requireRole 401s, and
 *    tenant-scoped reads now fail-closed (라우트가 no-tenant 403, listConnectors는 throw).
 *  - "demo-token-*" tokens     -> attach req.user with role "viewer" + tenantId="dev"
 *                                 (read routes pass; admin/operator writes blocked).
 *  - Invalid/expired/revoked Bearer token -> 401 (dev 포함). 토큰이 '있는데 나쁘면' 통과시키지
 *    않는다 — 통과시키면 라우트가 403 no-tenant 를 반환해 클라(api.ts)가 403을 '권한부족'으로만
 *    처리하고 세션을 못 비워, 무효화된 토큰으로 화면이 깨진 채 멈춘다(재로그인 유도 실패).
 *    401 이면 클라가 세션을 비우고 로그인으로 복귀한다. (무토큰만 dev 통과)
 * In production every branch returns 401 unless a valid JWT is supplied.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    if (!IS_PRODUCTION) return next();
    return res.status(401).json({ error: "missing-token" });
  }
  const token = authHeader.slice(7);

  if (!IS_PRODUCTION && token.startsWith("demo-token-")) {
    // tenantId="dev" 부여 — 무토큰/데모 경로가 전 테넌트 커넥터를 조회하지 못하게 한다.
    req.user = {
      id: "dev",
      email: "dev@kmx.io",
      role: "viewer",
      tenantId: process.env.DEV_TENANT_ID ?? "dev",
    };
    return next();
  }

  // 토큰이 제공된 이상, 무효/만료/무효화면 dev 에서도 401 — 통과(→403 no-tenant)는 클라가
  // 세션을 정리하지 못해 화면이 깨진 채 멈추는 원인이 된다. 무토큰만 위에서 dev 통과 처리됨.
  let payload: TokenPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: "invalid-token" });
  }
  // 일시적 DB 오류(커넥션 타임아웃 등)는 토큰 무효가 아니다. 여기서 throw 가 전파되면
  // async 미들웨어의 unhandled rejection 이 BFF 프로세스 전체를 죽인다(전 사용자 다운).
  // 503("나중에 다시 시도")으로 신호 — 세션을 비우지 않아 일시 장애 후 자동 복구된다.
  let current: boolean;
  try {
    current = await isTokenCurrent(payload);
  } catch (err) {
    console.error(
      "[AUTH] token check failed (transient):",
      (err as Error).message
    );
    return res.status(503).json({ error: "auth-unavailable" });
  }
  if (!current) {
    return res.status(401).json({ error: "token-revoked" });
  }
  req.user = payload;
  return next();
}

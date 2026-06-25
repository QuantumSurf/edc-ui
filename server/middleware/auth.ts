// KMX EDC — BFF Authentication + Authorization Middleware
// - requireAuth: validates Bearer JWT, attaches req.user
// - requireRole(...roles): RBAC check against req.user.role
// - authMiddleware: legacy entry that delegates to requireAuth (with dev bypass)

import type { Request, Response, NextFunction } from "express";
import { verifyToken, type Role, type TokenPayload } from "../lib/auth.js";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/** Core JWT auth. Attaches req.user when a valid Bearer token is provided. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
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

  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "invalid-token" });
  }
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
 *  - Invalid Bearer token      -> pass through WITHOUT req.user (requireRole 401s).
 * In production every branch returns 401 unless a valid JWT is supplied.
 */
export function authMiddleware(
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

  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    if (!IS_PRODUCTION) return next();
    return res.status(401).json({ error: "invalid-token" });
  }
}

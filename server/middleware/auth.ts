// KMX EDC — BFF Authentication + Authorization Middleware
// - requireAuth: validates Bearer JWT, attaches req.user
// - requireRole(...roles): RBAC check against req.user.role
// - authMiddleware: legacy entry that delegates to requireAuth (with dev bypass)

import type { Request, Response, NextFunction } from "express";
import { verifyToken, type Role, type TokenPayload } from "../lib/auth.js";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

declare module "express-serve-static-core" {
  interface Request {
    user?: TokenPayload;
  }
}

/** Core JWT auth. Attaches req.user when a valid Bearer token is provided. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing-token" });
  }
  const token = authHeader.slice(7);

  // Development-only: accept legacy demo tokens for smoke tests, but do NOT
  // grant any role — downstream requireRole checks will reject destructive ops.
  if (!IS_PRODUCTION && token.startsWith("demo-token-")) {
    req.user = { id: "dev", email: "dev@kmx.io", role: "viewer" };
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
 *
 * Public endpoints (login) must be mounted BEFORE this middleware.
 *
 * In development, when no Authorization header is present this still allows the
 * request through (to keep smoke tests / fetch-before-login calls green), but
 * requireRole() on individual routes will block writes for those anonymous
 * requests because req.user is not attached.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    if (!IS_PRODUCTION) return next();
    return res.status(401).json({ error: "missing-token" });
  }
  const token = authHeader.slice(7);

  if (!IS_PRODUCTION && token.startsWith("demo-token-")) {
    req.user = { id: "dev", email: "dev@kmx.io", role: "viewer" };
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

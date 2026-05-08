// KMX EDC — Authentication routes
// POST /login, POST /logout, GET /me

import { Router, type Request, type Response, type NextFunction } from "express";
import { getPool } from "../lib/db.js";
import { verifyPassword, signToken, type Role } from "../lib/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { loginRateLimit } from "../middleware/rateLimit.js";

const router = Router();

const MAX_EMAIL_LEN = 254;     // RFC 5321 한도
const MAX_PASSWORD_LEN = 256;  // bcrypt input 한도(72바이트 truncation 고려해 충분히 큼)

// POST /login — exchange email+password for a JWT
// rate limit: IP당 15분에 10번 (loginRateLimit middleware)
router.post("/login", loginRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "email and password are required strings" });
      return;
    }
    if (email.length > MAX_EMAIL_LEN || password.length > MAX_PASSWORD_LEN || password.length === 0) {
      res.status(400).json({ error: "Invalid email or password length" });
      return;
    }
    const emailNorm = email.trim().toLowerCase();
    if (!emailNorm) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }
    // Accept legacy short usernames (admin/operator/viewer) → append @kmx.io
    const lookup = emailNorm.includes("@") ? emailNorm : `${emailNorm}@kmx.io`;

    const { rows } = await getPool().query(
      `SELECT id, email, name, role, password_hash FROM users WHERE email = $1 LIMIT 1`,
      [lookup],
    );
    if (rows.length === 0) {
      res.status(401).json({ error: "invalid-credentials" });
      return;
    }
    const u = rows[0] as { id: string; email: string; name: string; role: Role; password_hash: string };
    const ok = await verifyPassword(password, u.password_hash);
    if (!ok) {
      res.status(401).json({ error: "invalid-credentials" });
      return;
    }

    const token = signToken({ id: u.id, email: u.email, role: u.role, name: u.name });
    res.json({
      token,
      user: { id: u.id, email: u.email, name: u.name, role: u.role },
    });
  } catch (err) {
    next(err);
  }
});

// POST /logout — client-driven; no server state yet
router.post("/logout", (_req: Request, res: Response) => {
  res.status(204).end();
});

// GET /me — return the current authenticated user
router.get("/me", requireAuth, (req: Request, res: Response) => {
  const u = (req as Request & { user?: { id: string; email: string; role: Role; name?: string } }).user;
  if (!u) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.json({ id: u.id, email: u.email, name: u.name, role: u.role });
});

export default router;

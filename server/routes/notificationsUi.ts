// KMX EDC — UI Notification Routes
// CRUD for user-facing notifications stored in PostgreSQL

import { Router, type Request, type Response, type NextFunction } from "express";
import { getPool } from "../lib/db.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();
const writeGuard = requireRole("admin", "operator");

// GET /api/notifications — list all, newest first
router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await getPool().query(
      `SELECT id, type, source, title, message, link, read,
              created_at AS timestamp
       FROM notifications
       ORDER BY created_at DESC
       LIMIT 200`
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

// POST /api/notifications — create a new notification (admin/operator only)
router.post("/", writeGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, source, title, message, link } = req.body ?? {};
    if (!type || !source || !title || !message) {
      res.status(400).json({ error: "type, source, title, message are required" });
      return;
    }
    // 입력 길이 제한 (XSS/DoS 방지)
    const MAX = { type: 50, source: 100, title: 200, message: 2000, link: 2048 };
    if (
      String(type).length > MAX.type ||
      String(source).length > MAX.source ||
      String(title).length > MAX.title ||
      String(message).length > MAX.message ||
      (link && String(link).length > MAX.link)
    ) {
      res.status(400).json({ error: "Field length exceeds limit" });
      return;
    }
    const { rows } = await getPool().query(
      `INSERT INTO notifications (type, source, title, message, link)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, type, source, title, message, link, read, created_at AS timestamp`,
      [type, source, title, message, link ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/notifications/read-all — mark all as read (admin/operator only)
router.patch("/read-all", writeGuard, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await getPool().query(`UPDATE notifications SET read = TRUE WHERE read = FALSE`);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// PATCH /api/notifications/:id/read — mark one as read (admin/operator only)
router.patch("/:id/read", writeGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getPool().query(
      `UPDATE notifications SET read = TRUE WHERE id = $1`,
      [req.params.id]
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// DELETE /api/notifications — clear all (admin only)
router.delete("/", requireRole("admin"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await getPool().query(`DELETE FROM notifications`);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// DELETE /api/notifications/:id — dismiss one (admin/operator only)
router.delete("/:id", writeGuard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getPool().query(`DELETE FROM notifications WHERE id = $1`, [req.params.id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;

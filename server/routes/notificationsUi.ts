// KMX EDC — UI Notification Routes
// CRUD for user-facing notifications stored in PostgreSQL.
// 멀티테넌트: 모든 조회/변경/삭제는 호출자 테넌트(req.user.tenantId)로 스코프된다.
// tenantId가 없으면 빈 결과/거부(fail-closed) — 타 테넌트 알림 노출 차단.

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getPool } from "../lib/db.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();
const writeGuard = requireRole("admin", "operator");

// DB CHECK 제약과 단일 출처로 맞춘 화이트리스트 (drift 방지).
const ALLOWED_TYPES = ["info", "warn", "error", "success"] as const;
const ALLOWED_SOURCES = [
  "system",
  "negotiation",
  "transfer",
  "edr",
  "vc",
] as const;

// GET /api/notifications — list the tenant's notifications, newest first
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user?.tenantId;
    // tenantId 없으면 빈 목록(타 테넌트 알림 노출 방지).
    if (!tenantId) {
      res.json([]);
      return;
    }
    const { rows } = await getPool().query(
      `SELECT id, type, source, title, message, link, read,
              msg_key AS "msgKey", msg_params AS "params",
              created_at AS timestamp
       FROM notifications
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [tenantId]
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

// POST /api/notifications — create a new notification (admin/operator only)
router.post(
  "/",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      const { type, source, title, message, link } = req.body ?? {};
      if (!type || !source || !title || !message) {
        res
          .status(400)
          .json({ error: "type, source, title, message are required" });
        return;
      }
      // type/source enum 화이트리스트 검증 — DB CHECK 위반(500) 전에 400으로 거부.
      if (!ALLOWED_TYPES.includes(type) || !ALLOWED_SOURCES.includes(source)) {
        res.status(400).json({
          error: `type must be one of ${ALLOWED_TYPES.join(", ")}; source must be one of ${ALLOWED_SOURCES.join(", ")}`,
        });
        return;
      }
      // 입력 길이 제한 (XSS/DoS 방지)
      const MAX = {
        type: 50,
        source: 100,
        title: 200,
        message: 2000,
        link: 2048,
      };
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
        `INSERT INTO notifications (tenant_id, type, source, title, message, link)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, type, source, title, message, link, read, created_at AS timestamp`,
        [tenantId, type, source, title, message, link ?? null]
      );
      res.status(201).json(rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/notifications/read-all — mark the tenant's notifications as read (admin/operator only)
router.patch(
  "/read-all",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      await getPool().query(
        `UPDATE notifications SET read = TRUE WHERE read = FALSE AND tenant_id = $1`,
        [tenantId]
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/notifications/:id/read — mark one as read (admin/operator only, tenant-scoped)
router.patch(
  "/:id/read",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      await getPool().query(
        `UPDATE notifications SET read = TRUE WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, tenantId]
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/notifications — clear the tenant's notifications (admin only)
router.delete(
  "/",
  requireRole("admin"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      await getPool().query(`DELETE FROM notifications WHERE tenant_id = $1`, [
        tenantId,
      ]);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/notifications/:id — dismiss one (admin/operator only, tenant-scoped)
router.delete(
  "/:id",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      await getPool().query(
        `DELETE FROM notifications WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, tenantId]
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;

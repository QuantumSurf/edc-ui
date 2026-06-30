// KMX EDC — 감사 로그 조회 라우트
// GET /api/audit — 호출자 테넌트 범위의 감사 로그(최신순). 민감 정보이므로 admin/operator 만.

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { queryAudit } from "../lib/audit.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();

router.get(
  "/",
  requireRole("admin", "operator"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      // 테넌트 격리(fail-closed): 테넌트 없으면 빈 목록(전 테넌트 노출 방지).
      if (!tenantId) {
        res.json([]);
        return;
      }
      const limit = Number(req.query.limit);
      const events = await queryAudit(
        tenantId,
        Number.isFinite(limit) ? limit : 500
      );
      res.json(events);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

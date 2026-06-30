// KMX EDC — 입력 이력(Field History) 라우트
// GET  /api/field-history?keys=a,b,c → { [key]: string[] }  (자동완성 제안값, 테넌트 범위)
// POST /api/field-history { entries: [{fieldKey, value}] }   (작성 폼 제출 시 입력값 기록)
// 인증된 사용자의 자기 테넌트 이력만 — 별도 역할 제한 없음(authMiddleware 로 인증만 강제).

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getFieldHistory, recordFieldValues } from "../lib/fieldHistory.js";

const router = Router();

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user?.tenantId;
    // 테넌트 격리(fail-closed): 테넌트 없으면 빈 결과.
    if (!tenantId) {
      res.json({});
      return;
    }
    const keys = String(req.query.keys ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    res.json(await getFieldHistory(tenantId, keys));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      res.status(204).end();
      return;
    }
    const entries = Array.isArray(req.body?.entries)
      ? req.body.entries.slice(0, 40)
      : [];
    await recordFieldValues(tenantId, entries);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;

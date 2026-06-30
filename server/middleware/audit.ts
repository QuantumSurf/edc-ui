// KMX EDC — 감사 로그 미들웨어
// 변이(mutation) 라우트만 식별해(deriveAudit) 응답 완료 시점에 결과(상태코드)와 함께 기록.
// /api 에 mount (authMiddleware 다음) → req.user/req.body 가 채워진 뒤 동작.
// 로그인/로그아웃은 /api/auth 가 authMiddleware 앞에 mount 되어 이 미들웨어를 거치지 않으므로
// auth 라우트에서 명시적으로 기록한다.

import type { Request, Response, NextFunction } from "express";
import { recordAudit, deriveAudit, severityFor } from "../lib/audit.js";

export function auditMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const method = req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS")
    return next();

  const fullPath = req.originalUrl.split("?")[0];
  const derived = deriveAudit(method, fullPath, req.body);
  if (!derived) return next(); // 감사 대상 아님(목록 조회 등)

  // connectorId 추출(있으면) — test-connection 은 커넥터 id 가 아님.
  const cm = fullPath.match(/^\/api\/connectors\/([^/]+)/);
  const connectorId =
    cm && cm[1] !== "test-connection" ? decodeURIComponent(cm[1]) : null;

  // 응답이 끝난 뒤 최종 상태코드로 성공/실패를 판정해 기록(요청 흐름 비차단).
  res.on("finish", () => {
    const result = res.statusCode < 400 ? "SUCCESS" : "FAILURE";
    void recordAudit({
      tenantId: req.user?.tenantId ?? null,
      actorId: req.user?.id ?? null,
      actorEmail: req.user?.email ?? null,
      actorRole: req.user?.role ?? null,
      action: derived.action,
      category: derived.category,
      target: derived.target,
      targetType: derived.targetType,
      connectorId,
      result,
      severity: severityFor(derived.action, result, derived.category),
      statusCode: res.statusCode,
      ip: req.ip ?? null,
      userAgent: (req.headers["user-agent"] as string) ?? null,
      method,
      path: fullPath,
    });
  });

  next();
}

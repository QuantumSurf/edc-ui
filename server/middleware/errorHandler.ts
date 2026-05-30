// KMX EDC — Express error handling middleware
// Sanitizes error messages to prevent information disclosure
import type { Request, Response, NextFunction } from "express";
import { EdcApiError } from "../lib/edcClient.js";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function sanitizeMessage(message: string): string {
  if (IS_PRODUCTION) {
    // In production, never expose internal details
    if (message.includes("ECONNREFUSED") || message.includes("ECONNABORTED")) {
      return "Service temporarily unavailable";
    }
    if (message.includes("timeout")) {
      return "Request timed out";
    }
    return "An error occurred";
  }
  return message; // In development, show full error for debugging
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof EdcApiError) {
    console.error(`[BFF] EDC API Error: ${err.status} ${err.detail}`);
    const role = req.user?.role;
    const privileged = role === "admin" || role === "operator";
    // EDC가 응답 본문으로 돌려준 에러(4xx 검증 + 5xx 자격증명/구성 실패 등)는
    // 내부 토폴로지(호스트/포트/vault alias)를 포함할 수 있다. admin/operator에게만
    // 원인 파악용 상세를 그대로 전달(actionable)하고, viewer/미인증에는 일반화한다.
    // 전송/내부 실패(fromEdcResponse=false)는 항상 5xx 마스킹.
    if (err.fromEdcResponse) {
      if (privileged) {
        res.status(err.status).json({ error: err.detail, source: "edc", actionable: true });
      } else {
        // viewer: 4xx 검증 메시지는 안전하므로 유지, 5xx 내부 상세는 마스킹.
        const msg = err.status >= 400 && err.status < 500 ? err.detail : sanitizeMessage(err.detail);
        res.status(err.status).json({ error: msg, source: "edc" });
      }
      return;
    }
    const message = err.status >= 400 && err.status < 500
      ? err.detail
      : sanitizeMessage(err.detail);
    res.status(err.status).json({ error: message, source: "edc" });
    return;
  }

  if (err instanceof Error) {
    console.error("[BFF] Error:", err.message);
    res.status(500).json({ error: sanitizeMessage(err.message) });
    return;
  }

  res.status(500).json({ error: "Unknown error" });
}

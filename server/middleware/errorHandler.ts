// KMX EDC — Express error handling middleware
// Sanitizes error messages to prevent information disclosure
import type { Request, Response, NextFunction } from "express";
import { EdcApiError } from "../lib/edcClient.js";
import { DtrApiError } from "../lib/dtrClient.js";

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

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
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
        // 4xx(ODRL/검증) 메시지는 원인 파악용으로 유지. 5xx 본문은 내부 토폴로지
        // (vault/구성 호스트·alias)를 포함할 수 있어 prod 에서는 admin/operator 에게도 마스킹.
        const msg =
          err.status >= 400 && err.status < 500
            ? err.detail
            : sanitizeMessage(err.detail);
        res
          .status(err.status)
          .json({ error: msg, source: "edc", actionable: err.status < 500 });
      } else {
        // viewer: 4xx 검증 메시지는 안전하므로 유지, 5xx 내부 상세는 마스킹.
        const msg =
          err.status >= 400 && err.status < 500
            ? err.detail
            : sanitizeMessage(err.detail);
        res.status(err.status).json({ error: msg, source: "edc" });
      }
      return;
    }
    const message =
      err.status >= 400 && err.status < 500
        ? err.detail
        : sanitizeMessage(err.detail);
    res.status(err.status).json({ error: message, source: "edc" });
    return;
  }

  // DTR(디지털 트윈 레지스트리) 업스트림 오류 — EdcApiError 와 동일 정책.
  // 과거엔 DtrApiError 가 이 분기가 없어 503(미도달)이 5xx 격하로 500 이 되고 4xx 상세도
  // sanitize 됐다. err.status 를 존중해 503 은 503(재시도 가능)으로, 4xx 검증 상세는 보존한다.
  if (err instanceof DtrApiError) {
    console.error(`[BFF] DTR API Error: ${err.status} ${err.detail}`);
    const msg =
      err.status >= 400 && err.status < 500
        ? err.detail
        : sanitizeMessage(err.detail);
    res.status(err.status).json({ error: msg, source: "dtr" });
    return;
  }

  // body-parser 등 클라이언트 요청 오류(잘못된 JSON=entity.parse.failed, 본문 과대 등)는
  // 4xx status 를 들고 온다. 이를 존중해 5xx(서버 장애)가 아닌 4xx 로 돌려준다 — 클라가
  // '서버 오류'로 오인하지 않게 한다(잘못된 JSON → 500 이던 안정화 갭 보완).
  const cstatus =
    (err as { status?: number }).status ??
    (err as { statusCode?: number }).statusCode;
  if (typeof cstatus === "number" && cstatus >= 400 && cstatus < 500) {
    const m = err instanceof Error ? err.message : "Bad request";
    console.warn(`[BFF] Client error ${cstatus}: ${m}`);
    res.status(cstatus).json({ error: sanitizeMessage(m) });
    return;
  }

  if (err instanceof Error) {
    console.error("[BFF] Error:", err.message);
    res.status(500).json({ error: sanitizeMessage(err.message) });
    return;
  }

  res.status(500).json({ error: "Unknown error" });
}

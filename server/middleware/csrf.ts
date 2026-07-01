// KMX EDC — CSRF 보호 미들웨어 (double-submit cookie)
// httpOnly JWT 쿠키 세션에만 적용한다. 쿠키는 브라우저가 교차출처 요청에도 자동 첨부하므로
// (SameSite=Strict 로 1차 차단하되) 방어심층화를 위해, 변이 요청은 X-CSRF-Token 헤더가
// kmx_csrf 쿠키와 일치해야 통과시킨다. 공격자는 SOP 때문에 피해자의 csrf 쿠키를 읽지 못하고,
// 커스텀 헤더를 교차출처로 설정할 수 없어 위조 요청이 차단된다(CWE-352).

import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { AUTH_COOKIE, CSRF_COOKIE, getCookie } from "../lib/cookies.js";

// 부작용 없는 메서드는 CSRF 대상이 아니다.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** 길이 노출 없는 상수시간 문자열 비교. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (SAFE_METHODS.has(req.method)) return next();

  // 로그인은 CSRF 예외 — 자격증명으로 정당성이 검증되고 부작용이 '새 세션 발급'뿐이라 안전
  // (로그인 CSRF 는 SameSite=Strict 로도 완화). 결정적으로, 세션 만료/무효화 후 브라우저에
  // 남은 stale kmx_token 쿠키를 실은 재로그인 POST 가 csrf 헤더 부재로 403 되어 '재로그인 불능'
  // 이 되는 것을 막는다. 마운트 경로가 /api 라 req.path 는 /api 가 벗겨지므로 originalUrl 로 판별.
  if (
    req.method === "POST" &&
    (req.originalUrl || "").split("?")[0] === "/api/auth/login"
  ) {
    return next();
  }

  // auth 쿠키가 없으면 쿠키 세션이 아니다 → CSRF 벡터가 아니므로 통과.
  //  - 미인증 요청: 뒤의 auth 미들웨어가 401 로 판정(여기서 막으면 401→403 회귀).
  //  - Bearer 토큰 API 클라이언트: 브라우저가 헤더를 자동 첨부하지 않아 CSRF 불가.
  //  - 로그인(POST /api/auth/login): 최초 접속이라 아직 auth 쿠키가 없어 자동 면제.
  const authCookie = getCookie(req, AUTH_COOKIE);
  if (!authCookie) return next();

  const headerToken = req.headers["x-csrf-token"];
  const cookieToken = getCookie(req, CSRF_COOKIE);
  if (
    typeof headerToken === "string" &&
    headerToken.length > 0 &&
    cookieToken &&
    safeEqual(headerToken, cookieToken)
  ) {
    return next();
  }
  res.status(403).json({ error: "csrf" });
}

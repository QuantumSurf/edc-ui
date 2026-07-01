// KMX EDC — 인증 쿠키 헬퍼
// 세션 JWT 를 httpOnly 쿠키로 운반해 XSS 토큰 탈취를 차단하고(자바스크립트가 읽지 못함),
// 이중제출(double-submit) CSRF 방어용 kmx_csrf 쿠키(JS 가독)를 함께 발급한다.
// cookie-parser 의존성 없이 req.headers.cookie 를 직접 파싱한다(수동, 무의존).

import crypto from "node:crypto";
import type { Request, Response } from "express";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** httpOnly 세션 JWT 쿠키명. */
export const AUTH_COOKIE = "kmx_token";
/** CSRF 이중제출 토큰 쿠키명(비 httpOnly — 클라가 읽어 헤더로 되돌려보낸다). */
export const CSRF_COOKIE = "kmx_csrf";

// 공통 옵션: SameSite=Strict 로 교차출처 자동전송을 차단(CSRF 1차 방어), prod 에서만 Secure
// (dev 는 http localhost 라 Secure 면 브라우저가 저장하지 않음). Domain 미지정 = host-only
// 쿠키라 Vite 프록시(changeOrigin)를 그대로 통과한다. maxAge 미지정 = 세션 쿠키
// (브라우저 종료 시 삭제 — 기존 sessionStorage UX 유지, JWT 12h 만료가 상한).
function baseCookieOpts() {
  return { sameSite: "strict" as const, secure: IS_PRODUCTION, path: "/" };
}

/** req.headers.cookie 를 { name: value } 맵으로 파싱(값은 percent-decode, 실패 시 원문 유지). */
export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (!k) continue;
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function getCookie(req: Request, name: string): string | null {
  return parseCookies(req)[name] ?? null;
}

/** 암호학적 난수 CSRF 토큰(256bit, base64url). */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** 로그인 성공 시 인증(httpOnly)·CSRF(가독) 쿠키를 함께 발급. */
export function setAuthCookies(res: Response, token: string, csrf: string): void {
  res.cookie(AUTH_COOKIE, token, { ...baseCookieOpts(), httpOnly: true });
  res.cookie(CSRF_COOKIE, csrf, { ...baseCookieOpts(), httpOnly: false });
}

/** 로그아웃/자격증명 회전 시 두 쿠키를 만료시켜 세션을 종료. 옵션은 발급 시와 일치해야 삭제됨. */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(AUTH_COOKIE, { ...baseCookieOpts(), httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...baseCookieOpts(), httpOnly: false });
}

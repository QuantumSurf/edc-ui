import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { csrfProtection } from "./csrf.js";
import { AUTH_COOKIE, CSRF_COOKIE } from "../lib/cookies.js";

function makeReq(
  method: string,
  cookies: Record<string, string>,
  csrfHeader?: string
): Request {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(csrfHeader !== undefined ? { "x-csrf-token": csrfHeader } : {}),
    },
  } as unknown as Request;
}

function makeRes() {
  const res = { statusCode: 200 } as Response & {
    statusCode: number;
    body?: unknown;
  };
  res.status = vi.fn((c: number) => {
    res.statusCode = c;
    return res;
  }) as unknown as Response["status"];
  res.json = vi.fn((b: unknown) => {
    (res as { body?: unknown }).body = b;
    return res;
  }) as unknown as Response["json"];
  return res;
}

describe("csrfProtection (double-submit)", () => {
  it("안전 메서드(GET)는 무조건 통과", () => {
    const next = vi.fn();
    csrfProtection(makeReq("GET", {}), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("auth 쿠키 없으면 변이여도 통과(비쿠키 세션 — CSRF 비대상, 뒤 auth 가 판정)", () => {
    const next = vi.fn();
    csrfProtection(makeReq("POST", {}), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("auth 쿠키 + 일치하는 CSRF 헤더 → 통과", () => {
    const next = vi.fn();
    const token = "csrf-token-abc";
    csrfProtection(
      makeReq(
        "POST",
        { [AUTH_COOKIE]: "jwt", [CSRF_COOKIE]: token },
        token
      ),
      makeRes(),
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("auth 쿠키 + CSRF 헤더 누락 → 403", () => {
    const next = vi.fn();
    const res = makeRes();
    csrfProtection(
      makeReq("POST", { [AUTH_COOKIE]: "jwt", [CSRF_COOKIE]: "abc" }),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("auth 쿠키 + 불일치 CSRF 헤더 → 403", () => {
    const next = vi.fn();
    const res = makeRes();
    csrfProtection(
      makeReq(
        "POST",
        { [AUTH_COOKIE]: "jwt", [CSRF_COOKIE]: "abc" },
        "wrong-value"
      ),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("auth 쿠키만 있고 CSRF 쿠키 없음 → 403", () => {
    const next = vi.fn();
    const res = makeRes();
    csrfProtection(
      makeReq("POST", { [AUTH_COOKIE]: "jwt" }, "whatever"),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("로그인 경로는 stale auth 쿠키가 있어도 CSRF 예외 — 재로그인 lockout 방지", () => {
    const next = vi.fn();
    // 만료/무효화 후 브라우저에 남은 stale 쿠키를 실은 재로그인 POST(헤더 없음) → 통과해야 함.
    const req = {
      method: "POST",
      originalUrl: "/api/auth/login",
      headers: { cookie: `${AUTH_COOKIE}=stale-jwt; ${CSRF_COOKIE}=stale` },
    } as unknown as Request;
    csrfProtection(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("DELETE 도 CSRF 보호 대상", () => {
    const next = vi.fn();
    const res = makeRes();
    csrfProtection(
      makeReq("DELETE", { [AUTH_COOKIE]: "jwt", [CSRF_COOKIE]: "abc" }),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

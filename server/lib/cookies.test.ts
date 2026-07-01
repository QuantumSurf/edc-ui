import { describe, it, expect } from "vitest";
import type { Request } from "express";
import {
  parseCookies,
  getCookie,
  generateCsrfToken,
  AUTH_COOKIE,
  CSRF_COOKIE,
} from "./cookies.js";

function reqWithCookie(cookie?: string): Request {
  return { headers: cookie ? { cookie } : {} } as unknown as Request;
}

describe("cookies", () => {
  it("parseCookies: 다중 쿠키 파싱 + 트림 + percent-decode", () => {
    const c = parseCookies(
      reqWithCookie("kmx_token=abc; kmx_csrf=x%20y ; foo=bar")
    );
    expect(c[AUTH_COOKIE]).toBe("abc");
    expect(c[CSRF_COOKIE]).toBe("x y");
    expect(c.foo).toBe("bar");
  });

  it("parseCookies: 헤더 없으면 빈 객체", () => {
    expect(parseCookies(reqWithCookie())).toEqual({});
  });

  it("parseCookies: 잘못된 percent-encoding 은 원문 유지(throw 안 함)", () => {
    const c = parseCookies(reqWithCookie("kmx_csrf=%zz"));
    expect(c[CSRF_COOKIE]).toBe("%zz");
  });

  it("getCookie: 존재/부재", () => {
    const req = reqWithCookie("kmx_token=t1");
    expect(getCookie(req, AUTH_COOKIE)).toBe("t1");
    expect(getCookie(req, CSRF_COOKIE)).toBeNull();
  });

  it("generateCsrfToken: 충분한 엔트로피 길이 + 매번 다름", () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a).not.toBe(b);
  });
});

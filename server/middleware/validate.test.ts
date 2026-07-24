// zod 요청 검증 게이트 특성화 — 400 응답 형태(민감정보 미노출)와 스키마 계약을 고정한다.
import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { validateBody } from "./validate.js";
import { loginSchema, changePasswordSchema } from "../schemas/auth.js";
import {
  createConnectorSchema,
  testConnectionSchema,
} from "../schemas/connectors.js";

/** 미들웨어 1회 호출 헬퍼 — {status, body, nexted} 를 돌려준다. */
function run(mw: ReturnType<typeof validateBody>, body: unknown) {
  const req = { body } as Request;
  let status = 0;
  let payload: unknown = null;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(b: unknown) {
      payload = b;
      return this;
    },
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  mw(req, res, next);
  return {
    status,
    body: payload as { error?: string; issues?: { path: string }[] } | null,
    nexted: (next as ReturnType<typeof vi.fn>).mock.calls.length > 0,
    parsed: req.body,
  };
}

describe("validateBody (zod 게이트)", () => {
  it("유효 본문은 next() + 파싱된 값으로 req.body 치환", () => {
    const r = run(validateBody(loginSchema), {
      tenantId: "BPNL000000000PRD",
      password: "0000",
    });
    expect(r.nexted).toBe(true);
    expect(r.status).toBe(0);
  });

  it("실패는 400 {error:'validation', issues[{path,message}]} — 입력값 미반사", () => {
    const r = run(validateBody(loginSchema), {
      tenantId: 123,
      password: "secret-value",
    });
    expect(r.nexted).toBe(false);
    expect(r.status).toBe(400);
    expect(r.body?.error).toBe("validation");
    const dump = JSON.stringify(r.body);
    // 응답에 입력값(비밀번호 등)이 되돌아가지 않아야 한다.
    expect(dump).not.toContain("secret-value");
    expect(r.body?.issues?.[0]?.path).toBe("tenantId");
  });
});

describe("스키마 계약", () => {
  it("login: 빈/과대 입력 거부", () => {
    expect(loginSchema.safeParse({ tenantId: "", password: "x" }).success).toBe(
      false
    );
    expect(
      loginSchema.safeParse({ tenantId: "a".repeat(129), password: "x" })
        .success
    ).toBe(false);
    expect(
      loginSchema.safeParse({ tenantId: "BPN", password: "a".repeat(257) })
        .success
    ).toBe(false);
  });

  it("change-password: 신규 8자 미만 거부(비밀번호 정책)", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "old",
        newPassword: "short",
      }).success
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "old",
        newPassword: "long-enough-pass",
      }).success
    ).toBe(true);
  });

  it("connector create: 필수 3필드·env enum·roles 배열 강제, 부가 필드는 통과", () => {
    const base = {
      name: "c1",
      managementUrl: "https://edc.example.com/management",
      dspEndpoint: "https://edc.example.com/api/v1/dsp",
      env: "PROD",
    };
    expect(createConnectorSchema.safeParse(base).success).toBe(true);
    // 부가 메타(passthrough) 보존 — 기존 클라 페이로드 호환
    const withExtra = createConnectorSchema.safeParse({
      ...base,
      location: "Seoul",
    });
    expect(withExtra.success).toBe(true);
    if (withExtra.success)
      expect((withExtra.data as Record<string, unknown>)["location"]).toBe(
        "Seoul"
      );
    expect(
      createConnectorSchema.safeParse({ ...base, env: "QA" }).success
    ).toBe(false);
    expect(
      createConnectorSchema.safeParse({ ...base, roles: [1] }).success
    ).toBe(false);
    expect(
      createConnectorSchema.safeParse({ ...base, name: "   " }).success
    ).toBe(false);
  });

  it("test-connection: managementUrl 필수", () => {
    expect(testConnectionSchema.safeParse({}).success).toBe(false);
    expect(
      testConnectionSchema.safeParse({ managementUrl: "http://x" }).success
    ).toBe(true);
  });
});

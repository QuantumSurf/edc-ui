// OIDC 라우트 배선 통합테스트 — buildApp() 에 실제로 마운트됐는지, 활성/비활성
// 전환·authorize 302·state 쿠키를 supertest 로 검증한다. DB 불필요(/status·/login 은
// discovery fetch 만 필요) → testcontainers 없이 server 프로젝트(node)에서 돈다.
// discovery 는 로컬 목 http 서버로 대체한다.
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import request from "supertest";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import type { Express } from "express";

let mock: Server;
let issuer: string;

beforeAll(async () => {
  // Keycloak discovery 목.
  mock = createServer((req, res) => {
    if (req.url?.includes("/.well-known/openid-configuration")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`,
        })
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>(r => mock.listen(0, "127.0.0.1", r));
  const port = (mock.address() as AddressInfo).port;
  issuer = `http://127.0.0.1:${port}/realms/kmx`;
});

afterAll(async () => {
  await new Promise<void>(r => mock.close(() => r()));
});

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

/** OIDC env 를 세팅하고 fresh buildApp 을 만든다(모듈 캐시 리셋). */
async function appWithOidc(enabled: boolean): Promise<Express> {
  if (enabled) {
    vi.stubEnv("OIDC_ENABLED", "true");
    vi.stubEnv("OIDC_ISSUER_URL", issuer);
    vi.stubEnv("OIDC_CLIENT_ID", "kmx-console");
    vi.stubEnv("OIDC_CLIENT_SECRET", "s3cret");
    vi.stubEnv(
      "OIDC_REDIRECT_URL",
      "http://localhost:3005/api/auth/oidc/callback"
    );
  } else {
    vi.stubEnv("OIDC_ENABLED", "false");
  }
  const mod = await import("../app.js");
  return mod.buildApp();
}

describe("OIDC 라우트 배선", () => {
  it("비활성: status={enabled:false}, login/callback 은 503", async () => {
    const app = await appWithOidc(false);
    const st = await request(app).get("/api/auth/oidc/status");
    expect(st.status).toBe(200);
    expect(st.body).toEqual({ enabled: false });
    expect((await request(app).get("/api/auth/oidc/login")).status).toBe(503);
    expect((await request(app).get("/api/auth/oidc/callback")).status).toBe(
      503
    );
  });

  it("활성: status={enabled:true}", async () => {
    const app = await appWithOidc(true);
    const st = await request(app).get("/api/auth/oidc/status");
    expect(st.body).toEqual({ enabled: true });
  });

  it("활성 login → Keycloak authorize 로 302(PKCE S256+state+nonce) + state 쿠키", async () => {
    const app = await appWithOidc(true);
    const res = await request(app).get("/api/auth/oidc/login");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers["location"] as string);
    expect(loc.origin + loc.pathname).toBe(
      `${issuer}/protocol/openid-connect/auth`
    );
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("client_id")).toBe("kmx-console");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("code_challenge")).toBeTruthy();
    const state = loc.searchParams.get("state");
    expect(state).toBeTruthy();
    // 흐름 바인딩 쿠키(state/nonce/verifier)가 발급되고, authorize 의 state 와 일치해야.
    const setCookie = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    const stateCookie = setCookie.find(c => c.startsWith("kmx_oidc="));
    expect(stateCookie).toBeTruthy();
    expect(stateCookie).toMatch(/HttpOnly/i);
    expect(stateCookie).toMatch(/SameSite=Lax/i);
    expect(decodeURIComponent(stateCookie!)).toContain(`"state":"${state}"`);
  });

  it("콜백: state 쿠키 없이 오면 세션 없이 sso_error 로 302", async () => {
    const app = await appWithOidc(true);
    const res = await request(app).get(
      "/api/auth/oidc/callback?code=x&state=y"
    );
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toContain("sso_error=state-mismatch");
    // 인증 쿠키는 발급되지 않아야 한다.
    const setCookie = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    expect(setCookie.some(c => c.startsWith("kmx_token="))).toBe(false);
  });
});

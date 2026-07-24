// OIDC 코어 특성화 — 통합 담당자가 env 만 채우면 되도록, 순수 로직(클레임 매핑·
// PKCE·authorize URL·부팅 검증)의 계약을 테스트로 고정한다.
import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  claimByPath,
  mapRole,
  mapIdentity,
  buildAuthorizeUrl,
  generatePkce,
  assertOidcConfig,
  getOidcConfig,
  type OidcConfig,
} from "./oidc.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function cfg(over: Partial<OidcConfig> = {}): OidcConfig {
  return {
    enabled: true,
    issuerUrl: "https://kc.example.com/realms/kmx",
    clientId: "kmx-console",
    clientSecret: "s3cret",
    redirectUrl: "https://console.example.com/api/auth/oidc/callback",
    scopes: "openid profile email",
    bpnClaim: "bpn",
    roleClaim: "realm_access.roles",
    roleMap: {
      admin: "kmx-admin",
      operator: "kmx-operator",
      viewer: "kmx-viewer",
    },
    autoProvision: false,
    ...over,
  };
}

describe("claimByPath", () => {
  it("점 경로로 중첩 클레임을 꺼낸다(Keycloak realm_access.roles)", () => {
    const p = { realm_access: { roles: ["kmx-admin"] } };
    expect(claimByPath(p, "realm_access.roles")).toEqual(["kmx-admin"]);
    expect(claimByPath(p, "bpn")).toBeUndefined();
    expect(claimByPath(p, "realm_access.missing.deep")).toBeUndefined();
  });
});

describe("mapRole", () => {
  const map = cfg().roleMap;
  it("admin > operator > viewer 우선순위", () => {
    expect(mapRole(["kmx-viewer", "kmx-admin"], map)).toBe("admin");
    expect(mapRole(["kmx-operator", "kmx-viewer"], map)).toBe("operator");
    expect(mapRole(["kmx-viewer"], map)).toBe("viewer");
  });
  it("문자열 단일 클레임도 수용, 매핑 없음/비정상 형은 null(로그인 거부)", () => {
    expect(mapRole("kmx-operator", map)).toBe("operator");
    expect(mapRole(["unrelated"], map)).toBeNull();
    expect(mapRole(undefined, map)).toBeNull();
    expect(mapRole(42, map)).toBeNull();
  });
});

describe("mapIdentity", () => {
  const base = {
    email: "user@company.com",
    name: "홍길동",
    bpn: "BPNL000000000PRD",
    realm_access: { roles: ["kmx-operator"] },
  };
  it("정상 매핑", () => {
    const r = mapIdentity(base, cfg());
    expect(r).toEqual({
      ok: true,
      identity: {
        email: "user@company.com",
        name: "홍길동",
        bpn: "BPNL000000000PRD",
        role: "operator",
      },
    });
  });
  it("실패 코드 계약: no-email / no-bpn / no-role (클라 i18n 과 1:1)", () => {
    expect(mapIdentity({ ...base, email: undefined }, cfg())).toEqual({
      ok: false,
      error: "no-email",
    });
    expect(mapIdentity({ ...base, bpn: undefined }, cfg())).toEqual({
      ok: false,
      error: "no-bpn",
    });
    expect(
      mapIdentity({ ...base, realm_access: { roles: [] } }, cfg())
    ).toEqual({ ok: false, error: "no-role" });
  });
  it("email 없으면 preferred_username 폴백", () => {
    const r = mapIdentity(
      { ...base, email: undefined, preferred_username: "pref@company.com" },
      cfg()
    );
    expect(r.ok && r.identity.email).toBe("pref@company.com");
  });
});

describe("buildAuthorizeUrl / generatePkce", () => {
  it("표준 파라미터 전부 포함(code+PKCE S256+state+nonce)", () => {
    const u = new URL(
      buildAuthorizeUrl(
        "https://kc.example.com/realms/kmx/protocol/openid-connect/auth",
        cfg(),
        "STATE1",
        "NONCE1",
        "CHAL1"
      )
    );
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("kmx-console");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://console.example.com/api/auth/oidc/callback"
    );
    expect(u.searchParams.get("scope")).toBe("openid profile email");
    expect(u.searchParams.get("state")).toBe("STATE1");
    expect(u.searchParams.get("nonce")).toBe("NONCE1");
    expect(u.searchParams.get("code_challenge")).toBe("CHAL1");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("PKCE challenge = BASE64URL(SHA-256(verifier)) — RFC7636", () => {
    const { verifier, challenge } = generatePkce();
    const expected = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    expect(challenge).toBe(expected);
  });
});

describe("assertOidcConfig (부팅 fail-fast)", () => {
  it("비활성이면 통과", () => {
    vi.stubEnv("OIDC_ENABLED", "false");
    expect(() => assertOidcConfig()).not.toThrow();
  });
  it("활성인데 필수 env 누락이면 누락 목록과 함께 throw", () => {
    vi.stubEnv("OIDC_ENABLED", "true");
    vi.stubEnv("OIDC_ISSUER_URL", "https://kc.example.com/realms/kmx");
    // CLIENT_ID/SECRET/REDIRECT_URL 누락
    expect(() => assertOidcConfig()).toThrow(/OIDC_CLIENT_ID/);
  });
  it("활성 + 전부 설정이면 통과, issuer 뒤 슬래시는 정규화", () => {
    vi.stubEnv("OIDC_ENABLED", "true");
    vi.stubEnv("OIDC_ISSUER_URL", "https://kc.example.com/realms/kmx///");
    vi.stubEnv("OIDC_CLIENT_ID", "kmx-console");
    vi.stubEnv("OIDC_CLIENT_SECRET", "s");
    vi.stubEnv(
      "OIDC_REDIRECT_URL",
      "https://console.example.com/api/auth/oidc/callback"
    );
    expect(() => assertOidcConfig()).not.toThrow();
    expect(getOidcConfig().issuerUrl).toBe("https://kc.example.com/realms/kmx");
  });
});

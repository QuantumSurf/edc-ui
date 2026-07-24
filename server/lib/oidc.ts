// KMX EDC — OIDC(Keycloak) SSO 코어
//
// 회사 Keycloak 을 "로그인 단계"에만 붙인다(Authorization Code + PKCE, confidential
// client). 세션은 기존 인프라를 그대로 재사용한다 — ID 토큰 검증 후 로컬 사용자로
// 매핑해 signToken(kmx_token httpOnly 쿠키) + CSRF 를 발급하므로, RBAC·테넌트 격리·
// 감사·token_version 무효화·CSRF 방어가 전부 기존과 동일하게 동작한다.
//
// 통합 담당자는 코드 수정 없이 env 만 채우면 된다(docs/KEYCLOAK.md 참조):
//   OIDC_ENABLED=true
//   OIDC_ISSUER_URL=https://<keycloak>/realms/<realm>
//   OIDC_CLIENT_ID / OIDC_CLIENT_SECRET
//   OIDC_REDIRECT_URL=https://<console>/api/auth/oidc/callback
//   (선택) OIDC_SCOPES · OIDC_BPN_CLAIM · OIDC_ROLE_CLAIM · OIDC_ROLE_ADMIN/OPERATOR/VIEWER
//   (선택) OIDC_AUTO_PROVISION=true  — 매핑된 테넌트에 사용자가 없으면 자동 생성
//
// 보안 결정:
//  - PKCE(S256) + state + nonce 전부 사용. state/nonce/verifier 는 httpOnly·SameSite=Lax
//    단기 쿠키로 왕복한다(IdP → 콜백은 교차 사이트 최상위 GET 이라 Strict 는 미전송).
//  - ID 토큰은 discovery 의 JWKS 로 서명·iss·aud·exp 를 검증(jose), nonce 는 수동 대조.
//  - 역할은 IdP 가 소유(source of truth) — SSO 로그인 때마다 로컬 role 을 동기화한다.

import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Role } from "./auth.js";

/* ── 설정 ─────────────────────────────────────────────────────── */

export interface OidcConfig {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
  scopes: string;
  bpnClaim: string;
  roleClaim: string;
  roleMap: Record<Role, string>;
  autoProvision: boolean;
}

export function getOidcConfig(): OidcConfig {
  return {
    enabled: process.env.OIDC_ENABLED === "true",
    issuerUrl: (process.env.OIDC_ISSUER_URL ?? "").replace(/\/+$/, ""),
    clientId: process.env.OIDC_CLIENT_ID ?? "",
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
    redirectUrl: process.env.OIDC_REDIRECT_URL ?? "",
    scopes: process.env.OIDC_SCOPES ?? "openid profile email",
    // Keycloak 기본: 커스텀 클레임 bpn(클라이언트 스코프 매퍼로 주입),
    // 역할은 realm_access.roles 배열.
    bpnClaim: process.env.OIDC_BPN_CLAIM ?? "bpn",
    roleClaim: process.env.OIDC_ROLE_CLAIM ?? "realm_access.roles",
    roleMap: {
      admin: process.env.OIDC_ROLE_ADMIN ?? "kmx-admin",
      operator: process.env.OIDC_ROLE_OPERATOR ?? "kmx-operator",
      viewer: process.env.OIDC_ROLE_VIEWER ?? "kmx-viewer",
    },
    autoProvision: process.env.OIDC_AUTO_PROVISION === "true",
  };
}

/**
 * 부팅 시점 OIDC 구성 검증(fail-fast) — OIDC_ENABLED=true 인데 필수값이 비면
 * "떠 있지만 SSO 버튼이 500" 인 반쪽 배포가 되므로 부팅을 실패시킨다.
 * index.ts 가 assertAuthConfig 와 함께 호출한다.
 */
export function assertOidcConfig(): void {
  const c = getOidcConfig();
  if (!c.enabled) return;
  const missing: string[] = [];
  if (!c.issuerUrl) missing.push("OIDC_ISSUER_URL");
  if (!c.clientId) missing.push("OIDC_CLIENT_ID");
  if (!c.clientSecret) missing.push("OIDC_CLIENT_SECRET");
  if (!c.redirectUrl) missing.push("OIDC_REDIRECT_URL");
  if (missing.length) {
    throw new Error(
      `[OIDC] OIDC_ENABLED=true 인데 필수 env 누락: ${missing.join(", ")} — docs/KEYCLOAK.md 참조`
    );
  }
  try {
    new URL(c.issuerUrl);
    new URL(c.redirectUrl);
  } catch {
    throw new Error(
      "[OIDC] OIDC_ISSUER_URL / OIDC_REDIRECT_URL 은 완전한 URL 이어야 한다"
    );
  }
}

/* ── Discovery + JWKS (캐시) ───────────────────────────────────── */

interface DiscoveryDoc {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

const DISCOVERY_TTL_MS = 10 * 60_000;
let discoveryCache: { doc: DiscoveryDoc; expiresAt: number } | null = null;
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksCacheUri = "";

export async function getDiscovery(issuerUrl: string): Promise<DiscoveryDoc> {
  const now = Date.now();
  if (discoveryCache && discoveryCache.expiresAt > now)
    return discoveryCache.doc;
  const url = `${issuerUrl}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`[OIDC] discovery 실패: ${res.status} ${url}`);
  const doc = (await res.json()) as DiscoveryDoc;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error("[OIDC] discovery 문서에 필수 엔드포인트가 없다");
  }
  discoveryCache = { doc, expiresAt: now + DISCOVERY_TTL_MS };
  return doc;
}

function getJwks(jwksUri: string) {
  if (!jwksCache || jwksCacheUri !== jwksUri) {
    jwksCache = createRemoteJWKSet(new URL(jwksUri));
    jwksCacheUri = jwksUri;
  }
  return jwksCache;
}

/** 테스트/설정 변경용 캐시 초기화. */
export function resetOidcCaches(): void {
  discoveryCache = null;
  jwksCache = null;
  jwksCacheUri = "";
}

/* ── PKCE / state ─────────────────────────────────────────────── */

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export function randomToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** authorize URL 구성(순수 — 테스트 대상). */
export function buildAuthorizeUrl(
  authorizationEndpoint: string,
  c: OidcConfig,
  state: string,
  nonce: string,
  codeChallenge: string
): string {
  const u = new URL(authorizationEndpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", c.redirectUrl);
  u.searchParams.set("scope", c.scopes);
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

/* ── 토큰 교환 + ID 토큰 검증 ──────────────────────────────────── */

export async function exchangeCode(
  tokenEndpoint: string,
  c: OidcConfig,
  code: string,
  codeVerifier: string
): Promise<{ id_token?: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: c.redirectUrl,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code_verifier: codeVerifier,
  });
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    // 본문은 IdP 에러(invalid_grant 등) — 로그로만 남기고 상세는 노출하지 않는다.
    const text = await res.text().catch(() => "");
    console.error(
      `[OIDC] token 교환 실패 ${res.status}: ${text.slice(0, 300)}`
    );
    throw new Error("token-exchange-failed");
  }
  return (await res.json()) as { id_token?: string };
}

export async function verifyIdToken(
  idToken: string,
  doc: DiscoveryDoc,
  c: OidcConfig,
  expectedNonce: string
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, getJwks(doc.jwks_uri), {
    issuer: doc.issuer,
    audience: c.clientId,
  });
  if (payload.nonce !== expectedNonce) {
    throw new Error("nonce-mismatch");
  }
  return payload;
}

/* ── 클레임 매핑(순수 — 테스트 대상) ───────────────────────────── */

/** "realm_access.roles" 같은 점 경로로 클레임 값을 꺼낸다. */
export function claimByPath(payload: JWTPayload, path: string): unknown {
  let cur: unknown = payload;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * IdP 역할 → 로컬 역할. 배열/문자열 클레임 모두 수용, admin > operator > viewer
 * 우선순위. 매핑되는 역할이 하나도 없으면 null(로그인 거부 — 최소권한 기본).
 */
export function mapRole(
  claimValue: unknown,
  roleMap: Record<Role, string>
): Role | null {
  const values = Array.isArray(claimValue)
    ? claimValue.map(String)
    : typeof claimValue === "string"
      ? [claimValue]
      : [];
  const set = new Set(values);
  for (const role of ["admin", "operator", "viewer"] as const) {
    if (set.has(roleMap[role])) return role;
  }
  return null;
}

export interface MappedIdentity {
  email: string;
  name: string;
  bpn: string;
  role: Role;
}

/**
 * ID 토큰 페이로드 → 로컬 신원. 실패 사유를 코드로 돌려준다(콜백이 sso_error 로 전달).
 *  - no-email: email/preferred_username 부재
 *  - no-bpn: BPN 클레임 부재(테넌트 매핑 불가)
 *  - no-role: 매핑되는 역할 없음
 */
export function mapIdentity(
  payload: JWTPayload,
  c: OidcConfig
): { ok: true; identity: MappedIdentity } | { ok: false; error: string } {
  const email = String(
    payload.email ?? payload.preferred_username ?? ""
  ).trim();
  if (!email) return { ok: false, error: "no-email" };
  const bpnRaw = claimByPath(payload, c.bpnClaim);
  const bpn = typeof bpnRaw === "string" ? bpnRaw.trim() : "";
  if (!bpn) return { ok: false, error: "no-bpn" };
  const role = mapRole(claimByPath(payload, c.roleClaim), c.roleMap);
  if (!role) return { ok: false, error: "no-role" };
  const name = String(payload.name ?? payload.given_name ?? email).trim();
  return { ok: true, identity: { email, name, bpn, role } };
}

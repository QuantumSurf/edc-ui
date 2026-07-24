// KMX EDC — OIDC(Keycloak) SSO 라우트
//
//   GET /api/auth/oidc/status   — { enabled } (무인증; 로그인 화면이 SSO 버튼 노출 판단)
//   GET /api/auth/oidc/login    — IdP authorize 로 302 (state/nonce/PKCE 쿠키 발급)
//   GET /api/auth/oidc/callback — code 교환 → ID 토큰 검증 → 로컬 세션 발급 → "/" 로 302
//
// 실패는 전부 `/?sso_error=<code>` 리다이렉트로 수렴한다(콜백은 최상위 네비게이션이라
// JSON 을 돌려줄 수 없다) — 코드 목록은 client PageLogin 의 i18n 과 계약.
// 세션 발급은 비밀번호 로그인과 동일 경로(signToken + setAuthCookies)라 RBAC·격리·
// 감사·token_version 무효화가 전부 기존과 동일하게 적용된다.

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import crypto from "node:crypto";
import { getPool } from "../lib/db.js";
import { signToken, hashPassword } from "../lib/auth.js";
import { setAuthCookies, generateCsrfToken } from "../lib/cookies.js";
import { recordAudit } from "../lib/audit.js";
import {
  getOidcConfig,
  getDiscovery,
  generatePkce,
  randomToken,
  buildAuthorizeUrl,
  exchangeCode,
  verifyIdToken,
  mapIdentity,
} from "../lib/oidc.js";

const router = Router();

/* ── state 쿠키(단기, 흐름 바인딩) ──────────────────────────────
 * IdP → 콜백은 교차 사이트 최상위 GET 이라 SameSite=Strict 쿠키는 전송되지 않는다
 * → Lax 필수. httpOnly 로 JS 접근 차단, path 를 콜백 경로대로 좁혀 노출 최소화. */
const STATE_COOKIE = "kmx_oidc";
const STATE_TTL_MS = 10 * 60_000;

interface OidcState {
  state: string;
  nonce: string;
  verifier: string;
}

function setStateCookie(res: Response, s: OidcState): void {
  res.cookie(STATE_COOKIE, JSON.stringify(s), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/oidc",
    maxAge: STATE_TTL_MS,
  });
}

function readStateCookie(req: Request): OidcState | null {
  const raw = req.headers.cookie
    ?.split(";")
    .map(p => p.trim())
    .find(p => p.startsWith(`${STATE_COOKIE}=`));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      decodeURIComponent(raw.slice(STATE_COOKIE.length + 1))
    ) as Partial<OidcState>;
    if (parsed.state && parsed.nonce && parsed.verifier)
      return parsed as OidcState;
  } catch {
    /* 손상 쿠키 — 무시 */
  }
  return null;
}

function clearStateCookie(res: Response): void {
  res.clearCookie(STATE_COOKIE, { path: "/api/auth/oidc" });
}

function fail(res: Response, code: string): void {
  clearStateCookie(res);
  res.redirect(`/?sso_error=${encodeURIComponent(code)}`);
}

/* ── 라우트 ───────────────────────────────────────────────────── */

// 무인증 — 로그인 화면이 SSO 버튼을 보여줄지 판단하는 유일한 신호.
router.get("/status", (_req: Request, res: Response) => {
  res.json({ enabled: getOidcConfig().enabled });
});

router.get(
  "/login",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const c = getOidcConfig();
      if (!c.enabled) {
        res.status(503).json({ error: "oidc-disabled" });
        return;
      }
      const doc = await getDiscovery(c.issuerUrl);
      const { verifier, challenge } = generatePkce();
      const state = randomToken();
      const nonce = randomToken();
      setStateCookie(res, { state, nonce, verifier });
      res.redirect(
        buildAuthorizeUrl(
          doc.authorization_endpoint,
          c,
          state,
          nonce,
          challenge
        )
      );
    } catch (err) {
      next(err);
    }
  }
);

router.get("/callback", async (req: Request, res: Response) => {
  const c = getOidcConfig();
  if (!c.enabled) {
    res.status(503).json({ error: "oidc-disabled" });
    return;
  }
  // IdP 가 에러로 돌아온 경우(사용자 취소 등)
  if (typeof req.query.error === "string") {
    console.warn(`[OIDC] IdP error: ${req.query.error}`);
    fail(res, "idp-error");
    return;
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const saved = readStateCookie(req);
  // state 불일치 = CSRF/재사용/만료 — 어떤 경우든 세션을 만들지 않는다.
  if (!code || !saved || !state || state !== saved.state) {
    fail(res, "state-mismatch");
    return;
  }

  try {
    const doc = await getDiscovery(c.issuerUrl);
    const tokens = await exchangeCode(
      doc.token_endpoint,
      c,
      code,
      saved.verifier
    );
    if (!tokens.id_token) {
      fail(res, "no-id-token");
      return;
    }
    const payload = await verifyIdToken(tokens.id_token, doc, c, saved.nonce);
    const mapped = mapIdentity(payload, c);
    if (!mapped.ok) {
      fail(res, mapped.error);
      return;
    }
    const { email, name, bpn, role } = mapped.identity;

    // 테넌트: BPN 매핑, 아카이브 제외(비밀번호 로그인과 동일 불변식).
    const { rows: tenants } = await getPool().query<{
      id: string;
      name: string;
      bpn: string;
    }>(
      `SELECT id, name, bpn FROM tenants WHERE bpn = $1 AND archived_at IS NULL`,
      [bpn]
    );
    const tenant = tenants[0];
    if (!tenant) {
      fail(res, "unknown-tenant");
      return;
    }

    // 사용자: email 전역 유일. 있으면 IdP 를 정본으로 role/name 동기화, 없으면
    // OIDC_AUTO_PROVISION=true 일 때만 생성(비밀번호 로그인 불가능한 랜덤 해시).
    const { rows: users } = await getPool().query<{
      id: string;
      tenant_id: string | null;
      token_version: number | null;
    }>(`SELECT id, tenant_id, token_version FROM users WHERE email = $1`, [
      email,
    ]);
    let userId: string;
    let tokenVersion: number;
    if (users.length > 0) {
      const u = users[0];
      // 같은 이메일이 다른 테넌트 소속이면 거부 — 테넌트 격리 불변식 보호.
      if (u.tenant_id && u.tenant_id !== tenant.id) {
        fail(res, "tenant-mismatch");
        return;
      }
      await getPool().query(
        `UPDATE users SET role = $1, name = $2, tenant_id = $3, updated_at = NOW() WHERE id = $4`,
        [role, name, tenant.id, u.id]
      );
      userId = u.id;
      tokenVersion = u.token_version ?? 0;
    } else if (c.autoProvision) {
      userId = crypto.randomUUID();
      // SSO 전용 사용자 — password_hash 는 NOT NULL 이라 로그인 불가능한 랜덤 값으로 채운다.
      const unusable = await hashPassword(
        crypto.randomBytes(48).toString("base64url")
      );
      await getPool().query(
        `INSERT INTO users (id, email, name, role, password_hash, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, email, name, role, unusable, tenant.id]
      );
      tokenVersion = 0;
    } else {
      fail(res, "user-not-provisioned");
      return;
    }

    void recordAudit({
      tenantId: tenant.id,
      actorId: userId,
      actorEmail: email,
      actorRole: role,
      action: "auth.login",
      category: "AUTH",
      target: email,
      targetType: "User",
      result: "SUCCESS",
      ip: req.ip ?? null,
      userAgent: (req.headers["user-agent"] as string) ?? null,
      method: "GET",
      path: "/api/auth/oidc/callback",
      message: "Login (Keycloak SSO)",
    });

    const token = signToken({
      id: userId,
      email,
      role,
      name,
      tenantId: tenant.id,
      tv: tokenVersion,
    });
    clearStateCookie(res);
    setAuthCookies(res, token, generateCsrfToken());
    res.redirect("/");
  } catch (err) {
    // 검증 실패(서명/iss/aud/nonce)·IdP 미도달 등 — 상세는 로그로만.
    console.error(
      `[OIDC] callback 실패: ${err instanceof Error ? err.message : err}`
    );
    fail(res, "verify-failed");
  }
});

export default router;

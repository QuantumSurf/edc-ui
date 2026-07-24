// KMX EDC — Authentication helpers
// bcrypt password hashing + JWT signing/verification

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export type Role = "admin" | "operator" | "viewer";

export interface TokenPayload {
  id: string;
  email: string;
  role: Role;
  name?: string;
  /** Tenant (organization) the user belongs to. Drives data isolation. */
  tenantId?: string;
  /** Token version — users.token_version 과 대조해 로그아웃/강제차단 시 토큰을 무효화한다. */
  tv?: number;
}

// Dev에서도 매 시작마다 다른 random secret 생성 (이전: 고정 dev secret → 위험)
// JWT_SECRET env가 32+ chars면 우선 사용, 아니면 random 생성. Production에서는 강제.
const MIN_SECRET_LENGTH = 32;
let cachedDevSecret: string | null = null;

// 공개 저장소(docker-compose 등)에 박힌 dev/데모 기본 JWT_SECRET 목록. prod 에서 이 값으로
// 부팅하면 누구나 이 공개 비밀로 admin 토큰을 위조해 인증을 완전 우회할 수 있다(CWE-798).
// 길이 검사(32자)만으로는 막지 못하므로 명시적으로 거부한다.
const KNOWN_WEAK_SECRETS = new Set([
  "dev-local-secret-change-me-please-32chars",
]);

function generateRandomSecret(): string {
  // crypto.randomBytes via Node 'crypto' (Node 18+ : globalThis.crypto.getRandomValues)
  const arr = new Uint8Array(48);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: Crypto = (globalThis as any).crypto;
  c.getRandomValues(arr);
  return Buffer.from(arr).toString("base64url");
}

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  // prod 에서 알려진 공개 기본값이면 길이와 무관하게 부팅 거부(fail-closed).
  if (process.env.NODE_ENV === "production" && s && KNOWN_WEAK_SECRETS.has(s)) {
    throw new Error(
      "[AUTH] JWT_SECRET is a known public default value — set a unique secret in production"
    );
  }
  if (s && s.length >= MIN_SECRET_LENGTH) return s;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `[AUTH] JWT_SECRET env var must be set (>=${MIN_SECRET_LENGTH} chars) in production`
    );
  }
  if (s && s.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `[AUTH] JWT_SECRET too short (${s.length} chars). Minimum is ${MIN_SECRET_LENGTH}.`
    );
  }

  // dev 폴백: 프로세스 수명 동안만 유효한 random secret 사용 (재시작 시 모든 토큰 무효화)
  if (!cachedDevSecret) {
    cachedDevSecret = generateRandomSecret();
    console.warn(
      `[AUTH] WARNING: JWT_SECRET not set — using ephemeral random dev secret (tokens invalidated on restart).`
    );
  }
  return cachedDevSecret;
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "12h";

/**
 * 부팅 시점 인증 구성 검증(fail-fast). getJwtSecret 은 원래 첫 토큰 서명/검증 시점에야
 * 평가돼, prod 에서 JWT_SECRET 미설정/약한 값이면 "헬시하게 떠 있지만 모든 로그인이
 * 500" 인 좀비 파드가 됐다. 부팅 직후 한 번 호출해 구성 오류를 부팅 실패로 앞당긴다.
 * (dev 는 임시 랜덤 시크릿 생성 경고가 여기서 한 번 출력될 뿐 동작 동일.)
 */
export function assertAuthConfig(): void {
  getJwtSecret();
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// 로그인 타이밍 사이드채널 완화: 존재하지 않는 테넌트/사용자도 실제 비교와 동일한
// bcrypt 비용을 소모하게 해, 응답 시간으로 유효 BPN을 열거하지 못하도록 한다.
const DUMMY_HASH = bcrypt.hashSync("timing-attack-mitigation-dummy", 10);
export async function dummyVerify(plain: string): Promise<void> {
  try {
    await bcrypt.compare(plain, DUMMY_HASH);
  } catch {
    /* ignore */
  }
}

export function signToken(payload: TokenPayload): string {
  // 알고리즘을 HS256으로 명시 고정 — 라이브러리 기본 허용 집합 변화나 향후 비대칭 키 도입 시에도
  // none/혼동(confusion) 공격으로 HS256 외 토큰이 검증 통과하는 회귀를 원천 차단(defense-in-depth).
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: "HS256",
  } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  // verify도 HS256만 허용 — alg=none 또는 비대칭 혼동 공격 방어.
  const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] });
  if (typeof decoded === "string") throw new Error("Invalid token payload");
  const { id, email, role, name, tenantId, tv } = decoded as jwt.JwtPayload &
    Partial<TokenPayload>;
  if (!id || !email || !role) throw new Error("Incomplete token payload");
  return { id, email, role: role as Role, name, tenantId, tv };
}

// KMX EDC — Lightweight in-memory IP rate limiter (no external deps).
// 분산 배포에서는 Redis 기반으로 교체 권장 (현재 단일 BFF 인스턴스 가정).

import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number; // sliding window 길이 (ms)
  max: number; // 윈도우 내 최대 요청 수
  keyFn?: (req: Request) => string;
  message?: string;
}

export function rateLimit(opts: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  const keyFn =
    opts.keyFn ??
    ((req: Request) => req.ip ?? req.socket.remoteAddress ?? "unknown");

  // 메모리 누수 방지 — 1분마다 만료 bucket 정리
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, 60_000).unref();

  return function rateLimitMw(req: Request, res: Response, next: NextFunction) {
    const key = keyFn(req);
    const now = Date.now();
    const b = buckets.get(key);

    if (!b || b.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }

    if (b.count >= opts.max) {
      const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "rate-limited",
        message: opts.message ?? "Too many requests",
        retryAfterSeconds: retryAfter,
      });
      return;
    }

    b.count += 1;
    next();
  };
}

/** Login용 사전 정의: (IP + 대상계정)당 15분에 시도 허용 횟수.
 *  프로덕션은 10(무차별 대입 방어). dev/로컬은 관리자·이용자 화면을 자주 오가며 재로그인
 *  하므로 100으로 완화(단일 IP 버킷 공유로 쉽게 막히던 것 방지). LOGIN_RATE_MAX 로 override. */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: envPositiveInt(
    "LOGIN_RATE_MAX",
    process.env.NODE_ENV === "production" ? 10 : 100
  ),
  message: "Too many login attempts. Try again in 15 minutes.",
  // IP 단독 키는 역방향 프록시 뒤에서 req.ip가 프록시 단일 IP로 붕괴하면 전역 단일 버킷이 되어,
  // 미인증 공격자가 소수 요청으로 플랫폼 전체 로그인을 잠글 수 있다(DoS). IP+대상계정(tenantId/BPN)
  // 으로 키를 이중화해 IP가 붕괴해도 계정별 분리 버킷이 되게 한다(전역 잠금 방지). 근본 해결은
  // TRUST_PROXY 설정으로 req.ip를 실제 클라 IP로 복원하는 것.
  keyFn: req => {
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const account = String((req.body as { tenantId?: unknown })?.tenantId ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 128);
    return `${ip}:${account}`;
  },
});

/**
 * 양의 정수 환경변수만 채택. 0·음수·비정수·빈값은 전부 기본값으로 되돌린다 —
 * 오타 하나로 DoS 방어가 사실상 꺼지는 일이 없게 하기 위함이다.
 */
function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * API 일반: IP당 1분에 300번. dev 친화적, 단순 DoS 차단 용도.
 * 한도는 배포 환경마다 다르므로 env 로 조정한다(기본값은 그대로 300).
 * 부하 테스트처럼 단일 IP 에서 의도적으로 고부하를 넣는 경우에만 올릴 것 —
 * 한도를 넘긴 요청이 429 로 잘리면 앱 경로 지연이 아니라 레이트리밋을 재게 된다.
 */
export const apiRateLimit = rateLimit({
  windowMs: envPositiveInt("API_RATE_LIMIT_WINDOW_MS", 60_000),
  max: envPositiveInt("API_RATE_LIMIT_MAX", 300),
});

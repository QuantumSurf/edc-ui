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

/** Login용 사전 정의: IP당 15분에 10번 시도 허용. */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  message: "Too many login attempts. Try again in 15 minutes.",
});

/** API 일반: IP당 1분에 300번. dev 친화적, 단순 DoS 차단 용도. */
export const apiRateLimit = rateLimit({
  windowMs: 60_000,
  max: 300,
});

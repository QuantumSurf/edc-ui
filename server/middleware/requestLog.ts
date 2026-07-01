// KMX EDC — 요청별 상관 ID + 완료 로그(구조화 JSON)
// 인그레스가 넘긴 X-Request-Id 를 존중(없으면 생성)하고 응답 헤더로 에코한다. 요청 완료 시
// {reqId, tenantId, userId, method, path, status, ms} 를 한 줄 JSON 으로 남겨, 멀티테넌트
// 단일 서버에서 특정 고객 요청을 로그로 추적·grep 할 수 있게 한다.

import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      reqId?: string;
    }
  }
}

export function requestLog(req: Request, res: Response, next: NextFunction) {
  const inbound = req.headers["x-request-id"];
  const reqId =
    (typeof inbound === "string" && inbound.length > 0
      ? inbound.slice(0, 64)
      : "") || crypto.randomUUID();
  req.reqId = reqId;
  res.setHeader("X-Request-Id", reqId);

  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    const status = res.statusCode;
    const line = JSON.stringify({
      t: new Date().toISOString(),
      lvl: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      msg: "http",
      reqId,
      // req.user 는 auth 미들웨어가 채운 뒤(finish 시점) 읽으므로 인증 요청은 테넌트가 찍힌다.
      tenantId: req.user?.tenantId ?? null,
      userId: req.user?.id ?? null,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status,
      ms,
    });
    if (status >= 500) console.error(line);
    else console.log(line);
  });

  next();
}

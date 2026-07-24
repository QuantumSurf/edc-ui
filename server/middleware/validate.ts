// KMX EDC — zod 기반 요청 입력 검증 게이트
// 라우트별로 흩어진 수기 검증(typeof·length 체크)을 스키마 한 곳으로 모아, 핸들러가
// 신뢰된 형(shape)만 다루게 한다. 실패는 일관된 400 {error:"validation", issues} 로 응답한다.
import type { Request, Response, NextFunction } from "express";
import type { ZodType, ZodError } from "zod";

/** zod 이슈를 안정적인 400 응답 형태로 축약한다(원본 입력값·내부 스택 미노출). */
function toIssues(error: ZodError) {
  return error.issues.map(i => ({
    path: i.path.map(String).join(".") || "(root)",
    message: i.message,
  }));
}

/**
 * 요청 본문(req.body)을 zod 스키마로 검증하는 게이트.
 * 실패 → 400 {error:"validation", issues:[{path,message}]}.
 * 성공 → 파싱·정규화된 값으로 req.body 를 치환(핸들러는 검증된 형만 다룬다).
 */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res
        .status(400)
        .json({ error: "validation", issues: toIssues(result.error) });
      return;
    }
    req.body = result.data;
    next();
  };
}

// KMX EDC — 인증 라우트 입력 스키마(zod). auth 라우트의 수기 검증을 대체한다.
import { z } from "zod";

const MAX_TENANT_LEN = 128; // tenant id(BPN) 입력 한도(auth 라우트 상수와 일치)
const MAX_PASSWORD_LEN = 256; // bcrypt 입력 한도(72바이트 truncation 고려한 상한)

// POST /auth/login — tenantId(BPN) + password.
// 공백 trim 후 '비어있음' 검사는 라우트가 담당한다(BPN=테넌트 식별자 불변식).
export const loginSchema = z.object({
  tenantId: z.string().min(1).max(MAX_TENANT_LEN),
  password: z.string().min(1).max(MAX_PASSWORD_LEN),
});

// POST /auth/change-password — 현재/신규 비밀번호. 신규는 최소 8자(비밀번호 정책).
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LEN),
  newPassword: z.string().min(8).max(MAX_PASSWORD_LEN),
});

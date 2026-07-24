// KMX EDC — 커넥터 라우트 입력 스키마(zod).
// SSRF 검증(사설/메타데이터 대역 차단)은 스키마가 아니라 라우트가 담당한다
// (assertEndpointPublic — DNS 해석 포함, 비동기라 미들웨어 체인 밖).
import { z } from "zod";

/** 공백만 있는 문자열을 거부하는 필수 문자열. */
const requiredString = z
  .string()
  .min(1)
  .refine(s => s.trim().length > 0, "must not be blank");

// POST /connectors — 커넥터 등록. 시스템이 실제로 소비하는 필드만 형을 강제하고,
// 나머지(location·description 등 부가 메타)는 passthrough 로 보존한다 — 기존
// 클라이언트 페이로드와의 호환을 깨지 않기 위함(과잉 스키마화 금지).
export const createConnectorSchema = z
  .object({
    name: requiredString,
    managementUrl: requiredString,
    dspEndpoint: requiredString,
    env: z.enum(["PROD", "STG", "DEV"]),
    // roles 미전송/null 은 빈 배열로 정규화 — DB 컬럼이 NOT NULL 이라, 정규화 없이는
    // 입력 누락이 400 이 아닌 500(제약 위반)으로 샜다(잠복 결함 — E2E 테스트로 발견).
    roles: z
      .array(z.string())
      .nullish()
      .transform(v => v ?? []),
    // DCP 버전 — DB NOT NULL. 클라 폼 기본값("1.0")과 동일하게 정규화해, 누락이
    // 500(제약 위반)으로 새지 않게 한다(roles 와 같은 잠복 결함군).
    dcpVersion: z
      .string()
      .nullish()
      .transform(v => (v && v.trim() ? v : "1.0")),
    apiKey: z.string().optional(),
  })
  .passthrough();

// PUT /connectors/:id — 부분 갱신. 주어진 필드만 형 검증(전부 선택).
// bpn/tenantId/id 는 라우트가 서버측에서 재강제하므로 스키마에서 다루지 않는다.
export const updateConnectorSchema = z
  .object({
    name: requiredString.optional(),
    managementUrl: requiredString.optional(),
    dspEndpoint: requiredString.optional(),
    env: z.enum(["PROD", "STG", "DEV"]).optional(),
    roles: z.array(z.string()).optional().nullable(),
    apiKey: z.string().optional(),
  })
  .passthrough();

// POST /connectors/test-connection — 등록 전 연결 테스트. managementUrl 필수.
export const testConnectionSchema = z
  .object({
    managementUrl: requiredString,
    apiKey: z.string().optional(),
  })
  .passthrough();

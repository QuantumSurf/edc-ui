// KMX EDC — 설정 라우트 입력 스키마(zod).
import { z } from "zod";

// PUT /system/settings/notifications — 알림 source 토글(부분 갱신).
// 키는 클라 표시 필터(useNotifications SOURCE_PREF)와 동일 계약.
export const notifyPrefsSchema = z
  .object({
    "notify.vcExpiry": z.boolean().optional(),
    "notify.negTerminated": z.boolean().optional(),
    "notify.transferFailed": z.boolean().optional(),
    "notify.edrExpiry": z.boolean().optional(),
    "notify.connectorHealth": z.boolean().optional(),
  })
  .strict(); // 미지 키 거부 — tenant_settings 네임스페이스 오염 방지

// KMX EDC — IdentityHub connection config (per-tenant).
// Hybrid source: per-tenant settings (tenant_settings, editable via the Settings
// UI) take precedence, with environment variables as the per-environment baseline.

import { getTenant, getTenantSettings } from "./tenants.js";
import { readVaultSecret } from "./platform.js";

const URL_ENV = process.env.IDENTITY_HUB_URL ?? "";
const PARTICIPANT_ENV = process.env.IDENTITY_HUB_PARTICIPANT_ID ?? "";
const API_KEY_ENV = process.env.IDENTITY_HUB_API_KEY ?? "";

export const IDENTITY_HUB_KEYS = [
  "identity_hub_url",
  "identity_hub_participant_id",
  "identity_hub_api_key", // legacy plaintext (deprecated, read-only fallback)
  "identity_hub_api_key_alias", // platform-vault alias holding the actual key value
];

/**
 * IH 관리 API 키의 platform-vault 별칭 — 불변 식별자 tenantId 로 네임스페이스한다.
 * BPN(로그인 식별자)은 가변이라 반납·재사용 시 두 테넌트가 같은 `ih-apikey-{bpn}` 별칭을
 * 공유/덮어쓸 수 있다(교차테넌트 시크릿 read/write, CWE-639). tenantId 는 변하지 않고
 * 유일하므로 그런 위험이 없다. 레거시 `ih-apikey-{bpn}` 별칭은 읽기 폴백으로만 지원한다.
 */
export function ihApiKeyAlias(tenantId: string): string {
  return `ih-apikey-${tenantId}`;
}

export interface IdentityHubConfig {
  url: string;
  participantId: string;
  apiKey: string;
}

export async function getIdentityHubConfig(
  tenantId?: string
): Promise<IdentityHubConfig> {
  try {
    const m = tenantId
      ? await getTenantSettings(tenantId, IDENTITY_HUB_KEYS)
      : {};
    // apiKey 해석 우선순위:
    //   ① tenant_settings 에 기록된 vault alias(정본) → platform-vault read
    //   ② 불변 tenantId 기반 별칭 ih-apikey-{tenantId} (신규 표준)
    //   ③ 레거시 BPN 기반 별칭 ih-apikey-{BPN} (마이그레이션 전 데이터 호환, 읽기 전용)
    //   ④ 레거시 평문 identity_hub_api_key  ⑤ env
    let apiKey = "";
    if (m.identity_hub_api_key_alias) {
      try {
        apiKey = await readVaultSecret(m.identity_hub_api_key_alias);
      } catch {
        apiKey = ""; // vault 해석 실패 → 하위 단계로 폴백
      }
    }
    if (!apiKey && tenantId) {
      try {
        apiKey = await readVaultSecret(ihApiKeyAlias(tenantId));
      } catch {
        apiKey = "";
      }
    }
    if (!apiKey && tenantId) {
      try {
        const tenant = await getTenant(tenantId);
        if (tenant?.bpn)
          apiKey = await readVaultSecret(`ih-apikey-${tenant.bpn}`);
      } catch {
        apiKey = "";
      }
    }
    if (!apiKey) apiKey = m.identity_hub_api_key || API_KEY_ENV;
    return {
      url: m.identity_hub_url || URL_ENV,
      participantId: m.identity_hub_participant_id || PARTICIPANT_ENV,
      apiKey,
    };
  } catch {
    // tenant_settings unavailable (e.g. DB not ready) — fall back to env.
    return {
      url: URL_ENV,
      participantId: PARTICIPANT_ENV,
      apiKey: API_KEY_ENV,
    };
  }
}

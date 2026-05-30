// KMX EDC — IdentityHub connection config (per-tenant).
// Hybrid source: per-tenant settings (tenant_settings, editable via the Settings
// UI) take precedence, with environment variables as the per-environment baseline.

import { getTenantSettings } from "./tenants.js";
import { readVaultSecret } from "./platform.js";

const URL_ENV = process.env.IDENTITY_HUB_URL ?? "";
const PARTICIPANT_ENV = process.env.IDENTITY_HUB_PARTICIPANT_ID ?? "";
const API_KEY_ENV = process.env.IDENTITY_HUB_API_KEY ?? "";

export const IDENTITY_HUB_KEYS = [
  "identity_hub_url",
  "identity_hub_participant_id",
  "identity_hub_api_key",        // legacy plaintext (deprecated, read-only fallback)
  "identity_hub_api_key_alias",  // platform-vault alias holding the actual key value
];

export interface IdentityHubConfig {
  url: string;
  participantId: string;
  apiKey: string;
}

export async function getIdentityHubConfig(tenantId?: string): Promise<IdentityHubConfig> {
  try {
    const m = tenantId ? await getTenantSettings(tenantId, IDENTITY_HUB_KEYS) : {};
    // apiKey 해석 우선순위: ① vault alias 참조 → platform-vault read
    //                       ② 레거시 평문 identity_hub_api_key  ③ env
    let apiKey = "";
    if (m.identity_hub_api_key_alias) {
      try {
        apiKey = await readVaultSecret(m.identity_hub_api_key_alias);
      } catch {
        apiKey = ""; // vault 해석 실패 → 하위 단계로 폴백
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
    return { url: URL_ENV, participantId: PARTICIPANT_ENV, apiKey: API_KEY_ENV };
  }
}

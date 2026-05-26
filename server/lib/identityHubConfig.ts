// KMX EDC — IdentityHub connection config.
// Hybrid source: app_settings (configurable via the Settings UI) takes
// precedence, with environment variables as the per-environment baseline.

import { getPool } from "./db.js";

const URL_ENV = process.env.IDENTITY_HUB_URL ?? "";
const PARTICIPANT_ENV = process.env.IDENTITY_HUB_PARTICIPANT_ID ?? "";
const API_KEY_ENV = process.env.IDENTITY_HUB_API_KEY ?? "";

export interface IdentityHubConfig {
  url: string;
  participantId: string;
  apiKey: string;
}

export async function getIdentityHubConfig(): Promise<IdentityHubConfig> {
  try {
    const { rows } = await getPool().query<{ key: string; value: string }>(
      `SELECT key, value FROM app_settings
       WHERE key IN ('identity_hub_url', 'identity_hub_participant_id', 'identity_hub_api_key')`,
    );
    const m: Record<string, string> = {};
    for (const r of rows) m[r.key] = (r.value ?? "").trim();
    return {
      url: m.identity_hub_url || URL_ENV,
      participantId: m.identity_hub_participant_id || PARTICIPANT_ENV,
      apiKey: m.identity_hub_api_key || API_KEY_ENV,
    };
  } catch {
    // app_settings unavailable (e.g. DB not ready) — fall back to env.
    return { url: URL_ENV, participantId: PARTICIPANT_ENV, apiKey: API_KEY_ENV };
  }
}

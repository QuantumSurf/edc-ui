// KMX EDC — BFF API service layer
// Calls the Express BFF proxy for EDC Management API

import axios from "axios";
import { toast } from "sonner";
import type {
  Connector,
  Asset,
  Policy,
  Offering,
  Negotiation,
  Transfer,
  EDR,
  EDRStats,
  CatalogOffer,
  ShellDescriptor,
  SubmodelDescriptor,
  SpecificAssetId,
  SemanticModel,
  SemanticModelSummary,
} from "@/lib/data";

const http = axios.create({ baseURL: "/api", timeout: 15_000 });

// Attach auth token from session storage to every request
http.interceptors.request.use(config => {
  try {
    const stored = sessionStorage.getItem("kmx-edc-auth");
    if (stored) {
      const { token } = JSON.parse(stored);
      if (token) config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    /* ignore */
  }
  return config;
});

// Translate 401/403 into user-visible toasts. Reads i18n lang from localStorage
// so we don't need React context here.
http.interceptors.response.use(
  res => res,
  error => {
    const status = error?.response?.status;
    if (status === 403 || status === 401) {
      const lang =
        (typeof localStorage !== "undefined" &&
          localStorage.getItem("locale")) ||
        "ko";
      const msg =
        status === 403
          ? lang === "ko"
            ? "이 작업을 수행할 권한이 없습니다."
            : "You are not allowed to perform this action."
          : lang === "ko"
            ? "인증이 필요합니다. 다시 로그인해 주세요."
            : "Authentication required. Please sign in again.";
      try {
        toast.error(msg);
      } catch {
        /* toaster not mounted */
      }
    }
    return Promise.reject(error);
  }
);

/* ── Fleet / Connectors ──────────────────────────────────────── */
export async function fetchConnectors(): Promise<Connector[]> {
  const { data } = await http.get("/connectors");
  return data;
}

export async function fetchHealthCheck(connectorId: string) {
  const { data } = await http.get(`/connectors/${connectorId}/health`);
  return data;
}

export async function testConnection(managementUrl: string, apiKey?: string) {
  const { data } = await http.post("/connectors/test-connection", {
    managementUrl,
    apiKey,
  });
  return data as { status: "ok" | "fail"; detail: unknown };
}

export async function registerConnector(entry: {
  name: string;
  bpn: string;
  managementUrl: string;
  dspEndpoint: string;
  apiKey?: string;
  env: string;
  roles: string[];
  dcpVersion: string;
  did?: string;
  identityHubUrl?: string;
}) {
  const { data } = await http.post("/connectors", entry);
  return data;
}

export async function updateConnector(
  id: string,
  entry: {
    name?: string;
    bpn?: string;
    managementUrl?: string;
    dspEndpoint?: string;
    apiKey?: string;
    env?: string;
    roles?: string[];
    dcpVersion?: string;
    did?: string;
    identityHubUrl?: string;
  }
) {
  const { data } = await http.put(`/connectors/${id}`, entry);
  return data;
}

export async function deleteConnector(id: string): Promise<void> {
  await http.delete(`/connectors/${id}`);
}

export interface FleetKPI {
  totalConnectors: number;
  up: number;
  warn: number;
  down: number;
  totalAssets: number;
  totalOffers: number;
  totalNegotiations: number;
  totalTransfers: number;
  vcWarnings: number;
}

export async function fetchFleetKPI(): Promise<FleetKPI> {
  const { data } = await http.get("/fleet/kpi");
  return data;
}

/* ── Assets ──────────────────────────────────────────────────── */
export async function fetchAssets(connectorId: string): Promise<Asset[]> {
  const { data } = await http.post(`/connectors/${connectorId}/assets`, {});
  return data;
}

export async function fetchAssetById(
  id: string,
  connectorId: string
): Promise<Asset | null> {
  try {
    const { data } = await http.get(`/connectors/${connectorId}/assets/${id}`);
    return data;
  } catch {
    return null;
  }
}

export async function createAsset(
  asset: Partial<Asset> & Record<string, unknown>,
  connectorId: string
): Promise<Asset> {
  const { data } = await http.post(
    `/connectors/${connectorId}/assets/create`,
    asset
  );
  return data;
}

export async function updateAsset(
  id: string,
  asset: Record<string, unknown>,
  connectorId: string
) {
  const { data } = await http.put(
    `/connectors/${connectorId}/assets/${id}`,
    asset
  );
  return data;
}

export async function deleteAsset(
  id: string,
  connectorId: string
): Promise<void> {
  await http.delete(`/connectors/${connectorId}/assets/${id}`);
}

/* ── Policies ────────────────────────────────────────────────── */
export async function fetchPolicies(connectorId: string): Promise<Policy[]> {
  const { data } = await http.post(`/connectors/${connectorId}/policies`, {});
  return data;
}

export async function createPolicy(
  policy: Partial<Policy> | Record<string, unknown>,
  connectorId: string
): Promise<Policy> {
  const { data } = await http.post(
    `/connectors/${connectorId}/policies/create`,
    policy
  );
  return data;
}

export async function updatePolicy(
  id: string,
  policy: Record<string, unknown>,
  connectorId: string
) {
  const { data } = await http.put(
    `/connectors/${connectorId}/policies/${id}`,
    policy
  );
  return data;
}

export async function deletePolicy(
  id: string,
  connectorId: string
): Promise<void> {
  await http.delete(`/connectors/${connectorId}/policies/${id}`);
}

/* ── Offerings ───────────────────────────────────────────────── */
export async function fetchOfferings(connectorId: string): Promise<Offering[]> {
  const { data } = await http.post(`/connectors/${connectorId}/offerings`, {});
  return data;
}

export async function createOffering(
  offering: Partial<Offering>,
  connectorId: string
): Promise<Offering> {
  const { data } = await http.post(
    `/connectors/${connectorId}/offerings/create`,
    offering
  );
  return data;
}

export async function updateOffering(
  id: string,
  offering: Record<string, unknown>,
  connectorId: string
) {
  const { data } = await http.put(
    `/connectors/${connectorId}/offerings/${id}`,
    offering
  );
  return data;
}

export async function deleteOffering(
  id: string,
  connectorId: string
): Promise<void> {
  await http.delete(`/connectors/${connectorId}/offerings/${id}`);
}

/* ── Catalog ─────────────────────────────────────────────────── */
export async function fetchCatalog(
  dspEndpoint: string,
  counterPartyId: string,
  connectorId: string
): Promise<CatalogOffer[]> {
  // 카탈로그 조회는 DCP 인증(STS 토큰 발급 + DID 해석 + VC 검증)으로 20~30초 소요될 수 있어
  // 기본 15초 타임아웃으로는 BFF(60초) 응답 전에 abort된다. BFF 타임아웃보다 약간 길게 설정해
  // 서버가 돌려주는 실제 EDC 에러(actionable)가 UI에 도달하도록 한다.
  const { data } = await http.post(
    `/connectors/${connectorId}/catalog`,
    { dspEndpoint, counterPartyId },
    { timeout: 65_000 }
  );
  return data;
}

/* ── Negotiations ────────────────────────────────────────────── */
export async function fetchNegotiations(
  connectorId: string
): Promise<Negotiation[]> {
  const { data } = await http.post(
    `/connectors/${connectorId}/negotiations`,
    {}
  );
  return data;
}

export async function terminateNegotiation(
  negId: string,
  connectorId: string,
  reason?: string
): Promise<void> {
  await http.post(
    `/connectors/${connectorId}/negotiations/${negId}/terminate`,
    { reason }
  );
}

export async function fetchNegotiationById(
  id: string,
  connectorId: string
): Promise<Negotiation | null> {
  try {
    const { data } = await http.get(
      `/connectors/${connectorId}/negotiations/${id}`
    );
    return data;
  } catch {
    return null;
  }
}

export async function startNegotiation(
  offer: {
    offerId: string;
    assetId: string;
    providerDid: string;
    dspEndpoint: string;
    offerPolicy?: Record<string, unknown>;
  },
  connectorId: string
): Promise<Negotiation> {
  const { data } = await http.post(
    `/connectors/${connectorId}/negotiations/start`,
    offer
  );
  return data;
}

/* ── Transfers ───────────────────────────────────────────────── */
export async function fetchTransfers(connectorId: string): Promise<Transfer[]> {
  const { data } = await http.post(`/connectors/${connectorId}/transfers`, {});
  return data;
}

export async function startTransfer(
  params: {
    agreementId: string;
    counterPartyAddress: string;
    assetId?: string;
    dataSink: Record<string, string>;
  },
  connectorId: string
): Promise<Transfer> {
  const { data } = await http.post(
    `/connectors/${connectorId}/transfers/start`,
    params
  );
  return data;
}

export async function completeTransfer(
  tpId: string,
  connectorId: string
): Promise<void> {
  await http.post(`/connectors/${connectorId}/transfers/${tpId}/complete`, {});
}

export async function terminateTransfer(
  tpId: string,
  connectorId: string,
  reason?: string
): Promise<void> {
  await http.post(`/connectors/${connectorId}/transfers/${tpId}/terminate`, {
    reason,
  });
}

export async function deleteAllTransfers(
  connectorId: string
): Promise<{ deleted: number }> {
  const { data } = await http.delete(`/connectors/${connectorId}/transfers`);
  return data;
}

export async function fetchTransferData(
  tpId: string,
  connectorId: string,
  path?: string
): Promise<{ data: unknown; sizeBytes: number; contentType: string }> {
  // path: 프록시 자산(DTR 등)을 하위 경로로 조회 (예: "/shell-descriptors"). 일반 자산은 생략.
  const { data } = await http.post(
    `/connectors/${connectorId}/transfers/${tpId}/fetch`,
    path ? { path } : {}
  );
  return data;
}

/* ── EDR ──────────────────────────────────────────────────────── */
export async function fetchEDRs(connectorId: string): Promise<EDR[]> {
  const { data } = await http.post(`/connectors/${connectorId}/edrs`, {});
  return data;
}

export async function fetchEDRStats(connectorId: string): Promise<EDRStats> {
  const { data } = await http.get(`/connectors/${connectorId}/edrs/stats`);
  return data;
}

export async function deleteEDR(
  tpId: string,
  connectorId: string
): Promise<void> {
  await http.delete(`/connectors/${connectorId}/edrs/${tpId}`);
}

/* ── Stats ────────────────────────────────────────────────────── */
export interface TrendPoint {
  t: string; // "HH:00"
  negs: number;
  transfers: number;
}

export async function fetchTrend(
  connectorId: string,
  hours = 24
): Promise<TrendPoint[]> {
  const { data } = await http.get(
    `/connectors/${connectorId}/stats/trend?hours=${hours}`
  );
  return data;
}

/* ── UI Notifications ─────────────────────────────────────────── */
export interface NotificationItem {
  id: string;
  type: "info" | "warn" | "error" | "success";
  source: "system" | "negotiation" | "transfer" | "edr" | "vc";
  title: string;
  message: string;
  link?: string;
  read: boolean;
  timestamp: string; // ISO string (created_at)
}

export async function fetchNotifications(): Promise<NotificationItem[]> {
  const { data } = await http.get("/notifications");
  return data;
}

export async function createNotification(
  n: Omit<NotificationItem, "id" | "read" | "timestamp">
): Promise<NotificationItem> {
  const { data } = await http.post("/notifications", n);
  return data;
}

export async function markNotificationRead(id: string): Promise<void> {
  await http.patch(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await http.patch("/notifications/read-all");
}

export async function dismissNotification(id: string): Promise<void> {
  await http.delete(`/notifications/${id}`);
}

export async function clearAllNotifications(): Promise<void> {
  await http.delete("/notifications");
}

/* ── System Info ──────────────────────────────────────────────── */
export interface SystemInfo {
  connectorHub: string;
  edcRuntime: string;
  dspVersion: string;
  dcpVersion: string;
  managementApi: string;
  environment: string;
  apiMode: string;
  nodeEnv: string;
  uptimeSeconds: number;
  startedAt: string;
}

export async function fetchSystemInfo(): Promise<SystemInfo> {
  const { data } = await http.get("/system/info");
  return data;
}

/* ── Platform Vault ───────────────────────────────────────────── */
export interface VaultStatusResp {
  url: string;
  sealed: boolean;
  version: string;
  clusterName: string | null;
  clusterId: string | null;
  initialized: boolean;
  standby: boolean;
  type: string;
}
export interface VaultListResp {
  aliases: string[];
  total: number;
}

export async function fetchVaultStatus(): Promise<VaultStatusResp> {
  const { data } = await http.get("/platform/vault/status");
  return data;
}

export async function fetchVaultList(): Promise<VaultListResp> {
  const { data } = await http.get("/platform/vault/list");
  return data;
}

/* ── Platform PostgreSQL ──────────────────────────────────────── */
export interface PgOverviewResp {
  version: string;
  uptimeSeconds: number;
  settings: Record<string, string>;
}
export interface PgDatabaseRow {
  name: string;
  sizeBytes: number;
  connections: number;
  owner: string;
}
export interface PgDatabasesResp {
  databases: PgDatabaseRow[];
}
export interface PgLocksResp {
  granted: number;
  waiting: number;
}

export async function fetchPgOverview(): Promise<PgOverviewResp> {
  const { data } = await http.get("/platform/postgres/overview");
  return data;
}

export async function fetchPgDatabases(): Promise<PgDatabasesResp> {
  const { data } = await http.get("/platform/postgres/databases");
  return data;
}

export async function fetchPgLocks(): Promise<PgLocksResp> {
  const { data } = await http.get("/platform/postgres/locks");
  return data;
}

/* ── Digital Twin Registry (DTR) ──────────────────────────────── */
export interface ShellListResp {
  items: ShellDescriptor[];
  cursor: string | null;
}

export async function fetchShells(
  params: { limit?: number; cursor?: string } = {}
): Promise<ShellListResp> {
  const { data } = await http.get("/dtr/shells", { params });
  return data;
}

export async function fetchShellById(
  aasId: string
): Promise<ShellDescriptor | null> {
  try {
    const { data } = await http.get(`/dtr/shells/${encodeURIComponent(aasId)}`);
    return data;
  } catch {
    return null;
  }
}

/** Fetch the raw DTR shell payload (for editor pre-fill). */
export async function fetchShellRaw(
  aasId: string
): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await http.get(
      `/dtr/shells/${encodeURIComponent(aasId)}/raw`
    );
    return data;
  } catch {
    return null;
  }
}

export async function createShell(
  body: Record<string, unknown>
): Promise<ShellDescriptor> {
  const { data } = await http.post("/dtr/shells", body);
  return data;
}

export async function updateShell(
  aasId: string,
  body: Record<string, unknown>
): Promise<void> {
  await http.put(`/dtr/shells/${encodeURIComponent(aasId)}`, body);
}

export async function deleteShell(aasId: string): Promise<void> {
  await http.delete(`/dtr/shells/${encodeURIComponent(aasId)}`);
}

export async function lookupShells(
  assetIds: SpecificAssetId[]
): Promise<{ shellIds: string[] }> {
  const { data } = await http.post("/dtr/lookup", { assetIds });
  return data;
}

export async function fetchSubmodels(
  aasId: string
): Promise<{ items: SubmodelDescriptor[] }> {
  const { data } = await http.get(
    `/dtr/shells/${encodeURIComponent(aasId)}/submodels`
  );
  return data;
}

export async function createSubmodel(
  aasId: string,
  body: Record<string, unknown>
): Promise<SubmodelDescriptor> {
  const { data } = await http.post(
    `/dtr/shells/${encodeURIComponent(aasId)}/submodels`,
    body
  );
  return data;
}

export async function updateSubmodel(
  aasId: string,
  submodelId: string,
  body: Record<string, unknown>
): Promise<void> {
  await http.put(
    `/dtr/shells/${encodeURIComponent(aasId)}/submodels/${encodeURIComponent(submodelId)}`,
    body
  );
}

export async function deleteSubmodel(
  aasId: string,
  submodelId: string
): Promise<void> {
  await http.delete(
    `/dtr/shells/${encodeURIComponent(aasId)}/submodels/${encodeURIComponent(submodelId)}`
  );
}

/* ── Semantic Models (local Postgres CRUD) ──────────────────── */

export async function fetchSemanticModels(
  search?: string
): Promise<{ items: SemanticModelSummary[]; total: number }> {
  const params = search ? { search } : {};
  const { data } = await http.get(`/semantics/models`, { params });
  return data;
}

export async function fetchSemanticModel(urn: string): Promise<SemanticModel> {
  const { data } = await http.get(
    `/semantics/models/${encodeURIComponent(urn)}`
  );
  return data;
}

export async function createSemanticModel(
  body: Partial<SemanticModel>
): Promise<SemanticModel> {
  const { data } = await http.post(`/semantics/models`, body);
  return data;
}

export async function updateSemanticModel(
  urn: string,
  body: Partial<SemanticModel>
): Promise<SemanticModel> {
  const { data } = await http.put(
    `/semantics/models/${encodeURIComponent(urn)}`,
    body
  );
  return data;
}

export async function deleteSemanticModel(urn: string): Promise<void> {
  await http.delete(`/semantics/models/${encodeURIComponent(urn)}`);
}

/* ── Global app settings ────────────────────────────────────── */

export async function fetchIdentityHubUrl(): Promise<string> {
  const { data } = await http.get(`/system/settings/identity-hub-url`);
  return (data?.value as string) ?? "";
}

export async function updateIdentityHubUrl(value: string): Promise<string> {
  const { data } = await http.put(`/system/settings/identity-hub-url`, {
    value,
  });
  return (data?.value as string) ?? "";
}

export interface IdentityHubConfigResp {
  url: string;
  participantId: string;
  /** Whether an API key is stored (the value itself is never returned). */
  hasApiKey: boolean;
}

export async function fetchIdentityHubConfig(): Promise<IdentityHubConfigResp> {
  const { data } = await http.get(`/system/settings/identity-hub-config`);
  return {
    url: (data?.url as string) ?? "",
    participantId: (data?.participantId as string) ?? "",
    hasApiKey: data?.hasApiKey === true,
  };
}

export async function updateIdentityHubConfig(input: {
  url: string;
  participantId: string;
  apiKey: string;
}): Promise<IdentityHubConfigResp> {
  const { data } = await http.put(
    `/system/settings/identity-hub-config`,
    input
  );
  return {
    url: (data?.url as string) ?? "",
    participantId: (data?.participantId as string) ?? "",
    hasApiKey: data?.hasApiKey === true,
  };
}

/* ── Tenant (organization) ───────────────────────────────────── */
export interface TenantInfo {
  name: string;
  bpn: string;
}

export async function fetchTenantInfo(): Promise<TenantInfo> {
  const { data } = await http.get(`/system/settings/tenant`);
  return {
    name: (data?.name as string) ?? "",
    bpn: (data?.bpn as string) ?? "",
  };
}

export async function updateTenantBpn(bpn: string): Promise<TenantInfo> {
  const { data } = await http.put(`/system/settings/tenant`, { bpn });
  return {
    name: (data?.name as string) ?? "",
    bpn: (data?.bpn as string) ?? bpn,
  };
}

export interface IdentityHubCredential {
  id: string;
  type: string;
  issuer: string;
  status: string;
}

export interface IdentityHubParticipant {
  configured: boolean;
  participantId: string;
  baseUrl: string;
  did: string | null;
  credentials: IdentityHubCredential[];
  credentialError: string | null;
  checkedAt: string;
}

/** Fetch the participant's own identity info (DID + credentials) from IdentityHub. */
export async function fetchIdentityHubParticipant(): Promise<IdentityHubParticipant> {
  const { data } = await http.get(`/identity-hub/participant`);
  return {
    configured: data?.configured === true,
    participantId: (data?.participantId as string) ?? "",
    baseUrl: (data?.baseUrl as string) ?? "",
    did: (data?.did as string | null) ?? null,
    credentials: Array.isArray(data?.credentials) ? data.credentials : [],
    credentialError: (data?.credentialError as string | null) ?? null,
    checkedAt: (data?.checkedAt as string) ?? "",
  };
}

export interface VaultConfigResp {
  url: string;
  namespace: string;
  /** Whether an access token is stored (the value itself is never returned). */
  hasToken: boolean;
}

export async function fetchVaultConfig(): Promise<VaultConfigResp> {
  const { data } = await http.get(`/system/settings/vault-config`);
  return {
    url: (data?.url as string) ?? "",
    namespace: (data?.namespace as string) ?? "",
    hasToken: data?.hasToken === true,
  };
}

export async function updateVaultConfig(input: {
  url: string;
  token: string;
  namespace: string;
}): Promise<VaultConfigResp> {
  const { data } = await http.put(`/system/settings/vault-config`, input);
  return {
    url: (data?.url as string) ?? "",
    namespace: (data?.namespace as string) ?? "",
    hasToken: data?.hasToken === true,
  };
}

/* ── IdentityHub status monitor ─────────────────────────────── */

export interface IdentityHubComponent {
  component: string;
  isHealthy: boolean;
  failure: string | null;
}

export interface IdentityHubHealth {
  status: "up" | "warn" | "down" | "unconfigured";
  baseUrl: string;
  endpointUrl: string;
  latencyMs: number | null;
  checkedAt: string;
  isSystemHealthy: boolean | null;
  components: IdentityHubComponent[];
  httpStatus: number | null;
  error: string | null;
}

export async function fetchIdentityHubHealth(): Promise<IdentityHubHealth> {
  const { data } = await http.get(`/identity-hub/health`);
  return data;
}

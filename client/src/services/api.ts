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

// withCredentials: 세션은 httpOnly 쿠키(kmx_token)로 운반되므로 쿠키를 함께 전송하도록 명시.
const http = axios.create({
  baseURL: "/api",
  timeout: 15_000,
  withCredentials: true,
});

/** 이중제출 CSRF 토큰(kmx_csrf, 비 httpOnly)을 document.cookie 에서 읽는다. */
export function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)kmx_csrf=([^;]*)/);
  try {
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return m ? m[1] : null;
  }
}

// 변이 요청(POST/PUT/PATCH/DELETE)에 CSRF 토큰 헤더를 부착 — 서버가 kmx_csrf 쿠키와 대조한다.
// 인증(Bearer) 헤더는 더 이상 부착하지 않는다(세션 = httpOnly 쿠키).
http.interceptors.request.use(config => {
  const method = (config.method ?? "get").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const csrf = readCsrfCookie();
    if (csrf) config.headers["X-CSRF-Token"] = csrf;
  }
  return config;
});

// Translate 401/403 into user-visible toasts. Reads i18n lang from localStorage
// so we don't need React context here.
// 401 = 인증 만료/무효 → 세션을 비우고 전역 이벤트를 쏴 AuthProvider 가 로그아웃 처리
// (react-query 캐시 초기화·store 리셋 포함)하게 한다. 403 = 권한 부족이므로 로그아웃 대상 아님.
http.interceptors.response.use(
  res => res,
  error => {
    const status = error?.response?.status;
    if (status === 403 || status === 401) {
      const lang =
        (typeof localStorage !== "undefined" &&
          localStorage.getItem("locale")) ||
        "ko";
      // 403: 서버가 반환한 required(필요 역할 목록)를 함께 안내해 "어떤 권한이 필요한지" 명시.
      let msg: string;
      if (status === 403) {
        const required = error?.response?.data?.required;
        const labels: Record<string, string> =
          lang === "ko"
            ? { admin: "관리자", operator: "이용자", viewer: "열람자" }
            : { admin: "Admin", operator: "Operator", viewer: "Viewer" };
        if (Array.isArray(required) && required.length > 0) {
          const names = required
            .map((r: string) => labels[r] ?? r)
            .join(lang === "ko" ? ", " : " / ");
          msg =
            lang === "ko"
              ? `이 작업은 ${names} 권한이 필요합니다.`
              : `This action requires the ${names} role.`;
        } else {
          msg =
            lang === "ko"
              ? "이 작업을 수행할 권한이 없습니다."
              : "You are not allowed to perform this action.";
        }
      } else {
        msg =
          lang === "ko"
            ? "인증이 만료되었습니다. 다시 로그인해 주세요."
            : "Session expired. Please sign in again.";
      }
      try {
        toast.error(msg);
      } catch {
        /* toaster not mounted */
      }
      if (status === 401) {
        // 토큰 만료/무효 — 세션을 즉시 비우고(이후 요청에 stale 토큰 미부착) AuthProvider 에 만료 신호 전달.
        try {
          sessionStorage.removeItem("kmx-edc-auth");
        } catch {
          /* ignore */
        }
        try {
          window.dispatchEvent(new Event("kmx-auth-expired"));
        } catch {
          /* SSR/비브라우저 — 무시 */
        }
      }
    }
    return Promise.reject(error);
  }
);

/* ── Auth ────────────────────────────────────────────────────── */
// 로그아웃 — 서버가 token_version 을 증가시키고 세션 쿠키를 삭제한다. 인터셉터가 붙은 http
// 인스턴스 대신 bare axios 를 쓴다(로그아웃 실패로 401/403 토스트가 뜨지 않도록). 변이 요청이라
// CSRF 헤더를 수동 부착한다.
export async function postLogout(): Promise<void> {
  const csrf = readCsrfCookie();
  await axios.post(
    "/api/auth/logout",
    {},
    {
      withCredentials: true,
      headers: csrf ? { "X-CSRF-Token": csrf } : {},
    }
  );
}

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

/* ── Audit Log ───────────────────────────────────────────────── */
// 테넌트 범위 감사 로그(최신순). 서버가 클라 AuditEvent 형태로 평탄화해 반환한다.
export async function fetchAuditEvents(
  limit = 500,
  days?: number
): Promise<unknown[]> {
  // days: 서버측 기간 필터. LIMIT(500)에 최근 행이 먼저 차서 과거 기간 조회가
  // 부분 결과가 되는 문제를 서버에서 잘라 해결한다(1~90은 서버가 클램프).
  const { data } = await http.get("/audit", {
    params: days ? { limit, days } : { limit },
  });
  return Array.isArray(data) ? data : [];
}

/* ── Field History (작성 폼 자동완성) ─────────────────────────── */
// 필드 키 목록에 대한 이전 입력값 제안(테넌트 범위). { [key]: string[] }
export async function fetchFieldHistory(
  keys: string[]
): Promise<Record<string, string[]>> {
  if (!keys.length) return {};
  const { data } = await http.get("/field-history", {
    params: { keys: keys.join(",") },
  });
  return data && typeof data === "object" ? data : {};
}

// 작성 폼 제출 시 입력값 기록(fire-and-forget — 실패해도 본 흐름에 영향 없음).
export function recordFieldHistory(
  entries: { fieldKey: string; value: string }[]
): void {
  const valid = entries.filter(e => e && e.value && e.value.trim());
  if (!valid.length) return;
  void http.post("/field-history", { entries: valid }).catch(() => {});
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
  // 404 만 '미존재'(null)로 해석. 5xx/타임아웃/네트워크 등은 호출부가 판정을 보류하도록 재던진다.
  // (ID 중복검사가 일시 장애를 '사용 가능'으로 오판하지 않게 함 — 호출부 PageAssets.validateStep1)
  try {
    const { data } = await http.get(`/connectors/${connectorId}/assets/${id}`);
    return data;
  } catch (err) {
    if ((err as { response?: { status?: number } })?.response?.status === 404) {
      return null;
    }
    throw err;
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

/** 성공률 KPI 요약(협상·전송) — 관측된 터미널(metadata.last_state) 기준. */
export interface StatsSummary {
  days: number;
  negotiations: {
    total: number;
    finalized: number;
    terminated: number;
    successRate: number | null;
  };
  transfers: {
    total: number;
    completed: number;
    failed: number;
    successRate: number | null;
  };
}
/** 알림 source 토글(테넌트 영속) — 키는 SOURCE_PREF(useNotifications)와 동일. */
/** OIDC(Keycloak SSO) 활성 여부 — 로그인 화면의 SSO 버튼 노출 판단(무인증). */
export async function fetchOidcStatus(): Promise<{ enabled: boolean }> {
  const { data } = await http.get("/auth/oidc/status");
  return { enabled: data?.enabled === true };
}

export async function fetchNotifyPrefs(): Promise<Record<string, boolean>> {
  const { data } = await http.get("/system/settings/notifications");
  return (data ?? {}) as Record<string, boolean>;
}
export async function updateNotifyPrefs(
  partial: Record<string, boolean>
): Promise<Record<string, boolean>> {
  const { data } = await http.put("/system/settings/notifications", partial);
  return (data ?? {}) as Record<string, boolean>;
}

export async function fetchStatsSummary(
  connectorId: string,
  days = 7
): Promise<StatsSummary> {
  const { data } = await http.get(`/connectors/${connectorId}/stats/summary`, {
    params: { days },
  });
  return data as StatsSummary;
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

// 전송 총계/완료/진행 '정확값'. EDC DB 접속이 설정된 커넥터만 exact:true 로 실제 수치를
// 준다(목록은 EDC_QUERY_LIMIT 상한에 걸려 카드가 멈추므로). 미설정이면 exact:false →
// 호출측이 목록 길이로 폴백.
export interface TransferCounts {
  exact: boolean;
  transfers?: number;
  transfersCompleted?: number;
  transfersActive?: number;
}

export async function fetchTransferCounts(
  connectorId: string
): Promise<TransferCounts> {
  const { data } = await http.get(`/connectors/${connectorId}/stats/counts`);
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
  // i18n: 서버가 msgKey + params 로 저장한 알림은 표시 시점에 사용자 언어로 번역한다.
  // 없으면(옛 데이터·수동 생성) title/message 를 그대로 사용(폴백).
  msgKey?: string | null;
  params?: Record<string, unknown> | null;
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

/** 서브모델 실본문(AAS Part 2) 조회 — 디스크립터의 endpoint href 를 BFF 가
 * SSRF 가드 하에 따라가 읽는다. { idShort, semanticId, href, content } 반환. */
export interface SubmodelContentResponse {
  idShort: string;
  semanticId: string;
  href: string;
  content: unknown;
}
export async function fetchSubmodelContent(
  aasId: string,
  submodelId: string
): Promise<SubmodelContentResponse> {
  const { data } = await http.get(
    `/dtr/shells/${encodeURIComponent(aasId)}/submodels/${encodeURIComponent(submodelId)}/content`
  );
  return data as SubmodelContentResponse;
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

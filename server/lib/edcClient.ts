// KMX EDC — EDC Management API Client (axios-based)
// Creates per-connector axios instances with baseURL + X-Api-Key header

import axios, { type AxiosInstance, type AxiosError } from "axios";

export interface EdcClientConfig {
  managementUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export class EdcApiError extends Error {
  status: number;
  detail: string;
  /** EDC가 응답 본문으로 돌려준 애플리케이션 레벨 에러인지 여부.
   *  true면 detail은 EDC 자체 메시지(자격증명/검증 실패 등)이므로 관리자에게 노출해도 안전.
   *  false면 전송/내부 실패(내부 호스트 포함 가능)이므로 errorHandler에서 마스킹 대상. */
  fromEdcResponse: boolean;
  constructor(status: number, detail: string, fromEdcResponse = false) {
    super(`EDC API Error (${status}): ${detail}`);
    this.name = "EdcApiError";
    this.status = status;
    this.detail = detail;
    this.fromEdcResponse = fromEdcResponse;
  }
}

/** Create an axios instance configured for a specific EDC connector */
export function createEdcClient(config: EdcClientConfig): AxiosInstance {
  const client = axios.create({
    baseURL: config.managementUrl,
    timeout: config.timeoutMs ?? 10_000,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": config.apiKey,
    },
  });

  // Response interceptor: unwrap errors to EdcApiError
  client.interceptors.response.use(
    (res) => res,
    (error: AxiosError) => {
      if (error.response) {
        const data = error.response.data;
        let detail: string;
        if (Array.isArray(data)) {
          // EDC returns array of validation errors: [{message, type, path}, ...]
          detail = data.map((e: { message?: string }) => e.message).filter(Boolean).join("; ") || error.message;
        } else if (data && typeof data === "object") {
          const obj = data as Record<string, unknown>;
          detail = (obj.message as string) ?? (obj.error as string) ?? error.message;
        } else {
          detail = error.message;
        }
        throw new EdcApiError(error.response.status, detail, true);
      }
      if (error.code === "ECONNREFUSED" || error.code === "ECONNABORTED") {
        throw new EdcApiError(503, `Connector unreachable: ${error.message}`);
      }
      throw new EdcApiError(500, error.message);
    }
  );

  return client;
}

/** Ensure JSON-LD @context is present on request body */
export function withJsonLd(body: Record<string, unknown> = {}): Record<string, unknown> {
  if (body["@context"]) return body;
  return {
    "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
    "@type": body["@type"] ?? "QuerySpec",
    ...body,
  };
}

/* ── EDC JSON-LD → Client type mappers ─────────────────────── */

// Helper: safely get nested value from JSON-LD object
function jld(obj: Record<string, unknown>, key: string): unknown {
  return obj[key] ?? obj[`edc:${key}`] ?? obj[`https://w3id.org/edc/v0.0.1/ns/${key}`];
}

function props(obj: Record<string, unknown>): Record<string, unknown> {
  return (obj["properties"] ?? obj) as Record<string, unknown>;
}

export function mapAsset(raw: Record<string, unknown>) {
  const p = props(raw);
  const da = (raw["dataAddress"] ?? {}) as Record<string, unknown>;
  // dct:type may come as { "@id": "cx-taxo:..." } or as a plain string
  const dctTypeRaw = p["dct:type"] ?? p["https://purl.org/dc/terms/type"];
  const dctType = dctTypeRaw
    ? (typeof dctTypeRaw === "object" ? ((dctTypeRaw as Record<string, unknown>)["@id"] as string ?? "") : String(dctTypeRaw))
    : (jld(da, "type") as string ?? "");
  return {
    id: raw["@id"] ?? jld(p, "id") ?? "",
    type: dctType,
    ver: jld(p, "cx-common:version") ?? jld(p, "version") ?? "",
    sem: jld(p, "semanticId") ?? null,
    offered: true,
    created: jld(raw, "createdAt")
      ? new Date(jld(raw, "createdAt") as number).toISOString().slice(0, 10)
      : jld(p, "createdAt")
        ? new Date(jld(p, "createdAt") as number).toISOString().slice(0, 10)
        : "",
    name: jld(p, "name") ?? "",
    description: jld(p, "description") ?? "",
    dataAddressType: jld(da, "type") ?? "",
    baseUrl: jld(da, "baseUrl") ?? "",
    proxyPath: jld(da, "proxyPath") as string ?? "",
    proxyQueryParams: jld(da, "proxyQueryParams") as string ?? "",
    contentType: jld(da, "contentType") as string ?? "",
    aasVersion: jld(p, "kmx:aasVersion") as string ?? "",
    aasId: jld(p, "kmx:aasId") as string ?? "",
    submodelId: jld(p, "kmx:submodelId") as string ?? "",
  };
}

export function mapPolicy(raw: Record<string, unknown>) {
  const policy = (raw["policy"] ?? {}) as Record<string, unknown>;
  const perms = policy["odrl:permission"] ?? policy["permission"];
  let constraint = "";
  if (perms) {
    const perm = Array.isArray(perms) ? perms[0] : perms;
    const cons = perm?.["odrl:constraint"] ?? perm?.["constraint"];
    if (cons) {
      const c = Array.isArray(cons) ? cons[0] : cons;
      constraint = `${c?.["odrl:leftOperand"] ?? c?.["leftOperand"] ?? ""} ${c?.["odrl:operator"]?.["@id"] ?? c?.["operator"] ?? ""} ${c?.["odrl:rightOperand"] ?? c?.["rightOperand"] ?? ""}`.trim();
    }
    if (!constraint) {
      const action = perm?.["odrl:action"]?.["@id"] ?? perm?.["odrl:action"] ?? "";
      constraint = action ? `action: ${action}` : "No constraints";
    }
  }
  return {
    id: raw["@id"] ?? "",
    constraint: constraint || "No constraints",
    offers: 0,
  };
}

const NEG_STATE_TO_CODE: Record<string, number> = {
  INITIAL: 100, REQUESTING: 200, OFFERED: 400, ACCEPTED: 600,
  AGREED: 800, VERIFIED: 1000, FINALIZED: 1200, TERMINATED: 1300,
};

const TRANSFER_STATE_TO_CODE: Record<string, number> = {
  REQUESTING: 200, STARTED: 400, SUSPENDED: 800,
  COMPLETED: 1200, TERMINATED: 1300, DEPROVISIONED: 1400,
};

export interface NegotiationMeta {
  started_at: Date | null;
  completed_at: Date | null;
}

export function mapNegotiation(raw: Record<string, unknown>, meta?: NegotiationMeta) {
  const stateStr = (raw["state"] as string) ?? "";
  const stateCode = NEG_STATE_TO_CODE[stateStr] ?? 0;
  const ts = raw["createdAt"] ? new Date(raw["createdAt"] as number).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  const errorDetail = (raw["errorDetail"] as string) ?? "";
  const agreementId = (raw["contractAgreementId"] as string) ?? "";
  const assetId = (raw["assetId"] as string) ?? "";
  const counterPartyAddress = (raw["counterPartyAddress"] as string) ?? "";

  // 소요시간: completed_at - started_at (초 단위)
  let duration = "—";
  if (meta?.completed_at && meta?.started_at) {
    const ms = meta.completed_at.getTime() - meta.started_at.getTime();
    if (ms > 0) duration = `${(ms / 1000).toFixed(1)}s`;
  }

  return {
    id: (raw["@id"] as string) ?? "",
    state: stateCode,
    name: stateStr,
    peer: (raw["counterPartyId"] as string) ?? "",
    t: duration,
    ts,
    errorDetail,
    agreementId,
    assetId,
    counterPartyAddress,
  };
}

export interface TransferMeta {
  user_completed: boolean;
  started_at: Date | null;
  completed_at: Date | null;
  size_bytes: number | null;
  fetch_duration_ms: number | null;
}

export function mapTransfer(raw: Record<string, unknown>, meta?: TransferMeta) {
  const stateStr = (raw["state"] as string) ?? "";
  let stateCode = TRANSFER_STATE_TO_CODE[stateStr] ?? 0;
  let stateName = stateStr;

  // 사용자 완료 처리: EDC TERMINATED → UI COMPLETED 오버레이
  if (meta?.user_completed && stateStr === "TERMINATED") {
    stateCode = 1200;
    stateName = "COMPLETED";
  }

  const fmtDate = (d: Date | null | undefined) =>
    d ? d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

  const ts = raw["stateTimestamp"] ? new Date(raw["stateTimestamp"] as number).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  const transferType = (raw["transferType"] as string) ?? "";
  const mode = transferType.includes("PULL") ? "PULL" : transferType.includes("PUSH") ? "PUSH" : transferType || "—";
  const errorDetail = meta?.user_completed ? "" : ((raw["errorDetail"] as string) ?? "");
  const agreementId = (raw["contractAgreementId"] as string) ?? (raw["agreementId"] as string) ?? "";
  const connId = (raw["connectorId"] as string) ?? (raw["counterPartyId"] as string) ?? "";

  // 소요시간: 실제 데이터 Pull에 걸린 시간 (fetch_duration_ms 우선)
  let duration = "—";
  if (meta?.fetch_duration_ms != null) {
    duration = (meta.fetch_duration_ms / 1000).toFixed(2);
  }

  // 크기: bytes → KB/MB 자동 변환
  let size = "—";
  if (meta?.size_bytes != null && meta.size_bytes > 0) {
    if (meta.size_bytes >= 1024 * 1024) {
      size = `${(meta.size_bytes / 1024 / 1024).toFixed(2)} MB`;
    } else if (meta.size_bytes >= 1024) {
      size = `${(meta.size_bytes / 1024).toFixed(1)} KB`;
    } else {
      size = `${meta.size_bytes} B`;
    }
  }

  return {
    id: (raw["@id"] as string) ?? "",
    state: stateCode,
    name: stateName,
    asset: (raw["assetId"] as string) ?? "",
    size,
    t: duration,
    ts,
    startedAt: fmtDate(meta?.started_at),
    completedAt: fmtDate(meta?.completed_at),
    transferType: mode,
    errorDetail,
    agreementId,
    connectorId: connId,
  };
}

export function mapEDR(raw: Record<string, unknown>) {
  const tpId = ((raw["transferProcessId"] as string) ?? (raw["@id"] as string) ?? "").slice(0, 12);
  const asset = (raw["assetId"] as string) ?? "";
  const prov = (raw["providerId"] as string) ?? "";
  const createdAt = raw["createdAt"] as number | undefined;
  const expiresAt = raw["expiresAt"] as number | undefined;
  const now = Date.now();
  // expiresAt=0/undefined → -1(만료 정보 없음, 활성으로 간주) / 0 이상 → 남은 분
  const left = expiresAt ? Math.max(0, Math.round((expiresAt - now) / 60_000)) : -1;
  const total = (createdAt && expiresAt) ? Math.max(1, Math.round((expiresAt - createdAt) / 60_000)) : 60;
  const endpoint = (raw["endpoint"] as string) ?? "";
  const authCode = (raw["authCode"] as string) ?? (raw["authorization"] as string) ?? "";
  return { tpId, asset, prov, left, total, endpoint, authCode, expiresAt: expiresAt ?? 0 };
}

export function mapOffering(raw: Record<string, unknown>) {
  let asset = "";
  const selector = jld(raw, "assetsSelector");
  if (selector && typeof selector === "object") {
    const sel = Array.isArray(selector) ? selector[0] : selector;
    asset = (sel as Record<string, unknown>)?.["operandRight"] as string ?? "";
  }
  return {
    id: (raw["@id"] as string) ?? "",
    asset,
    access: (jld(raw, "accessPolicyId") as string) ?? "",
    contract: (jld(raw, "contractPolicyId") as string) ?? "",
    cnt: 0,
  };
}

/** Cache of per-connector clients */
const clientCache = new Map<string, AxiosInstance>();

export function getEdcClient(connectorId: string, config: EdcClientConfig): AxiosInstance {
  const key = `${connectorId}:${config.managementUrl}`;
  let client = clientCache.get(key);
  if (!client) {
    client = createEdcClient(config);
    clientCache.set(key, client);
  }
  return client;
}

export function clearClientCache(connectorId?: string) {
  if (connectorId) {
    clientCache.forEach((_, key) => {
      if (key.startsWith(`${connectorId}:`)) clientCache.delete(key);
    });
  } else {
    clientCache.clear();
  }
}

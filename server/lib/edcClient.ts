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

// 악성/침해된 EDC·DTR 호스트가 거대한 응답으로 BFF 메모리를 고갈시키지 못하도록 응답/요청
// 바이트 상한을 둔다(axios 기본 무제한). EDC Management 응답은 통상 수KB~수백KB. 환경변수로 조정.
const EDC_MAX_RESPONSE_BYTES = Number(
  process.env.EDC_MAX_RESPONSE_BYTES ?? 25 * 1024 * 1024
);

/** Create an axios instance configured for a specific EDC connector */
export function createEdcClient(config: EdcClientConfig): AxiosInstance {
  const client = axios.create({
    baseURL: config.managementUrl,
    timeout: config.timeoutMs ?? 10_000,
    maxContentLength: EDC_MAX_RESPONSE_BYTES,
    maxBodyLength: EDC_MAX_RESPONSE_BYTES,
    maxRedirects: 5,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": config.apiKey,
    },
  });

  // Response interceptor: unwrap errors to EdcApiError
  client.interceptors.response.use(
    res => res,
    (error: AxiosError) => {
      if (error.response) {
        const data = error.response.data;
        let detail: string;
        if (Array.isArray(data)) {
          // EDC returns array of validation errors: [{message, type, path}, ...]
          detail =
            data
              .map((e: { message?: string }) => e.message)
              .filter(Boolean)
              .join("; ") || error.message;
        } else if (data && typeof data === "object") {
          const obj = data as Record<string, unknown>;
          detail =
            (obj.message as string) ?? (obj.error as string) ?? error.message;
        } else {
          detail = error.message;
        }
        throw new EdcApiError(error.response.status, detail, true);
      }
      if (error.code === "ECONNREFUSED" || error.code === "ECONNABORTED") {
        throw new EdcApiError(503, `Connector unreachable: ${error.message}`);
      }
      // 응답 크기 상한 초과 — OOM 대신 명시적 502 로 거부.
      if (error.code === "ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED") {
        throw new EdcApiError(502, "Upstream response too large");
      }
      throw new EdcApiError(500, error.message);
    }
  );

  return client;
}

/** Ensure JSON-LD @context is present on request body */
export function withJsonLd(
  body: Record<string, unknown> = {}
): Record<string, unknown> {
  if (body["@context"]) return body;
  return {
    "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
    "@type": body["@type"] ?? "QuerySpec",
    ...body,
  };
}

/* ── Client builder data → EDC JSON-LD builders ──────────────── */

/**
 * 평면 빌더 데이터(ruleType/action/logicOp/constraints)를 EDC PolicyDefinition JSON-LD로 변환.
 * create/PUT가 공유하는 단일 진실원천(SoT) — 과거 create는 permission+use 하드코딩,
 * PUT은 원시 빌더 전달이라 EDC 인식 실패하던 결함(id 17/18/20)을 통합 해소.
 *
 * [클라 계약] PagePolicy 빌더는 다음 평면 필드를 보낸다(서버가 ODRL로 변환):
 *   - policyId: string                      // PolicyDefinition @id
 *   - ruleType?: "permission"|"prohibition"|"obligation"  (기본 permission)
 *   - action?: string                        // "use","transfer" 등 (odrl: 접두 자동 보정)
 *   - logicOp?: "and"|"or"|"xone"            // 다중 constraint 논리결합(2개 이상일 때)
 *   - constraints?: { leftOperand, operator, rightOperand }[]
 * 이미 @context를 가진 완전한 JSON-LD가 오면 그대로 통과(빌드 생략).
 */
export interface PolicyBuilderInput {
  policyId: string;
  ruleType?: "permission" | "prohibition" | "obligation";
  action?: string;
  logicOp?: "and" | "or" | "xone";
  constraints?: {
    leftOperand: string;
    operator: string;
    rightOperand: string;
  }[];
}

export function buildPolicyDefinition(
  input: PolicyBuilderInput
): Record<string, unknown> {
  const ruleType = input.ruleType ?? "permission";
  const ruleKey = `odrl:${ruleType}`;
  const actionRaw = input.action ?? "use";
  const actionId = actionRaw.includes(":") ? actionRaw : `odrl:${actionRaw}`;

  const constraintNodes = (input.constraints ?? []).map(c => ({
    "odrl:leftOperand": c.leftOperand,
    "odrl:operator": { "@id": c.operator },
    "odrl:rightOperand": c.rightOperand,
  }));
  // 다중 제약 + logicOp면 논리연산자로 래핑(클라 미리보기와 동일 구조).
  const constraintField =
    constraintNodes.length > 1 && input.logicOp
      ? [{ [`odrl:${input.logicOp}`]: constraintNodes }]
      : constraintNodes;

  const rule: Record<string, unknown> = {
    "odrl:action": { "@id": actionId },
  };
  if (constraintField.length) rule["odrl:constraint"] = constraintField;

  return {
    "@context": {
      "@vocab": "https://w3id.org/edc/v0.0.1/ns/",
      odrl: "http://www.w3.org/ns/odrl/2/",
      "cx-policy": "https://w3id.org/catenax/policy/",
    },
    "@type": "PolicyDefinition",
    "@id": input.policyId,
    policy: {
      "@context": "http://www.w3.org/ns/odrl.jsonld",
      "@type": "odrl:Set",
      [ruleKey]: [rule],
    },
  };
}

/**
 * 평면 자산 빌더 데이터를 EDC v3 Asset JSON-LD로 변환. create/PUT 공유 SoT.
 * (과거: PUT은 withJsonLd raw 전달이라 properties/dataAddress 구조 불일치로 수정 깨짐 — id 11)
 *
 * [클라 계약] PageAssets 위저드는 평면 필드를 보낸다(서버가 JSON-LD로 변환):
 *   id, name, ver, type, sem, aasVersion, aasId, submodelId,
 *   dataAddressType, baseUrl, proxyPath, proxyQueryParams, authCode, contentType,
 *   customProperties?: Record<string,string>   // 사용자 정의 속성(시스템 키 제외 후 병합 — id 12)
 * forceId: PUT에서는 @id를 URL :assetId로 강제 정합(본문 id 불일치 방지).
 */
// properties에 병합 시 덮어쓰면 안 되는 시스템 예약 키(커스텀 속성과 충돌 방지).
const ASSET_SYSTEM_PROP_KEYS = new Set([
  "name",
  "description",
  "cx-common:version",
  "version",
  "semanticId",
  "dct:type",
  "https://purl.org/dc/terms/type",
  "kmx:aasVersion",
  "kmx:aasId",
  "kmx:submodelId",
  "createdAt",
  "id",
  "@id",
]);

export function toEdcAssetBody(
  b: Record<string, unknown>,
  forceId?: string
): Record<string, unknown> {
  const s = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;
  const id = forceId ?? s(b.id);

  // customProperties 병합 — 시스템 예약 키와 겹치는 커스텀 키는 건너뛴다.
  const custom = (b.customProperties ?? {}) as Record<string, unknown>;
  const customMerged: Record<string, unknown> = {};
  if (custom && typeof custom === "object") {
    for (const [k, v] of Object.entries(custom)) {
      if (!ASSET_SYSTEM_PROP_KEYS.has(k)) customMerged[k] = v;
    }
  }

  return {
    "@context": {
      "@vocab": "https://w3id.org/edc/v0.0.1/ns/",
      "cx-common": "https://w3id.org/catenax/ontology/common#",
      dct: "https://purl.org/dc/terms/",
      "cx-taxo": "https://w3id.org/catenax/taxonomy#",
    },
    "@id": id,
    properties: {
      name: s(b.name) ?? id,
      ...(s(b.description) ? { description: s(b.description) } : {}),
      "cx-common:version": s(b.ver) ?? "",
      ...(s(b.type) ? { "dct:type": { "@id": s(b.type) } } : {}),
      ...(s(b.sem) ? { semanticId: s(b.sem) } : {}),
      ...(s(b.aasVersion) ? { "kmx:aasVersion": s(b.aasVersion) } : {}),
      ...(s(b.aasId) ? { "kmx:aasId": s(b.aasId) } : {}),
      ...(s(b.submodelId) ? { "kmx:submodelId": s(b.submodelId) } : {}),
      ...customMerged,
    },
    dataAddress: {
      type: s(b.dataAddressType) ?? "HttpData",
      baseUrl: s(b.baseUrl),
      proxyPath: s(b.proxyPath) ?? "false",
      proxyQueryParams: s(b.proxyQueryParams) ?? "false",
      authCode: s(b.authCode) ? `{{${s(b.authCode)}}}` : undefined,
      contentType: s(b.contentType) ?? "application/json",
    },
  };
}

/* ── EDC JSON-LD → Client type mappers ─────────────────────── */

// Helper: safely get nested value from JSON-LD object
function jld(obj: Record<string, unknown>, key: string): unknown {
  return (
    obj[key] ??
    obj[`edc:${key}`] ??
    obj[`https://w3id.org/edc/v0.0.1/ns/${key}`]
  );
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
    ? typeof dctTypeRaw === "object"
      ? (((dctTypeRaw as Record<string, unknown>)["@id"] as string) ?? "")
      : String(dctTypeRaw)
    : ((jld(da, "type") as string) ?? "");
  // 시스템 고정 키 외 나머지 properties를 customProperties로 수거 — 사용자 정의 속성
  // 라운드트립(입력→저장→상세 보기) 성립(id 12). object/배열 값은 표시 단순화 위해 제외.
  const customProperties: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (ASSET_SYSTEM_PROP_KEYS.has(k)) continue;
    if (typeof v === "object" || v == null) continue;
    customProperties[String(k)] = String(v);
  }

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
    proxyPath: (jld(da, "proxyPath") as string) ?? "",
    proxyQueryParams: (jld(da, "proxyQueryParams") as string) ?? "",
    contentType: (jld(da, "contentType") as string) ?? "",
    aasVersion: (jld(p, "kmx:aasVersion") as string) ?? "",
    aasId: (jld(p, "kmx:aasId") as string) ?? "",
    submodelId: (jld(p, "kmx:submodelId") as string) ?? "",
    customProperties,
  };
}

/* ── Policy(ODRL) 매핑 ──────────────────────────────────────────
 * EDC PolicyDefinition을 다음 두 표현으로 동시에 반환한다.
 *  - constraint(string): 레거시 클라 호환. 모든 rule의 모든 constraint를 "left op right" 형태로
 *    "; "(세미콜론+공백) 구분 결합. (과거: 첫 permission의 첫 constraint만 반환하던 버그 일반화)
 *  - rules(structured): 다음 단계 클라가 소비할 구조화 표현 — prohibition/obligation·다중 제약·다중 rule 보존.
 *  - ruleType/action: 첫 rule 요약(목록/상세 배지용, action 항상 'odrl:use' 하드코딩 제거).
 * [클라 계약] 다음 단계 PagePolicy는 p.rules(또는 p.ruleType/p.action)를 우선 소비하고,
 *  레거시 p.constraint(parseConstraints)는 점진 제거 가능. constraint 토큰 구분자는 "; ".
 */

// 단일 constraint 노드를 {left, op(=odrl: 접두 제거), right}로 평탄화.
function mapPolicyConstraint(c: Record<string, unknown> | undefined): {
  left: string;
  op: string;
  right: string;
} {
  const leftRaw = c?.["odrl:leftOperand"] ?? c?.["leftOperand"];
  const left =
    typeof leftRaw === "object" && leftRaw !== null
      ? ((leftRaw as Record<string, unknown>)["@id"] as string) ?? ""
      : ((leftRaw as string) ?? "");
  const opRaw =
    (c?.["odrl:operator"] as Record<string, unknown> | string | undefined) ??
    c?.["operator"];
  const opId =
    typeof opRaw === "object" && opRaw !== null
      ? ((opRaw as Record<string, unknown>)["@id"] as string) ?? ""
      : ((opRaw as string) ?? "");
  const rightRaw = c?.["odrl:rightOperand"] ?? c?.["rightOperand"];
  const right =
    typeof rightRaw === "object" && rightRaw !== null
      ? (((rightRaw as Record<string, unknown>)["@value"] as string) ??
          ((rightRaw as Record<string, unknown>)["@id"] as string) ??
          "")
      : ((rightRaw as string) ?? "");
  return { left, op: opId.replace(/^odrl:/, ""), right };
}

// odrl:and/or/xone 논리 래퍼를 재귀적으로 풀어 평탄한 constraint 배열로.
function flattenPolicyConstraints(cons: unknown): {
  left: string;
  op: string;
  right: string;
}[] {
  if (!cons) return [];
  const arr = Array.isArray(cons) ? cons : [cons];
  const out: { left: string; op: string; right: string }[] = [];
  for (const node of arr) {
    const n = node as Record<string, unknown>;
    const logical = n?.["odrl:and"] ?? n?.["odrl:or"] ?? n?.["odrl:xone"];
    if (logical) {
      out.push(...flattenPolicyConstraints(logical));
    } else {
      out.push(mapPolicyConstraint(n));
    }
  }
  return out;
}

export interface MappedPolicyRule {
  ruleType: "permission" | "prohibition" | "obligation";
  action: string;
  constraints: { left: string; op: string; right: string }[];
}

export function mapPolicy(raw: Record<string, unknown>) {
  const policy = (raw["policy"] ?? {}) as Record<string, unknown>;
  const rules: MappedPolicyRule[] = [];

  const RULE_KEYS: Array<[MappedPolicyRule["ruleType"], string]> = [
    ["permission", "odrl:permission"],
    ["prohibition", "odrl:prohibition"],
    ["obligation", "odrl:obligation"],
  ];

  for (const [ruleType, key] of RULE_KEYS) {
    const node = policy[key] ?? policy[ruleType];
    if (!node) continue;
    for (const r of Array.isArray(node) ? node : [node]) {
      const rr = r as Record<string, unknown>;
      const actionRaw = rr?.["odrl:action"] ?? rr?.["action"];
      const action =
        typeof actionRaw === "object" && actionRaw !== null
          ? ((actionRaw as Record<string, unknown>)["@id"] as string) ?? ""
          : ((actionRaw as string) ?? "");
      rules.push({
        ruleType,
        action: action.replace(/^odrl:/, ""),
        constraints: flattenPolicyConstraints(
          rr?.["odrl:constraint"] ?? rr?.["constraint"]
        ),
      });
    }
  }

  // 레거시 문자열: 전 rule의 전 constraint를 "left op right"로 "; " 결합.
  const allConstraints = rules.flatMap(r => r.constraints);
  let constraint = allConstraints
    .map(c => `${c.left} ${c.op} ${c.right}`.trim())
    .filter(Boolean)
    .join("; ");
  if (!constraint) {
    const firstAction = rules[0]?.action ?? "";
    constraint = firstAction ? `action: ${firstAction}` : "No constraints";
  }

  return {
    id: raw["@id"] ?? "",
    constraint: constraint || "No constraints",
    // 구조화 표현(다음 단계 클라 소비). 첫 rule 요약도 함께 제공.
    rules,
    ruleType: rules[0]?.ruleType ?? "permission",
    action: rules[0]?.action ?? "",
    offers: 0,
  };
}

const NEG_STATE_TO_CODE: Record<string, number> = {
  INITIAL: 100,
  // EDC 중간(진행) 상태도 매핑해 stateCode=0(미지) 빈도를 줄인다 — 미지 상태면 클라가
  // 무한 폴링하던 문제(id 30) 완화. *-ING/REQUESTED 등 전이 상태를 인접 코드로 흡수.
  REQUESTING: 200,
  REQUESTED: 250,
  OFFERING: 350,
  OFFERED: 400,
  ACCEPTING: 550,
  ACCEPTED: 600,
  AGREEING: 750,
  AGREED: 800,
  VERIFYING: 950,
  VERIFIED: 1000,
  FINALIZING: 1150,
  FINALIZED: 1200,
  TERMINATING: 1250,
  TERMINATED: 1300,
};

const TRANSFER_STATE_TO_CODE: Record<string, number> = {
  REQUESTING: 200,
  STARTED: 400,
  SUSPENDED: 800,
  COMPLETED: 1200,
  TERMINATED: 1300,
  DEPROVISIONED: 1400,
};

export interface NegotiationMeta {
  started_at: Date | null;
  completed_at: Date | null;
}

export function mapNegotiation(
  raw: Record<string, unknown>,
  meta?: NegotiationMeta
) {
  const stateStr = (raw["state"] as string) ?? "";
  const stateCode = NEG_STATE_TO_CODE[stateStr] ?? 0;
  // createdAt(epoch): 정렬/시간범위 필터용 머신리더블 값. ts(표시용 ko-KR)와 분리.
  // (과거: 표시용 로컬라이즈 문자열로 정렬·필터해 Date.parse 실패·자정 경계 역전 — id 28/32)
  const createdMs =
    typeof raw["createdAt"] === "number" ? (raw["createdAt"] as number) : null;
  const ts = raw["createdAt"]
    ? new Date(raw["createdAt"] as number).toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
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
    // [클라 계약] 시간범위 필터/정렬은 ts(표시문자열) 대신 createdAt(epoch|null)을 사용해야 한다.
    createdAt: createdMs,
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
    d
      ? d.toLocaleString("ko-KR", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  const ts = raw["stateTimestamp"]
    ? new Date(raw["stateTimestamp"] as number).toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const transferType = (raw["transferType"] as string) ?? "";
  const mode = transferType.includes("PULL")
    ? "PULL"
    : transferType.includes("PUSH")
      ? "PUSH"
      : transferType || "—";
  const errorDetail = meta?.user_completed
    ? ""
    : ((raw["errorDetail"] as string) ?? "");
  const agreementId =
    (raw["contractAgreementId"] as string) ??
    (raw["agreementId"] as string) ??
    "";
  const connId =
    (raw["connectorId"] as string) ?? (raw["counterPartyId"] as string) ?? "";

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
  const tpId = (
    (raw["transferProcessId"] as string) ??
    (raw["@id"] as string) ??
    ""
  ).slice(0, 12);
  const asset = (raw["assetId"] as string) ?? "";
  const prov = (raw["providerId"] as string) ?? "";
  const createdAt = raw["createdAt"] as number | undefined;
  const expiresAt = raw["expiresAt"] as number | undefined;
  const now = Date.now();
  // expiresAt=0/undefined → -1(만료 정보 없음, 활성으로 간주) / 0 이상 → 남은 분
  const left = expiresAt
    ? Math.max(0, Math.round((expiresAt - now) / 60_000))
    : -1;
  const total =
    createdAt && expiresAt
      ? Math.max(1, Math.round((expiresAt - createdAt) / 60_000))
      : 60;
  const endpoint = (raw["endpoint"] as string) ?? "";
  const authCode =
    (raw["authCode"] as string) ?? (raw["authorization"] as string) ?? "";
  return {
    tpId,
    asset,
    prov,
    left,
    total,
    endpoint,
    authCode,
    expiresAt: expiresAt ?? 0,
  };
}

export function mapOffering(raw: Record<string, unknown>) {
  let asset = "";
  const selector = jld(raw, "assetsSelector");
  if (selector && typeof selector === "object") {
    const sel = Array.isArray(selector) ? selector[0] : selector;
    // 다중 자산 오퍼링(in 연산자)은 operandRight가 배열 — string 캐스팅 시 표시 누락되므로
    // 배열이면 쉼표결합 문자열로 정규화(클라 .split(",")·검색 호환). (id 72)
    const right = (sel as Record<string, unknown>)?.["operandRight"];
    asset = Array.isArray(right)
      ? right.map(String).join(",")
      : ((right as string) ?? "");
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

export function getEdcClient(
  connectorId: string,
  config: EdcClientConfig
): AxiosInstance {
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

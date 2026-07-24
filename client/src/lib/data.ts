// Connector Hub — Types & State Maps

// 서버 status 는 'up'|'warn'|'down' 3-state. warn = 부분 장애(일부 API 만 성공).
export type ConnectorStatus = "up" | "warn" | "down";
export type EnvType = "PROD" | "STG" | "DEV";

export interface Connector {
  id: string;
  name: string;
  bpn: string;
  status: ConnectorStatus;
  env: EnvType;
  roles: string[];
  // dcp = 레거시 표시 필드. 서버 목록 응답은 dcpVersion·managementUrl 도 포함(apiKey만 제외)이라
  // 편집 폼 프리필에 쓰인다 — 타입에 명시해 (c as any) 캐스팅을 제거.
  dcp: string;
  dcpVersion?: string;
  managementUrl?: string;
  aas: boolean;
  assets: number;
  offers: number;
  negs: number;
  transfers: number;
  dspEndpoint?: string;
  did?: string;
  identityHubUrl?: string;
}

export interface Asset {
  id: string;
  type: string;
  ver: string;
  sem: string | null;
  offered: boolean;
  created: string;
  name?: string;
  description?: string;
  dataAddressType?: string;
  baseUrl?: string;
  proxyPath?: string;
  proxyQueryParams?: string;
  contentType?: string;
  aasVersion?: string;
  aasId?: string;
  submodelId?: string;
  customProperties?: Record<string, string>;
}

export interface Policy {
  id: string;
  constraint: string;
  offers: number;
}

export interface Offering {
  id: string;
  // 다중 자산 오퍼링은 서버가 쉼표 결합으로 보냄 (예: "asset-a,asset-b").
  asset: string;
  access: string;
  contract: string;
  cnt: number;
}

export interface Negotiation {
  id: string;
  state: number;
  name: string;
  peer: string;
  t: string;
  // ts = 로컬라이즈된 표시용 문자열. 정렬/시간범위 필터는 표시 문자열이 아닌 createdAt(epoch)로 한다.
  ts: string;
  // 서버가 보내는 머신리더블 생성시각(epoch ms). 미확인이면 null.
  createdAt?: number | null;
  errorDetail?: string;
  agreementId?: string;
  assetId?: string;
  counterPartyAddress?: string;
  protocol?: string;
}

export interface Transfer {
  id: string;
  state: number;
  name: string;
  asset: string;
  size: string;
  t: string;
  ts: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  transferType?: string;
  errorDetail?: string;
  agreementId?: string;
  connectorId?: string;
}

export interface EDR {
  tpId: string;
  asset: string;
  prov: string;
  left: number; // -1: expiresAt 없음(활성), 0: 만료, >0: 남은 분
  total: number;
  endpoint?: string;
  authCode?: string;
  // 원시 만료 시각(ms). 클라에서 남은시간 실시간 재계산 + 만료 항목 제거에 사용. 0: 만료정보 없음.
  expiresAt?: number;
}

export interface EDRStats {
  todayGcDeleted: number;
  gcErrors: number;
  nearestExpiry: { tpId: string; asset: string; left: number } | null;
  gcScheduler: {
    interval: string;
    batchSize: number;
    grace: string;
    lastRun: string;
    nextRun: string;
    enabled: boolean;
  };
}

export interface VC {
  id: string;
  type: string;
  exp: string;
  days: number;
  ok: boolean;
}

export interface SpecificAssetId {
  name: string;
  value: string;
}

export interface ShellEndpoint {
  interfaceName: string;
  href: string;
  endpointProtocol: string;
  endpointProtocolVersion: string;
  subprotocol: string;
  subprotocolBody: string;
  subprotocolBodyEncoding: string;
}

export interface SubmodelDescriptor {
  id: string;
  idShort: string;
  semanticId: string;
  /** HasSemantics 보조 의미(표준 템플릿 확장). 없으면 빈 배열. */
  supplementalSemanticIds: string[];
  /** AdministrativeInformation — 표준 템플릿 버전/리비전(없으면 ""). */
  version: string;
  revision: string;
  endpointCount: number;
  endpoints: ShellEndpoint[];
}

export interface ShellDescription {
  language: string;
  text: string;
}

export interface ShellDescriptor {
  id: string;
  idShort: string;
  globalAssetId: string;
  /** AAS 표준 assetKind: "Instance" | "Type" | "NotApplicable" (없으면 ""). */
  assetKind: string;
  /** AdministrativeInformation(없으면 ""). */
  version: string;
  revision: string;
  description: string;
  descriptions: ShellDescription[];
  specificAssetIds: SpecificAssetId[];
  submodelCount: number;
  submodelDescriptors: SubmodelDescriptor[];
  createdAt: string;
}

export interface CatalogOffer {
  name: string;
  type: string;
  src: string;
  pols: string[];
  offerId: string;
  offerPolicy?: Record<string, unknown>;
  assetId: string;
  dspEndpoint: string;
  providerDid: string;
  // AAS 연계(부가) — 서버 attachAasLinks 가 DTR 셸과 매칭했을 때만 채워진다.
  aasId?: string;
  aasIdShort?: string;
  globalAssetId?: string;
}

export type NegotiationStateName =
  | "INITIAL"
  | "REQUESTING"
  | "OFFERED"
  | "ACCEPTED"
  | "AGREED"
  | "VERIFIED"
  | "FINALIZED"
  | "TERMINATED";
export type TransferStateName =
  | "REQUESTING"
  | "STARTED"
  | "SUSPENDED"
  | "COMPLETED"
  | "TERMINATED";

export const NEG_STATE_MAP: Record<
  number,
  { name: NegotiationStateName; label: string; variant: string }
> = {
  100: { name: "INITIAL", label: "초기화", variant: "gray" },
  200: { name: "REQUESTING", label: "요청 전송 중", variant: "blue" },
  400: { name: "OFFERED", label: "프로바이더 오퍼 전달", variant: "teal" },
  600: { name: "ACCEPTED", label: "소비자 수락", variant: "teal" },
  800: { name: "AGREED", label: "프로바이더 합의", variant: "teal" },
  1000: { name: "VERIFIED", label: "소비자 검증 완료", variant: "teal" },
  1200: { name: "FINALIZED", label: "계약 성립", variant: "green" },
  1300: { name: "TERMINATED", label: "협상 종료", variant: "red" },
};

export const TRANSFER_STATE_MAP: Record<
  number,
  { name: TransferStateName; label: string; variant: string }
> = {
  200: { name: "REQUESTING", label: "요청 전송", variant: "blue" },
  400: { name: "STARTED", label: "전송 진행 중", variant: "blue" },
  800: { name: "SUSPENDED", label: "일시 중단", variant: "amber" },
  1200: { name: "COMPLETED", label: "전송 완료", variant: "green" },
  1300: { name: "TERMINATED", label: "전송 실패", variant: "red" },
};

/**
 * 빠른 폴링(3s) 대상 = 사용자 개입 없이 곧 상태가 바뀌는 진행 중 전송만.
 * REQUESTING(200)·STARTED(400) 만 해당. SUSPENDED(800)는 자동 재개되지 않으므로 제외해
 * 영구 폴링을 막는다(COMPLETED/TERMINATED 도 종단). 폴링 종단 판정 헬퍼.
 */
export function isTransferActive(state: number): boolean {
  return state === 200 || state === 400;
}

/**
 * 협상 진행 중 = 알려진 비종단 상태(0 초과·1200 미만)만.
 * 미지 상태(0/음수/NaN)는 종단으로 간주해 무한 폴링을 막는다. 폴링 종단 판정 헬퍼.
 */
export function isNegotiationActive(state: number): boolean {
  return state > 0 && state < 1200;
}

export const SINK_TYPES = [
  "HttpProxy",
  "HttpData",
  "AmazonS3",
  "AzureStorage",
] as const;
export type SinkType = (typeof SINK_TYPES)[number];

export type SemanticModelStatus =
  | "DRAFT"
  | "RELEASED"
  | "STANDARDIZED"
  | "DEPRECATED";

export interface SemanticModelSummary {
  urn: string;
  name: string;
  version: string;
  status: SemanticModelStatus;
  modelType: string;
  descriptionKo: string;
  descriptionEn: string;
  contentBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticModel
  extends Omit<SemanticModelSummary, "contentBytes"> {
  content: string;
}

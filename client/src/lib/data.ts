// Connector Hub — Types & State Maps

export type ConnectorStatus = "up" | "warn" | "down";
export type EnvType = "PROD" | "STG" | "DEV";

export interface Connector {
  id: string;
  name: string;
  bpn: string;
  status: ConnectorStatus;
  env: EnvType;
  roles: string[];
  dcp: string;
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
  ts: string;
  errorDetail?: string;
  agreementId?: string;
  assetId?: string;
  counterPartyAddress?: string;
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
  transferType?: string;
  errorDetail?: string;
  agreementId?: string;
  connectorId?: string;
}

export interface EDR {
  tpId: string;
  asset: string;
  prov: string;
  left: number;   // -1: expiresAt 없음(활성), 0: 만료, >0: 남은 분
  total: number;
  endpoint?: string;
  authCode?: string;
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
}

export type NegotiationStateName = "INITIAL" | "REQUESTING" | "OFFERED" | "ACCEPTED" | "AGREED" | "VERIFIED" | "FINALIZED" | "TERMINATED";
export type TransferStateName = "REQUESTING" | "STARTED" | "SUSPENDED" | "COMPLETED" | "TERMINATED";

export const NEG_STATE_MAP: Record<number, { name: NegotiationStateName; label: string; variant: string }> = {
  100:  { name: "INITIAL",    label: "초기화",                variant: "gray"   },
  200:  { name: "REQUESTING", label: "요청 전송 중",          variant: "blue"   },
  400:  { name: "OFFERED",    label: "프로바이더 오퍼 전달",   variant: "teal"   },
  600:  { name: "ACCEPTED",   label: "소비자 수락",            variant: "teal"   },
  800:  { name: "AGREED",     label: "프로바이더 합의",        variant: "teal"   },
  1000: { name: "VERIFIED",   label: "소비자 검증 완료",       variant: "teal"   },
  1200: { name: "FINALIZED",  label: "계약 성립",              variant: "green"  },
  1300: { name: "TERMINATED", label: "협상 종료",              variant: "red"    },
};

export const TRANSFER_STATE_MAP: Record<number, { name: TransferStateName; label: string; variant: string }> = {
  200:  { name: "REQUESTING", label: "요청 전송",      variant: "blue"  },
  400:  { name: "STARTED",    label: "전송 진행 중",   variant: "blue"  },
  800:  { name: "SUSPENDED",  label: "일시 중단",      variant: "amber" },
  1200: { name: "COMPLETED",  label: "전송 완료",      variant: "green" },
  1300: { name: "TERMINATED", label: "전송 실패",      variant: "red"   },
};

export const SINK_TYPES = ["HttpProxy", "HttpData", "AmazonS3", "AzureStorage"] as const;
export type SinkType = typeof SINK_TYPES[number];

export type SemanticModelStatus = "DRAFT" | "RELEASED" | "STANDARDIZED" | "DEPRECATED";

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

export interface SemanticModel extends Omit<SemanticModelSummary, "contentBytes"> {
  content: string;
}

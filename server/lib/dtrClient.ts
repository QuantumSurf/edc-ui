// KMX EDC — Digital Twin Registry (DTR) API Client
// Axios wrapper for tractusx/sldt-digital-twin-registry. Auth disabled in dev;
// when prod Keycloak is wired in, attach Authorization header in createDtrClient.

import axios, { type AxiosInstance, type AxiosError } from "axios";

export interface DtrClientConfig {
  baseUrl: string;          // e.g. http://platform-dtr:4243/semantics/registry
  token?: string;           // optional Bearer (prod)
  timeoutMs?: number;
}

export class DtrApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`DTR API Error (${status}): ${detail}`);
    this.name = "DtrApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function createDtrClient(config: DtrClientConfig): AxiosInstance {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.token) headers["Authorization"] = `Bearer ${config.token}`;
  // DTR's local profile filters reads by Edc-Bpn matching the owning tenant.
  // Sending the configured tenant id grants the BFF full visibility.
  const ownerBpn = process.env.DTR_OWNER_BPN ?? "default-tenant";
  if (ownerBpn) headers["Edc-Bpn"] = ownerBpn;

  const client = axios.create({
    baseURL: `${config.baseUrl.replace(/\/$/, "")}/api/v3`,
    timeout: config.timeoutMs ?? 10_000,
    headers,
  });

  client.interceptors.response.use(
    (res) => res,
    (error: AxiosError) => {
      if (error.response) {
        const data = error.response.data as unknown;
        let detail: string;
        if (data && typeof data === "object") {
          const obj = data as Record<string, unknown>;
          const msgs = (obj.messages as Array<{ text?: string }>) ?? null;
          if (Array.isArray(msgs) && msgs.length > 0) {
            detail = msgs.map((m) => m.text).filter(Boolean).join("; ");
          } else {
            detail = (obj.error as string) ?? (obj.message as string) ?? error.message;
          }
        } else {
          detail = error.message;
        }
        throw new DtrApiError(error.response.status, detail);
      }
      if (error.code === "ECONNREFUSED" || error.code === "ECONNABORTED") {
        throw new DtrApiError(503, `DTR unreachable: ${error.message}`);
      }
      throw new DtrApiError(500, error.message);
    },
  );

  return client;
}

let cachedClient: AxiosInstance | null = null;
let cachedKey = "";

export function getDtrClient(): AxiosInstance {
  const baseUrl = process.env.DTR_BASE_URL ?? "http://platform-dtr:4243/semantics/registry";
  const token = process.env.DTR_TOKEN;
  const key = `${baseUrl}|${token ?? ""}`;
  if (cachedClient && cachedKey === key) return cachedClient;
  cachedClient = createDtrClient({ baseUrl, token });
  cachedKey = key;
  return cachedClient;
}

/** Encode AAS identifier per AAS spec (base64url of UTF-8 bytes). */
export function encodeAasId(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

/* ── DTR JSON → simplified client model ───────────────────────── */

export interface SpecificAssetIdLite {
  name: string;
  value: string;
}

export interface EndpointLite {
  interfaceName: string;
  href: string;
  endpointProtocol: string;
  endpointProtocolVersion: string;
  subprotocol: string;
  subprotocolBody: string;
  subprotocolBodyEncoding: string;
}

export interface SubmodelDescriptorLite {
  id: string;
  idShort: string;
  semanticId: string;
  endpointCount: number;
  endpoints: EndpointLite[];
}

export interface ShellDescriptionLite {
  language: string;
  text: string;
}

export interface ShellDescriptorLite {
  id: string;
  idShort: string;
  globalAssetId: string;
  description: string;
  descriptions: ShellDescriptionLite[];
  specificAssetIds: SpecificAssetIdLite[];
  submodelCount: number;
  submodelDescriptors: SubmodelDescriptorLite[];
  createdAt: string;
}

function mapDescriptions(raw: unknown): ShellDescriptionLite[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) => {
      const obj = d as Record<string, unknown>;
      return {
        language: (obj.language as string) ?? "",
        text: (obj.text as string) ?? "",
      };
    })
    .filter((d) => d.text);
}

function mapSpecificAssetIds(raw: unknown): SpecificAssetIdLite[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      const obj = s as Record<string, unknown>;
      return {
        name: (obj.name as string) ?? "",
        value: (obj.value as string) ?? "",
      };
    })
    .filter((s) => s.name);
}

function mapEndpoint(raw: Record<string, unknown>): EndpointLite {
  const pi = (raw.protocolInformation as Record<string, unknown>) ?? {};
  const ver = pi.endpointProtocolVersion as string[] | string | undefined;
  return {
    interfaceName: (raw.interface as string) ?? "",
    href: (pi.href as string) ?? "",
    endpointProtocol: (pi.endpointProtocol as string) ?? "",
    endpointProtocolVersion: Array.isArray(ver) ? (ver[0] ?? "") : (ver ?? ""),
    subprotocol: (pi.subprotocol as string) ?? "",
    subprotocolBody: (pi.subprotocolBody as string) ?? "",
    subprotocolBodyEncoding: (pi.subprotocolBodyEncoding as string) ?? "",
  };
}

export function mapSubmodelDescriptor(raw: Record<string, unknown>): SubmodelDescriptorLite {
  const semantic = raw.semanticId as Record<string, unknown> | undefined;
  let semanticId = "";
  if (semantic) {
    const keys = (semantic.keys as Array<Record<string, unknown>>) ?? [];
    if (keys.length > 0) semanticId = (keys[0].value as string) ?? "";
  }
  const endpointsRaw = (raw.endpoints as Array<Record<string, unknown>> | undefined) ?? [];
  const endpoints = Array.isArray(endpointsRaw) ? endpointsRaw.map(mapEndpoint) : [];
  return {
    id: (raw.id as string) ?? "",
    idShort: (raw.idShort as string) ?? "",
    semanticId,
    endpointCount: endpoints.length,
    endpoints,
  };
}

export function mapShellDescriptor(raw: Record<string, unknown>): ShellDescriptorLite {
  const submodels = (raw.submodelDescriptors as Array<Record<string, unknown>>) ?? [];
  const descriptions = mapDescriptions(raw.description);
  return {
    id: (raw.id as string) ?? "",
    idShort: (raw.idShort as string) ?? "",
    globalAssetId: (raw.globalAssetId as string) ?? "",
    description: descriptions[0]?.text ?? "",
    descriptions,
    specificAssetIds: mapSpecificAssetIds(raw.specificAssetIds),
    submodelCount: submodels.length,
    submodelDescriptors: submodels.map(mapSubmodelDescriptor),
    createdAt: (raw.createdAt as string) ?? "",
  };
}

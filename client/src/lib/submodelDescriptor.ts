// KMX EDC — AAS Submodel Descriptor 데이터 모델·매퍼 (UI 비의존)
//
// DTR 서브모델 descriptor 의 편집용 타입과 raw(JSON) <-> 에디터 상태 변환을 담는다.
// 컴포넌트(SubmodelForm.tsx)에서 분리한 이유:
//  1) 순수 데이터 로직이라 UI 와 관심사가 다르고 단위 테스트가 쉬움
//  2) 컴포넌트 파일이 비-컴포넌트를 export 하면 React Fast Refresh 가 동작하지 않음
//     (react-refresh/only-export-components)
/* ─── Editor input types ─────────────────────────────────────── */
export interface ProtocolInfoInput {
  href: string;
  endpointProtocol: string;
  endpointProtocolVersion: string;
  subprotocol: string;
  subprotocolBodyEncoding: string;
  // For subprotocol="DSP": split subprotocolBody into two user-facing inputs
  // and re-compose at submit time (`id=<assetId>;dspEndpoint=<url>`).
  dspAssetId: string;
  dspEndpoint: string;
  // Free-form fallback for non-DSP subprotocols.
  subprotocolBodyRaw: string;
}

export interface EndpointInput {
  interfaceName: string;
  protocolInformation: ProtocolInfoInput;
  // endpoint 원본 — securityAttributes 등 모델링되지 않은 필드 보존용(id 39).
  raw?: Record<string, unknown>;
  rawPi?: Record<string, unknown>;
}

export interface SubmodelInput {
  id: string;
  idShort: string;
  semanticId: string;
  descriptionKo: string;
  descriptionEn: string;
  endpoints: EndpointInput[];
  // DTR PUT은 전체교체(replace)라 본 UI가 모델링하지 않는 필드(displayName·
  // administration·supplementalSemanticIds·securityAttributes 등)와 ko/en 외
  // 언어 description이 통째로 소실된다. 원본 raw를 보존해 submit 시 머지한다
  // (id 39 데이터 무결성 / id 40 다국어 description 보존).
  raw?: Record<string, unknown>;
  // ko/en 외 언어 description 항목 (편집 대상이 아니므로 그대로 carry-over)
  descriptionRaw?: Array<{ language?: string; text?: string }>;
}

/* ─── Constructors ───────────────────────────────────────────── */
export const newProtocolInfo = (): ProtocolInfoInput => ({
  href: "",
  endpointProtocol: "HTTP",
  endpointProtocolVersion: "1.1",
  subprotocol: "DSP",
  subprotocolBodyEncoding: "plain",
  dspAssetId: "",
  dspEndpoint: "",
  subprotocolBodyRaw: "",
});

export const newEndpoint = (): EndpointInput => ({
  interfaceName: "SUBMODEL-3.0",
  protocolInformation: newProtocolInfo(),
});

export const newSubmodel = (): SubmodelInput => ({
  id: "",
  idShort: "",
  semanticId: "",
  descriptionKo: "",
  descriptionEn: "",
  endpoints: [newEndpoint()],
});

/* ─── DSP body helpers ───────────────────────────────────────── */
/** Compose the wire `subprotocolBody` from editor inputs. */
export function buildSubprotocolBody(pi: ProtocolInfoInput): string {
  if (pi.subprotocol === "DSP") {
    const parts: string[] = [];
    if (pi.dspAssetId) parts.push(`id=${pi.dspAssetId}`);
    if (pi.dspEndpoint) parts.push(`dspEndpoint=${pi.dspEndpoint}`);
    return parts.join(";");
  }
  return pi.subprotocolBodyRaw;
}

/** Parse `id=...;dspEndpoint=...` style body into helper fields. */
export function parseDspBody(body: string): {
  dspAssetId: string;
  dspEndpoint: string;
} {
  const out = { dspAssetId: "", dspEndpoint: "" };
  if (!body) return out;
  // dspEndpoint는 URL이라 ';'/'='가 포함될 수 있으므로 'dspEndpoint=' 이후
  // 전부를 endpoint로 취한다(greedy). 그 앞부분만 ';'로 분해(id 43 round-trip).
  const epIdx = body.indexOf("dspEndpoint=");
  let head = body;
  if (epIdx >= 0) {
    out.dspEndpoint = body.slice(epIdx + "dspEndpoint=".length).trim();
    head = body.slice(0, epIdx).replace(/;\s*$/, "");
  }
  for (const part of head.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "id") out.dspAssetId = v;
  }
  return out;
}

/* ─── Raw <-> Editor mappers ─────────────────────────────────── */
function findByLang(
  desc: Array<{ language?: string; text?: string }>,
  langs: string[]
): string {
  for (const l of langs) {
    const m = desc.find(d => (d.language ?? "").toLowerCase().startsWith(l));
    if (m?.text) return m.text;
  }
  return "";
}

export function rawEndpointToInput(ep: Record<string, unknown>): EndpointInput {
  const pi = (ep.protocolInformation as Record<string, unknown>) ?? {};
  const ver = pi.endpointProtocolVersion as string[] | string | undefined;
  const subprotocol = (pi.subprotocol as string) ?? "DSP";
  const body = (pi.subprotocolBody as string) ?? "";
  const parsed =
    subprotocol === "DSP"
      ? parseDspBody(body)
      : { dspAssetId: "", dspEndpoint: "" };
  return {
    interfaceName: (ep.interface as string) ?? "SUBMODEL-3.0",
    protocolInformation: {
      href: (pi.href as string) ?? "",
      endpointProtocol: (pi.endpointProtocol as string) ?? "HTTP",
      endpointProtocolVersion: Array.isArray(ver)
        ? (ver[0] ?? "1.1")
        : (ver ?? "1.1"),
      subprotocol,
      subprotocolBodyEncoding:
        (pi.subprotocolBodyEncoding as string) ?? "plain",
      dspAssetId: parsed.dspAssetId,
      dspEndpoint: parsed.dspEndpoint,
      subprotocolBodyRaw: subprotocol === "DSP" ? "" : body,
    },
    raw: ep,
    rawPi: pi,
  };
}

export function rawSubmodelToInput(
  raw: Record<string, unknown>
): SubmodelInput {
  const sem = raw.semanticId as Record<string, unknown> | undefined;
  const semKeys = (sem?.keys as Array<Record<string, unknown>>) ?? [];
  const eps = (raw.endpoints as Array<Record<string, unknown>>) ?? [];
  const desc =
    (raw.description as Array<{ language?: string; text?: string }>) ?? [];
  return {
    id: (raw.id as string) ?? "",
    idShort: (raw.idShort as string) ?? "",
    semanticId: (semKeys[0]?.value as string) ?? "",
    descriptionKo: findByLang(desc, ["ko"]),
    descriptionEn: findByLang(desc, ["en"]),
    endpoints: eps.length === 0 ? [newEndpoint()] : eps.map(rawEndpointToInput),
    raw,
    // ko/en 외 언어 항목만 따로 보존(편집값으로 덮어쓰지 않고 머지) — id 40.
    descriptionRaw: desc.filter(d => {
      const l = (d.language ?? "").toLowerCase();
      return !l.startsWith("ko") && !l.startsWith("en");
    }),
  };
}

/** Build the DTR PUT/POST body for a single submodel descriptor. */
export function submodelInputToBody(s: SubmodelInput): Record<string, unknown> {
  // ko/en 편집값 + 보존된 비-ko/en 언어 항목을 합친다(id 40).
  const descriptions: Array<{ language?: string; text?: string }> = [
    ...(s.descriptionRaw ?? []),
  ];
  if (s.descriptionKo)
    descriptions.push({ language: "ko", text: s.descriptionKo });
  if (s.descriptionEn)
    descriptions.push({ language: "en", text: s.descriptionEn });
  // DTR은 전체교체라 raw를 base로 머지해 비모델링 필드를 보존한다(id 39).
  const body: Record<string, unknown> = {
    ...(s.raw ?? {}),
    id: s.id,
    idShort: s.idShort,
    endpoints: s.endpoints.map(ep => {
      const builtPi: Record<string, unknown> = {
        // endpoint 원본 protocolInformation 위에 모델링된 필드만 덮어쓰기.
        ...(ep.rawPi ?? {}),
        href: ep.protocolInformation.href,
        endpointProtocol: ep.protocolInformation.endpointProtocol,
        endpointProtocolVersion: [
          ep.protocolInformation.endpointProtocolVersion,
        ],
        subprotocol: ep.protocolInformation.subprotocol,
        subprotocolBody: buildSubprotocolBody(ep.protocolInformation),
        subprotocolBodyEncoding: ep.protocolInformation.subprotocolBodyEncoding,
        // 원본 securityAttributes 보존, 없을 때만 NONE 폴백.
        securityAttributes: (ep.rawPi?.securityAttributes as unknown) ?? [
          { type: "NONE", key: "NONE", value: "NONE" },
        ],
      };
      return {
        ...(ep.raw ?? {}),
        interface: ep.interfaceName,
        protocolInformation: builtPi,
      };
    }),
  };
  // semanticId·description은 폼에서 편집 가능한 모델링 필드라, 비웠으면
  // raw에서 carry-over된 값을 제거해 사용자의 삭제 의도를 보존한다(머지 회귀 방지).
  if (s.semanticId) {
    body.semanticId = {
      type: "ExternalReference",
      keys: [{ type: "GlobalReference", value: s.semanticId }],
    };
  } else {
    delete body.semanticId;
  }
  if (descriptions.length > 0) body.description = descriptions;
  else delete body.description;
  return body;
}

// Shared types, helpers and components for editing a single AAS Submodel
// Descriptor and rendering its endpoint detail block. Used by both PageShells
// (multi-submodel editor) and PageSubmodels (single submodel CRUD).

import { useId } from "react";
import { useI18n } from "@/i18n";
import { FormField, MonoText, Badge } from "@/components/ui-kmx";
import { X, Copy, AlertCircle, CheckCircle2 } from "lucide-react";
import type { ShellEndpoint } from "@/lib/data";
import { cn } from "@/lib/utils";
import {
  SEMANTIC_TEMPLATES,
  recognizeSemanticId,
} from "@/lib/semanticTemplates";
import {
  isValidIdShort,
  isLikelyIri,
  isLikelyGlobalReference,
} from "@/lib/descriptorValidation";

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

/** 비차단 형식 경고(황색) — descriptor 형식 힌트용. 저장은 막지 않는다. */
function DescriptorWarn({ text }: { text: string }) {
  return (
    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
      <AlertCircle className="w-3 h-3 flex-shrink-0" />
      <span>{text}</span>
    </div>
  );
}

/* ─── SubmodelFormFields ─────────────────────────────────────── */
/** Renders the full editable form for ONE submodel descriptor. */
export function SubmodelFormFields({
  submodel,
  onChange,
  onRemove,
  index,
  showHeader = true,
  showDescription = true,
  duplicateIdShort = false,
  duplicateId = false,
}: {
  submodel: SubmodelInput;
  onChange: (next: SubmodelInput) => void;
  onRemove?: () => void;
  index?: number;
  showHeader?: boolean;
  showDescription?: boolean;
  /** 같은 셸 내 형제 서브모델과 idShort/id 가 중복될 때(부모가 계산해 전달). */
  duplicateIdShort?: boolean;
  duplicateId?: boolean;
}) {
  const { t } = useI18n();
  const s = submodel;
  const semId = useId();
  const recognized = recognizeSemanticId(s.semanticId);

  const updateField = <K extends keyof SubmodelInput>(
    key: K,
    value: SubmodelInput[K]
  ) => {
    onChange({ ...s, [key]: value });
  };

  const updateEndpoint = (ei: number, patch: Partial<EndpointInput>) => {
    const eps = [...s.endpoints];
    eps[ei] = { ...eps[ei], ...patch };
    onChange({ ...s, endpoints: eps });
  };

  const updatePi = (ei: number, patch: Partial<ProtocolInfoInput>) => {
    const eps = [...s.endpoints];
    eps[ei] = {
      ...eps[ei],
      protocolInformation: { ...eps[ei].protocolInformation, ...patch },
    };
    onChange({ ...s, endpoints: eps });
  };

  return (
    <div className="rounded border border-border p-2.5 bg-muted/20 space-y-2 min-w-0">
      {showHeader && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Submodel{typeof index === "number" ? ` #${index + 1}` : ""}
          </span>
          {onRemove && (
            <button
              onClick={onRemove}
              className="text-muted-foreground hover:text-rose-600"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      <div>
        <input
          aria-label={t.twins.form.subIdShort}
          aria-required
          aria-invalid={!!s.idShort && !isValidIdShort(s.idShort)}
          placeholder={t.twins.form.subIdShort + " *"}
          value={s.idShort}
          onChange={e => updateField("idShort", e.target.value)}
          className="w-full px-2 py-1 text-[11px] border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {s.idShort && !isValidIdShort(s.idShort) && (
          <DescriptorWarn text={t.twins.form.idShortWarn} />
        )}
        {duplicateIdShort && (
          <DescriptorWarn text={t.twins.form.duplicateSibling} />
        )}
      </div>
      <div>
        <input
          aria-label={t.twins.form.subId}
          aria-required
          aria-invalid={!!s.id && !isLikelyIri(s.id)}
          placeholder={t.twins.form.subId + " *"}
          value={s.id}
          onChange={e => updateField("id", e.target.value)}
          className="w-full px-2 py-1 text-[11px] mono border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {s.id && !isLikelyIri(s.id) && (
          <DescriptorWarn text={t.twins.form.iriWarn} />
        )}
        {duplicateId && <DescriptorWarn text={t.twins.form.duplicateSibling} />}
      </div>
      <div>
        <input
          aria-label={t.twins.form.subSemanticId}
          placeholder={t.twins.form.subSemanticId}
          value={s.semanticId}
          list={semId}
          onChange={e => updateField("semanticId", e.target.value)}
          className="w-full px-2 py-1 text-[11px] mono border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {/* 표준 템플릿 semanticId 추천 목록(재사용 유도) */}
        <datalist id={semId}>
          {SEMANTIC_TEMPLATES.map(tpl => (
            <option key={tpl.semanticId} value={tpl.semanticId}>
              {tpl.name} · {tpl.ref}
            </option>
          ))}
        </datalist>
        {recognized ? (
          <>
            <div
              className={cn(
                "mt-0.5 flex items-center gap-1 text-[10px]",
                // 정본 매칭=초록, 계열만 일치(버전/경로 드리프트)=황색 주의
                recognized.caution
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              )}
            >
              {recognized.caution ? (
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
              )}
              <span className="truncate">
                {t.twins.form.templateRecognized}: {recognized.name}
                <span className="text-muted-foreground">
                  {" "}
                  ({recognized.source}
                  {recognized.ref ? ` · ${recognized.ref}` : ""})
                </span>
              </span>
            </div>
            {recognized.caution && (
              <DescriptorWarn text={t.twins.form.templateCaution} />
            )}
          </>
        ) : s.semanticId && !isLikelyGlobalReference(s.semanticId) ? (
          <DescriptorWarn text={t.twins.form.semanticIdWarn} />
        ) : (
          !s.semanticId && (
            <p className="mt-0.5 text-[10px] text-muted-foreground leading-snug">
              {t.twins.form.subSemanticIdHint}
            </p>
          )
        )}
      </div>

      {showDescription && (
        <>
          <input
            aria-label={t.twins.form.descriptionKo}
            placeholder={t.twins.form.descriptionKo}
            value={s.descriptionKo}
            onChange={e => updateField("descriptionKo", e.target.value)}
            lang="ko"
            className="w-full px-2 py-1 text-[11px] border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            aria-label={t.twins.form.descriptionEn}
            placeholder={t.twins.form.descriptionEn}
            value={s.descriptionEn}
            onChange={e => updateField("descriptionEn", e.target.value)}
            lang="en"
            className="w-full px-2 py-1 text-[11px] border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </>
      )}

      {/* Endpoints */}
      <div className="pt-1.5 border-t border-border">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Endpoint
          </span>
          <button
            onClick={() =>
              onChange({ ...s, endpoints: [...s.endpoints, newEndpoint()] })
            }
            className="text-[10px] text-primary hover:underline"
          >
            + {t.twins.form.addEndpoint}
          </button>
        </div>
        <div className="space-y-2">
          {s.endpoints.map((ep, ei) => {
            const isDsp = ep.protocolInformation.subprotocol === "DSP";
            const composedBody = buildSubprotocolBody(ep.protocolInformation);
            return (
              <div
                key={ei}
                className="rounded border border-border p-2 bg-card space-y-1.5 min-w-0 overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    Endpoint #{ei + 1}
                  </span>
                  <button
                    onClick={() =>
                      onChange({
                        ...s,
                        endpoints: s.endpoints.filter((_, j) => j !== ei),
                      })
                    }
                    className="text-muted-foreground hover:text-rose-600"
                    disabled={s.endpoints.length === 1}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <input
                  aria-label={t.twins.form.endpointInterface}
                  placeholder={
                    t.twins.form.endpointInterface + " (e.g. SUBMODEL-3.0)"
                  }
                  value={ep.interfaceName}
                  onChange={e =>
                    updateEndpoint(ei, { interfaceName: e.target.value })
                  }
                  className="w-full px-2 py-1 text-[11px] border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {/* Protocol Information */}
                <div className="pl-2 border-l-2 border-violet-300 space-y-1.5">
                  <span className="text-[10px] text-violet-600 dark:text-violet-400 font-semibold uppercase tracking-wide">
                    Protocol Information
                  </span>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    {t.twins.form.dspNote}
                  </p>

                  <FormField
                    label={t.twins.form.endpointHref + " *"}
                    hint={t.twins.form.hrefHint}
                  >
                    <input
                      placeholder="https://provider-edc/data-plane/{path}"
                      value={ep.protocolInformation.href}
                      onChange={e => updatePi(ei, { href: e.target.value })}
                      className="w-full px-2 py-1 text-[11px] mono border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </FormField>

                  <div className="flex gap-1.5">
                    <input
                      aria-label="endpointProtocol"
                      placeholder="endpointProtocol"
                      value={ep.protocolInformation.endpointProtocol}
                      onChange={e =>
                        updatePi(ei, { endpointProtocol: e.target.value })
                      }
                      className="flex-1 px-2 py-1 text-[11px] border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <input
                      aria-label="endpointProtocolVersion"
                      placeholder="endpointProtocolVersion"
                      value={ep.protocolInformation.endpointProtocolVersion}
                      onChange={e =>
                        updatePi(ei, {
                          endpointProtocolVersion: e.target.value,
                        })
                      }
                      className="flex-1 px-2 py-1 text-[11px] border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <FormField
                    label={t.twins.form.subprotocol}
                    hint={t.twins.form.subprotocolHint}
                  >
                    <select
                      value={ep.protocolInformation.subprotocol}
                      onChange={e =>
                        updatePi(ei, { subprotocol: e.target.value })
                      }
                      className="w-full px-2 py-1 text-[11px] border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="DSP">DSP</option>
                      <option value="">(none)</option>
                    </select>
                  </FormField>

                  {isDsp ? (
                    <>
                      <FormField
                        label={t.twins.form.dspAssetId}
                        hint={t.twins.form.dspAssetIdHint}
                      >
                        <input
                          placeholder="urn:uuid:edc-asset-id"
                          value={ep.protocolInformation.dspAssetId}
                          onChange={e =>
                            updatePi(ei, { dspAssetId: e.target.value })
                          }
                          className="w-full px-2 py-1 text-[11px] mono border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </FormField>
                      <FormField
                        label={t.twins.form.dspEndpoint}
                        hint={t.twins.form.dspEndpointHint}
                      >
                        <input
                          placeholder="https://provider-edc/api/v1/dsp"
                          value={ep.protocolInformation.dspEndpoint}
                          onChange={e =>
                            updatePi(ei, { dspEndpoint: e.target.value })
                          }
                          className="w-full px-2 py-1 text-[11px] mono border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </FormField>
                      <div className="text-[10px] text-muted-foreground">
                        <span className="uppercase tracking-wide">
                          {t.twins.form.subprotocolBodyPreview}
                        </span>
                        <MonoText className="block !text-[10px] !font-normal break-all bg-muted/50 rounded px-1.5 py-1 mt-0.5">
                          {composedBody || "—"}
                        </MonoText>
                      </div>
                    </>
                  ) : (
                    <FormField label={t.twins.form.subprotocolBody}>
                      <input
                        placeholder="raw subprotocolBody"
                        value={ep.protocolInformation.subprotocolBodyRaw}
                        onChange={e =>
                          updatePi(ei, { subprotocolBodyRaw: e.target.value })
                        }
                        className="w-full px-2 py-1 text-[11px] mono border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </FormField>
                  )}

                  <FormField label={t.twins.form.subprotocolBodyEncoding}>
                    <input
                      value={ep.protocolInformation.subprotocolBodyEncoding}
                      onChange={e =>
                        updatePi(ei, {
                          subprotocolBodyEncoding: e.target.value,
                        })
                      }
                      className="w-full px-2 py-1 text-[11px] border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </FormField>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── EndpointDetail (read-only display) ─────────────────────── */
export function EndpointDetail({
  ep,
  index,
  onCopy,
}: {
  ep: ShellEndpoint;
  index: number;
  onCopy: (s: string) => void;
}) {
  const isDsp = ep.subprotocol === "DSP";
  const parsed = isDsp
    ? parseDspBody(ep.subprotocolBody)
    : { dspAssetId: "", dspEndpoint: "" };
  return (
    <div className="rounded border border-border bg-card p-2 space-y-1 min-w-0 overflow-hidden">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Endpoint #{index + 1}
        </span>
        {ep.interfaceName && <Badge variant="gray">{ep.interfaceName}</Badge>}
      </div>
      <EndpointRow
        label="href (Data Plane)"
        value={ep.href}
        mono
        onCopy={onCopy}
        showEmpty
      />
      <EndpointRow
        label="protocol"
        value={[ep.endpointProtocol, ep.endpointProtocolVersion]
          .filter(Boolean)
          .join(" / ")}
      />
      {ep.subprotocol && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <span className="text-[10px] text-muted-foreground">
            subprotocol:
          </span>
          <Badge variant={isDsp ? "purple" : "gray"}>{ep.subprotocol}</Badge>
          {ep.subprotocolBodyEncoding && (
            <span className="text-[10px] text-muted-foreground ml-1">
              encoding: {ep.subprotocolBodyEncoding}
            </span>
          )}
        </div>
      )}
      {isDsp ? (
        <>
          <EndpointRow
            label="Provider Asset ID"
            value={parsed.dspAssetId}
            mono
            onCopy={onCopy}
            showEmpty
          />
          <EndpointRow
            label="Provider DSP Endpoint"
            value={parsed.dspEndpoint}
            mono
            onCopy={onCopy}
            showEmpty
          />
        </>
      ) : (
        ep.subprotocolBody && (
          <EndpointRow
            label="subprotocolBody"
            value={ep.subprotocolBody}
            mono
            onCopy={onCopy}
          />
        )
      )}
    </div>
  );
}

export function EndpointRow({
  label,
  value,
  mono,
  onCopy,
  showEmpty,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: (s: string) => void;
  showEmpty?: boolean;
}) {
  // 훅은 조기 반환 이전에 호출(훅 규칙) — 복사 버튼 aria-label용 t 확보
  const { t } = useI18n();
  if (!value && !showEmpty) return null;
  const display = value || "—";
  const empty = !value;
  return (
    <div className="flex items-start gap-2 group min-w-0">
      <span className="text-[10px] text-muted-foreground min-w-[110px] flex-shrink-0 pt-0.5">
        {label}
      </span>
      {mono ? (
        <MonoText
          className={`!text-[11px] !font-normal break-all flex-1 min-w-0 ${empty ? "text-muted-foreground" : ""}`}
        >
          {display}
        </MonoText>
      ) : (
        <span
          className={`text-[11px] flex-1 break-words min-w-0 ${empty ? "text-muted-foreground" : ""}`}
        >
          {display}
        </span>
      )}
      {onCopy && value && (
        <button
          type="button"
          aria-label={t.common.copy}
          onClick={() => onCopy(value)}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 flex-shrink-0 mt-0.5"
        >
          <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
        </button>
      )}
    </div>
  );
}

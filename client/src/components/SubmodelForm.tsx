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

import {
  type ProtocolInfoInput,
  type EndpointInput,
  type SubmodelInput,
  newEndpoint,
  buildSubprotocolBody,
  parseDspBody,
} from "@/lib/submodelDescriptor";

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

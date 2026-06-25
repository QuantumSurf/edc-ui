// Expose a single DTR submodel to the EDC catalog.
// Orchestrates (provider-side): create Asset (cx-taxo:SubmodelBundle) →
// create ContractDefinition (Offering) → link the DTR submodel descriptor's
// endpoint (subprotocolBody=id=<assetId>;dspEndpoint=<dsp>, href=data plane).
// Reuses existing connector-scoped services + SubmodelForm helpers.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  fetchConnectors,
  createAsset,
  updateAsset,
  createOffering,
  fetchPolicies,
  fetchShellRaw,
  updateSubmodel,
} from "@/services";
import {
  rawSubmodelToInput,
  submodelInputToBody,
  newEndpoint,
} from "@/components/SubmodelForm";
import { FormField, PrimaryActionButton, inputBase } from "@/components/ui-kmx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Share2, AlertCircle, X } from "lucide-react";
import { toast } from "sonner";

export interface ExposeTarget {
  aasId: string;
  submodelId: string;
  idShort: string;
  semanticId: string;
}

// 공용 inputBase 사용 — mono 값 입력의 placeholder는 카탈로그 브라우저와 동일하게 sans로 통일.
const inputCls = `${inputBase} placeholder:font-sans placeholder:font-normal`;

// axios 에러의 HTTP status 추출(409 멱등 분기용 — id 41).
function errStatus(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status;
}

export function ExposeSubmodelDialog({
  target,
  onClose,
  onDone,
}: {
  target: ExposeTarget | null;
  onClose: () => void;
  // 노출 대상 커넥터 id를 전달해 호출부가 정확한 캐시만 무효화하게 한다(id 37).
  onDone: (connectorId: string) => void;
}) {
  const { t, locale } = useI18n();
  const storeConnector = useConnectorStore(s => s.connector);
  const open = !!target;

  const [connectorId, setConnectorId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [dataSourceUrl, setDataSourceUrl] = useState("");
  const [dataPlaneHref, setDataPlaneHref] = useState("");
  const [accessPolicyId, setAccessPolicyId] = useState("");
  const [contractPolicyId, setContractPolicyId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: connectors = [] } = useQuery({
    queryKey: ["connectors"],
    queryFn: fetchConnectors,
    enabled: open,
  });
  const connector = connectors.find(c => c.id === connectorId);

  // Reset whenever a new submodel is targeted.
  useEffect(() => {
    if (target) {
      setAssetId(target.submodelId);
      setDataSourceUrl("");
      setDataPlaneHref("");
      setAccessPolicyId("");
      setContractPolicyId("");
      setConnectorId(storeConnector?.id ?? "");
    }
  }, [target, storeConnector?.id]);

  useEffect(() => {
    if (open && !connectorId && connectors.length > 0)
      setConnectorId(connectors[0].id);
  }, [open, connectorId, connectors]);

  const { data: policies = [], isLoading: polLoading } = useQuery({
    queryKey: ["policies", connectorId],
    queryFn: () => fetchPolicies(connectorId),
    enabled: open && !!connectorId,
  });

  // 기본 정책 선택 — 재오픈 시 policies가 캐시(fresh)면 배열 참조가 그대로라
  // [policies]만으로는 재실행되지 않으므로 open도 의존성에 포함한다.
  // 커넥터 변경 등으로 현재 값이 목록에 없으면 첫 정책으로 되돌린다.
  useEffect(() => {
    if (!open || policies.length === 0) return;
    setAccessPolicyId(prev =>
      policies.some(p => p.id === prev) ? prev : policies[0].id
    );
    setContractPolicyId(prev =>
      policies.some(p => p.id === prev) ? prev : policies[0].id
    );
  }, [open, policies]);

  const handleSubmit = async () => {
    if (!target) return;
    if (!connectorId) {
      toast.error(t.twins.expose.needConnector);
      return;
    }
    if (!assetId.trim()) {
      toast.error(t.twins.expose.requiredFields);
      return;
    }
    if (!dataSourceUrl.trim()) {
      toast.error(t.twins.expose.needDataSource);
      return;
    }
    if (!accessPolicyId || !contractPolicyId) {
      toast.error(t.twins.expose.needPolicies);
      return;
    }
    const aid = assetId.trim();
    const assetBody = {
      id: aid,
      name: target.idShort || aid,
      type: "cx-taxo:SubmodelBundle",
      sem: target.semanticId || "",
      aasId: target.aasId,
      submodelId: target.submodelId,
      dataAddressType: "HttpData",
      baseUrl: dataSourceUrl.trim(),
      proxyPath: "true",
      contentType: "application/json",
    };
    setBusy(true);
    try {
      // 1) EDC Asset (SubmodelBundle) — data source behind the connector's data plane.
      // 부분 실패 후 재시도 시 동일 ID가 409로 영구 차단되지 않도록 멱등 처리:
      // 이미 존재(409)하면 PUT(updateAsset, EDC upsert)으로 갱신한다(id 41).
      try {
        await createAsset(assetBody, connectorId);
      } catch (e) {
        if (errStatus(e) === 409) await updateAsset(aid, assetBody, connectorId);
        else throw e;
      }
    } catch (e) {
      setBusy(false);
      toast.error(`${t.twins.expose.failAsset}: ${(e as Error).message}`);
      return;
    }
    try {
      // 2) ContractDefinition (Offering) — makes the asset appear in the catalog.
      await createOffering(
        {
          id: `${aid}-cd`,
          asset: aid,
          access: accessPolicyId,
          contract: contractPolicyId,
        },
        connectorId
      );
    } catch (e) {
      // 계약정의가 이미 존재(409)하면 통과하고 링크 단계로 진행(id 41 재시도).
      if (errStatus(e) !== 409) {
        setBusy(false);
        toast.error(`${t.twins.expose.failOffering}: ${(e as Error).message}`);
        return;
      }
    }
    try {
      // 3) Link the DTR submodel descriptor's endpoint to the EDC asset.
      const raw = await fetchShellRaw(target.aasId);
      const subs =
        (raw?.submodelDescriptors as Array<Record<string, unknown>>) ?? [];
      const rawSub = subs.find(s => (s.id as string) === target.submodelId);
      // 대상 서브모델 미발견(DTR 조회 실패 또는 ID 불일치)을 조용히 건너뛰지
      // 않는다 — endpoint 미연결이 성공으로 오인되면 소비자가 협상 불가(id 38).
      if (!rawSub) {
        throw new Error(
          locale === "ko"
            ? "트윈에서 대상 서브모델을 찾지 못했습니다 (DTR 조회 실패 또는 ID 불일치)"
            : "Target submodel not found in the twin (DTR lookup failed or ID mismatch)"
        );
      }
      const input = rawSubmodelToInput(rawSub);
      if (input.endpoints.length === 0) input.endpoints = [newEndpoint()];
      const pi = input.endpoints[0].protocolInformation;
      pi.subprotocol = "DSP";
      pi.dspAssetId = aid;
      pi.dspEndpoint = connector?.dspEndpoint ?? "";
      pi.href = dataPlaneHref.trim() || dataSourceUrl.trim();
      await updateSubmodel(
        target.aasId,
        target.submodelId,
        submodelInputToBody(input)
      );
    } catch (e) {
      setBusy(false);
      toast.error(`${t.twins.expose.failLink}: ${(e as Error).message}`);
      return;
    }
    setBusy(false);
    toast.success(t.twins.expose.success);
    onDone(connectorId);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-w-xl p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton={false}
        onEscapeKeyDown={e => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={e => {
          if (busy) e.preventDefault();
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-border bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Share2 className="w-4 h-4 text-primary flex-shrink-0" />
            <DialogTitle className="text-[15px] font-semibold text-foreground truncate">
              {t.twins.expose.title}
            </DialogTitle>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label={t.common.close}
            className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4 space-y-3.5 text-[12px]">
          <DialogDescription className="text-[12px] text-muted-foreground leading-snug">
            {t.twins.expose.desc}
          </DialogDescription>
          {target && (
            <div className="rounded-md bg-muted/40 border border-border px-3 py-2">
              <p className="text-[11px] font-semibold text-muted-foreground">
                Submodel
              </p>
              <p className="text-[13px] font-semibold text-foreground truncate">
                {target.idShort || target.submodelId}
              </p>
              <p className="mono text-[11px] text-muted-foreground truncate">
                {target.submodelId}
              </p>
            </div>
          )}

          {connectors.length === 0 ? (
            <div className="flex items-start gap-2 text-[12px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded px-3 py-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{t.twins.expose.noConnectors}</span>
            </div>
          ) : (
            <>
              <FormField label={t.twins.expose.selectConnector} required>
                <select
                  className={inputCls}
                  value={connectorId}
                  disabled={busy}
                  onChange={e => setConnectorId(e.target.value)}
                >
                  {connectors.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.bpn}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Asset ID" required>
                <input
                  className={`${inputCls} mono`}
                  value={assetId}
                  disabled={busy}
                  onChange={e => setAssetId(e.target.value)}
                />
              </FormField>
              <FormField
                label={t.twins.expose.dataSourceUrl}
                hint={t.twins.expose.dataSourceHint}
                required
              >
                <input
                  className={`${inputCls} mono`}
                  placeholder="https://backend/submodel/data"
                  value={dataSourceUrl}
                  disabled={busy}
                  onChange={e => setDataSourceUrl(e.target.value)}
                />
              </FormField>
              <FormField
                label={t.twins.expose.dataPlaneHref}
                hint={t.twins.expose.dataPlaneHrefHint}
              >
                <input
                  className={`${inputCls} mono`}
                  placeholder={
                    dataSourceUrl || "https://provider-dataplane/public/..."
                  }
                  value={dataPlaneHref}
                  disabled={busy}
                  onChange={e => setDataPlaneHref(e.target.value)}
                />
              </FormField>

              {policies.length === 0 && !polLoading ? (
                <div className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{t.twins.expose.noPolicies}</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField label={t.twins.expose.accessPolicy} required>
                    <select
                      className={inputCls}
                      value={accessPolicyId}
                      disabled={busy}
                      onChange={e => setAccessPolicyId(e.target.value)}
                    >
                      {policies.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.id}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label={t.twins.expose.contractPolicy} required>
                    <select
                      className={inputCls}
                      value={contractPolicyId}
                      disabled={busy}
                      onChange={e => setContractPolicyId(e.target.value)}
                    >
                      {policies.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.id}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-sm rounded-md border border-border hover:bg-muted text-foreground/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <X className="w-3.5 h-3.5" />
            {t.common.cancel}
          </button>
          <PrimaryActionButton
            onClick={handleSubmit}
            disabled={busy || connectors.length === 0 || policies.length === 0}
            icon={
              busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Share2 className="w-3.5 h-3.5" />
              )
            }
          >
            {busy ? t.twins.expose.submitting : t.twins.expose.submit}
          </PrimaryActionButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

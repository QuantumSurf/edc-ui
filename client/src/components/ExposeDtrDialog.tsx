// Expose the Digital Twin Registry (DTR) itself to the EDC catalog.
// Standard Catena-X discovery pattern: the DTR endpoint becomes ONE EDC asset
// of type cx-taxo:DigitalTwinRegistry + a contract definition. A consumer
// discovers it in the provider catalog, negotiates, gets an EDR, then queries
// the DTR through the data plane to discover all registered twins.
// Reuses connector-scoped services (createAsset + createOffering); no shell wiring.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { useConnectorStore } from "@/stores/connectorStore";
import { fetchConnectors, createAsset, createOffering, fetchPolicies } from "@/services";
import { FormField, PrimaryActionButton, inputBase } from "@/components/ui-kmx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Share2, AlertCircle, X } from "lucide-react";
import { toast } from "sonner";

// 공용 inputBase 사용 — mono 값 입력의 placeholder는 카탈로그 브라우저와 동일하게 sans로 통일.
const inputCls = `${inputBase} placeholder:font-sans placeholder:font-normal`;

const DTR_URL_DEFAULT = "http://platform-dtr:4243/semantics/registry/api/v3";

export function ExposeDtrDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const storeConnector = useConnectorStore((s) => s.connector);

  const [connectorId, setConnectorId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [dtrUrl, setDtrUrl] = useState("");
  const [accessPolicyId, setAccessPolicyId] = useState("");
  const [contractPolicyId, setContractPolicyId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: connectors = [] } = useQuery({
    queryKey: ["connectors"],
    queryFn: fetchConnectors,
    enabled: open,
  });
  const connector = connectors.find((c) => c.id === connectorId);

  // Init on open: prefill DTR URL; default connector = store selection or first.
  useEffect(() => {
    if (open) {
      setDtrUrl(DTR_URL_DEFAULT);
      setAccessPolicyId("");
      setContractPolicyId("");
      setConnectorId(storeConnector?.id ?? "");
    }
  }, [open, storeConnector?.id]);

  // Default connector to the first available once the list loads.
  useEffect(() => {
    if (open && !connectorId && connectors.length > 0) setConnectorId(connectors[0].id);
  }, [open, connectorId, connectors]);

  // Asset ID default tracks the selected connector's BPN.
  useEffect(() => {
    if (open) setAssetId(connector?.bpn ? `dtr-${connector.bpn}` : "digital-twin-registry");
  }, [open, connector?.bpn]);

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
    setAccessPolicyId((prev) => policies.some((p) => p.id === prev) ? prev : policies[0].id);
    setContractPolicyId((prev) => policies.some((p) => p.id === prev) ? prev : policies[0].id);
  }, [open, policies]);

  const handleSubmit = async () => {
    if (!connectorId) { toast.error(t.twins.expose.needConnector); return; }
    if (!assetId.trim()) { toast.error(t.twins.exposeDtr.requiredFields); return; }
    if (!dtrUrl.trim()) { toast.error(t.twins.exposeDtr.needUrl); return; }
    if (!accessPolicyId || !contractPolicyId) { toast.error(t.twins.expose.needPolicies); return; }
    const aid = assetId.trim();
    setBusy(true);
    try {
      await createAsset(
        {
          id: aid,
          name: "Digital Twin Registry",
          type: "cx-taxo:DigitalTwinRegistry",
          dataAddressType: "HttpData",
          baseUrl: dtrUrl.trim(),
          proxyPath: "true",
          proxyQueryParams: "true",
          contentType: "application/json",
        },
        connectorId,
      );
    } catch (e) {
      setBusy(false);
      toast.error(`${t.twins.exposeDtr.failAsset}: ${(e as Error).message}`);
      return;
    }
    try {
      await createOffering(
        { id: `${aid}-cd`, asset: aid, access: accessPolicyId, contract: contractPolicyId },
        connectorId,
      );
    } catch (e) {
      setBusy(false);
      toast.error(`${t.twins.exposeDtr.failOffering}: ${(e as Error).message}`);
      return;
    }
    setBusy(false);
    toast.success(t.twins.exposeDtr.success);
    onDone();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent
        className="max-w-xl p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton={false}
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (busy) e.preventDefault(); }}
      >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-border bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Share2 className="w-4 h-4 text-primary flex-shrink-0" />
          <DialogTitle className="text-[15px] font-semibold text-foreground truncate">{t.twins.exposeDtr.title}</DialogTitle>
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
        <DialogDescription className="text-[12px] text-muted-foreground leading-snug">{t.twins.exposeDtr.desc}</DialogDescription>

        {connectors.length === 0 ? (
          <div className="flex items-start gap-2 text-[12px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded px-3 py-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{t.twins.expose.noConnectors}</span>
          </div>
        ) : (
          <>
            <FormField label={t.twins.expose.selectConnector} required>
              <select className={inputCls} value={connectorId} disabled={busy} onChange={(e) => setConnectorId(e.target.value)}>
                {connectors.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.bpn}</option>)}
              </select>
            </FormField>

            <FormField label="Asset ID" required>
              <input className={`${inputCls} mono`} value={assetId} disabled={busy} onChange={(e) => setAssetId(e.target.value)} />
            </FormField>
            <FormField label={t.twins.exposeDtr.dtrUrl} hint={t.twins.exposeDtr.dtrUrlHint} required>
              <input className={`${inputCls} mono`} placeholder={DTR_URL_DEFAULT} value={dtrUrl} disabled={busy} onChange={(e) => setDtrUrl(e.target.value)} />
            </FormField>

            {policies.length === 0 && !polLoading ? (
              <div className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{t.twins.expose.noPolicies}</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label={t.twins.expose.accessPolicy} required>
                  <select className={inputCls} value={accessPolicyId} disabled={busy} onChange={(e) => setAccessPolicyId(e.target.value)}>
                    {policies.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
                  </select>
                </FormField>
                <FormField label={t.twins.expose.contractPolicy} required>
                  <select className={inputCls} value={contractPolicyId} disabled={busy} onChange={(e) => setContractPolicyId(e.target.value)}>
                    {policies.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
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
          icon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
        >
          {busy ? t.twins.exposeDtr.submitting : t.twins.exposeDtr.submit}
        </PrimaryActionButton>
      </div>
      </DialogContent>
    </Dialog>
  );
}
